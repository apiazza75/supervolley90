import { predictLanding } from './ball';
import { Aim, canReach } from './contact';
import { Vec3, clamp, copy, distXY, v3 } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  COURT_HALF_WIDTH,
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

    if (mine || (ballOnMySide && incoming)) {
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
        s.goal = copy(p.pos);
        // Plan the serve once: toss time, target, and whether to go up for it.
        if (s.serveHold <= 0) {
          s.serveHold = this.rng.range(0.5, 1.2);
          s.powerServe = this.rng.chance(0.18 + this.difficulty * 0.12);
          s.aim = {
            x: this.rng.range(-0.8, 0.8),
            depth: this.rng.chance(0.25) ? this.rng.range(-0.5, 0) : this.rng.range(0.4, 0.95),
          };
        }

        const t = this.world.phaseTimer;
        const ball = this.world.ball;
        if (ball.frozen) {
          // Ball still in hand: a press now is the toss.
          s.wantsAction = t > s.serveHold;
        } else {
          // Ball in the air. Go up for a jump serve if that was the plan, and
          // swing once the ball has stopped rising and dropped into reach.
          if (s.powerServe && !p.airborne && p.canAct && t > s.serveHold + 0.34) p.jump();
          const reachTop = p.height + PLAYER_REACH + (p.airborne ? 0.3 : 0.1);
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
    // Left to right across the court, so the reception line keeps its shape.
    const dir = attackDir(this.team.side);
    return eligible
      .slice()
      .sort((a, b) => a.home.x * dir - b.home.x * dir)
      .slice(0, 3)
      .map((p) => p.id);
  }

  /** Our side has the ball: pass, set, attack, everyone else covers. */
  private assignOffense(): void {
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
        const hitter = this.team.get(attackerId) ?? null;
        s.goal = legalSpot(p.side, attackSpot(p, hitter, w.ball.pos.x));
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

    // Guess where the opponent will attack from: the ball's x near the net.
    const attackX = clamp(w.ball.pos.x, -COURT_HALF_WIDTH + 0.6, COURT_HALF_WIDTH - 0.6);
    const threat = opponent.players.find((o) => o.airborne && Math.abs(o.pos.y) < 4);
    const blockX = threat ? clamp(threat.pos.x, -3.4, 3.4) : attackX;

    const blockers = this.team
      .frontRow()
      .slice()
      .sort((a, b) => Math.abs(a.pos.x - blockX) - Math.abs(b.pos.x - blockX));

    const receiverId = ballComing ? this.pickReceiver() : -1;
    this.designatedReceiver = receiverId;

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

      const blockIndex = blockers.indexOf(p);
      if (blockIndex >= 0 && blockIndex < 2 && Math.abs(w.ball.pos.y) < 6) {
        s.job = 'block';
        const offset = blockIndex === 0 ? 0 : blockX > 0 ? -0.8 : 0.8;
        s.goal = v3(clamp(blockX + offset, -3.9, 3.9), -dir * 0.75, 0);
        this.driveBlock(p, s, threat);
        continue;
      }

      s.job = 'cover';
      const strong = Math.hypot(w.ball.vel.x, w.ball.vel.y) > 16 || Boolean(threat);
      s.goal = legalSpot(
        p.side,
        defenceSpot(
          p,
          blockX,
          blockers.slice(0, 2).map((b) => b.id),
          strong,
        ),
      );
    }
  }

  // ------------------------------------------------------------- job drivers

  private driveReceive(p: Player, s: Brainstate, timeToLand: number): void {
    const w = this.world;
    const gap = distXY(p.pos, s.goal);
    const reachable = gap < p.runSpeed * Math.max(0.05, timeToLand) + 0.9;

    // A ball that will drop out of reach is worth a dive.
    if (!reachable && gap < 4.0 && timeToLand < 0.7 && !p.airborne && p.canAct) {
      if (this.rng.chance(0.08 + this.difficulty * 0.05)) {
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
    if (!p.airborne && p.canAct && inPosition && timeToContact <= rise + 0.04) {
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

  private driveBlock(p: Player, s: Brainstate, threat: Player | undefined): void {
    if (!threat) {
      s.wantsAction = false;
      return;
    }
    const w = this.world;
    // Jump when the attacker is at the top of their own jump.
    const attackerFalling = threat.vertVel < 0.6;
    const aligned = Math.abs(p.pos.x - threat.pos.x) < 1.5;
    const timing = this.rng.range(0, 1) < 0.5 + this.difficulty * 0.25;

    if (!p.airborne && p.canAct && attackerFalling && aligned && timing) {
      if (this.stateOf(p).reactionDelay <= 0 && p.jump()) {
        // Read as a block from the first frame of the jump.
        p.setAnim('block');
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
    if (gap > tolerance) {
      const urgency = clamp(gap / 1.6, 0.35, 1);
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
