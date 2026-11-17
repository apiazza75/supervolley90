import {describe,it,expect,vi} from 'vitest';
import * as steering from '../src/core/settled-steering';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {Renderer} from '../src/render/renderer';
import {SpriteTimeline,locomotionPlaybackScale} from '../src/render/sprite-figure';

describe('stationary post-point adjustment hysteresis',()=>{
 it('does not restart for weak separation noise even if it persists',()=>{
  for(let tick=0;tick<100;tick++){
   const next=steering.resetAdjustmentSteering(.1,0,false);
   expect(next.moving).toBe(false);expect(next.x).toBe(0);
  }
  expect(steering.resetAdjustmentSteering(.16,0,false)).toEqual({x:.16,y:0,moving:true});
  expect(steering.resetAdjustmentSteering(0,0,false)).toEqual({x:0,y:0,moving:false});
 });
 it('does not delay clear travel or interrupt an established gentle adjustment',()=>{
  expect(steering.resetAdjustmentSteering(.2,-.1,false)).toEqual({x:.2,y:-.1,moving:true});
  expect(steering.resetAdjustmentSteering(.07,0,true)).toEqual({x:.07,y:0,moving:true});
 });
 it.each([59.94,60,75,90,120,144])('keeps naturally settled players still while real returns proceed at %s Hz',hz=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
  const clock=new SpriteTimeline(),renderer=Object.create(Renderer.prototype) as any;
  type Position={x:number;y:number};
  const idleAge=new Map<string,number>(),returnStart=new Map<string,Position>();
  const departures=new Map<string,{at:Position;time:number}>();
  const flashes:{point:number;id:number;seconds:number;distance:number}[]=[];
  let remainder=0,points=0,completedResets=0,stationarySamples=0,maxReturn=0;
  for(let frame=0;frame<hz*180&&completedResets<3;frame++){
   remainder+=GAME_SPEED/hz;
   while(remainder>=FIXED_DT){w.step(null);remainder-=FIXED_DT;
    for(const e of w.drainEvents()){
     if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
     if(e.type==='point')points++;
     if(e.type==='whistle'&&points>0)completedResets++;
    }
   }
   for(const p of w.allPlayers()){
    const speed=Math.hypot(p.vel.x,p.vel.y),view=renderer.viewPlayer(p,remainder),wanted=clock.actionFor(view);
    const pose=clock.frameFor(view,GAME_SPEED/hz*locomotionPlaybackScale(wanted,speed),undefined,undefined,GAME_SPEED/hz);
    if(w.phase!=='dead')continue;
    const key=`${points}:${p.id}`;
    if(pose.action==='idle'&&speed<.05&&p.height===0&&p.vertVel===0&&p.cheerTime<=0){
     stationarySamples++;idleAge.set(key,(idleAge.get(key)??0)+GAME_SPEED/hz);
     const departure=departures.get(key);
     if(departure){
      const seconds=w.phaseTimer-departure.time;
      const distance=Math.hypot(p.pos.x-departure.at.x,p.pos.y-departure.at.y);
      // A short restart with no meaningful displacement is the actual defect.
      // Moving back to a new rotation spot is legal at any point-call time.
      if(seconds<.16&&distance<.1)flashes.push({point:points,id:p.id,seconds,distance});
      departures.delete(key);
     }
    }else if(pose.action==='walk'){
     if((idleAge.get(key)??0)>=.06&&!departures.has(key))departures.set(key,{at:{...p.pos},time:w.phaseTimer});
     idleAge.set(key,0);
    }else{
     idleAge.set(key,0);departures.delete(key);
    }
    if(pose.action==='walk'&&p.height===0&&p.cheerTime<=0){
     if(!returnStart.has(key))returnStart.set(key,{...p.pos});
     const start=returnStart.get(key)!;
     maxReturn=Math.max(maxReturn,Math.hypot(p.pos.x-start.x,p.pos.y-start.y));
    }
   }
  }
  expect(completedResets).toBe(3);expect(stationarySamples).toBeGreaterThan(10);
  expect(flashes).toEqual([]);
  expect(maxReturn).toBeGreaterThan(.3);
 });
 it.each([7,19,1337])('keeps live trajectories, player motion, rotations and events identical for seed %s',seed=>{
  const simulate=()=>{
   const w=new World({home:TEAMS[0],away:TEAMS[1],seed,difficulty:1,humanControlsHome:false});
   const live:unknown[]=[],events:unknown[]=[];
   for(let tick=0;tick<6000;tick++){
    w.step(null);events.push(...w.drainEvents());
    if(tick%12===0&&(w.phase==='serve'||w.phase==='rally'))live.push({tick,phase:w.phase,ball:{pos:{...w.ball.pos},vel:{...w.ball.vel}},
     score:[w.home.points,w.away.points],players:w.allPlayers().map(p=>({id:p.id,pos:{...p.pos},vel:{...p.vel},height:p.height,slot:p.rotationSlot}))});
   }
   return {live,events};
  };
  const legacy=vi.spyOn(steering,'resetAdjustmentSteering').mockImplementation(steering.settledSteering);
  let before:ReturnType<typeof simulate>;try{before=simulate();}finally{legacy.mockRestore();}
  expect(simulate()).toEqual(before);
 });
});
