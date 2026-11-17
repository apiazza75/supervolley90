import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { GAME_SPEED } from '../src/core/rules';
import { BUMP_PREPARATION_FRAMES } from '../src/render/bump-preparation';
import { BUMP_FOLLOW_FRAMES, CONTACT_FRAME, DURATION, SpriteTimeline } from '../src/render/sprite-figure';

describe('authored bagher follow-through inbetweens', () => {
  it.each([60, 90, 120, 144])('shows every new drawing in chronological order at %s Hz without changing the player', hz => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    clock.cue(p.id, 'bump', false, 1);
    const frames: number[] = [];
    const step = GAME_SPEED / hz;
    const duration = DURATION.bump * (24 - CONTACT_FRAME.bump!) / 24;
    for (let t = 0; t < duration; t += step) {
      const before = JSON.stringify(p), pose = clock.frameFor(p, t === 0 ? 0 : step);
      expect(pose.action).toBe('bump');
      expect(JSON.stringify(p)).toBe(before);
      expect(clock.frameFor(p, 0)).toEqual(pose);
      frames.push(pose.frame);
    }
    expect([...new Set(frames)]).toEqual(BUMP_FOLLOW_FRAMES);
    clock.cue(p.id, 'set', false, -1);
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'set', frame: 9, facing: -1 });
  });

  it('does not play the new follow-through before an actual contact', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.setAnim('bump_ready');
    for (let i = 0; i < 120; i++) {
      p.animTime = i / 120;
      expect(BUMP_PREPARATION_FRAMES).toContain(clock.frameFor(p, 1 / 120).frame);
    }
  });
});
