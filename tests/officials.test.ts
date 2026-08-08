import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Officials } from '../src/render/officials';

const source = readFileSync(resolve(__dirname, '../src/render/officials.ts'), 'utf8');

/**
 * The officials are not players, and must not be drawn as if they were.
 *
 * The previous version imported the player figure pipeline and dressed
 * athletes in referee colours. That is why they read as a seventh player at
 * the net: same anatomy, same animation state, same palette. This is a static
 * check because the failure mode is a re-import, and by the time it shows up
 * in a screenshot the reason is no longer obvious.
 */
describe('officials are drawn by their own code', () => {
  const forbidden = ['Player', 'drawPlayer', 'drawFrame', 'SheetSet', 'SpritePalette'];

  // Only the import section: the words may legitimately appear in prose below.
  const imports = source
    .split('\n')
    .filter((l) => l.startsWith('import ') || /^\s+[A-Za-z{},* ]+ from '/.test(l))
    .join('\n');

  it.each(forbidden)('does not import %s', (name) => {
    expect(imports).not.toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('pulls nothing at all from the player renderer or the sprite sheets', () => {
    expect(source).not.toMatch(/from '\.\/players'/);
    expect(source).not.toMatch(/from '\.\/sprites'/);
    expect(source).not.toMatch(/from '\.\.\/core\/player'/);
  });

  it('fields no ball kids', () => {
    expect(new Officials().ballKids.length).toBe(0);
    expect(source).not.toMatch(/\bkid\b/i);
  });

  it('holds a line judge signal and then lets it go', () => {
    const o = new Officials();
    o.callLine(COURT_X, COURT_Y, false);
    o.update(0.1);
    // Still signalling a moment later, and clear well before the next rally.
    o.update(0.5);
    o.update(5);
    expect(() => o.update(0.016)).not.toThrow();
  });
});

const COURT_X = 5.6;
const COURT_Y = -9.9;
