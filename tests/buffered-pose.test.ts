import {beforeEach,describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {Camera} from '../src/render/camera';
import {SHEETS,type SheetSet,type Sheet} from '../src/render/sprites';
import {beginRenderFrame,cueSpriteContact,drawMatchSpritePlayer,playerSpriteDiagnostics,resetSpriteTimeline} from '../src/render/sprite-figure';
import {BUMP_PREPARATION_FRAMES} from '../src/render/bump-preparation';

const camera=new Camera();camera.resize(1280,720);
const ctx={save(){},restore(){},translate(){},scale(){},drawImage(){}} as unknown as CanvasRenderingContext2D;
const sheets=Object.fromEntries(Object.entries(SHEETS).map(([action,layout])=>[action,{
 canvas:{} as HTMLCanvasElement,frames:Array.from({length:40},()=>({sx:0,sy:0,sw:512,sh:512,footX:256,footY:470,boxTop:20,boxBottom:470})),
 nativeBodyHeight:layout.nativeBodyHeight,layout,kitHue:220,variants:new Map(),
} satisfies Sheet])) as SheetSet;
const player=(id:number)=>{const p=new Player(id,'home','outside','TEST',defaultStats());p.pos.y=-3;return p;};
function draw(p:Player,dt:number){
 expect(drawMatchSpritePlayer(ctx,camera,p,sheets,dt)).toBe(true);
 const s=playerSpriteDiagnostics().find(s=>s.playerId===p.id)!;
 return{action:s.action,frame:s.frame,facing:s.facing};
}
beforeEach(()=>{resetSpriteTimeline();beginRenderFrame();});
describe('buffered input cannot invent live match poses',()=>{
 it.each([0,.6,1.5,3.7,-1.5].flatMap(speed=>['buffer','held','both'].map(input=>({speed,input}))))(
  'keeps real footwork at speed$speed with $input input',({speed,input})=>{
   const a=player(7),b=player(8);
   for(const p of [a,b]){p.vel.y=speed;p.setAnim(speed===0?'ready':'run');p.presentation.sourceJob='receive';p.presentation.locomotion=speed===0?'ready':Math.abs(speed)>3?'run':'shuffle';}
   a.actionBuffer=input==='held'?0:.28;a.heldAction=input!=='buffer';
   const before=JSON.stringify(a);
   for(let i=0;i<150;i++){
    beginRenderFrame();const pose=draw(a,.58/60),reference=draw(b,.58/60);
    expect(pose).toEqual(reference);expect(['bump','set','spike','block']).not.toContain(pose.action);
    expect(draw(a,0)).toEqual(pose);
   }
   expect(JSON.stringify(a)).toBe(before);
  });
 it('still plays all real preparation poses and waits for the contact event',()=>{
  const p=player(7);p.setAnim('bump_ready');p.actionBuffer=.28;p.heldAction=true;
  const frames:number[]=[];
  for(let t=0;t<.3;t+=.005){p.animTime=t;const pose=draw(p,.005);expect(pose.action).toBe('bump');if(frames.at(-1)!==pose.frame)frames.push(pose.frame);}
  expect(frames).toEqual(BUMP_PREPARATION_FRAMES);
  p.setAnim('bump_contact');cueSpriteContact(p.id,'bump',false,1);
  expect(draw(p,0)).toMatchObject({action:'bump',frame:9});
 });
 it.each(['bump','set'] as const)('gives a real %s contact immediate priority over travelling feet',kind=>{
  const p=player(7);p.setAnim('run');p.vel.x=4;p.presentation.locomotion='run';p.actionBuffer=.28;p.heldAction=true;
  expect(draw(p,0).action).toBe('run');cueSpriteContact(p.id,kind,false,1);
  expect(draw(p,0)).toMatchObject({action:kind,frame:9});expect(draw(p,0)).toMatchObject({action:kind,frame:9});
 });
 it.each([false,true])('keeps the explicit service clock when jumping=%s',jumping=>{
  const p=player(7),service={holding:true,holdSeconds:0,tossElapsed:0,jumping};p.actionBuffer=.28;p.heldAction=true;
  for(let i=0;i<120;i++){
   expect(drawMatchSpritePlayer(ctx,camera,p,sheets,.58/60,{},service)).toBe(true);
   expect(playerSpriteDiagnostics().find(s=>s.playerId===p.id)).toMatchObject({action:'serve',frame:0});
  }
 });
});
