/** Rendering contract tests. Actual-match evidence lives in attack-review. */
import { describe, expect, it, vi } from 'vitest';
import { Ball } from '../src/core/ball';
import { Player, defaultStats } from '../src/core/player';
import { type World } from '../src/core/world';
import { Renderer, spriteStyleFor } from '../src/render/renderer';
import { Camera } from '../src/render/camera';
import { spriteContactPoint } from '../src/render/sprite-figure';

describe('illustrated contact effects', () => {
  it('retains backward-set hand registration after the player turns', () => {
    const p = new Player(7, 'home', 'setter', 'TEST', defaultStats());
    const ball = new Ball(), physicalPosition = { ...ball.pos };
    const renderer: Renderer = Object.assign(Object.create(Renderer.prototype), {
      camera: new Camera(), effects: { impact: vi.fn() }, arena: { cheer: vi.fn() }, sheets: {}, hitStop: 0, rand: () => .5,
    });
    const world = { findPlayer: () => p, team: () => ({ config: { colors: ['#286adc', '#e3e5df'] } }) } as unknown as World;
    renderer.handleEvents(world, [{ type: 'contact', kind: 'set', playerId: p.id, side: p.side,
      speed: 8, at: physicalPosition, height: 0, airborne: false, facing: -1, backSet: true }]);
    p.facing = 1;
    const visual = (renderer as any).viewContactBall(world, ball, 0) as Ball;
    const style = spriteStyleFor(p, ['#286adc', '#e3e5df']);
    const expected = spriteContactPoint(p, 'set', false, {}, style, renderer.camera.scaleAt(p.pos.x), -1, true);
    expect(visual.pos).toEqual(expected);
    expect(visual.pos).not.toEqual(spriteContactPoint(p, 'set', false, {}, style, renderer.camera.scaleAt(p.pos.x), -1, false));
    expect(ball.pos).toEqual(physicalPosition);
  });

  it.each(['spike', 'block', 'power', 'save'] as const)('%s effect shares the drawn ball hand anchor without moving physics', kind => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
    p.height = 1.2;
    const ball = new Ball();
    ball.pos = { x: 0.2, y: -0.4, z: 2 };
    const physicalPosition = { ...ball.pos };
    const effects = { impact: vi.fn(), powerImpact: vi.fn(), shockwave: vi.fn(), announce: vi.fn() };
    // Bypass only DOM/image loading; exercise the real event handler and ball
    // release code with a deterministic camera and spies on effect emission.
    const renderer: Renderer = Object.assign(Object.create(Renderer.prototype), {
      camera: new Camera(), effects, arena: { cheer: vi.fn() }, sheets: {}, hitStop: 0, callIndex: 0, rand: () => .5,
    });
    const world = { findPlayer: () => p, team: () => ({ config: { colors: ['#286adc', '#e3e5df'] } }) } as unknown as World;
    renderer.handleEvents(world, [{ type: 'contact', kind, playerId: p.id, side: p.side,
      speed: 29, at: { ...physicalPosition }, height: p.height, airborne: true, facing: 1 }]);
    // A cover assignment can turn the simulation before the next render.
    // The release must stay on the same side as the committed contact body.
    p.facing = -1;
    const visual = (renderer as any).viewContactBall(world, ball, 0) as Ball;
    const emittedAt = (kind === 'power' ? effects.powerImpact : effects.impact).mock.calls[0][0];
    expect(emittedAt).toEqual(visual.pos);
    expect(emittedAt.z).toBeGreaterThan(kind === 'save' ? 1 : 3);
    expect(ball.pos).toEqual(physicalPosition);
    expect(p.facing).toBe(-1);
    if (kind === 'spike' || kind === 'block') {
      expect(effects.announce.mock.calls[0][3]).toBe(18);
      expect(effects.announce.mock.calls[0][5]).toBe('corner');
    }
  });
});
