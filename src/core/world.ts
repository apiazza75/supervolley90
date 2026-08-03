import { Ball, Prediction, predictLanding } from './ball';
import {
  Aim,
  ContactKind,
  POWER_MOVE_NAMES,
  NEUTRAL_AIM,
  canAttackAboveNet,
  canReach,
  contactQuality,
  performAttack,
  performBlock,
  performBump,
  performPowerMove,
  performServe,
  performSet,
} from './contact';
import { Vec3, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  ACTION_BUFFER,
  BALL_RADIUS,
  PLAYER_REACH,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  FIXED_DT,
  MAX_TOUCHES,
  NET_HEIGHT,
  POWER_GAIN,
  OUT_MARGIN_X,
  OUT_MARGIN_Y,
  SETS_TO_WIN,
  Side,
  SERVE_APPROACH,
  TOSS_FORWARD,
  TOSS_SPEED,
  UNDERARM_HOLD,
  attackDir,
  isSetWon,
  otherSide,
  setTarget,
} from './rules';
import { Team, TeamConfig } from './team';
import { TeamBrain } from './ai';

export type Phase = 'warmup' | 'serve' | 'rally' | 'dead' | 'setBreak' | 'matchOver';

/** One player's desired action for a single simulation step. */
export interface Command {
  moveX: number;
  moveY: number;
  /** True on the step the action button goes down. */
  actionPressed: boolean;
  actionHeld: boolean;
  jumpPressed: boolean;
  /** Aim supplied by the stick, already normalised for the acting side. */
  aim: Aim;
}

export const idleCommand = (): Command => ({
  moveX: 0,
  moveY: 0,
  actionPressed: false,
  actionHeld: false,
  jumpPressed: false,
  aim: { ...NEUTRAL_AIM },
});

export type GameEvent =
  | { type: 'contact'; kind: ContactKind; side: Side; playerId: number; speed: number; at: Vec3 }
  | { type: 'powerMove'; side: Side; playerId: number; name: string; at: Vec3 }
  | { type: 'powerReady'; side: Side }
  | { type: 'bounce'; at: Vec3; speed: number }
  | { type: 'net'; at: Vec3 }
  | { type: 'point'; side: Side; reason: PointReason; rallyLength: number }
  | { type: 'sideout'; side: Side }
  | { type: 'setWon'; side: Side; setNumber: number }
  | { type: 'matchWon'; side: Side }
  | { type: 'whistle' };

export type PointReason =
  | 'kill'
  | 'out'
  | 'net'
  | 'antenna'
  | 'fourTouches'
  | 'serveFault'
  | 'block';

export interface MatchConfig {
  home: TeamConfig;
  away: TeamConfig;
  seed?: number;
  /** 0 = casual, 1 = arcade, 2 = pro. Scales AI reaction and error. */
  difficulty?: number;
  /** When false the home team is AI-driven too (attract mode / demo). */
  humanControlsHome?: boolean;
}

export class World {
  readonly ball = new Ball();
  readonly home: Team;
  readonly away: Team;
  readonly rng: Rng;
  readonly config: MatchConfig;

  phase: Phase = 'warmup';
  phaseTimer = 0;
  setNumber = 1;

  servingSide: Side = 'home';
  /** Side currently entitled to touch the ball. */
  possession: Side = 'home';
  touches = 0;
  lastToucherId = -1;
  lastToucherSide: Side | null = null;
  /** Consecutive touches by the same player, to catch double contacts. */
  repeatTouches = 0;

  rallyTime = 0;
  events: GameEvent[] = [];
  /** Landing prediction refreshed every step; the HUD marker reads this. */
  prediction: Prediction = { point: v3(), time: 0, valid: false };
  /** Set when the last strike declared an intended target (for the aim arc). */
  aimTarget: Vec3 | null = null;

  private brains: Record<Side, TeamBrain>;
  private crossedNetSign = 0;
  private antennaFaultSide: Side | null = null;
  /** True between the serve contact and the ball crossing the net. */
  private serveInFlight = false;
  /** Whether the most recent touch was a block (blocks are free touches). */
  lastTouchWasBlock = false;
  /** Serve phase: ball in hand, or tossed and waiting for the strike. */
  private serveStage: 'hold' | 'toss' = 'hold';
  private tossedAt = 0;

