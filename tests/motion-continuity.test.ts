import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { SpriteTimeline } from '../src/render/sprite-figure';
import { READY_LATERAL_FRAMES, READY_RETREAT_DURATION } from '../src/render/ready-retreat';

describe('stable starts and planted waiting', () => {
  it('does not flash two gaits for a one-tick receiver correction', () => {
    const p = new Player(6, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.sourceJob = 'receive';p.facing = 1;p.setAnim('ready');
    clock.frameFor(p, 0);
    p.setAnim('shuffle');p.presentation.locomotion = 'walk';p.vel.x = -.35;p.vel.y = -.30132154355258284;
    expect(clock.frameFor(p, 1 / 120)).toMatchObject({action:'idle',frame:0});
    p.presentation.locomotion = 'ready';p.vel.x = 0;p.vel.y = .04867845644741714;
    expect(clock.frameFor(p, 1 / 120)).toMatchObject({action:'idle',frame:0});
    p.setAnim('ready');p.vel.y = .07981285658593762;
    expect(clock.frameFor(p, 1 / 120)).toMatchObject({action:'idle',frame:0});
    p.setAnim('bump_ready');
    expect(clock.frameFor(p, 0)).toMatchObject({action:'bump',frame:0});
  });

  it.each([1 / 240, 1 / 120, 1 / 60])('starts sustained slow travel promptly at dt=%s', dt => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.sourceJob = 'cover';p.setAnim('ready');clock.frameFor(p, 0);
    p.setAnim('shuffle');p.presentation.locomotion = 'walk';p.vel.x = .4;
    let elapsed = 0, sample;
    do { sample = clock.frameFor(p, dt);elapsed += dt; } while (sample.action === 'idle' && sample.frame === 0 && elapsed < .1);
    expect(elapsed).toBeGreaterThanOrEqual(.025 - 1e-9);
    expect(elapsed).toBeLessThan(.025 + dt + 1e-9);
    // Weight transfer is movement, although its new drawings live in the idle atlas.
    expect(sample).toMatchObject({action:'idle',frame:28});
    const seen=[sample.frame];let entryTime=0;
    do {sample=clock.frameFor(p,dt);entryTime+=dt;if(sample.action==='idle'&&seen.at(-1)!==sample.frame)seen.push(sample.frame);}
    while(sample.action==='idle'&&entryTime<.2);
    expect(seen).toEqual(READY_LATERAL_FRAMES);
    expect(entryTime).toBeGreaterThanOrEqual(READY_RETREAT_DURATION-1e-9);
    expect(entryTime).toBeLessThan(READY_RETREAT_DURATION+dt+1e-9);
    expect(sample).toMatchObject({action:'shuffle',frame:0});
    expect(clock.frameFor(p, .1).frame).toBeGreaterThan(0);
  });

  it('never delays a clear start, attack approach, or exact contact', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.sourceJob = 'cover';p.setAnim('ready');clock.frameFor(p, 0);
    p.setAnim('shuffle');p.presentation.locomotion = 'shuffle';p.vel.x = 1;
    expect(clock.frameFor(p, 0)).toMatchObject({action:'idle',frame:28});
    clock.reset();p.setAnim('ready');p.presentation.locomotion = 'ready';p.vel.x = 0;clock.frameFor(p, 0);
    p.presentation.sourceJob = 'attack';p.licenseApproach('attack');
    expect(clock.frameFor(p, 0).action).toBe('approach');
    clock.cue(p.id, 'bump', false, 1);
    expect(clock.frameFor(p, 0)).toMatchObject({action:'bump',frame:9});
  });

  it('does not accumulate isolated pulses or paused draws into a step', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.sourceJob = 'cover';p.setAnim('ready');clock.frameFor(p, 0);
    for (let pulse = 0; pulse < 8; pulse++) {
      p.setAnim('shuffle');p.presentation.locomotion = 'walk';p.vel.x = .4;
      expect(clock.frameFor(p, 1 / 120).action).toBe('idle');
      for (let i = 0; i < 8; i++) expect(clock.frameFor(p, 0).action).toBe('idle');
      p.presentation.locomotion = 'ready';p.vel.x = .05;
      expect(clock.frameFor(p, 1 / 120).action).toBe('idle');
    }
  });

  it.each([0, 2, 3, 7, 100, 101, 106])('does not choose a random stride for athlete %i', id => {
    const p = new Player(id, 'home', 'outside', 'TEST', defaultStats());
    p.setAnim('run'); p.vel.x = 4; p.presentation.locomotion = 'run';
    expect(new SpriteTimeline().frameFor(p, 0)).toMatchObject({action:'run', frame:0});
  });
  it('holds one grounded ready drawing until a real action starts', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.setAnim('ready');
    for (let i=0; i<600; i++) expect(clock.frameFor(p, 1/60)).toMatchObject({action:'idle',frame:0});
    p.setAnim('bump_ready');
    expect(clock.frameFor(p, 0)).toMatchObject({action:'bump',frame:0});
    p.animTime=.15;
    expect(clock.frameFor(p, .15).frame).toBeGreaterThan(0);
  });
});
