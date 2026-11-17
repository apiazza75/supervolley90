import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {GAME_SPEED} from '../src/core/rules';
import {SpriteTimeline,locomotionPlaybackScale} from '../src/render/sprite-figure';
import {RUN_STRIDE_FRAMES,runTimeAtPhase,runPhaseAtTime} from '../src/render/run-stride';
import {brakingVariant} from '../src/render/run-brake';

describe('authored running passing poses',()=>{
 it.each([59.94,60,75,90,120,144])('shows all 26 poses at %s Hz even at maximum stride cadence',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
  p.anim='run';p.presentation.locomotion='run';p.vel.y=6;
  const dt=GAME_SPEED/hz,step=dt*locomotionPlaybackScale('run',6),seen=[clock.frameFor(p,0,'run').frame];
  const state=JSON.stringify(p);
  for(let i=0;i<200;i++){
   const pose=clock.frameFor(p,step,'run',undefined,dt);
   expect(clock.frameFor(p,0,'run',undefined,0)).toEqual(pose);
   expect(JSON.stringify(p)).toBe(state);
   if(pose.frame!==seen.at(-1)){if(pose.frame===0)break;seen.push(pose.frame);}
  }
  expect(seen).toEqual(RUN_STRIDE_FRAMES);
 });
 it('preserves anatomical leg phase in both directions through the expanded timeline',()=>{
  for(let i=0;i<1000;i++){
   const phase=i/1000;
   expect(runPhaseAtTime(runTimeAtPhase(phase))).toBeCloseTo(phase,10);
   expect(runTimeAtPhase(runPhaseAtTime(phase))).toBeCloseTo(phase,10);
  }
 });
 it.each([24,25])('keeps exact contact priority on added pose %s',target=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
  clock.frameFor(p,0,'run');
  let found=false;
  for(let i=0;i<500;i++){
   if(clock.frameFor(p,.002,'run').frame!==target)continue;
   clock.cue(p.id,'bump',false,1);
   expect(clock.frameFor(p,0,'run')).toMatchObject({action:'bump',frame:9});found=true;break;
  }
  expect(found).toBe(true);
 });
 it('chooses the correct braking support from both new pose indexes',()=>{
  expect(brakingVariant(24)).toBe(brakingVariant(4));
  expect(brakingVariant(25)).toBe(brakingVariant(16));
 });
});