  /** True while a served toss is in the air, for the HUD's timing cue. */
  get serveTossInFlight(): boolean {
    return this.phase === 'serve' && this.serveStage === 'toss';
  }

  /**
   * True in the window where a press would strike the toss.
   *
   * Deliberately looser than an ordinary contact. The serve is the one moment
   * the player is standing still with all the time in the world, so the game
   * should not also demand that they be inside a 1.3 m bubble: with a toss
   * drifting forward that test made the serve unhittable unless the server
   * stepped into the court.
   */
  get serveStrikeReady(): boolean {
    if (!this.serveTossInFlight) return false;
    const server = this.team(this.servingSide).server;
    const reachTop = server.height + PLAYER_REACH + (server.airborne ? 0.7 : 0.35);
    return (
      this.phaseTimer - this.tossedAt > 0.2 &&
      (server.airborne || this.ball.vel.z < 1.6) &&
      this.ball.pos.z > 1.2 &&
      this.ball.pos.z < reachTop &&
      distXY(server.pos, this.ball.pos) < 1.9
    );
  }

  constructor(config: MatchConfig) {
    this.config = config;
    this.rng = new Rng(config.seed ?? 0x51ce5eed);
    this.home = new Team('home', config.home, this.rng, 0);
    this.away = new Team('away', config.away, this.rng, 100);
    this.brains = {
      home: new TeamBrain(this, this.home, config.difficulty ?? 1),
      away: new TeamBrain(this, this.away, config.difficulty ?? 1),
    };
    this.startSet(1, 'home');
  }

  team(side: Side): Team {
    return side === 'home' ? this.home : this.away;
  }

  get humanTeam(): Team | null {
    return this.config.humanControlsHome === false ? null : this.home;
  }

  allPlayers(): Player[] {
    return [...this.home.players, ...this.away.players];
  }

  findPlayer(id: number): Player | undefined {
    return this.home.get(id) ?? this.away.get(id);
  }

  // ---------------------------------------------------------------- lifecycle

  startSet(setNumber: number, firstServe: Side): void {
    this.setNumber = setNumber;
    this.home.points = 0;
    this.away.points = 0;
    this.servingSide = firstServe;
    this.setupServe();
  }

  private setupServe(): void {
    this.ball.frozen = true;
    this.ball.grounded = false;
    this.ball.vel = v3();
    this.ball.spin = v3();
    this.home.resetPositions();
    this.away.resetPositions();
    const server = this.team(this.servingSide).placeServer();
    this.ball.pos = v3(server.pos.x, server.pos.y + attackDir(this.servingSide) * 0.35, 1.35);

    this.possession = this.servingSide;
    this.touches = 0;
    this.repeatTouches = 0;
    this.lastToucherId = -1;
    this.lastToucherSide = null;
    this.crossedNetSign = 0;
    this.antennaFaultSide = null;
    this.serveInFlight = false;
    this.lastTouchWasBlock = false;
    this.rallyTime = 0;
    this.aimTarget = null;
    this.serveStage = 'hold';
    this.tossedAt = 0;
    for (const p of this.allPlayers()) p.cheerTime = 0;
    this.phase = 'serve';
    this.phaseTimer = 0;

    // The human always steers the server on their own serve.
    this.team(this.servingSide).activeId = server.id;
    this.events.push({ type: 'whistle' });
  }

  // ------------------------------------------------------------------- update

