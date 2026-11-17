import type { Side } from './rules';

export type MatchScoring = 'sideout15' | 'rally25' | 'rally15';

export interface MatchFormat {
  /** Best of three means two sets to win; best of five means three. */
  bestOf: 3 | 5;
  scoring: MatchScoring;
}

/** Preserve the original five-set, 25-point match when no option is supplied. */
export const DEFAULT_MATCH_FORMAT: Readonly<MatchFormat> = Object.freeze({ bestOf: 5, scoring: 'rally25' });

export function normaliseMatchFormat(value?: unknown): MatchFormat {
  const candidate = value && typeof value === 'object' ? value as Partial<MatchFormat> : {};
  return {
    bestOf: candidate.bestOf === 3 ? 3 : 5,
    scoring: candidate.scoring === 'sideout15' || candidate.scoring === 'rally15'
      ? candidate.scoring : 'rally25',
  };
}

export const setsToWin = (format: MatchFormat = DEFAULT_MATCH_FORMAT): number =>
  (format.bestOf + 1) / 2;

export const matchSetTarget = (setNumber: number, format: MatchFormat = DEFAULT_MATCH_FORMAT): number =>
  format.scoring === 'rally25' && setNumber < format.bestOf ? 25 : 15;

/** Every format keeps the two-point lead, including 15-point side-out games. */
export const isMatchSetWon = (
  mine: number,
  theirs: number,
  setNumber: number,
  format: MatchFormat = DEFAULT_MATCH_FORMAT,
): boolean => mine >= matchSetTarget(setNumber, format) && mine - theirs >= 2;

/** A receiver winning a side-out rally earns the serve, but no score point. */
export const rallyAwardsPoint = (
  winner: Side,
  server: Side,
  format: MatchFormat = DEFAULT_MATCH_FORMAT,
): boolean => format.scoring !== 'sideout15' || winner === server;

export function matchFormatLabel(format: MatchFormat): string {
  const length = `${setsToWin(format)} su ${format.bestOf}`;
  if (format.scoring === 'sideout15') return `${length} · 15 con cambio palla`;
  if (format.scoring === 'rally15') return `${length} · 15 tie-break`;
  return `${length} · 25 punti, decisivo a 15`;
}
