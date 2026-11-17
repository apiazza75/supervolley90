import { describe, expect, it } from 'vitest';
import { contactSparkCount, Effects } from '../src/render/fx';
import { Camera } from '../src/render/camera';
import { POWER_VISUAL_GRAMMAR } from '../src/render/volleyball';

describe('contact accents do not cover the manga contact drawing', () => {
  it.each([0, 2.25, 7, 16, 34, 100])('bounds the number of sparks at power %s', power => {
    const count = contactSparkCount(power);
    expect(count).toBeGreaterThanOrEqual(4); expect(count).toBeLessThanOrEqual(18);
    const fx = new Effects(); fx.impact({ x: 0, y: -3, z: 2 }, power, () => .5);
    expect(fx.snapshotForDiagnostics().particles.filter(p => p.kind === 'spark')).toHaveLength(count);
  });

  it('draws each accent once as a narrow taper, without the opaque cream square', () => {
    const fx = new Effects(); fx.impact({ x: 0, y: -3, z: 2 }, 2.25, () => .5, 'rgba(230,240,255,');
    let points: number[][] = [];
    const fills: { points: number[][]; color: string }[] = [];
    const ctx: any = {
      save() {}, restore() {}, stroke() {}, closePath() {},
      beginPath() { points = []; },
      moveTo(x: number, y: number) { points.push([x, y]); },
      lineTo(x: number, y: number) { points.push([x, y]); },
      fill() { fills.push({ points: [...points], color: ctx.fillStyle }); },
    };
    fx.draw(ctx, new Camera());
    expect(fills).toHaveLength(contactSparkCount(2.25));
    for (const fill of fills) {
      expect(fill.points).toHaveLength(3);
      expect(fill.color).toContain('230,240,255');
      const [a, , b] = fill.points;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(8);
    }
  });

  it('preserves the super-shot palette and clears expired accents', () => {
    const fx = new Effects(); fx.powerImpact({ x: 0, y: -3, z: 2 }, 34, () => .5);
    const sparks = fx.snapshotForDiagnostics().particles.filter(p => p.kind === 'spark');
    expect(sparks).toHaveLength(18);
    expect(new Set(sparks.map(p => p.color))).toEqual(new Set([POWER_VISUAL_GRAMMAR.spark]));
    fx.update(3);
    expect(fx.snapshotForDiagnostics().particles).toHaveLength(0);
  });
});
