import { describe, expect, it } from 'vitest';
import { coverSourceRect, netDestinationRect } from './arena-art';

describe('illustrated arena geometry', () => {
  it('centre-crops a panoramic backdrop into a 16:9 viewport', () => {
    const crop = coverSourceRect(2560, 900, 1280, 720);
    expect(crop.sx).toBeCloseTo(480);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBeCloseTo(1600);
    expect(crop.sh).toBe(900);
  });

  it('does not crop a backdrop with the destination aspect ratio', () => {
    expect(coverSourceRect(2560, 900, 1280, 450)).toEqual({
      sx: 0,
      sy: 0,
      sw: 2560,
      sh: 900,
    });
  });

  it('keeps a side-on net narrow and vertically anchored', () => {
    const rect = netDestinationRect(640, 120, 650, 50);
    expect(rect.width).toBeCloseTo(39);
    expect(rect.x).toBeCloseTo(620.5);
    expect(rect.y).toBe(120);
    expect(rect.height).toBe(530);
  });
});