  /**
   * Advance the simulation by one fixed step.
   * `humanCommand` steers the active player of the home team; pass null for
   * a fully AI-driven match.
   */
  step(humanCommand: Command | null, dt = FIXED_DT): void {
    this.phaseTimer += dt;
    if (this.phase === 'rally' || this.phase === 'serve') this.rallyTime += dt;

    const commands = new Map<number, Command>();
    const human = this.humanTeam;
    // Keep the AI from also acting for the player the human is holding.
    this.brains.home.suppress(human && humanCommand ? human.activeId : -1);
    this.brains.away.suppress(-1);

    for (const side of ['home', 'away'] as Side[]) {
      const team = this.team(side);
      const brain = this.brains[side];
      brain.think(dt);
      for (const p of team.players) commands.set(p.id, brain.commandFor(p));
    }
    if (human && humanCommand) commands.set(human.activeId, humanCommand);

    for (const p of this.allPlayers()) {
      const cmd = commands.get(p.id) ?? idleCommand();
      // Charge builds while the button is held *before* the ball arrives: a tap
      // becomes a tip or a floater, a long hold a full-power swing.
      if (cmd.actionHeld) {
        p.charge = clamp(p.charge + dt * 1.7, 0, 1);
      } else if (p.heldAction) {
        p.releasedCharge = p.charge;
        p.charge = 0;
      }
      p.heldAction = cmd.actionHeld;

      // Buffer the press so anticipating the ball is rewarded rather than
      // punished. Cleared on contact, in registerTouch.
      if (cmd.actionPressed) p.actionBuffer = ACTION_BUFFER;
      else if (p.actionBuffer > 0) p.actionBuffer = Math.max(0, p.actionBuffer - dt);

      // The action button is the whole attack: press it on the ground with the
      // ball still high and out of reach and it JUMPS; press it again in the
      // air and the swing happens. Charging a meter for power, then finding
      // the jump was already over, was the worst of both worlds.
      // Human-steered player only: the AI decides its own jumps, and letting
      // this rule fire for all six sent the whole team into the air whenever
      // they meant to pass.
      if (
        cmd.actionPressed &&
        human !== null &&
        p.id === human.activeId &&
        p.side === human.side &&
        !p.airborne &&
        p.canAct &&
        this.phase === 'rally' &&
        !canReach(p, this.ball) &&
        this.ball.pos.z > 1.9 &&
        distXY(p.pos, this.ball.pos) < 3.2
      ) {
        p.jump();
        if (this.possession !== p.side && Math.abs(p.pos.y) < 2.2) p.setAnim('block');
      }

      // On the ground the jump button jumps; in the air it calls for a Lethal
      // Maneuver, which is only honoured if the team's gauge is full.
      if (cmd.jumpPressed) {
        if (p.airborne) {
          if (this.team(p.side).powerReady) p.specialArmed = true;
        } else if (p.jump()) {
          // A defensive jump at the net is a block and must read as one —
          // both arms straight up — not as a spike wind-up.
          if (this.possession !== p.side && Math.abs(p.pos.y) < 2.2) {
            p.setAnim('block');
          }
        }
      }
      p.step(dt, cmd.moveX, cmd.moveY);
    }

    // Teammates keep personal space. Converging assignments used to stack two
    // players on the same spot, which on screen fused them into one deformed
    // figure — the single ugliest thing on the court. A gentle symmetric push
    // separates grounded teammates without fighting whoever is running to
    // play the ball.
    for (const side of ['home', 'away'] as const) {
      const ps = this.team(side).players;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          if (a.airborne || b.airborne || a.diving || b.diving) continue;
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          // The flat side view compresses court depth to almost nothing, so
          // two players a metre apart across the court still overlap on
          // screen. Distance is therefore measured the way the screen shows
          // it — depth heavily discounted — and the push runs along the
          // court, the axis the viewer can actually see.
          const d = Math.hypot(dx * 0.3, dy);
          const MIN_GAP = 0.85;
          if (d >= MIN_GAP) continue;
          const push = ((MIN_GAP - d) / 2) * Math.min(1, dt * 14);
          const dir = dy !== 0 ? Math.sign(dy) : i < j ? -1 : 1;
          a.pos.y -= dir * push;
          b.pos.y += dir * push;
          a.clampToArena();
          b.clampToArena();
        }
      }
    }

    // Where everyone is looking. Purely presentational, but it is most of what
    // makes the court read as people playing rather than mannequins pointed at
    // random.
    if (this.phase === 'serve' || this.phase === 'rally') {
      for (const p of this.allPlayers()) {
        if (p.airborne || p.diving || p.downTime > 0) continue;
        if (Math.hypot(p.vel.x, p.vel.y) > 1.4) continue;

        // During a serve everyone except the server faces the net, ready for
        // the rally. Tracking the ball here turned the serving team around to
        // watch their own server, backs to the play.
        if (this.phase === 'serve' && p.id !== this.team(this.servingSide).server.id) {
          p.facing = attackDir(p.side);
          continue;
        }

        const dy = this.ball.pos.y - p.pos.y;
        if (Math.abs(dy) > 0.25) p.facing = Math.sign(dy);
      }
    }

    switch (this.phase) {
      case 'serve':
        this.stepServe(commands, dt);
        break;
      case 'rally':
        this.stepRally(commands, dt);
        break;
      case 'dead':
        this.stepDead(dt);
        break;
      case 'setBreak':
        if (this.phaseTimer > 3.2) {
          const next = this.setNumber + 1;
          this.startSet(next, this.rng.chance(0.5) ? 'home' : 'away');
        }
        break;
      default:
        break;
    }

    // During the serve the ball is glued to the hand until the toss; once
    // tossed it flies free and the physics must run.
    if (this.phase !== 'serve' || this.serveStage === 'toss') this.ball.step(dt);
    this.prediction = predictLanding(this.ball);
    if (this.phase === 'rally') this.checkRallyEnd();
    this.updateActivePlayers();
  }

  /**
   * The serve, as the arcade originals played it: press once to toss the ball
   * up, then hit it with a second press — and the height you meet it at is the
   * serve you get. Take it low from the ground and it floats; jump and meet it
   * at full stretch and it is a driven jump serve. A toss allowed to drop is
   * simply caught and retried.
   */
  private stepServe(commands: Map<number, Command>, dt: number): void {
    void dt;
    const team = this.team(this.servingSide);
    const server = team.server;
    const cmd = commands.get(server.id) ?? idleCommand();

    // The whistle: after eight seconds the serve happens by itself.
    if (this.phaseTimer > 8) {
      this.ball.frozen = false;
      this.strikeServe(server, cmd, 0.3);
      return;
    }

    if (this.serveStage === 'hold') {
      this.ball.frozen = true;
      this.ball.pos = v3(
        server.pos.x,
        server.pos.y + attackDir(this.servingSide) * 0.3,
        1.3 + server.height,
      );
      server.setAnim('serve');

      // Two serves, one button, told apart by how long it is held:
      //   tap  -> toss the ball up and go for the overhand or jump serve
      //   hold -> an underarm serve whose power is the charge, hit on release
      // The charge itself is accumulated by the main step loop, which also
      // parks it in `releasedCharge` on the frame the button comes up — so
      // that, not `heldAction`, is what tells us a press has ended. Reading
      // `heldAction` here saw the value already overwritten for this step, and
      // the release was never noticed at all: the ball never left the hand.
      if (cmd.actionHeld) return;
      if (server.releasedCharge > 0) {
        const held = server.releasedCharge;
        server.releasedCharge = 0;
        server.charge = 0;
        server.actionBuffer = 0;
        if (held > UNDERARM_HOLD) {
          // Underarm serve: slow, safe, and aimed, with the power dosed by
          // how long the button was down.
          this.strikeServe(server, cmd, clamp(held * 0.4, 0, 0.42));
          return;
        }
        this.ball.frozen = false;
        // Straight up, with only a hint of drift into the court. A toss thrown
        // well ahead of the server cannot be reached without stepping over the
        // line, which is a fault — and made the serve unhittable.
        this.ball.vel = v3(0, attackDir(this.servingSide) * TOSS_FORWARD, TOSS_SPEED);
        this.ball.spin = v3();
        this.serveStage = 'toss';
        this.tossedAt = this.phaseTimer;
        server.setAnim('set');
      }
      return;
    }

    // Ball in the air. The short delay stops the toss press itself from
    // doubling as the hit; requiring the ball to have stopped rising keeps the
    // contact at the top of the arc, where a serve is actually struck.
    // A press that arrives before the window opens is held, not thrown away,
    // so mistiming the swing by a fraction still produces a serve.
    if ((cmd.actionPressed || server.actionBuffer > 0) && this.serveStrikeReady) {
      // Contact height decides the serve. 1.8 m is roughly a standing chest
      // strike; full jumping reach pushes the charge towards 1.
      const charge = clamp((this.ball.pos.z - 1.8) / 1.3, 0, 1);
      this.strikeServe(server, cmd, charge);
      return;
    }

    // The approach jump is the game's, not the player's: one press tosses,
    // one press hits, and the footwork happens on its own.
    if (!server.airborne && server.canAct && this.phaseTimer - this.tossedAt > SERVE_APPROACH) {
      server.jump();
    }
    if (server.airborne && Math.abs(server.vel.y) < 0.2) {
      server.vel.y = attackDir(this.servingSide) * 1.0;
    }

    // Dropped toss: catch it and go again, no fault.
    if (this.ball.vel.z < 0 && this.ball.pos.z < 0.95) {
      this.serveStage = 'hold';
      this.ball.vel = v3();
      server.charge = 0;
    }
  }

  private strikeServe(server: Player, cmd: Command, charge: number): void {
    const res = performServe({
      player: server,
      ball: this.ball,
      aim: cmd.aim,
      rng: this.rng,
      charge,
      errorScale: this.errorScaleFor(server),
    });
    server.charge = 0;
    server.releasedCharge = 0;
    server.swing = 0.3;
    server.setAnim('spike');
    this.registerTouch(server, 'serve', res.speed);
    this.serveInFlight = true;
    this.aimTarget = res.target;
    this.phase = 'rally';
    this.phaseTimer = 0;
  }

  private stepRally(commands: Map<number, Command>, _dt: number): void {
    this.trackNetCrossing();
    this.resolveContacts(commands);
  }

  private stepDead(dt: number): void {
    void dt;
    if (this.phaseTimer > 1.6) {
      if (this.phase === 'dead') this.setupServe();
    }
  }

  // ------------------------------------------------------------------ contact

  private errorScaleFor(p: Player): number {
    const humanControlled = this.humanTeam?.activeId === p.id;
    if (humanControlled) return 0.75;
    const diff = this.config.difficulty ?? 1;
    const opponent = p.side !== (this.humanTeam?.side ?? 'home');
    // Higher difficulty makes the opponent cleaner and the AI teammates sloppier
    // only in the sense that the player is expected to carry more of the load.
    // The opponent gets sharper with difficulty, but ARCADE is meant to be
    // enjoyable rather than punishing.
    return opponent ? 1.4 - diff * 0.3 : 1.0;
  }

  private resolveContacts(commands: Map<number, Command>): void {
    if (this.ball.grounded || this.ball.frozen) return;
    if (this.ball.touchCooldown > 0) return;
    // A serve toss belongs to the server and nobody else. Without this a
    // team-mate standing near the server could pluck the ball out of the toss
    // and put it over the net — a serve that was never served.
    if (this.phase === 'serve') return;

    let best: { player: Player; quality: number } | null = null;
    for (const p of this.allPlayers()) {
      if (!canReach(p, this.ball)) continue;
      // A player may never play the ball twice in a row. Blocks are exempt:
      // after blocking you are allowed to be the next one to touch it.
      if (p.id === this.lastToucherId && !this.lastTouchWasBlock) continue;
      // While the serve is in the air the serving team may not touch it again.
      if (this.serveInFlight && p.side === this.servingSide) continue;
      // Three touches used and the ball never crossed: the rally is already
      // lost, so nobody may prop it up with a fourth contact. Letting the ball
      // fall reports the point as what it really was — an attack that stayed
      // on our own side — instead of a bookkeeping "four touches" fault.
      if (this.possession === p.side && this.touches >= MAX_TOUCHES) continue;
      const cmd = commands.get(p.id);
      if (!cmd?.actionPressed && !cmd?.actionHeld && p.actionBuffer <= 0) continue;
      const q = contactQuality(p, this.ball);
      if (!best || q > best.quality) best = { player: p, quality: q };
    }
    if (!best) return;

    const p = best.player;
    const cmd = commands.get(p.id) ?? idleCommand();
    const team = this.team(p.side);
    const kind = this.classifyContact(p, team);
    // How hard the ball was travelling *into* this contact. Digging a rocket is
    // worth far more gauge than passing a floater.
    const incoming = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
    const charge = clamp(p.charge, 0, 1);

    const ctx = {
      player: p,
      ball: this.ball,
      aim: cmd.aim,
      rng: this.rng,
      charge,
      errorScale: this.errorScaleFor(p),
      setterTarget: team.setterTarget(),
    };

    let speed = 0;
    let target: Vec3 | null = null;
    switch (kind) {
      case 'block': {
        const r = performBlock(ctx);
        speed = r.speed;
        target = r.target;
        break;
      }
      case 'set': {
        const r = performSet(ctx);
        speed = r.speed;
        target = r.target;
        break;
      }
      case 'spike': {
        if (p.specialArmed && team.powerReady) {
          const r = performPowerMove({ ...ctx, special: true });
          speed = r.speed;
          target = r.target;
          team.spendPower();
          p.specialArmed = false;
          this.events.push({
            type: 'powerMove',
            side: p.side,
            playerId: p.id,
            name: POWER_MOVE_NAMES[r.move],
            at: copy(this.ball.pos),
          });
          // A Lethal Maneuver flattens anyone who gets a hand on it.
          this.punishBlockers(p, 40);
          this.registerTouch(p, 'power', speed);
          p.charge = 0;
          this.aimTarget = target;
          return;
        }
        const r = performAttack(ctx);
        speed = r.speed;
        target = r.target;
        this.punishBlockers(p, r.speed);
        break;
      }
      default: {
        const r = performBump(ctx);
        speed = r.speed;
        target = r.target;
        break;
      }
    }

    p.charge = 0;
    this.aimTarget = target;
    this.registerTouch(p, kind, speed);
    this.rewardPlay(p.side, kind, incoming);
  }

  /**
   * Feed the Lethal Maneuver gauge.
   *
   * It is deliberately fed by defence, not offence: digging a spike, getting a
   * block up, laying out for a save. Winning points barely fills it. That way
   * the gauge rewards surviving pressure, and the team on the back foot is the
   * one most likely to earn a way out of it.
   */
  private rewardPlay(side: Side, kind: ContactKind, incoming: number): void {
    let gain = 0;
    if (kind === 'save') gain = POWER_GAIN.save;
    else if (kind === 'block') gain = POWER_GAIN.block;
    else if (kind === 'bump' && incoming > 18) gain = POWER_GAIN.dig;
    if (gain > 0) this.awardPower(side, gain);
  }

  private awardPower(side: Side, amount: number): void {
    if (this.team(side).addPower(amount)) {
      this.events.push({ type: 'powerReady', side });
    }
  }

  /** Decide what kind of contact this is from the game situation. */
  private classifyContact(p: Player, team: Team): ContactKind {
    const ballOnMySide = attackDir(p.side) > 0 ? this.ball.pos.y < 0 : this.ball.pos.y > 0;
    const nearNet = Math.abs(this.ball.pos.y) < 1.1;
    const high = this.ball.pos.z > NET_HEIGHT - 0.1;

    // Reaching over/at the net while the ball is still on the opponent's side
    // and coming towards us is a block, and blocks are free touches.
    if (!ballOnMySide && nearNet && high && p.airborne) return 'block';

    if (this.possession !== p.side) return 'bump';

    // The third touch must cross the net. Airborne and above the net it is a
    // real spike; from the floor `performAttack` turns it into a tip or a
    // down-ball, which is what a scrambling team would actually play.
    if (this.touches >= MAX_TOUCHES - 1) {
      if (p.airborne && high && !canAttackAboveNet(p, team.isFrontRow(p))) {
        // Back-row player taking off inside the attack line: legal only as a
        // controlled ball, never as a full swing from above the tape.
        return 'bump';
      }
      return 'spike';
    }
    if (this.touches === 1) return 'set';
    return p.diving ? 'save' : 'bump';
  }

  /**
   * A hard spike that hits a blocker's hands knocks them down — the signature
   * Power Spikes flourish, kept as a purely cosmetic/positional penalty.
   */
  private punishBlockers(attacker: Player, speed: number): void {
    if (speed < 24) return;
    const defenders = this.team(otherSide(attacker.side)).players;
    for (const d of defenders) {
      if (!d.airborne) continue;
      if (Math.abs(d.pos.y) > 1.4) continue;
      if (Math.abs(d.pos.x - this.ball.pos.x) > 1.3) continue;
      if (this.rng.chance(0.35 + (speed - 24) * 0.03)) d.knockDown(0.9);
    }
  }

  private registerTouch(p: Player, kind: ContactKind, speed: number): void {
    p.actionBuffer = 0;
    this.events.push({
      type: 'contact',
      kind,
      side: p.side,
      playerId: p.id,
      speed,
      at: copy(this.ball.pos),
    });

    if (kind === 'block') {
      // Blocks are not counted, and the blocking team gains possession only if
      // the ball stays on their side — handled by the net-crossing tracker.
      this.lastToucherId = p.id;
      this.lastToucherSide = p.side;
      this.lastTouchWasBlock = true;
      this.repeatTouches = 0;
      return;
    }
    this.lastTouchWasBlock = false;

    if (this.possession !== p.side) {
      this.possession = p.side;
      this.touches = 0;
    }
    this.repeatTouches = p.id === this.lastToucherId ? this.repeatTouches + 1 : 0;
    this.lastToucherId = p.id;
    this.lastToucherSide = p.side;
    this.touches += 1;

    if (this.touches > MAX_TOUCHES) {
      this.awardPoint(otherSide(p.side), 'fourTouches');
    }
  }

  // -------------------------------------------------------------- rally logic

  /** Watch for the ball crossing the net plane, flipping possession. */
  private trackNetCrossing(): void {
    const sign = Math.sign(this.ball.pos.y);
    if (sign === 0) return;
    if (this.crossedNetSign === 0) {
      this.crossedNetSign = sign;
      return;
    }
    if (sign === this.crossedNetSign) return;
    this.crossedNetSign = sign;

    // Outside the antennae is a fault against whoever hit it. There is no
    // under-the-net case any more: the net is solid down to the floor, so a
    // low ball rebounds instead of sneaking through.
    const outsideAntennae = Math.abs(this.ball.pos.x) > COURT_HALF_WIDTH;
    if (outsideAntennae && this.lastToucherSide) {
      this.antennaFaultSide = this.lastToucherSide;
    }

    this.serveInFlight = false;
    // Every exchange over the net feeds both sides a little, so long rallies
    // build towards a Lethal Maneuver for whoever survives them.
    if (this.lastToucherSide) this.awardPower(this.lastToucherSide, POWER_GAIN.rally);
    const newSide: Side = sign < 0 ? 'home' : 'away';
    if (this.possession !== newSide) {
      this.possession = newSide;
      this.touches = 0;
      this.repeatTouches = 0;
    }
  }

  private checkRallyEnd(): void {
    if (this.phase !== 'rally') return;

    // Safety net: a rally that never resolves would hang a headless run and
    // freeze the game. Nothing legitimate lasts this long.
    if (this.rallyTime > 45) {
      this.awardPoint(otherSide(this.lastToucherSide ?? this.servingSide), 'out');
      return;
    }

    if (this.antennaFaultSide) {
      const at = copy(this.ball.pos);
      this.events.push({ type: 'bounce', at, speed: 0 });
      this.awardPoint(otherSide(this.antennaFaultSide), 'antenna');
      return;
    }

    const b = this.ball;
    const farOut =
      Math.abs(b.pos.x) > COURT_HALF_WIDTH + OUT_MARGIN_X ||
      Math.abs(b.pos.y) > COURT_HALF_LENGTH + OUT_MARGIN_Y;

    if (!b.grounded && !farOut) return;

    const at = copy(b.pos);
    this.events.push({ type: 'bounce', at, speed: Math.hypot(b.vel.x, b.vel.y, b.vel.z) });

    const inside =
      Math.abs(at.x) <= COURT_HALF_WIDTH + BALL_RADIUS &&
      Math.abs(at.y) <= COURT_HALF_LENGTH + BALL_RADIUS;
    const landedSide: Side = at.y < 0 ? 'home' : 'away';
    const hitter = this.lastToucherSide ?? this.servingSide;

    if (inside && !farOut) {
      // Ball down inside a court: that side lost the rally. If they were also
      // the last to touch it, they put their own ball into their own floor —
      // a serve into the net, a shanked dig, or a blocked spike coming back.
      const winner = otherSide(landedSide);
      const ownError = landedSide === hitter;
      const reason: PointReason = ownError
        ? this.serveInFlight
          ? 'serveFault'
          : 'net'
        : 'kill';
      this.awardPoint(winner, reason);
    } else {
      // Out of bounds: point to whoever did not touch it last.
      this.awardPoint(otherSide(hitter), 'out');
    }
  }

  private awardPoint(side: Side, reason: PointReason): void {
    if (this.phase === 'dead' || this.phase === 'setBreak' || this.phase === 'matchOver') return;

    const team = this.team(side);
    team.points += 1;
    this.events.push({ type: 'point', side, reason, rallyLength: this.rallyTime });

    // Celebrate: a point worth having, a set, a match. Longer and wider as the
    // moment gets bigger — a rally point is a fist from whoever made it, a set
    // is the whole bench.
    const big = reason === 'kill' && this.rallyTime > 6;
    for (const p of team.players) {
      if (big || p.id === this.lastToucherId) p.celebrate(big ? 1.6 : 1.1);
    }

    if (reason === 'kill') this.awardPower(side, POWER_GAIN.kill);
    // A small consolation to the side that just conceded: a losing run should
    // trend towards having a Lethal Maneuver available, not away from it.
    this.awardPower(otherSide(side), POWER_GAIN.conceded);

    if (this.servingSide !== side) {
      this.servingSide = side;
      team.rotate();
      this.events.push({ type: 'sideout', side });
    }

    this.phase = 'dead';
    this.phaseTimer = 0;

    const opponent = this.team(otherSide(side));
    if (isSetWon(team.points, opponent.points, this.setNumber)) {
      team.setsWon += 1;
      team.setScores.push(team.points);
      opponent.setScores.push(opponent.points);
      this.events.push({ type: 'setWon', side, setNumber: this.setNumber });
      for (const p of team.players) p.celebrate(3.2);
      if (team.setsWon >= SETS_TO_WIN) {
        this.phase = 'matchOver';
        this.events.push({ type: 'matchWon', side });
      } else {
        this.phase = 'setBreak';
      }
      this.phaseTimer = 0;
    }
  }

  // --------------------------------------------------------------- selection

  /**
   * Pick which player the human steers. Switching happens between actions and
   * targets whoever can realistically play the next ball, so control never
   * yanks away mid-jump.
   */
  private updateActivePlayers(): void {
    for (const side of ['home', 'away'] as Side[]) {
      const team = this.team(side);
      const current = team.active;
      if (current.airborne || current.diving || current.downTime > 0) continue;
      if (this.phase === 'serve') {
        team.activeId = team.server.id;
        continue;
      }
      if (this.phase !== 'rally') continue;

      const aim = this.prediction.valid ? this.prediction.point : this.ball.pos;
      const mine = attackDir(side) > 0 ? aim.y < 0.4 : aim.y > -0.4;
      const focus = mine ? aim : this.ball.pos;

      // Time to get there, not raw distance: the player who can arrive in
      // time is the one worth steering, even if someone else stands closer.
      const flight = mine && this.prediction.valid ? this.prediction.time : 0.4;

      let bestId = team.activeId;
      let bestScore = Infinity;
      for (const p of team.players) {
        if (p.downTime > 0) continue;
        // The last toucher may not play the ball again, so handing them
        // control means steering a player who physically cannot make the
        // next contact — the player sets, control stays with them, and they
        // run in to spike a ball the rules will not let them touch.
        const ineligible = p.id === this.lastToucherId && !this.lastTouchWasBlock;
        const travel = distXY(p.pos, focus) / Math.max(2, p.runSpeed);
        const late = Math.max(0, travel - flight);
        // Sticky: the current player keeps a small bonus so control is stable.
        const score =
          travel + late * 2 + (ineligible ? 6 : 0) - (p.id === team.activeId ? 0.25 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestId = p.id;
        }
      }
      team.activeId = bestId;
    }
  }

  /**
   * Timing cue for the player the human is steering: how long until the ball
   * is playable, and whether it is playable right now.
   *
   * The landing marker says WHERE the ball goes. Nothing said WHEN to press,
   * so a well-positioned player still watched the ball drop past them. This
   * drives the closing ring on the ball and the PRESS! prompt.
   */
  get playCue(): { time: number; ready: boolean } | null {
    const team = this.humanTeam;
    if (!team) return null;
    if (this.phase !== 'rally') return null;
    if (this.ball.grounded || this.ball.frozen) return null;
    const p = team.active;
    if (p.id === this.lastToucherId && !this.lastTouchWasBlock) return null;
    if (this.possession === p.side && this.touches >= MAX_TOUCHES) return null;
    if (this.serveInFlight && p.side === this.servingSide) return null;

    if (canReach(p, this.ball)) return { time: 0, ready: true };
    // Where the ball will be at hand height for this player.
    const target = p.height + PLAYER_REACH * 0.6;
    if (this.ball.pos.z < target && this.ball.vel.z <= 0) return null;
    const pred = predictLanding(this.ball, target, 2.5);
    if (!pred.valid) return null;
    return { time: pred.time, ready: false };
  }

  /** Drain accumulated events; the presentation layer calls this once a frame. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Human-readable score line, handy for tests and the HUD. */
  scoreLine(): string {
    return `${this.home.config.shortName} ${this.home.points}-${this.away.points} ${this.away.config.shortName} (sets ${this.home.setsWon}-${this.away.setsWon}, to ${setTarget(this.setNumber)})`;
  }
}
