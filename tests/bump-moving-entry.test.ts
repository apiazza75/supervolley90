import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline} from '../src/render/sprite-figure';
import {PreparationRelease} from '../src/render/preparation-release';
import {RETREAT_BUMP_PREPARATION_FRAMES,BUMP_PREPARATION_FRAMES} from '../src/render/bump-preparation';
import {BUMP_RELEASE_FRAMES} from '../src/render/bump-release';
import {Renderer} from '../src/render/renderer';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';

function retreat(){
 const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
 p.presentation.sourceJob='receive';p.presentation.locomotion='shuffle';p.locomotionIntent={x:0,y:-1};p.facing=1;p.vel.y=-1.5;p.setAnim('shuffle');
 expect(clock.frameFor(p,.01).action).toBe('backpedal');return{p,clock};
}
describe('authored backward footwork to receiving platform',()=>{
 it.each([60,90,120,144])('keeps the low entry and all 11 poses at %s Hz with unchanged physics',hz=>{
  const {p,clock}=retreat(),renderer=Object.create(Renderer.prototype) as Renderer;
  p.setAnim('bump_ready');let accumulator=0;const frames:number[]=[];
  for(let i=0;i<Math.ceil(hz*.4);i++){
   // Crossing into a stationary preparation must not reselect upright art.
   p.vel.y=i>3?0:-1.5;const before=JSON.stringify(p),view=(renderer as any).viewPlayer(p,accumulator);
   const pose=clock.frameFor(view,GAME_SPEED/hz);
   expect(JSON.stringify(p)).toBe(before);expect(pose.action).toBe('bump');
   expect(clock.frameFor(view,0)).toEqual(pose);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   accumulator+=GAME_SPEED/hz;while(accumulator>=FIXED_DT){p.step(FIXED_DT,0,0);accumulator-=FIXED_DT;}
  }
  expect(frames).toEqual(RETREAT_BUMP_PREPARATION_FRAMES);
 });
 it.each([0,.025,.06,.12,.19])('lets a real contact interrupt entry immediately at %s seconds',age=>{
  const {p,clock}=retreat();p.setAnim('bump_ready');p.animTime=age;clock.frameFor(p,.01);
  clock.cue(p.id,'bump',false,1);expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
 });
 it('clears the entry when resetting a player',()=>{
  const {p,clock}=retreat();clock.reset(p.id);p.setAnim('bump_ready');p.animTime=0;
  expect(clock.frameFor(p,0).frame).toBe(BUMP_PREPARATION_FRAMES[0]);
 });
 it('reverses an abandoned low entry without rising through upright poses',()=>{
  const clock=new PreparationRelease(),seen:number[]=[];
  clock.sample(7,{action:'bump',frame:40,frameFloat:40},true,false,0,1);
  clock.sample(7,{action:'bump',frame:43,frameFloat:43},true,false,.05,1);
  for(let i=0;i<20;i++){
   const pose=clock.sample(7,{action:'backpedal',frame:0,frameFloat:0},false,true,.005,1);
   if(pose.action!=='bump')break;if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual([43,42,41,40]);
 });
 it('locates the shared hand-release anchor in the new chronological order',()=>{
  const clock=new PreparationRelease(),seen:number[]=[];
  clock.sample(7,{action:'bump',frame:40,frameFloat:40},true,false,0,1);
  clock.sample(7,{action:'bump',frame:6,frameFloat:6},true,false,.07,1);
  for(let i=0;i<50;i++){
   const pose=clock.sample(7,{action:'shuffle',frame:0,frameFloat:0},false,true,.005,1);
   if(pose.action!=='bump')break;if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual(BUMP_RELEASE_FRAMES);
 });
});
