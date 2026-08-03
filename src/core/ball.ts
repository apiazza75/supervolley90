import { Vec3, v3, copy, len, scale, clamp } from './math3';
import {
  AIR_DRAG,
  BALL_RADIUS,
  FLOOR_FRICTION,
  FLOOR_RESTITUTION,
  GRAVITY,
  MAGNUS,
  NET_BAND_THICKNESS,
  NET_HEIGHT,
  NET_RESTITUTION,
  SPIN_DECAY,
  Side,
} from './rules';

export interface BallTouch {
  side: Side;
  playerId: number;
  /** Touch index within the current possession, 1..3 (blocks are recorded as 0). */
  count: number;
}

export class Ball {
  pos: Vec3 = v3(0, -8, 1);
  vel: Vec3 = v3();
  /** Spin vector; magnitude drives the Magnus curve, direction its plane. */
  spin: Vec3 = v3();
  /** Set while the ball is held (serve toss lock, replay freeze). */
  frozen = false;
  /** Visual only: accumulated rotation for the renderer. */
  roll = 0;
  /** Set for one step when the ball is struck, so the renderer can flash. */
  lastImpactSpeed = 0;
  /** True once the ball has touched the floor and the rally is dead. */
  grounded = false;
  /**
   * Short lockout after any strike. Without it a player who is still holding
   * the button re-contacts the ball on the very next step, because the ball
   * has barely left their hands.
   */
  touchCooldown = 0;

  reset(pos: Vec3, vel: Vec3 = v3()): void {
    this.pos = copy(pos);
    this.vel = copy(vel);
    this.spin = v3();
    this.frozen = false;
    this.grounded = false;
    this.lastImpactSpeed = 0;
    this.touchCooldown = 0;
  }

  /** Apply a strike: sets velocity outright and imparts spin. */
  strike(vel: Vec3, spin: Vec3 = v3()): void {
    this.vel = copy(vel);
    this.spin = copy(spin);
    this.frozen = false;
    this.grounded = false;
    this.lastImpactSpeed = len(vel);
    this.touchCooldown = 0.12;
  }

  step(dt: number): void {
    if (this.touchCooldown > 0) this.touchCooldown -= dt;
    if (this.frozen) return;

    // Magnus force: spin x velocity. Written out to avoid allocating.
    const { spin: s, vel: v } = this;
    const mx = (s.y * v.z - s.z * v.y) * MAGNUS;
    const my = (s.z * v.x - s.x * v.z) * MAGNUS;
    const mz = (s.x * v.y - s.y * v.x) * MAGNUS;

    v.x += (mx - v.x * AIR_DRAG) * dt;
    v.y += (my - v.y * AIR_DRAG) * dt;
    v.z += (GRAVITY + mz - v.z * AIR_DRAG) * dt;

    const decay = Math.exp(-SPIN_DECAY * dt);
    s.x *= decay;
    s.y *= decay;
    s.z *= decay;

    const prevY = this.pos.y;
    this.pos.x += v.x * dt;
    this.pos.y += v.y * dt;
    this.pos.z += v.z * dt;

    this.collideNet(prevY);
    this.collideFloor();

    this.roll += len(v) * dt * 2.4;
  }

