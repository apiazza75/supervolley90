import type { Playhead } from './sprite-figure';

export const BACKPEDAL_SETTLE_FRAME_TIME = .018;
/** Reviewed full-weight support drawings are 0 and 12. Finish only the step
 * already started; an unwrapped target of 24 means frame zero, not a restart. */
export function backpedalSupportPosition(frame: number): number {
  return Math.ceil(frame / 12) * 12;
}

interface State { last: Playhead; facing?: -1 | 1; position?: number; target?: number }
export class BackpedalSettle {
  private readonly states = new Map<number, State>();

  reset(id?: number): void {
    if (id === undefined) this.states.clear(); else this.states.delete(id);
  }

  sample(id: number, pose: Playhead, dt: number, allowed: boolean, fallbackFacing?: -1 | 1): { pose: Playhead; resumeFrame?: number } {
    const facing = pose.facing ?? fallbackFacing;
    let state = this.states.get(id);
    if (!allowed || (pose.action !== 'idle' && pose.action !== 'backpedal') || state && state.facing !== facing) {
      this.states.delete(id); state = undefined;
      if (!allowed) return { pose };
    }
    if (pose.action === 'backpedal') {
      const resumeFrame = state?.position === undefined ? undefined : state.position % 24;
      const resumed = resumeFrame === undefined ? pose
        : { ...pose, frame: Math.floor(resumeFrame + 1e-9) % 24, frameFloat: resumeFrame };
      this.states.set(id, { last: resumed, facing });
      return { pose: resumed, resumeFrame };
    }
    if (pose.action !== 'idle' || !state) return { pose };
    state.position ??= state.last.frame;
    state.target ??= backpedalSupportPosition(state.last.frame);
    state.position = Math.min(state.target, state.position + Math.max(0, dt) / BACKPEDAL_SETTLE_FRAME_TIME);
    state.last = { ...state.last, frame: Math.floor(state.position + 1e-9) % 24, frameFloat: state.position % 24 };
    return { pose: state.facing !== undefined && state.facing !== fallbackFacing
      ? {...state.last, facing: state.facing} : state.last };
  }
}
