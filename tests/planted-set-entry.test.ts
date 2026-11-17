import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline} from '../src/render/sprite-figure';
import {Renderer} from '../src/render/renderer';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {MOVING_SET_PREPARATION_FRAMES} from '../src/render/set-gather';

function support(retreat=false,planted=true){
 const p=new Player(7,'home','setter','TEST',defaultStats()),clock=new SpriteTimeline();
 p.presentation.sourceJob='set';p.presentation.locomotion='shuffle';p.facing=1;
 p.vel.x=retreat?0:1.5;p.vel.y=retreat?-1.5:0;p.locomotionIntent={x:retreat?0:1,y:retreat?-1:0};p.setAnim('shuffle');
 const action=retreat?'backpedal':'shuffle';
 for(let i=0;i<10;i++)expect(clock.frameFor(p,.01).action).toBe(action);
 if(planted){p.vel.x=0;p.vel.y=0;p.setAnim('ready');for(let i=0;i<50;i++)expect(['shuffle','backpedal']).toContain(clock.frameFor(p,.01).action);}
 return {p,clock};
}
describe('set preparation starts from the actual visible foot support',()=>{
 it.each([60,90,120,144].flatMap(hz=>[false,true].flatMap(retreat=>[false,true].map(planted=>({hz,retreat,planted})))))('shows every gathering pose at $hz Hz, retreat=$retreat, planted=$planted',({hz,retreat,planted})=>{
  const {p,clock}=support(retreat,planted),renderer=Object.create(Renderer.prototype) as Renderer;
  p.setAnim('set_ready');let accumulator=0;const frames:number[]=[];
  for(let i=0;i<Math.ceil(hz*.4);i++){
   if(i>3){p.vel.x=0;p.vel.y=0;}
   const before=JSON.stringify(p),view=(renderer as any).viewPlayer(p,accumulator),pose=clock.frameFor(view,GAME_SPEED/hz);
   expect(JSON.stringify(p)).toBe(before);expect(pose.action).toBe('set');expect(clock.frameFor(view,0)).toEqual(pose);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   accumulator+=GAME_SPEED/hz;while(accumulator>=FIXED_DT){p.step(FIXED_DT,0,0);accumulator-=FIXED_DT;}
  }
  expect(frames).toEqual(MOVING_SET_PREPARATION_FRAMES);
 });
 it.each([0,.025,.065,.11,.19])('gives real contact priority at %s seconds',age=>{
  const {p,clock}=support();p.setAnim('set_ready');p.animTime=age;clock.frameFor(p,.01);clock.cue(p.id,'set',false,1);
  expect(clock.frameFor(p,0)).toMatchObject({action:'set',frame:9});
 });
 it('preserves upright entry for an upright player',()=>{
  const p=new Player(7,'home','setter','TEST',defaultStats()),clock=new SpriteTimeline();clock.frameFor(p,.01);p.setAnim('set_ready');
  expect(clock.frameFor(p,0)).toMatchObject({action:'set',frame:0});
 });
 it('forgets the visible support on reset',()=>{
  const {p,clock}=support();clock.reset(p.id);p.setAnim('set_ready');expect(clock.frameFor(p,0).frame).toBe(0);
 });
});
