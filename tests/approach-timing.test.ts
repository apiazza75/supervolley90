import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline,approachFrameForPlayer} from '../src/render/sprite-figure';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {APPROACH_RUN_FRAMES,APPROACH_PLANT_FRAMES} from '../src/render/approach-steps';

const player=()=>new Player(7,'home','outside','TEST',defaultStats());
describe('attack approach timing follows the anticipated plant',()=>{
 it.each([60,90,120,144])('plays the complete alternating steps before the plant deadline at %i Hz',hz=>{
  const p=player();p.licenseApproach('attack',1,.49);const frames:number[]=[];
  for(let t=0;t<.49;t+=GAME_SPEED/hz){
   p.approachAge=t;const pose=approachFrameForPlayer(p);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
  }
  expect(frames).toEqual(APPROACH_RUN_FRAMES);
 });
 it('does not rewind the step sequence when the AI renews its prediction',()=>{
  const p=player();p.licenseApproach('attack',1,.49);p.approachAge=.3;
  const pose=approachFrameForPlayer(p);p.licenseApproach('attack',1,.18);
  expect(p.approachRunDuration).toBe(.49);expect(approachFrameForPlayer(p)).toEqual(pose);
 });
 it('bounds invalid timing and retains the ordinary player-controlled default',()=>{
  for(const [input,expected] of [[NaN,.58],[Infinity,.58],[-1,.18],[4,.58]] as const){
   const p=player();p.licenseApproach('attack',1,input);expect(p.approachRunDuration).toBe(expected);
  }
  const p=player();p.licenseApproach('serve');expect(p.approachRunDuration).toBe(.58);
 });
 it('resets the deadline only after an approach really ends',()=>{
  const p=player();p.licenseApproach('attack',1,.49);p.step(.1,0,0);p.cancelApproach();
  for(let i=0;i<120;i++)p.step(FIXED_DT,0,0);
  expect(p.approachAge).toBe(0);expect(p.approachRunDuration).toBe(.58);
  p.licenseApproach('attack',1,.35);expect(p.approachRunDuration).toBe(.35);
 });
 it('does not advance on paused drawing or defer a real jump',()=>{
  const p=player(),clock=new SpriteTimeline();p.licenseApproach('attack',1,.49);p.approachAge=.2;
  const pose=clock.frameFor(p,0,'spike'),state=JSON.stringify(p);
  for(let i=0;i<40;i++)expect(clock.frameFor(p,0,'spike')).toEqual(pose);
  expect(JSON.stringify(p)).toBe(state);p.jump();expect(clock.frameFor(p,0,'spike').action).toBe('spike');
 });
 it('shows every gather step in the first natural attack approach without changing the match',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false};
  const w=new World(config),untouched=new World(config),clock=new SpriteTimeline(),frames:number[]=[];
  let hitter:number|undefined,jumped=false;
  for(let tick=0;tick<6000&&!jumped;tick++){
   w.step(null);untouched.step(null);const events=w.drainEvents();expect(events).toEqual(untouched.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of w.allPlayers()){
    const pose=clock.frameFor(p,FIXED_DT);
    if(hitter===undefined&&p.approaching&&p.presentation.sourceJob==='attack'&&!p.landingPlant&&p.height===0)hitter=p.id;
    if(p.id!==hitter)continue;
    if(p.height>0){jumped=true;expect(pose.action).toBe('spike');}
    else{
     expect(pose.action).toBe('approach');
     if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
    }
   }
   expect(w.ball).toEqual(untouched.ball);expect(w.allPlayers()).toEqual(untouched.allPlayers());
  }
  expect(jumped).toBe(true);
  expect(frames).toEqual([...APPROACH_RUN_FRAMES,...APPROACH_PLANT_FRAMES.slice(1)]);
 });
});
