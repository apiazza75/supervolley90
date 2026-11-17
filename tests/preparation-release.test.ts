import { describe, expect, it } from 'vitest';
import { PreparationRelease } from '../src/render/preparation-release';
import { SpriteTimeline } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';

describe('abandoned preparation continuity', () => {
  it('releases an interrupted new set-gather pose through the preceding drawings', () => {
    const release=new PreparationRelease(),idle={action:'idle' as const,frame:0,frameFloat:0};
    release.sample(1,{action:'set',frame:26,frameFloat:26},true,false,0,0);
    expect(release.sample(1,idle,false,true,.02,0)).toMatchObject({action:'set',frame:25});
    const last=release.sample(1,idle,false,true,.02,0);
    expect(last).toMatchObject({action:'set',frame:24});
    expect(release.sample(1,idle,false,true,0,0)).toEqual(last);
    for(let i=0;i<60;i++)expect(release.sample(1,idle,false,true,.02,0)).toEqual(last);
    const movement={action:'shuffle' as const,frame:0,frameFloat:0};
    expect(release.sample(1,movement,false,true,.02,1)).toEqual(movement);
  });

  it('retains the complete moving-set preparation order on the way back down', () => {
    const release=new PreparationRelease();
    release.sample(1,{action:'set',frame:24,frameFloat:24},true,false,0,0);
    release.sample(1,{action:'set',frame:8,frameFloat:8},true,false,.18,0);
    const frames:number[]=[];
    for(let i=0;i<20;i++) {
      const pose=release.sample(1,{action:'shuffle',frame:0,frameFloat:0},false,true,.02,0);
      if(pose.action==='shuffle')break;frames.push(pose.frame);
    }
    expect(frames).toEqual([7,6,5,4,3,2,1,0,27,26,25,24]);
  });

  it('resumes the new gather from the visible pose and lets a contact interrupt it', () => {
    const release=new PreparationRelease(),idle={action:'idle' as const,frame:0,frameFloat:0};
    release.sample(1,{action:'set',frame:27,frameFloat:27},true,false,0,0);
    release.sample(1,idle,false,true,.04,0);
    expect(release.sample(1,{action:'set',frame:24,frameFloat:24},true,false,.02,0)).toMatchObject({action:'set',frame:26});
    const contact={action:'set' as const,frame:9,frameFloat:9};
    expect(release.sample(1,contact,false,false,.01,0)).toEqual(contact);
    expect(release.sample(1,idle,false,true,.01,0)).toEqual(idle);
  });

  it('routes an interrupted moving set through the full player timeline, including pause and contact', () => {
    const p=new Player(7,'home','setter','TEST',defaultStats()),clock=new SpriteTimeline();
    p.pos.y=-3;p.vel.y=1;p.presentation.sourceJob='set';p.presentation.locomotion='shuffle';
    expect(clock.frameFor(p,.01).action).toBe('shuffle');
    p.setAnim('set_ready');p.animTime=.035;
    expect(clock.frameFor(p,.01)).toMatchObject({action:'set',frame:26});
    p.vel.y=0;p.setAnim('ready');
    const release=clock.frameFor(p,.02,'idle');
    expect(release).toMatchObject({action:'set',frame:25});
    expect(clock.frameFor(p,0,'idle')).toEqual(release);
    clock.cue(p.id,'set',false);
    expect(clock.frameFor(p,.01,'idle')).toMatchObject({action:'set',frame:9});
  });

  it.each(['bump', 'set'] as const)('releases %s through every pre-contact drawing before moving', action => {
    const release = new PreparationRelease();
    release.sample(1, { action, frame: 8, frameFloat: 8 }, true, false, 0, 2);
    const frames: number[] = [];
    for (let i = 0; i < 30; i++) {
      const pose = release.sample(1, { action: 'backpedal', frame: 0, frameFloat: 0 }, false, true, .58 / 60, 2);
      if (pose.action === action) frames.push(pose.frame);
      else break;
    }
    expect([...new Set(frames)]).toEqual(action === 'bump' ? [7,31,30,29,28,6,4,3,5,2,1,0] : [7,6,5,4,3,2,1,0]);
  });

  it('does not advance on pause, including the last release drawing', () => {
    const release = new PreparationRelease(), target = { action: 'idle' as const, frame: 0, frameFloat: 0 };
    release.sample(1, { action: 'bump', frame: 8, frameFloat: 8 }, true, false, 0, 0);
    const pose = release.sample(1, target, false, true, .05, 0);
    for (let i = 0; i < 20; i++) expect(release.sample(1, target, false, true, 0, 0)).toEqual(pose);
    const last = release.sample(1, target, false, true, .2, 0);
    expect(last).toMatchObject({ action: 'bump', frame: 0 });
    expect(release.sample(1, target, false, true, 0, 0)).toEqual(last);
    expect(release.sample(1, target, false, true, .01, 0)).toEqual(target);
  });

  it('resumes preparation from the visible release pose, not from frame eight', () => {
    const release = new PreparationRelease(), ready = { action: 'bump' as const, frame: 8, frameFloat: 8 };
    release.sample(1, ready, true, false, 0, 0);
    release.sample(1, { action: 'idle', frame: 0, frameFloat: 0 }, false, true, .08, 0);
    // The simulation restarts animTime at zero when the intention comes back.
    expect(release.sample(1, { ...ready, frame: 0 }, true, false, .02, 0).frame).toBe(30);
    expect(release.sample(1, ready, true, false, .02, 0).frame).toBe(31);
    release.sample(1, ready, true, false, .04, 0);
    expect(release.sample(1, { ...ready, frame: 2 }, true, false, .01, 0).frame).toBe(8);
  });

  it('never delays a contact cue, a jump or a reset', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.setAnim('bump_ready'); p.animTime = .3;
    expect(clock.frameFor(p, .01)).toMatchObject({ action: 'bump', frame: 8 });
    p.setAnim('ready');
    expect(clock.frameFor(p, .02, 'idle').action).toBe('bump');
    clock.cue(p.id, 'bump', false);
    expect(clock.frameFor(p, .01)).toMatchObject({ action: 'bump', frame: 9 });
    clock.reset();
    expect(clock.frameFor(p, .01, 'idle')).toMatchObject({ action: 'idle', frame: 0 });
    p.setAnim('set_ready'); p.animTime = .3; clock.frameFor(p, .01);
    p.jump();
    expect(clock.frameFor(p, .01).action).toBe('spike');
  });
});
