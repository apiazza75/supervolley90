import { describe, expect, it } from 'vitest';
import { ShuffleSettle, SHUFFLE_SETTLE_FRAME_TIME, shuffleSupportFrame } from '../src/render/shuffle-settle';
import { DURATION, SpriteTimeline, type Playhead } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';

const pose = (action: Playhead['action'], frame = 0, facing: 1 | -1 = 1): Playhead => ({ action, frame, frameFloat: frame, facing });

describe('natural finish of defensive steps', () => {
  it.each(Array.from({ length: 24 }, (_, i) => i))('finishes shuffle frame %i at a planted drawing, then remains still', frame => {
    const clock = new ShuffleSettle(); clock.sample(1, pose('shuffle', frame), 0, true);
    let last = frame;
    for (let i = 0; i < 100; i++) {
      const result = clock.sample(1, pose('idle'), SHUFFLE_SETTLE_FRAME_TIME / 2, true).pose;
      expect(result.action).toBe('shuffle');
      expect(result.frame).toBeGreaterThanOrEqual(last);
      expect(result.frame - last).toBeLessThanOrEqual(1);
      last = result.frame;
    }
    expect(last).toBe(shuffleSupportFrame(frame));
    for (let i = 0; i < 100; i++) expect(clock.sample(1, pose('idle'), .1, true).pose.frame).toBe(last);
  });

  it('keeps initial waiting completely still without introducing a step', () => {
    const clock = new ShuffleSettle();
    for (let i = 0; i < 100; i++) expect(clock.sample(1, pose('idle'), .1, true).pose).toEqual(pose('idle'));
  });

  it.each([-1, 1] as const)('does not mistake implicit facing %i for a real turn while standing still', facing => {
    const clock = new ShuffleSettle();
    clock.sample(1, pose('shuffle', 17, facing), 0, true, facing);
    const implicitIdle: Playhead = { action: 'idle', frame: 0, frameFloat: 0 };
    const stop = clock.sample(1, implicitIdle, .02, true, facing).pose;
    expect(stop).toMatchObject({ action: 'shuffle', frame: 17 });
    for(let i=0;i<10;i++) expect(clock.sample(1, implicitIdle, .02, true, facing).pose).toEqual(stop);
    expect(clock.sample(1, implicitIdle, .02, true, -facing as -1|1).pose).toEqual(implicitIdle);
  });

  it('freezes on pause and resumes travel from the same support phase', () => {
    const clock = new ShuffleSettle(); clock.sample(1, pose('shuffle', 11), 0, true);
    const stopped = clock.sample(1, pose('idle'), SHUFFLE_SETTLE_FRAME_TIME, true).pose;
    for (let i = 0; i < 50; i++) expect(clock.sample(1, pose('idle'), 0, true).pose).toEqual(stopped);
    expect(clock.sample(1, pose('shuffle'), .01, true)).toEqual({ pose: stopped, resumeFrame: 12 });
    expect(clock.sample(1, pose('shuffle', 13), .01, true).pose.frame).toBe(13);
  });

  it.each(['bump', 'set', 'dive', 'block', 'spike', 'turn', 'runBrake', 'serve'] as const)('yields immediately to %s without contaminating the next wait', action => {
    const clock = new ShuffleSettle(); clock.sample(1, pose('shuffle', 10), 0, true);
    expect(clock.sample(1, pose(action, 9), .01, false).pose).toEqual(pose(action, 9));
    expect(clock.sample(1, pose('idle'), .01, true).pose).toEqual(pose('idle'));
  });

  it('does not carry a stance through a turn, reset, or another player', () => {
    const clock = new ShuffleSettle(); clock.sample(1, pose('shuffle', 16), 0, true);
    expect(clock.sample(2, pose('idle'), .01, true).pose).toEqual(pose('idle'));
    expect(clock.sample(1, pose('idle', 0, -1), .01, true).pose).toEqual(pose('idle', 0, -1));
    clock.sample(1, pose('shuffle', 16), 0, true); clock.reset(1);
    expect(clock.sample(1, pose('idle'), .01, true).pose).toEqual(pose('idle'));
  });

  it.each(Array.from({ length: 24 }, (_, i) => i))('resumes the actual timeline after stopping at phase %i without a pause rewind', frame => {
    const p = new Player(104, 'away', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.sourceJob = 'cover'; p.setAnim('shuffle'); p.presentation.locomotion = 'shuffle'; p.vel.x = 1;
    clock.frameFor(p, 0, 'shuffle');
    const moving = clock.frameFor(p, (frame + .25) / 24 * DURATION.shuffle, 'shuffle');
    expect(moving.frame).toBe(frame);
    p.setAnim('ready'); p.presentation.locomotion = 'ready'; p.vel.x = 0;
    const stopped = clock.frameFor(p, .3);
    expect(stopped.frame).toBe(shuffleSupportFrame(frame));
    for (let i = 0; i < 5; i++) expect(clock.frameFor(p, 0)).toEqual(stopped);
    p.setAnim('shuffle'); p.presentation.locomotion = 'shuffle'; p.vel.x = 1;
    const resumed = clock.frameFor(p, 0, 'shuffle');
    expect(resumed.frame).toBe(stopped.frame);
    for (let i = 0; i < 5; i++) expect(clock.frameFor(p, 0, 'shuffle').frame).toBe(resumed.frame);
  });
});
