import { describe, expect, it } from 'vitest';
import { BackpedalSettle, backpedalSupportPosition, BACKPEDAL_SETTLE_FRAME_TIME } from '../src/render/backpedal-settle';
import { DURATION, SpriteTimeline, type Playhead } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';

const pose = (action: Playhead['action'], frame = 0, facing: -1|1 = 1): Playhead => ({ action, frame, frameFloat: frame, facing });

describe('backwards-step arrest without a standing-pose jump', () => {
  it.each(Array.from({length:24},(_,i)=>i))('finishes the existing step from frame %i and holds its support', frame => {
    const clock=new BackpedalSettle(); clock.sample(1,pose('backpedal',frame),0,true);
    let previous=frame;
    for(let i=0;i<100;i++) {
      const s=clock.sample(1,pose('idle'),BACKPEDAL_SETTLE_FRAME_TIME/2,true).pose;
      expect(s.action).toBe('backpedal');
      expect((s.frame-previous+24)%24).toBeLessThanOrEqual(1);previous=s.frame;
    }
    expect(previous).toBe(backpedalSupportPosition(frame)%24);
    for(let i=0;i<100;i++) expect(clock.sample(1,pose('idle'),.1,true).pose.frame).toBe(previous);
  });

  it('does not invent a step at initial rest', () => {
    const clock=new BackpedalSettle();
    for(let i=0;i<30;i++)expect(clock.sample(1,pose('idle'),.1,true).pose).toEqual(pose('idle'));
  });

  it('freezes and resumes the last visible phase through cycle wrap', () => {
    const clock=new BackpedalSettle();clock.sample(1,pose('backpedal',23),0,true);
    const stopped=clock.sample(1,pose('idle'),.018,true).pose;
    expect(stopped.frame).toBe(0);
    for(let i=0;i<10;i++)expect(clock.sample(1,pose('idle'),0,true).pose).toEqual(stopped);
    expect(clock.sample(1,pose('backpedal',15),0,true)).toEqual({pose:stopped,resumeFrame:0});
  });

  it.each(['bump','set','dive','block','spike','turn','runBrake','serve','shuffle'] as const)('yields to %s immediately', action => {
    const clock=new BackpedalSettle();clock.sample(1,pose('backpedal',8),0,true);
    expect(clock.sample(1,pose(action,9),.01,false).pose).toEqual(pose(action,9));
    expect(clock.sample(1,pose('idle'),.01,true).pose.action).toBe('idle');
  });

  it('compares visible facing and isolates players and reset', () => {
    const clock=new BackpedalSettle();clock.sample(1,pose('backpedal',12,-1),0,true,-1);
    const idle:Playhead={action:'idle',frame:0,frameFloat:0};
    expect(clock.sample(1,idle,0,true,-1).pose.action).toBe('backpedal');
    expect(clock.sample(2,idle,0,true,-1).pose.action).toBe('idle');
    expect(clock.sample(1,idle,0,true,1).pose.action).toBe('idle');
    clock.sample(1,pose('backpedal',12),0,true);clock.reset(1);
    expect(clock.sample(1,idle,0,true,1).pose.action).toBe('idle');
    clock.sample(1,pose('backpedal',12),0,true);clock.reset();
    expect(clock.sample(1,idle,0,true,1).pose.action).toBe('idle');
  });

  it.each(Array.from({length:24},(_,i)=>i))('resumes the actual sprite timeline from stop phase %i', frame => {
    const p=new Player(2,'home','middle','TEST',defaultStats()),clock=new SpriteTimeline();
    p.presentation.sourceJob='cover';p.setAnim('shuffle');p.vel.y=-1;p.facing=1;
    clock.frameFor(p,0,'backpedal');
    expect(clock.frameFor(p,(frame+.25)/24*DURATION.backpedal,'backpedal').frame).toBe(frame);
    p.setAnim('ready');p.vel.y=0;
    const stopped=clock.frameFor(p,.3);
    expect(stopped).toMatchObject({action:'backpedal',frame:backpedalSupportPosition(frame)%24});
    for(let i=0;i<5;i++)expect(clock.frameFor(p,0)).toEqual(stopped);
    p.setAnim('shuffle');p.vel.y=-1;
    expect(clock.frameFor(p,0,'backpedal').frame).toBe(stopped.frame);
    for(let i=0;i<5;i++)expect(clock.frameFor(p,0,'backpedal').frame).toBe(stopped.frame);
  });
});
