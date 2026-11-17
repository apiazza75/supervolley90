/** Off-ball steering needs a release band above Player.step's .05 dead zone.
 * Otherwise formation and personal-space forces trade tiny corrections and
 * repeatedly restart a stopped body at ~.3 m/s on alternate physics ticks.
 * Active ball pursuit bypasses this filter; no position or velocity is snapped.
 */
export const STEERING_START = .09;
export const STEERING_STOP = .06;
export const RESET_WALK_COMMAND = .32;
export const RESET_STEERING_START = .16;

/** A stationary athlete does not react to centimetric separation corrections
 * between points. Require meaningful NEW travel; an established adjustment
 * still brakes gradually through the normal lower stop band. Applied to commands, not poses,
 * so no body is held static while its physical feet continue to travel.
 */
export function resetAdjustmentSteering(x: number, y: number, moving: boolean): {
  x: number; y: number; moving: boolean;
} {
  const magnitude = Math.hypot(x, y);
  if (!moving && magnitude < RESET_STEERING_START) return { x: 0, y: 0, moving: false };
  return settledSteering(x, y, moving);
}

/** The already chosen walking pace must also bound teammate-separation forces.
 * Only used between points; live pursuit and human input do not pass here.
 */
export function walkingResetSteering(x: number, y: number): { x: number; y: number } {
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > RESET_WALK_COMMAND ? RESET_WALK_COMMAND / magnitude : 1;
  return { x: x * scale, y: y * scale };
}

export function settledSteering(x: number, y: number, moving: boolean): {
  x: number; y: number; moving: boolean;
} {
  const magnitude = Math.hypot(x, y);
  const next = moving ? magnitude > STEERING_STOP : magnitude >= STEERING_START;
  return next ? { x, y, moving: true } : { x: 0, y: 0, moving: false };
}