  /**
   * Collide against the net band. The net is a vertical slab at y = 0 spanning
   * the full simulated width — hitting it outside the antennae is handled by
   * the rules layer as an out-of-bounds fault, not here.
   */
  private collideNet(prevY: number): void {
    const half = NET_BAND_THICKNESS / 2 + BALL_RADIUS;
    const insideBand = Math.abs(this.pos.y) < half;
    const crossedPlane = prevY !== 0 && Math.sign(prevY) !== Math.sign(this.pos.y);
    if (!insideBand && !crossedPlane) return;
    if (this.pos.z > NET_HEIGHT + BALL_RADIUS) return; // cleanly over the top
    // Everything below the tape is solid, right down to the floor. Real nets
    // have a gap under the bottom band, but a ball skimming through it reads
    // as the ball passing THROUGH the net, and the arcade original never let
    // that happen: over the top, or not at all.

    // Which half the ball arrived from. It always gets sent back there.
    const fromSide = prevY !== 0 ? Math.sign(prevY) : Math.sign(this.pos.y) || -1;

    // Eject the ball clear of the band. Leaving it inside would re-trigger this
    // branch every step and pump energy into a ball that should be dropping.
    this.pos.y = fromSide * half * 1.05;
    // Net hits kill almost all the pace, but the ball must always end up moving
    // away from the net, never back into it.
    const bounce = Math.max(0.35, Math.abs(this.vel.y) * NET_RESTITUTION);
    this.vel.y = fromSide * bounce;
    this.vel.x *= 0.5;
    this.vel.z *= 0.6;
    this.spin = v3();

    // A ball clipping the very top of the band pops up, which is what makes
    // net-cord touches and let serves feel unpredictable.
    if (this.pos.z > NET_HEIGHT - 0.2) {
      this.vel.z = Math.max(this.vel.z, 0.9);
      this.vel.y = fromSide * 0.6;
    }
  }

  private collideFloor(): void {
    if (this.pos.z > BALL_RADIUS) return;
    this.pos.z = BALL_RADIUS;
    if (this.vel.z < 0) {
      this.vel.z = -this.vel.z * FLOOR_RESTITUTION;
      this.vel.x *= FLOOR_FRICTION;
      this.vel.y *= FLOOR_FRICTION;
      this.spin = scale(this.spin, 0.3);
    }
    if (Math.abs(this.vel.z) < 0.4) this.vel.z = 0;
    this.grounded = true;
  }
}

export interface Prediction {
  /** Where the ball crosses the given height on its way down. */
  point: Vec3;
  /** Seconds until it gets there. */
  time: number;
  /** False when the ball never reaches that height within the horizon. */
  valid: boolean;
}

/**
 * Integrate a copy of the ball forward to find where it will descend through
 * `targetZ`. This drives both the landing marker and every AI decision, so it
 * uses the same forces as `Ball.step` — approximating it with a parabola made
 * spin-heavy serves land visibly off the marker.
 */
export function predictLanding(ball: Ball, targetZ = BALL_RADIUS, horizon = 6): Prediction {
  const dt = 1 / 120;
  const p = copy(ball.pos);
  const v = copy(ball.vel);
  const s = copy(ball.spin);
  let t = 0;
  let prevZ = p.z;
  let prevY = p.y;

  while (t < horizon) {
    const mx = (s.y * v.z - s.z * v.y) * MAGNUS;
    const my = (s.z * v.x - s.x * v.z) * MAGNUS;
    const mz = (s.x * v.y - s.y * v.x) * MAGNUS;
    v.x += (mx - v.x * AIR_DRAG) * dt;
    v.y += (my - v.y * AIR_DRAG) * dt;
    v.z += (GRAVITY + mz - v.z * AIR_DRAG) * dt;
    const decay = Math.exp(-SPIN_DECAY * dt);
    s.x *= decay;
    s.y *= decay;
    s.z *= decay;

    prevZ = p.z;
    prevY = p.y;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    t += dt;

    // Stop at the net: a ball that will be blocked by the band never arrives.
    // This threshold must match `Ball.collideNet` exactly — when it did not,
    // the landing marker happily promised a ball that the net was about to eat.
    const crossedNet = Math.sign(prevY) !== Math.sign(p.y);
    if (crossedNet && p.z <= NET_HEIGHT + BALL_RADIUS) {
      return { point: v3(p.x, 0, p.z), time: t, valid: false };
    }

    if (v.z < 0 && p.z <= targetZ && prevZ > targetZ) {
      const alpha = (prevZ - targetZ) / Math.max(1e-6, prevZ - p.z);
      return {
        point: v3(p.x - v.x * dt * (1 - alpha), p.y - v.y * dt * (1 - alpha), targetZ),
        time: t,
        valid: true,
      };
    }
  }
  return { point: copy(p), time: horizon, valid: false };
}

