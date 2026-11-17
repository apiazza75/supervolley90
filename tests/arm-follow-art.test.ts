import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {GAME_SPEED} from '../src/core/rules';
import {SET_GROUND_RECOVERY_TIME} from '../src/core/presentation';
import {CELEBRATE_FRAMES,SET_FOLLOW_FRAMES,CONTACT_FRAME,DURATION,SpriteTimeline} from '../src/render/sprite-figure';

describe('illustrated arm return inbetweens',()=>{
 it.each([60,90,120,144])('keeps every set contact/recovery drawing at %s Hz, with no rendering mutation or pause drift',hz=>{
  const p=new Player(7,'home','setter','TEST',defaultStats()),clock=new SpriteTimeline(),frames:number[]=[];
  clock.cue(p.id,'set',false);
  const duration=DURATION.set*(24-CONTACT_FRAME.set!)/24,step=GAME_SPEED/hz;
  expect(duration).toBeLessThanOrEqual(SET_GROUND_RECOVERY_TIME);
  for(let t=0;t<duration;t+=step){
   const before=JSON.stringify(p),pose=clock.frameFor(p,t===0?0:step);
   expect(pose.action).toBe('set');expect(JSON.stringify(p)).toBe(before);
   expect(clock.frameFor(p,0)).toEqual(pose);if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
  }
  expect(frames).toEqual(SET_FOLLOW_FRAMES);
  clock.cue(p.id,'bump',false);expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
 });
 it.each([60,90,120,144])('shows all celebration drawings once at %s Hz and holds the last pose',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline(),frames=new Set<number>();
  p.celebrate(2);
  for(let t=0;t<1.5;t+=GAME_SPEED/hz){p.animTime=t;const pose=clock.frameFor(p,GAME_SPEED/hz);expect(pose.action).toBe('celebrate');frames.add(pose.frame);}
  expect([...frames]).toEqual(CELEBRATE_FRAMES);expect(clock.frameFor(p,0).frame).toBe(23);
 });
});
