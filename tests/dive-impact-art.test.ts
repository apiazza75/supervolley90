import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {Renderer} from '../src/render/renderer';
import {diveFrameForPlayer,DIVE_FLOOR_FRAMES} from '../src/render/sprite-figure';

describe('authored dive impact compression',()=>{
 it.each([59.94,60,75,90,120,144])('shows all four new landing drawings at %s Hz without extending physical recovery',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats());p.pos.y=-5;
  p.setAnim('down');p.downTime=.5;
  const renderer=Object.create(Renderer.prototype) as any,frames:number[]=[];
  let remainder=0,ticks=0;
  while(p.downTime>0){
   const before=JSON.stringify(p),view=renderer.viewPlayer(p,remainder);
   const pose=diveFrameForPlayer(view);
   expect(JSON.stringify(p)).toBe(before);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   expect(diveFrameForPlayer(renderer.viewPlayer(p,remainder))).toEqual(pose);
   remainder+=GAME_SPEED/hz;
   while(remainder>=FIXED_DT&&p.downTime>0){p.step(FIXED_DT,0,0);remainder-=FIXED_DT;ticks++;}
  }
  expect(frames).toEqual(DIVE_FLOOR_FRAMES);
  expect(frames.slice(0,4)).toEqual([36,37,38,39]);
  expect(frames).not.toContain(12);
  expect(ticks).toBe(60);expect(p.gettingUp).toBe(.26);
  expect(p.pos.y).toBe(-5);expect(p.canAct).toBe(false);
 });
});
