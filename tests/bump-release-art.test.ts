import {describe,expect,it,vi} from 'vitest';
import {PreparationRelease} from '../src/render/preparation-release';
import {BUMP_RELEASE_DURATION,BUMP_RELEASE_FRAMES} from '../src/render/bump-release';
import {GAME_SPEED,FIXED_DT} from '../src/core/rules';
import {World,idleCommand} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {SpriteTimeline,CONTACT_FRAME,spriteActionForContact,type Playhead} from '../src/render/sprite-figure';
import type {TeamBrain} from '../src/core/ai';

const shuffle={action:'shuffle' as const,frame:0,frameFloat:0};
describe('authored bagher to defensive step release',()=>{
 it.each([60,90,120,144])('plays the hand/weight transfer once at %s Hz, including pause',hz=>{
  const clock=new PreparationRelease();clock.sample(1,{action:'bump',frame:6,frameFloat:6},true,false,0,0);
  expect(clock.sample(1,shuffle,false,true,0,1)).toMatchObject({action:'bump',frame:6});
  const frames:number[]=[];let elapsed=0;
  for(let i=0;i<100;i++){
   const pose=clock.sample(1,shuffle,false,true,GAME_SPEED/hz,1.8);
   expect(clock.sample(1,shuffle,false,true,0,1.8)).toEqual(pose);
   if(pose.action==='shuffle')break;
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);elapsed+=GAME_SPEED/hz;
  }
  expect(frames).toEqual(BUMP_RELEASE_FRAMES);
  expect(elapsed).toBeGreaterThanOrEqual(BUMP_RELEASE_DURATION);
  expect(elapsed).toBeLessThan(BUMP_RELEASE_DURATION+GAME_SPEED/hz+1e-9);
  for(let i=0;i<60;i++)expect(clock.sample(1,shuffle,false,true,GAME_SPEED/hz,1.8)).toEqual(shuffle);
 });
 it('returns through deep preparation before entering the moving release',()=>{
  const clock=new PreparationRelease(),frames:number[]=[];
  clock.sample(1,{action:'bump',frame:8,frameFloat:8},true,false,0,1);
  for(let i=0;i<50;i++){
   const pose=clock.sample(1,shuffle,false,true,.005,1);
   if(pose.action==='shuffle')break;if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
  }
  expect(frames).toEqual([8,7,31,30,29,28,...BUMP_RELEASE_FRAMES]);
 });
 it('never borrows the moving release for an idle or backward target',()=>{
  for(const action of ['idle','backpedal'] as const){
   const clock=new PreparationRelease();clock.sample(1,{action:'bump',frame:6,frameFloat:6},true,false,0,0);
   for(let i=0;i<60;i++)expect(BUMP_RELEASE_FRAMES).not.toContain(clock.sample(1,{action,frame:0,frameFloat:0},false,true,.01,1).frame);
  }
 });
 it('yields immediately to contact and clears on reset',()=>{
  const clock=new PreparationRelease();clock.sample(1,{action:'bump',frame:6,frameFloat:6},true,false,0,0);
  clock.sample(1,shuffle,false,true,.01,1);
  const hit={action:'bump' as const,frame:9,frameFloat:9};
  expect(clock.sample(1,hit,false,false,.01,1)).toEqual(hit);
  expect(clock.sample(1,shuffle,false,true,.01,1)).toEqual(shuffle);
  clock.sample(1,{action:'bump',frame:6,frameFloat:6},true,false,0,0);clock.sample(1,shuffle,false,true,.01,1);
  clock.reset();expect(clock.sample(1,shuffle,false,true,.01,1)).toEqual(shuffle);
 });
 it('closes the visible hands smoothly when a cancelled preparation returns',()=>{
  const clock=new PreparationRelease(),prepare={action:'bump' as const,frame:6,frameFloat:6};
  clock.sample(1,prepare,true,false,0,0);clock.sample(1,shuffle,false,true,.01,1);
  clock.sample(1,shuffle,false,true,.105,1);
  const frames:number[]=[];
  for(let i=0;i<25;i++){
   const pose=clock.sample(1,{...prepare,frame:0,frameFloat:0},true,false,.005,1);
   expect(clock.sample(1,{...prepare,frame:0,frameFloat:0},true,false,0,1)).toEqual(pose);
   if(!(BUMP_RELEASE_FRAMES as readonly number[]).includes(pose.frame))break;
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
  }
  expect(frames).toEqual([...BUMP_RELEASE_FRAMES].reverse().slice(1));
 });
 it('does not cancel a human-controlled preparation when the AI job is cover',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:true});
  w.phase='rally';w.ball.pos={x:4,y:4,z:4};w.ball.vel={x:0,y:1,z:0};
  const p=w.home.active;p.setAnim('bump_ready');
  const brain=(w as unknown as {brains:{home:TeamBrain}}).brains.home;
  const spy=vi.spyOn(brain,'commandFor').mockImplementation(player=>{player.presentation.sourceJob='cover';return idleCommand();});
  try{w.step(idleCommand());expect(p.anim).toBe('bump_ready');}finally{spy.mockRestore();}
 });
 it('drops the lost AI receive job promptly and shows every release pose in the natural rally',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:2026,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline();
  const previous=new Map<number,{tick:number;anim:string;job:string;pose:Playhead}>(),frames:number[]=[];
  let releasing:number|undefined,completed=false;
  for(let tick=0;tick<16000;tick++){
   w.step(null);const events=w.drainEvents();
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const source=previous.get(p.id),contact=events.find(e=>e.type==='contact'&&e.playerId===p.id);
    // Detect a lost prepared reception with an actual lateral next step.
    // A backward next job legitimately uses a different authored return.
    if(releasing===undefined&&source?.anim==='bump_ready'&&source.job==='receive'
      &&source.pose.action==='bump'&&[6,7,8,28,29,30,31].includes(source.pose.frame)
      &&!['receive','set'].includes(p.presentation.sourceJob)&&clock.actionFor(p)==='shuffle'&&!contact){
     releasing=p.id;expect(tick-source.tick).toBe(1);expect(p.anim).not.toBe('bump_ready');
    }
    const physical=JSON.stringify({p,ball:w.ball}),pose=clock.frameFor(p,FIXED_DT);
    expect(JSON.stringify({p,ball:w.ball})).toBe(physical);
    previous.set(p.id,{tick,anim:p.anim,job:p.presentation.sourceJob,pose});
    if(p.id!==releasing)continue;
    if(contact?.type==='contact'){
     // A new real touch is allowed to interrupt the return. Verify its exact
     // contact drawing, then seek an uninterrupted release by physical events.
     const action=spriteActionForContact(contact.kind,contact.airborne,contact.backSet)!;
     expect(pose).toMatchObject({action,frame:CONTACT_FRAME[action]});
     releasing=undefined;frames.length=0;continue;
    }
    if(p.presentation.sourceJob==='receive'||p.presentation.sourceJob==='set'){
     releasing=undefined;frames.length=0;continue;
    }
    expect(p.anim).not.toBe('bump_ready');
    if((BUMP_RELEASE_FRAMES as readonly number[]).includes(pose.frame)&&pose.action==='bump'){
     if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
     const paused=clock.frameFor(p,0);expect(paused.action).toBe(pose.action);expect(paused.frame).toBe(pose.frame);
    }else if(frames.length){
     expect(['shuffle','backpedal']).toContain(pose.action);expect(pose.frame).toBe(0);completed=true;
    }
   }
   if(completed)break;
  }
  expect(completed).toBe(true);expect(frames).toEqual(BUMP_RELEASE_FRAMES);
 });
});
