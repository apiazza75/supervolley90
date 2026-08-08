import {
  Ball,
  aimThroughSpin,
  driveOverNet,
  landingOf,
  solveArc,
  solveArcOverNet,
  solveDrive,
} from './ball';
import { Vec3, v3, clamp, distXY, lerp } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  ATTACK_LINE,
  MAGNUS,
  BALL_RADIUS,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,

  NET_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_REACH,
  Side,
  attackDir,
} from './rules';

export type ContactKind =
  | 'serve'
  | 'bump'
  | 'set'
  | 'spike'
  | 'tip'
  | 'block'
  | 'save'
  | 'power';

/** The three Lethal Maneuvers, chosen by where the stick is pushed. */
export type PowerMove = 'meteor' | 'comet' | 'phantom';

export const POWER_MOVE_NAMES: Record<PowerMove, string> = {
  meteor: 'METEOR SMASH',
  comet: 'COMET DRIVE',
  phantom: 'PHANTOM DROP',
};

export interface Aim {
  /** -1 .. +1 across the court, relative to the attacking direction. */
  x: number;
  /** -1 (short, just over the net) .. +1 (deep, on the baseline). */
  depth: number;
}

export const NEUTRAL_AIM: Aim = { x: 0, depth: 0.35 };

/**
 * Horizontal grab radius; diving players stretch further.
 *
 * Arcade-generous on purpose. A realistic envelope plus a one-frame input
 * window meant a player standing in the right place, pressing at the right
 * moment, still watched the ball land — which reads as the game being broken
 * rather than hard.
 */
export function contactRadius(p: Player, ball?: Ball): number {
  // A blocker reaches with two hands over the tape and nothing else: they
  // cover about a shoulder-width either side and no more. Given the general
  // radius they touched roughly every attack, which turns a block from a
  // tactic into a wall and cuts the average rally by a quarter. Hitting past
  // the block has to be possible, or there is no reason to aim.
  const blocking = p.airborne && p.anim === 'block' && Math.abs(p.pos.y) < 1.3;
  const base = PLAYER_RADIUS + (p.diving ? 1.15 : blocking ? 0.42 : 0.95);
  if (!ball) return base;
  // A ball travelling at thirty metres a second cannot be casually scooped
  // from a metre and a half away. Reach shrinks with pace, which is what makes
  // a hard attack an actual weapon: with a flat radius, a full-power spike was
  // dug as easily as a free ball and rallies ran on forever.
  //
  // Retuned when the earned-power curve landed: with 65% of all attacks being
  // dug up, rallies ran to ten touches and a well-struck spike was worth no
  // more than a push. The ramp now starts sooner and bites harder, so pace is
  // genuinely the thing that beats a defender.
  const pace = clamp((Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) - 12) / 16, 0, 1);
  return base * (1 - 0.55 * pace);
}

/** Vertical window in which a player can play the ball. */
export function contactWindow(p: Player): { lo: number; hi: number } {
  const lo = p.height + (p.diving ? -0.25 : 0.02);
  const hi = p.height + PLAYER_REACH + (p.airborne ? 0.35 : 0.15);
  return { lo, hi };
}

export function canReach(p: Player, ball: Ball): boolean {
  if (p.downTime > 0 && !p.diving) return false;
  if (distXY(p.pos, ball.pos) > contactRadius(p, ball)) return false;
  const { lo, hi } = contactWindow(p);
  return ball.pos.z >= lo && ball.pos.z <= hi;
}

/**
 * How well-timed the contact is, 0..1. Peaks when the ball sits at the top of
 * the reach envelope and right in front of the player — this is what rewards
 * jumping *early* for a spike rather than mashing the button.
 */
export function contactQuality(p: Player, ball: Ball): number {
  const { lo, hi } = contactWindow(p);
  const span = Math.max(0.3, hi - lo);
  const vertical = clamp((ball.pos.z - lo) / span, 0, 1);
  const horizontal = 1 - clamp(distXY(p.pos, ball.pos) / contactRadius(p, ball), 0, 1);
  return clamp(0.35 + 0.4 * vertical + 0.35 * horizontal, 0, 1);
}

/** Where the hands meet the ball; strikes originate from here. */
export function contactPoint(p: Player, ball: Ball): Vec3 {
  return v3(
    lerp(p.pos.x, ball.pos.x, 0.7),
    lerp(p.pos.y, ball.pos.y, 0.7),
    Math.max(BALL_RADIUS, ball.pos.z),
  );
}

