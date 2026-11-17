import { FIXED_DT, GAME_SPEED, NET_HEIGHT, PLAYER_REACH } from './core/rules';
import { v3 } from './core/math3';
import { Replay } from './game/replay';
import { World } from './core/world';
import { Audio } from './game/audio';
import { buildStamp, loadBuildInfo } from './game/build-info';
import { InputManager, DEFAULT_BINDINGS, LOCAL_HOME_BINDINGS, LOCAL_AWAY_BINDINGS } from './game/input';
import { TouchControls } from './game/touch-controls';
import { Menu, type MatchSetup, type MatchMode } from './game/menu';
import { loadProgression, saveProgression, awardMatch } from './game/progression';
import './game/match-actions.css';
import { TEAMS } from './game/teams';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';
import { fitGameViewport, GAME_VIEW_HEIGHT, GAME_VIEW_WIDTH } from './render/viewport';
import { renderStats, resetRenderStats, resetSpriteTimeline } from './render/sprite-figure';
import { frameVariantStats } from './render/sprites';

type Screen = 'menu' | 'match' | 'paused';

/**
 * Application shell: canvas setup, the fixed-timestep loop, and the handful of
 * screens around the match itself.
 *
 * The simulation runs at a fixed 120 Hz regardless of display refresh, and the
 * renderer draws once per animation frame. On a 60 Hz panel that is two steps
 * per frame; on a 120 Hz ProMotion display, one. Either way the physics are
 * identical, which is what keeps the game deterministic and the feel constant.
 */
