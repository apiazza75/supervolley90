import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline} from '../src/render/sprite-figure';
import {DIVE_TURN_FRAMES,DIVE_TURN_SEQUENCE} from '../src/render/dive-turn';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

describe('authored reversal into a diving save',()=>{
 it('preserves original pixels and the reviewed sequence/provenance',()=>{
  const m=JSON.parse(readFileSync('assets/source/manga-2026-09/dive-turn-generation.json','utf8'));
  const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
  expect(hash('public/sprites/dive.png')).toBe(m.originalAtlasSha256);
  expect(hash(m.runtime)).toBe(m.runtimeSha256);
  expect(hash('assets/source/manga-2026-09/'+m.source)).toBe(m.sourceSha256);
  expect(DIVE_TURN_SEQUENCE).toEqual(m.sequence);
  expect(DIVE_TURN_FRAMES).toEqual(m.selectedRuntimeFrames);
 });
 it.each([59.94,60,75,90,120,144])('starts from the visible orientation and completes the drawn push-off at %s Hz',hz=>{
  for(const from of [-1,1]){
   const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();p.pos.y=-5;p.facing=from;
   clock.frameFor(p,0,'backpedal');p.dive(0,-from);p.step(FIXED_DT,0,0);
   const seen:number[]=[],sequence:number[]=[];let rejoined=false;
   for(let i=0;i<Math.ceil(.15*hz/GAME_SPEED);i++){
    const before=JSON.stringify(p),pose=clock.frameFor(p,GAME_SPEED/hz);
    expect(JSON.stringify(p)).toBe(before);expect(clock.frameFor(p,0)).toEqual(pose);
    if(sequence.at(-1)!==pose.frame)sequence.push(pose.frame);
    if(pose.frame>=40){expect(pose.facing).toBe(from);if(seen.at(-1)!==pose.frame)seen.push(pose.frame);}
    else{expect(pose.facing??p.facing).toBe(-from);rejoined=true;}
    p.step(GAME_SPEED/hz,0,0);
   }
   expect(seen).toEqual(DIVE_TURN_FRAMES);expect(rejoined).toBe(true);
   expect(sequence).toEqual(DIVE_TURN_SEQUENCE);
  }
 });
 it('leaves same-direction and unobserved takeoff unchanged and gives contact priority',()=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();p.pos.y=-5;
  clock.frameFor(p,0,'idle');p.dive(0,1);expect(clock.frameFor(p,0).frame).toBe(0);
  clock.reset();p.facing=-1;expect(clock.frameFor(p,0).frame).toBe(0);
  clock.cue(p.id,'save',true,-1);expect(clock.frameFor(p,0)).toMatchObject({action:'dive',frame:9,facing:-1});
 });
 it('interrupts an active torsion for an actual save and clears history on reset',()=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();p.pos.y=-5;
  clock.frameFor(p,0,'backpedal');p.dive(0,-1);
  expect(clock.frameFor(p,0)).toMatchObject({frame:40,facing:1});
  clock.cue(p.id,'save',true,-1);expect(clock.frameFor(p,0)).toMatchObject({frame:9,facing:-1});
  clock.reset();expect(clock.frameFor(p,0)).toMatchObject({frame:0});
 });
 it('connects a natural reversal to its actual save while preserving every simulation tick',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false};
  const w=new World(config),control=new World(config),clock=new SpriteTimeline(),seen:number[]=[];
  const previous=new Map<number,{diving:boolean;facing:number;action:string}>();let diver:number|undefined,from:number|undefined,saved=false;
  for(let i=0;i<12000&&!saved;i++){
   w.step(null);control.step(null);const events=w.drainEvents();expect(events).toEqual(control.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const prior=previous.get(p.id),pose=clock.frameFor(p,FIXED_DT);
    if(diver===undefined&&p.diving&&p.anim==='dive'&&prior&&!prior.diving&&p.facing!==prior.facing&&['idle','walk','shuffle','backpedal','run','runBrake'].includes(prior.action)){diver=p.id;from=prior.facing;}
    if(p.id===diver){
     expect(pose.action).toBe('dive');
     if(pose.frame>=40){expect(pose.facing).toBe(from);if(seen.at(-1)!==pose.frame)seen.push(pose.frame);}
     else expect(pose.facing??p.facing).toBe(-from!);
     saved=events.some(e=>e.type==='contact'&&e.playerId===p.id&&e.kind==='save');
     if(saved)expect(pose.frame).toBe(9);
    }
    previous.set(p.id,{diving:p.diving,facing:pose.facing??p.facing,action:pose.action});
   }
   expect(w.ball).toEqual(control.ball);expect(w.allPlayers()).toEqual(control.allPlayers());
  }
  expect(seen).toEqual(DIVE_TURN_FRAMES);expect(saved).toBe(true);
 });
});
