import { describe, expect, it } from 'vitest';

import { v3 } from '../core/math3';
import { Effects } from './fx';
import {
  HOT_TIMING_GRAMMAR,
  POWER_FLOOR_SCAR_STYLE,
  POWER_VISUAL_GRAMMAR,
  VOLLEYBALL_PANEL_STRIPES,
} from './volleyball';

const deterministicRng = (): (() => number) => {
  let seed = 0xdecafbad;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
};

describe('volleyball rendering grammar', () => {
  it('uses one shared three-stripe panel geometry for normal and powered balls', () => {
    expect(VOLLEYBALL_PANEL_STRIPES).toHaveLength(3);
    expect(VOLLEYBALL_PANEL_STRIPES.map((s) => [s.top, s.bottom])).toEqual([
      [-1.05, -0.34],
      [-0.34, 0.3],
      [0.3, 1.05],
    ]);
    for (const stripe of VOLLEYBALL_PANEL_STRIPES) {
      expect(stripe.normal).toMatch(/^#/);
      expect(stripe.energized).toMatch(/^#/);
    }
  });

  it('keeps ball panel highlights out of hard-white player matte range', () => {
    const hexToRgb = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const isHardWhite = (hex: string): boolean => {
      const [r, g, b] = hexToRgb(hex);
      return r >= 242 && g >= 242 && b >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
    };

    for (const stripe of VOLLEYBALL_PANEL_STRIPES) {
      expect(isHardWhite(stripe.normal)).toBe(false);
      expect(isHardWhite(stripe.energized)).toBe(false);
    }
  });

  it('keeps super-shot effects on the energized volleyball palette', () => {
    const energized = VOLLEYBALL_PANEL_STRIPES.map((stripe) => stripe.energized);
    expect([POWER_VISUAL_GRAMMAR.cream, POWER_VISUAL_GRAMMAR.cyan, POWER_VISUAL_GRAMMAR.gold]).toEqual(
      energized,
    );

    expect(POWER_VISUAL_GRAMMAR.chevron).toBe(POWER_VISUAL_GRAMMAR.cream);
    expect(POWER_VISUAL_GRAMMAR.headline).toBe(POWER_VISUAL_GRAMMAR.gold);
    expect(POWER_VISUAL_GRAMMAR.trail).toContain('255,191,63');
    expect(POWER_VISUAL_GRAMMAR.shock).toContain('54,169,225');
    expect(POWER_VISUAL_GRAMMAR.spark).toContain('255,191,63');
  });

  it('marks the perfect timing window with an unambiguous red ball cue', () => {
    expect(HOT_TIMING_GRAMMAR.rim).toBe('#ff3048');
    expect(HOT_TIMING_GRAMMAR.fill).toContain('255,48,72');
    expect(HOT_TIMING_GRAMMAR.halo).toContain('255,48,72');
    expect(HOT_TIMING_GRAMMAR.outerHalo).toContain('255,48,72');
    expect(HOT_TIMING_GRAMMAR.spoke).toContain('255,48,72');
    expect(HOT_TIMING_GRAMMAR.label).toBe('PERFECT');
    expect(HOT_TIMING_GRAMMAR.minimumLiveRedPixels).toBeGreaterThanOrEqual(90);
  });

  it('builds the whole super-shot impact from ball-matched colors', () => {
    const fx = new Effects();
    fx.powerImpact(v3(0.2, -0.4, 1.6), 34, deterministicRng());
    expect(fx.snapshotForDiagnostics().cracks).toHaveLength(0);
    expect(fx.snapshotForDiagnostics().particles.some(p => p.kind === 'dust')).toBe(false);
    fx.powerFloorImpact(v3(0.2, 4, 0.105), 34, deterministicRng());
    const snapshot = fx.snapshotForDiagnostics();

    const particlesByKind = new Map<string, Set<string>>();
    for (const p of snapshot.particles) {
      const colors = particlesByKind.get(p.kind) ?? new Set<string>();
      colors.add(p.color);
      particlesByKind.set(p.kind, colors);
    }

    expect(particlesByKind.get('spark')).toEqual(new Set([POWER_VISUAL_GRAMMAR.spark]));
    expect(particlesByKind.get('dust')).toEqual(new Set([POWER_VISUAL_GRAMMAR.floor]));
    expect(particlesByKind.get('shock')).toEqual(
      new Set([POWER_VISUAL_GRAMMAR.spark, POWER_VISUAL_GRAMMAR.shock]),
    );
    expect(snapshot.cracks).toHaveLength(1);
    expect(snapshot.cracks[0]).toMatchObject({
      strokeColor: POWER_FLOOR_SCAR_STYLE.stroke,
      fillColor: POWER_FLOOR_SCAR_STYLE.fill,
    });
    expect(snapshot.cracks[0].arms).toBeGreaterThanOrEqual(4);
  });
});
