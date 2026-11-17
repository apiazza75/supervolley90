/** Authored left/right support transfers, then the original two-foot gather.
 * The first sheet's extended shin follows (not precedes) the high-knee key.
 * A generated over-compressed final pose is intentionally not played.
 * Original gather keys retain their original atlas indexes, 14 and 15.
 */
export const APPROACH_RUN_FRAMES = [
  24,25,26,28,29,27,30,31,32,33,34,35,36,37,38,
  39,40,41,42,43,44,45,46,47,48,49,50,51,52,
  14,55,56,53,57,15,
] as const;
// The old frame 21 shifts the shoes forward then back and dips the head again.
// Keep it in the source atlas, but follow the four newly drawn arm-sweep poses.
export const APPROACH_PLANT_FRAMES = [15,16,17,18,19,20,60,61,62,22,63,23] as const;
