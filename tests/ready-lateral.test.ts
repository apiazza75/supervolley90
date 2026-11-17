import {describe,expect,it} from 'vitest';
import {ReadyRetreat,READY_LATERAL_FRAMES} from '../src/render/ready-retreat';
import {SpriteTimeline,type Playhead} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {Player,defaultStats} from '../src/core/player';
import {TEAMS} from '../src/game/teams';
import {GAME_SPEED,FIXED_DT} from '../src/core/rules';
const pose=(action:Playhead['action'],frame=0):Playhead=>({action,frame,frameFloat:frame,facing:1});
describe('authored loading into a lateral defensive step',()=>{
 it.each([60,90,120,144].flatMap(hz=>(['idle','walk'] as const).map(source=>({hz,source}))))('plays each new pose once from $source at $hz Hz',({hz,source})=>{
  const clock=new ReadyRetreat(),seen:number[]=[];clock.sample(7,pose(source),0,true);let finished=false;
  for(let t=0;t<.2;t+=GAME_SPEED/hz){const s=clock.sample(7,pose('shuffle',8),GAME_SPEED/hz,true);
   if(s.pose.action==='shuffle'){expect(s.pose.frame).toBe(0);expect(s.pinGait).toBe(true);finished=true;break;}
   if(seen.at(-1)!==s.pose.frame)seen.push(s.pose.frame);expect(clock.sample(7,pose('shuffle',8),0,true)).toEqual(s);
  }
  expect(seen).toEqual(READY_LATERAL_FRAMES);expect(finished).toBe(true);expect(clock.sample(7,pose('shuffle',1),.01,true)).toEqual({pose:pose('shuffle',1)});
 });
 it.each(['run','backpedal','turn','bump','set','block','spike','dive','serve','jumpServe'] as const)('yields immediately to %s without starting a second entry',action=>{
  const clock=new ReadyRetreat();clock.sample(7,pose('idle'),0,true);clock.sample(7,pose('shuffle'),.01,true);
  expect(clock.sample(7,pose(action,9),.01,true)).toEqual({pose:pose(action,9)});
  expect(clock.sample(7,pose('shuffle',4),.01,true)).toEqual({pose:pose('shuffle',4)});
 });
 it('reverses only the already drawn loading when movement is abandoned',()=>{
  const clock=new ReadyRetreat(),seen:number[]=[];clock.sample(7,pose('idle'),0,true);
  clock.sample(7,pose('shuffle'),.01,true);clock.sample(7,pose('shuffle'),.075,true);
  for(let i=0;i<15;i++){const s=clock.sample(7,pose('idle'),.006,true);if(seen.at(-1)!==s.pose.frame)seen.push(s.pose.frame);}
  expect(seen).toEqual([30,29,28,0]);
 });
 it.each(['bump','set'] as const)('an actual %s contact interrupts the visible entry',kind=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();clock.frameFor(p,.01);
  p.presentation.sourceJob='cover';p.presentation.locomotion='shuffle';p.vel.x=1.5;p.locomotionIntent={x:1,y:0};p.setAnim('shuffle');
  expect(clock.frameFor(p,.01)).toMatchObject({action:'idle',frame:28});clock.cue(p.id,kind,false,1);
  expect(clock.frameFor(p,0)).toMatchObject({action:kind,frame:9});
 });
 it.each(['bump','set'] as const)('chooses %s preparation from the reached posture, not the intended next gait',kind=>{
  for(const age of [0,.075]){
   const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();clock.frameFor(p,.01);
   p.presentation.sourceJob='cover';p.presentation.locomotion='shuffle';p.vel.x=1.5;p.locomotionIntent={x:1,y:0};p.setAnim('shuffle');
   clock.frameFor(p,.01);const entry=clock.frameFor(p,age);expect(entry.action).toBe('idle');
   p.vel.x=0;p.setAnim(kind==='set'?'set_ready':'bump_ready');
   expect(clock.frameFor(p,0)).toMatchObject({action:kind,frame:age===0?0:kind==='set'?24:35});
  }
 });
 it.each([1,3])('uses the four drawings in the natural front-row lateral departure of player %s',id=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline(),seen:string[]=[];
  for(let i=0;i<500;i++){
   w.step(null);const p=w.findPlayer(id)!;for(const e of w.drainEvents())if(e.type==='contact'&&e.playerId===id)clock.cue(id,e.kind,e.airborne,e.facing,e.backSet);
   const before=JSON.stringify({p,ball:w.ball}),s=clock.frameFor(p,FIXED_DT);expect(JSON.stringify({p,ball:w.ball})).toBe(before);
   if(w.rallyTime>2.14){const key=s.action+'/'+s.frame;if(seen.at(-1)!==key)seen.push(key);}
   if(seen.includes('shuffle/1'))break;
  }
  expect(seen).toEqual(['idle/0','idle/28','idle/29','idle/30','idle/31','shuffle/0','shuffle/1']);
 });
});
