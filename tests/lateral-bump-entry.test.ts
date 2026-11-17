import{describe,expect,it}from'vitest';
import{Player,defaultStats}from'../src/core/player';
import{SpriteTimeline}from'../src/render/sprite-figure';
import{PreparationRelease}from'../src/render/preparation-release';
import{LATERAL_BUMP_PREPARATION_FRAMES,BUMP_PREPARATION_FRAMES}from'../src/render/bump-preparation';
import{Renderer}from'../src/render/renderer';
import{GAME_SPEED,FIXED_DT}from'../src/core/rules';

function lateral(planted=false){
 const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
 p.presentation.sourceJob='receive';p.presentation.locomotion='shuffle';p.facing=1;p.vel.x=1.5;p.locomotionIntent={x:1,y:0};p.setAnim('shuffle');
 for(let i=0;i<10;i++)expect(clock.frameFor(p,.01).action).toBe('shuffle');
 if(planted){p.vel.x=0;p.setAnim('ready');for(let i=0;i<50;i++)expect(clock.frameFor(p,.01).action).toBe('shuffle');}
 return{p,clock};
}
describe('lateral foot support enters the bagher without an upright flash',()=>{
 it.each([60,90,120,144].flatMap(hz=>[false,true].map(planted=>({hz,planted}))))('plays the whole entry at $hz Hz, held support=$planted',({hz,planted})=>{
  const{p,clock}=lateral(planted),renderer=Object.create(Renderer.prototype)as Renderer;p.setAnim('bump_ready');let accumulator=0;const frames:number[]=[];
  for(let i=0;i<Math.ceil(hz*.4);i++){
   p.vel.x=i>3?0:1.5;const before=JSON.stringify(p),view=(renderer as any).viewPlayer(p,accumulator),pose=clock.frameFor(view,GAME_SPEED/hz);
   expect(JSON.stringify(p)).toBe(before);expect(pose.action).toBe('bump');expect(clock.frameFor(view,0)).toEqual(pose);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   accumulator+=GAME_SPEED/hz;while(accumulator>=FIXED_DT){p.step(FIXED_DT,0,0);accumulator-=FIXED_DT;}
  }
  expect(frames).toEqual(LATERAL_BUMP_PREPARATION_FRAMES);
 });
 it.each([0,.025,.065,.11,.19])('yields to actual contact at %s seconds',age=>{
  const{p,clock}=lateral();p.setAnim('bump_ready');p.animTime=age;clock.frameFor(p,.01);clock.cue(p.id,'bump',false,1);
  expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
 });
 it('keeps the upright-origin entry for an actually upright player',()=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();clock.frameFor(p,.01);p.setAnim('bump_ready');
  expect(clock.frameFor(p,0).frame).toBe(BUMP_PREPARATION_FRAMES[0]);
 });
 it('clears lateral entry on reset',()=>{
  const{p,clock}=lateral();clock.reset(p.id);p.setAnim('bump_ready');expect(clock.frameFor(p,0).frame).toBe(0);
 });
 it('releases a cancelled partial gather through the visible low drawings',()=>{
  const clock=new PreparationRelease(),seen:number[]=[];
  for(const frame of [35,33,39,34])clock.sample(7,{action:'bump',frame,frameFloat:frame},true,false,.01,0);
  for(let i=0;i<35;i++){
   const pose=clock.sample(7,{action:'shuffle',frame:15,frameFloat:15},false,true,.005,1);
   expect(clock.sample(7,{action:'shuffle',frame:15,frameFloat:15},false,true,0,1)).toEqual(pose);
   if(pose.action!=='bump')break;if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual([34,39,33,35]);
 });
});
