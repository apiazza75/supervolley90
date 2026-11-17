import { predictLanding } from './ball';
import { Aim, canReach } from './contact';
import { Vec3, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  ATTACK_LINE,
  FIXED_DT,
  GRAVITY,
  DIVE_EXTENSION_TIME,
  NET_HEIGHT,
  PLAYER_REACH,
  POINT_BREAK_SECONDS,
  Side,
  UNDERARM_HOLD,
  attackDir,
  otherSide,
} from './rules';
import { attackFormation, clearAttackLanding, defenceFormation, legalSpot, servePassers } from './tactics';
import { Team } from './team';
import type { Command, World } from './world';
import { canPlantForReceive, canPlantForGroundContact } from './receive-plant';
import { BLOCK_PREPARATION_TIME, BUMP_GROUND_RECOVERY_TIME, SET_GROUND_RECOVERY_TIME } from './presentation';
import { settledSteering, walkingResetSteering, resetAdjustmentSteering } from './settled-steering';
import { SetPlan, SetPlay, copySetPlan, setTargetFor } from './set-play';

type Job = 'idle' | 'receive' | 'set' | 'attack' | 'block' | 'cover' | 'serve';

/**
 * How long before contact a hitter is allowed to be running their approach.
 *
 * This is the whole budget for the run-up, and it is deliberately short. It is
 * the value that decides how much of a match is spent watching people sprint:
 * the previous build had no window at all, so every player ran all the time.
 */
const APPROACH_WINDOW = 1.25;

/** Latest the jump server may plant, measured from the start of the run-up. */
const PLANT_DEADLINE = 0.72;

/**
 * How long the body is planted before it leaves the floor, in seconds.
 *
 * The gather between the last step and the take-off. Without it the run cycle
 * cut straight to mid-air and the pose the sheets draw for it was never shown.
 */
const PLANT_LEAD = 0.14;

/**
 * A block has to read as a reaction to the set, not a coin flip and not a
 * teleport. The lead blocker takes one readable beat to process the cue; the
 * second blocker syncs almost immediately once the lead goes.
 */
const BLOCK_LEAD_READ_DELAY = 0.032;

/**
 * How much room a player insists on having, in metres.
 *
 * Chosen by measurement, not by eye: it is the smallest value at which two
 * team-mates practically stop drawing on top of each other (screen overlap
 * falls from 6.9% of the time to 1.4%) without the team spreading so far that
 * it stops finishing rallies — wider still, at 1.95 m, and the kill rate drops
 * by a fifth.
 */
const PERSONAL_SPACE = 1.7;

interface Brainstate {
  job: Job;
  blockPreparing?: boolean;
  /** Countdown before the player is allowed to react to a new situation. */
  reactionDelay: number;
  /** One read per attack: countdown from the visual cue to the block jump. */
  blockReadDelay: number;
  /** Where this player is heading. */
  goal: Vec3;
  /** Whether the player intends to swing at the ball on contact. */
  wantsAction: boolean;
  /** Charge intent: how long to hold before striking. */
  holdAction: boolean;
  aim: Aim;
  /** Serve timing: when this server tosses the ball. */
  serveHold: number;
  /** Whether this serve is a jump serve. */
  powerServe: boolean;
  /** Phase time at which the jump-serve run-up began; 0 until it does. */
  serveRunUpAt: number;
  /** Request a Lethal Maneuver on this step. */
  armSpecial: boolean;
  /** Committed to moving towards the goal (hysteresis against goal jitter). */
  enRoute: boolean;
  /** Off-ball movement remains stopped across insignificant steering noise. */
  adjusting: boolean;
}

const newState = (): Brainstate => ({
  job: 'idle',
  reactionDelay: 0,
  blockReadDelay: -1,
  goal: v3(),
  wantsAction: false,
  holdAction: false,
  aim: { x: 0, depth: 0.4 },
  serveHold: 0,
  powerServe: false,
  serveRunUpAt: 0,
  armSpecial: false,
  enRoute: false,
  adjusting: false,
});

/**
 * One brain per team. It assigns a job to each of the six players every step
 * and turns those jobs into `Command`s. Difficulty scales reaction latency,
 * positioning slack and aim quality rather than raw physical stats, so a hard
 * opponent feels sharper instead of simply faster.
 */
export class TeamBrain {
  private readonly world: World;
  private readonly team: Team;
  private readonly difficulty: number;
  private readonly states = new Map<number, Brainstate>();
  private readonly rng: Rng;
  private suppressedId = -1;
  /** Recomputed on assignment; who this team wants to hit the third ball. */
  private designatedAttacker = -1;
  private designatedReceiver = -1;
  private designatedSetter = -1;
  /** Where this team has decided to run its attack, chosen once per possession. */
  private plannedAttack: Vec3 = v3();
  private setPlan: SetPlan | null = null;
  private readonly playRng: Rng;
  private playBag: SetPlay[] = [];
  private hasPlannedPlay = false;
  private decoyJumped = false;
  private attackAim: Aim | null = null;
  private readAirborneBlock = false;
  /** Read the set once for coverage; the hitter's feet are behind ball contact. */
  private coverLanding: Vec3 | null = null;
  /** Touch count seen on the previous step, to detect possession transitions. */
  private lastSeenTouches = -1;
  private lastSeenPossession: Side | null = null;
  /**
   * The defensive read, frozen until the situation genuinely changes.
   *
   * The threat estimate wobbles every step — an opponent leaves the floor, the
   * set prediction refines, the ball drifts — and re-deriving the block pair
   * and every lean from the live value re-shuffled half the team about once a
   * second. A real defence reads the attack ONCE and adjusts only when the
   * ball actually goes somewhere else.
   */
  private readX = 0;
  private blockPair: number[] = [];
  private wasDefending = false;
  /** Current team mode, held until the other one has been true for a beat. */
  private mode: 'offence' | 'defence' = 'defence';
  private modeTimer = 0;

  constructor(world: World, team: Team, difficulty: number) {
    this.world = world;
    this.team = team;
    this.difficulty = clamp(difficulty, 0, 2);
    this.rng = world.rng;
    // Tactical variety has its own deterministic stream, so shuffling a play
    // does not perturb the serve/error random draws of unrelated teammates.
    this.playRng = new Rng(world.rng.snapshot() ^ (team.side === 'home' ? 0x51e7 : 0xbac5));
    for (const p of team.players) this.states.set(p.id, newState());
  }

  suppress(id: number): void {
    this.suppressedId = id;
  }

  /** World passes this committed target and tempo into the actual set contact. */
  setPlanFor(playerId: number): SetPlan | undefined {
    if (!this.setPlan || playerId === this.suppressedId) return undefined;
    const player = this.team.get(playerId);
    if (!player || this.stateOf(player).job !== 'set') return undefined;
    return copySetPlan(this.setPlan);
  }

  /** Latency floor in seconds; better players and higher difficulty react sooner. */
  private latency(p: Player): number {
    const skill = p.stats.reaction * 0.6 + this.difficulty * 0.2;
    return clamp(0.34 - skill * 0.3, 0.04, 0.34);
  }

  /**
   * Replace a goal only when the new one is meaningfully elsewhere.
   *
   * Tactical spots are functions of the ball and of team-mates, so they
   * tremble continuously, and a goal that trembles keeps its player endlessly
   * in motion. A cover or block assignment does not need centimetre tracking:
   * the spot moves when the situation moves, by more than a stride.
   */
  private sticky(s: Brainstate, next: Vec3, threshold = 0.7): void {
    const dx = next.x - s.goal.x;
    const dy = next.y - s.goal.y;
    if (dx * dx + dy * dy > threshold * threshold) s.goal = copy(next);
  }

  /** Positional sloppiness in metres. */
  private slack(p: Player): number {
    return clamp(0.9 - this.difficulty * 0.3 - p.stats.control * 0.4, 0.12, 0.9);
  }

