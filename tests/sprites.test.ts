import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import {
  CONTACT_FRAME,
  SpriteTimeline,
  spriteActionForContact,
} from '../src/render/sprite-figure';

const player = (): Player =>
  new Player(7, 'home', 'outside', 'TEST', defaultStats());

describe('sprite contact timeline', () => {
  const cases = [
    ['spike', false, 'spike', 19],
    ['power', true, 'spike', 19],
    ['tip', true, 'spike', 19],
    ['block', true, 'block', 16],
    ['bump', false, 'bump', 12],
    ['set', false, 'set', 11],
    ['save', false, 'dive', 13],
    ['serve', false, 'serve', 12],
    ['serve', true, 'jumpServe', 16],
  ] as const;

  it.each(cases)(
    '%s contact selects %s frame %i',
    (kind, airborne, action, frame) => {
      const p = player();
      const timeline = new SpriteTimeline();
      timeline.cue(p.id, kind, airborne);
      expect(timeline.frameFor(p, 0)).toMatchObject({ action, frame });
    },
  );

  it('keeps an authored contact exact even after another action was playing', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.vel.y = 4;
    expect(timeline.frameFor(p, 0.2).action).toBe('approach');
    timeline.cue(p.id, 'set', false);
    expect(timeline.frameFor(p, 0)).toMatchObject({ action: 'set', frame: 11 });
  });

  it('never asks for a blend between two whole bodies', () => {
    // The rejected build cross-faded `frame` and `nextFrame` at complementary
    // alpha, which is a double exposure. A playhead now names exactly one
    // authored drawing, so there is nothing for the renderer to blend.
    const p = player();
    const timeline = new SpriteTimeline();
    for (let i = 0; i < 120; i++) {
      const head = timeline.frameFor(p, 1 / 60);
      expect(Object.keys(head).sort()).toEqual(['action', 'frame', 'frameFloat']);
      expect(Number.isInteger(head.frame)).toBe(true);
      expect(head.frame).toBeGreaterThanOrEqual(0);
      expect(head.frame).toBeLessThanOrEqual(23);
    }
  });

  it('draws a body that has no presentation state', () => {
    // Replay rebuilds bodies from recorded frames: they carry a pose but no
    // presentation. Reading it unconditionally threw inside the render loop and
    // took the canvas down with it, so the screen went black the first time a
    // replay played. The timeline must tolerate the shape replay actually uses.
    const timeline = new SpriteTimeline();
    const ghost = {
      id: 1007,
      anim: 'run',
      vel: { x: 3, y: 0, z: 0 },
      height: 0,
      airborne: false,
      diving: false,
      swing: 0,
      facing: 1,
      pos: { x: 0, y: -3, z: 0 },
    } as unknown as Player;
    expect(() => timeline.frameFor(ghost, 1 / 60)).not.toThrow();
    expect(ghost.presentation).toBeUndefined();
  });

  it('distinguishes standing and jump serves', () => {
    expect(spriteActionForContact('serve', false)).toBe('serve');
    expect(spriteActionForContact('serve', true)).toBe('jumpServe');
    expect(CONTACT_FRAME.serve).toBe(12);
    expect(CONTACT_FRAME.jumpServe).toBe(16);
  });
});
