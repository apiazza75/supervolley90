import { clamp } from '../core/math3';
import { FIXED_DT, POINT_BREAK_SECONDS, SET_BREAK_SECONDS } from '../core/rules';
import type { Phase } from '../core/world';

/** A brief scene dissolve covers the legal formation reset within the existing
 * break. The HUD stays visible and the match clock is never stopped or extended. */
export const ROUND_FADE_SECONDS = 0.08;
export function roundTransitionOpacity(phase: Phase, timer: number): number {
  const cover = FIXED_DT * 2;
  const fade = ROUND_FADE_SECONDS - cover;
  let amount = 0;
  if (phase === 'dead' || phase === 'setBreak') {
    const duration = phase === 'dead' ? POINT_BREAK_SECONDS : SET_BREAK_SECONDS;
    amount = clamp((timer - duration + ROUND_FADE_SECONDS) / fade, 0, 1);
  } else if (phase === 'serve') {
    amount = 1 - clamp((timer - cover) / fade, 0, 1);
  }
  return amount * amount * (3 - 2 * amount);
}
