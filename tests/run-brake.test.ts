import { describe, expect, it } from 'vitest';
import { RunBrake, RUN_BRAKE_DURATION, RUN_BRAKE_STEP_FRAME, brakingVariant } from '../src/render/run-brake';
import { SpriteTimeline, locomotionPlaybackScale, type Playhead } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT } from '../src/core/rules';
const pose = (action: Playhead['action'], frame = 0, facing: -1 | 1 = 1): Playhead => ({ action, frame, frameFloat: frame, facing });

function naturalStoppedBrake() {
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:7,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline();
  const previous=new Map<number,Playhead>();
  for(let i=0;i<5000;i++) {
    w.step(null);
    for(const e of w.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
    for(const p of w.allPlayers()){
      const speed=Math.hypot(p.vel.x,p.vel.y),action=clock.actionFor(p),physical=JSON.stringify(p);
      const rendered=clock.frameFor(p,FIXED_DT*locomotionPlaybackScale(action,speed),undefined,undefined,FIXED_DT);
      expect(JSON.stringify(p)).toBe(physical);
      if(w.phase==='rally'&&previous.get(p.id)?.action==='run'&&rendered.action==='runBrake'){
        const offset=rendered.frame;expect([0,12]).toContain(offset);
        // Current rallies often require another step before the brake can
        // settle. Clone a real brake entry to isolate the stopped boundary;
        // the original athlete and tactical simulation stay untouched.
        const stopped=Object.assign(Object.create(Object.getPrototypeOf(p)),structuredClone(p)) as Player;
        stopped.vel.x=0;stopped.vel.y=0;stopped.locomotionIntent={x:0,y:0};
        stopped.setAnim('ready');stopped.presentation.locomotion='ready';
        return {w,clock,p:stopped,offset};
      }
      previous.set(p.id,rendered);
    }
  }
  throw new Error('No natural running-to-braking entry occurred');
}

describe('same-direction authored braking', () => {
  it.each([0, 5, 6, 11, 12, 17, 18, 23])('chooses the approaching support foot from run %s', frame => {
    expect(brakingVariant(frame)).toBe(frame >= 6 && frame < 18 ? 12 : 0);
  });
  it.each([0, 12])('shows all twelve drawings for variant %s, then shuffle zero', offset => {
    const clock = new RunBrake();
    clock.sample(1, pose('run', offset), 0, true, 3);
    const seen = new Set<number>();
    seen.add(clock.sample(1, pose('shuffle'), 0, true, 2).pose.frame);
    for (let i = 1; i < 30; i++) seen.add(clock.sample(1, pose('shuffle', 9), RUN_BRAKE_DURATION / 30, true, .4).pose.frame);
    expect([...seen]).toEqual(Array.from({ length: 12 }, (_, i) => offset + i));
    expect(clock.sample(1, pose('shuffle', 9), .02, true, 0)).toMatchObject({ completed: true, pose: { action: 'shuffle', frame: 0 } });
    expect(clock.sample(1, pose('shuffle', 1), .01, true, 1).pose.action).toBe('shuffle');
  });
  it.each([0, 12])('keeps stepping instead of finishing variant %s with planted feet at travel speed', offset => {
    const clock = new RunBrake();
    clock.sample(1, pose('run', offset), 0, true, 3);
    clock.sample(1, pose('shuffle'), 0, true, 2);
    for (let i = 1; i < 15; i++) {
      const s = clock.sample(1, pose('shuffle'), .01, true, 2);
      expect(s.pose.action).toBe('runBrake');
      expect(s.pose.frame).toBeLessThan(offset + 6);
    }
    expect(clock.sample(1, pose('shuffle'), .011, true, 2)).toMatchObject({
      completed: true, pose: { action: 'shuffle', frame: RUN_BRAKE_STEP_FRAME },
    });
  });
  it('finishes the settling drawings when the body stops, without snapping straight to idle', () => {
    const clock = new RunBrake();
    clock.sample(1, pose('run'), 0, true, 3);
    clock.sample(1, pose('shuffle'), 0, true, 2);
    expect(clock.sample(1, pose('idle'), .15, true, 0).pose).toMatchObject({ action: 'runBrake', frame: 6 });
    expect(clock.sample(1, pose('idle'), .16, true, 0)).toMatchObject({ pose: { action: 'runBrake', frame: 11 } });
    expect(clock.sample(1, pose('idle'), .1, true, 0).pose.action).toBe('runBrake');
  });
  it.each([60,90,120,144])('keeps both final supports planted at %s Hz until a real departure', hz => {
    for(const offset of [0,12]) {
      const clock=new RunBrake(),dt=.58/hz,seen=new Set<number>();
      clock.sample(1,pose('run',offset),0,true,3);
      seen.add(clock.sample(1,pose('shuffle'),0,true,2).pose.frame);
      let last:Playhead|undefined;
      for(let t=0;t<.6;t+=dt) {
        last=clock.sample(1,pose('idle'),dt,true,0).pose;
        expect(last.action).toBe('runBrake');seen.add(last.frame);
      }
      expect([...seen]).toEqual(Array.from({length:12},(_,i)=>offset+i));
      expect(last?.frame).toBe(offset+11);
      for(let i=0;i<20;i++)expect(clock.sample(1,pose('idle'),0,true,0).pose).toEqual(last);
      expect(clock.sample(1,pose('shuffle',8),dt,true,1)).toMatchObject({completed:true,pose:{action:'shuffle',frame:0}});
      expect(clock.sample(1,pose('shuffle',1),dt,true,1).pose.frame).toBe(1);
    }
  });
  it('keeps a naturally entered brake planted in an isolated stopped-player fixture', () => {
    const {w,clock,p,offset}=naturalStoppedBrake();
    const frames=[offset],worldState=JSON.stringify({players:w.allPlayers(),ball:w.ball,rng:w.rng});
    let witnessed=0;
    for(let i=0;i<90;i++){
      const physical=JSON.stringify(p),rendered=clock.frameFor(p,0,undefined,undefined,FIXED_DT);
      expect(JSON.stringify(p)).toBe(physical);expect(rendered.action).toBe('runBrake');
      if(frames.at(-1)!==rendered.frame)frames.push(rendered.frame);
      if(i*FIXED_DT>RUN_BRAKE_DURATION){
        witnessed++;expect(Math.hypot(p.vel.x,p.vel.y)).toBe(0);
        expect(rendered).toMatchObject({action:'runBrake',frame:offset+11});
        expect(clock.frameFor(p,0)).toEqual(rendered);
      }
    }
    expect(frames).toEqual(Array.from({length:12},(_,frame)=>offset+frame));
    expect(witnessed).toBeGreaterThan(30);
    expect(JSON.stringify({players:w.allPlayers(),ball:w.ball,rng:w.rng})).toBe(worldState);
  });
  it('resumes the visible shuffle foot phase, not the hidden clock or frame zero', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.pos.y = -5; p.vel.x = 3; p.anim = 'run'; p.presentation.locomotion = 'run'; p.presentation.sourceJob = 'cover';
    clock.frameFor(p, 0); p.vel.x = 2; p.anim = 'shuffle'; p.presentation.locomotion = 'shuffle';
    clock.frameFor(p, 0);
    expect(clock.frameFor(p, .15)).toMatchObject({ action: 'shuffle', frame: RUN_BRAKE_STEP_FRAME });
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'shuffle', frame: RUN_BRAKE_STEP_FRAME });
    expect(clock.frameFor(p, .025)).toMatchObject({ action: 'shuffle', frame: RUN_BRAKE_STEP_FRAME + 1 });
  });
  it('keeps the braking support through the slow-departure confirmation tick', () => {
    const clock=new RunBrake();clock.sample(1,pose('run'),0,true,3);
    clock.sample(1,pose('shuffle'),0,true,2);
    clock.sample(1,pose('idle'),.31,true,0);
    for(const speed of [.3,.5,.7])expect(clock.sample(1,pose('idle'),FIXED_DT,true,speed).pose).toMatchObject({action:'runBrake',frame:11});
    expect(clock.sample(1,pose('shuffle',9),FIXED_DT,true,1)).toMatchObject({completed:true,pose:{action:'shuffle',frame:0}});
  });
  it('does not flash upright idle when the isolated naturally braked defender starts moving again',()=>{
    const {clock,p}=naturalStoppedBrake();
    for(let i=0;i<90;i++)clock.frameFor(p,0,undefined,undefined,FIXED_DT);
    let checked=0,departed=false;
    for(let i=0;i<60;i++){
      p.step(FIXED_DT,.15,0);
      const action=clock.actionFor(p),physical=JSON.stringify(p);
      const rendered=clock.frameFor(p,FIXED_DT*locomotionPlaybackScale(action,Math.hypot(p.vel.x,p.vel.y)),undefined,undefined,FIXED_DT);
      expect(JSON.stringify(p)).toBe(physical);
      checked++;expect(rendered.action).not.toBe('idle');
      if(rendered.action==='shuffle'){expect(rendered.frame).toBe(0);departed=true;break;}
    }
    expect(checked).toBeGreaterThan(2);expect(departed).toBe(true);
  });
  it.each(['bump', 'set', 'dive', 'spike', 'approach', 'run', 'serve'] as const)('yields immediately to %s', action => {
    const clock = new RunBrake(); clock.sample(1, pose('run'), 0, true, 3);
    clock.sample(1, pose('shuffle'), 0, true, 2);
    expect(clock.sample(1, pose(action), .01, false, 2).pose.action).toBe(action);
    expect(clock.sample(1, pose('shuffle'), .01, false, 2).pose.action).toBe('shuffle');
  });
  it('does not trigger from standing, service, or reversed facing', () => {
    for (const [speed, allowed, facing] of [[0, true, 1], [2, false, 1], [2, true, -1]] as const) {
      const clock = new RunBrake(); clock.sample(1, pose('run'), 0, true, 3);
      expect(clock.sample(1, pose('shuffle', 0, facing), .01, allowed, speed).pose.action).toBe('shuffle');
    }
  });
  it('keeps simulation state untouched and never delays a cued contact', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.pos.y = -5; p.vel.x = 3; p.anim = 'run'; p.presentation.locomotion = 'run'; p.presentation.sourceJob = 'cover';
    clock.frameFor(p, 0); p.vel.x = 2; p.anim = 'shuffle'; p.presentation.locomotion = 'shuffle';
    const before = JSON.stringify(p);
    expect(clock.frameFor(p, .01).action).toBe('runBrake');
    expect(JSON.stringify(p)).toBe(before);
    clock.cue(p.id, 'bump', false);
    expect(clock.frameFor(p, .01)).toMatchObject({ action: 'bump', frame: 9 });
    clock.reset();
    expect(clock.frameFor(p, 0).action).toBe('shuffle');
  });
});
