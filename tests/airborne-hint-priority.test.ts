import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { SpriteTimeline } from '../src/render/sprite-figure';

const player = () => new Player(3, 'home', 'middle', 'TEST', defaultStats());

describe('committed flight versus buffered contact hints', () => {
  it.each(['block', 'jump_rise', 'air_contact_jump_serve'] as const)('keeps %s art while the next touch is only buffered', anim => {
    const p = player(), clock = new SpriteTimeline();
    p.height = 1.4; p.vertVel = -.2; p.setAnim(anim);
    const expected = anim === 'block' ? 'block' : anim === 'jump_rise' ? 'spike' : 'jumpServe';
    const snapshot = JSON.stringify(p);
    for (const hint of ['set', 'bump', 'run', 'block', 'spike'] as const) {
      expect(clock.actionFor(p, hint)).toBe(expected);
      expect(clock.frameFor(p, 0, hint).action).toBe(expected);
    }
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('holds the jump through the final two centimetres before physical landing', () => {
    const p = player(), clock = new SpriteTimeline();
    p.height = .005; p.vertVel = -5; p.setAnim('block');
    expect(p.airborne).toBe(false);
    expect(clock.frameFor(p, 0, 'set').action).toBe('block');
  });

  it('allows an actual contact to interrupt the block instead of losing the touch', () => {
    const p = player(), clock = new SpriteTimeline();
    p.height = 1.4; p.vertVel = -.2; p.setAnim('block');
    clock.frameFor(p, .01, 'set');
    p.setAnim('set_contact'); clock.cue(p.id, 'set', true, 1);
    expect(clock.frameFor(p, .01, 'block')).toMatchObject({ action: 'set', frame: 9 });
  });

  it('keeps landing compression rather than a queued set or takeoff frame', () => {
    const p = player(), clock = new SpriteTimeline();
    p.setAnim('block'); p.height = 0; p.vertVel = 0;
    // Render projection reaches the floor just before the simulation does.
    expect(clock.frameFor(p, 0, 'set')).toMatchObject({ action: 'block', frame: 20 });
    p.setAnim('land'); p.animTime = .08;
    expect(clock.frameFor(p, 0, 'set')).toMatchObject({ action: 'block', frame: 27 });
  });

  it('retains ordinary grounded hints and zero-dt stability', () => {
    const p = player(), clock = new SpriteTimeline();
    expect(clock.frameFor(p, 0, 'set')).toMatchObject({ action: 'set', frame: 0 });
    expect(clock.frameFor(p, 0, 'set')).toMatchObject({ action: 'set', frame: 0 });
  });
});
