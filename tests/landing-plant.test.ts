import {describe,expect,it} from 'vitest';
import {Player,defaultStats,type PlayerAnim} from '../src/core/player';
import {World,idleCommand} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,LANDING_LOCK} from '../src/core/rules';
import {SpriteTimeline,SPIKE_FOLLOW_LANDING_FRAMES} from '../src/render/sprite-figure';

const athlete=()=>{const p=new Player(7,'home','outside','TEST',defaultStats());p.pos.y=-4;return p;};
describe('jump landing foot plant',()=>{
 it.each(['air_contact_spike','air_contact_block','air_contact_jump_serve'] as PlayerAnim[])('absorbs %s momentum only at floor contact and resumes after the landing lock',anim=>{
  const p=athlete();p.height=.01;p.vertVel=-3;p.vel.x=1.8;p.vel.y=.4;p.setAnim(anim);p.swing=.1;
  const x=p.pos.x;p.step(FIXED_DT,1,1);
  expect(p.pos.x).toBeCloseTo(x+1.8*FIXED_DT,12);expect(p.height).toBe(0);expect(p.landingPlant).toBe(true);
  const landing={...p.pos};let held=0;
  while(p.animTime+FIXED_DT<LANDING_LOCK){
   p.heldAction=true;p.step(FIXED_DT,1,1);held++;
   expect(p.pos).toEqual(landing);expect(p.vel.x).toBe(0);expect(p.vel.y).toBe(0);
   expect(p.locomotionIntent).toEqual({x:0,y:0});expect(p.jump()).toBe(false);
  }
  expect(held).toBeGreaterThan(10);p.step(FIXED_DT,1,1);
  expect(p.landingPlant).toBe(false);expect(p.anim).not.toBe('land');expect(p.vel.x).toBeGreaterThan(0);
  expect(p.pos.x).toBeGreaterThan(landing.x);
 });
 it('does not turn a diving save into a planted jump landing',()=>{
  const p=athlete();p.dive(1,0);p.height=.01;p.vertVel=-3;const vx=p.vel.x;
  p.step(FIXED_DT,0,0);
  expect(p.height).toBe(0);expect(p.anim).toBe('down');expect(p.sliding).toBeGreaterThan(0);
  expect(p.vel.x).toBeGreaterThan(vx*.8);expect(p.landingPlant).toBe(false);
 });
 it('keeps a naturally landed hitter still for all compression drawings, then starts footwork',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
  const clock=new SpriteTimeline(),frames:number[]=[];
  let hitter:number|undefined,landing:{x:number;y:number}|undefined,resumed=false;
  for(let i=0;i<8000;i++){
   w.step(null);
   for(const e of w.drainEvents())if(e.type==='contact'){
    clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
    if(hitter===undefined&&e.kind==='spike'&&e.airborne)hitter=e.playerId;
   }
   if(hitter===undefined)continue;
   const p=w.findPlayer(hitter)!,physical=JSON.stringify({p,ball:w.ball}),pose=clock.frameFor(p,FIXED_DT);
   expect(JSON.stringify({p,ball:w.ball})).toBe(physical);
   // Attack identity comes from the actual contact: a player can now be a
   // blocker when an older seeded fixture expected their spike landing.
   if(!landing&&p.landingPlant)landing={...p.pos};
   if(!landing)continue;
   if(p.landingPlant){
    expect(p.pos.x).toBeCloseTo(landing.x,10);expect(p.pos.y).toBeCloseTo(landing.y,10);
    expect(pose.action).toBe('spikeFollow');if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
    expect(clock.frameFor(p,0)).toEqual(pose);
   }else if(Math.hypot(p.vel.x,p.vel.y)>.05){
    // New departure drawings belong to this atlas but are not landing poses.
    expect(pose.action !== 'spikeFollow' || pose.frame >= 28).toBe(true);resumed=true;break;
   }
  }
  expect(landing).toBeDefined();expect(frames).toEqual(SPIKE_FOLLOW_LANDING_FRAMES);expect(resumed).toBe(true);
 });
 it('moves a passing teammate instead of displacing planted landing feet',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:true});
  w.phase='rally';w.ball.frozen=true;w.ball.pos.x=4;w.ball.pos.y=7;w.ball.pos.z=5;
  const p=w.home.players[0],mate=w.home.players[1];w.home.activeId=p.id;
  p.pos.x=0;p.pos.y=-4;p.vel.x=0;p.vel.y=0;p.setAnim('jump_rise');p.setAnim('land');p.lockout=LANDING_LOCK;
  mate.pos.x=.15;mate.pos.y=-4;mate.vel.x=0;mate.vel.y=0;
  w.step(idleCommand());expect(p.pos.x).toBe(0);expect(p.pos.y).toBe(-4);expect(mate.pos.x).toBeGreaterThan(.15);
 });
});