/** Translate an aim into an absolute point on the opponent's floor. */
export function aimToTarget(side: Side, aim: Aim): Vec3 {
  const dir = attackDir(side);
  const depth01 = clamp((aim.depth + 1) / 2, 0, 1);
  const y = dir * lerp(1.1, COURT_HALF_LENGTH - 0.45, depth01);
  const x = clamp(aim.x, -1, 1) * (COURT_HALF_WIDTH - 0.5);
  return v3(x, y, BALL_RADIUS);
}

export interface StrikeResult {
  kind: ContactKind;
  /** Where the strike is aimed; the renderer draws the marker here. */
  target: Vec3;
  /** Peak speed, used for camera shake and sound selection. */
  speed: number;
}

export interface StrikeContext {
  player: Player;
  ball: Ball;
  aim: Aim;
  rng: Rng;
  /** 0..1 button charge, meaningful for serves and power spikes. */
  charge: number;
  /** Extra error multiplier applied to AI-controlled players. */
  errorScale?: number;
  /** Set position for bumps: where the ball should be delivered. */
  setterTarget?: Vec3;
  /** Attacker position for sets. */
  attackerTarget?: Vec3;
  /** True when the player has armed a Lethal Maneuver and the gauge is full. */
  special?: boolean;
}

/** Scatter added to a target, shrinking with the player's control stat. */
function scatter(ctx: StrikeContext, base: number): Vec3 {
  const q = contactQuality(ctx.player, ctx.ball);
  const control = ctx.player.stats.control;
  const amount = base * (1.35 - control) * (1.25 - 0.5 * q) * (ctx.errorScale ?? 1);
  return v3(ctx.rng.gauss(amount), ctx.rng.gauss(amount), 0);
}

