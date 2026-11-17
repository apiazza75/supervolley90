import { PIVOT_DURATION } from './facing-transition';
import { READY_LATERAL_FRAMES } from './ready-retreat';

/**
 * The redrawn entry (cells 0..5) now opens the shoulders progressively from
 * the defensive stance. Play it in source order into the retained later turn;
 * the former 0,1,2,6,7,8,3,4,5 mapping rewinds these newer entry drawings.
 * Use every drawing once, in the same order in the match and review gallery.
 */
export const PLANTED_TURN_FRAMES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;

export function plantedTurnFrame(step: number): number {
  return PLANTED_TURN_FRAMES[Math.max(0, Math.min(23, Math.floor(step)))];
}

/** The first half remains byte-identical to the running turn. Once braking
 * has been chosen, four authored poses open the crossed trailing foot and
 * lower the torso progressively into the retained left-facing stop drawing.
 * Keep both the midpoint decision and the total pivot duration unchanged.
 */
export const STOPPING_TURN_END_FRAMES = [24, 25, 26, 27, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;
export const STOPPING_TURN_REVIEW_FRAMES = [
  ...PLANTED_TURN_FRAMES.slice(0, 12), ...STOPPING_TURN_END_FRAMES,
] as const;

export function stoppingTurnFrame(phase: number): number {
  const progress = Math.max(0, Math.min(1, phase));
  if (progress < .5) return Math.floor(progress * 24);
  const index = Math.min(STOPPING_TURN_END_FRAMES.length - 1,
    Math.floor((progress - .5) * 2 * STOPPING_TURN_END_FRAMES.length));
  return STOPPING_TURN_END_FRAMES[index];
}

/** Reuse the authored grounded knee loading when an upright athlete turns.
 * A defender already in a low support needs no second loading gesture. */
export const STANDING_TURN_ENTRY_DURATION = .08;
export const STANDING_TURN_REVIEW_POSES = [
  ...READY_LATERAL_FRAMES.map(frame => ({ action: 'idle' as const, frame })),
  ...PLANTED_TURN_FRAMES.map(frame => ({ action: 'turn' as const, frame })),
];

export function standingTurnPose(phase: number): { action: 'idle' | 'turn'; frame: number } {
  const time = Math.max(0, Math.min(1, phase)) * PIVOT_DURATION;
  if (time < STANDING_TURN_ENTRY_DURATION) {
    return { action: 'idle', frame: READY_LATERAL_FRAMES[Math.min(3, Math.floor(time / STANDING_TURN_ENTRY_DURATION * 4))] };
  }
  return { action: 'turn', frame: plantedTurnFrame(
    (time - STANDING_TURN_ENTRY_DURATION) / (PIVOT_DURATION - STANDING_TURN_ENTRY_DURATION) * 24) };
}
