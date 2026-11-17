import {describe,expect,it,vi} from 'vitest';
import * as steering from '../src/core/settled-steering';
import {World,idleCommand} from '../src/core/world';
import {TEAMS} from '../src/game/teams';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {Renderer} from '../src/render/renderer';
import {SpriteTimeline,locomotionPlaybackScale} from '../src/render/sprite-figure';
const config={home:TEAMS[0],away:TEAMS[1],seed:19,difficulty:1,humanControlsHome:false};

describe('walking return after a point',()=>{
 it.each([[1,1],[-1,.5],[.1,.02],[0,0]])('preserves direction and small commands for %s,%s',(x,y)=>{
  const result=steering.walkingResetSteering(x,y);
  expect(Math.hypot(result.x,result.y)).toBeLessThanOrEqual(.320000001);
  expect(result.x*y-result.y*x).toBeCloseTo(0,12);
  if(Math.hypot(x,y)<=.32)expect(result).toEqual({x,y});
 });
 it.each([59.94,60,75,90,120,144])('keeps natural post-point walking free of a run flash at %s Hz',hz=>{
  const world=new World(config),clock=new SpriteTimeline(),renderer=Object.create(Renderer.prototype) as any;
  const walking=new Set<string>();let remainder=0,points=0,completedResets=0;
  for(let frame=0;frame<hz*180&&completedResets<3;frame++){
   remainder+=GAME_SPEED/hz;
   while(remainder>=FIXED_DT){world.step(null);remainder-=FIXED_DT;
    for(const e of world.drainEvents()){
     if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
     if(e.type==='point')points++;
     if(e.type==='whistle'&&points>0)completedResets++;
    }
   }
   for(const p of world.allPlayers()){
    const view=renderer.viewPlayer(p,remainder),wanted=clock.actionFor(view);
    const pose=clock.frameFor(view,GAME_SPEED/hz*locomotionPlaybackScale(wanted,Math.hypot(p.vel.x,p.vel.y)),undefined,undefined,GAME_SPEED/hz);
    if(world.phase!=='dead')continue;
    const key=`${points}:${p.id}`;
    if(pose.action==='walk')walking.add(key);
    // A run carried over from the live rally may brake into a walk. Once that
    // walk starts, separation must never accelerate it back into a run.
    if(walking.has(key))expect(pose.action,`point ${points}, player ${p.id}`).not.toBe('run');
   }
  }
  expect(completedResets).toBe(3);expect(walking.size).toBeGreaterThanOrEqual(6);
 });
 it('leaves live ball trajectories, contacts, scores and rotations unchanged',()=>{
  const simulate=()=>{
   const world=new World(config),live:unknown[]=[],events:unknown[]=[];
   for(let tick=0;tick<3600;tick++){
    world.step(null);events.push(...world.drainEvents());
    if(tick%12===0&&(world.phase==='serve'||world.phase==='rally'))live.push({tick,phase:world.phase,
     ball:{pos:{...world.ball.pos},vel:{...world.ball.vel}},score:[world.home.points,world.away.points],
     players:world.allPlayers().map(p=>({id:p.id,pos:{...p.pos},vel:{...p.vel},height:p.height,slot:p.rotationSlot}))});
   }
   return {live,events};
  };
  const original=vi.spyOn(steering,'walkingResetSteering').mockImplementation((x,y)=>({x,y}));
  let before:ReturnType<typeof simulate>;
  try{before=simulate();}finally{original.mockRestore();}
  expect(simulate()).toEqual(before);
 });
 it('does not cap the human-controlled player between points',()=>{
  const world=new World({...config,humanControlsHome:true});world.phase='dead';
  const player=world.humanTeam!.active,cmd={...idleCommand(),moveX:1};
  for(let i=0;i<60;i++){world.step(cmd);world.drainEvents();}
  expect(Math.hypot(player.vel.x,player.vel.y)).toBeGreaterThan(2.55);
 });
});