export function performServe(ctx: StrikeContext): StrikeResult {
  const { player, ball, aim, charge } = ctx;
  const from = contactPoint(player, ball);
  const target = aimToTarget(player.side, aim);
  // Serving has to be a gamble, or there is no reason ever to hit a soft one.
  // Both the spread and the risk of clipping the tape grow with the charge.
  const s = scatter(ctx, 0.28 + 0.3 * charge);
  target.x = clamp(target.x + s.x, -COURT_HALF_WIDTH - 0.4, COURT_HALF_WIDTH + 0.4);
  target.y += s.y + charge * 0.22;

  // Leaving the floor for it IS the jump serve.
  //
  // This used to require `charge > 0.5` as well — a hangover from the old
  // hold-to-charge controls. Under the one-button scheme a tap carries no
  // charge at all, so a player who tossed, jumped and struck at the perfect
  // moment fell through to the floater branch and hit exactly the same slow
  // lob as someone standing still. The jump did nothing.
  //
  // Power now comes from the contact, which is the whole point of the timing
  // cue: meeting the ball at full stretch above the head is a rocket, catching
  // it late and low is a serve you got away with.
  if (player.airborne) {
    // Both halves again: what the player loaded, and how well they met it.
    const q = clamp(contactQuality(player, ball) * (0.45 + 0.55 * charge), 0, 1);
    // The serve goes where the server is. Aiming purely from the stick meant
    // every jump serve from every spot on the line flew the same corridor;
    // standing wide now sends the ball down that side unless the aim pulls it
    // back across.
    target.x = clamp(target.x * 0.55 + from.x * 0.6, -COURT_HALF_WIDTH + 0.4, COURT_HALF_WIDTH - 0.4);
    // Topspin, so the ball dives rather than sailing. The game's Magnus term is
    // scaled for gentle curve, not for the freak spin of a real jump serve, so
    // this is what shapes the flight rather than what defines it.
    const spinX = -0.9 * attackDir(player.side);
    const spin = v3(spinX, 0, ctx.rng.spread(0.9));
    // What the topspin will add to gravity, so the solver can plan for it.
    const magnusDown = Math.abs(spinX) * 22 * MAGNUS;
    const dir = attackDir(player.side);

    // Search for the fastest serve the physics will actually allow.
    //
    // Asking for a flat drive does not work and never could: from a 3.7 m
    // contact, a ball fast enough to reach the far court has to leave almost
    // level, and then it passes the tape at about 2 m — under it. Every such
    // attempt fell back to a slow lob, which is precisely the ball a standing
    // player hits, and that is why jumping for the serve changed nothing at
    // all.
    //
    // So instead of naming a speed and hoping, name a series of flight times
    // from quick to safe and take the first one that genuinely lands in,
    // verified by simulating the shot with its spin. A good contact is allowed
    // to start the search shorter — which is where the pace comes from, and
    // what makes the timing cue worth hitting.
    const FLIGHTS = [0.62, 0.7, 0.78, 0.86, 0.95, 1.05, 1.2];
    // Power dials the pace continuously — a loaded serve met at full stretch
    // starts the search at the flattest, fastest flight; anything less starts
    // safer. This is where holding the button and hitting on the cue both cash
    // out, and it is the whole reason to do either.
    const first = Math.min(4, Math.round((1 - clamp((q - 0.3) / 0.6, 0, 1)) * 4));
    for (let i = first; i < FLIGHTS.length; i++) {
      const flight = FLIGHTS[i];
      const vel = aimThroughSpin(
        target,
        spin,
        (at, lift) =>
          solveArcOverNet(from, at, 0.18 + lift, flight, flight * 1.08, magnusDown),
        from,
      );
      const check = landingOf(from, vel, spin, target.z);
      const lands =
        check.valid &&
        check.point.y * dir > 0.9 &&
        Math.abs(check.point.y) < COURT_HALF_LENGTH - 0.1 &&
        Math.abs(check.point.x) < COURT_HALF_WIDTH - 0.1;
      if (!lands) continue;
      ball.strike(vel, spin);
      return { kind: 'serve', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
    }
    // Nothing worked from here — take the pace off rather than hand over the
    // point, which is what a server who has mistimed the toss does too.
    const safe = solveArcOverNet(from, target, 0.5, 1.15, 2.0);
    ball.strike(safe, v3(spinX * 0.3, 0, 0));
    return { kind: 'serve', target, speed: Math.hypot(safe.x, safe.y, safe.z) };
  }

  // Standing serve: the charge decides between a slow, safe, loopy float and a
  // driven one that skims the tape.
  const flight = lerp(1.6, 1.0, charge);
  // A floater is lobbed safely over; a driven serve skims the tape and can
  // catch it. The clearance the solver guarantees shrinks as power goes up.
  const vel = solveArcOverNet(from, target, lerp(0.5, 0.22, charge), flight, 2.2);
  // Floaters get almost no spin but a randomised sideways nudge: that is what
  // makes them dip unpredictably in the real sport. Kept modest, because the
  // Magnus term is strong enough to bury the serve in the tape otherwise.
  const spin = v3(ctx.rng.spread(0.3), 0, ctx.rng.spread(0.8));
  ball.strike(vel, spin);
  return { kind: 'serve', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
}

export function performBump(ctx: StrikeContext): StrikeResult {
  const { player, ball } = ctx;
  const from = contactPoint(player, ball);
  const dir = attackDir(player.side);
  const fallback = v3(0.9 * -dir, -dir * 1.6, 2.6);
  const target = ctx.setterTarget ? { ...ctx.setterTarget } : fallback;
  target.z = Math.max(2.3, target.z);

  const s = scatter(ctx, 0.9);
  // Incoming pace makes a pass much harder to control. Without this weighting
  // a full-power spike was dug as cleanly as a free ball, and rallies ran on
  // for four and five exchanges because nothing an attacker did could end one.
  const pace = clamp(Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) / 22, 0, 1);
  target.x += s.x * (1 + pace * 2.4);
  target.y += s.y * (1 + pace * 2.4);

  const flight = player.diving ? 1.35 : 1.05;
  const vel = solveArc(from, target, flight);
  ball.strike(vel, v3(ctx.rng.spread(0.4), 0, 0));
  player.swing = 0.22;
  player.setAnim(player.diving ? 'dive' : 'bump_contact');
  return { kind: player.diving ? 'save' : 'bump', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
}

export function performSet(ctx: StrikeContext): StrikeResult {
  const { player, ball, aim } = ctx;
  const from = contactPoint(player, ball);
  const dir = attackDir(player.side);

  // The stick steers the set along the net: left pin, middle, right pin.
  const x = clamp(aim.x, -1, 1) * (COURT_HALF_WIDTH - 0.9);
  const depth = lerp(1.1, 2.4, clamp((1 - aim.depth) / 2, 0, 1));
  const target = ctx.attackerTarget ?? v3(x, -dir * depth, NET_HEIGHT + 0.95);
  const s = scatter(ctx, 0.42);
  target.x += s.x;
  target.y += s.y;
  target.z = Math.max(NET_HEIGHT + 0.55, target.z);

  const vel = solveArc(from, target, 1.15);
  ball.strike(vel, v3());
  player.swing = 0.2;
  player.setAnim('set_contact');
  return { kind: 'set', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
}

/** Which Lethal Maneuver the current aim selects. */
export function powerMoveFor(aim: Aim): PowerMove {
  if (aim.depth < -0.35) return 'phantom';
  if (Math.abs(aim.x) > 0.45) return 'comet';
  return 'meteor';
}

/**
 * A Lethal Maneuver: the signature move of the genre's "hyper" modes.
 *
 * These are not just faster spikes. Each one breaks a different assumption the
 * defence is making — where the ball is going, how it curves, or when it will
 * arrive — which is what makes spending a full gauge feel decisive rather than
 * merely strong.
 */
export function performPowerMove(ctx: StrikeContext): StrikeResult & { move: PowerMove } {
  const { player, ball, aim } = ctx;
  const from = contactPoint(player, ball);
  const dir = attackDir(player.side);
  const move = powerMoveFor(aim);
  const strength = 0.85 + 0.3 * player.stats.power;

  if (move === 'phantom') {
    // Floats up, stalls, then drops almost vertically just past the block.
    const target = aimToTarget(player.side, { x: aim.x * 0.8, depth: -0.75 });
    const vel = solveArcOverNet(from, target, 0.45, 0.7, 1.3);
    // Backspin fights gravity on the way over, then the ball falls off a cliff.
    ball.strike(vel, v3(2.6 * dir, 0, 0));
    player.swing = 0.34;
    player.setAnim(player.airborne ? 'air_contact_spike' : 'spike');
    return { kind: 'power', target, speed: 18, move };
  }

  if (move === 'comet') {
    // Extreme sidespin: leaves towards one antenna and hooks back inside.
    const side = Math.sign(aim.x) || 1;
    const target = aimToTarget(player.side, { x: side * 0.95, depth: 0.55 });
    // A signature move that MISSES is not spectacular, it is a point given
    // away, and measured over eight minutes the hook was the single biggest
    // source of balls out. Simulate the shot and, while it lands out, wind
    // the exaggeration down: less overshoot, less spin, until it stays in.
    let overshoot = 1.9;
    let hook = 13;
    let vel = v3();
    let spin = v3();
    for (let i = 0; i < 4; i++) {
      const launch = aimToTarget(player.side, { x: side * overshoot, depth: 0.75 });
      vel = driveOverNet(from, launch, 30 * strength, 0.12);
      spin = v3(-4 * dir, 0, -side * hook * dir);
      const check = landingOf(from, vel, spin);
      const inCourt =
        check.valid &&
        check.point.y * dir > 0.5 &&
        Math.abs(check.point.y) < COURT_HALF_LENGTH - 0.2 &&
        Math.abs(check.point.x) < COURT_HALF_WIDTH - 0.2;
      if (inCourt) break;
      overshoot = 1 + (overshoot - 1) * 0.6;
      hook *= 0.72;
    }
    ball.strike(vel, spin);
    player.swing = 0.34;
    player.setAnim(player.airborne ? 'air_contact_spike' : 'spike');
    return { kind: 'power', target, speed: 30 * strength, move };
  }

  // Meteor: straight down off the top of the reach, as fast as the ball goes.
  const target = aimToTarget(player.side, { x: aim.x * 0.7, depth: -0.1 });
  let vel = solveDrive(from, target, 38 * strength);
  // The heavy topspin drags even this short ball a metre past where the drive
  // was solved for; verified the same way as everything else that spins.
  {
    const check = landingOf(from, vel, v3(-9 * dir, 0, 0));
    if (!check.valid || Math.abs(check.point.y) > COURT_HALF_LENGTH - 0.3) {
      target.y = dir * 1.6;
      vel = solveDrive(from, target, 34 * strength);
    }
  }
  ball.strike(vel, v3(-9 * dir, 0, 0));
  player.swing = 0.36;
  player.setAnim(player.airborne ? 'air_contact_spike' : 'spike');
  return { kind: 'power', target, speed: 38 * strength, move };
}

export function performAttack(ctx: StrikeContext): StrikeResult {
  const { player, ball, aim } = ctx;
  const from = contactPoint(player, ball);
  const q = contactQuality(player, ball);

  // Power is TIMING, not a held button. Meeting the ball at the top of the
  // reach is the hard part and is what should be rewarded; a charge meter on
  // top of it asked the player to fill a bar during a jump that was already
  // over. `charge` survives only for the serve.
  //
  // And it has to be EARNED. Mapped straight through, a thoroughly ordinary
  // contact scored 0.72 and came out at 0.82 of full power, so almost every
  // swing was a rocket and almost every rally ended on the first attack. Only
  // the top of the quality band now produces a full-blooded spike; below it
  // the ball comes over as a controlled drive that a defence can read.
  //
  // The band was too wide and the result was counted twice: the same contact
  // quality drove `charge` AND multiplied the power again at the end, so a
  // routine swing came out at 33 m/s and 69% of all spikes were at the top of
  // the scale. Full power is now the top sliver of the band, and it is the
  // only thing that sets the pace.
  const charge = clamp((q - 0.79) / 0.19, 0, 1);

  // A tip is what you get when the ball is not above the net line: it drops
  // just behind the block.
  const overNet = from.z > NET_HEIGHT + 0.18;
  const tip = !overNet;

  if (tip) {
    const target = aimToTarget(player.side, { x: aim.x * 0.75, depth: -0.55 + aim.depth * 0.4 });
    const s = scatter(ctx, 0.5);
    target.x += s.x;
    target.y += s.y;
    const vel = solveArcOverNet(from, target, 0.22, 0.85, 1.7);
    ball.strike(vel, v3());
    player.swing = 0.26;
    player.setAnim(player.airborne ? 'air_contact_spike' : 'spike');
    return { kind: 'tip', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
  }

  const target = aimToTarget(player.side, aim);
  // Enough spread that hard swings genuinely go long or wide sometimes;
  // an attack that can never miss makes the defence pointless.
  // Rescaled when the charge curve moved: with most contacts now earning a low
  // charge, the old base sprayed four attacks out of bounds for every three
  // kills, and "out" became the most common way to score.
  const s = scatter(ctx, 0.55 * (1.25 - charge * 0.4));
  target.x = clamp(target.x + s.x, -COURT_HALF_WIDTH - 0.9, COURT_HALF_WIDTH + 0.9);
  target.y += s.y;

  const power = lerp(16, 29, charge) * (0.88 + 0.24 * player.stats.power);
  // A hitter well above the tape may drive the ball down through it — that is
  // the shot. A hitter barely at net height gets the launch lifted just enough
  // to clear, instead of burying a third of all attacks in the net.
  const headroom = from.z - (NET_HEIGHT + 0.45);
  const vel = headroom > 0 ? solveDrive(from, target, power) : driveOverNet(from, target, power, 0.1);

  // Topspin, plus a sidespin component matching how far the hitter cut the ball.
  //
  // Both spins are multiplied by the attack direction. The Magnus force is
  // spin x velocity, so without that factor an identical spin curves one way
  // for the home team and the opposite way for the away team — which quietly
  // made one side hit twice as many balls out as the other.
  const dir = attackDir(player.side);
  const spin = v3(-5.5 * dir, 0, -aim.x * 3.4 * dir);
  ball.strike(vel, spin);
  player.swing = 0.3;
  player.setAnim(player.airborne ? 'air_contact_spike' : 'spike');
  return { kind: 'spike', target, speed: power };
}

/**
 * A block deflects the ball back over the net. Well-timed blocks (high hands,
 * ball close) send it straight down; late ones only slow it.
 */
export function performBlock(ctx: StrikeContext): StrikeResult {
  const { player, ball } = ctx;
  const q = contactQuality(player, ball);
  const dir = attackDir(player.side);
  const incoming = Math.hypot(ball.vel.x, ball.vel.y);

  if (q > 0.82) {
    // Stuff block: straight down into the attacker's court.
    const depth = lerp(1.2, 4.0, 1 - q);
    const target = v3(
      clamp(ball.pos.x + ctx.rng.spread(0.8), -COURT_HALF_WIDTH + 0.3, COURT_HALF_WIDTH - 0.3),
      dir * depth,
      BALL_RADIUS,
    );
    const vel = driveOverNet(contactPoint(player, ball), target, incoming * 0.7 + 6, 0.25);
    ball.strike(vel, v3(-2 * dir, 0, 0));
    player.setAnim(player.airborne ? 'air_contact_block' : 'block');
    return { kind: 'block', target, speed: incoming };
  }

  // Deflection: the ball pops up on the blocker's own side, still playable.
  const vel = v3(
    ball.vel.x * 0.35 + ctx.rng.spread(1.6),
    -ball.vel.y * 0.3 - dir * 1.2,
    Math.abs(ball.vel.z) * 0.35 + 3.4,
  );
  ball.strike(vel, v3());
  player.setAnim(player.airborne ? 'air_contact_block' : 'block');
  return { kind: 'block', target: v3(ball.pos.x, ball.pos.y, 0), speed: incoming };
}

/** True when a player standing here is legally allowed to attack above the net. */
export function canAttackAboveNet(p: Player, frontRow: boolean): boolean {
  if (frontRow) return true;
  // Back-row players must take off behind the attack line.
  const dir = attackDir(p.side);
  return dir > 0 ? p.pos.y < -ATTACK_LINE : p.pos.y > ATTACK_LINE;
}
