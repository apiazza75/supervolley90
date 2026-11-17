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
  type StrikeContext,
} from './contact';
import { Vec3, approach, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  ACTION_BUFFER,
  BALL_RADIUS,
  PLAYER_REACH,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  FIXED_DT,
  POINT_BREAK_SECONDS,
  SET_BREAK_SECONDS,
  MAX_TOUCHES,
  NET_HEIGHT,
  POWER_GAIN,
  OUT_MARGIN_X,
  OUT_MARGIN_Y,
  Side,
  SERVE_APPROACH,
  TOSS_FORWARD,
  TOSS_FORWARD_JUMP,
  TOSS_SPEED,
  UNDERARM_HOLD,
  attackDir,
  otherSide,
} from './rules';
import { type MatchFormat, normaliseMatchFormat, setsToWin, matchSetTarget, isMatchSetWon, rallyAwardsPoint } from './match-format';
import type { SetPlay } from './set-play';
import type { SkillAction } from './skills';
import { Team, TeamConfig } from './team';
import { TeamBrain } from './ai';
import { looseBallReader } from './loose-ball-read';
import { keepsNetReadyPosture, SET_GROUND_RECOVERY_TIME, BUMP_GROUND_RECOVERY_TIME } from './presentation';

export type Phase = 'warmup' | 'serve' | 'rally' | 'dead' | 'setBreak' | 'matchOver';

const SERVE_RUNUP_CAP = 0.42;
const SERVE_PLANT_TOLERANCE = 0.12;

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
  | {
      type: 'contact';
      kind: ContactKind;
      side: Side;
      playerId: number;
      speed: number;
      at: Vec3;
      /** Which way the body was turned as it struck. Audited by the QA gate. */
      facing: number;
      /** Presentation variant captured from the outgoing set, not a later AI turn. */
      backSet?: boolean;
      /** Whether the strike was made off the floor, and from what height. */
      airborne: boolean;
      height: number;
      timing?: 'perfect';
      setPlay?: SetPlay;
    }
  /** A blocker committed to a block and left the floor. */
  | { type: 'blockAttempt'; side: Side; playerId: number; height: number }
  /** A block actually intercepted the ball over the net. */
  | { type: 'blockContact'; side: Side; playerId: number; height: number; airborne: boolean }
  | { type: 'powerMove'; side: Side; playerId: number; name: string; at: Vec3 }
  | { type: 'powerReady'; side: Side }
  | { type: 'skill'; side: Side; skillId: string; name: string; at: Vec3 }
  | { type: 'bounce'; at: Vec3; speed: number }
  | { type: 'net'; at: Vec3 }
  | { type: 'point'; side: Side; reason: PointReason; rallyLength: number; scored?: boolean }
  | { type: 'sideout'; side: Side }
  | { type: 'rotation'; side: Side }
  | { type: 'liberoChange'; side: Side; playerId: number; name: string; entered: boolean; slot: number }
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
  /** A second local player independently steers the away team. */
  humanControlsAway?: boolean;
  format?: MatchFormat;
}

export class World {
  readonly ball = new Ball();
  readonly home: Team;
  readonly away: Team;
  readonly rng: Rng;
  readonly config: MatchConfig;
  readonly format: MatchFormat;
  private readonly humanDrivenIds = new Set<number>();
  private readonly timingInputs = new Map<number, number>();
  private readonly timingGrace = new Map<number, number>();

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
  private serveInFlightFlag = false;

  /**
   * True while a served ball is still on its way and untouched. Public because
   * the AI has to know not to block it — blocking a serve is a fault — and the
   * tests have to be able to prove that it never does.
   */
  get serveInFlight(): boolean {
    return this.serveInFlightFlag;
  }
  /** Whether the most recent touch was a block (blocks are free touches). */
  lastTouchWasBlock = false;
  /** Serve phase: ball in hand, or tossed and waiting for the strike. */
  private serveStage: 'hold' | 'windup' | 'toss' = 'hold';
  private serveWindupSeconds = 0;
  private serveWindupHoldSeconds = 0;
  private serveRunupStartY = 0;
  /** How long the action button has been held with the ball still in hand. */
  private serveHold = 0;
  /**
   * Power dialled in before the toss, 0..1.
   *
   * The hold used to do nothing but choose an underarm serve, so how long you
   * held the button had no bearing on how hard the ball was hit — which is
   * exactly what it looks like it should do. Now it is the first half of the
   * serve: hold to load, then meet the ball well to spend what you loaded.
   */
  private serveCharge = 0;
  /** A human strike request survives until the tossed ball enters its window. */
  private serveStrikeQueued = false;
  /** True once this human serve saw a real press edge, not only a stale held level. */
  private servePressSeen = false;
  private tossedAt = 0;
  /** A side-out rotates after the point call, so the move is visible on court. */
  private pendingRotationSide: Side | null = null;
  private rotationApplied = false;

  get rotatingSide(): Side | null {
    return this.pendingRotationSide;
  }

  /** How far into an underarm serve hold we are, 0..1. */
  get serveHoldFraction(): number {
    return clamp(this.serveHold / UNDERARM_HOLD, 0, 1);
  }

  /** True while a served toss is in the air, for the HUD's timing cue. */
  get serveTossInFlight(): boolean {
    return this.phase === 'serve' && this.serveStage === 'toss';
  }

  /** Read-only gesture clocks; rendering must not invent a toss or a strike. */
  get serveHoldSeconds(): number {
    return this.serveStage === 'windup' ? this.serveWindupHoldSeconds : this.serveHold;
  }
  get serveTossGestureProgress(): number | undefined {
    return this.serveTossGestureProgressAt(0);
  }
  /** Body and held ball share this read-only sub-tick presentation clock. */
  serveTossGestureProgressAt(visualLead: number): number | undefined {
    const lead = clamp(Number.isFinite(visualLead) ? visualLead : 0, 0, FIXED_DT);
    return this.phase === 'serve' && this.serveStage === 'windup'
      ? clamp((this.serveWindupSeconds + lead) / 0.14, 0, 1) : undefined;
  }
  get serveTossElapsed(): number {
    return this.serveTossInFlight ? Math.max(0, this.phaseTimer - this.tossedAt) : 0;
  }
  /** Match the approach drawings to the actual remaining run before the plant. */
  get serveRunupProgress(): number {
    return this.serveRunupProgressAt(0);
  }

