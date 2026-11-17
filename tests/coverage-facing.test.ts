import { describe, expect, it, vi } from 'vitest';
import * as presentation from '../src/core/presentation';
import { keepsNetReadyPosture, initialPresentation } from '../src/core/presentation';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT, attackDir } from '../src/core/rules';
import { SpriteTimeline } from '../src/render/sprite-figure';
import { Player, defaultStats } from '../src/core/player';

describe('net-facing off-ball coverage', () => {
  it('keeps natural lateral cover corrections in the visible gait without a phantom run or brake', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    const clock=new SpriteTimeline(),previous=new Map<number,string>();let witnessed=0,latchedRun=0;
    for(let i=0;i<6500;i++) {
      w.step(null);
      for(const e of w.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
      for(const p of w.allPlayers()){
        const prior=previous.get(p.id),before=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT);
        expect(JSON.stringify(p)).toBe(before);
        // Follow already visible lateral steps while the tactical run latch
        // changes. A real preceding sprint may finish its authored brake.
        if(w.phase==='rally'&&p.presentation.sourceJob==='cover'&&p.presentation.action==='none'
          &&p.height===0&&!p.approaching&&prior==='shuffle'
          &&Math.abs(p.locomotionIntent!.x)>Math.abs(p.locomotionIntent!.y)
          &&Math.abs(p.vel.y)<.1&&Math.hypot(p.vel.x,p.vel.y)>.8){
          witnessed++;expect(pose.action).toBe('shuffle');expect(p.facing).toBe(attackDir(p.side));
          if(p.presentation.locomotion==='run')latchedRun++;
        }
        previous.set(p.id,pose.action);
      }
    }
    expect(witnessed).toBeGreaterThan(70);expect(latchedRun).toBeGreaterThan(10);
  });

  it('uses the visible gait for run entry, while allowing a real sprint and its deceleration', () => {
    const p=new Player(101,'away','outside','TEST',defaultStats()),clock=new SpriteTimeline();
    p.pos.y=3;p.facing=-1;p.presentation.sourceJob='cover';p.presentation.locomotion='run';
    p.locomotionIntent={x:1,y:0};p.vel.x=2.8;
    expect(clock.frameFor(p,.01).action).toBe('shuffle');
    p.locomotionIntent={x:.6,y:-.8};p.vel.x=1.4;p.vel.y=-1.9;
    expect(clock.actionFor(p)).toBe('shuffle');
    expect(clock.frameFor(p,.01).action).toBe('shuffle');
    p.vel.y=-3.4;
    expect(clock.frameFor(p,.01).action).toBe('run');
    p.vel.y=-1.9;
    expect(clock.frameFor(p,.01).action).toBe('run');
    clock.cue(p.id,'bump',false);
    expect(clock.frameFor(p,.01)).toMatchObject({action:'bump',frame:9});
  });

  it('keeps a lateral setter open to the net without suppressing a real lengthwise pursuit', () => {
    const pr={...initialPresentation(),sourceJob:'set' as const,locomotion:'run' as const};
    for(const x of [-.94,.94])for(const y of [-.35,.35]){
      expect(keepsNetReadyPosture(pr,{x,y})).toBe(true);
      expect(keepsNetReadyPosture(pr,{x:y,y:x})).toBe(false);
    }
    expect(keepsNetReadyPosture(pr,{x:0,y:0})).toBe(false);
    expect(keepsNetReadyPosture({...pr,action:'set'},{x:1,y:0})).toBe(false);
  });

  it('does not spin twice at an isolated lateral setter-to-cover reassignment', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
    const p=w.away.players.find(p=>p.role==='setter')!,clock=new SpriteTimeline();
    // Isolate the tactical boundary from the new set-route selection. The
    // actual World movement/facing loop still runs; the ball stays out of reach.
    w.phase='rally';w.ball.frozen=true;w.ball.grounded=false;w.ball.pos={x:0,y:-7,z:8};
    w.possession='away';w.touches=1;p.pos={x:-2,y:4,z:0};p.vel={x:0,y:0,z:0};p.facing=-1;p.setAnim('ready');
    for(const side of ['home','away'] as const){
      const brain=(w as any).brains[side];brain.think=()=>{};brain.commandFor=()=>idleCommand();
    }
    let setterSteps=0,coverSteps=0,runningSteps=0;
    for(let i=0;i<140;i++){
      p.presentation.sourceJob=i<40?'set':'cover';
      const movement=i<16?{moveX:0,moveY:-1}:{moveX:.45,moveY:i%24<12?.12:-.12};
      (w as any).brains.away.commandFor=(player:Player)=>player.id===p.id?{...idleCommand(),...movement}:idleCommand();
      w.step(null);const before=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT);
      expect(JSON.stringify(p)).toBe(before);expect(p.facing).toBe(-1);
      expect(['turn','runTurn','turnStop']).not.toContain(pose.action);
      if(p.presentation.sourceJob==='set')setterSteps++;
      if(p.presentation.sourceJob==='cover')coverSteps++;
      if(pose.action==='run')runningSteps++;
    }
    expect(setterSteps).toBeGreaterThan(15);expect(coverSteps).toBeGreaterThan(80);expect(runningSteps).toBeGreaterThan(5);
  });

  it.each(['cover','block','attack'] as const)('keeps %s open to the net through short positional corrections', sourceJob => {
    for(const locomotion of ['stand','ready','walk','shuffle','run'] as const) {
      expect(keepsNetReadyPosture({...initialPresentation(),sourceJob,locomotion})).toBe(true);
    }
  });

  it('does not take over a licensed approach, ball pursuit, or skill', () => {
    const base={...initialPresentation(),sourceJob:'cover' as const};
    expect(keepsNetReadyPosture({...base,locomotion:'approach'})).toBe(false);
    for(const sourceJob of ['receive','set','serve','idle'] as const) expect(keepsNetReadyPosture({...base,sourceJob})).toBe(false);
    for(const action of ['set','bump','block','spike','dive','serve','jumpServe','celebrate'] as const) expect(keepsNetReadyPosture({...base,action})).toBe(false);
  });

  it('keeps natural fast cover corrections and a complete setter recovery facing the net', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
    const clock=new SpriteTimeline(),previous=new Map<number,string>();
    let fastCover=0,recoveredSetter=0,setGesture=0,setter:number|undefined,contactTick=-1,completed=false;
    for(let i=0;i<6500;i++) {
      w.step(null);const events=w.drainEvents();
      for(const e of events)if(e.type==='contact'){
        clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
        const p=w.findPlayer(e.playerId)!;
        if(setter===undefined&&e.kind==='set'&&!e.backSet&&e.facing===attackDir(p.side)){setter=p.id;contactTick=i;}
        else if(setter!==undefined&&i>contactTick)completed=true;
      }
      for(const p of w.allPlayers()){
        const before=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT),prior=previous.get(p.id);
        expect(JSON.stringify(p)).toBe(before);
        if(w.phase==='rally'&&p.presentation.sourceJob==='cover'&&p.presentation.action==='none'
          &&p.height===0&&!p.approaching&&p.presentation.locomotion==='run'
          &&Math.abs(p.locomotionIntent!.x)>Math.abs(p.locomotionIntent!.y)
          &&(prior==='shuffle'||prior==='backpedal')){
          fastCover++;expect(p.facing).toBe(attackDir(p.side));expect(['shuffle','backpedal']).toContain(pose.action);
        }
        if(p.id===setter&&i>contactTick&&!completed){
          expect(p.facing).toBe(attackDir(p.side));expect(['turn','runTurn','turnStop']).not.toContain(pose.action);
          expect(p.presentation.sourceJob).toBe('cover');
          if(p.presentation.action==='set'){
            setGesture++;expect(p.presentation.lockedFacing).toBe(attackDir(p.side));
          }else if(w.touches===2&&w.lastToucherId===p.id)recoveredSetter++;
        }
        previous.set(p.id,pose.action);
      }
      if(completed&&fastCover>20)break;
    }
    expect(completed).toBe(true);expect(fastCover).toBeGreaterThan(20);
    expect(recoveredSetter).toBeGreaterThan(25);expect(setGesture).toBeGreaterThan(15);
  });

  it('keeps the stationary back-row cover ready instead of making two half-turns on a natural pass', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    const clock=new SpriteTimeline();let witnessed=0,ballBehind=0;
    for(let i=0;i<1000;i++) {
      w.step(null);w.drainEvents();const p=w.findPlayer(104)!;
      const pose=clock.frameFor(p,FIXED_DT);
      if(w.home.points+w.away.points===0&&w.rallyTime>=2.6&&w.rallyTime<3.95) {
        witnessed++;expect(p.presentation.sourceJob).toBe('cover');
        expect(p.pos.x).toBeCloseTo(2.95,10);expect(p.pos.y).toBeCloseTo(6.2,10);
        expect(Math.hypot(p.vel.x,p.vel.y)).toBe(0);
        expect(p.facing).toBe(attackDir(p.side));expect(pose.action).toBe('idle');
        if(w.ball.pos.y>p.pos.y+.25)ballBehind++;
      }
      if(w.rallyTime>4)break;
    }
    expect(witnessed).toBeGreaterThan(100);expect(ballBehind).toBeGreaterThan(5);
  });

  it('plays the complete natural retreat from ready for both the hitter and front-row cover', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    const clock=new SpriteTimeline(),previous=new Map<number,{action:string;frame:number}>();
    const tracked=new Map<number,{job:'attack'|'cover';frames:Set<number>;entry:number[];steps:number;done:boolean}>();
    for(let i=0;i<4000;i++) {
      w.step(null);
      for(const e of w.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
      for(const p of w.allPlayers()){
        const before=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT),prior=previous.get(p.id),job=p.presentation.sourceJob;
        expect(JSON.stringify(p)).toBe(before);
        const retreat=w.phase==='rally'&&(job==='attack'||job==='cover')&&p.height===0
          &&p.presentation.action==='none'&&!p.approaching&&p.vel.y*attackDir(p.side)<-.1;
        if(retreat&&w.team(p.side).isFrontRow(p)&&prior?.action==='idle'&&prior.frame===0
          &&!tracked.has(p.id)&&![...tracked.values()].some(t=>t.job===job)){
          tracked.set(p.id,{job:job as 'attack'|'cover',frames:new Set(),entry:[],steps:0,done:false});
        }
        const t=tracked.get(p.id);
        if(t&&!t.done){
          if(!retreat)t.done=true;
          else{
            t.steps++;expect(p.facing).toBe(attackDir(p.side));
            if(pose.action==='idle'){
              expect([0,24,25,26,27]).toContain(pose.frame);
              if(pose.frame!==0&&t.entry.at(-1)!==pose.frame)t.entry.push(pose.frame);
            }else{expect(pose.action).toBe('backpedal');t.frames.add(pose.frame);}
          }
        }
        previous.set(p.id,{action:pose.action,frame:pose.frame});
      }
      if(tracked.size===2&&[...tracked.values()].every(t=>t.done))break;
    }
    expect(tracked.size).toBe(2);
    for(const t of tracked.values()){
      expect(t.done).toBe(true);expect(t.steps).toBeGreaterThan(t.job==='attack'?15:60);
      expect(t.frames.size).toBe(24);expect(t.entry).toEqual([24,25,26,27]);
    }
  });

  it.each([1337,4242])('does not change positions, trajectories or contacts in seeded match %i', seed => {
    const simulate=()=>{
      const w=new World({home:TEAMS[0],away:TEAMS[1],seed,difficulty:1,humanControlsHome:false});
      const snapshots:unknown[]=[];
      for(let i=0;i<3600;i++) {
        w.step(null);
        const contacts=w.drainEvents().filter(e=>e.type==='contact').map(e=>{
          const {facing:_,...event}=e;return event;
        });
        if(i%12===0||contacts.length) snapshots.push({phase:w.phase,points:[w.home.points,w.away.points],
          ball:{pos:{...w.ball.pos},vel:{...w.ball.vel}},contacts,
          players:w.allPlayers().map(p=>({id:p.id,pos:{...p.pos},vel:{...p.vel},height:p.height,vertVel:p.vertVel,slot:p.rotationSlot}))});
      }
      return snapshots;
    };
    const legacy=vi.spyOn(presentation,'keepsNetReadyPosture').mockReturnValue(false);
    let before:unknown[];try {before=simulate();}finally{legacy.mockRestore();}
    expect(simulate()).toEqual(before);
  });
});
