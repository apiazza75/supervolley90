import { FIXED_DT, GAME_SPEED } from './core/rules';
import { Replay } from './game/replay';
import { World } from './core/world';
import { Audio } from './game/audio';
import { buildStamp, loadBuildInfo } from './game/build-info';
import { InputManager } from './game/input';
import { Menu } from './game/menu';
import { TEAMS } from './game/teams';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';
import { renderStats, resetRenderStats } from './render/sprite-figure';

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
  }

  /**
   * Size the backing store to the device pixel ratio so the court lines stay
   * crisp on a Retina display, while keeping CSS-pixel coordinates in code.
   */
  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.resize(w, h);
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
    // The QA harness stops the clock so it can photograph an exact moment —
    // a real contact, a real block at its apex — that would otherwise be gone
    // by the time the screenshot is taken. It freezes time and nothing else:
    // no pose, height or swing is ever written from outside the simulation,
    // which is what made the previous build's evidence meaningless.
    this.update(this.qaFreeze ? 0 : dt);
    this.draw(this.qaFreeze ? 0 : dt);

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

  private update(dt: number): void {
    if (this.input.pausePressed) this.togglePause();

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

        // A replay owns the screen while it runs, and any input cuts it short.
        if (this.replay.isPlaying) {
          if (this.input.actionPressed || this.input.jumpPressed || this.input.pausePressed) {
            this.replay.stop();
          }
          break;
        }
        this.replay.record(world, dt * GAME_SPEED);

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
        let command = this.input.command();
        let steps = 0;
        const maxSteps = 8 * Math.max(1, Math.ceil(this.qaTimeScale));
        while (this.accumulator >= FIXED_DT && steps < maxSteps) {
          world.step(command);
          if (command.actionPressed || command.jumpPressed) {
            command = { ...command, actionPressed: false, jumpPressed: false };
          }
          this.accumulator -= FIXED_DT;
          steps++;
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
          if (ev.type === 'powerMove') {
            this.pendingReplay = ev.name;
          } else if (
            ev.type === 'point' &&
            ev.reason === 'kill' &&
            // A five-touch rally is just a rally — serve, pass, set, swing,
            // dig — so this fired on nearly every point, and a replay you see
            // every point is not a replay, it is an interruption. It now takes
            // a genuinely long exchange, and a few points have to pass before
            // another one is offered.
            ev.rallyLength > 9 &&
            this.pointsSinceReplay >= 5
          ) {
            this.pendingReplay = this.pendingReplay ?? 'THE POINT';
          }
          if (ev.type === 'point') this.pointsSinceReplay++;
        }
        if (this.pendingReplay && world.phase !== 'rally') {
          if (this.replay.start(this.pendingReplay)) {
            this.hitStop = 0;
            this.pointsSinceReplay = 0;
          }
          this.pendingReplay = null;
        }
        break;
      }
      default:
        break;
    }
  }

  private draw(dt: number): void {
    const { innerWidth: w, innerHeight: h } = window;

    if (this.screen === 'menu' || !this.world) {
      this.menu.draw(this.ctx, w, h, this.input.hasGamepad);
      return;
    }

    // A running replay replaces the live view entirely.
    const frame = this.replay.step(dt);
    if (frame) {
      this.renderer.drawReplay(this.world, frame, this.replay.title, this.replay.age, dt, this.elapsed);
      return;
    }

    this.hitStop = Math.max(
      this.hitStop,
      this.renderer.draw(
        this.world,
        {
          alpha: 0,
          time: this.elapsed,
          jumpLabel: this.input.hasGamepad ? 'B' : 'SHIFT',
        },
        dt,
      ),
    );
    this.hud.draw(this.world, w, h, { gamepad: this.input.hasGamepad, time: this.elapsed });

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
    ctx.strokeText('MATCH PAUSED', w / 2, h / 2 - 17);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillText('MATCH PAUSED', w / 2, h / 2 - 17);
    ctx.font = '900 12px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#49dcff';
    ctx.fillText('ESC  //  RESUME PLAY', w / 2, h / 2 + 35);
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
  }

  private startMatch(): void {
    const setup = this.menu.ready;
    if (!setup) return;
    this.world = new World({
      home: setup.home,
      away: setup.away,
      seed: setup.seed,
      difficulty: setup.difficulty,
      humanControlsHome: true,
    });
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.screen = 'match';
    this.menu.reset();
    this.audio.resume();
  }

  private togglePause(): void {
    if (this.screen === 'match') {
      // A finished match returns to the menu instead of pausing.
      if (this.world?.phase === 'matchOver') {
        this.screen = 'menu';
        this.world = null;
        this.menu.reset();
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
};