class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input = new InputManager();
  private readonly awayInput = new InputManager(LOCAL_AWAY_BINDINGS, window, { side: 'away', gamepad: null, keyboard: false });
  private readonly touch = new TouchControls(this.input);
  private readonly audio = new Audio();
  private readonly menu = new Menu();

  private world: World | null = null;
  private screen: Screen = 'menu';
  private accumulator = 0;
  /** Rolling recording of the last couple of seconds, for replays. */
  private readonly replay = new Replay();
  /** Set when something replay-worthy happened; fires once the rally is dead. */
  private pendingReplay: string | null = null;
  /** Points played since the last replay, so they stay an event. */
  private pointsSinceReplay = 99;
  private lastFrame = 0;
  private elapsed = 0;
  private hitStop = 0;
  /** Briefly swallows menu-confirm input so it cannot become the opening serve. */
  private inputLock = 0;
  private lastSetup: MatchSetup | null = null;
  private matchMode: MatchMode = 'solo';
  private matchId = '';
  private humanActions = 0;
  private rewardRecorded = false;
  private rewardMessage = '';
  private readonly matchActions = document.createElement('section');
  private actionsState = '';
  private actionsInputLock = 0;
  private actionsNavigationCooldown = 0;
  private padAssignments: { home: number | null; away: number | null } = { home: null, away: null };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = ctx;
    this.renderer = new Renderer(ctx);
    this.hud = new Hud(ctx);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Audio can only start from a gesture; any key or click will do.
    const unlock = () => this.audio.resume();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    this.matchActions.className = 'match-actions';
    this.matchActions.setAttribute('aria-label', 'Azioni partita');
    this.matchActions.hidden = true;
    this.matchActions.addEventListener('keydown', (event) => {
      // Buttons deliberately keep normal form keys out of InputManager. The
      // pause shortcuts still belong to this overlay while a button has focus.
      if (!['Escape', 'KeyP'].includes(event.code) || !(event.target instanceof Element)
        || !event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.togglePause();
    });
    document.body.append(this.matchActions);
    window.addEventListener('gamepadconnected', () => this.assignInputs(false));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'match') this.togglePause();
    });
  }

  /**
   * Size the backing store to the device pixel ratio so the court lines stay
   * crisp on a Retina display, while keeping CSS-pixel coordinates in code.
   */
  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width: w, height: h, scale } = fitGameViewport(window.innerWidth, window.innerHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    this.renderer.resize(GAME_VIEW_WIDTH, GAME_VIEW_HEIGHT);
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    // Clamp the delta so a backgrounded tab does not fast-forward the match on
    // return, and so a single slow frame cannot spiral the accumulator.
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;

    this.input.poll();
    this.awayInput.poll();
    // The QA harness stops the clock so it can photograph an exact moment —
    // a real contact, a real block at its apex — that would otherwise be gone
    // by the time the screenshot is taken. It freezes time and nothing else:
    // no pose, height or swing is ever written from outside the simulation,
    // which is what made the previous build's evidence meaningless.
    this.update(this.qaFreeze ? 0 : dt);
    // Pausing the simulation also freezes the sprite clock. Otherwise a
    // stationary player keeps stepping under the overlay and resumes mid-step.
    this.draw(this.qaFreeze || this.screen === 'paused' ? 0 : dt);

    requestAnimationFrame(this.frame);
  };

  /** Set by tools/visual-qa-v3.ts only. Halts time; changes nothing else. */
  qaFreeze = false;
  /**
   * Simulation steps per real second, as a multiplier. The QA harness runs the
   * match faster than real time so a rare moment — a jump serve, a Lethal
   * Maneuver — arrives in seconds rather than minutes. The steps themselves are
   * unchanged and still fixed-size, so the match that gets photographed is the
   * same match; only the wall clock is compressed. Videos record at 1.
   */
  qaTimeScale = 1;

  renderDiagnostics(): Record<string, unknown> {
    return {
      officials: this.renderer.officialDiagnostics,
      gaits: this.renderer.gaitDiagnostics,
      sprites: this.renderer.spriteDiagnostics,
      crowd: this.renderer.crowdDiagnostics,
      cosmetics: this.renderer.cosmeticDiagnostics,
    };
  }

  private update(dt: number): void {
    if (this.input.pausePressed || this.awayInput.pausePressed) this.togglePause();

    switch (this.screen) {
      case 'menu': {
        this.menu.update(this.input, dt);
        if (this.menu.ready) {
          this.startMatch();
        }
        break;
      }
      case 'match': {
        const world = this.world;
        if (!world) break;
        if (world.phase === 'matchOver') {
          this.accumulator = 0;
          this.updateMatchActionInput(dt);
          break;
        }

        // Action skips a replay; Escape pauses/resumes it through togglePause.
        if (this.replay.isPlaying) {
          if (this.input.actionPressed || this.input.jumpPressed || this.awayInput.actionPressed || this.awayInput.jumpPressed) {
            this.replay.stop();
          }
          this.input.consumeCommandEdges();
          this.awayInput.consumeCommandEdges();
          break;
        }

        // Hit-stop: hold the world still for a few frames after a big impact.
        if (this.hitStop > 0) {
          this.hitStop = Math.max(0, this.hitStop - dt);
          break;
        }

        // Everything runs at GAME_SPEED: the exchanges around the net were
        // arriving faster than a player could read them.
        this.accumulator += dt * GAME_SPEED * this.qaTimeScale;
        // Edges belong to ONE simulation step. A display frame usually spans
        // two fixed steps, and feeding the same command to both replayed every
        // press: the toss press was still "pressed" on the next step, which is
        // half of why the serve fired itself.
        if (this.inputLock > 0) {
          this.inputLock = Math.max(0, this.inputLock - dt);
          this.input.consumeCommandEdges();
          this.awayInput.consumeCommandEdges();
        }
        let command = world.isHumanControlled('home') ? this.input.command(this.inputLock > 0) : null;
        let awayCommand = world.isHumanControlled('away') ? this.awayInput.command(this.inputLock > 0) : null;
        let steps = 0;
        const maxSteps = 8 * Math.max(1, Math.ceil(this.qaTimeScale));
        while (this.accumulator >= FIXED_DT && steps < maxSteps) {
          if (world.phase === 'serve' || world.phase === 'rally') {
            this.humanActions += Number(!!command?.actionPressed) + Number(!!command?.jumpPressed)
              + Number(!!awayCommand?.actionPressed) + Number(!!awayCommand?.jumpPressed);
          }
          world.step(command, FIXED_DT, awayCommand);
          // Faster painting can produce a display frame with no World.step.
          // Clear a tap only here, not merely because another frame was drawn.
          this.input.consumeCommandEdges();
          this.awayInput.consumeCommandEdges();
          if (command && (command.actionPressed || command.jumpPressed)) {
            command = { ...command, actionPressed: false, jumpPressed: false };
          }
          if (awayCommand && (awayCommand.actionPressed || awayCommand.jumpPressed)) {
            awayCommand = { ...awayCommand, actionPressed: false, jumpPressed: false };
          }
          this.accumulator -= FIXED_DT;
          steps++;
          // The winning step is the last step: no held play command enters a finished match.
          if (this.world?.phase === 'matchOver') {
            this.accumulator = 0;
            break;
          }
        }
        // If we fell too far behind, drop the backlog rather than chase it.
        if (steps >= maxSteps) this.accumulator = 0;

        const events = world.drainEvents();
        this.renderer.handleEvents(world, events);
        this.audio.handle(events);

        // Worth seeing again: a rally that was won by an attack, or a Lethal
        // Maneuver. Anything else would make replays routine, and a replay you
        // see every point is an interruption.
        for (const ev of events) {
          if (ev.type === 'powerMove' && !world.humanAwayTeam && this.pointsSinceReplay >= 8) {
            this.pendingReplay = ev.name;
          } else if (
            ev.type === 'point' &&
            ev.reason === 'kill' &&
            // A five-touch rally is just a rally — serve, pass, set, swing,
            // dig — so this fired on nearly every point, and a replay you see
            // every point is not a replay, it is an interruption. It now takes
            // a genuinely long exchange, and a few points have to pass before
            // another one is offered.
            !world.humanAwayTeam && ev.rallyLength > 16 &&
            this.pointsSinceReplay >= 8
          ) {
            this.pendingReplay = this.pendingReplay ?? 'THE POINT';
          }
          if (ev.type === 'point') this.pointsSinceReplay++;
          if (ev.type === 'matchWon') this.recordMatchReward();
        }
        break;
      }
      case 'paused':
        this.updateMatchActionInput(dt);
        break;
      default:
        this.input.consumeCommandEdges();
        this.awayInput.consumeCommandEdges();
        break;
    }
  }

  private draw(dt: number): void {
    const w = GAME_VIEW_WIDTH, h = GAME_VIEW_HEIGHT;
    this.touch.setVisible(this.screen === 'match' || this.screen === 'paused');
    this.updateMatchActions();

    if (this.screen === 'menu' || !this.world) {
      // Preparation draws behind the menu; cover it within the same frame so
      // the player never sees a flash of an empty court before confirming.
      this.renderer.prepareScenery();
      this.menu.draw(this.ctx, w, h, this.input.hasGamepad, this.renderer.menuPortrait);
      return;
    }

    // A running replay replaces the live view entirely.
    const frame = this.replay.step(dt);
    if (frame) {
      this.renderer.drawReplay(this.world, frame, this.replay.title, this.replay.age, dt, this.elapsed);
      if (this.screen === 'paused') this.drawPauseOverlay(w, h);
      return;
    }

    this.hitStop = Math.max(
      this.hitStop,
      this.renderer.draw(
        this.world,
        {
          alpha: Math.max(0, Math.min(1, this.accumulator / FIXED_DT)),
          time: this.elapsed,
          jumpLabel: this.touch.visible ? 'SALTO' : this.input.hasGamepad ? 'B' : this.world.humanAwayTeam ? 'G' : 'SHIFT',
          awayJumpLabel: this.awayInput.hasGamepad ? 'B' : 'L',
          touch: this.touch.visible,
        },
        dt,
      ),
    );
    if (this.screen === 'match' && dt > 0 && this.renderer.replayFrame) {
      this.replay.record(this.renderer.replayFrame, dt * GAME_SPEED);
      // Include the final painted contact/point before switching to playback.
      if (this.pendingReplay && this.world.phase !== 'rally') {
        if (this.replay.start(this.pendingReplay)) {
          this.hitStop = 0;
          this.pointsSinceReplay = 0;
        }
        this.pendingReplay = null;
      }
    }
    this.hud.draw(this.world, w, h, { gamepad: this.input.hasGamepad,
      gamepadAway: this.awayInput.hasGamepad, touch: this.touch.visible, time: this.elapsed });

    if (this.screen === 'paused') this.drawPauseOverlay(w, h);
  }

  private drawPauseOverlay(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(2,5,13,0.76)';
    ctx.fillRect(0, 0, w, h);
    const pw = Math.min(560, w * 0.56);
    const ph = 148;
    const x = w / 2 - pw / 2;
    const y = h / 2 - ph / 2;
    const cut = 24;
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + pw - cut, y);
    ctx.lineTo(x + pw, y + cut);
    ctx.lineTo(x + pw, y + ph - cut);
    ctx.lineTo(x + pw - cut, y + ph);
    ctx.lineTo(x + cut, y + ph);
    ctx.lineTo(x, y + ph - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, y, 0, y + ph);
    grad.addColorStop(0, 'rgba(18,30,54,0.98)');
    grad.addColorStop(1, 'rgba(4,8,18,0.98)');
    ctx.fillStyle = grad;
    ctx.shadowColor = '#49dcff';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(73,220,255,0.72)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ffd35c';
    ctx.fillRect(x + 42, y, pw - 84, 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '950 46px "Arial Black", "Inter", system-ui, sans-serif';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#030712';
    ctx.strokeText('PARTITA IN PAUSA', w / 2, h / 2 - 17);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillText('PARTITA IN PAUSA', w / 2, h / 2 - 17);
    ctx.font = '900 12px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#49dcff';
    ctx.fillText(this.touch.visible ? 'TOCCA RIPRENDI PER CONTINUARE' : 'ESC / START  ·  RIPRENDI', w / 2, h / 2 + 35);
    ctx.font = '700 11px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(190,205,230,0.8)';
    ctx.fillText(buildStamp(), w / 2, h / 2 + 62);
    ctx.restore();
  }

  /**
   * Start an attract-mode match: both sides driven by the AI, fixed seed.
   *
   * This is the entry point the visual QA uses. It is an ordinary public
   * command — choose the teams, the difficulty and the seed, then let the game
   * play — and it is the whole extent of the harness's influence. Everything
   * it photographs afterwards is produced by the simulation.
   */
  startDemoMatch(seed = 1337, difficulty = 1, homeIndex = 0, awayIndex = 1): void {
    resetSpriteTimeline();
    this.world = new World({
      home: TEAMS[homeIndex],
      away: TEAMS[awayIndex],
      seed,
      difficulty,
      humanControlsHome: false,
    });
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.screen = 'match';
    this.menu.reset();
    this.prepareMatch('demo');
  }

  /**
   * QA-only controlled input scene: the home side is human-controlled, the
   * opponent has the ball above the tape, and the active player is a front-row
   * blocker at the net. tools/visual-qa-v3.ts then presses the real jump key.
   *
   * This deliberately sets up the situation, but does not fake the action: the
   * block must still be produced by InputManager -> World.step -> Player.jump.
   */
  startQaManualBlockScenario(seed = 2026, difficulty = 1): void {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed,
      difficulty,
      humanControlsHome: true,
    });

    world.phase = 'rally';
    world.phaseTimer = 0;
    world.possession = 'away';
    world.ball.frozen = false;
    world.ball.grounded = false;
    world.ball.pos = v3(0.35, 1.4, NET_HEIGHT + 0.7);
    world.ball.vel = v3(0, -1, -0.2);

    const blockers = world.home.frontRow();
    const caller = blockers[1];
    const mate = blockers[0];
    const spare = blockers[2];
    world.home.activeId = caller.id;
    caller.pos = v3(0.05, -2.32, 0);
    mate.pos = v3(0.88, -2.28, 0);
    spare.pos = v3(-0.82, -2.28, 0);
    for (const p of blockers) {
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
      p.vel = v3();
      p.setAnim('ready');
    }

    this.world = world;
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.inputLock = 0;
    this.screen = 'match';
    this.menu.reset();
    this.input.reset();
    this.prepareMatch('solo');
  }

  /**
   * QA-only timing scene: unlike startDemoMatch this keeps the home side human
   * controlled, because World.playCue deliberately does not exist in AI-only
   * demo play. The scene sets up a legal rally ball inside the active player's
   * reach; the cue itself is still computed by World.playCue and rendered by
   * the normal frame loop.
   */
  startQaHotTimingCueScenario(seed = 2027, difficulty = 1): void {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed,
      difficulty,
      humanControlsHome: true,
    });

    const receiver = world.home.players[1];
    world.phase = 'rally';
    world.phaseTimer = 0;
    world.possession = 'away';
    world.touches = 1;
    world.ball.frozen = false;
    world.ball.grounded = false;
    receiver.pos = v3(-2.2, -5.2, 0);
    receiver.vel = v3();
    receiver.height = 0;
    receiver.vertVel = 0;
    receiver.downTime = 0;
    receiver.lockout = 0;
    receiver.setAnim('ready');
    receiver.presentation.action = 'none';
    receiver.presentation.locomotion = 'stand';
    world.home.activeId = receiver.id;
    world.ball.pos = v3(receiver.pos.x + 0.08, receiver.pos.y + 0.04, PLAYER_REACH * 0.62);
    world.ball.vel = v3(0.25, -0.45, -0.18);

    this.world = world;
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.inputLock = 0;
    this.screen = 'match';
    this.menu.reset();
    this.input.reset();
    this.prepareMatch('solo');
  }

  qaPressKey(code: string): void {
    this.input.pressForQa(code);
  }

  qaReleaseKey(code: string): void {
    this.input.releaseForQa(code);
  }

  qaTapKeyAndStep(code: string, frames = 4): void {
    const dt = FIXED_DT / Math.max(0.001, GAME_SPEED * this.qaTimeScale);
    this.input.pressForQa(code);
    this.input.poll();
    for (let i = 0; i < frames; i++) this.update(dt);
    this.input.releaseForQa(code);
    this.input.poll();
    this.update(dt);
  }

  private startMatch(): void {
    const setup = this.menu.ready;
    if (!setup) return;
    this.lastSetup = setup;
    resetSpriteTimeline();
    this.world = new World({
      home: setup.home,
      away: setup.away,
      seed: setup.seed,
      difficulty: setup.difficulty,
      humanControlsHome: setup.mode !== 'demo',
      humanControlsAway: setup.humanControlsAway,
      format: setup.format,
    });
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.screen = 'match';
    this.menu.reset();
    this.renderer.setCosmetics({ ballId: setup.ballId, courtId: setup.courtId });
    this.prepareMatch(setup.mode);
    this.inputLock = 0.25;
    this.audio.resume();
  }

  private prepareMatch(mode: MatchMode): void {
    this.matchMode = mode;
    this.matchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.humanActions = 0;
    this.rewardRecorded = false;
    this.rewardMessage = '';
    this.replay.clear();
    this.pendingReplay = null;
    this.pointsSinceReplay = 0;
    this.menu.hide();
    this.touch.release();
    this.input.reset();
    this.awayInput.reset();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.assignInputs(true);
  }

  /** Pad slots stay assigned during disconnects so a controller never changes sides mid-rally. */
  private assignInputs(newMatch: boolean): void {
    const pads = InputManager.connectedGamepads();
    if (this.screen === 'menu' || this.matchMode !== 'versus') {
      this.input.configure({ bindings: DEFAULT_BINDINGS, side: 'home', gamepad: 'auto', keyboard: true });
      this.awayInput.configure({ bindings: LOCAL_AWAY_BINDINGS, side: 'away', gamepad: null, keyboard: false });
      return;
    }
    if (newMatch) {
      this.padAssignments = { home: pads.length > 1 ? pads[0].index : null,
        away: pads.length > 1 ? pads[1].index : pads[0]?.index ?? null };
    } else {
      for (const pad of pads) {
        if (Object.values(this.padAssignments).includes(pad.index)) continue;
        if (this.padAssignments.away === null) this.padAssignments.away = pad.index;
        else if (this.padAssignments.home === null) this.padAssignments.home = pad.index;
      }
    }
    this.input.configure({ bindings: LOCAL_HOME_BINDINGS, side: 'home', gamepad: this.padAssignments.home, keyboard: true });
    this.awayInput.configure({ bindings: LOCAL_AWAY_BINDINGS, side: 'away', gamepad: this.padAssignments.away, keyboard: true });
  }

  private recordMatchReward(): void {
    const world = this.world;
    if (!world || this.rewardRecorded || world.phase !== 'matchOver') return;
    this.rewardRecorded = true;
    const reward = awardMatch(loadProgression(), {
      id: this.matchId, mode: this.matchMode, completed: true, humanActions: this.humanActions,
      won: world.home.setsWon > world.away.setsWon,
      pointsWon: world.home.setScores.reduce((a, b) => a + b, 0),
      pointsLost: world.away.setScores.reduce((a, b) => a + b, 0),
      setsPlayed: world.home.setScores.length,
      skillUses: world.home.skillState.activations + (world.humanAwayTeam ? world.away.skillState.activations : 0),
    });
    if (reward.awarded) {
      const saved = saveProgression(reward.profile);
      this.rewardMessage = `+${reward.xpGained} XP${reward.newUnlocks.length ? ` · ${reward.newUnlocks.length} nuovi sblocchi nella Collezione` : ''}`
        + (saved ? ' · Progressi salvati' : ' · Salvataggio locale non disponibile');
    } else {
      this.rewardMessage = this.matchMode === 'demo' ? 'Gioca una partita per ottenere XP e sblocchi.' : 'Completa una partita partecipando agli scambi per ottenere XP.';
    }
  }

  private returnToMenu(): void {
    this.screen = 'menu';
    this.world = null;
    this.replay.clear();
    this.touch.release();
    this.pendingReplay = null;
    this.menu.reset();
    this.assignInputs(false);
  }

  private updateMatchActions(): void {
    const over = this.world?.phase === 'matchOver';
    const state = this.screen === 'paused' ? 'paused' : this.screen === 'match' && over ? 'over' : '';
    const key = `${state}|${this.rewardMessage}`;
    if (key === this.actionsState) return;
    const previousState = this.actionsState.split('|')[0];
    const focusedIndex = Array.from(this.matchActions.querySelectorAll('button')).indexOf(document.activeElement as HTMLButtonElement);
    this.blurMatchAction();
    this.actionsState = key;
    this.matchActions.replaceChildren();
    this.matchActions.hidden = !state;
    if (!state) return;
    if (state !== previousState) {
      // The winning strike or pause press cannot also select Rematch/Resume.
      // Physical pads must return to neutral after reset before any new input.
      this.touch.release();
      this.input.reset();
      this.awayInput.reset();
      this.actionsInputLock = 0.18;
      this.actionsNavigationCooldown = 0;
    }
    const add = (label: string, action: () => void) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.addEventListener('focus', () => {
        // Programmatic gamepad focus must be visible even after a mouse click.
        button.style.outline = '3px solid #49dcff';
        button.style.outlineOffset = '4px';
      });
      button.addEventListener('blur', () => {
        button.style.outline = '';
        button.style.outlineOffset = '';
      });
      button.addEventListener('click', () => {
        this.blurMatchAction();
        this.touch.release();
        this.input.reset();
        this.awayInput.reset();
        action();
      });
      this.matchActions.append(button);
    };
    if (state === 'paused') add('Riprendi', () => this.togglePause());
    else if (this.lastSetup) add('Rivincita', () => {
      this.menu.ready = { ...this.lastSetup!, seed: Date.now() & 0x7fffffff };
      this.startMatch();
    });
    add(state === 'paused' ? 'Esci dalla partita' : 'Torna al menu', () => this.returnToMenu());
    if (state === 'over' && this.rewardMessage) {
      const info = document.createElement('p'); info.textContent = this.rewardMessage;
      info.setAttribute('role', 'status'); this.matchActions.append(info);
    }
    const buttons = this.matchActions.querySelectorAll<HTMLButtonElement>('button');
    buttons[state === previousState && focusedIndex >= 0 ? Math.min(focusedIndex, buttons.length - 1) : 0]?.focus({ preventScroll: true });
  }

  /** Navigation remains outside World; either local controller can use the same real buttons. */
  private updateMatchActionInput(dt: number): void {
    this.updateMatchActions();
    this.input.consumeCommandEdges();
    this.awayInput.consumeCommandEdges();
    this.actionsInputLock = Math.max(0, this.actionsInputLock - dt);
    this.actionsNavigationCooldown = Math.max(0, this.actionsNavigationCooldown - dt);
    if (this.matchActions.hidden || this.actionsInputLock > 0) return;

    const controllers = [this.input, this.awayInput].filter((input) => input.hasGamepad);
    const direction = controllers.map((input) => input.direction()).find((dir) => Math.max(Math.abs(dir.x), Math.abs(dir.y)) > 0.5);
    const buttons = Array.from(this.matchActions.querySelectorAll<HTMLButtonElement>('button'));
    if (!buttons.length) return;
    if (direction && this.actionsNavigationCooldown === 0) {
      const delta = Math.abs(direction.x) > Math.abs(direction.y)
        ? Math.sign(direction.x) : -Math.sign(direction.y);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = current < 0 ? 0 : (current + delta + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
      this.actionsNavigationCooldown = 0.2;
    } else if (!direction) {
      this.actionsNavigationCooldown = 0;
    }
    if (controllers.some((input) => input.actionPressed)) {
      const focused = buttons.find((button) => button === document.activeElement) ?? buttons[0];
      focused.click();
    }
  }

  private blurMatchAction(): void {
    if (document.activeElement instanceof HTMLElement && this.matchActions.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  private togglePause(): void {
    this.blurMatchAction();
    this.input.consumeCommandEdges();
    this.awayInput.consumeCommandEdges();
    this.touch.release();
    this.input.reset();
    this.awayInput.reset();
    if (this.screen === 'match') {
      // A finished match returns to the menu instead of pausing.
      if (this.world?.phase === 'matchOver') {
        this.returnToMenu();
      } else {
        this.screen = 'paused';
      }
    } else if (this.screen === 'paused') {
      this.screen = 'match';
    }
  }
}

// Load the build manifest before the first frame, so the identity is on screen
// from the menu onwards rather than appearing a moment later.
void loadBuildInfo();

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing <canvas id="game"> in the page.');
}
const game = new Game(canvas);
game.start();

// Exposed for the browser-driven control harness (tools/input-e2e.ts), which
// asserts that the arrow keys move the active player the way the screen
// implies. TypeScript's `private` is compile-time only, so the harness can
// reach the world through this handle at runtime.
(window as unknown as Record<string, unknown>).__sv90 = game;

// Render diagnostics for tools/visual-qa-v3.ts. `playerBodyDraws` is the
// number that matters: the rejected build drew two whole bodies per player
// and blended them, so the QA asserts this never exceeds one.
(window as unknown as Record<string, unknown>).__sv90render = {
  stats: renderStats,
  reset: resetRenderStats,
  max: () => renderStats.maxBodyDrawsPerPlayer,
  vectorFallbackMax: () => renderStats.maxVectorFallbackDrawsPerFrame,
  officials: () => game.renderDiagnostics().officials,
  gaits: () => game.renderDiagnostics().gaits,
  sprites: () => game.renderDiagnostics().sprites,
  frameCache: frameVariantStats,
};
