import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { CONTACT_FRAME, DURATION, SpriteTimeline, spriteActionForContact } from '../src/render/sprite-figure';

describe('contact drawings use the same centred clock as recovery', () => {
  it.each(['bump', 'set', 'serve'] as const)('keeps the exact %s contact on repeated paused draws', kind => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
    const clock = new SpriteTimeline(), action = spriteActionForContact(kind, false)!;
    clock.cue(p.id, kind, false, 1);
    const contact = clock.frameFor(p, 0);
    expect(contact).toMatchObject({ action, frame: CONTACT_FRAME[action], facing: 1 });
    for (let i = 0; i < 10; i++) {
      const paused = clock.frameFor(p, 0);
      expect(paused).toMatchObject({ action, frame: contact.frame, facing: contact.facing });
      expect(paused.frameFloat).toBeCloseTo(contact.frameFloat, 12);
    }
  });

  it.each(['bump', 'set', 'serve'] as const)('gives %s contact a visible half-cell before advancing, without delaying the touch', kind => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
    const clock = new SpriteTimeline(), action = spriteActionForContact(kind, false)!;
    clock.cue(p.id, kind, false, -1);
    expect(clock.frameFor(p, 0).frame).toBe(CONTACT_FRAME[action]);
    expect(clock.frameFor(p, DURATION[action] / 24 * .49).frame).toBe(CONTACT_FRAME[action]);
    expect(clock.frameFor(p, DURATION[action] / 24 * .02).frame).toBe(kind === 'bump' ? 24 : kind === 'serve' ? 28 : CONTACT_FRAME[action]! + 1);
  });

  it('keeps a back set contact still and allows another real contact to interrupt', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    clock.cue(p.id, 'set', false, -1, true);
    const pose = clock.frameFor(p, 0);
    expect(pose).toMatchObject({ action: 'backSet', frame: 9, facing: -1 });
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'backSet', frame: 9, facing: -1 });
    clock.cue(p.id, 'bump', false, 1);
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'bump', frame: 9, facing: 1 });
  });
});
