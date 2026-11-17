import type {Playhead} from './sprite-figure';
import {shuffleSupportFrame, SHUFFLE_SETTLE_FRAME_TIME} from './shuffle-settle';
import {backpedalSupportPosition, BACKPEDAL_SETTLE_FRAME_TIME} from './backpedal-settle';

export const WALK_RELEASE_FRAMES = [24, 28, 29, 30, 31, 25, 26, 27] as const;
export const WALK_RELEASE_DURATION = .20;
interface State {
  last: Playhead;
  support?: {action: 'shuffle' | 'backpedal'; position: number; target: number};
  age?: number;
  standing?: boolean;
}

/** A tactical role change is not an instantaneous change of body posture.
 * Finish the existing low foot support, then rise through the authored
 * walking-entry drawings. This is presentation only: contacts, turns and
 * renewed defensive movement remain immediate. */
export class WalkRelease {
  private readonly states = new Map<number, State>();
  lastPose(id: number): Playhead | undefined { return this.states.get(id)?.last; }
  reset(id?: number): void {
    if (id === undefined) this.states.clear(); else this.states.delete(id);
  }

  sample(id: number, pose: Playhead, dt: number, allowed: boolean, fallbackFacing?: -1 | 1): {pose: Playhead; pinGait?: boolean} {
    const original = pose;
    if (pose.facing === undefined && fallbackFacing !== undefined) pose = {...pose, facing: fallbackFacing};
    let state = this.states.get(id);
    const source = state?.last;
    // Turn drawings rotate inside the atlas; their final silhouette faces
    // opposite the input mirror flag. Match its visible direction at exit.
    const sourceFacing = source && (source.action === 'turn' || source.action === 'turnStop') && source.frame >= 12
      ? source.facing === 1 ? -1 : 1 : source?.facing;
    const active = state?.age !== undefined || state?.support !== undefined || state?.standing;
    const canContinue = allowed && sourceFacing === pose.facing
      && (pose.action === 'walk' || active && pose.action === 'idle');
    if (!canContinue) {
      this.states.set(id, {last: pose});
      return {pose: original};
    }
    if (active && dt <= 0) return {pose: state!.last, pinGait: true};
    if (!active) {
      if (source?.action === 'shuffle' || source?.action === 'backpedal') {
        state = {last: source, support: {action: source.action, position: source.frame,
          target: source.action === 'shuffle' ? shuffleSupportFrame(source.frame) : backpedalSupportPosition(source.frame)}};
      } else if (source && ((source.action === 'turn' || source.action === 'turnStop') && source.frame === 23
        || source.action === 'runBrake' && source.frame % 12 === 11)) {
        // A completed planted pivot is already nearly upright. Its matching
        // entry is drawing 26, not the low-crouch drawing 24.
        state = {last: source, age: source.action === 'turn' ? WALK_RELEASE_DURATION * 6 / 8 : 0};
      } else {
        this.states.set(id, {last: pose});
        return {pose: original};
      }
      this.states.set(id, state);
    } else if (state?.standing) {
      if (pose.action === 'idle') return {pose: state.last};
      this.states.set(id, {last: pose});
      return {pose: original};
    }
    if (!state) return {pose};
    if (state.support) {
      const s = state.support;
      if (s.position < s.target) {
        const frameTime = s.action === 'shuffle' ? SHUFFLE_SETTLE_FRAME_TIME : BACKPEDAL_SETTLE_FRAME_TIME;
        s.position = Math.min(s.target, s.position + Math.max(0, dt) / frameTime);
        const frame = Math.floor(s.position + 1e-9) % 24;
        const support = {...pose, action: s.action, frame, frameFloat: s.position % 24};
        state.last = support;
        return {pose: support, pinGait: true};
      }
      delete state.support;
      state.age = s.action === 'shuffle' && (s.target === 6 || s.target === 0)
        ? WALK_RELEASE_DURATION * 5 / 8 : 0;
    } else if (active) state.age = (state.age ?? 0) + Math.max(0, dt);
    const index = Math.floor(((state.age ?? 0) + 1e-9) / WALK_RELEASE_DURATION * WALK_RELEASE_FRAMES.length);
    const frame = index < WALK_RELEASE_FRAMES.length ? WALK_RELEASE_FRAMES[index] : 0;
    const released: Playhead = {...pose, action: 'walk', frame, frameFloat: frame};
    state.last = released;
    if (index >= WALK_RELEASE_FRAMES.length) {
      this.states.set(id, pose.action === 'idle' ? {last: released, standing: true} : {last: released});
    }
    return {pose: released, pinGait: true};
  }
}