  think(dt: number): void {
    for (const s of this.states.values()) {
      s.blockPreparing = false;
      if (s.reactionDelay > 0) s.reactionDelay -= dt;
      if (s.blockReadDelay > 0) s.blockReadDelay = Math.max(0, s.blockReadDelay - dt);
    }
    this.assignJobs();
    for (const p of this.team.players) {
      const preparing = this.stateOf(p).blockPreparing && p.height === 0 && p.vertVel === 0;
      p.blockPreparationAge = preparing ? (p.blockPreparationAge === undefined ? 0 : p.blockPreparationAge + dt) : undefined;
    }
    this.playAnythingInReach();
  }

  /**
   * Last-resort rule: a player who can physically touch the ball, and is
   * allowed to, plays it — whatever job they were given.
   *
   * Jobs are assigned from a prediction made a moment earlier, so a ball that
   * ends up somewhere else leaves a player standing inside arm's reach of it
   * doing nothing while it lands. Nobody plays volleyball that way.
   */
  private playAnythingInReach(): void {
    const w = this.world;
    if (w.phase !== 'rally' || w.ball.grounded || w.ball.frozen) return;
    if (w.serveInFlight && w.servingSide === this.team.side) return;
    const touches = w.possession === this.team.side ? w.touches : 0;
    const contactJob = touches === 0 ? 'receive' : touches === 1 ? 'set' : 'attack';
    const owner = this.team.players.find(p => this.stateOf(p).job === contactJob);
    const landing = predictLanding(w.ball);
    const ownerCanArrive = owner && owner.downTime <= 0 && owner.gettingUp <= 0
      && (owner.id !== w.lastToucherId || w.lastTouchWasBlock)
      && (canReach(owner, w.ball) || landing.valid && landing.time > .12
        && distXY(owner.pos, landing.point) <= owner.runSpeed * landing.time * .9 + .7);
    for (const p of this.team.players) {
      if (p.id === this.suppressedId) continue;
      if (p.id === this.setPlan?.decoyId && p.airborne && touches <= 2) continue;
      if (p.id === w.lastToucherId && !w.lastTouchWasBlock) continue;
      if (w.possession === p.side && w.touches >= 3) continue;
      if (!canReach(p, w.ball)) continue;
      const s = this.stateOf(p);
      // Cover is not another receiver/setter. A first-row teammate used to
      // intercept an otherwise playable serve just because it passed nearby.
      // Yield to the named owner; take over only for an actual emergency.
      if (ownerCanArrive && owner?.id !== p.id && s.job !== 'block') continue;
      s.wantsAction = true;
      s.holdAction = false;
    }
  }

  // --------------------------------------------------------------- assignment

  private assignJobs(): void {
    const w = this.world;
    const side = this.team.side;
    const dir = attackDir(side);
    const ballOnMySide = dir > 0 ? w.ball.pos.y < 0 : w.ball.pos.y > 0;
    const incoming = dir > 0 ? w.ball.vel.y < 0 : w.ball.vel.y > 0;

    if (w.phase === 'serve') {
      this.assignServe();
      return;
    }
    if (w.phase !== 'rally') {
      for (const p of this.team.players) {
        const s = this.stateOf(p);
        s.job = 'idle';
        s.wantsAction = false;
        s.holdAction = false;
        // Between rallies the serve plan is torn up, so the next one is chosen
        // afresh. Holding it meant a server who kept the ball kept whatever
        // they rolled the first time: over a match only a handful of distinct
        // decisions were ever made.
        s.serveHold = 0;
        s.serveRunUpAt = 0;
        p.plansJumpServe = false;
        // Someone celebrating stays where they are: jogging back to a
        // formation spot cancels the celebration the moment it starts.
        s.goal = p.cheerTime > 0 ? copy(p.pos) : copy(p.home);
      }
      return;
    }

    // The serving team cannot play its own serve. Previously its possession
    // and the ball still being behind the net briefly activated our offence,
    // so teammates chased the server's ball before turning back to defend.
    if (w.serveInFlight) {
      this.modeTimer = 0;
      if (w.servingSide === side) { this.mode = 'defence'; this.assignBaseDefense(); }
      else { this.mode = 'offence'; this.assignOffense(); }
      return;
    }
    if (w.possession === side && w.touches >= 3 && !w.lastTouchWasBlock) {
      this.mode = 'defence'; this.modeTimer = 0; this.assignBaseDefense(); return;
    }

    const mine = w.possession === side && ballOnMySide;

    // Debounce the offence/defence decision. Read raw, it flickers every time
    // the ball hovers near the net — nine formation flips per rally, each one
    // re-goaling all six players, which is most of what made the teams look
    // possessed. A whole team does not change shape on a millisecond: the new
    // situation has to hold for a fifth of a second before anyone commits.
    const want: 'offence' | 'defence' = mine || (ballOnMySide && incoming) ? 'offence' : 'defence';
    if (want === this.mode) {
      this.modeTimer = 0;
    } else {
      this.modeTimer += FIXED_DT;
      if (this.modeTimer > 0.2) {
        this.mode = want;
        this.modeTimer = 0;
      }
    }

    if (this.mode === 'offence') {
      this.assignOffense();
    } else {
      this.assignDefense();
    }
  }

