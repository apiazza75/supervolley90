/** Original drawings stay intact; two authored passing poses complete the
 * knee recovery on opposite halves of the same two-foot cycle. */
export const RUN_STRIDE_FRAMES = [
  0,1,2,3,4,24,5,6,7,8,9,10,11,12,13,14,15,16,25,17,18,19,20,21,22,23,
] as const;

/** Anatomical phase in the original 24-pose unit, not an atlas index. */
export function runLegacyFrame(frame: number): number {
  return frame === 24 ? 4.5 : frame === 25 ? 16.5 : frame;
}

const wrap = (phase: number) => ((phase % 1) + 1) % 1;
export function runPhaseAtTime(time: number): number {
  const at = wrap(time) * RUN_STRIDE_FRAMES.length;
  const i = Math.min(RUN_STRIDE_FRAMES.length - 1, Math.floor(at));
  const start = runLegacyFrame(RUN_STRIDE_FRAMES[i]);
  const end = i + 1 === RUN_STRIDE_FRAMES.length ? 24 : runLegacyFrame(RUN_STRIDE_FRAMES[i+1]);
  return (start + (end-start) * (at-i)) / 24;
}

/** Preserve which leg supports the athlete when changing walking/running
 * cadence or leaving a pivot. New atlas indexes must not reset the stride. */
export function runTimeAtPhase(phase: number): number {
  const value = wrap(phase) * 24;
  for (let i=0;i<RUN_STRIDE_FRAMES.length;i++) {
    const start = runLegacyFrame(RUN_STRIDE_FRAMES[i]);
    const end = i+1 === RUN_STRIDE_FRAMES.length ? 24 : runLegacyFrame(RUN_STRIDE_FRAMES[i+1]);
    if (value < end) return (i + (value-start)/(end-start)) / RUN_STRIDE_FRAMES.length;
  }
  return 0;
}