  /** Read-only presentation at the same sub-tick lead used by the drawn body. */
  serveRunupProgressAt(visualLead: number): number {
    if (!this.serveTossInFlight) return 0;
    const lead = clamp(Number.isFinite(visualLead) ? visualLead : 0, 0, FIXED_DT);
    const server = this.team(this.servingSide).server;
    const plant = -attackDir(this.servingSide) * (COURT_HALF_LENGTH + 0.35);
    const distance = Math.max(0.01, Math.abs(plant - this.serveRunupStartY) - SERVE_PLANT_TOLERANCE);
    return clamp(Math.max(Math.abs(server.pos.y + server.vel.y * lead - this.serveRunupStartY) / distance,
      (this.serveTossElapsed + lead) / SERVE_RUNUP_CAP), 0, 1);
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
    // A loaded toss explicitly chose a jump serve. Do not let an early buffered
    // press cash it out as the same standing floater before the run-up has left
    // the floor; the cue opens only once the chosen action is actually true.
    if (server.plansJumpServe && this.serveCharge > 0.4 && !server.airborne) return false;
    const reachTop = server.height + PLAYER_REACH + (server.airborne ? 0.82 : 0.45);
    // How high the ball has to be before the strike is offered.
    //
    // A flat floor of 1.2 m turned the ball red as soon as it fell back to
    // chest height, so a player who jumped and pressed on the cue struck it
    // BELOW the tape — and no ball hit from 1.5 m can be driven over a 2.43 m
    // net, so the solver quietly turned every jump serve into the same lob a
    // standing player hits. The jump has to be worth something, which means
    // the window for someone in the air is up where they can actually hit
    // down: above the tape, not below it.
    const floor = server.airborne ? NET_HEIGHT + 0.12 : 1.55;
    return (
      this.phaseTimer - this.tossedAt > 0.2 &&
      (server.airborne || this.ball.vel.z < 1.6) &&
      this.ball.pos.z > floor &&
      this.ball.pos.z < reachTop &&
      distXY(server.pos, this.ball.pos) < 2.05
    );
  }

