import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT } from '../src/core/rules';
import { SET_GROUND_RECOVERY_TIME } from '../src/core/presentation';
import { SpriteTimeline, DURATION, CONTACT_FRAME } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';
import { SET_GATHER_FRAMES, setPreparationFrame } from '../src/render/set-gather';
import { v3 } from '../src/core/math3';

describe('grounded set footwork', () => {
  it('brakes before raising hands, shows every preparation pose, and stays planted through recovery', () => {
    const w = new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
    // Supply a full, high passing flight. A fixed numbered contact in a match
    // is now sometimes an emergency backset/quick with no such preparation
    // budget; the normal planted technique must still show every drawing.
    w.phase='rally';w.possession='away';w.touches=1;w.lastToucherId=106;w.lastToucherSide='away';
    // Reception is already complete, so the setter is in the offensive
    // phase rather than the constructor's initial defensive debounce.
    (w as unknown as {brains:{away:{mode:string}}}).brains.away.mode='offence';
    w.ball.frozen=false;w.ball.grounded=false;w.ball.pos=v3(-2.1,1.9,4.8);w.ball.vel=v3(0,0,-1.5);
    const setter=w.findPlayer(100)!;
    setter.pos=v3(-2.1,3.5,0);setter.vel=v3(0,-4.5,0);setter.facing=-1;setter.setAnim('run');
    w.away.players.filter(p=>p!==setter).forEach((p,i)=>{p.pos=v3([-3,0,3,-3,3][i],7,0);});
    const clock = new SpriteTimeline(), preparation = new Set<number>(), recovery = new Set<number>();
    let start: {x:number;y:number;t:number}|undefined, contact: {x:number;y:number;t:number}|undefined;
    let maxSlide = 0, brakingSeen = false, returnedToMovement = false;
    for (let i=0;i<3000;i++) {
      w.step(null); const p=w.findPlayer(100)!;
      for(const e of w.drainEvents()) if(e.type==='contact'&&e.playerId===p.id) {
        clock.cue(p.id,e.kind,e.airborne,e.facing,e.backSet);
        if(e.kind==='set'&&!contact) {
          contact={...p.pos,t:w.rallyTime}; expect(Math.hypot(p.vel.x,p.vel.y)).toBe(0);
        }
      }
      const pose=clock.frameFor(p,FIXED_DT);
      brakingSeen ||= pose.action==='runBrake';
      if(p.presentation.action==='set'&&p.presentation.phase==='prepare') {
        start ??= {...p.pos,t:w.rallyTime};
        expect(Math.hypot(p.vel.x,p.vel.y)).toBeLessThanOrEqual(1.2);
        expect(pose.action).toBe('set'); expect([...SET_GATHER_FRAMES,0,1,2,3,4,5,6,7,8]).toContain(pose.frame);
        preparation.add(pose.frame);
        maxSlide=Math.max(maxSlide,Math.hypot(p.pos.x-start.x,p.pos.y-start.y));
      }
      if(contact&&w.rallyTime-contact.t<SET_GROUND_RECOVERY_TIME-FIXED_DT) {
        expect(p.pos.x).toBeCloseTo(contact.x,10); expect(p.pos.y).toBeCloseTo(contact.y,10);
        if(pose.action==='set'||pose.action==='backSet') recovery.add(pose.frame);
      }
      if(contact&&w.rallyTime-contact.t>SET_GROUND_RECOVERY_TIME&&Math.hypot(p.vel.x,p.vel.y)>.1) returnedToMovement=true;
      if(contact&&w.rallyTime-contact.t>.8)break;
    }
    expect(start).toBeDefined(); expect(contact).toBeDefined();
    expect(contact!.t-start!.t).toBeGreaterThanOrEqual(.18);
    expect([...preparation]).toEqual([24,25,26,27,0,1,2,3,4,5,6,7,8]);
    expect(maxSlide).toBeLessThan(.02);
    expect(brakingSeen).toBe(true); expect(returnedToMovement).toBe(true);
    expect([...recovery]).toContain(9); expect([...recovery]).toContain(23);
  });

  it('plays all new entry and preparation drawings on a 60 Hz display without a phantom contact', () => {
    const frames = new Set<number>();
    for(let t=0;t<.3;t+=.58/60)frames.add(setPreparationFrame(t,true));
    expect([...frames]).toEqual([24,25,26,27,0,1,2,3,4,5,6,7,8]);
    expect(setPreparationFrame(20,true)).toBe(8);
    expect(setPreparationFrame(0,false)).toBe(0);
  });

  it.each(['set','backSet'] as const)('finishes the %s contact strip before AI restarts coverage', action => {
    const remaining=DURATION[action]*(24-CONTACT_FRAME[action]!)/24;
    expect(remaining).toBeLessThanOrEqual(SET_GROUND_RECOVERY_TIME);
  });

  it.each(['receive','set'] as const)('keeps defensive footwork for %s beyond the sideline', job => {
    const p=new Player(7,'away','setter','TEST',defaultStats());
    p.pos.x=5.2;p.pos.y=1.5;p.vel.y=-1;p.presentation.sourceJob=job;p.presentation.locomotion='walk';p.anim='shuffle';
    expect(new SpriteTimeline().frameFor(p,0).action).toBe('shuffle');
  });

  it('does not turn the AI recovery into a human movement lock', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:true});
    const p=w.home.players[0];w.home.activeId=p.id;w.phase='rally';w.ball.frozen=true;
    p.pos.x=0;p.pos.y=-4;p.vel.x=0;p.vel.y=0;p.setAnim('set_contact');
    const cmd=idleCommand();cmd.moveX=1;w.step(cmd);
    expect(p.vel.x).toBeGreaterThan(0);
  });

  it.each(['set', 'backSet'] as const)('does not flash idle after %s when coverage begins one tick later', action => {
    const p = new Player(7, 'home', 'setter', 'TEST', defaultStats());
    const clock = new SpriteTimeline();
    clock.cue(p.id, 'set', false, 1, action === 'backSet');
    clock.frameFor(p, 0);
    for (let i = 0; i < 50; i++) clock.frameFor(p, .01, 'idle');
    expect(clock.frameFor(p, 0, 'idle')).toMatchObject({action, frame:23});
    p.vel.y = 1;
    expect(clock.frameFor(p, .01, 'shuffle').action).toBe('shuffle');
  });

  it('eventually enters idle when set recovery is followed by a real rest', () => {
    const p = new Player(7, 'home', 'setter', 'TEST', defaultStats());
    const clock = new SpriteTimeline();
    clock.cue(p.id, 'set', false); clock.frameFor(p, 0);
    for (let i = 0; i < 70; i++) clock.frameFor(p, .01, 'idle');
    expect(clock.frameFor(p, 0, 'idle').action).toBe('idle');
  });
});