/**
 * Solve the launch velocity that sends the ball from `from` to `to` arriving
 * after `flightTime` seconds, under gravity only (drag is small enough over a
 * single arc that the error stays inside the aiming tolerance).
 */
export function solveArc(from: Vec3, to: Vec3, flightTime: number): Vec3 {
  const t = Math.max(0.12, flightTime);
  const k = AIR_DRAG;

  // Closed-form inverse of the linear-drag integration `Ball.step` performs.
  // With dv/dt = -k v the distance covered is v0 (1 - e^-kt) / k, so the naive
  // distance/time launch speed always falls a few percent short — enough to
  // drop a serve into the net or a set behind the hitter.
  const decay = 1 - Math.exp(-k * t);
  const horizontal = (d: number): number => (k > 1e-6 ? (d * k) / decay : d / t);

  // Vertical adds gravity. Integrating dv/dt = g - k v gives
  //   z(t) = z0 + (v0 - g/k)(1 - e^-kt)/k + (g/k) t
  // which inverts to the expression below. Note g is negative here, and g/k is
  // the terminal velocity.
  const g = GRAVITY;
  const vz =
    k > 1e-6
      ? ((to.z - from.z - (g / k) * t) * k) / decay + g / k
      : (to.z - from.z) / t - 0.5 * g * t;

  return v3(horizontal(to.x - from.x), horizontal(to.y - from.y), vz);
}

/**
 * Like `solveArc`, but guarantees the ball passes over the net band when the
 * target is on the other side. It walks flight times from the requested one
 * upwards and returns the flattest arc that still clears by `clearance`.
 *
 * Without this a nominally correct arc still buries itself in the tape as soon
 * as drag or a bit of spin shaves a few centimetres off the apex.
 */
/** Height of a drag-and-gravity trajectory after `t` seconds. */
function heightAt(z0: number, vz0: number, t: number): number {
  const k = AIR_DRAG;
  if (k <= 1e-6) return z0 + vz0 * t + 0.5 * GRAVITY * t * t;
  const g = GRAVITY;
  return z0 + ((vz0 - g / k) * (1 - Math.exp(-k * t))) / k + (g / k) * t;
}

/** Time at which a trajectory starting at `y0` with speed `vy` reaches y = 0. */
function netCrossingTime(y0: number, vy: number): number {
  const k = AIR_DRAG;
  if (Math.abs(vy) < 1e-6) return -1;
  if (k <= 1e-6) return -y0 / vy;
  // y(t) = y0 + vy (1 - e^-kt)/k  ->  solve for t.
  const inner = 1 + (y0 * k) / vy;
  if (inner <= 0) return -1;
  return -Math.log(inner) / k;
}

export function solveArcOverNet(
  from: Vec3,
  to: Vec3,
  clearance = 0.3,
  minFlight = 0.8,
  maxFlight = 2.2,
): Vec3 {
  const sameSide = Math.sign(from.y) === Math.sign(to.y) || to.y === 0;
  if (sameSide) return solveArc(from, to, minFlight);

  const needed = NET_HEIGHT + clearance;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = minFlight + (maxFlight - minFlight) * (i / steps);
    const v = solveArc(from, to, t);
    if (Math.abs(v.y) < 1e-3) continue;
    const tau = netCrossingTime(from.y, v.y);
    if (tau <= 0 || tau >= t) continue;
    if (heightAt(from.z, v.z, tau) >= needed) return v;
  }
  return solveArc(from, to, maxFlight);
}

/**
 * Launch velocity for a flat, fast strike towards `to` with a given speed.
 * Used by spikes and jump serves, where the player picks power, not arc.
 */
