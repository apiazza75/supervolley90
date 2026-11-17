import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline,SPIKE_PHASE_FRAMES} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';

describe('illustrated takeoff and hitting-arm inbetweens',()=>{
 it('lowers the free arm through the original key pose before the new horizontal reach',()=>{
  // Drawing31 is already horizontal. Playing it before original15 raises the
  // arm again for one frame instead of continuing toward the lowered pose16.
  expect(SPIKE_PHASE_FRAMES.rise!.slice(3,10)).toEqual([14,28,29,30,15,31,16]);
 });
 it.each([60,90,120,144])('shows all thirteen rising poses at %i Hz without changing the player or drifting during pause',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline(),frames:number[]=[];
  p.jump();p.presentation.action='spike';p.presentation.phase='rise';p.height=1;
  for(let t=0;t<.4;t+=GAME_SPEED/hz){
   p.animTime=t;const before=JSON.stringify(p),pose=clock.frameFor(p,GAME_SPEED/hz);
   expect(pose.action).toBe('spike');expect(JSON.stringify(p)).toBe(before);
   expect(clock.frameFor(p,0)).toEqual(pose);if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
  }
  expect(frames).toEqual(SPIKE_PHASE_FRAMES.rise);
  expect(frames.at(-1)).toBe(17);expect(frames).not.toContain(18);
 });
 it('lets an early real contact interrupt any added drawing immediately',()=>{
  for(const frame of SPIKE_PHASE_FRAMES.rise!.filter(f=>f>=24)){
   const t=(SPIKE_PHASE_FRAMES.rise!.indexOf(frame)+.3)/SPIKE_PHASE_FRAMES.rise!.length*.28;
   const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
   p.jump();p.presentation.action='spike';p.presentation.phase='rise';p.animTime=t;
   expect(clock.frameFor(p,0).frame).toBeGreaterThanOrEqual(24);
   clock.cue(p.id,'spike',true,1);expect(clock.frameFor(p,0)).toMatchObject({action:'spike',frame:18});
  }
 });
 it('plays the added poses from a natural takeoff to the real contact without changing physics',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false};
  const w=new World(config),untouched=new World(config),clock=new SpriteTimeline(),frames:number[]=[];
  let hitter:number|undefined,contact=false;
  for(let tick=0;tick<6000&&!contact;tick++){
   w.step(null);untouched.step(null);const events=w.drainEvents();expect(events).toEqual(untouched.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const pose=clock.frameFor(p,FIXED_DT);
    if(hitter===undefined&&p.height>0&&p.presentation.action==='spike'&&p.presentation.phase==='rise'&&p.presentation.sourceJob==='attack')hitter=p.id;
    if(p.id!==hitter)continue;
    expect(pose.action).toBe('spike');
    if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
    contact=events.some(e=>e.type==='contact'&&e.playerId===p.id&&e.kind==='spike');
    if(contact)expect(pose.frame).toBe(18);
   }
   expect(w.ball).toEqual(untouched.ball);expect(w.allPlayers()).toEqual(untouched.allPlayers());
  }
  expect(contact).toBe(true);expect(frames).toEqual([...SPIKE_PHASE_FRAMES.rise!,18]);
 });
});
