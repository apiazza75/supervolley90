import { BUMP_RELEASE_FRAMES } from './bump-release';
/** Pose 5 belongs before 3: after 4 it raised the torso during a crouch.
 * Four authored inbetweens subdivide the final hip hinge before pose 7. */
export const BUMP_PREPARATION_FRAMES = [0,1,2,5,3,4,6,28,29,30,31,7,8] as const;
export const BUMP_MOVING_ENTRY_FRAMES = [40,41,42,43] as const;
/** A retreating defender is already low: gather the feet and hands without
 * standing up through the idle-origin preparation. Contact time is unchanged. */
export const RETREAT_BUMP_PREPARATION_FRAMES = [...BUMP_MOVING_ENTRY_FRAMES,6,28,29,30,31,7,8] as const;
/** The authored hand release is reversible while grounded: close the same
 * forearms from the lateral support, then continue the existing hip hinge. */
export const LATERAL_BUMP_PREPARATION_FRAMES = [...[...BUMP_RELEASE_FRAMES].reverse(),6,28,29,30,31,7,8] as const;
export type BumpPreparationOrigin = 'standing' | 'retreat' | 'lateral' | 'running';
export const BUMP_GATHER_FRAMES = [28,29,30,31,...BUMP_MOVING_ENTRY_FRAMES,...BUMP_RELEASE_FRAMES] as const;
export function bumpPreparationFrame(time: number, origin: BumpPreparationOrigin = 'standing'): number {
  const frames = origin === 'lateral' ? LATERAL_BUMP_PREPARATION_FRAMES
    : origin === 'retreat' || origin === 'running' ? RETREAT_BUMP_PREPARATION_FRAMES : BUMP_PREPARATION_FRAMES;
  return frames[Math.min(frames.length-1,
    Math.floor(Math.max(0,time)/.18*frames.length))];
}