/**
 * Raise a launch velocity until its trajectory clears the tape by `margin`.
 *
 * Flat driven balls — jump serves, spikes — are solved for speed and
 * direction, with nothing checking that they actually get over the net. While
 * the net had an open gap underneath, a serve aimed too flat quietly sailed
 * *through* it and was scored as a good serve. With the net solid to the
 * floor those same trajectories became faults, which is the correct rule and
 * the wrong feel; the fix is to launch them over the net in the first place.
 *
 * Uses the same closed-form drag integration as `Ball.step`, so the clearance
 * it promises is the clearance the ball gets.
 */
export function clearsNet(from: Vec3, vel: Vec3, margin = 0.16, extraDown = 0): boolean {
  if (from.y === 0 || Math.sign(vel.y) === Math.sign(from.y)) return true;
  const k = AIR_DRAG;
  const d = Math.abs(from.y);
  const vy = Math.abs(vel.y);
  if (vy < 1e-3) return true;
  const ratio = (d * k) / vy;
  if (ratio >= 1) return true;
  const t = -Math.log(1 - ratio) / k;
  const decay = (1 - Math.exp(-k * t)) / k;
  // Spin is not a detail here: a jump serve's topspin pulls the ball down with
  // roughly half the force of gravity, so a trajectory that clears the tape on
  // paper buries itself in the net in flight.
  const g = GRAVITY - extraDown;
  const zAtNet = from.z + (vel.z - g / k) * decay + (g / k) * t;
  return zAtNet >= NET_HEIGHT + BALL_RADIUS + margin;
}

/**
 * A fast, flat strike that is still guaranteed to arrive.
 *
 * Solving a drive for speed and direction alone says nothing about whether the
 * ball gets over the net. While the net had an open gap underneath, a flat
 * serve or spike quietly sailed *through* it and scored; with the net solid to
 * the floor the same trajectories became faults — the correct rule and the
 * wrong feel. Rather than simply tilting the launch up, which clears the tape
 * but overshoots the court, this falls back to the arc solver so the ball both
 * clears the net and lands where it was aimed.
 */
export function driveOverNet(
  from: Vec3,
  to: Vec3,
  speed: number,
  margin = 0.14,
  extraDown = 0,
): Vec3 {
  const flat = solveDrive(from, to, speed);
  if (clearsNet(from, flat, margin, extraDown)) return flat;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const minFlight = Math.max(0.35, (dist / Math.max(6, speed)) * 1.05);
  // Lift the arc by whatever the spin will take away by the time it reaches
  // the tape, so the guarantee survives contact with the Magnus term.
  const drop = extraDown * 0.5 * (dist / Math.max(6, speed)) ** 2;
  return solveArcOverNet(from, to, margin + drop, minFlight, minFlight * 2.8);
}

export function clearNet(from: Vec3, vel: Vec3, margin = 0.16): Vec3 {
  // Only balls actually heading across the net are concerned.
  if (from.y === 0 || Math.sign(vel.y) === Math.sign(from.y)) return vel;
  const k = AIR_DRAG;
  const d = Math.abs(from.y);
  const vy = Math.abs(vel.y);
  if (vy < 1e-3) return vel;

  // y(t) = y0 + vy (1 - e^-kt) / k  ->  invert for the crossing time.
  const ratio = (d * k) / vy;
  if (ratio >= 1) return vel; // drag stops it before the net; not our problem
  const t = -Math.log(1 - ratio) / k;
  const decay = (1 - Math.exp(-k * t)) / k;

  const g = GRAVITY;
  const zAtNet = from.z + (vel.z - g / k) * decay + (g / k) * t;
  const needed = NET_HEIGHT + BALL_RADIUS + margin;
  if (zAtNet >= needed) return vel;

  return { x: vel.x, y: vel.y, z: vel.z + (needed - zAtNet) / decay };
}

export function solveDrive(from: Vec3, to: Vec3, speed: number): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horizontal = Math.hypot(dx, dy);
  const t = clamp(horizontal / Math.max(1e-3, speed), 0.1, 2.5);
  return v3(dx / t, dy / t, dz / t - 0.5 * GRAVITY * t);
}
