import { Ball, driveOverNet, solveArc, solveArcOverNet, solveDrive } from './ball';
import { Vec3, v3, clamp, distXY, lerp } from './math3';
import { Player } from './player';
import { Rng } from './rng';
import {
  ATTACK_LINE,
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
export function contactRadius(p: Player): number {
  return PLAYER_RADIUS + (p.diving ? 1.3 : 0.95);
}

/** Vertical window in which a player can play the ball. */
export function contactWindow(p: Player): { lo: number; hi: number } {
  const lo = p.height + (p.diving ? -0.25 : 0.02);
  const hi = p.height + PLAYER_REACH + (p.airborne ? 0.35 : 0.15);
  return { lo, hi };
}

export function canReach(p: Player, ball: Ball): boolean {
  if (p.downTime > 0 && !p.diving) return false;
  if (distXY(p.pos, ball.pos) > contactRadius(p)) return false;
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
  const horizontal = 1 - clamp(distXY(p.pos, ball.pos) / contactRadius(p), 0, 1);
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

  // Below half charge it is a floater: slow, high, heavy wobble. Above, it
  // becomes a jump serve — flat, fast and much harder to pass.
  const jumpServe = charge > 0.5 && player.airborne;
  if (jumpServe) {
    const speed = lerp(15, 23, charge) * (0.85 + 0.3 * player.stats.power);
    const vel = driveOverNet(from, target, speed, 0.2);
    const spin = v3(-3.2 * attackDir(player.side), 0, ctx.rng.spread(1.4));
    ball.strike(vel, spin);
    return { kind: 'serve', target, speed };
  }

  const flight = lerp(1.5, 1.05, charge);
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
  // Incoming pace makes a pass harder to control.
  const pace = clamp(Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) / 22, 0, 1);
  target.x += s.x * (1 + pace);
  target.y += s.y * (1 + pace);

  const flight = player.diving ? 1.35 : 1.05;
  const vel = solveArc(from, target, flight);
  ball.strike(vel, v3(ctx.rng.spread(0.4), 0, 0));
  player.swing = 0.22;
  player.setAnim(player.diving ? 'dive' : 'bump');
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
  player.setAnim('set');
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
    player.setAnim('spike');
    return { kind: 'power', target, speed: 18, move };
  }

  if (move === 'comet') {
    // Extreme sidespin: leaves towards one antenna and hooks back inside.
    const side = Math.sign(aim.x) || 1;
    const target = aimToTarget(player.side, { x: side * 0.95, depth: 0.55 });
    const launch = aimToTarget(player.side, { x: side * 1.9, depth: 0.75 });
    const vel = driveOverNet(from, launch, 30 * strength, 0.12);
    // Sidespin is scaled by the attack direction for the same reason as an
    // ordinary spike: Magnus depends on the sign of the velocity.
    ball.strike(vel, v3(-4 * dir, 0, -side * 13 * dir));
    player.swing = 0.34;
    player.setAnim('spike');
    return { kind: 'power', target, speed: 30 * strength, move };
  }

  // Meteor: straight down off the top of the reach, as fast as the ball goes.
  const target = aimToTarget(player.side, { x: aim.x * 0.7, depth: -0.1 });
  const vel = solveDrive(from, target, 38 * strength);
  ball.strike(vel, v3(-9 * dir, 0, 0));
  player.swing = 0.36;
  player.setAnim('spike');
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
  const charge = clamp(0.35 + 0.65 * q, 0, 1);

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
    player.setAnim('spike');
    return { kind: 'tip', target, speed: Math.hypot(vel.x, vel.y, vel.z) };
  }

  const target = aimToTarget(player.side, aim);
  // Enough spread that hard swings genuinely go long or wide sometimes;
  // an attack that can never miss makes the defence pointless.
  const s = scatter(ctx, 0.95 * (1.25 - charge * 0.4));
  target.x = clamp(target.x + s.x, -COURT_HALF_WIDTH - 0.9, COURT_HALF_WIDTH + 0.9);
  target.y += s.y;

  const power = lerp(17, 30, charge) * (0.8 + 0.4 * player.stats.power) * (0.75 + 0.35 * q);
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
  player.setAnim('spike');
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

  if (q > 0.62) {
    // Stuff block: straight down into the attacker's court.
    const depth = lerp(1.2, 4.0, 1 - q);
    const target = v3(
      clamp(ball.pos.x + ctx.rng.spread(0.8), -COURT_HALF_WIDTH + 0.3, COURT_HALF_WIDTH - 0.3),
      dir * depth,
      BALL_RADIUS,
    );
    const vel = driveOverNet(contactPoint(player, ball), target, incoming * 0.7 + 6, 0.25);
    ball.strike(vel, v3(-2 * dir, 0, 0));
    player.setAnim('block');
    return { kind: 'block', target, speed: incoming };
  }

  // Deflection: the ball pops up on the blocker's own side, still playable.
  const vel = v3(
    ball.vel.x * 0.35 + ctx.rng.spread(1.6),
    -ball.vel.y * 0.3 - dir * 1.2,
    Math.abs(ball.vel.z) * 0.35 + 3.4,
  );
  ball.strike(vel, v3());
  player.setAnim('block');
  return { kind: 'block', target: v3(ball.pos.x, ball.pos.y, 0), speed: incoming };
}

/** True when a player standing here is legally allowed to attack above the net. */
export function canAttackAboveNet(p: Player, frontRow: boolean): boolean {
  if (frontRow) return true;
  // Back-row players must take off behind the attack line.
  const dir = attackDir(p.side);
  return dir > 0 ? p.pos.y < -ATTACK_LINE : p.pos.y > ATTACK_LINE;
}
