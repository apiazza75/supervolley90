import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline,SET_FOLLOW_FRAMES,DURATION,CONTACT_FRAME} from '../src/render/sprite-figure';
import {GAME_SPEED} from '../src/core/rules';

describe('authored forward-set arm return',()=>{
 it('preserves the original atlas and records all four distinct return drawings',()=>{
  const m=JSON.parse(readFileSync('assets/source/manga-2026-09/set-return-generation.json','utf8'));
  const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
  expect(hash('public/sprites/set.png')).toBe(m.originalAtlasSha256);
  expect(hash(m.runtime)).toBe(m.runtimeSha256);
  expect(hash('assets/source/manga-2026-09/'+m.source)).toBe(m.sourceSha256);
  expect(SET_FOLLOW_FRAMES).toEqual(m.sequence);
  expect(new Set(SET_FOLLOW_FRAMES).size).toBe(SET_FOLLOW_FRAMES.length);
  expect(SET_FOLLOW_FRAMES.slice(6,13)).toEqual([15,28,29,16,30,31,17]);
 });
 it.each([59.94,60,75,90,120,144])('plays each return pose once at %s Hz with unchanged contact/deadline',hz=>{
  for(const facing of [-1,1]){
   const p=new Player(7,'home','setter','TEST',defaultStats()),clock=new SpriteTimeline();
   clock.cue(p.id,'set',false,facing);const sequence:number[]=[];
   const dt=GAME_SPEED/hz,duration=DURATION.set*(24-CONTACT_FRAME.set!)/24;
   for(let t=0;t<duration;t+=dt){
    const before=JSON.stringify(p),pose=clock.frameFor(p,t===0?0:dt);
    expect(pose.action).toBe('set');expect(pose.facing).toBe(facing);
    expect(JSON.stringify(p)).toBe(before);expect(clock.frameFor(p,0)).toEqual(pose);
    if(sequence.at(-1)!==pose.frame)sequence.push(pose.frame);
   }
   expect(sequence).toEqual(SET_FOLLOW_FRAMES);
   clock.cue(p.id,'bump',false,facing);
   expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9,facing});
  }
 });
});
