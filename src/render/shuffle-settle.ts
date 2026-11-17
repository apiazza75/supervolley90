import type { Playhead } from './sprite-figure';

export const SHUFFLE_SETTLE_FRAME_TIME = .018;

/** Reviewed support drawings: frame 6 completes the leading step, frame 15
 * completes the trailing step; 0 and 15..23 already have both soles down. */
export function shuffleSupportFrame(frame: number): number {
  if (frame > 0 && frame < 6) return 6;
  if (frame > 6 && frame < 15) return 15;
  return frame;
}

interface State { last: Playhead; facing?: -1 | 1; position?: number; target?: number }
export class ShuffleSettle {
  private readonly states = new Map<number, State>();

  reset(id?: number): void {
    if (id === undefined) this.states.clear(); else this.states.delete(id);
  }

  sample(id: number, pose: Playhead, dt: number, allowed: boolean, fallbackFacing?: -1 | 1): { pose: Playhead; resumeFrame?: number } {
    // Some paths explicitly carry facing; ordinary idle uses the player's
    // facing implicitly. Compare the visible direction, not optional metadata:
    // -1 -> undefined is not a turn and must not discard a held foot support.
    const facing = pose.facing ?? fallbackFacing;
    let state = this.states.get(id);
    if (!allowed || (pose.action !== 'idle' && pose.action !== 'shuffle')
      || state && state.facing !== facing) {
      this.states.delete(id);
      state = undefined;
      if (!allowed) return { pose };
    }
    if (pose.action === 'shuffle') {
      // The player resumes from the foot actually visible at rest. Do not
      // restart frame zero or use a stride accumulated behind a frozen body.
      const resumeFrame = state?.position;
      const resumed = resumeFrame === undefined ? pose
        : { ...pose, frame: Math.floor(resumeFrame), frameFloat: resumeFrame };
      this.states.set(id, { last: resumed, facing });
      return { pose: resumed, resumeFrame };
    }
    if (pose.action !== 'idle' || !state) return { pose };
    state.position ??= state.last.frame;
    state.target ??= shuffleSupportFrame(state.last.frame);
    state.position = Math.min(state.target, state.position + Math.max(0, dt) / SHUFFLE_SETTLE_FRAME_TIME);
    state.last = { ...state.last, frame: Math.floor(state.position + 1e-9), frameFloat: state.position };
    // A saved implicit mirror belonged to the earlier body orientation.
    // If a new tactical facing is pending, keep the held support facing the
    // old way until the illustrated pivot owns it; do not mirror for one tick.
    return { pose: state.facing !== undefined && state.facing !== fallbackFacing
      ? {...state.last, facing: state.facing} : state.last };
  }
}
