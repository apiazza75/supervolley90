import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { SpriteTimeline } from '../src/render/sprite-figure';
import { GAME_SPEED } from '../src/core/rules';
import { PLANTED_TURN_FRAMES, plantedTurnFrame, STOPPING_TURN_REVIEW_FRAMES, STOPPING_TURN_END_FRAMES } from '../src/render/turn-playback';
const make = () => new Player(7, 'home', 'outside', 'TEST', defaultStats());

describe('grounded manga pivot integration', () => {
  it('plays every source drawing once without the forward-back-forward shoulder rewind', () => {
    expect([...PLANTED_TURN_FRAMES].sort((a,b)=>a-b)).toEqual(Array.from({length:24},(_,i)=>i));
    expect(Array.from({length:24},(_,i)=>plantedTurnFrame(i))).toEqual(Array.from({length:24},(_,i)=>i));
    expect(plantedTurnFrame(-1)).toBe(0);
    expect(plantedTurnFrame(24)).toBe(23);
  });

  it.each([1,-1] as const)('restarts the planted pivot exit on supported feet from facing %s', from => {
    for (const dt of [GAME_SPEED/60, GAME_SPEED/120]) {
      const p=make(),clock=new SpriteTimeline();
      p.facing=from;p.vel.y=1.9*from;clock.frameFor(p,0,'shuffle');
      clock.frameFor(p,.31,'shuffle');p.facing=-from;
      let turning=false,completed=false;
      for(let i=0;i<200;i++) {
        const s=clock.frameFor(p,dt*1.7,'shuffle',undefined,dt);
        if(s.action==='turn') { turning=true;continue; }
        if(!turning)continue;
        expect(s).toMatchObject({action:'shuffle',frame:0,facing:-from});
        // A repaint while paused must not undo the planted-foot handoff.
        expect(clock.frameFor(p,0,'shuffle',undefined,0).frame).toBe(0);
        expect(p.pos).toEqual({x:0,y:0,z:0});completed=true;break;
      }
      expect(turning).toBe(true);
      expect(completed).toBe(true);
    }
  });
  it.each([1,-1] as const)('settles to defensive stance after decelerating from facing %s', from => {
    const p=make(),clock=new SpriteTimeline(),dt=GAME_SPEED/60;
    p.facing=from;p.vel.y=4*from;clock.frameFor(p,0,'run');p.facing=-from;
    expect(clock.frameFor(p,.05,'run').action).toBe('runTurn');
    p.vel.y=0;
    const poses=[0],brakes=new Set<number>();
    for(let i=0;i<100;i++){
      const s=clock.frameFor(p,0,'shuffle',undefined,dt);
      if(s.action==='runTurn'||s.action==='turnStop'){
        poses.push(s.frame);expect(s.facing).toBe(from);
        if(s.action==='turnStop'){expect(s.frame).toBeGreaterThanOrEqual(12);brakes.add(s.frame);}
        else expect(s.frame).toBeLessThan(12);
      }else{
        expect([...new Set(poses)]).toEqual(STOPPING_TURN_REVIEW_FRAMES);
        expect([...brakes]).toEqual(STOPPING_TURN_END_FRAMES);
        expect(s).toMatchObject({action:'shuffle',frame:0,facing:-from});return;
      }
    }
    throw Error('Braking turn did not complete');
  });
  it('animates a stationary direction change even when shuffle cadence is zero', () => {
    const p=make(), clock=new SpriteTimeline(), dt=GAME_SPEED/60;
    p.facing=1;clock.frameFor(p,0,'shuffle',undefined,dt);
    p.facing=-1;
    const frames=new Set<number>();
    for(let i=0;i<100;i++){
      const sample=clock.frameFor(p,0,'shuffle',undefined,dt);
      if(sample.action==='turn'){
        frames.add(sample.frame);expect(sample.facing).toBe(1);
      }else if(frames.size){
        expect(sample.action).toBe('shuffle');
        expect(sample.facing).toBe(-1);
        expect(sample.frame).toBe(0);
        expect([...frames]).toEqual([...PLANTED_TURN_FRAMES]);return;
      }
      expect(p.facing).toBe(-1);expect(p.pos).toEqual({x:0,y:0,z:0});
    }
    throw Error('Stationary turn did not complete');
  });

  it('does not replace a sprint or a held serve with standing pivot art',()=>{
    const p=make(),clock=new SpriteTimeline();
    clock.frameFor(p,0,'idle');
    p.facing=-1;p.vel.y=-3.5;
    expect(clock.frameFor(p,.1,'run').action).toBe('runTurn');
    p.vel.y=0;p.facing=1;
    expect(clock.frameFor(p,.1,'serve',{holding:true,holdSeconds:10,tossElapsed:0,jumping:false}).action).toBe('serve');
  });

  it('does not abruptly mirror a shuffle at the old 2.25 speed cutoff',()=>{
    const p=make(),clock=new SpriteTimeline(),dt=GAME_SPEED/60;
    p.vel.y=2.08;p.facing=1;clock.frameFor(p,dt,'shuffle');
    p.facing=-1;
    // Remain in the same lateral gait while accelerating through the old
    // render-only cutoff: that must not cancel an already requested pivot.
    p.vel.y=2.29;
    let turning=false;
    for(let i=0;i<8;i++){
      const sample=clock.frameFor(p,dt,'shuffle');
      expect(sample.facing).toBe(1);
      turning ||= sample.action==='turn';
    }
    expect(turning).toBe(true);
  });

  it('interrupts the turn for the exact illustrated contact',()=>{
    const p=make(),clock=new SpriteTimeline();
    clock.frameFor(p,0,'idle');p.facing=-1;
    expect(clock.frameFor(p,.1,'idle')).toMatchObject({action:'idle',frame:28});
    clock.cue(p.id,'bump',false,-1);
    expect(clock.frameFor(p,.01,'idle')).toMatchObject({action:'bump',frame:9,facing:-1});
  });

  it.each([1, -1] as const)('draws all moving turn poses from facing %s and joins the matching run leg phase',from=>{
    const p=make(),clock=new SpriteTimeline(),dt=GAME_SPEED/60;
    p.facing=from;p.vel.y=3.5*from;clock.frameFor(p,0,'run');
    p.facing=-from;
    const frames=new Set<number>();
    for(let i=0;i<100;i++){
      const s=clock.frameFor(p,dt,'run');
      if(s.action==='runTurn'){
        frames.add(s.frame);expect(s.facing).toBe(from);
      }else if(frames.size){
        expect(s).toMatchObject({action:'run',frame:6,facing:-from});
        expect([...frames]).toEqual(Array.from({length:24},(_,n)=>n));
        expect(p.pos).toEqual({x:0,y:0,z:0});return;
      }
    }
    throw Error('Moving turn did not finish');
  });

  it('does not let a moving turn or its exit pose delay a real contact',()=>{
    const p=make(),clock=new SpriteTimeline();
    p.vel.y=4;clock.frameFor(p,0,'run');p.facing=-1;
    expect(clock.frameFor(p,.1,'run').action).toBe('runTurn');
    clock.cue(p.id,'bump',false,-1);
    expect(clock.frameFor(p,.01,'run')).toMatchObject({action:'bump',frame:9,facing:-1});
    expect(clock.frameFor(p,.01,'run').action).toBe('bump');
  });

  it('finishes contact recovery even if the next shuffle has stopped its foot clock',()=>{
    const p=make(),clock=new SpriteTimeline(),dt=GAME_SPEED/60;
    clock.cue(p.id,'set',false,1,true);
    clock.frameFor(p,0,'shuffle',undefined,dt);
    const frames=new Set<number>();
    for(let i=0;i<100;i++){
      const s=clock.frameFor(p,0,'shuffle',undefined,dt);
      if(s.action!=='backSet'){expect(frames.has(23)).toBe(true);return;}
      frames.add(s.frame);
    }
    throw Error('Contact recovery frozen by zero shuffle cadence');
  });
});
