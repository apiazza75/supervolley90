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
      expect(timeline.frameFor(p, 0)).toMatchObject({ action, frame, nextFrame: frame, mix: 0 });
    },
  );

  it('keeps an authored contact exact even after another action was playing', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.vel.y = 4;
    expect(timeline.frameFor(p, 0.2).action).toBe('approach');
    timeline.cue(p.id, 'set', false);
    expect(timeline.frameFor(p, 0)).toMatchObject({ action: 'set', frame: 11, nextFrame: 11, mix: 0 });
  });

  it('distinguishes standing and jump serves', () => {
    expect(spriteActionForContact('serve', false)).toBe('serve');
    expect(spriteActionForContact('serve', true)).toBe('jumpServe');
    expect(CONTACT_FRAME.serve).toBe(12);
    expect(CONTACT_FRAME.jumpServe).toBe(16);
  });
});
