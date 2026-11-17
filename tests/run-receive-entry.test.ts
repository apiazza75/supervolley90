import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {SpriteTimeline} from '../src/render/sprite-figure';
import {RETREAT_BUMP_PREPARATION_FRAMES,BUMP_PREPARATION_FRAMES} from '../src/render/bump-preparation';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {Renderer} from '../src/render/renderer';
import {World} from '../src/core/world';
import {TEAMS} from '../src/game/teams';

function runner(){
 const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
 p.pos.y=-5;p.presentation.sourceJob='receive';p.setAnim('run');p.presentation.locomotion='run';
 p.vel.y=3.6;p.facing=1;p.locomotionIntent={x:0,y:1};
 expect(clock.frameFor(p,.01).action).toBe('run');return{p,clock};
}
describe('running defender gathers directly into reception',()=>{
 it('gathers a natural running receiver directly into the complete low preparation and contact',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:7,difficulty:1,humanControlsHome:false};
  const shown=new World(config),control=new World(config),clock=new SpriteTimeline();
  const seen:number[]=[],previous=new Map<number,string>();let receiver:number|undefined,contact=false;
  for(let tick=0;tick<30000&&!contact;tick++){
   shown.step(null);control.step(null);const events=shown.drainEvents();expect(events).toEqual(control.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of shown.allPlayers()){
    const pose=clock.frameFor(p,FIXED_DT);
    if(receiver===undefined&&p.anim==='bump_ready'&&p.presentation.sourceJob==='receive'&&previous.get(p.id)==='run')receiver=p.id;
    if(p.id===receiver){
     contact=events.some(e=>e.type==='contact'&&e.playerId===p.id&&e.kind==='bump');
     expect(pose.action).toBe('bump');
     if(contact)expect(pose.frame).toBe(9);
     else{expect(p.anim).toBe('bump_ready');if(seen.at(-1)!==pose.frame)seen.push(pose.frame);}
    }
    previous.set(p.id,pose.action);
   }
   // Compare full deterministic state; serialization avoids expensive repeated
   // object traversal while seeking this rarer running reception.
   expect(JSON.stringify({players:shown.allPlayers(),ball:shown.ball}))
    .toBe(JSON.stringify({players:control.allPlayers(),ball:control.ball}));
  }
  expect(contact).toBe(true);expect(seen).toEqual(RETREAT_BUMP_PREPARATION_FRAMES);
 },15000);
 it.each([59.94,60,75,90,120,144])('does not stand up between the run and low reception at %s Hz',hz=>{
  const {p,clock}=runner(),r=Object.create(Renderer.prototype) as any;
  p.setAnim('bump_ready');let remainder=0;const seen:number[]=[];
  for(let i=0;i<Math.ceil(hz*.4);i++){
   const snapshot=JSON.stringify(p),view=r.viewPlayer(p,remainder),pose=clock.frameFor(view,GAME_SPEED/hz);
   expect(JSON.stringify(p)).toBe(snapshot);expect(pose.action).toBe('bump');
   if(seen.at(-1)!==pose.frame)seen.push(pose.frame);
   expect(clock.frameFor(view,0)).toEqual(pose);
   remainder+=GAME_SPEED/hz;while(remainder>=FIXED_DT){p.step(FIXED_DT,0,0);remainder-=FIXED_DT;}
  }
  expect(seen).toEqual(RETREAT_BUMP_PREPARATION_FRAMES);
 });
 it('continues the same low preparation after a runner starts braking',()=>{
  const {p,clock}=runner();p.presentation.locomotion='shuffle';p.setAnim('shuffle');p.vel.y=1.5;
  expect(clock.frameFor(p,.01).action).toBe('runBrake');
  p.setAnim('bump_ready');expect(clock.frameFor(p,.01)).toMatchObject({action:'bump',frame:40});
 });
 it('retains immediate priority for an actual contact and forgets the entry on reset',()=>{
  const {p,clock}=runner();p.setAnim('bump_ready');
  expect(clock.frameFor(p,.01).frame).toBe(40);
  clock.cue(p.id,'bump',false,1);expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
  clock.reset(p.id);p.setAnim('bump_ready');p.animTime=0;
  expect(clock.frameFor(p,0).frame).toBe(BUMP_PREPARATION_FRAMES[0]);
 });
});
