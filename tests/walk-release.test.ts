import {describe,expect,it} from 'vitest';
import {WalkRelease,WALK_RELEASE_FRAMES} from '../src/render/walk-release';
import {SpriteTimeline,locomotionPlaybackScale,type Playhead} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
const pose=(action:Playhead['action'],frame:number,facing:1|-1=1):Playhead=>({action,frame,frameFloat:frame,facing});
describe('defensive posture releases into walking',()=>{
 it.each([60,90,120,144])('shows every new drawing exactly once at %i Hz and starts the gait at support zero',hz=>{
  const release=new WalkRelease(),seen:number[]=[];
  release.sample(7,pose('shuffle',16),.01,true);
  let finished=false;
  for(let i=0;i<hz;i++) {
   const sample=release.sample(7,pose('walk',9),GAME_SPEED/hz,true);
   expect(sample.pinGait).toBe(true);
   if(sample.pose.frame===0) {finished=true;break;}
   if(seen.at(-1)!==sample.pose.frame)seen.push(sample.pose.frame);
   expect(release.sample(7,pose('walk',9),0,true)).toEqual(sample);
  }
  expect(seen).toEqual(WALK_RELEASE_FRAMES);expect(finished).toBe(true);
  expect(release.sample(7,pose('walk',1),.01,true)).toEqual({pose:pose('walk',1)});
 });
 it.each([['shuffle',2,6],['shuffle',9,15],['backpedal',4,12],['backpedal',19,24]] as const)('finishes %s support from %i to %i without rewinding', (action,start,target)=>{
  const release=new WalkRelease(),seen:number[]=[];
  release.sample(7,pose(action,start),.01,true);
  for(let t=0;t<.4;t+=.005) {
   const sample=release.sample(7,pose('walk',0),.005,true);
   if(sample.pose.action==='walk')break;
   if(seen.at(-1)!==sample.pose.frame)seen.push(sample.pose.frame);
   expect(release.sample(7,pose('walk',0),0,true)).toEqual(sample);
  }
  expect(seen).toEqual(Array.from({length:target-start+1},(_,i)=>(start+i)%24));
 });
 it.each(['set','bump','block','dive','serve','turn','run','shuffle','backpedal'] as const)('immediately yields to %s, without replaying stale entry',action=>{
  const release=new WalkRelease();release.sample(7,pose('shuffle',15),.01,true);
  expect(release.sample(7,pose('walk',0),.01,true).pose.frame).toBe(24);
  expect(release.sample(7,pose(action,4),.01,false)).toEqual({pose:pose(action,4)});
  if(action!=='shuffle'&&action!=='backpedal')expect(release.sample(7,pose('walk',3),.01,true)).toEqual({pose:pose('walk',3)});
 });
 it.each(['turn','turnStop'] as const)('matches the visible final %s orientation, not the pre-turn mirror flag',action=>{
  const release=new WalkRelease();release.sample(7,pose(action,23,1),.01,true);
  expect(release.sample(7,pose('walk',0,-1),.01,true).pose).toEqual(pose('walk',action==='turn'?26:24,-1));
 });
 it('does not invent a release after idle, a partial turn or a mismatched facing',()=>{
  for(const source of [pose('idle',0),pose('turn',12),pose('runBrake',8),pose('shuffle',15,-1)]) {
   const release=new WalkRelease();release.sample(7,source,.01,true);
   expect(release.sample(7,pose('walk',0),.01,true)).toEqual({pose:pose('walk',0)});
  }
 });
 it('holds the final planted posture when movement stops during the release',()=>{
  const release=new WalkRelease();release.sample(7,pose('shuffle',15),.01,true);
  release.sample(7,pose('walk',0),.01,true);
  let sample;
  for(let i=0;i<40;i++)sample=release.sample(7,pose('idle',0),.01,true);
  expect(sample).toEqual({pose:pose('walk',0)});
  expect(release.sample(7,pose('walk',1),.01,true)).toEqual({pose:pose('walk',1)});
 });
 it('does not lose a completed-turn release when the next ordinary pose omits explicit facing',()=>{
  const release=new WalkRelease();release.sample(7,pose('turnStop',23,-1),.01,true,1);
  expect(release.sample(7,pose('walk',0,1),.01,true,1).pose.frame).toBe(24);
  const implicit={action:'walk' as const,frame:0,frameFloat:0};
  expect(release.sample(7,implicit,.01,true,1).pose.frame).toBe(24);
  expect(release.sample(7,implicit,.03,true,1).pose.frame).toBe(28);
 });
 it('resets players independently and never alters world state in a natural defensive-to-walk release',()=>{
  const world=new World({home:TEAMS[0],away:TEAMS[1],seed:7,difficulty:1,humanControlsHome:false});
  const clock=new SpriteTimeline(),seen:number[]=[],previous=new Map<number,Playhead>();
  let releasing:number|undefined,completed=false;
  for(let tick=0;tick<8000;tick++) {
   world.step(null);
   for(const event of world.drainEvents())if(event.type==='contact')clock.cue(event.playerId,event.kind,event.airborne,event.facing,event.backSet);
   for(const player of world.allPlayers()){
    const source=previous.get(player.id),requested=clock.actionFor(player);
    // A completed backward support has the full low-to-upright release.
    // Some lateral supports now legitimately enter at the later drawing25.
    if(releasing===undefined&&world.phase==='dead'&&requested==='walk'&&source?.action==='backpedal'
      &&(source.facing??player.facing)===player.facing)releasing=player.id;
    const scale=['walk','shuffle','run','backpedal'].includes(requested)?locomotionPlaybackScale(requested,Math.hypot(player.vel.x,player.vel.y)):1;
    const before=JSON.stringify(player),sample=clock.frameFor(player,FIXED_DT*scale,undefined,undefined,FIXED_DT);
    expect(JSON.stringify(player)).toBe(before);previous.set(player.id,sample);
    if(player.id!==releasing)continue;
    if(sample.action==='walk'&&sample.frame>=24&&seen.at(-1)!==sample.frame)seen.push(sample.frame);
    if(seen.length&&sample.action==='walk'&&sample.frame===0)completed=true;
   }
   if(completed)break;
  }
  expect(completed).toBe(true);expect(seen).toEqual(WALK_RELEASE_FRAMES);
  const release=new WalkRelease();for(const id of [7,8])release.sample(id,pose('shuffle',15),.01,true);
  release.reset(7);expect(release.sample(7,pose('walk',0),.01,true).pinGait).toBeUndefined();
  expect(release.sample(8,pose('walk',0),.01,true).pose.frame).toBe(24);
  release.reset();expect(release.sample(8,pose('walk',0),.01,true).pinGait).toBeUndefined();
 });
 it('retains the settled defender orientation until the natural pivot begins, without a walking flash',()=>{
  const world=new World({home:TEAMS[0],away:TEAMS[1],seed:7,difficulty:1,humanControlsHome:false});
  const clock=new SpriteTimeline(),actions:string[]=[],previous=new Map<number,Playhead>();
  let pivot:{id:number;facing:number}|undefined,pending=0;
  for(let i=0;i<8000;i++) {
   world.step(null);
   for(const e of world.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of world.allPlayers()){
    const source=previous.get(p.id);
    if(!pivot&&world.phase==='dead'&&p.presentation.action==='none'&&source?.action==='shuffle'
      &&source.facing!==p.facing)pivot={id:p.id,facing:source.facing!};
    const requested=clock.actionFor(p),scale=['walk','shuffle','run','backpedal'].includes(requested)?locomotionPlaybackScale(requested,Math.hypot(p.vel.x,p.vel.y)):1;
    const before=JSON.stringify(p),s=clock.frameFor(p,FIXED_DT*scale,undefined,undefined,FIXED_DT);
    expect(JSON.stringify(p)).toBe(before);previous.set(p.id,{...s,facing:(s.facing??p.facing) as -1|1});
    if(p.id!==pivot?.id)continue;
    expect(s.facing??p.facing).toBe(pivot.facing);
    if(s.action!=='turn'){
     pending++;expect(s.action).toBe('shuffle');
    }
    if(actions.at(-1)!==s.action)actions.push(s.action);
   }
   if(actions.at(-1)==='turn')break;
  }
  expect(pending).toBeGreaterThan(2);expect(actions).toEqual(['shuffle','turn']);
 });
});
