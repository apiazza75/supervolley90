import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_FORMAT,
  isMatchSetWon,
  matchSetTarget,
  normaliseMatchFormat,
  rallyAwardsPoint,
  setsToWin,
} from '../src/core/match-format';

describe('configurable volleyball match format', () => {
  it('preserves the original match when no setup is provided', () => {
    expect(normaliseMatchFormat()).toEqual({ bestOf: 5, scoring: 'rally25' });
    expect(setsToWin()).toBe(3);
    expect(matchSetTarget(4)).toBe(25);
    expect(matchSetTarget(5)).toBe(15);
  });

  it.each([3, 5] as const)('plays the deciding set to 15 in best of %i rally scoring', bestOf => {
    const format = { bestOf, scoring: 'rally25' } as const;
    expect(setsToWin(format)).toBe(bestOf === 3 ? 2 : 3);
    expect(matchSetTarget(bestOf - 1, format)).toBe(25);
    expect(matchSetTarget(bestOf, format)).toBe(15);
    expect(isMatchSetWon(15, 13, bestOf, format)).toBe(true);
    expect(isMatchSetWon(15, 13, bestOf - 1, format)).toBe(false);
  });

  it.each(['sideout15', 'rally15'] as const)('keeps every set at 15 for %s', scoring => {
    for (const bestOf of [3, 5] as const) {
      const format = { bestOf, scoring };
      for (let set = 1; set <= bestOf; set++) {
        expect(matchSetTarget(set, format)).toBe(15);
        expect(isMatchSetWon(14, 12, set, format)).toBe(false);
        expect(isMatchSetWon(15, 13, set, format)).toBe(true);
        expect(isMatchSetWon(15, 14, set, format)).toBe(false);
        expect(isMatchSetWon(22, 21, set, format)).toBe(false);
        expect(isMatchSetWon(23, 21, set, format)).toBe(true);
      }
    }
  });

  it('awards side-out points only when the rally winner was serving', () => {
    const format = { bestOf: 3, scoring: 'sideout15' } as const;
    expect(rallyAwardsPoint('home', 'home', format)).toBe(true);
    expect(rallyAwardsPoint('away', 'away', format)).toBe(true);
    expect(rallyAwardsPoint('home', 'away', format)).toBe(false);
    expect(rallyAwardsPoint('away', 'home', format)).toBe(false);
  });

  it.each(['rally15', 'rally25'] as const)('awards every rally in %s', scoring => {
    for (const winner of ['home', 'away'] as const) {
      for (const server of ['home', 'away'] as const) {
        expect(rallyAwardsPoint(winner, server, { bestOf: 5, scoring })).toBe(true);
      }
    }
  });

  it('requires a two-point lead with no artificial score cap', () => {
    expect(isMatchSetWon(24, 12, 1)).toBe(false);
    expect(isMatchSetWon(25, 23, 1)).toBe(true);
    expect(isMatchSetWon(25, 24, 1)).toBe(false);
    expect(isMatchSetWon(99, 98, 1)).toBe(false);
    expect(isMatchSetWon(100, 98, 1)).toBe(true);
  });

  it('normalises corrupt persisted options and returns an independent format', () => {
    for (const invalid of [null, false, 5, 'rally15', { bestOf: 7, scoring: 'custom' }]) {
      expect(normaliseMatchFormat(invalid)).toEqual(DEFAULT_MATCH_FORMAT);
    }
    const format = normaliseMatchFormat();
    format.bestOf = 3;
    expect(DEFAULT_MATCH_FORMAT.bestOf).toBe(5);
  });
});