  constructor(config: MatchConfig) {
    this.config = config;
    this.format = normaliseMatchFormat(config.format);
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

  get humanAwayTeam(): Team | null {
    return this.config.humanControlsAway === true ? this.away : null;
  }

  isHumanControlled(side: Side): boolean {
    return side === 'home' ? this.config.humanControlsHome !== false : this.config.humanControlsAway === true;
  }

  get pointsToWinSet(): number { return matchSetTarget(this.setNumber, this.format); }
  get setsNeeded(): number { return setsToWin(this.format); }

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
    this.home.prepareServePositions(this.servingSide === 'home');
    this.away.prepareServePositions(this.servingSide === 'away');
    const server = this.team(this.servingSide).placeServer();
    this.ball.pos = v3(server.pos.x, server.pos.y + attackDir(this.servingSide) * 0.35, 1.35);

    this.possession = this.servingSide;
    this.touches = 0;
    this.repeatTouches = 0;
    this.lastToucherId = -1;
    this.lastToucherSide = null;
    this.crossedNetSign = 0;
    this.antennaFaultSide = null;
    this.serveInFlightFlag = false;
    this.lastTouchWasBlock = false;
    this.rallyTime = 0;
    this.aimTarget = null;
    this.serveStage = 'hold';
    this.serveHold = 0;
    this.servePressSeen = false;
    this.serveStrikeQueued = false;
    this.tossedAt = 0;
    this.pendingRotationSide = null;
    this.rotationApplied = false;
    this.timingInputs.clear();
    this.timingGrace.clear();
    for (const p of this.allPlayers()) { p.cheerTime = 0; p.takeoffY = undefined; }
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
  step(humanCommand: Command | null, dt = FIXED_DT, awayCommand: Command | null = null): void {
    this.phaseTimer += dt;
    if (this.phase === 'rally' || this.phase === 'serve') this.rallyTime += dt;

    const commands = new Map<number, Command>();
    const human = this.humanTeam;
    const humanAway = this.humanAwayTeam;
    this.humanDrivenIds.clear();
    if (human && humanCommand) this.humanDrivenIds.add(human.activeId);
    if (humanAway && awayCommand) this.humanDrivenIds.add(humanAway.activeId);
    // Keep the AI from also acting for the player the human is holding.
    this.brains.home.suppress(human && humanCommand ? human.activeId : -1);
    this.brains.away.suppress(humanAway && awayCommand ? humanAway.activeId : -1);

    for (const side of ['home', 'away'] as Side[]) {
      const team = this.team(side);
      if (this.phase === 'rally' || this.phase === 'serve') team.tickSkill(dt);
      const brain = this.brains[side];
      brain.think(dt);
      for (const p of team.players) commands.set(p.id, brain.commandFor(p));
    }
    if (human && humanCommand) commands.set(human.activeId, humanCommand);
    if (humanAway && awayCommand) commands.set(humanAway.activeId, awayCommand);

    // A soft overpass can reach a planted blocker/cover player before the
    // tactical receive assignment changes. Read that imminent legal arrival
    // too, so the body prepares rather than snapping from idle to contact.
    const looseReader = this.phase === 'rally' ? looseBallReader(this.ball,
      this.allPlayers().filter(p => p.side !== this.lastToucherSide
        && (p.id !== this.lastToucherId || this.lastTouchWasBlock)
        && !(this.serveInFlight && p.side === this.servingSide))) : undefined;

    for (const p of this.allPlayers()) {
      const cmd = commands.get(p.id) ?? idleCommand();
      const humanSteered = this.humanDrivenIds.has(p.id);
      this.timingInputs.set(p.id, Math.max(0, (this.timingInputs.get(p.id) ?? 0) - dt));
      this.timingGrace.set(p.id, Math.max(0, (this.timingGrace.get(p.id) ?? 0) - dt));
      if (humanSteered && this.playCueFor(p.side)?.ready) this.timingGrace.set(p.id, 0.1);
      if (humanSteered && cmd.actionPressed && (this.timingGrace.get(p.id) ?? 0) > 0) {
        this.timingInputs.set(p.id, ACTION_BUFFER);
      }
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

      const assignedPasser = p.presentation.sourceJob === 'receive' || p.presentation.sourceJob === 'set';
      // A former AI passer can already be closing the block. A leftover action
      // buffer/proximity hold must not keep his forearms locked together while
      // his new job moves his feet. A real loose-ball reader and human input
      // keep their preparation; a contact still has immediate priority below.
      if (!humanSteered && p.anim === 'bump_ready' && !assignedPasser && p.id !== looseReader) {
        p.setAnim('ready');
      }

      // The assigned receiver/setter reads the arriving ball before it is
      // already in reach. Waiting for the action buffer started the illustrated
      // preparation on the same tick as contact, skipping its first half.
      if (
        this.phase === 'rally' &&
        (p.id === looseReader || assignedPasser || humanSteered && p.actionBuffer > 0) &&
        (p.id !== this.lastToucherId || this.lastTouchWasBlock) &&
        !(this.serveInFlight && p.side === this.servingSide) &&
        p.canAct &&
        !p.airborne &&
        !p.diving &&
        !canReach(p, this.ball) &&
        (p.presentation.action === 'none' || p.presentation.phase === 'recover')
      ) {
        const arrivals = [predictLanding(this.ball, PLAYER_REACH + .15, .4)];
        // A fast serve can cross the upper reach plane near the net, long
        // before it reaches a deep passer. Read its low arrival as well:
        // otherwise that passer never prepares and snaps straight to contact.
        // This predicts artwork only; it does not move or delay the ball.
        if (p.presentation.sourceJob === 'receive' || p.actionBuffer > 0) {
          arrivals.push(predictLanding(this.ball, BALL_RADIUS, .4));
        }
        const arrival = arrivals.find(candidate => candidate.valid && candidate.time <= .3
          && candidate.point.y * attackDir(p.side) < 0 && distXY(p.pos, candidate.point) < 2.35);
        if (p.id === looseReader || arrival) {
          const anticipated = this.classifyContact(p, this.team(p.side));
          if (anticipated === 'bump') p.setAnim('bump_ready');
          // Grounded set drawings raise the hands over planted feet, not a
          // sprint stride. The assigned AI setter brakes for a reachable
          // arrival independently; retain the moving/braking drawings until
          // that last adjustment is almost finished. Do not delay contact.
          else if (anticipated === 'set' && Math.hypot(p.vel.x, p.vel.y) <= 1.2) p.setAnim('set_ready');
        }
      }
      // Keep a prepared platform/hands while waiting for the predicted ball.
      // The generic .26 s settle timer otherwise restarted prepare at frame 0
      // immediately before contact. This only holds artwork, never the ball.
      if (this.phase === 'rally' && p.presentation.phase === 'prepare'
        && (p.presentation.action === 'bump' || p.presentation.action === 'set')
        && p.animTime < .65 && (p.id !== this.lastToucherId || this.lastTouchWasBlock)
        && !this.ball.grounded && distXY(p.pos, this.ball.pos) < 3) {
        p.animHold = Math.max(p.animHold, dt * 2);
      }

      // The action button is the whole attack: press it on the ground with the
      // ball still high and out of reach and it JUMPS; press it again in the
      // air and the swing happens. Charging a meter for power, then finding
      // the jump was already over, was the worst of both worlds.
      // Human-steered player only: the AI decides its own jumps, and letting
      // this rule fire for all six sent the whole team into the air whenever
      // they meant to pass.
      //
      // But only for the two things you actually leave the floor to do:
      // attacking, and blocking. A reception is played with both feet on the
      // ground — it is not a shot you can make in the air at all — and this
      // rule was firing on every high ball, so pressing to pass a serve
      // launched the passer into a mid-air set instead.
      const attacking = this.possession === p.side && this.touches >= MAX_TOUCHES - 1;
      // Blocking is a decision about WHERE YOU STAND, not about where the ball
      // has got to. Gating the jump on the ball already being within 2.2 m of
      // the net and 3.2 m of the player meant that pressing while the opponent
      // was still setting — which is exactly when a blocker goes up — did
      // nothing at all, and the block "often didn't jump when you pressed".
      // Stand at the net with the opponent in possession, press, and you jump.
      const blocking =
        this.possession !== p.side && Math.abs(p.pos.y) < 2.4 && !this.serveInFlight
        && teamCanBlock(this.team(p.side), p);
      const canCall =
        blocking || (attacking && !canReach(p, this.ball) && this.ball.pos.z > 1.9 && distXY(p.pos, this.ball.pos) < 3.2);
      if (
        cmd.actionPressed &&
        humanSteered &&
        !p.airborne &&
        p.canAct &&
        this.phase === 'rally' &&
        canCall
      ) {
        p.jump();
        if (blocking) {
          p.setAnim('block');
          this.reportBlockAttempt(p);
          this.callBlockMate(p);
        }
      }

      // On the ground the jump button jumps; in the air it calls for a Lethal
      // Maneuver, which is only honoured if the team's gauge is full.
      if (cmd.jumpPressed) {
        if (p.airborne) {
          if (this.team(p.side).powerReady) p.specialArmed = true;
        } else if (p.jump()) {
          // A defensive jump at the net is a block and must read as one —
          // both arms straight up — not as a spike wind-up.  Use the same
          // readable manual-block window as the action button: from the player's
          // point of view, pressing jump at the tape must not be stricter than
          // pressing action at the tape.
          if (this.phase === 'rally' && blocking) {
            p.setAnim('block');
            this.reportBlockAttempt(p);
            this.callBlockMate(p);
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
      if (this.phase === 'serve') continue;
      const ps = this.team(side).players;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          if (a.airborne || b.airborne || a.diving || b.diving) continue;
          const aRecovering = a.downTime > 0 || a.gettingUp > 0 || a.landingPlant || plantedContact(a);
          const bRecovering = b.downTime > 0 || b.gettingUp > 0 || b.landingPlant || plantedContact(b);
          if (aRecovering && bRecovering) continue;
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          // Physical bodies may not overlap. Screen-space overlap is occlusion,
          // not a collision: pushing a double block apart along court depth
          // destroyed the wall and kept settled formations sliding forever.
          const d = Math.hypot(dx, dy);
          const MIN_GAP = 0.68;
          if (d >= MIN_GAP) continue;
          const push = ((MIN_GAP - d) / 2) * Math.min(1, dt * 14);
          const nx = d > 1e-4 ? dx / d : 1;
          const ny = d > 1e-4 ? dy / d : 0;
          // Planted hands/knees must not skate because a teammate walks past.
          // The standing teammate takes the separation; physical slide
          // momentum still belongs to Player.step.
          if (!aRecovering) { a.pos.x -= nx * push * (bRecovering ? 2 : 1); a.pos.y -= ny * push * (bRecovering ? 2 : 1); }
          if (!bRecovering) { b.pos.x += nx * push * (aRecovering ? 2 : 1); b.pos.y += ny * push * (aRecovering ? 2 : 1); }
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
        if (p.airborne || p.diving || p.downTime > 0 || p.gettingUp > 0) continue;
        // A prepared contact or unfinished landing owns the shoulders. Ball
        // tracking must not mirror that gesture before it has recovered.
        if (p.presentation.lockedFacing !== undefined) {
          p.facing = p.presentation.lockedFacing;
          continue;
        }
        // An assigned passer retreats while watching the incoming ball; he
        // does not turn his back for the final stride then mirror into bump.
        // The backwards gait is drawn separately from the forward run.
        if (p.presentation.sourceJob === 'receive' && this.lastToucherSide !== p.side) {
          p.facing = attackDir(p.side);
          continue;
        }
        // Keep watching the receiving side while our own serve flies past.
        // Ending this rule at release made the whole serving wall turn toward
        // its server, then turn back as the ball crossed the net.
        if (p.id !== this.team(this.servingSide).server.id
            && (this.phase === 'serve' || (this.serveInFlight && p.side === this.servingSide))) {
          p.facing = attackDir(p.side);
          continue;
        }
        if (keepsNetReadyPosture(p.presentation, p.locomotionIntent)) {
          p.facing = attackDir(p.side);
          continue;
        }
        // A player running somewhere normally faces the way they are going.
        // Not in defence: while the ball is on the far side of the net you
        // watch it, whatever your feet are doing — shuffling into position
        // with your back to the attack is the one thing no defender ever does,
        // and a back line half of whom were facing the end line read as six
        // people who had lost interest in the rally.
        const defending = this.ball.pos.y * attackDir(p.side) > 0.5;
        if (!defending && Math.hypot(p.vel.x, p.vel.y) > 1.4) continue;

        const dy = this.ball.pos.y - p.pos.y;
        if (Math.abs(dy) > 0.25) p.facing = Math.sign(dy);
      }
    }

    switch (this.phase) {
      case 'serve':
        this.stepServe(commands, dt);
        break;
      case 'rally':
        this.checkServeObstruction();
        this.stepRally(commands, dt);
        break;
      case 'dead':
        this.stepDead(dt);
        break;
      case 'setBreak':
        if (this.phaseTimer > SET_BREAK_SECONDS) {
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
  /**
   * Keep the server in the service zone.
   *
   * The rules put the server behind the end line until the ball is struck, and
   * without enforcing it a player could simply walk to the net holding the
   * ball and serve from there — from where a served ball has nowhere sensible
   * to go and ends up back in their own court or in a team-mate.
   */
  private confineServer(server: Player): void {
    const dir = attackDir(this.servingSide);
    const line = COURT_HALF_LENGTH + 0.35;
    if (dir > 0) {
      if (server.pos.y > -line) {
        server.pos.y = -line;
        server.vel.y = Math.min(0, server.vel.y);
      }
    } else if (server.pos.y < line) {
      server.pos.y = line;
      server.vel.y = Math.max(0, server.vel.y);
    }
    server.pos.x = clamp(server.pos.x, -COURT_HALF_WIDTH + 0.3, COURT_HALF_WIDTH - 0.3);
  }

  private stepServe(commands: Map<number, Command>, dt: number): void {
    const team = this.team(this.servingSide);
    const server = team.server;
    const cmd = commands.get(server.id) ?? idleCommand();
    this.confineServer(server);
    const humanServer = this.humanDrivenIds.has(server.id);

    // The release first plays the short tossing gesture with the ball still
    // in hand. Only its end releases physics and licenses the run-up.
    if (this.serveStage === 'windup') {
      server.vel.x = 0;
      server.vel.y = 0;
      this.serveWindupSeconds += dt;
      if (this.serveWindupSeconds >= 0.14) this.launchServeToss(server, humanServer);
      return;
    }

    // The computer may serve on the whistle; a human serve must never fire
    // because the player merely stood ready. The rejected build looked like
    // the serve animation started as soon as the server reached their spot,
    // and this timeout was the hidden auto-start path.
    if (!humanServer && this.phaseTimer > 8) {
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
      if (!humanServer) {
        server.setAnim('serve_toss');
      } else if (!cmd.actionHeld && !cmd.actionPressed && this.serveHold <= 0) {
        server.setAnim('ready');
      }

      // Two serves, one button, told apart by how long it is held:
      //   tap  -> toss the ball up and go for the overhand or jump serve
      //   hold -> an underarm serve whose power is the charge, hit on release
      // The charge itself is accumulated by the main step loop, which also
      // parks it in `releasedCharge` on the frame the button comes up — so
      // that, not `heldAction`, is what tells us a press has ended. Reading
      // `heldAction` here saw the value already overwritten for this step, and
      // the release was never noticed at all: the ball never left the hand.
      if (cmd.actionHeld) {
        if (cmd.actionPressed) this.servePressSeen = true;
        this.serveHold += dt;
        if (humanServer && this.serveHold < 0.16) server.setAnim('serve_toss');
        // A human serve charge is now stationary. The player complained about
        // exactly the old behaviour: while the ball was still frozen in hand,
        // the server backed away automatically before the toss. The run-up is
        // still automatic, but it starts only after the ball has been thrown.
        if (humanServer && this.serveHold >= 0.16) {
          server.vel.x = 0;
          server.vel.y = 0;
          server.setAnim('ready');
        }
        return;
      }
      // A press that begins and ends within a single step — which is what the
      // AI issues, and what a very quick human tap looks like — never sets
      // `actionHeld` at all. Without this branch the AI could not toss, and
      // every computer serve waited out the eight-second whistle instead.
      if (humanServer && this.serveHold > 0 && !this.servePressSeen && !cmd.actionPressed) {
        this.serveHold = 0;
        server.charge = 0;
        server.releasedCharge = 0;
        server.setAnim('ready');
        return;
      }
      if (this.serveHold > 0 || cmd.actionPressed) {
        if (cmd.actionPressed) this.servePressSeen = true;
        const held = this.serveHold;
        this.serveWindupHoldSeconds = held;
        this.serveHold = 0;
        this.servePressSeen = false;
        server.releasedCharge = 0;
        server.charge = 0;
        server.actionBuffer = 0;
        // How long the button was down IS the power. A flick is a safe float
        // served off the floor; a full hold is a loaded jump serve. Either way
        // the ball goes up and has to be met — the load only decides how much
        // there is to spend.
        this.serveCharge = clamp(held / UNDERARM_HOLD, 0, 1);
        server.plansJumpServe = server.plansJumpServe || this.serveCharge > 0.4;
        server.vel.x = 0;
        server.vel.y = 0;
        server.setAnim('serve_toss');
        this.serveStage = 'windup';
        this.serveWindupSeconds = 0;
        this.serveStrikeQueued = false;
      }
      return;
    }

    // Ball in the air. The short delay stops the toss press itself from
    // doubling as the hit; requiring the ball to have stopped rising keeps the
    // contact at the top of the arc, where a serve is actually struck.
    // A press that arrives before the window opens is held, not thrown away,
    // so mistiming the swing by a fraction still produces a serve.
    if (cmd.actionPressed || server.actionBuffer > 0) this.serveStrikeQueued = true;
    const aiServePrepared = humanServer || !server.plansJumpServe || server.height >= 0.55;
    if (this.serveStrikeQueued && this.serveStrikeReady && aiServePrepared) {
      // Both halves of the serve, multiplied: what was loaded before the toss,
      // and how well the ball was met. Loading without meeting it produces
      // nothing, and a perfect strike on an unloaded serve is a tidy float.
      const timing = clamp((this.ball.pos.z - 1.8) / 1.3, 0, 1);
      this.strikeServe(server, cmd, clamp(0.25 + 0.75 * this.serveCharge, 0, 1) * (0.45 + 0.55 * timing));
      return;
    }

    // The approach jump is the game's, not the player's: one press tosses,
    // one press hits, and the footwork happens on its own.
    // Only a loaded serve gets an approach jump. A soft one is played off the
    // floor, which is what a float serve is, and it means the choice you made
    // holding the button is visible before the ball is even struck.
    const humanJumpServe =
      this.humanDrivenIds.has(server.id) &&
      server.plansJumpServe &&
      this.serveCharge > 0.4;
    if (humanJumpServe && !server.airborne && server.canAct) {
      const dir = attackDir(this.servingSide);
      const plantSpot = -dir * (COURT_HALF_LENGTH + 0.35);
      const arrived = dir > 0 ? server.pos.y >= plantSpot - SERVE_PLANT_TOLERANCE
        : server.pos.y <= plantSpot + SERVE_PLANT_TOLERANCE;
      const elapsed = this.phaseTimer - this.tossedAt;
      const planting = server.presentation.phase === 'plant';
      if (!planting && (arrived || elapsed > SERVE_RUNUP_CAP)) {
        // Plant where the running body actually arrived. Snapping through
        // the final tolerance (or from the timeout position) skipped physical
        // travel and made the last approach drawing visibly jump forward.
        server.vel.y = 0;
        server.cancelApproach();
        server.setAnim('plant');
      } else if (planting && server.presentation.startedAt >= 0.12) {
        server.jump();
      } else if (!planting) {
        server.licenseApproach('serve', 0.75);
        server.vel.y = approach(server.vel.y, dir * server.runSpeed, 30 * dt);
        server.setAnim('approach_run');
      }
    } else if (
      this.serveCharge > 0.4 &&
      !server.plansJumpServe &&
      !server.airborne &&
      server.canAct &&
      this.phaseTimer - this.tossedAt > SERVE_APPROACH
    ) {
      server.jump();
    }
    if (server.airborne && Math.abs(server.vel.y) < 0.2) {
      server.vel.y = attackDir(this.servingSide) * 1.0;
    }

    // Dropped toss: catch it and go again, no fault.
    if (this.ball.vel.z < 0 && this.ball.pos.z < 0.95) {
      this.serveStage = 'hold';
      this.serveStrikeQueued = false;
      // Return to one coherent held state on this step, not a frame later.
      // A missed loaded toss must not preselect/run the next soft serve.
      this.ball.frozen = true;
      this.ball.grounded = false;
      this.ball.pos = v3(server.pos.x, server.pos.y + attackDir(this.servingSide) * 0.3, 1.3 + server.height);
      this.ball.vel = v3();
      this.ball.spin = v3();
      server.charge = 0;
      server.releasedCharge = 0;
      server.actionBuffer = 0;
      server.plansJumpServe = false;
      server.cancelApproach();
      if (!server.airborne) {
        server.vel.x = 0;
        server.vel.y = 0;
        server.setAnim('ready');
      }
      this.serveHold = 0;
      this.servePressSeen = false;
    }
  }

  private launchServeToss(server: Player, humanServer: boolean): void {
    const jumping = server.plansJumpServe;
    this.serveRunupStartY = server.pos.y;
    this.ball.frozen = false;
    if (jumping && humanServer) {
      server.licenseApproach('serve', 1.05);
      server.vel.y = attackDir(this.servingSide) * server.runSpeed * 0.88;
      server.setAnim('approach_run');
    }
    const forward = jumping ? TOSS_FORWARD_JUMP : TOSS_FORWARD;
    this.ball.vel = v3(0, attackDir(this.servingSide) * forward, TOSS_SPEED);
    this.ball.spin = v3();
    this.serveStage = 'toss';
    this.serveStrikeQueued = false;
    this.tossedAt = this.phaseTimer;
    if (!jumping) server.setAnim('serve_toss');
  }

  private strikeServe(server: Player, cmd: Command, charge: number): void {
    this.serveStrikeQueued = false;
    const perfect = this.humanDrivenIds.has(server.id) && cmd.actionPressed && this.serveStrikeReady;
    const res = performServe({
      player: server,
      ball: this.ball,
      aim: cmd.aim,
      rng: this.rng,
      charge: clamp(charge + (perfect ? 0.12 : 0), 0, 1),
      timingBonus: perfect ? 1 : 0,
      errorScale: this.errorScaleFor(server),
    });
    server.charge = 0;
    server.releasedCharge = 0;
    server.swing = 0.3;
    server.setAnim(server.airborne ? 'air_contact_jump_serve' : 'serve_contact');
    this.registerTouch(server, 'serve', res.speed, perfect ? { timing: 'perfect' } : {});
    if (perfect) this.awardPower(server.side, 10);
    this.serveInFlightFlag = true;
    this.aimTarget = res.target;
    this.phase = 'rally';
    this.phaseTimer = 0;
  }

  private callBlockMate(caller: Player): void {
    const mate = this.team(caller.side)
      .frontRow()
      .filter((m) => m.id !== caller.id && !m.airborne && m.canAct)
      .filter((m) => Math.abs(m.pos.x - caller.pos.x) < 3.35 && Math.abs(m.pos.y) < 3.0)
      .sort((a, b) => Math.abs(a.pos.x - caller.pos.x) - Math.abs(b.pos.x - caller.pos.x))[0];
    if (!mate) return;
    // The manual block call is a team action. If the closest front-row mate is
    // already at the tape and inside one blocking lane, close the seam while
    // leaving the floor instead of jumping straight up as an unrelated single.
    const desiredGap = mate.pos.x < caller.pos.x ? -0.75 : 0.75;
    const targetX = clamp(caller.pos.x + desiredGap, -COURT_HALF_WIDTH + 0.55, COURT_HALF_WIDTH - 0.55);
    mate.vel.x = approach(mate.vel.x, targetX - mate.pos.x, 0.85);
    mate.vel.y = approach(mate.vel.y, caller.pos.y - mate.pos.y, 0.65);
    if (mate.jump()) {
      mate.setAnim('block');
      this.reportBlockAttempt(mate);
    }
  }

  /**
   * A serve that hits one of your own players is a fault.
   *
   * The serving team may not touch the ball, so without this the served ball
   * simply passed through a team-mate standing in front of the server and
   * carried on over the net — a serve that visibly went through a body and was
   * scored as good.
   */
  private checkServeObstruction(): void {
    if (!this.serveInFlight || this.ball.grounded) return;
    // Only the serve's own outward flight counts. Testing "is anyone near the
    // ball while a serve is nominally in flight" fired all over the court in
    // the middle of rallies and turned nearly every point into a serve fault:
    // the ball has to still be on the serving side, heading away from the
    // server, and travelling at serve pace.
    const dir = attackDir(this.servingSide);
    const stillOurs = dir > 0 ? this.ball.pos.y < -0.4 : this.ball.pos.y > 0.4;
    const outbound = dir > 0 ? this.ball.vel.y > 4 : this.ball.vel.y < -4;
    if (!stillOurs || !outbound) return;

    for (const p of this.team(this.servingSide).players) {
      if (p.id === this.lastToucherId) continue;
      if (distXY(p.pos, this.ball.pos) > 0.56) continue;
      const low = p.height + 0.2;
      const high = p.height + PLAYER_REACH * 0.85;
      if (this.ball.pos.z < low || this.ball.pos.z > high) continue;
      this.awardPoint(otherSide(this.servingSide), 'serveFault');
      return;
    }
  }

  private stepRally(commands: Map<number, Command>, _dt: number): void {
    this.trackNetCrossing();
    this.resolveContacts(commands);
  }

  private stepDead(dt: number): void {
    void dt;
    // Let the point call breathe, then move the side-out winners clockwise to
    // their new zones. Previously Team.rotate() ran on the scoring frame and
    // setupServe() later teleported everybody to the result, so the rules were
    // correct in memory but no rotation ever happened in front of the player.
    if (this.pendingRotationSide && !this.rotationApplied && this.phaseTimer > 0.55) {
      const report = this.team(this.pendingRotationSide).rotate();
      this.rotationApplied = true;
      this.events.push({ type: 'rotation', side: this.pendingRotationSide });
      if (report.liberoChange) {
        this.events.push({
          type: 'liberoChange',
          side: this.pendingRotationSide,
          ...report.liberoChange,
        });
      }
    }
    if (this.phaseTimer > POINT_BREAK_SECONDS) {
      if (this.phase === 'dead') this.setupServe();
    }
  }

  // ------------------------------------------------------------------ contact

  private errorScaleFor(p: Player): number {
    const humanControlled = this.humanDrivenIds.has(p.id);
    if (humanControlled) return 0.75;
    const diff = this.config.difficulty ?? 1;
    const opponent = !this.isHumanControlled(p.side);
    // Higher difficulty makes the opponent cleaner and the AI teammates sloppier
    // only in the sense that the player is expected to carry more of the load.
    // The opponent gets sharper with difficulty, but ARCADE is meant to be
    // enjoyable rather than punishing.
    return opponent ? 1.4 - diff * 0.3 : 1.0;
  }

  private skillAction(kind: ContactKind): SkillAction {
    if (kind === 'block' || kind === 'set') return kind;
    return kind === 'spike' || kind === 'power' || kind === 'tip' ? 'attack' : 'defense';
  }

  private canPlay(p: Player): boolean {
    const team = this.team(p.side);
    const activation = team.peekSkill(this.skillAction(this.classifyContact(p, team)));
    return canReach(p, this.ball, activation?.effects.reachMultiplier ?? 1);
  }

  private activateSkill(p: Player, kind: ContactKind): void {
    // Super moves already spend their own gauge; do not also consume an
    // ability whose precision/power modifier that bespoke trajectory ignores.
    if (kind === 'power' || kind === 'tip' && this.team(p.side).config.skillId === 'meteor') return;
    const activation = this.team(p.side).useSkill(this.skillAction(kind));
    if (activation) this.events.push({ type: 'skill', side: p.side, skillId: activation.id,
      name: activation.name, at: copy(this.ball.pos) });
  }

  private resolveContacts(commands: Map<number, Command>): void {
    if (this.ball.grounded || this.ball.frozen) return;
    // A serve toss belongs to the server and nobody else. Without this a
    // team-mate standing near the server could pluck the ball out of the toss
    // and put it over the net — a serve that was never served.
    if (this.phase === 'serve') return;

    let best: { player: Player; quality: number } | null = null;
    for (const p of this.allPlayers()) {
      // A fast spike reaches the wall before the striker's .12 s cooldown
      // expires. Protect repeat swings, not the opponent's legal block.
      if (this.ball.touchCooldown > 0 && this.classifyContact(p, this.team(p.side)) !== 'block') continue;
      if (!this.canPlay(p)) continue;
      // A dig or a pass is played off the floor. Nobody bumps a ball in
      // mid-air: the shot needs a platform and a base under it, and a player
      // floating past one looked like the ball was being swatted rather than
      // received. Attacking, setting and blocking are unaffected — those are
      // exactly the contacts you leave the ground for.
      if (p.airborne && !p.diving && this.groundedTouchOnly(p)) continue;
      // You may not play the ball on the other side of the net. Only a block
      // may meet it over the tape. Reaching across scooped balls out of the
      // opponent's court, and because the ball never changed hands it also
      // handed a team a fourth touch it should never have had.
      if (this.ball.pos.y * attackDir(p.side) > 0.05 && this.classifyContact(p, this.team(p.side)) !== 'block') {
        continue;
      }
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
    const perfect = this.humanDrivenIds.has(p.id) && (this.timingInputs.get(p.id) ?? 0) > 0;
    const activation = team.peekSkill(this.skillAction(kind));
    const plan = kind === 'set' && !this.humanDrivenIds.has(p.id) ? this.brains[p.side].setPlanFor(p.id) : undefined;
    // How hard the ball was travelling *into* this contact. Digging a rocket is
    // worth far more gauge than passing a floater.
    const incoming = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
    const charge = clamp(p.charge, 0, 1);

    const ctx: StrikeContext = {
      player: p,
      ball: this.ball,
      aim: cmd.aim,
      rng: this.rng,
      charge,
      errorScale: this.errorScaleFor(p),
      setterTarget: team.setterTarget(),
      attackerTarget: plan?.target,
      setPlay: plan?.play,
      timingBonus: perfect ? 1 : 0,
      modifiers: activation?.effects,
    };

    let speed = 0;
    let registeredKind: ContactKind = kind;
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
          const r = performPowerMove({ ...ctx, special: true, modifiers: undefined });
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
          this.activateSkill(p, 'power');
          this.registerTouch(p, 'power', speed, perfect ? { timing: 'perfect' } : {});
          this.rewardPlay(p.side, 'power', incoming);
          if (perfect) this.awardPower(p.side, 12);
          p.charge = 0;
          this.aimTarget = target;
          return;
        }
        const r = performAttack(ctx);
        speed = r.speed;
        target = r.target;
        registeredKind = r.kind;
        break;
      }
      default: {
        const r = performBump(ctx);
        speed = r.speed;
        target = r.target;
        registeredKind = r.kind;
        break;
      }
    }

    p.charge = 0;
    this.aimTarget = target;
    this.activateSkill(p, registeredKind);
    this.registerTouch(p, registeredKind, speed, { timing: perfect ? 'perfect' : undefined, setPlay: plan?.play });
    this.rewardPlay(p.side, registeredKind, incoming);
    if (perfect) this.awardPower(p.side, 12);
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
    this.team(side).addSkillCharge(5);
    let gain = 0;
    if (kind === 'save') gain = POWER_GAIN.save;
    else if (kind === 'block') gain = POWER_GAIN.block;
    else if (kind === 'bump' && incoming > 18) gain = POWER_GAIN.dig;
    if (gain > 0) this.awardPower(side, gain);
  }

  private awardPower(side: Side, amount: number): void {
    this.team(side).addSkillCharge(amount * 0.5);
    if (this.team(side).addPower(amount)) {
      this.events.push({ type: 'powerReady', side });
    }
  }

  /** Decide what kind of contact this is from the game situation. */
  /**
   * True when this contact would be a pass or a dig, which has to be made with
   * both feet on the floor.
   */
  private groundedTouchOnly(p: Player): boolean {
    const kind = this.classifyContact(p, this.team(p.side));
    return kind === 'bump';
  }

  private classifyContact(p: Player, team: Team): ContactKind {
    const nearNet = Math.abs(this.ball.pos.y) < 1.1;
    const high = this.ball.pos.z > NET_HEIGHT - 0.1;

    // A wall can meet an attack just BEFORE or AFTER it crosses the tape.
    // The old opponent-half-only check reclassified a legal block as a bump
    // as soon as the ball crossed, then rejected it for being airborne.
    const incoming = this.ball.vel.y * attackDir(p.side) < 0;
    if (nearNet && high && p.airborne && p.presentation.action === 'block'
      && team.isFrontRow(p) && p.role !== 'libero' && Math.abs(p.pos.y) < 1.3
      && this.lastToucherSide !== p.side && incoming && !this.serveInFlight) return 'block';

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
   * Record that a player committed to a block and left the floor.
   *
   * Kept separate from `blockContact` on purpose: the previous build had no way
   * to tell "the defence read the set and put a block up" from "the ball
   * happened to touch someone's hands", so the visual QA faked a block by
   * assigning the pose and the height directly. With both events the harness
   * can wait for a real one.
   */
  reportBlockAttempt(p: Player): void {
    this.events.push({
      type: 'blockAttempt',
      side: p.side,
      playerId: p.id,
      height: p.height,
    });
  }

  private registerTouch(p: Player, kind: ContactKind, speed: number,
    feedback: { timing?: 'perfect'; setPlay?: SetPlay } = {}): void {
    p.actionBuffer = 0;
    this.timingInputs.delete(p.id);
    this.timingGrace.delete(p.id);
    // Crossing the net does not turn a serve into a rally attack. It remains
    // un-blockable until the receiving team has actually played it.
    if (kind !== 'serve' && p.side !== this.servingSide) this.serveInFlightFlag = false;
    this.events.push({
      type: 'contact',
      kind,
      side: p.side,
      playerId: p.id,
      speed,
      at: copy(this.ball.pos),
      facing: p.facing,
      ...(kind === 'set' ? { backSet: this.ball.vel.y * p.facing < -.1 } : {}),
      airborne: p.airborne,
      height: p.height,
      ...feedback,
    });

    if (kind === 'block') {
      this.events.push({
        type: 'blockContact',
        side: p.side,
        playerId: p.id,
        height: p.height,
        airborne: p.airborne,
      });
    }

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
    const scored = rallyAwardsPoint(side, this.servingSide, this.format);
    if (scored) team.points += 1;
    this.events.push({ type: 'point', side, reason, rallyLength: this.rallyTime, scored });

    // Celebrate. Every point is worth something, so somebody always reacts:
    // the three players nearest the ball on an ordinary point, the whole team
    // on a kill or a long rally. Keying this off the last toucher alone meant
    // most points — the ones won by an opponent's error — passed in silence.
    const big = reason === 'kill' || this.rallyTime > 6;
    const nearest = team.players
      .slice()
      .sort((a, b) => distXY(a.pos, this.ball.pos) - distXY(b.pos, this.ball.pos));
    const celebrating = big ? nearest : nearest.slice(0, 3);
    for (const p of celebrating) p.celebrate(big ? 1.0 : 0.65);

    if (reason === 'kill') this.awardPower(side, POWER_GAIN.kill);
    // A small consolation to the side that just conceded: a losing run should
    // trend towards having a Lethal Maneuver available, not away from it.
    this.awardPower(otherSide(side), POWER_GAIN.conceded);

    if (this.servingSide !== side) {
      this.servingSide = side;
      this.pendingRotationSide = side;
      this.rotationApplied = false;
      this.events.push({ type: 'sideout', side });
    }

    this.phase = 'dead';
    this.phaseTimer = 0;

    const opponent = this.team(otherSide(side));
    if (scored && isMatchSetWon(team.points, opponent.points, this.setNumber, this.format)) {
      team.setsWon += 1;
      team.setScores.push(team.points);
      opponent.setScores.push(opponent.points);
      this.events.push({ type: 'setWon', side, setNumber: this.setNumber });
      for (const p of team.players) p.celebrate(1.4);
      if (team.setsWon >= this.setsNeeded) {
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
      if (current.airborne || current.diving || current.downTime > 0 || current.gettingUp > 0) continue;
      if (this.phase === 'serve') {
        team.activeId = team.server.id;
        continue;
      }
      if (this.phase !== 'rally') continue;

      // When the opponent is building an attack above the tape, the next
      // playable action for the human is usually a block, not a dig. The
      // generic "who can play the next ball" selector tended to stay on a
      // back-row defender or on whoever was nearest the falling prediction, so
      // pressing jump at the net felt dead: the command was going to the wrong
      // body. Hand control to the front-row blocker closest to the lane before
      // the player presses.
      const blockThreat =
        this.possession !== side &&
        !this.serveInFlight &&
        this.ball.pos.z > NET_HEIGHT - 0.15 &&
        Math.abs(this.ball.pos.y) < 3.2;
      if (blockThreat) {
        let blockerId = team.activeId;
        let blockerScore = Infinity;
        for (const p of team.frontRow()) {
          if (p.downTime > 0 || p.diving || !p.canAct) continue;
          const lane = Math.abs(p.pos.x - this.ball.pos.x);
          const tape = Math.max(0, Math.abs(p.pos.y) - 2.4);
          const score = lane + tape * 1.4 - (p.id === team.activeId ? 0.2 : 0);
          if (score < blockerScore) {
            blockerScore = score;
            blockerId = p.id;
          }
        }
        team.activeId = blockerId;
        continue;
      }

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
    return this.playCueFor('home');
  }

  playCueFor(side: Side): { time: number; ready: boolean } | null {
    const team = this.isHumanControlled(side) ? this.team(side) : null;
    if (!team) return null;
    if (this.phase !== 'rally') return null;
    if (this.ball.grounded || this.ball.frozen) return null;
    const p = team.active;
    if (!p.canAct) return null;
    if (p.id === this.lastToucherId && !this.lastTouchWasBlock) return null;
    if (this.possession === p.side && this.touches >= MAX_TOUCHES) return null;
    if (this.serveInFlight && p.side === this.servingSide) return null;
    if (this.ball.pos.y * attackDir(side) > 0.05 && this.classifyContact(p, team) !== 'block') return null;

    if (this.canPlay(p)) return { time: 0, ready: true };
    // Where the ball will be at hand height for this player.
    const target = p.height + PLAYER_REACH * 0.6;
    if (this.ball.pos.z < target && this.ball.vel.z <= 0) return null;
    const pred = predictLanding(this.ball, target, 2.5);
    if (!pred.valid) return null;
    return { time: pred.time, ready: false };
  }

  /**
   * The events drained on the most recent frame.
   *
   * Kept so an observer can see what just happened without consuming it. The
   * visual QA needs to know that a real block or a real spike contact occurred
   * on this exact frame; reading `events` directly would steal them from the
   * renderer, and the alternative — inferring it by assigning poses — is the
   * thing that made the previous evidence worthless.
   */
  lastEvents: GameEvent[] = [];

  /** Monotonic counter over every event ever emitted. */
  eventSeq = 0;
  /**
   * A short history of emitted events, newest last.
   *
   * `lastEvents` only survives one frame, which is a race for any observer:
   * a contact emitted on one frame is gone by the time the next one is
   * examined. The window is what an observer actually needs — "has this
   * happened since I started watching?" — so it is kept explicitly, with a
   * sequence number to answer that question exactly.
   */
  recentEvents: { seq: number; event: GameEvent }[] = [];

  /** Drain accumulated events; the presentation layer calls this once a frame. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.lastEvents = out;
    for (const event of out) this.recentEvents.push({ seq: ++this.eventSeq, event });
    if (this.recentEvents.length > 128) {
      this.recentEvents.splice(0, this.recentEvents.length - 128);
    }
    this.events = [];
    return out;
  }

  /** Human-readable score line, handy for tests and the HUD. */
  scoreLine(): string {
    return `${this.home.config.shortName} ${this.home.points}-${this.away.points} ${this.away.config.shortName} (sets ${this.home.setsWon}-${this.away.setsWon}, to ${this.pointsToWinSet})`;
  }
}

function teamCanBlock(team: Team, p: Player): boolean {
  return p.role !== 'libero' && team.frontRow().some(player => player.id === p.id);
}

function plantedContact(p: Player): boolean {
  const action = p.presentation.action;
  if (p.airborne || p.diving || (action !== 'set' && action !== 'bump')) return false;
  if (p.presentation.phase === 'prepare') return Math.hypot(p.vel.x, p.vel.y) < 0.1;
  return p.presentation.phase === 'contact'
    && p.animTime < (action === 'set' ? SET_GROUND_RECOVERY_TIME : BUMP_GROUND_RECOVERY_TIME);
}
