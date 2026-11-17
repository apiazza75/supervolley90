import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Player,defaultStats} from '../src/core/player';
import {GRAVITY,GAME_SPEED} from '../src/core/rules';
import {blockFrameForPlayer,SpriteTimeline} from '../src/render/sprite-figure';
import {BLOCK_AIR_FRAMES,BLOCK_DESCENT_FRAMES,blockDescentFrame} from '../src/render/block-descent';

describe('authored block arm withdrawal',()=>{
 it('retains the original artwork and reproducible provenance for four new drawings',()=>{
  const m=JSON.parse(readFileSync('assets/source/manga-2026-09/block-descent-generation.json','utf8'));
  const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
  expect(hash('public/sprites/block.png')).toBe(m.originalAtlasSha256);
  expect(hash(m.runtime)).toBe(m.runtimeSha256);
  expect(hash('assets/source/manga-2026-09/'+m.source)).toBe(m.sourceSha256);
  expect(BLOCK_DESCENT_FRAMES).toEqual(m.sequence);
  expect(m.runtimeFrames).toEqual([32,33,34,35]);
 });
 it('subdivides the two overhead-to-forehead gaps, preserving original key times',()=>{
  expect(BLOCK_DESCENT_FRAMES).toEqual([17,32,18,33,34,35,19,20]);
  for(const [phase,frame] of [[16.5,17],[17,32],[17.5,18],[17.75,33],[18,34],[18.25,35],[18.5,19],[19.5,20]]){
   expect(blockDescentFrame(phase)).toBe(frame);
  }
 });
 it.each([59.94,60,75,90,120,144])('shows the four new drawings in physical order at %s Hz',hz=>{
  const p=new Player(2,'home','middle','TEST',defaultStats());p.setAnim('block');
  const gravity=-GRAVITY*1.15,launch=6.65,flight=2*launch/gravity;
  const seen:number[]=[];
  for(let t=0;t<flight;t+=GAME_SPEED/hz){
   p.height=Math.max(.0001,launch*t-.5*gravity*t*t);p.vertVel=launch-gravity*t;
   const before=JSON.stringify(p),pose=blockFrameForPlayer(p);
   expect(JSON.stringify(p)).toBe(before);
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual(BLOCK_AIR_FRAMES);
 });
 it('gives an actual contact priority even in a newly drawn descent pose',()=>{
  const p=new Player(2,'home','middle','TEST',defaultStats()),clock=new SpriteTimeline();
  p.setAnim('block');p.height=1.2;p.vertVel=-3;
  clock.frameFor(p,0);clock.cue(p.id,'block',true,1);
  expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:16});
 });
});
