import type { Playhead } from './sprite-figure';
import { SHUFFLE_SPEED } from '../core/presentation';
import { runLegacyFrame } from './run-stride';

/** Each half of the atlas is a separate twelve-drawing, non-looping exit. */
export const RUN_BRAKE_DURATION = .30;
// At the middle drawing the trailing foot is still lifted. Continue with the
// matching low trailing-foot step instead of planting both feet on a body
// which is still travelling. Both braking variants converge to this support.
export const RUN_BRAKE_STEP_FRAME = 11;
export function brakingVariant(runFrame: number): 0 | 12 {
  runFrame = runLegacyFrame(runFrame);
  // Reviewed run keys: near-foot landing at 0, far-foot landing at 12;
  // the opposite knee is already advancing from 6 / 18 respectively.
  return runFrame >= 6 && runFrame < 18 ? 12 : 0;
}

interface State { last: Playhead; elapsed?: number; offset?: 0 | 12; settled?: boolean }
export class RunBrake {
  private readonly states = new Map<number, State>();
  reset(id?: number): void {
    if (id === undefined) this.states.clear(); else this.states.delete(id);
  }
  sample(id: number, pose: Playhead, dt: number, allowed: boolean, speed: number): { pose: Playhead; completed?: boolean } {
    const previous = this.states.get(id);
    const eligible = allowed && (pose.action === 'shuffle'
      || previous?.elapsed !== undefined && pose.action === 'idle');
    if (previous?.elapsed !== undefined && eligible && previous.last.facing === pose.facing) {
      previous.elapsed += Math.max(0, dt);
      if (previous.settled || previous.elapsed >= RUN_BRAKE_DURATION && pose.action === 'idle') {
        if (pose.action === 'idle') {
          // The last braking drawing is already a planted defensive rest.
          // Replacing it with upright idle popped the head/shoulders upward
          // after the feet stopped. Hold this support, not a looping brake.
          // The slow-departure filter may still present idle for one tick
          // while velocity rises; wait for its actual step, not a speed-only
          // exit which inserts an upright idle body before that step.
          previous.elapsed = RUN_BRAKE_DURATION;
          previous.settled = true;
          const frame = previous.offset! + 11;
          return { pose: { action: 'runBrake', frame, frameFloat: frame, facing: pose.facing } };
        }
        // A new step starts from planted feet, not the midpoint step used by
        // an athlete who continues travelling before the brake has finished.
        this.states.set(id, { last: pose });
        return { pose: { ...pose, frame: 0, frameFloat: 0 }, completed: true };
      }
      if (previous.elapsed >= RUN_BRAKE_DURATION / 2 && speed > SHUFFLE_SPEED && pose.action === 'shuffle') {
        this.states.set(id, { last: pose });
        return { pose: { ...pose, frame: RUN_BRAKE_STEP_FRAME, frameFloat: RUN_BRAKE_STEP_FRAME }, completed: true };
      }
      if (previous.elapsed >= RUN_BRAKE_DURATION) {
        this.states.set(id, { last: pose });
        return { pose: { ...pose, frame: 0, frameFloat: 0 }, completed: true };
      }
      const frameFloat = previous.offset! + Math.min(11, previous.elapsed / RUN_BRAKE_DURATION * 12);
      return { pose: { action: 'runBrake', frame: Math.floor(frameFloat), frameFloat, facing: pose.facing } };
    }
    if (eligible && speed > .15 && previous?.last.action === 'run' && previous.last.facing === pose.facing) {
      const offset = brakingVariant(previous.last.frame);
      this.states.set(id, { last: pose, elapsed: 0, offset });
      return { pose: { action: 'runBrake', frame: offset, frameFloat: offset, facing: pose.facing } };
    }
    // Contacts, licensed approaches, serves and turns interrupt immediately.
    this.states.set(id, { last: pose });
    return { pose };
  }
}
