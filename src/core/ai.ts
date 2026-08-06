import { predictLanding } from './ball';
import { Aim, canReach } from './contact';
import { Vec3, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  FIXED_DT,
  GRAVITY,
  NET_HEIGHT,
  PLAYER_REACH,
  attackDir,
  otherSide,
} from './rules';
import { HITTER_PIN, attackSpot, defenceSpot, legalSpot, receptionSpot } from './tactics';
import { Team } from './team';
import type { Command, World } from './world';

type Job = 'idle' | 'receive' | 'set' | 'attack' | 'block' | 'cover' | 'serve';

/**
 * How long before contact a hitter is allowed to be running their approach.
 *
 * This is the whole budget for the run-up, and it is deliberately short. It is
 * the value that decides how much of a match is spent watching people sprint:
 * the previous build had no window at all, so every player ran all the time.
 */
const APPROACH_WINDOW = 1.05;

/**
 * How far behind the baseline a jump server starts their run-up, in metres.
 * Sized so the physical approach lands inside the 1.2–2.6 m a real one covers.
 */
const JUMP_SERVE_RUNUP = 1.9;

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
  /** Countdown before the player is allowed to react to a new situation. */
  reactionDelay: number;
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
  /** Request a Lethal Maneuver on this step. */
  armSpecial: boolean;
  /** Committed to moving towards the goal (hysteresis against goal jitter). */
  enRoute: boolean;
}

