import type { Playhead } from './sprite-figure';
import { MOVING_SET_PREPARATION_FRAMES, SET_GATHER_FRAMES, SET_PREPARATION_FRAMES } from './set-gather';
import { BUMP_GATHER_FRAMES, BUMP_PREPARATION_FRAMES, BUMP_MOVING_ENTRY_FRAMES, RETREAT_BUMP_PREPARATION_FRAMES, LATERAL_BUMP_PREPARATION_FRAMES } from './bump-preparation';
import { BUMP_RELEASE_DURATION, BUMP_RELEASE_FRAMES } from './bump-release';

interface Preparation {
  pose: Playhead;
  releasing: boolean;
  position: number;
  /** Chronological pose order, not atlas indices (new set entry is 24..27). */
  frames: readonly number[];
  shuffleReleaseAge?: number;
}

/** An abandoned receive/set is not a contact: open the arms back through
 * the existing preparation drawings, never through the ball-touch frame.
 * This owns only presentation; a real contact or airborne skill interrupts it.
 */
export class PreparationRelease {
  private readonly states = new Map<number, Preparation>();

  reset(id?: number): void {
    if (id === undefined) this.states.clear();
    else this.states.delete(id);
  }

  sample(id: number, pose: Playhead, preparing: boolean, canRelease: boolean,
    dt: number, speed: number): Playhead {
    const state = this.states.get(id);
    const step = Math.max(0, dt) / (speed > .8 ? .0125 : .02);
    const gather = pose.action === 'set' && (SET_GATHER_FRAMES as readonly number[]).includes(pose.frame)
      || pose.action === 'bump' && (BUMP_GATHER_FRAMES as readonly number[]).includes(pose.frame);
    if (preparing && (pose.action === 'bump' || pose.action === 'set') && (pose.frame < 9 || gather)) {
      const sameAction = state?.pose.action === pose.action;
      if (sameAction && state.shuffleReleaseAge !== undefined) {
        // If the incoming ball becomes ours again, close the hands through
        // the visible release poses. Never teleport from a hand near the hip
        // back to the fully extended platform merely because animTime reset.
        if (state.shuffleReleaseAge > 0 || dt === 0) {
          state.shuffleReleaseAge = Math.max(0,state.shuffleReleaseAge-Math.max(0,dt));
          const frame = BUMP_RELEASE_FRAMES[Math.min(BUMP_RELEASE_FRAMES.length-1,
            Math.floor(state.shuffleReleaseAge/BUMP_RELEASE_DURATION*BUMP_RELEASE_FRAMES.length))];
          return state.pose = { ...state.pose,frame,frameFloat:frame };
        }
        delete state.shuffleReleaseAge;
        state.position = state.frames.indexOf(6);
      }
      const frames = pose.action === 'bump'
        ? (BUMP_MOVING_ENTRY_FRAMES as readonly number[]).includes(pose.frame) ? RETREAT_BUMP_PREPARATION_FRAMES
          : (BUMP_RELEASE_FRAMES as readonly number[]).includes(pose.frame) ? LATERAL_BUMP_PREPARATION_FRAMES
          : sameAction ? state.frames : BUMP_PREPARATION_FRAMES
        : gather ? MOVING_SET_PREPARATION_FRAMES
        : sameAction ? state.frames : SET_PREPARATION_FRAMES;
      const at = frames.indexOf(pose.frame), end = frames.length - 1;
      // Remap an existing pose if a restarted preparation introduces the
      // extended entry. Never interpret atlas index 27 as 27 time steps.
      const previous = sameAction ? frames === state.frames ? state.position
        : frames.indexOf(state.pose.frame) : at;
      // If the tactical intention returns during release, continue from the
      // visible pose instead of snapping back to the fully prepared frame.
      const position = state?.releasing && sameAction && state.shuffleReleaseAge === undefined
        ? Math.min(end, previous + step) : Math.max(previous, at);
      const frame = frames[Math.round(position)];
      const sample = { ...pose, frame, frameFloat: frame };
      this.states.set(id, { pose: sample, releasing: !!state?.releasing && position < end, position, frames });
      return sample;
    }
    if (!state || !canRelease) {
      this.states.delete(id);
      return pose;
    }
    // Joined-forearm preparation is not a moving defensive stance. Once it
    // reaches pose6 on the way out, release the arms while transferring weight
    // into the next lateral step, rather than standing back up through idle.
    // A pause keeps the same drawing, including at the exit. Contacts and
    // renewed preparation above always take priority over this one-shot.
    if (state.shuffleReleaseAge !== undefined) {
      const age = state.shuffleReleaseAge + Math.max(0,dt);
      if (age < BUMP_RELEASE_DURATION || dt === 0) {
        state.shuffleReleaseAge = age;
        const frame = BUMP_RELEASE_FRAMES[Math.min(BUMP_RELEASE_FRAMES.length-1,
          Math.floor(age/BUMP_RELEASE_DURATION*BUMP_RELEASE_FRAMES.length))];
        return state.pose = { ...state.pose,frame,frameFloat:frame };
      }
      this.states.delete(id);
      return pose;
    }
    if (dt > 0 && state.pose.action === 'bump' && pose.action === 'shuffle' && speed > .12
      && state.position >= state.frames.indexOf(6) && state.position < state.frames.indexOf(6) + 1) {
      state.shuffleReleaseAge = 0; state.releasing = true;
      const frame = BUMP_RELEASE_FRAMES[0];
      return state.pose = { ...state.pose,frame,frameFloat:frame };
    }
    // Give the first preparation pose a display before returning to locomotion.
    // Repainting a paused game must neither advance nor finish this release.
    if (state.releasing && state.position === 0 && dt > 0) {
      // The new gather begins in a low, planted defensive stance. Returning
      // straight to the taller idle drawing would pop the torso back up.
      // Keep that real support while resting; movement and skills release it.
      if ((state.frames === MOVING_SET_PREPARATION_FRAMES || state.frames === RETREAT_BUMP_PREPARATION_FRAMES || state.frames === LATERAL_BUMP_PREPARATION_FRAMES)
        && pose.action === 'idle' && speed < .12) return state.pose;
      this.states.delete(id);
      return pose;
    }
    state.position = Math.max(0, state.position - step);
    state.releasing = true;
    const frame = state.frames[Math.round(state.position)];
    state.pose = { ...state.pose, frame, frameFloat: frame };
    return state.pose;
  }
}