  private assignServe(): void {
    const server = this.team.server;
    const serving = this.world.servingSide === this.team.side;
    const passers = this.passers();
    this.lastSeenTouches = -1;
    this.lastSeenPossession = null;
    this.designatedSetter = -1;
    this.coverLanding = null;
    this.setPlan = null;
    this.decoyJumped = false;
    this.wasDefending = false;
    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;
      if (serving && p.id === server.id) {
        s.job = 'serve';
        // The human owns the serve plan as well as the button. Letting the AI
        // continue through this branch while its command was suppressed still
        // rewrote `plansJumpServe` every simulation step, cancelling a loaded
        // human run-up immediately after the toss.
        if (p.id === this.suppressedId) {
          s.goal = copy(p.pos);
          continue;
        }
        // Plan the serve once: toss time, target, and whether to go up for it.
        if (s.serveHold <= 0) {
          s.powerServe = this.rng.chance(0.18 + this.difficulty * 0.12);
          // A jump serve needs time to walk back and settle before the toss.
          s.serveHold = s.powerServe ? this.rng.range(0.9, 1.35) : this.rng.range(0.5, 1.2);
          s.aim = {
            x: this.rng.range(-0.8, 0.8),
            depth: this.rng.chance(0.25) ? this.rng.range(-0.5, 0) : this.rng.range(0.4, 0.95),
          };
        }

        p.plansJumpServe = s.powerServe;
        const t = this.world.phaseTimer;
        const ball = this.world.ball;
        // The run-up is a real journey across the floor after the toss. The
        // old code either moved before the ball left the hands or kept the
        // server pinned and simply made them jump, so the sheet mimed a run
        // nobody ran.
        const serveDir = attackDir(this.team.side);
        const baseline = -serveDir * COURT_HALF_LENGTH;
        const plantSpot = baseline - serveDir * 0.35;

        if (ball.frozen && s.powerServe) {
          // No pre-toss footwork. The server is already placed deep enough for
          // a run-up; the charge happens still, then release throws the ball
          // and the approach begins.
          s.goal = copy(p.pos);
          const chargeStart = Math.max(0.18, s.serveHold - UNDERARM_HOLD * 1.08);
          if (t >= chargeStart && t <= s.serveHold) {
            s.holdAction = true;
            s.wantsAction = false;
          } else if (t > s.serveHold) {
            s.holdAction = false;
            s.wantsAction = true;
            if (s.serveRunUpAt <= 0) s.serveRunUpAt = t;
          }
        } else if (ball.frozen) {
          // Ball still in hand: a press now is the toss.
          s.goal = copy(p.pos);
          s.wantsAction = t > s.serveHold;
        } else if (s.powerServe) {
          // Toss is up: finish the approach, plant, and leave the floor.
          s.serveRunUpAt = t - this.world.serveTossElapsed;
          s.goal = v3(p.pos.x, plantSpot, 0);
          const arrived =
            serveDir > 0 ? p.pos.y >= plantSpot - 0.28 : p.pos.y <= plantSpot + 0.28;
          if (!p.airborne && p.canAct) {
            p.licenseApproach('serve', 0.9);
            // Plant once the ground is covered. The fallback deadline is set by
            // the jump itself — the body needs its rise time in hand or the
            // contact happens on the way down, off the floor but too low.
            const planting = arrived || t > s.serveRunUpAt + PLANT_DEADLINE;
            if (planting && p.anim !== 'plant') {
              // Same as the spike: gather first, then go up.
              p.setAnim('plant');
              p.cancelApproach();
            } else if (planting && p.presentation.startedAt >= PLANT_LEAD) {
              p.jump();
            }
          }
          const reachTop = p.height + PLAYER_REACH + (p.airborne ? 0.3 : 0.1);
          s.wantsAction = ball.vel.z < 1.0 && ball.pos.z <= reachTop && ball.pos.z > 1.6;
        } else {
          s.goal = copy(p.pos);
          const reachTop = p.height + PLAYER_REACH + 0.1;
          s.wantsAction = ball.vel.z < 1.0 && ball.pos.z <= reachTop && ball.pos.z > 1.6;
        }
      } else {
        s.job = serving ? this.team.isFrontRow(p) ? 'block' : 'cover'
          : passers.includes(p.id) ? 'receive' : p.role === 'setter' ? 'set' : 'cover';
        s.serveHold = 0;
        s.serveRunUpAt = 0;
        // setupServe has already placed the legal pre-serve formation. Stay
        // there through the toss; switching/penetration starts on the hit.
        s.enRoute = false;
        s.goal = copy(p.pos);
      }
    }
  }

  /** Keep a recovering defender out of the first-contact assignment. */
  private passers(): number[] {
    return servePassers(this.team.players).filter(id => {
      const p = this.team.get(id)!;
      return p.downTime <= 0 && p.gettingUp <= 0;
    });
  }

  /** Our side has the ball: pass, set, attack, everyone else covers. */
  private assignOffense(): void {
    this.wasDefending = false;
    const w = this.world;
    const dir = attackDir(this.team.side);
    const touches = w.possession === this.team.side ? w.touches : 0;

    // Plan the whole play the moment the ball comes our way, so the hitter can
    // start the approach run while the pass is still in the air.
    if (touches !== this.lastSeenTouches || this.lastSeenPossession !== w.possession) {
      if (touches <= 1) {
        this.designatedReceiver = this.pickReceiver();
        const newPossession = !this.setPlan || touches < this.lastSeenTouches
          || this.lastSeenTouches < 0;
        const planned = this.team.get(this.designatedAttacker);
        const needsHitter = !planned || planned.downTime > 0 || planned.gettingUp > 0
          || touches === 1 && planned.id === w.lastToucherId && !w.lastTouchWasBlock;
        if (newPossession || needsHitter) this.planSet(newPossession ? this.nextSetPlay() : this.setPlan!.play);
        this.coverLanding = null;
        this.designatedSetter = -1;
      }
      this.lastSeenTouches = touches;
      this.lastSeenPossession = w.possession;
    }

    // Contact height for a set-up attack: the top of the hitting window.
    const attackPred = predictLanding(w.ball, NET_HEIGHT + 0.85);
    const floorPred = predictLanding(w.ball);
    const readSet = touches >= 2 && this.coverLanding === null;
    if (readSet) {
      const contact = attackPred.valid ? attackPred.point : this.plannedAttack;
      this.coverLanding = v3(contact.x, contact.y - dir * 0.3, 0);
    }
    const landing = this.coverLanding ?? v3(this.plannedAttack.x, this.plannedAttack.y - dir * 0.3, 0);
    // Who takes the second and third balls. Both fall back to whoever can
    // actually get there: the designated player is a preference, not a
    // promise, because the ball does not always go where the plan assumed.
    const setterId = this.committedSetter(floorPred);
    const attackerId =
      touches >= 2
        ? this.pickAttackerHandler(attackPred.valid ? attackPred : floorPred)
        : this.designatedAttacker;
    const formation = attackFormation(this.team.players, attackerId, this.plannedAttack.x, touches);

    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;
      s.armSpecial = false;

      const isAttacker = p.id === attackerId;

      if (touches === 0 && p.id === this.designatedReceiver) {
        s.job = 'receive';
        p.cancelApproach();
        s.goal = floorPred.valid ? copy(floorPred.point) : copy(w.ball.pos);
        s.goal.z = 0;
        this.driveReceive(p, s, floorPred.valid ? floorPred.time : 0.4);
      } else if (touches === 0 && p.role === 'setter') {
        // Release the setter into the passing target as soon as reception is
        // assigned. Treating them as attack cover sent them backwards, away
        // from their own pass, and forced an outside hitter to improvise sets.
        s.job = 'set';
        p.cancelApproach();
        s.goal = this.team.setterTarget();
        s.goal.z = 0;
      } else if (touches === 1 && p.id === setterId) {
        s.job = 'set';
        p.cancelApproach();
        s.goal = floorPred.valid ? copy(floorPred.point) : copy(w.ball.pos);
        s.goal.z = 0;
        this.driveSet(s);
      } else if (touches >= 2 && isAttacker) {
        s.job = 'attack';
        // Stand a step behind the contact point so the swing goes forwards.
        const target = attackPred.valid ? copy(attackPred.point) : copy(w.ball.pos);
        s.goal = v3(target.x, target.y - dir * 0.3, 0);
        this.driveAttack(p, s, attackPred.valid ? attackPred.time : 0.5);
      } else if (isAttacker) {
        // Approach run: wait behind the planned contact point.
        s.job = 'attack';
        const runUp = this.setPlan?.play === 'quick' ? .85 : this.setPlan?.play === 'pipe' ? 1.8 : 2.3;
        s.goal = v3(this.plannedAttack.x, this.plannedAttack.y - dir * runUp, 0);
      } else if (p.id === this.setPlan?.decoyId && touches <= 2 && !this.decoyJumped) {
        // Sell a quick with a real, legal front-row jump. The decoy never asks
        // for contact: the opposite remains the only owner of the third ball.
        s.job = 'cover';
        s.goal = v3(0, -dir * 1.9, 0);
        const setArrival = predictLanding(w.ball, PLAYER_REACH + .15);
        if (p.id !== this.suppressedId && touches === 1 && setArrival.valid && setArrival.time < .26
          && distXY(p.pos, s.goal) < 1.25 && p.canAct && !p.airborne) {
          p.cancelApproach();
          this.decoyJumped = p.jump();
        }
      } else {
        s.job = 'cover';
        p.cancelApproach();
        // Prepare around the planned route, then read the delivered set ONCE.
        // Cover clears the hitter's feet, not just the ball's contact point.
        // Following the live airborne body would drag the entire formation.
        const frontOfPipe = this.setPlan?.play === 'pipe' && this.team.isFrontRow(p) && p.role !== 'setter';
        const cover = frontOfPipe ? formation.get(p.id)! : clearAttackLanding(p.side, formation.get(p.id)!, landing);
        // A newly delivered set is a real phase change, not prediction noise.
        // The normal .7m deadband must not discard its clearance correction.
        this.sticky(s, cover, readSet ? 0 : 0.7);
      }
    }
  }

  private committedSetter(pred: { valid: boolean; point: Vec3; time: number }): number {
    const current = this.team.get(this.designatedSetter);
    const target = pred.valid ? pred.point : this.world.ball.pos;
    if (current && current.downTime <= 0 && current.gettingUp <= 0
      && (current.id !== this.world.lastToucherId || this.world.lastTouchWasBlock)
      && distXY(current.pos, target) <= current.runSpeed * Math.max(0.1, pred.time) + 1.4) return current.id;
    this.designatedSetter = this.pickBallHandler(pred, p => p.role === 'setter' ? 2.2 : 0);
    return this.designatedSetter;
  }

  /** Three front players ready at the net, three distinct back-row zones. */
  private assignBaseDefense(): void {
    const formation = defenceFormation(this.team.players);
    const w = this.world;
    const incoming = w.phase === 'rally' && w.lastToucherSide !== this.team.side
      && w.ball.vel.y * attackDir(this.team.side) < 0;
    this.wasDefending = false;
    for (const p of this.team.players) {
      const s = this.stateOf(p);
      // Crossing the net resets possession before the formation debounce
      // finishes. Do not recall the already prepared receiver to base defence
      // during that gap: his platform would reopen immediately before impact.
      // Preserve only the single assigned, physically reachable ground dig.
      if (incoming && p.id === this.designatedReceiver
        && p.presentation.action === 'bump' && p.presentation.phase === 'prepare'
        && canPlantForReceive(p, w.ball)) {
        const arrival = predictLanding(w.ball);
        s.job = 'receive';
        s.armSpecial = false;
        p.cancelApproach();
        s.goal = copy(arrival.valid ? arrival.point : p.pos);
        s.goal.z = 0;
        this.driveReceive(p, s, arrival.valid ? arrival.time : .3);
        continue;
      }
      s.job = this.team.isFrontRow(p) ? 'block' : 'cover';
      s.wantsAction = false; s.holdAction = false; s.armSpecial = false;
      p.cancelApproach();
      this.sticky(s, formation.get(p.id)!, 0.35);
    }
  }

  /**
   * Who plays the second ball.
   *
   * The setter takes it whenever they can, which is the whole point of having
   * one. But a setter who just made the pass may not touch the ball again, and
   * a setter stranded on the far side of the court will not arrive: in both
   * cases the job used to go unassigned and the pass simply hit the floor —
   * about forty rallies a match ended that way. Real teams do the obvious
   * thing instead: whoever can get there sets.
   */
  private pickBallHandler(
    pred: { valid: boolean; point: Vec3; time: number },
    prefer: (p: Player) => number,
  ): number {
    const w = this.world;
    const goal = pred.valid ? pred.point : w.ball.pos;
    const time = pred.valid ? pred.time : 0.4;

    let bestId = -1;
    let bestScore = Infinity;
    for (const p of this.team.players) {
      if (p.downTime > 0 || p.gettingUp > 0) continue;
      // Ineligible: a player may not touch the ball twice in a row.
      if (p.id === w.lastToucherId && !w.lastTouchWasBlock) continue;
      const reach = p.runSpeed * Math.max(0.1, time) + 1.1;
      const gap = distXY(p.pos, goal);
      const score = gap - prefer(p) + (gap > reach ? 8 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestId = p.id;
      }
    }
    return bestId;
  }

  /**
   * Who actually attacks the third ball.
   *
   * Attack assignment is intentionally narrower than generic ball handling:
   * one hitter owns the play, while the other front-row players cover. Falling
   * back is allowed only when the chosen hitter clearly cannot arrive.
   */
  private pickAttackerHandler(pred: { valid: boolean; point: Vec3; time: number }): number {
    const target = pred.valid ? pred.point : this.world.ball.pos;
    const time = pred.valid ? Math.max(0.12, pred.time) : 0.45;
    const preferred = this.team.get(this.designatedAttacker);
    const preferredEligible =
      preferred &&
      preferred.downTime <= 0 &&
      preferred.gettingUp <= 0 &&
      (preferred.id !== this.world.lastToucherId || this.world.lastTouchWasBlock);
    if (preferredEligible) {
      const reach = preferred.runSpeed * time + 1.35;
      if (distXY(preferred.pos, target) <= reach) return preferred.id;
    }

    const front = this.team.frontRow().filter((p) => p.role !== 'setter' && p.role !== 'libero' && p.downTime <= 0 && p.gettingUp <= 0);
    let bestId = preferredEligible ? preferred.id : -1;
    let best = Infinity;
    for (const p of front.length ? front : this.team.players) {
      if (p.downTime > 0 || p.gettingUp > 0 || (p.id === this.world.lastToucherId && !this.world.lastTouchWasBlock)) continue;
      const gap = distXY(p.pos, target);
      const late = gap > p.runSpeed * time + 1.15 ? 5 : 0;
      const score = gap + late + (p.id === this.designatedAttacker ? -1.4 : 0);
      if (score < best) {
        best = score;
        bestId = p.id;
      }
    }
    return bestId;
  }

  /** Opponent has the ball: block at the net, dig behind it. */
  private assignDefense(): void {
    const w = this.world;
    const dir = attackDir(this.team.side);
    const opponent = w.team(otherSide(this.team.side));
    // Read an actual set before closing a double block. The pass/serve does
    // not yet identify an attack lane; all three front players hold base.
    if (w.possession !== opponent.side || w.touches < 2 || w.serveInFlight) {
      this.assignBaseDefense(); return;
    }
    const floorPred = predictLanding(w.ball);
    const ballComing = dir > 0 ? w.ball.vel.y < -0.5 : w.ball.vel.y > 0.5;

    // Where the attack is coming from.
    //
    // Reading this off an opponent who is ALREADY in the air is far too late:
    // by the time a hitter jumps there is no time left for a second blocker to
    // travel across the court, which is why 61% of attacks used to be met by
    // nobody at all and the rest by one player. A block is set up on the SET —
    // the moment the ball goes up on their side, the front row goes with it.
    const threat = opponent.players.find((o) => o.airborne && Math.abs(o.pos.y) < 4);
    // Failing an airborne hitter, follow whoever on their side is closest to
    // the ball and in front of it; failing that, the ball itself.
    const chaser = opponent.players
      .filter((o) => Math.abs(o.pos.y) < 5)
      .sort((a, b) => distXY(a.pos, w.ball.pos) - distXY(b.pos, w.ball.pos))[0];
    //
    // The best read available is where the ball will BE when it drops to
    // hitting height — which is what a blocker actually watches, and which
    // stops being a moving target the instant the set leaves the setter's
    // hands. Following the live ball instead had the block shuffling sideways
    // for the whole of the opponent's build-up and settling nowhere.
    const setPred = predictLanding(w.ball, NET_HEIGHT + 0.85);
    const readX = threat
      ? threat.pos.x
      : setPred.valid && setPred.time < 1.6
        ? setPred.point.x
        : chaser && distXY(chaser.pos, w.ball.pos) < 3.5
          ? (chaser.pos.x + w.ball.pos.x) / 2
          : w.ball.pos.x;
    const blockX = clamp(readX, -COURT_HALF_WIDTH + 0.6, COURT_HALF_WIDTH - 0.6);

    // Commit to a read. Re-read only on entering defence or when the threat
    // has moved by more than a body's width — not every step.
    const candidatePair = this.team
      .frontRow()
      .filter((p) => p.id !== this.suppressedId && p.role !== 'libero'
        && p.downTime <= 0 && p.gettingUp <= 0 && !p.diving)
      .slice()
      .sort((a, b) => Math.abs(a.pos.x - blockX) - Math.abs(b.pos.x - blockX))
      .slice(0, 2);
    const candidateScore = candidatePair.reduce((sum, p) => sum + Math.abs(p.pos.x - blockX), 0);
    const currentScore = this.blockPair
      .map((id) => this.team.get(id))
      .reduce((sum, p) => sum + (p ? Math.abs(p.pos.x - blockX) : 4), 0);
    const invalidPair = this.blockPair.some(id => {
      const p = this.team.get(id);
      return !p || id === this.suppressedId || !this.team.isFrontRow(p)
        || p.role === 'libero' || p.downTime > 0 || p.gettingUp > 0 || p.diving;
    });
    if (!this.wasDefending || invalidPair || Math.abs(blockX - this.readX) > 0.65 || candidateScore + 1.15 < currentScore) {
      this.readX = blockX;
      this.blockPair = candidatePair.map((b) => b.id);
    }
    this.wasDefending = true;
    const steadyX = this.readX;
    const blockers = this.blockPair
      .map((id) => this.team.get(id))
      .filter((b): b is Player => Boolean(b));

    // One receiver per incoming ball. Re-picking every step handed the job
    // back and forth between two players as the landing estimate refined, and
    // both of them ran for it.
    if (!ballComing) {
      this.designatedReceiver = -1;
    } else if (
      this.designatedReceiver < 0 ||
      !this.team.get(this.designatedReceiver) ||
      (floorPred.valid &&
        distXY(this.team.get(this.designatedReceiver)!.pos, floorPred.point) >
          distXY(this.team.get(this.pickReceiver())?.pos ?? floorPred.point, floorPred.point) + 1.4)
    ) {
      this.designatedReceiver = this.pickReceiver();
    }
    const receiverId = this.designatedReceiver;
    const formation = defenceFormation(this.team.players, steadyX, this.blockPair);

    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;

      // Two front-row players commit to the block for the whole of the
      // opponent's build-up, not just once the ball reaches the net. Waiting
      // until it did meant the second blocker never arrived.
      const blockIndex = blockers.indexOf(p);
      if (blockIndex >= 0) {
        s.job = 'block';
        p.cancelApproach();
        const offset = blockIndex === 0 ? 0 : steadyX > 0 ? -0.85 : 0.85;
        this.sticky(s, v3(clamp(steadyX + offset, -3.9, 3.9), -dir * 0.72, 0), 0.45);
        this.driveBlock(
          p,
          s,
          threat,
          blockIndex,
          blockers[0],
          blockers.find((b) => b.id !== p.id),
        );
        continue;
      }

      if (p.id === receiverId && floorPred.valid) {
        s.job = 'receive';
        p.cancelApproach();
        s.goal = copy(floorPred.point);
        s.goal.z = 0;
        this.driveReceive(p, s, floorPred.time);
        continue;
      }

      s.job = 'cover';
      p.cancelApproach();
      // Always the deep shape: flipping depth on a live speed estimate marched
      // the whole back line up and down a metre at a time.
      this.sticky(s, legalSpot(p.side, formation.get(p.id)!));
    }
  }

  // ------------------------------------------------------------- job drivers

  private driveReceive(p: Player, s: Brainstate, timeToLand: number): void {
    const w = this.world;
    const gap = distXY(p.pos, s.goal);
    // Decide while there is still time to extend after pushing off. Spending
    // the last .09 s on a standing pursuit starts a dive only when an instant
    // contact could save it, skipping the whole visible take-off sequence.
    const pursuitTime = Math.max(0, timeToLand - DIVE_EXTENSION_TIME);
    const reachable = gap < p.runSpeed * pursuitTime + 0.9;

    // A ball that will drop out of reach is worth a dive.
    //
    // The old gate rolled a 13% chance every step, but only inside a window
    // that lasted a handful of steps, so a defender who could ONLY save the
    // ball by going to the floor usually just watched it land — and the dive,
    // the single most spectacular thing in the sport, showed up about once and
    // a half a rally. A ball that is genuinely unreachable standing up is not
    // a coin toss: you go, and how far you commit is what varies.
    const desperate = !reachable && gap < 4.6 && timeToLand < 0.85;
    if (desperate && !p.airborne && p.canAct && p.height <= 0.02) {
      const worthIt = gap > p.runSpeed * pursuitTime + 0.35;
      if (worthIt && this.rng.chance(0.55 + this.difficulty * 0.2)) {
        p.dive(s.goal.x - p.pos.x, s.goal.y - p.pos.y);
      }
    }

    s.wantsAction = true;
    // Hold briefly so the pass is not a limp tap, but never long enough to
    // turn a first-ball dig into a swing.
    s.holdAction = timeToLand < 0.35;
    const setter = this.team.setterTarget();
    s.aim = { x: setter.x / COURT_HALF_WIDTH, depth: -0.6 };
    void w;
  }

  private driveSet(s: Brainstate): void {
    s.wantsAction = true;
    s.holdAction = false;
    // `performSet` maps aim.x across the net and aim.depth to distance from it.
    const x = clamp(this.plannedAttack.x / (COURT_HALF_WIDTH - 0.9), -1, 1);
    const dist = Math.abs(this.plannedAttack.y);
    const depth = clamp(1 - ((dist - 1.1) / 1.3) * 2, -1, 1);
    s.aim = { x, depth };
  }

  private driveAttack(p: Player, s: Brainstate, timeToContact: number): void {
    const w = this.world;
    const gap = distXY(p.pos, s.goal);
    // Time to reach the peak of the jump, from the same gravity the player
    // integrates with — hardcoding the old constant here once made every AI
    // spike jump early when the gravity changed.
    const rise = p.jumpVelocity / (Math.abs(GRAVITY) * 1.15);
    // Jump when the ball will arrive as we peak, and only if we are close
    // enough that the swing will actually connect.
    const legalTakeoff = this.team.isFrontRow(p) || -attackDir(p.side) * p.pos.y > ATTACK_LINE + .08;
    const inPosition = legalTakeoff && (gap < 1.4 || gap < p.runSpeed * timeToContact * 0.6);

    // Licence the run-up, and only the run-up. The window opens when the set is
    // close enough that the hitter commits, and only if there is ground left to
    // cover — a hitter already standing under the ball plants, they do not
    // sprint on the spot. Everything outside this window is ordinary movement.
    if (!p.airborne && timeToContact < APPROACH_WINDOW && gap > 0.55) {
      p.licenseApproach('attack', Math.min(APPROACH_WINDOW, timeToContact + 0.2),
        timeToContact - rise - PLANT_LEAD);
    }

    // Plant, THEN leave the floor. Setting the plant pose on the same step as
    // the jump meant `jump()` overwrote it before it was ever drawn, so the
    // load-up the brief asks for did not exist: the run cycle cut straight to
    // mid-air. The feet arrive a beat early and the body gathers.
    if (!p.airborne && p.canAct && inPosition && timeToContact <= rise + PLANT_LEAD) {
      if (p.anim === 'approach_run' || p.anim === 'run' || p.anim === 'shuffle') {
        p.setAnim('plant');
        p.cancelApproach();
      }
    }
    if (!p.airborne && p.canAct && inPosition && timeToContact <= rise + 0.04) {
      p.cancelApproach();
      p.jump();
    }

    s.wantsAction = true;
    // Start charging early so the swing lands with real power.
    s.holdAction = timeToContact < 0.7;

    // Spend a full gauge once airborne. Hold it back at low difficulty so a
    // Lethal Maneuver still feels like an event rather than every third point.
    if (p.airborne && !p.specialArmed && this.team.powerReady) {
      s.armSpecial = this.rng.chance(0.35 + this.difficulty * 0.3);
    }

    // Aim away from the block, and away from where the defence is standing.
    const opponent = w.team(otherSide(this.team.side));
    // Choose a shot, then read the wall once at takeoff. Re-rolling both axes
    // 120 times per second made the intended target tremble while an otherwise
    // settled hitter waited for contact, and never represented a real choice.
    if (!this.attackAim || p.airborne && !this.readAirborneBlock) {
      const blockers = opponent.players.filter((o) => o.airborne && Math.abs(o.pos.y) < 1.6);
      let aimX = this.playRng.range(-0.72, 0.72);
      if (blockers.length) {
        const avgBlock = blockers.reduce((a, o) => a + o.pos.x, 0) / blockers.length;
        aimX = clamp((avgBlock > 0 ? -0.68 : 0.68) + this.playRng.spread(0.2), -0.85, 0.85);
      }
      const smart = 0.35 + this.difficulty * 0.3;
      const tipIt = this.playRng.chance(0.08 * smart);
      this.attackAim = { x: aimX, depth: tipIt ? -0.7 : this.playRng.range(0.15, 0.86) };
      if (p.airborne) this.readAirborneBlock = true;
    }
    s.aim = this.attackAim;
    if (s.aim.depth < -.6) s.holdAction = false;
  }

  private driveBlock(
    p: Player,
    s: Brainstate,
    threat: Player | undefined,
    blockIndex: number,
    lead: Player | undefined,
    partner: Player | undefined,
  ): void {
    const w = this.world;

    // Two independent triggers, because a block that only answers a jumping
    // hitter never goes up against a fast set, a tip, or anything the AI
    // reaches without leaving the floor.
    //
    //  1. A hitter is in the air and has reached the top of their jump.
    //  2. The ball is arriving at the net at hitting height regardless.
    // The cue is the BALL entering the hitting window, not the hitter leaving
    // the floor. Any opponent in the air within four metres of the net counted
    // as a threat, including a setter jumping to set, so blockers went up on
    // the set, peaked, and were back on the floor by the time the spike came:
    // 61% of attacks met nobody in the air. A block leaves the ground when the
    // ball drops into the strike zone above the tape, which is a fixed moment
    // before the swing however the attack was built.
    const ball = w.ball;
    const dir = attackDir(this.team.side);
    // On THEIR side of the net — the attack is still being built. Waiting for
    // the ball to travel towards us means waiting until after the swing, which
    // is exactly one jump too late.
    const theirSide = ball.pos.y * dir > 0;
    // Blocking a serve is a fault, so the block simply stays down for one.
    if (w.serveInFlight) {
      s.wantsAction = false;
      s.holdAction = false;
      return;
    }
    const timeToHeight = (target: number): number => {
      const a = 0.5 * GRAVITY;
      const b = ball.vel.z;
      const c = ball.pos.z - target;
      const d = b * b - 4 * a * c;
      if (d < 0) return Infinity;
      const root = Math.sqrt(d);
      const t1 = (-b - root) / (2 * a);
      const t2 = (-b + root) / (2 * a);
      return [t1, t2].filter((t) => t > 0).sort((a, b) => a - b)[0] ?? Infinity;
    };
    const timeToStrikeWindow = timeToHeight(NET_HEIGHT + 0.85);
    const strikeZone =
      theirSide &&
      Math.abs(ball.pos.y) < 3.7 &&
      ball.pos.z > NET_HEIGHT + 0.35 &&
      ball.pos.z < NET_HEIGHT + 2.45 &&
      ball.vel.z < 2.4 &&
      timeToStrikeWindow < 0.82;

    // The second blocker is placed a shoulder off the ball on purpose, so it
    // must be judged against its own spot rather than against the hitter —
    // measuring it against the hitter is what kept it on the floor.
    const reference = threat ? threat.pos.x : ball.pos.x;
    // Preserve the established RNG stream for unrelated attack/defence choices.
    // Older builds spent one draw here every frame; changing that consumption
    // silently rewrote whole seeded matches even though block timing no longer
    // uses the random value.
    void this.rng.range(0, 1);
    // The outside blocker goes with the middle. A double block is two people
    // leaving the floor together — judged apart, the second one waited for its
    // own read, arrived a beat late and stayed down, which is why a block was
    // almost always a single.
    // The partner goes with the lead blocker for the whole of the lead's rise,
    // not only while it is still going up: judged against `vertVel > -1` the
    // window was a couple of frames wide, so the second man missed it more
    // often than not and the block stayed a single.
    const withLead =
      blockIndex > 0 &&
      lead !== undefined &&
      (lead.presentation.action === 'block' || (lead.airborne && lead.height > 0.1));
    const partnerNear =
      partner !== undefined &&
      !partner.airborne &&
      partner.canAct &&
      partner.downTime <= 0 &&
      partner.gettingUp <= 0 &&
      !partner.diving &&
      Math.abs(partner.pos.x - p.pos.x) < 4.5 &&
      Math.abs(partner.pos.y) < 2.8;
    const aligned =
      blockIndex === 0
        ? Math.abs(p.pos.x - reference) < 1.8
        : withLead
          ? Math.abs(p.pos.x - lead.pos.x) < 4.0 || Math.abs(p.pos.x - reference) < 4.2
          : Math.abs(p.pos.x - reference) < 3.4;
    const cue = strikeZone || withLead;
    const readableBlockWindow =
      cue ||
      (s.blockReadDelay >= 0 &&
        theirSide &&
        Math.abs(ball.pos.y) < 3.55 &&
        ball.pos.z > NET_HEIGHT + 0.2 &&
        ball.pos.z < NET_HEIGHT + 2.45 &&
        ball.vel.z < 2.6);

    // Read the attack once and react after a player-specific delay. Rolling a
    // new random chance on every simulation frame made the wall leave the
    // floor at an arbitrary moment even when the set and hitter were identical.
    // The partner keys off the lead and therefore needs only a short sync beat.
    if (!readableBlockWindow) {
      s.blockReadDelay = -1;
    } else if (withLead) {
      // Once the lead is in the air this is no longer an individual read: the
      // partner closes the wall now, otherwise the "double" block forms after
      // contact and reads as two unrelated jumps.
      s.blockReadDelay = 0;
    } else if (s.blockReadDelay < 0) {
      s.blockReadDelay = BLOCK_LEAD_READ_DELAY;
    }

    // Mirroring the lead blocker is not a decision to be dithered over: when
    // the middle goes, the outside goes, without waiting on its own dice roll.
    // The two unselected front-row teammates read and jump together. Only the
    // controlled player keeps a manual jump; suppressing the entire human
    // team here was why its automatic wall never supported that player.
    const controlled = p.id === this.suppressedId;
    // Begin the grounded gather before the existing jump cue. This predicts
    // only the short approach of the ball to that same window; it neither
    // delays takeoff nor tells the partner that a jump has already happened.
    const ahead = BLOCK_PREPARATION_TIME;
    const futureY = ball.pos.y + ball.vel.y * ahead;
    const futureZ = ball.pos.z + ball.vel.z * ahead + .5 * GRAVITY * ahead * ahead;
    const approachingWindow = futureY * dir > 0 && Math.abs(futureY) < 3.7
      && futureZ > NET_HEIGHT + .35 && futureZ < NET_HEIGHT + 2.45
      && ball.vel.z + GRAVITY * ahead < 2.4 && timeToStrikeWindow < .82 + ahead;
    s.blockPreparing = !controlled && p.height === 0 && p.vertVel === 0 && p.canAct
      && p.presentation.action === 'none' && !p.diving && Math.abs(p.pos.y) < 2
      && Math.hypot(p.vel.x, p.vel.y) < 2.4
      && (aligned || (partnerNear && Math.abs(partner!.pos.x - reference) < (blockIndex === 0 ? 3.4 : 1.8)))
      && (readableBlockWindow || approachingWindow);
    const reactionReady = s.reactionDelay <= 0 || withLead || (blockIndex === 0 && partnerNear && strikeZone);
    if (!controlled && !p.airborne && p.canAct && Math.abs(p.pos.y) < 1.35
      && readableBlockWindow && aligned && s.blockReadDelay <= 0) {
      if (reactionReady && this.jumpForBlock(p)) {
        this.syncBlockMate(p, partner);
        s.reactionDelay = this.latency(p);
        s.blockReadDelay = -1;
      }
    }
    s.wantsAction = p.airborne || Math.abs(w.ball.pos.y) < 1.4;
    s.holdAction = false;
  }

  private syncBlockMate(lead: Player, explicitMate?: Player): void {
    const pairedId = this.blockPair.find((id) => id !== lead.id);
    const mate = explicitMate ?? (pairedId ? this.team.get(pairedId) : undefined);
    if (!mate || mate.id === this.suppressedId || !this.team.isFrontRow(mate) || mate.role === 'libero') return;
    if (mate.airborne || !mate.canAct || mate.downTime > 0 || mate.diving) return;
    if (Math.abs(mate.pos.x - lead.pos.x) > 4.2 || Math.abs(mate.pos.y) > 1.35) return;
    if (this.jumpForBlock(mate)) {
      const state = this.stateOf(mate);
      state.job = 'block';
      state.blockReadDelay = -1;
      state.reactionDelay = this.latency(mate);
    }
  }

  private jumpForBlock(p: Player): boolean {
    if (p.id === this.suppressedId || !this.team.isFrontRow(p) || p.role === 'libero') return false;
    if (!p.jump()) return false;
    // A block is an extended vertical wall, not a spike approach. Give the
    // block-specific jump a little more hang so the two-player wall is still
    // present at attack contact instead of peaking between set and swing.
    p.vertVel *= 1.055;
    p.setAnim('block');
    this.world.reportBlockAttempt(p);
    return true;
  }

  // ------------------------------------------------------------- positioning

  private pickReceiver(): number {
    const pred = predictLanding(this.world.ball);
    const target = pred.valid ? pred.point : this.world.ball.pos;
    const receivingServe = this.world.serveInFlight && this.world.servingSide !== this.team.side;
    const passers = receivingServe ? this.passers() : [];
    // Let the reception unit own an ordinary serve. A non-passer can cover an
    // emergency short ball, but must not replace a reachable libero/outside.
    const reachablePasser = pred.valid && this.team.players.some(p => passers.includes(p.id)
      && distXY(p.pos, target) <= p.runSpeed * pred.time * .9 + .7);
    let bestId = -1;
    let best = Infinity;
    for (const p of this.team.players) {
      if (p.downTime > 0 || p.gettingUp > 0) continue;
      if (reachablePasser && !passers.includes(p.id)) continue;
      // Setters avoid taking the first ball when someone else can get there.
      const penalty = p.role === 'setter' ? 1.6 : 0;
      const d = distXY(p.pos, target) + penalty;
      if (d < best) {
        best = d;
        bestId = p.id;
      }
    }
    return bestId;
  }

  private pickAttacker(candidates?: Player[]): number {
    const front = candidates ?? this.team.frontRow().filter((p) => p.role !== 'setter'
      && p.role !== 'libero' && p.downTime <= 0 && p.gettingUp <= 0);
    if (!front.length) {
      const any = this.team.players.filter((p) => p.downTime <= 0 && p.gettingUp <= 0);
      return any.length ? any[0].id : this.team.players[0].id;
    }
    // Weight by power and jump, with a little variety so it is not predictable.
    let bestId = front[0].id;
    let best = -Infinity;
    for (const p of front) {
      const score = p.stats.power * 0.6 + p.stats.jump * 0.4 + this.rng.range(0, 0.45);
      if (score > best) {
        best = score;
        bestId = p.id;
      }
    }
    return bestId;
  }

  /** A shuffled bag prevents a long run of one set while retaining variation. */
  private nextSetPlay(): SetPlay {
    if (!this.hasPlannedPlay) { this.hasPlannedPlay = true; return 'high'; }
    if (!this.playBag.length) {
      this.playBag = ['high', 'quick', 'back', 'pipe', 'feint'];
      for (let i = this.playBag.length - 1; i > 0; i--) {
        const j = this.playRng.int(0, i + 1);
        [this.playBag[i], this.playBag[j]] = [this.playBag[j], this.playBag[i]];
      }
    }
    return this.playBag.pop()!;
  }

  private planSet(requested: SetPlay): void {
    const w = this.world;
    const eligible = this.team.players.filter(p => p.role !== 'setter' && p.role !== 'libero'
      && p.downTime <= 0 && p.gettingUp <= 0
      && (p.id !== w.lastToucherId || w.lastTouchWasBlock));
    const front = eligible.filter(p => this.team.isFrontRow(p));
    const back = eligible.filter(p => !this.team.isFrontRow(p));
    let play = requested;
    let candidates = play === 'pipe' ? back : front;
    if (play === 'quick') candidates = front.filter(p => p.role === 'middle');
    if (play === 'back' || play === 'feint') {
      const opposite = front.filter(p => p.role === 'opposite');
      candidates = opposite.length ? opposite : front.filter(p => p.role !== 'middle');
    }
    if (!candidates.length) { play = front.length ? 'high' : 'pipe'; candidates = front.length ? front : back; }
    const id = this.pickAttacker(candidates);
    const hitter = this.team.get(id)!;
    const decoy = play === 'feint' ? front.find(p => p.id !== id && p.role === 'middle') : undefined;
    if (play === 'feint' && !decoy) play = 'back';
    this.setPlan = { play, attackerId: id, target: setTargetFor(hitter, play), decoyId: decoy?.id };
    this.designatedAttacker = id;
    this.plannedAttack = copy(this.setPlan.target);
    this.decoyJumped = false;
    this.attackAim = null;
    this.readAirborneBlock = false;
  }



  // ---------------------------------------------------------------- commands

  private stateOf(p: Player): Brainstate {
    let s = this.states.get(p.id);
    if (!s) {
      s = newState();
      this.states.set(p.id, s);
    }
    return s;
  }

  /** Turn this player's job into concrete input for the current step. */
  commandFor(p: Player): Command {
    const s = this.stateOf(p);
    const cmd: Command = {
      moveX: 0,
      moveY: 0,
      actionPressed: false,
      actionHeld: false,
      // The AI jumps by calling Player.jump directly, so this flag carries only
      // the Lethal Maneuver request, which the world reads mid-air.
      jumpPressed: s.armSpecial,
      aim: s.aim,
    };
    // Expose the tactical owner of this body to render/QA. `sourceJob` used to
    // be written mainly when an approach was licensed, which proved that cover
    // players were not borrowing the spike run-up but did not prove the more
    // important volleyball invariant: only one hitter is assigned to the play.
    // Keeping it current lets the metrics detect the rejected "all attackers
    // go to the ball" behaviour as an actual frame-level failure.
    // The tactical job and unfinished gesture are separate axes. The action
    // keeps the set's planted recovery/locked shoulders while the next job is
    // already coverage. Copying "set" here until a later tick left stale ball
    // pursuit active exactly when Player.step released that physical lock.
    p.presentation.sourceJob = s.job;
    if (p.id === this.suppressedId) { s.adjusting = false; return cmd; }
    if (this.world.phase === 'serve' && p.id !== this.world.team(this.world.servingSide).server.id) {
      s.adjusting = false;
      return cmd;
    }

    const dx = s.goal.x - p.pos.x;
    const dy = s.goal.y - p.pos.y;
    const gap = Math.hypot(dx, dy);
    const tolerance = this.slack(p);

    // Hysteresis, because this single line is where "twelve possessed players
    // sprinting everywhere" came from. Tactical spots are recomputed every
    // step and every one of them trembles a little — with the ball, with the
    // attacker, with a team-mate's drift — so a player released to move the
    // instant the goal slipped past tolerance was ALWAYS moving. Measured over
    // a match, 57% of all players were running faster than 1.5 m/s at any
    // given instant, which is a stampede, not a formation.
    //
    // A real player commits: they move when they are clearly out of position,
    // keep moving until they have actually arrived, and otherwise stand and
    // watch the ball. Only whoever is playing the ball reacts to every twitch.
    const chasing = s.job === 'receive' || s.job === 'set'
      || (s.job === 'attack' && this.world.possession === p.side && this.world.touches >= 2)
      || (s.job === 'block' && this.world.possession !== p.side && this.world.touches >= 2 && !this.world.serveInFlight);
    const ownAttack = this.world.possession === p.side && this.world.touches >= 1 && this.setPlan !== null;
    const clearingAttack = s.job === 'cover' && ownAttack
      && !(p.id === this.setPlan?.decoyId && !this.decoyJumped)
      && distXY(p.pos, this.coverLanding ?? this.plannedAttack) < 2.4;
    if (!chasing && !clearingAttack) {
      if (!s.enRoute && gap > tolerance + 0.55) s.enRoute = true;
      if (s.enRoute && gap < tolerance * 0.8) s.enRoute = false;
    } else {
      s.enRoute = true;
    }
    if (s.enRoute && gap > 0.05) {
      // Off-the-ball movement is a positional adjustment, not a sprint. At
      // urgency 0.75 the whole court moved at running pace whenever a
      // formation shifted, which — measured — kept 60% of all twelve players
      // above 1.5 m/s at any instant. Capped at a trot, a transition reads as
      // a team settling into its shape rather than a stampede, and whoever is
      // actually playing the ball still goes flat out.
      // Brake continuously into a position. A minimum .35 command made a
      // player accelerate again at centimetres from goal on every correction.
      const urgency = chasing ? clamp(gap / 1.6, 0, 1)
        : clearingAttack ? clamp(gap / 2, 0, .64) : clamp(gap / 3.6, 0, 0.32);
      cmd.moveX = (dx / gap) * urgency;
      cmd.moveY = (dy / gap) * urgency;
    }

    // Personal space.
    //
    // Six players steering at tactical spots will still walk through each other
    // whenever two spots are close or two jobs briefly agree, and a team whose
    // bodies interpenetrate does not look like a team at any level of tactical
    // sophistication — it looks like a crowd. This is a plain separation term:
    // a push away from any team-mate inside a body's width, strongest when they
    // are nearly on top of each other, folded in on top of the steering.
    //
    // It is deliberately applied to the command rather than to the position,
    // so players are pushed apart by moving, not teleported apart.
    //
    // Whoever is going for the ball is exempt: they hold their line and
    // everybody else clears out of it. Pushing the passer off their own ball to
    // keep a tidy shape is how a team drops the pass and looks worse, not
    // better.
    const onTheBall = (job: Job): boolean =>
      job === 'receive' || job === 'set' || job === 'attack' || job === 'serve';
    const ballPos = this.world.ball.pos;
    const mine = onTheBall(s.job);
    const myGap = distXY(p.pos, ballPos);
    let sepX = 0;
    let sepY = 0;
    for (const mate of this.team.players) {
      if (mate.id === p.id || mate.airborne) continue;
      const bothBlocking = s.job === 'block' && this.stateOf(mate).job === 'block';
      const theirs = onTheBall(this.stateOf(mate).job);
      // Two players both going for the ball is the collision that actually
      // looks bad, and the tie is broken the way players break it on a court:
      // whoever is further away gives way.
      if (mine && !(theirs && distXY(mate.pos, ballPos) < myGap)) continue;
      const ox = p.pos.x - mate.pos.x;
      const oy = p.pos.y - mate.pos.y;
      const d = Math.hypot(ox, oy);
      const personalSpace = bothBlocking ? 0.72 : PERSONAL_SPACE;
      if (d > personalSpace || d < 1e-4) continue;
      // Give extra room to a team-mate who is playing the ball.
      const push = ((personalSpace - d) / personalSpace) * (theirs ? 2.2 : 1);
      sepX += (ox / d) * push;
      sepY += (oy / d) * push;
    }
    if (sepX !== 0 || sepY !== 0) {
      cmd.moveX = clamp(cmd.moveX + sepX * 1.6, -1, 1);
      cmd.moveY = clamp(cmd.moveY + sepY * 1.6, -1, 1);
    }

    // Cover supports the play; it must not stand underneath the play. When a
    // high ball is already owned by a setter/attacker/blocker, nearby cover
    // bodies clear the lane instead of continuing through the ball marker.
    // A delivered set already has a stable landing-clearance destination.
    // Repelling cover from the live ball as it travelled there drove players
    // back toward the net and underneath the hitter they had been clearing.
    if (s.job === 'cover' && !ownAttack && ballPos.z > NET_HEIGHT + 0.35) {
      const awayX = p.pos.x - ballPos.x;
      const awayY = p.pos.y - ballPos.y;
      const awayD = Math.hypot(awayX, awayY);
      if (awayD > 1e-4 && awayD < 2.05) {
        const push = ((2.05 - awayD) / 2.05) * 1.1;
        cmd.moveX = clamp(cmd.moveX + (awayX / awayD) * push, -1, 1);
        cmd.moveY = clamp(cmd.moveY + (awayY / awayD) * push, -1, 1);
      }
    }

    // Apply after all formation/separation forces have been combined. Filtering
    // only the goal leaves the personal-space term free to restart the feet.
    const betweenPoints = this.world.phase !== 'rally' && this.world.phase !== 'serve' && s.job === 'idle';
    if (betweenPoints) {
      // A settled athlete cannot finish a new adjustment just before service
      // positions are placed. Keep the actual command quiet during that last
      // beat; existing travel and all live/human movement retain their input.
      const awaitingServe = this.world.phase === 'dead'
        && this.world.phaseTimer >= POINT_BREAK_SECONDS - .18
        && p.height === 0 && p.vertVel === 0 && p.vel.x === 0 && p.vel.y === 0;
      const steering = awaitingServe ? { x: 0, y: 0, moving: false }
        : resetAdjustmentSteering(cmd.moveX, cmd.moveY, s.adjusting);
      s.adjusting = steering.moving;
      cmd.moveX = steering.x; cmd.moveY = steering.y;
    } else if (!chasing && s.job !== 'serve') {
      const steering = settledSteering(cmd.moveX, cmd.moveY, s.adjusting);
      s.adjusting = steering.moving;
      cmd.moveX = steering.x; cmd.moveY = steering.y;
    } else {
      s.adjusting = false;
    }

    // After a point, two former blockers can still be shoulder-to-shoulder.
    // Separation used to override the .32 walking command above and briefly
    // accelerate them into run -> walk in ~50ms. Preserve its direction and
    // gradual acceleration, but cap the COMPLETE reset command to a walk.
    // No live rally or human command is slowed by this branch.
    if (betweenPoints) {
      const reset = walkingResetSteering(cmd.moveX, cmd.moveY);
      cmd.moveX = reset.x; cmd.moveY = reset.y;
    }

    // `Player.pos.z` is always 0 — height lives in `Player.height` — so this
    // must be a floor-plane distance plus an explicit reach check. Using a 3D
    // distance here made the AI ignore every ball above head height.
    const ball = this.world.ball;
    // The platform drawings have planted feet. Once the incoming ball is
    // reachable after natural braking, stop chasing its later FLOOR landing.
    // Human input is returned above unchanged; desperate digs keep travelling.
    if (s.job === 'receive' && p.presentation.action === 'bump'
      && p.presentation.phase === 'prepare' && canPlantForReceive(p, ball)) {
      cmd.moveX = 0; cmd.moveY = 0;
    }
    // Brake before showing planted-foot set preparation. Waiting for that
    // artwork first makes the torso skate while the tactical goal continues
    // pulling it toward the ball's later floor landing. Keep moving for a
    // genuinely unreachable ball; human commands were returned above.
    if (s.job === 'set' && (p.presentation.action === 'none'
      || p.presentation.action === 'set' && p.presentation.phase === 'prepare')
      && (canPlantForGroundContact(p, ball)
        || Math.hypot(p.vel.x, p.vel.y) < .1 && canReach(p, ball))) {
      cmd.moveX = 0; cmd.moveY = 0;
    }
    // The ball has left the hands, but those hands are still extending and
    // returning. Do not let coverage/separation drag planted feet sideways
    // through that recovery. This is AI steering, never a human input lock.
    const groundRecovery = p.presentation.action === 'set' ? SET_GROUND_RECOVERY_TIME
      : p.presentation.action === 'bump' ? BUMP_GROUND_RECOVERY_TIME : 0;
    if (p.height === 0 && !p.diving && p.presentation.phase === 'contact'
      && p.animTime < groundRecovery) {
      cmd.moveX = 0; cmd.moveY = 0;
    }
    // Close the last adjustment during the weight shift, then brake for the
    // deep compression poses. Do not arrest the approach at its first drawing.
    if (s.blockPreparing && p.blockPreparationAge !== undefined
      && p.blockPreparationAge >= BLOCK_PREPARATION_TIME / 2) {
      cmd.moveX = 0; cmd.moveY = 0;
    }
    const near =
      distXY(p.pos, ball.pos) < 2.2 && ball.pos.z < p.height + PLAYER_REACH + 0.8;
    cmd.actionHeld = s.holdAction && (near || s.job === 'serve');
    cmd.actionPressed = s.wantsAction && near;
    if (cmd.actionHeld) cmd.actionPressed = true;
    if (s.job === 'set' && Math.hypot(p.vel.x, p.vel.y) > .1 && canPlantForGroundContact(p, ball)) {
      // The hands remain offered, but an AI setter waits for the safe planted
      // contact predicted above. Clear only its own automatic button buffer;
      // an early AI request must not make World strike halfway through braking.
      cmd.actionPressed = false;
      cmd.actionHeld = false;
      p.actionBuffer = 0;
    }
    return cmd;
  }
}
