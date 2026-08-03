import { Ball, Prediction, predictLanding } from './ball';
import {
  Aim,
  ContactKind,
  NEUTRAL_AIM,
  canAttackAboveNet,
  canReach,
  contactQuality,
  performAttack,
  performBlock,
  performBump,
  performServe,
  performSet,
} from './contact';
import { Vec3, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  BALL_RADIUS,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  FIXED_DT,
  MAX_TOUCHES,
  NET_BOTTOM,
  NET_HEIGHT,
  OUT_MARGIN_X,
  OUT_MARGIN_Y,
  SETS_TO_WIN,
  Side,
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
  private lastTouchWasBlock = false;

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

      if (cmd.jumpPressed) p.jump();
      p.step(dt, cmd.moveX, cmd.moveY);
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

    if (this.phase !== 'serve') this.ball.step(dt);
    this.prediction = predictLanding(this.ball);
    if (this.phase === 'rally') this.checkRallyEnd();
    this.updateActivePlayers();
  }

  private stepServe(commands: Map<number, Command>, dt: number): void {
    const team = this.team(this.servingSide);
    const server = team.server;
    const cmd = commands.get(server.id) ?? idleCommand();

    // Ball stays glued to the server's hands until the toss.
    this.ball.pos = v3(
      server.pos.x,
      server.pos.y + attackDir(this.servingSide) * 0.3,
      1.25 + server.height + (server.charge > 0.05 ? 0.35 : 0),
    );
    this.ball.frozen = true;

    void dt;
    if (cmd.actionHeld) server.setAnim('serve');

    const release = server.releasedCharge > 0;
    // Eight seconds is the FIVB limit; the whistle enforces it.
    const timeout = this.phaseTimer > 8;

    if (release || timeout) {
      this.ball.frozen = false;
      const res = performServe({
        player: server,
        ball: this.ball,
        aim: cmd.aim,
        rng: this.rng,
        charge: timeout ? 0.3 : server.releasedCharge,
        errorScale: this.errorScaleFor(server),
      });
      server.releasedCharge = 0;
      server.charge = 0;
      server.swing = 0.3;
      this.registerTouch(server, 'serve', res.speed);
      this.serveInFlight = true;
      this.aimTarget = res.target;
      this.phase = 'rally';
      this.phaseTimer = 0;
    }
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
    return opponent ? 1.15 - diff * 0.25 : 1.0;
  }

  private resolveContacts(commands: Map<number, Command>): void {
    if (this.ball.grounded || this.ball.frozen) return;
    if (this.ball.touchCooldown > 0) return;

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
      if (!cmd?.actionPressed && !cmd?.actionHeld) continue;
      const q = contactQuality(p, this.ball);
      if (!best || q > best.quality) best = { player: p, quality: q };
    }
    if (!best) return;

    const p = best.player;
    const cmd = commands.get(p.id) ?? idleCommand();
    const team = this.team(p.side);
    const kind = this.classifyContact(p, team);
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

    // Outside the antennae — or under the net, through the open space below
    // the band — is a fault against whoever hit it.
    const outsideAntennae = Math.abs(this.ball.pos.x) > COURT_HALF_WIDTH;
    const underTheNet = this.ball.pos.z < NET_BOTTOM - BALL_RADIUS;
    if ((outsideAntennae || underTheNet) && this.lastToucherSide) {
      this.antennaFaultSide = this.lastToucherSide;
    }

    this.serveInFlight = false;
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

      let bestId = team.activeId;
      let bestScore = Infinity;
      for (const p of team.players) {
        if (p.downTime > 0) continue;
        const d = distXY(p.pos, focus);
        // Sticky: the current player keeps a small bonus so control is stable.
        const score = d - (p.id === team.activeId ? 0.9 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestId = p.id;
        }
      }
      team.activeId = bestId;
    }
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
