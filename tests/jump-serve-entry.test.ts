import {describe,expect,it} from 'vitest';
import {World,idleCommand} from '../src/core/world';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {TEAMS} from '../src/game/teams';
import {serveSpriteState} from '../src/render/renderer';
import {SpriteTimeline,serveFrameForPlayer} from '../src/render/sprite-figure';
import {JUMP_SERVE_TOSS_FRAMES,JUMP_SERVE_RUNUP_FRAMES,JUMP_SERVE_RISE_FRAMES} from '../src/render/jump-serve-entry';

describe('authored jump-service entry',()=>{
 it.each([60,90,120,144].flatMap(hz=>[48,66,120].map(steps=>({hz,steps}))))('shows all eight new poses at $hz Hz after $steps charge steps without changing input or physics',({hz,steps})=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:77,difficulty:1,humanControlsHome:true});
  const p=w.home.server,clock=new SpriteTimeline(),step=GAME_SPEED/hz,start={...p.pos};
  for(let i=0;i<steps;i++){const cmd=idleCommand();cmd.actionHeld=true;cmd.actionPressed=i===0;w.step(cmd);w.drainEvents();}
  w.step(idleCommand());w.drainEvents();
  let accumulator=0,hit=false;const toss:string[]=[],run:number[]=[];
  for(let i=0;i<300&&!hit;i++){
   const state=serveSpriteState(w,p,accumulator),before=JSON.stringify({p,ball:w.ball,ready:w.serveStrikeReady});
   const sample=clock.frameFor(p,step,undefined,state);
   expect(JSON.stringify({p,ball:w.ball,ready:w.serveStrikeReady})).toBe(before);
   expect(clock.frameFor(p,0,undefined,state)).toEqual(sample);
   if(w.serveTossGestureProgress!==undefined){toss.push(`${sample.action}/${sample.frame}`);expect(w.ball.frozen).toBe(true);expect(p.pos).toEqual(start);}
   else if(w.serveTossInFlight&&p.height===0&&p.presentation.phase!=='plant')run.push(sample.frame);
   accumulator+=step;
   while(accumulator>=FIXED_DT&&!hit){const cmd=idleCommand();cmd.actionPressed=w.serveStrikeReady;w.step(cmd);accumulator-=FIXED_DT;
    for(const e of w.drainEvents())if(e.type==='contact'&&e.kind==='serve'){hit=true;expect(e.airborne).toBe(true);expect(p.height).toBeGreaterThan(.5);}
   }
  }
  expect(hit).toBe(true);
  expect([...new Set(toss)]).toEqual(['serve/3','serve/32','serve/33','serve/34','serve/35','jumpServe/1','jumpServe/28','jumpServe/29','jumpServe/30','jumpServe/2','jumpServe/31','jumpServe/3']);
  expect([...new Set(run)]).toEqual([3,24,4,25,26,27,5,6,7,8,9]);
 });
 it('leaves the latter approach distance windows unchanged',()=>{
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:77,difficulty:1,humanControlsHome:true}),p=w.home.server;
  for(let i=2;i<7;i++)for(const offset of [.001,.1,.5,.99]){
   const progress=(i+offset)/7;
   expect(serveFrameForPlayer(p,{holding:false,holdSeconds:0,tossElapsed:0,jumping:true,runupProgress:progress})).toMatchObject({action:'jumpServe',frame:3+i});
  }
 });
 it('does not put appended entry cells into flight or contact',()=>{
  expect(JUMP_SERVE_TOSS_FRAMES).not.toContain(18);expect(JUMP_SERVE_RUNUP_FRAMES).not.toContain(18);
  const w=new World({home:TEAMS[0],away:TEAMS[1],seed:77,difficulty:1,humanControlsHome:true}),p=w.home.server;
  p.height=.4;p.setAnim('jump_rise');
  for(const t of [0,.04,.08,.12,.16,.3]){p.animTime=t;expect(JUMP_SERVE_RISE_FRAMES).toContain(serveFrameForPlayer(p,{holding:false,holdSeconds:0,tossElapsed:t,jumping:true,runupProgress:0}).frame);}
 });
});
