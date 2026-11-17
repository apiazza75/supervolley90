import { describe, expect, it, vi } from 'vitest';
import { ATTACK_LINE } from '../core/rules';
import { COURT_ART_CONTRACT, COURT_LINE_YS, COURT_SURFACE_POLYGON, NET_PALETTE } from './arena';
import { ArenaArtwork, GRANDSTAND_MANGA_SOURCE, coverSourceRect, netDestinationRect, floorMaterialSourceRect, FLOOR_MANGA_SOURCE, FLOOR_MATERIAL_REPEAT } from './arena-art';

describe('illustrated arena geometry', () => {
  it('loads and draws the revised crowd without stretching the original panorama', () => {
    const requests: string[] = [];
    class TestImage {
      complete = true;
      naturalWidth = 2048;
      naturalHeight = 768;
      onload?: () => void;
      set src(value: string) { requests.push(value); this.onload?.(); }
    }
    vi.stubGlobal('Image', TestImage);
    try {
      const arena = new ArenaArtwork(), drawImage = vi.fn();
      expect(requests).toContain(`/arena/v3/${GRANDSTAND_MANGA_SOURCE}`);
      expect(requests).not.toContain('/arena/v3/grandstand-manga.png');
      expect(requests).not.toContain('/arena/v3/grandstand-manga-v2.png');
      expect(arena.drawCrowdFar({drawImage} as unknown as CanvasRenderingContext2D, 1280, 720)).toBe(true);
      expect(drawImage).toHaveBeenCalledTimes(1);
      const [image, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0];
      expect(image).toBeInstanceOf(TestImage);
      expect([sx, sy, sw, sh, dx, dy, dw, dh]).toEqual([0, 304, 2048, 464, -0, 20, 1280, 290]);
      expect(dw / sw).toBe(dh / sh);
    } finally { vi.unstubAllGlobals(); }
  });

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

  it('does not draw a duplicate centre court line under the net', () => {
    expect(COURT_LINE_YS).toEqual([-ATTACK_LINE, ATTACK_LINE]);
    expect(COURT_LINE_YS).not.toContain(0);
  });

  it('fills the court as one continuous polygon with no centre seam', () => {
    expect(COURT_SURFACE_POLYGON).toHaveLength(4);
    expect(COURT_SURFACE_POLYGON.some(([, y]) => y === 0)).toBe(false);
  });

  it('keeps the runtime court in the same cel-shaded manga art language as players', () => {
    expect(COURT_ART_CONTRACT.surface).toBe('single-projected-cel-shaded-parquet');
    expect(COURT_ART_CONTRACT.outline).toBe('warm-dark-inked-court-edge');
    expect(COURT_ART_CONTRACT.lineColour).toBe('warm-cream-not-hard-white');
    expect(COURT_ART_CONTRACT.texture).toBe('authored-manga-parquet-and-teal-surface');
  });

  it('keeps net tape and antenna highlights out of hard-white player matte range', () => {
    const hexToRgb = (hex: string) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) throw new Error(`expected hex colour, got ${hex}`);
      const n = Number.parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const isHardWhite = (hex: string): boolean => {
      const [r, g, b] = hexToRgb(hex);
      return r >= 242 && g >= 242 && b >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
    };

    expect(isHardWhite(NET_PALETTE.tape)).toBe(false);
    expect(isHardWhite(NET_PALETTE.antennaLight)).toBe(false);
  });

  it('crops the illustrated stands without stretching faces', () => {
    const crop = coverSourceRect(2048, 768, 2560, 580);
    expect(crop.sw / crop.sh).toBeCloseTo(2560 / 580);
    expect(crop.sw).toBe(2048);
    expect(crop.sh).toBeLessThan(768);
  });

  it('keeps wood and teal in separate atlas halves without sampling the join', () => {
    expect(FLOOR_MANGA_SOURCE).toBe('surface-manga.png');
    const wood = floorMaterialSourceRect(1254, 1254, 'wood');
    const teal = floorMaterialSourceRect(1254, 1254, 'teal');
    expect(wood).toEqual({ sx: 1, sy: 1, sw: 1252, sh: 625 });
    expect(teal).toEqual({ sx: 1, sy: 628, sw: 1252, sh: 625 });
    expect(wood.sy + wood.sh).toBeLessThan(teal.sy);
    expect(teal.sy + teal.sh).toBeLessThan(1254);
    expect(FLOOR_MATERIAL_REPEAT.wood).toBe(4);
    expect(9 / (12 * FLOOR_MATERIAL_REPEAT.wood)).toBeCloseTo(.1875);
  });
});
