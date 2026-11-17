import {describe,expect,it} from 'vitest';
import {settledSteering} from '../src/core/settled-steering';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';

describe('settled off-ball steering',()=>{
 it('does not alternate movement at the physical input dead zone',()=>{
  let moving=true;
  for(const x of [.054,.049,.051,.048,.052,.075,.061]){
   const next=settledSteering(x,0,moving);moving=next.moving;
   expect(next).toEqual({x:0,y:0,moving:false});
  }
 });
 it('responds immediately to real travel and preserves its exact direction',()=>{
  expect(settledSteering(.3,-.4,false)).toEqual({x:.3,y:-.4,moving:true});
  expect(settledSteering(.07,0,true)).toEqual({x:.07,y:0,moving:true});
  expect(settledSteering(.04,0,true)).toEqual({x:0,y:0,moving:false});
 });
 it.each(['receive','set','attack'])('does not filter small %s pursuit commands',job=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
  w.phase='rally';w.possession='home';w.touches=2;w.lastToucherId=-1;
  const p=w.home.players[0],brain=(w as any).brains.home;
  p.pos={x:0,y:-5,z:0};w.ball.pos={x:4,y:8,z:4};
  w.home.players.filter(m=>m!==p).forEach((m,i)=>{m.pos={x:10+i*2,y:-8,z:0};});
  brain.commandFor(p);
  Object.assign(brain.states.get(p.id),{job,goal:{x:.112,y:-5,z:0},adjusting:false});
  const cmd=brain.commandFor(p);
  expect(cmd.moveX).toBeCloseTo(.07,8);
  expect(cmd.moveY).toBe(0);
 });
 it('keeps naturally completed returns settled until a new rotation or close teammate requires movement',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
  type Settled={home:{x:number;y:number};last:string;changes:number;samples:number};
  const resting=new Map<number,Settled>(),windows:Settled[]=[];
  let sawPoint=false,finished=false;
  for(let step=0;step<120*90;step++){
   w.step(null);
   for(const event of w.drainEvents()){
    if(event.type==='point')sawPoint=true;
    if(event.type==='whistle'&&sawPoint)finished=true;
   }
   if(finished)break;
   if(w.phase!=='dead')continue;
   for(const p of w.allPlayers()){
    const speed=Math.hypot(p.vel.x,p.vel.y);
    const nearest=Math.min(...w.team(p.side).players.filter(m=>m.id!==p.id).map(m=>Math.hypot(m.pos.x-p.pos.x,m.pos.y-p.pos.y)));
    let state=resting.get(p.id);
    if(state&&(Math.hypot(p.home.x-state.home.x,p.home.y-state.home.y)>.1||nearest<1.7)){
     resting.delete(p.id);state=undefined;
    }
    if(!state&&speed<.6&&p.height===0&&p.vertVel===0&&p.cheerTime<=0
      &&p.presentation.action==='none'&&Math.hypot(p.pos.x-p.home.x,p.pos.y-p.home.y)<.3&&nearest>=1.7){
     state={home:{...p.home},last:p.anim,changes:0,samples:0};resting.set(p.id,state);windows.push(state);
    }
    if(state){
     state.samples++;if(state.last!==p.anim)state.changes++;state.last=p.anim;
     expect(speed,`settled player ${p.id}`).toBeLessThan(.6);
     expect(state.changes,`settled player ${p.id}`).toBeLessThanOrEqual(2);
    }
   }
  }
  expect(sawPoint).toBe(true);expect(finished).toBe(true);
  expect(windows.filter(state=>state.samples>12).length).toBeGreaterThanOrEqual(2);
 });
});