const newState = (): Brainstate => ({
  job: 'idle',
  reactionDelay: 0,
  goal: v3(),
  wantsAction: false,
  holdAction: false,
  aim: { x: 0, depth: 0.4 },
  serveHold: 0.6,
  powerServe: false,
  armSpecial: false,
  enRoute: false,
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
  /** Where this team has decided to run its attack, chosen once per possession. */
  private plannedAttack: Vec3 = v3();
  /** Touch count seen on the previous step, to detect possession transitions. */
  private lastSeenTouches = -1;
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
    for (const p of team.players) this.states.set(p.id, newState());
  }

  suppress(id: number): void {
    this.suppressedId = id;
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
    for (const s of this.states.values()) if (s.reactionDelay > 0) s.reactionDelay -= dt;
    this.assignJobs();
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
    for (const p of this.team.players) {
      if (p.id === this.suppressedId) continue;
      if (p.id === w.lastToucherId && !w.lastTouchWasBlock) continue;
      if (w.possession === p.side && w.touches >= 3) continue;
      if (!canReach(p, w.ball)) continue;
      const s = this.stateOf(p);
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
        // Someone celebrating stays where they are: jogging back to a
        // formation spot cancels the celebration the moment it starts.
        s.goal = p.cheerTime > 0 ? copy(p.pos) : copy(p.home);
      }
      return;
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
    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;
      if (serving && p.id === server.id) {
        s.job = 'serve';
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

        const t = this.world.phaseTimer;
        const ball = this.world.ball;
        // The run-up is a real journey across the floor: back off behind the
        // baseline before the toss, then cover that ground and plant. The old
        // code kept the server's goal pinned to where they already stood and
        // simply made them jump, so the sheet mimed a run nobody ran.
        const serveDir = attackDir(this.team.side);
        const baseline = -serveDir * COURT_HALF_LENGTH;
        const runUpStart = baseline - serveDir * JUMP_SERVE_RUNUP;
        const plantSpot = baseline - serveDir * 0.35;

        if (ball.frozen) {
          // Ball still in hand: a press now is the toss.
          s.goal = s.powerServe ? v3(p.pos.x, runUpStart, 0) : copy(p.pos);
          const settled = !s.powerServe || Math.abs(p.pos.y - runUpStart) < 0.5;
          s.wantsAction = t > s.serveHold && settled;
        } else if (s.powerServe) {
          // Toss is up: run the approach, plant, and leave the floor.
          s.goal = v3(p.pos.x, plantSpot, 0);
          const arrived =
            serveDir > 0 ? p.pos.y >= plantSpot - 0.28 : p.pos.y <= plantSpot + 0.28;
          if (!p.airborne && p.canAct) {
            if (t > s.serveHold + 0.12) p.licenseApproach('serve', 0.7);
            // Plant once the ground is covered, or when the toss runs out of
            // time — a serve that never leaves the floor is a fault.
            if (t > s.serveHold + 0.3 && (arrived || t > s.serveHold + 0.8)) {
              if (p.anim === 'approach_run') p.setAnim('plant');
              p.cancelApproach();
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
        s.job = 'idle';
        s.serveHold = 0;
        // The receiving team takes up a reception formation; the serving team
        // spreads into its base defensive shape ready for the return.
        s.goal = serving
          ? legalSpot(p.side, defenceSpot(p, 0, [], false))
          : legalSpot(p.side, receptionSpot(p, this.passers()));
      }
    }
  }

  /**
   * The three players who take the serve.
   *
   * A three-passer reception: the two outsides and whoever is in the back
   * middle, never the setter — who has to be free to run to the net — and
   * never a front-row middle, who has to be free to hit the quick.
   */
  private passers(): number[] {
    const eligible = this.team.players.filter(
      (p) =>
        p.role !== 'setter' &&
        p.downTime <= 0 &&
        !(p.role === 'middle' && this.team.isFrontRow(p)),
    );
    // The libero passes every ball they can reach — that is what they are on
    // court for — so they are never the one left out of a three-passer line.
    const chosen = eligible
      .slice()
      .sort((a, b) => Number(b.role === 'libero') - Number(a.role === 'libero'))
      .slice(0, 3);
    // Left to right across the court, so the reception line keeps its shape.
    const dir = attackDir(this.team.side);
    return chosen
      .sort((a, b) => a.home.x * dir - b.home.x * dir)
      .map((p) => p.id);
  }

  /** Our side has the ball: pass, set, attack, everyone else covers. */
  private assignOffense(): void {
    this.wasDefending = false;
    const w = this.world;
    const dir = attackDir(this.team.side);
    const touches = w.possession === this.team.side ? w.touches : 0;

    // Plan the whole play the moment the ball comes our way, so the hitter can
    // start the approach run while the pass is still in the air.
    if (touches !== this.lastSeenTouches) {
      if (touches <= 1) {
        this.designatedReceiver = this.pickReceiver();
        this.designatedAttacker = this.pickAttacker();
        const pin = this.rng.chance(0.25) ? 0 : this.rng.chance(0.5) ? -HITTER_PIN : HITTER_PIN;
        this.plannedAttack = v3(pin + this.rng.spread(0.5), -dir * 2.1, NET_HEIGHT + 0.95);
      }
      this.lastSeenTouches = touches;
    }

    // Contact height for a set-up attack: the top of the hitting window.
    const attackPred = predictLanding(w.ball, NET_HEIGHT + 0.85);
    const floorPred = predictLanding(w.ball);
    // Who takes the second and third balls. Both fall back to whoever can
    // actually get there: the designated player is a preference, not a
    // promise, because the ball does not always go where the plan assumed.
    const setterId = this.pickBallHandler(floorPred, (p) => (p.role === 'setter' ? 2.2 : 0));
    const attackerId = this.pickBallHandler(attackPred.valid ? attackPred : floorPred, (p) =>
      p.id === this.designatedAttacker ? 2.6 : this.team.isFrontRow(p) ? 0.8 : 0,
    );

    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;
      s.armSpecial = false;

      const isAttacker = p.id === attackerId;

      if (touches === 0 && p.id === this.designatedReceiver) {
        s.job = 'receive';
        s.goal = floorPred.valid ? copy(floorPred.point) : copy(w.ball.pos);
        s.goal.z = 0;
        this.driveReceive(p, s, floorPred.valid ? floorPred.time : 0.4);
      } else if (touches === 1 && p.id === setterId) {
        s.job = 'set';
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
        s.goal = v3(this.plannedAttack.x, this.plannedAttack.y - dir * 1.3, 0);
      } else {
        s.job = 'cover';
        // Cover is planned around where the attack is GOING, decided once per
        // possession — not around the hitter's live position, which sweeps
        // through several metres during the approach and dragged the whole
        // cover arc along with it.
        this.sticky(s, legalSpot(p.side, attackSpot(p, null, this.plannedAttack.x * dir)));
      }
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
      if (p.downTime > 0) continue;
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

  /** Opponent has the ball: block at the net, dig behind it. */
  private assignDefense(): void {
    const w = this.world;
    const dir = attackDir(this.team.side);
    const opponent = w.team(otherSide(this.team.side));
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
    if (!this.wasDefending || Math.abs(blockX - this.readX) > 1.1) {
      this.readX = blockX;
      this.blockPair = this.team
        .frontRow()
        .slice()
        .sort((a, b) => Math.abs(a.pos.x - blockX) - Math.abs(b.pos.x - blockX))
        .slice(0, 2)
        .map((b) => b.id);
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

    for (const p of this.team.players) {
      const s = this.stateOf(p);
      s.wantsAction = false;
      s.holdAction = false;

      if (p.id === receiverId && floorPred.valid) {
        s.job = 'receive';
        s.goal = copy(floorPred.point);
        s.goal.z = 0;
        this.driveReceive(p, s, floorPred.time);
        continue;
      }

      // Two front-row players commit to the block for the whole of the
      // opponent's build-up, not just once the ball reaches the net. Waiting
      // until it did meant the second blocker never arrived.
      const blockIndex = blockers.indexOf(p);
      if (blockIndex >= 0) {
        s.job = 'block';
        const offset = blockIndex === 0 ? 0 : steadyX > 0 ? -0.85 : 0.85;
        this.sticky(s, v3(clamp(steadyX + offset, -3.9, 3.9), -dir * 0.72, 0), 0.45);
        this.driveBlock(p, s, threat, blockIndex, blockers[0]);
        continue;
      }

      s.job = 'cover';
      // Always the deep shape: flipping depth on a live speed estimate marched
      // the whole back line up and down a metre at a time.
      this.sticky(s, legalSpot(p.side, defenceSpot(p, steadyX, this.blockPair, true)));
    }
  }

  // ------------------------------------------------------------- job drivers

  private driveReceive(p: Player, s: Brainstate, timeToLand: number): void {
    const w = this.world;
    const gap = distXY(p.pos, s.goal);
    const reachable = gap < p.runSpeed * Math.max(0.05, timeToLand) + 0.9;

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
      const worthIt = gap > p.runSpeed * Math.max(0.05, timeToLand) + 0.35;
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
    const inPosition = gap < 1.4 || gap < p.runSpeed * timeToContact * 0.6;

    // Licence the run-up, and only the run-up. The window opens when the set is
    // close enough that the hitter commits, and only if there is ground left to
    // cover — a hitter already standing under the ball plants, they do not
    // sprint on the spot. Everything outside this window is ordinary movement.
    if (!p.airborne && timeToContact < APPROACH_WINDOW && gap > 0.55) {
      p.licenseApproach('attack', Math.min(APPROACH_WINDOW, timeToContact + 0.2));
    }

    if (!p.airborne && p.canAct && inPosition && timeToContact <= rise + 0.04) {
      // Plant, then leave the floor: the run-up is over and the pose must stop
      // being a run cycle before the body goes up.
      if (p.anim === 'approach_run') p.setAnim('plant');
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
    const blockers = opponent.players.filter((o) => o.airborne && Math.abs(o.pos.y) < 1.6);
    let aimX = this.rng.range(-0.72, 0.72);
    if (blockers.length) {
      const avgBlock = blockers.reduce((a, o) => a + o.pos.x, 0) / blockers.length;
      aimX = clamp((avgBlock > 0 ? -0.68 : 0.68) + this.rng.spread(0.2), -0.85, 0.85);
    }
    const smart = 0.35 + this.difficulty * 0.3;
    const tipIt = this.rng.chance(0.08 * smart);
    s.aim = { x: aimX, depth: tipIt ? -0.7 : this.rng.range(0.15, 0.86) };
    if (tipIt) s.holdAction = false;
  }

  private driveBlock(
    p: Player,
    s: Brainstate,
    threat: Player | undefined,
    blockIndex: number,
    lead: Player | undefined,
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
    const strikeZone =
      theirSide &&
      Math.abs(ball.pos.y) < 3.0 &&
      ball.pos.z > NET_HEIGHT + 0.25 &&
      ball.pos.z < NET_HEIGHT + 2.1 &&
      ball.vel.z < 1.2;

    // The second blocker is placed a shoulder off the ball on purpose, so it
    // must be judged against its own spot rather than against the hitter —
    // measuring it against the hitter is what kept it on the floor.
    const reference = threat ? threat.pos.x : ball.pos.x;
    const aligned = Math.abs(p.pos.x - reference) < (blockIndex === 0 ? 1.8 : 3.4);
    const timing = this.rng.range(0, 1) < 0.34 + this.difficulty * 0.2;
    // The outside blocker goes with the middle. A double block is two people
    // leaving the floor together — judged apart, the second one waited for its
    // own read, arrived a beat late and stayed down, which is why a block was
    // almost always a single.
    // The partner goes with the lead blocker for the whole of the lead's rise,
    // not only while it is still going up: judged against `vertVel > -1` the
    // window was a couple of frames wide, so the second man missed it more
    // often than not and the block stayed a single.
    const withLead = blockIndex > 0 && lead !== undefined && lead.airborne && lead.height > 0.1;
    const cue = strikeZone || withLead;

    // Mirroring the lead blocker is not a decision to be dithered over: when
    // the middle goes, the outside goes, without waiting on its own dice roll.
    // The human's team does not put the block up on its own. The player calls
    // it: SPACE near the net sends the active player up, and the world brings
    // the nearest front-row team-mate with them. An AI wall that fired by
    // itself made pressing the button feel irrelevant — the one thing an
    // arcade game must never do.
    const humanTeam = this.world.humanTeam?.side === this.team.side;
    if (!humanTeam && !p.airborne && p.canAct && cue && aligned && (timing || withLead)) {
      if (this.stateOf(p).reactionDelay <= 0 && p.jump()) {
        // Read as a block from the first frame of the jump.
        p.setAnim('block');
        this.world.reportBlockAttempt(p);
        this.stateOf(p).reactionDelay = this.latency(p);
      }
    }
    s.wantsAction = p.airborne || Math.abs(w.ball.pos.y) < 1.4;
    s.holdAction = false;
  }

  // ------------------------------------------------------------- positioning

  private pickReceiver(): number {
    const pred = predictLanding(this.world.ball);
    const target = pred.valid ? pred.point : this.world.ball.pos;
    let bestId = -1;
    let best = Infinity;
    for (const p of this.team.players) {
      if (p.downTime > 0) continue;
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

  private pickAttacker(): number {
    const front = this.team.frontRow().filter((p) => p.role !== 'setter' && p.downTime <= 0);
    if (!front.length) {
      const any = this.team.players.filter((p) => p.downTime <= 0);
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
    if (p.id === this.suppressedId) return cmd;

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
    const chasing =
      s.job === 'receive' || s.job === 'set' || s.job === 'attack' || s.job === 'block';
    if (!chasing) {
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
      const urgency = chasing ? clamp(gap / 1.6, 0.35, 1) : clamp(gap / 3.6, 0.22, 0.32);
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
      const theirs = onTheBall(this.stateOf(mate).job);
      // Two players both going for the ball is the collision that actually
      // looks bad, and the tie is broken the way players break it on a court:
      // whoever is further away gives way.
      if (mine && !(theirs && distXY(mate.pos, ballPos) < myGap)) continue;
      const ox = p.pos.x - mate.pos.x;
      const oy = p.pos.y - mate.pos.y;
      const d = Math.hypot(ox, oy);
      if (d > PERSONAL_SPACE || d < 1e-4) continue;
      // Give extra room to a team-mate who is playing the ball.
      const push = ((PERSONAL_SPACE - d) / PERSONAL_SPACE) * (theirs ? 2.2 : 1);
      sepX += (ox / d) * push;
      sepY += (oy / d) * push;
    }
    if (sepX !== 0 || sepY !== 0) {
      cmd.moveX = clamp(cmd.moveX + sepX * 1.6, -1, 1);
      cmd.moveY = clamp(cmd.moveY + sepY * 1.6, -1, 1);
    }

    // `Player.pos.z` is always 0 — height lives in `Player.height` — so this
    // must be a floor-plane distance plus an explicit reach check. Using a 3D
    // distance here made the AI ignore every ball above head height.
    const ball = this.world.ball;
    const near =
      distXY(p.pos, ball.pos) < 2.2 && ball.pos.z < p.height + PLAYER_REACH + 0.8;
    cmd.actionHeld = s.holdAction && (near || s.job === 'serve');
    cmd.actionPressed = s.wantsAction && near;
    if (cmd.actionHeld) cmd.actionPressed = true;
    return cmd;
  }
}
