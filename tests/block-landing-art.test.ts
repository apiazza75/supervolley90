import {describe,expect,it} from 'vitest';
import {World} from '../src/core/world';
import {Player,defaultStats} from '../src/core/player';
import {FIXED_DT,GAME_SPEED,LANDING_LOCK} from '../src/core/rules';
import {TEAMS} from '../src/game/teams';
import {Renderer} from '../src/render/renderer';
import {SpriteTimeline,blockFrameForPlayer} from '../src/render/sprite-figure';
import {BLOCK_LANDING_FRAMES} from '../src/render/block-landing';
import {BLOCK_AIR_FRAMES} from '../src/render/block-descent';

describe('authored block landing',()=>{
 it('bridges the four actual pose gaps without replaying an impact',()=>{
  expect(BLOCK_LANDING_FRAMES).toEqual([20,28,24,29,25,26,27,26,30,21,31,22,23]);
  expect(BLOCK_LANDING_FRAMES.filter(f=>f===27)).toHaveLength(1);
  expect(BLOCK_LANDING_FRAMES.filter(f=>f>=28)).toEqual([28,29,30,31]);
 });
 it.each([59.94,60,75,90,120,144].flatMap(hz=>[false,true].map(hit=>({hz,hit}))))('shows one complete planted compression at $hz Hz, contact=$hit',({hz,hit})=>{
  const p=new Player(7,'home','middle','TEST',defaultStats()),clock=new SpriteTimeline();
  const renderer=Object.create(Renderer.prototype) as Renderer;
  p.height=.02;p.vertVel=-3;p.setAnim('block');
  if(hit){p.setAnim('air_contact_block');clock.cue(p.id,'block',true);expect(clock.frameFor(p,0).frame).toBe(16);}
  let accumulator=0,landed=false,finished=false;const frames:number[]=[];
  let plant:typeof p.pos|undefined,ticks=0;
  for(let i=0;i<200&&!finished;i++){
   const before=JSON.stringify(p),view=(renderer as any).viewPlayer(p,accumulator);
   const sample=clock.frameFor(view,GAME_SPEED/hz);
   expect(JSON.stringify(p)).toBe(before);
   expect(clock.frameFor(view,0)).toEqual(sample);
   if(p.landingPlant){
    landed=true;plant??={...p.pos};expect(p.pos).toEqual(plant);
    expect(sample.action).toBe('block');if(frames.at(-1)!==sample.frame)frames.push(sample.frame);
   }else if(landed)finished=true;
   accumulator+=GAME_SPEED/hz;
   while(accumulator>=FIXED_DT){if(p.landingPlant)ticks++;p.step(FIXED_DT,0,0);accumulator-=FIXED_DT;}
  }
  expect(finished).toBe(true);expect(frames).toEqual(BLOCK_LANDING_FRAMES);
  expect(ticks).toBe(Math.ceil(LANDING_LOCK/FIXED_DT));
 });
 it('keeps the landing bridge out of a live airborne block',()=>{
  const p=new Player(7,'home','middle','TEST',defaultStats());p.setAnim('block');
  for(const height of [.001,.02,.2,.8])for(const velocity of [-6,-2,0,2]){
   p.height=height;p.vertVel=velocity;expect(BLOCK_AIR_FRAMES).toContain(blockFrameForPlayer(p).frame);
  }
 });
 it.each([1337,7])('completes natural block landings in seed %i without changing simulation or planted positions',seed=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed,difficulty:1,humanControlsHome:false};
  const a=new World(config),b=new World(config),clock=new SpriteTimeline();
  const active=new Map<number,{frames:number[];plant:typeof a.home.server.pos}>();
  const completed:number[]=[];
  for(let tick=0;tick<6000&&completed.length<6;tick++){
   a.step(null);b.step(null);const events=a.drainEvents();expect(events).toEqual(b.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of a.allPlayers()){
    const pose=clock.frameFor(p,FIXED_DT),landing=active.get(p.id);
    if(p.landingPlant&&p.presentation.action==='block'){
     const current=landing??{frames:[],plant:{...p.pos}};active.set(p.id,current);
     expect(p.pos).toEqual(current.plant);expect(pose.action).toBe('block');
     if(current.frames.at(-1)!==pose.frame)current.frames.push(pose.frame);
    }else if(landing){
     expect(landing.frames).toEqual(BLOCK_LANDING_FRAMES);
     completed.push(p.id);active.delete(p.id);
    }
   }
   expect(a.allPlayers()).toEqual(b.allPlayers());expect(a.ball).toEqual(b.ball);
  }
  expect(completed).toHaveLength(6);
  expect(new Set(completed).size).toBeGreaterThanOrEqual(2);
 });
 it('keeps the authored landing ahead of a newly licensed attack',()=>{
  const p=new Player(7,'home','middle','TEST',defaultStats()),clock=new SpriteTimeline();
  p.height=.02;p.vertVel=-3;p.setAnim('block');clock.frameFor(p,0);
  p.step(FIXED_DT,0,0);expect(p.landingPlant).toBe(true);
  p.licenseApproach('attack',1,.2);const frames:number[]=[];
  while(p.landingPlant){
   const before=JSON.stringify(p),pose=clock.frameFor(p,FIXED_DT);
   expect(JSON.stringify(p)).toBe(before);expect(pose.action).toBe('block');
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   p.step(FIXED_DT,0,0);
  }
  expect(frames).toEqual(BLOCK_LANDING_FRAMES);
 });
});
