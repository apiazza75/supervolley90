import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { FIXED_DT, GAME_SPEED } from '../src/core/rules';
import { Renderer } from '../src/render/renderer';
import { diveFrameForPlayer, DIVE_FLOOR_FRAMES, DIVE_RECOVERY_FRAMES } from '../src/render/sprite-figure';

const renderer = Object.create(Renderer.prototype) as Renderer;
const view = (p: Player, lead: number): Player => (renderer as any).viewPlayer(p, lead);
function diver() {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
  p.pos.y = -7; p.dive(.2, 1); return p;
}

describe('dive uses the same fractional display clock as the other bodies', () => {
  it('does not freeze the airborne body between physics updates or write through to the simulation', () => {
    const p = diver(), before = JSON.stringify(p);
    const a = view(p, FIXED_DT * .2), b = view(p, FIXED_DT * .8);
    expect(a).not.toBe(p);
    expect(b.pos.y).toBeGreaterThan(a.pos.y);
    expect(b.height).toBeGreaterThan(a.height);
    expect(b.animTime).toBeGreaterThan(a.animTime);
    expect(JSON.stringify(p)).toBe(before);
    expect(view(p, 0)).toBe(p);
  });

  it('meets the next real physics position including dive and slide friction', () => {
    const p = diver(); let flights = 0, slides = 0;
    while (p.diving || p.downTime > FIXED_DT) {
      if (p.diving) flights++; else slides++;
      const snapshot = JSON.stringify(p), projected = view(p, FIXED_DT);
      const next = { pos: { ...projected.pos }, height: projected.height };
      expect(JSON.stringify(p)).toBe(snapshot);
      p.step(FIXED_DT, 0, 0);
      expect(next.pos.x).toBeCloseTo(p.pos.x, 12);
      expect(next.pos.y).toBeCloseTo(p.pos.y, 12);
      expect(next.height).toBeCloseTo(p.height, 12);
    }
    expect(flights).toBeGreaterThan(10); expect(slides).toBeGreaterThan(10);
  });

  it.each([59.94, 60, 75, 90, 120, 144])('does not rewind the drawn dive as the %s Hz display crosses fixed updates', hz => {
    const p = diver(); let accumulator = 0, last = -1, samples = 0;
    const order = [...Array.from({ length: 12 }, (_, i) => i), ...DIVE_FLOOR_FRAMES, ...DIVE_RECOVERY_FRAMES];
    for (let frame = 0; frame < hz * 4; frame++) {
      accumulator += GAME_SPEED / hz;
      while (accumulator >= FIXED_DT) { p.step(FIXED_DT, 0, 0); accumulator -= FIXED_DT; }
      if (!p.diving && p.downTime <= 0 && p.gettingUp <= 0) break;
      const snapshot = JSON.stringify(p), shown = view(p, accumulator);
      const pose = diveFrameForPlayer(shown), index = order.indexOf(pose.frame);
      expect(index).toBeGreaterThanOrEqual(last); last = index; samples++;
      expect(JSON.stringify(p)).toBe(snapshot);
      expect(diveFrameForPlayer(view(p, accumulator))).toEqual(pose);
      if (p.height > 0) expect(pose.frame).toBeLessThan(12);
      if (p.gettingUp > 0) expect(shown.pos).toEqual(p.pos);
    }
    expect(samples).toBeGreaterThan(60); expect(last).toBe(order.length - 1);
  });

  it('never projects a sliding body through its own side of the net', () => {
    const p = diver(); p.pos.y = -.85;
    const shown = view(p, FIXED_DT * .9);
    expect(shown.pos.y).toBeLessThanOrEqual(-.85);
    expect(p.pos.y).toBe(-.85);
  });
});
