import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline,locomotionPlaybackScale,type Playhead} from '../src/render/sprite-figure';
import {PIVOT_DURATION} from '../src/render/facing-transition';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT} from '../src/core/rules';

function scene(){
 const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
 p.pos.y=-2;p.facing=1;p.anim='shuffle';p.presentation.action='none';p.presentation.locomotion='shuffle';p.presentation.sourceJob='cover';p.vel.x=1;p.vel.y=0;
 for(let i=0;i<8;i++)clock.frameFor(p,.01);
 return {p,clock};
}
describe('defensive gait enters a turn without a walking flash',()=>{
 it('continues the current defensive step while confirming the opposite direction',()=>{
  const {p,clock}=scene();p.facing=-1;p.presentation.sourceJob='idle';p.vel.y=-1;
  const frames=[];
  for(let i=0;i<4;i++){
   const before=JSON.stringify(p),pose=clock.frameFor(p,.01);
   expect(pose.action).toBe('shuffle');expect(JSON.stringify(p)).toBe(before);frames.push(pose.frame);
  }
  expect(new Set(frames).size).toBeGreaterThan(1);
  expect(clock.frameFor(p,.01).action).toBe('turn');
  clock.frameFor(p,PIVOT_DURATION);
  expect(clock.frameFor(p,.01).action).toBe('walk');
 });
 it('does not advance the old step or confirm the turn during repeated paused paints',()=>{
  const {p,clock}=scene();p.facing=-1;p.presentation.sourceJob='idle';p.vel.y=-1;
  const pose=clock.frameFor(p,.01);
  for(let i=0;i<30;i++)expect(clock.frameFor(p,0)).toEqual(pose);
 });
 it('lets a real contact interrupt the pending turn immediately',()=>{
  const {p,clock}=scene();p.facing=-1;p.presentation.sourceJob='idle';p.vel.y=-1;clock.frameFor(p,.01);
  clock.cue(p.id,'bump',false,-1);
  expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9,facing:-1});
 });
 it('finishes the incoming defensive support before rising into a same-facing walk',()=>{
  const {p,clock}=scene();p.presentation.sourceJob='idle';p.vel.y=1;
  expect(clock.actionFor(p)).toBe('walk');
  expect(clock.frameFor(p,.01).action).toBe('shuffle');
  const seen:number[]=[];
  for(let i=0;i<40;i++) {
   const sample=clock.frameFor(p,.01);
   if(sample.action==='walk'&&sample.frame>=24&&seen.at(-1)!==sample.frame)seen.push(sample.frame);
  }
  expect(seen).toEqual([25,26,27]);
 });
 it('keeps explicit action hints and a fresh serve available',()=>{
  const {p,clock}=scene();p.facing=-1;p.presentation.sourceJob='idle';p.vel.y=-1;
  expect(clock.actionFor(p,'set')).toBe('set');
  p.vel.x=0;p.vel.y=0;
  expect(clock.frameFor(p,.01,undefined,{holding:true,holdSeconds:0,tossElapsed:0,jumping:false}).action).toBe('serve');
 });
 it('resets the remembered incoming step between matches',()=>{
  const {p,clock}=scene();p.facing=-1;p.presentation.sourceJob='idle';p.vel.y=-1;clock.reset();
  expect(clock.frameFor(p,.01).action).toBe('walk');
 });
 it('removes phantom walking poses from a natural post-point defensive turn without changing the match',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:7,difficulty:1,humanControlsHome:false};
  const w=new World(config),untouched=new World(config),clock=new SpriteTimeline(),actions:string[]=[],frames:number[]=[];
  const previous=new Map<number,Playhead>();let pivot:{id:number;facing:number}|undefined,completed=false;
  for(let i=0;i<8000;i++){
   w.step(null);untouched.step(null);
   const events=w.drainEvents();expect(events).toEqual(untouched.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const source=previous.get(p.id);
    if(!pivot&&w.phase==='dead'&&p.presentation.action==='none'&&source?.action==='shuffle'
      &&source.facing!==p.facing)pivot={id:p.id,facing:source.facing!};
    const requested=clock.actionFor(p),scale=['walk','shuffle','backpedal','run'].includes(requested)?locomotionPlaybackScale(requested,Math.hypot(p.vel.x,p.vel.y)):1;
    const physical=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT*scale,undefined,undefined,FIXED_DT);
    expect(JSON.stringify(p)).toBe(physical);previous.set(p.id,{...pose,facing:(pose.facing??p.facing) as -1|1});
    if(p.id!==pivot?.id)continue;
    if(actions.at(-1)!==pose.action)actions.push(pose.action);
    if(pose.action==='turn'){
     expect(pose.facing).toBe(pivot.facing);if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
    }else if(frames.length){
     expect(pose).toMatchObject({action:'walk',frame:26,facing:-pivot.facing});completed=true;
    }else expect(pose.action).toBe('shuffle');
   }
   if(completed)break;
  }
  expect(completed).toBe(true);expect(actions).toEqual(['shuffle','turn','walk']);
  expect(frames).toEqual(Array.from({length:24},(_,frame)=>frame));
  expect(w.allPlayers().map(p=>({...p.pos,vel:{...p.vel}}))).toEqual(untouched.allPlayers().map(p=>({...p.pos,vel:{...p.vel}})));
  expect(w.ball.pos).toEqual(untouched.ball.pos);expect(w.ball.vel).toEqual(untouched.ball.vel);
  expect([w.home.points,w.away.points]).toEqual([untouched.home.points,untouched.away.points]);
 });
});
