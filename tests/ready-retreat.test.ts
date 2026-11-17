import {describe,expect,it} from 'vitest';
import {ReadyRetreat,READY_RETREAT_FRAMES} from '../src/render/ready-retreat';
import {SpriteTimeline,type Playhead} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {GAME_SPEED,FIXED_DT} from '../src/core/rules';
const pose=(action:Playhead['action'],frame=0,facing:1|-1=1):Playhead=>({action,frame,frameFloat:frame,facing});
describe('ready stance transfers weight before a backward step',()=>{
 it.each([60,90,120,144].flatMap(hz=>(['idle','walk'] as const).map(source=>({hz,source}))))('plays the four drawings once from $source at $hz Hz',({hz,source})=>{
  const entry=new ReadyRetreat(),frames:number[]=[];entry.sample(7,pose(source),0,true);let completed=false;
  for(let t=0;t<.2;t+=GAME_SPEED/hz){const result=entry.sample(7,pose('backpedal',8),GAME_SPEED/hz,true);
   if(result.pose.action==='backpedal'){expect(result.pose.frame).toBe(0);expect(result.pinGait).toBe(true);completed=true;break;}
   if(frames.at(-1)!==result.pose.frame)frames.push(result.pose.frame);
   expect(entry.sample(7,pose('backpedal',8),0,true)).toEqual(result);
  }
  expect(frames).toEqual(READY_RETREAT_FRAMES);expect(completed).toBe(true);
  expect(entry.sample(7,pose('backpedal',1),.01,true)).toEqual({pose:pose('backpedal',1)});
 });
 it.each(['bump','set','block','dive','spike','jumpServe','serve','turn'] as const)('never delays %s',action=>{
  const entry=new ReadyRetreat();entry.sample(7,pose('idle'),0,true);entry.sample(7,pose('backpedal'),.01,true);
  expect(entry.sample(7,pose(action,9),.01,false)).toEqual({pose:pose(action,9)});
  expect(entry.sample(7,pose('backpedal',2),.01,true)).toEqual({pose:pose('backpedal',2)});
 });
 it('does not invent an entry during a step, facing change, or service',()=>{
  for(const source of [pose('walk',5),pose('shuffle'),pose('backpedal',12),pose('idle',0,-1)]){
   const entry=new ReadyRetreat();entry.sample(7,source,0,true);
   expect(entry.sample(7,pose('backpedal'),.01,true)).toEqual({pose:pose('backpedal')});
  }
  const entry=new ReadyRetreat();entry.sample(7,pose('idle'),0,true);
  expect(entry.sample(7,pose('backpedal'),.01,false)).toEqual({pose:pose('backpedal')});
 });
 it('reverses a cancelled weight transfer smoothly back to rest',()=>{
  const entry=new ReadyRetreat(),frames:number[]=[];entry.sample(7,pose('idle'),0,true);
  entry.sample(7,pose('backpedal'),.01,true);entry.sample(7,pose('backpedal'),.075,true);
  for(let i=0;i<15;i++){const result=entry.sample(7,pose('idle'),.006,true);if(frames.at(-1)!==result.pose.frame)frames.push(result.pose.frame);}
  expect(frames).toEqual([26,25,24,0]);
 });
 it('clears targeted and full state',()=>{
  const entry=new ReadyRetreat();for(const id of [7,8])entry.sample(id,pose('idle'),0,true);
  entry.reset(7);expect(entry.sample(7,pose('backpedal'),.01,true).pinGait).toBeUndefined();
  expect(entry.sample(8,pose('backpedal'),.01,true).pinGait).toBe(true);
  entry.reset();expect(entry.sample(8,pose('backpedal'),.01,true).pinGait).toBeUndefined();
 });
 it('treats an implicit fallback facing as the same visible orientation',()=>{
  const entry=new ReadyRetreat();entry.sample(7,pose('walk',0,-1),0,true,-1);
  const unmirrored:Playhead={action:'backpedal',frame:0,frameFloat:0};
  expect(entry.sample(7,unmirrored,.01,true,-1).pose).toMatchObject({action:'idle',frame:24,facing:-1});
 });
 it('closes the recorded natural departure without changing player or ball state',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline(),seen:string[]=[];
  for(let i=0;i<360;i++){
   w.step(null);const p=w.findPlayer(103)!;for(const e of w.drainEvents())if(e.type==='contact'&&e.playerId===p.id)clock.cue(p.id,e.kind,e.airborne,e.facing,e.backSet);
   const before=JSON.stringify({p,ball:w.ball}),s=clock.frameFor(p,FIXED_DT);expect(JSON.stringify({p,ball:w.ball})).toBe(before);
   if(w.rallyTime>2.14){const key=s.action+'/'+s.frame;if(seen.at(-1)!==key)seen.push(key);}
   if(seen.includes('backpedal/1'))break;
  }
  expect(seen).toEqual(['idle/0','idle/24','idle/25','idle/26','idle/27','backpedal/0','backpedal/1']);
 });
 it('completes a natural ready-to-retreat transfer after the first point',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline();
  const seen:string[]=[],previous=new Map<number,Playhead>();let departing:number|undefined;
  for(let i=0;i<8000;i++){
   w.step(null);for(const e of w.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const source=previous.get(p.id),requested=clock.actionFor(p);
    if(departing===undefined&&w.home.points+w.away.points>=1&&requested==='backpedal'
      &&source?.action==='idle'&&source.frame===0&&(source.facing??p.facing)===p.facing){
     departing=p.id;seen.push('idle/0');
    }
    const physical=JSON.stringify({p,ball:w.ball}),s=clock.frameFor(p,FIXED_DT);
    expect(JSON.stringify({p,ball:w.ball})).toBe(physical);previous.set(p.id,s);
    if(p.id!==departing)continue;
    const key=s.action+'/'+s.frame;if(seen.at(-1)!==key)seen.push(key);
    const paused=clock.frameFor(p,0);
    expect({action:paused.action,frame:paused.frame,facing:paused.facing??p.facing})
     .toEqual({action:s.action,frame:s.frame,facing:s.facing??p.facing});
   }
   if(seen.includes('backpedal/0'))break;
  }
  expect(seen).toEqual(['idle/0',...READY_RETREAT_FRAMES.map(frame=>'idle/'+frame),'backpedal/0']);
 });
});
