import { describe, expect, it } from 'vitest';
import {
  CHARACTER_SIGNATURES,
  characterSignatureFor,
  characterSignatureId,
  countDistinctCharacterSignatures,
} from '../src/render/character-signature';
import { ARENA_V3_LAYER_NAMES, coverSourceRect } from '../src/render/arena-art';

describe('Recovery V3 character identities', () => {
  it('provides six distinct stable signatures for each on-court side', () => {
    const home = Array.from({ length: 6 }, (_, id) => ({ id }));
    const away = Array.from({ length: 6 }, (_, id) => ({ id: 100 + id }));
    expect(countDistinctCharacterSignatures(home)).toBe(6);
    expect(countDistinctCharacterSignatures(away)).toBe(6);
  });

  it('keeps the identity unchanged in replay id space', () => {
    for (let id = 0; id < 7; id++) {
      expect(characterSignatureId(id + 1000)).toBe(characterSignatureId(id));
      expect(characterSignatureFor(id + 1000)).toEqual(characterSignatureFor(id));
    }
  });

  it('contains six or more structurally different authored variants', () => {
    const structural = new Set(
      CHARACTER_SIGNATURES.map((s) =>
        [s.hair, s.beard, s.sleeves, s.pattern, s.kneePads, s.socks, s.shoes].join('|'),
      ),
    );
    expect(structural.size).toBeGreaterThanOrEqual(6);
  });
});

describe('Recovery V3 arena contract', () => {
  it('requires exactly five named layers', () => {
    expect(ARENA_V3_LAYER_NAMES).toEqual([
      'backdrop',
      'crowdFar',
      'ledMid',
      'floor',
      'foreground',
    ]);
  });

  it('cover-crops without distorting the source', () => {
    const crop = coverSourceRect(2560, 1440, 1280, 720);
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 2560, sh: 1440 });
  });
});
