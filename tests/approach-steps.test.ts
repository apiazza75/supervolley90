import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {GAME_SPEED} from '../src/core/rules';
import {SpriteTimeline,approachFrameForPlayer} from '../src/render/sprite-figure';
import {APPROACH_RUN_FRAMES,APPROACH_PLANT_FRAMES} from '../src/render/approach-steps';

describe('alternating illustrated attack supports',()=>{
 it('uses distinct selected drawings and preserves the original plant keys',()=>{
  expect(APPROACH_RUN_FRAMES).toHaveLength(35);
  expect(new Set(APPROACH_RUN_FRAMES).size).toBe(35);
  expect(APPROACH_RUN_FRAMES.filter(f=>f>=24)).toHaveLength(33);
  expect(APPROACH_RUN_FRAMES).not.toContain(58); // over-compressed candidate
  expect(APPROACH_RUN_FRAMES.at(-1)).toBe(APPROACH_PLANT_FRAMES[0]);
 });
 it('unfolds the near shin after the high-knee key instead of retracting it',()=>{
  expect(APPROACH_RUN_FRAMES.slice(0,7)).toEqual([24,25,26,28,29,27,30]);
 });
 it.each([60,90,120,144])('keeps the real short approach deadline at %i Hz',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats());p.licenseApproach('attack',1,.18);
  let last=-1;
  for(let t=0;t<.18;t+=GAME_SPEED/hz){p.approachAge=t;const before=JSON.stringify(p),s=approachFrameForPlayer(p);
   const at=(APPROACH_RUN_FRAMES as readonly number[]).indexOf(s.frame);expect(at).toBeGreaterThanOrEqual(last);last=at;
   expect(s.action).toBe('approach');expect(JSON.stringify(p)).toBe(before);
  }
  p.approachAge=.18;expect(approachFrameForPlayer(p).frame).toBe(15);
  p.jump();expect(new SpriteTimeline().frameFor(p,0).action).toBe('spike');
 });
 it('cannot defer a jump or contact to finish a drawn step',()=>{
  for(let i=0;i<APPROACH_RUN_FRAMES.length;i++){
   const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
   p.licenseApproach('attack',1,.49);p.approachAge=(i+.1)/APPROACH_RUN_FRAMES.length*.49;
   expect(clock.frameFor(p,0).frame).toBe(APPROACH_RUN_FRAMES[i]);
   p.jump();expect(clock.frameFor(p,0).action).toBe('spike');
   clock.cue(p.id,'spike',true,1);expect(clock.frameFor(p,0)).toMatchObject({action:'spike',frame:18});
  }
 });
});
