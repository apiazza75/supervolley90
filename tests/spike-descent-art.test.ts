import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {GAME_SPEED,GRAVITY} from '../src/core/rules';
import {airAttackFollowFrame,remainingJumpFlight,SPIKE_FOLLOW_AIR_FRAMES,SPIKE_FOLLOW_LANDING_FRAMES} from '../src/render/sprite-figure';

describe('drawn leg recall and single landing compression',()=>{
 it.each([60,90,120,144])('shows every airborne drawing at %i Hz without mutating physics',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats());p.height=1.49;p.vertVel=1.46;
  const flight=remainingJumpFlight(p),seen:number[]=[];
  for(let t=0;t<flight;t+=GAME_SPEED/hz){
   p.height=1.49+1.46*t+GRAVITY*1.15*t*t/2;p.vertVel=1.46+GRAVITY*1.15*t;
   const snapshot=JSON.stringify(p),pose=airAttackFollowFrame(p,'spikeFollow',flight);
   expect(JSON.stringify(p)).toBe(snapshot);
   expect(airAttackFollowFrame(p,'spikeFollow',flight)).toEqual(pose);
   expect((SPIKE_FOLLOW_LANDING_FRAMES as readonly number[]).includes(pose.frame)).toBe(false);
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual(SPIKE_FOLLOW_AIR_FRAMES);
 });
 it('keeps existing early swing and late descent timings, changing only the leg-recall interval',()=>{
  const p=new Player(7,'home','outside','TEST',defaultStats());p.height=1.49;p.vertVel=1.46;
  const flight=remainingJumpFlight(p);
  for(let at=0;at<17;at+=.125){
   if(at>=10&&at<14)continue;
   const t=flight*at/17;p.height=1.49+1.46*t+GRAVITY*1.15*t*t/2;p.vertVel=1.46+GRAVITY*1.15*t;
   expect(airAttackFollowFrame(p,'spikeFollow',flight).frame).toBe(Math.min(16,Math.floor(at+1e-8)));
  }
 });
 it('plays the complete landing in one compression then recovery and holds its endpoint',()=>{
  const p=new Player(7,'home','outside','TEST',defaultStats());p.setAnim('land');
  const seen:number[]=[];
  for(let t=0;t<=.3;t+=GAME_SPEED/60){
   const pose=airAttackFollowFrame(p,'spikeFollow',.7,t);
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
  }
  expect(seen).toEqual([17,19,18,20,23,21,22]);
  expect(new Set([...SPIKE_FOLLOW_AIR_FRAMES,...seen]).size).toBe(27);
  expect(SPIKE_FOLLOW_AIR_FRAMES).not.toContain(24);
 });
});
