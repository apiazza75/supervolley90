/**
 * Minimal 3D vector math for the volley simulation.
 *
 * World axes (metres, right-handed-ish, chosen for readability):
 *   x  -> across the court, -4.5 (left sideline) .. +4.5 (right sideline)
 *   y  -> along the court,  -9.0 (home baseline) .. +9.0 (away baseline), net at y = 0
 *   z  -> height above the floor, 0 = floor
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const addScaled = (out: Vec3, a: Vec3, s: number): Vec3 => {
  out.x += a.x * s;
  out.y += a.y * s;
  out.z += a.z * s;
  return out;
};

export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);

export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const len2 = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Horizontal (floor-plane) distance, ignoring height. */
export const distXY = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y);

export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3();
};

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest signed difference between two angles, in radians. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Move `current` towards `target` by at most `maxStep`. */
export const approach = (current: number, target: number, maxStep: number): number => {
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
};

export const smoothDamp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
