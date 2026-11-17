/** Four authored low-to-high gather drawings appended after the set atlas.
 * They are preparation only, never contact/recovery or a looping gait.
 */
export const SET_GATHER_FRAMES = [24, 25, 26, 27] as const;
export const SET_PREPARATION_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export const MOVING_SET_PREPARATION_FRAMES = [...SET_GATHER_FRAMES, ...SET_PREPARATION_FRAMES] as const;
export function setPreparationFrame(time: number, fromMovement: boolean): number {
  const frames = fromMovement ? MOVING_SET_PREPARATION_FRAMES : SET_PREPARATION_FRAMES;
  return frames[Math.min(frames.length - 1, Math.floor(Math.max(0, time) / .18 * frames.length))];
}
