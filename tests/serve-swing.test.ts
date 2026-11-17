import {describe,expect,it} from 'vitest';
import {World,idleCommand} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {serveSpriteState} from '../src/render/renderer';
import {SpriteTimeline,serveFrameForPlayer,standingServeFollowFrame,DURATION} from '../src/render/sprite-figure';
import {standingServeSwingProgress,STANDING_SERVE_SWING_LEAD,STANDING_SERVE_SWING_FRAMES,STANDING_SERVE_FOLLOW_FRAMES} from '../src/render/serve-swing';
const scene=()=>new World({home:TEAMS[0],away:TEAMS[1],seed:77,difficulty:1,humanControlsHome:true});
function toss(w:World,steps=10){
 for(let i=0;i<steps;i++){const cmd=idleCommand();cmd.actionHeld=true;cmd.actionPressed=i===0;w.step(cmd);w.drainEvents();}
 w.step(idleCommand());while(!w.serveTossInFlight){w.step(idleCommand());w.drainEvents();}
}
describe('standing serve shoulder swing follows the descending toss',()=>{
 it.each([59.94,60,75,90,120,144])('plays every toss-arm in-between at %i Hz with unchanged physical time',hz=>{
  const w=scene();toss(w);const p=w.home.server,clock=new SpriteTimeline(),seen:number[]=[];let lead=0;
  for(let i=0;i<200&&w.serveTossInFlight&&w.serveTossElapsed<.5;i++){
   const before=JSON.stringify({p,ball:w.ball,toss:w.serveTossElapsed,ready:w.serveStrikeReady});
   const state=serveSpriteState(w,p,lead)!,pose=clock.frameFor(p,GAME_SPEED/hz,undefined,state);
   expect(clock.frameFor(p,0,undefined,state)).toEqual(pose);
   expect(JSON.stringify({p,ball:w.ball,toss:w.serveTossElapsed,ready:w.serveStrikeReady})).toBe(before);
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
   expect(pose.frame).not.toBe(15);
   lead+=GAME_SPEED/hz;
   while(lead>=FIXED_DT){w.step(idleCommand());expect(w.drainEvents().some(e=>e.type==='contact')).toBe(false);lead-=FIXED_DT;}
  }
  expect(seen).toEqual([7,8,9,36,37,38,39,10,11,12]);
 });
 it('preserves the original toss key deadlines outside the subdivided lowering',()=>{
  const w=scene(),p=w.home.server;
  for(const [t,frame]of [[0,7],[.07,8],[.14,9],[.21,10],[.28,11],[.35,12],[.7,12]]){
   expect(serveFrameForPlayer(p,{holding:false,holdSeconds:0,tossElapsed:t,jumping:false,standingSwingProgress:0}).frame).toBe(frame);
  }
  expect(serveSpriteState(w,p,FIXED_DT)?.tossElapsed).toBe(0);
 });
 it('keeps the cocked elbow through the high toss, then reaches overhead only just before the cue',()=>{
  const w=scene();toss(w);const p=w.home.server,clock=new SpriteTimeline(),seen:number[]=[];
  let firstSwing:number|undefined,firstOverhead:number|undefined,firstReady:number|undefined,lastProgress=0;
  for(let i=0;i<300&&w.serveTossInFlight;i++){
   const before=JSON.stringify({p,ball:w.ball,timer:w.phaseTimer,ready:w.serveStrikeReady});
   const state=serveSpriteState(w,p)!,progress=state.standingSwingProgress!,pose=clock.frameFor(p,FIXED_DT,undefined,state);
   expect(JSON.stringify({p,ball:w.ball,timer:w.phaseTimer,ready:w.serveStrikeReady})).toBe(before);
   expect(standingServeSwingProgress(w)).toBe(progress);expect(progress).toBeGreaterThanOrEqual(lastProgress-1e-8);lastProgress=progress;
   if(progress>0)firstSwing??=w.serveTossElapsed;
   if(pose.frame===14)firstOverhead??=w.serveTossElapsed;
   if(w.serveStrikeReady)firstReady??=w.serveTossElapsed;
   if(w.serveTossElapsed>.45&&progress===0)expect(pose.frame).toBe(12);
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
   expect(pose.frame).not.toBe(15);
   w.step(idleCommand());expect(w.drainEvents().some(e=>e.type==='contact')).toBe(false);
  }
  expect(seen).toEqual([7,8,9,36,37,38,39,10,11,...STANDING_SERVE_SWING_FRAMES]);
  expect(firstReady).toBeDefined();expect(firstSwing).toBeDefined();expect(firstOverhead).toBeDefined();
  expect(firstReady!-firstSwing!).toBeLessThanOrEqual(STANDING_SERVE_SWING_LEAD+FIXED_DT);
  expect(firstReady!-firstOverhead!).toBeLessThan(.04);
  expect(w.ball.frozen).toBe(true);expect(standingServeSwingProgress(w)).toBe(0);
 });
 it('still contacts on the requested physics tick without extending or delaying the cue',()=>{
  const w=scene();toss(w);const p=w.home.server,clock=new SpriteTimeline();
  while(!w.serveStrikeReady){clock.frameFor(p,FIXED_DT,undefined,serveSpriteState(w,p));w.step(idleCommand());w.drainEvents();}
  const before=w.serveTossElapsed;const cmd=idleCommand();cmd.actionPressed=true;w.step(cmd);
  const contact=w.drainEvents().find(e=>e.type==='contact');expect(contact).toMatchObject({type:'contact',kind:'serve',airborne:false});
  expect(w.phase).toBe('rally');expect(before).toBeGreaterThan(.7);
  clock.cue(p.id,'serve',false);expect(clock.frameFor(p,0)).toMatchObject({action:'serve',frame:15});
 });
 it('does not start a swing during held preparation or a loaded jump serve',()=>{
  const w=scene();expect(standingServeSwingProgress(w)).toBe(0);toss(w,66);
  for(let i=0;i<90&&w.serveTossInFlight;i++){expect(standingServeSwingProgress(w)).toBe(0);w.step(idleCommand());}
 });
 it('repaints the same hand pose while the simulation is paused',()=>{
  const w=scene();toss(w);while(standingServeSwingProgress(w)===0)w.step(idleCommand());
  const p=w.home.server,state=serveSpriteState(w,p)!,pose=serveFrameForPlayer(p,state);
  for(let i=0;i<50;i++)expect(serveFrameForPlayer(p,serveSpriteState(w,p)!)).toEqual(pose);
 });
 it.each([59.94,60,75,90,120,144])('shows every new swing and follow drawing at %i Hz without changing duration or contact',hz=>{
  const w=scene(),p=w.home.server,windup:number[]=[],follow:number[]=[];
  for(let t=0;t<STANDING_SERVE_SWING_LEAD+GAME_SPEED/hz;t+=GAME_SPEED/hz){
   const frame=serveFrameForPlayer(p,{holding:false,holdSeconds:0,tossElapsed:.9,jumping:false,standingSwingProgress:Math.min(1,t/STANDING_SERVE_SWING_LEAD)}).frame;
   if(windup.at(-1)!==frame)windup.push(frame);
  }
  for(let t=15/24*DURATION.serve;t<DURATION.serve+GAME_SPEED/hz;t+=GAME_SPEED/hz){
   const pose=standingServeFollowFrame(t);if(follow.at(-1)!==pose.frame)follow.push(pose.frame);
   expect(standingServeFollowFrame(t)).toEqual(pose);
  }
  expect(windup).toEqual(STANDING_SERVE_SWING_FRAMES);expect(follow).toEqual(STANDING_SERVE_FOLLOW_FRAMES);
  expect(STANDING_SERVE_SWING_FRAMES.indexOf(13)).toBeLessThan(STANDING_SERVE_SWING_FRAMES.indexOf(25));
  expect(standingServeFollowFrame(DURATION.serve)).toMatchObject({action:'serve',frame:23});
 });
});
