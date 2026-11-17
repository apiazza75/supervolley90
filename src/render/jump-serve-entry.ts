/** Authored toss and first-step inbetweens; original atlas indexes stay stable. */
export const JUMP_SERVE_TOSS_FRAMES = [1, 28, 29, 30, 2, 31, 3] as const;
// The new raised knee belongs AFTER original 4, not before it. Playing the
// source-sheet order blindly makes the knee/hand reverse for one drawing.
export const JUMP_SERVE_FIRST_STEP = [3, 24, 4, 25, 26, 27] as const;
export const JUMP_SERVE_RUNUP_FRAMES = [...JUMP_SERVE_FIRST_STEP, 5, 6, 7, 8, 9] as const;
/** Airborne shoulder loading: four authored poses between original 15/16. */
export const JUMP_SERVE_RISE_FRAMES = [13, 14, 15, 32, 33, 34, 35, 16, 17] as const;
/** Reviewed open-palm centres, in complete 512px authored cells. */
export const JUMP_SERVE_TOSS_PALMS: Readonly<Partial<Record<number, { x: number; y: number }>>> = {
  28: { x: 399, y: 90 }, 29: { x: 401, y: 50 },
  30: { x: 402, y: 38 }, 31: { x: 402, y: 31 },
};
