import {describe,expect,it} from 'vitest';
import {BackwardDeparture,BACKWARD_DEPARTURE_FRAMES} from '../src/render/backward-departure';
import {SpriteTimeline,type Playhead} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
const pose=(action:Playhead['action'],frame:number,facing:1|-1=1):Playhead=>({action,frame,frameFloat:frame,facing});
describe('landed hitter backward departure',()=>{
 it.each([60,90,120,144])('plays all four drawings once at %i Hz, then starts gait at zero',hz=>{
  const entry=new BackwardDeparture(),seen:number[]=[];
  entry.sample(7,pose('spikeFollow',22),.01,false);
  let complete=false;
  for(let t=0;t<.18;t+=GAME_SPEED/hz){
   const sample=entry.sample(7,pose('backpedal',8),GAME_SPEED/hz,true);
   if(sample.pose.action==='backpedal'){
    expect(sample.pose.frame).toBe(0);expect(sample.pinGait).toBe(true);complete=true;break;
   }
   if(seen.at(-1)!==sample.pose.frame)seen.push(sample.pose.frame);
   expect(entry.sample(7,pose('backpedal',8),0,true)).toEqual(sample);
  }
  expect(seen).toEqual(BACKWARD_DEPARTURE_FRAMES);expect(complete).toBe(true);
  expect(entry.sample(7,pose('backpedal',1),.01,true)).toEqual({pose:pose('backpedal',1)});
 });
 it.each(['set','bump','block','dive','turn','jumpServe'] as const)('never delays %s during departure',action=>{
  const entry=new BackwardDeparture();entry.sample(7,pose('spikeFollow',22),.01,false);
  expect(entry.sample(7,pose('backpedal',0),.01,true).pose.frame).toBe(28);
  expect(entry.sample(7,pose(action,9),.01,false)).toEqual({pose:pose(action,9)});
  expect(entry.sample(7,pose('backpedal',1),.01,true)).toEqual({pose:pose('backpedal',1)});
 });
 it('does not substitute entry art for ordinary steps, incomplete landings or a facing change',()=>{
  for(const source of [pose('backpedal',12),pose('idle',0),pose('spikeFollow',21),pose('spikeFollow',22,-1)]){
   const entry=new BackwardDeparture();entry.sample(7,source,.01,false);
   expect(entry.sample(7,pose('backpedal',0),.01,true)).toEqual({pose:pose('backpedal',0)});
  }
 });
 it('clears one player without clearing another and supports full reset',()=>{
  const entry=new BackwardDeparture();for(const id of [7,8])entry.sample(id,pose('spikeFollow',22),.01,false);
  entry.reset(7);expect(entry.sample(7,pose('backpedal',0),.01,true).pinGait).toBeUndefined();
  expect(entry.sample(8,pose('backpedal',0),.01,true).pinGait).toBe(true);
  entry.reset();expect(entry.sample(8,pose('backpedal',0),.01,true).pinGait).toBeUndefined();
 });
 it('uses the entry in an unmodified rally without changing physical state or skipping gait zero',()=>{
  const world=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
  const clock=new SpriteTimeline(),seen:string[]=[],previous=new Map<number,Playhead>();
  let departing:number|undefined;
  for(let tick=0;tick<8000;tick++){
   world.step(null);
   for(const event of world.drainEvents())if(event.type==='contact')clock.cue(event.playerId,event.kind,event.airborne,event.facing,event.backSet);
   for(const player of world.allPlayers()){
    const source=previous.get(player.id),requested=clock.actionFor(player);
    if(departing===undefined&&source?.action==='spikeFollow'&&source.frame===22
     &&requested==='backpedal'&&!player.landingPlant&&(source.facing??player.facing)===player.facing){
     departing=player.id;seen.push('spikeFollow/22');
    }
    const physical=JSON.stringify(player),sample=clock.frameFor(player,FIXED_DT);
    expect(JSON.stringify(player)).toBe(physical);previous.set(player.id,sample);
    if(player.id!==departing)continue;
    const key=sample.action+'/'+sample.frame;if(seen.at(-1)!==key)seen.push(key);
    expect(clock.frameFor(player,0)).toEqual(sample);
   }
   if(seen.includes('backpedal/1'))break;
  }
  expect(seen).toEqual(['spikeFollow/22','spikeFollow/28','spikeFollow/29','spikeFollow/30','spikeFollow/31','backpedal/0','backpedal/1']);
 });
});
