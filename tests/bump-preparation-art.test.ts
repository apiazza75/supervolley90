import {describe,expect,it} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {World} from '../src/core/world';
import {FIXED_DT,GAME_SPEED} from '../src/core/rules';
import {TEAMS} from '../src/game/teams';
import {Renderer} from '../src/render/renderer';
import {SpriteTimeline} from '../src/render/sprite-figure';
import {BUMP_PREPARATION_FRAMES,RETREAT_BUMP_PREPARATION_FRAMES} from '../src/render/bump-preparation';

describe('authored bagher preparation',()=>{
 it.each([60,90,120,144])('keeps every preparation drawing in order across fixed ticks at %s Hz',hz=>{
  const p=new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
  const renderer=Object.create(Renderer.prototype) as Renderer;
  p.setAnim('bump_ready');let accumulator=0;const frames:number[]=[];
  for(let i=0;i<Math.ceil(hz*.4);i++){
   const before=JSON.stringify(p),view=(renderer as any).viewPlayer(p,accumulator);
   const pose=clock.frameFor(view,GAME_SPEED/hz);
   expect(pose.action).toBe('bump');expect(JSON.stringify(p)).toBe(before);
   expect(clock.frameFor(view,0)).toEqual(pose);
   if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
   accumulator+=GAME_SPEED/hz;
   while(accumulator>=FIXED_DT){p.step(FIXED_DT,0,0);accumulator-=FIXED_DT;}
  }
  expect(frames).toEqual(BUMP_PREPARATION_FRAMES);
  p.setAnim('bump_contact');clock.cue(p.id,'bump',false);
  expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
 });
 it('preserves a natural full reception and releases an abandoned preparation without changing the match',()=>{
  const config={home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false};
  const a=new World(config),b=new World(config),clock=new SpriteTimeline();
  const active=new Map<number,number[]>(),previous=new Map<number,string>();let received=false,cancelled=false;
  for(let tick=0;tick<18000&&!(received&&cancelled);tick++){
   a.step(null);b.step(null);const events=a.drainEvents();expect(events).toEqual(b.drainEvents());
   for(const e of events)if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
   for(const p of a.allPlayers()){
    const pose=clock.frameFor(p,FIXED_DT);
    if(p.anim==='bump_ready'){
     if(!active.has(p.id)&&previous.get(p.id)==='backpedal')active.set(p.id,[]);
     const frames=active.get(p.id);if(frames&&frames.at(-1)!==pose.frame)frames.push(pose.frame);
    }else if(active.has(p.id)){
     const frames=active.get(p.id)!;active.delete(p.id);
     const contact=events.find(e=>e.type==='contact'&&e.playerId===p.id);
     if(!received&&contact?.type==='contact'&&contact.kind==='bump'){
      expect(pose).toMatchObject({action:'bump',frame:9});expect(frames).toEqual(RETREAT_BUMP_PREPARATION_FRAMES);received=true;
     }
     if(!cancelled&&!contact&&p.presentation.sourceJob==='block'){
      // The tactical boundary, not a particular frame number, ends the fake
      // receive. The published prefix remains ordered and never rewinds.
      expect(frames.length).toBeGreaterThan(0);expect(frames.length).toBeLessThan(RETREAT_BUMP_PREPARATION_FRAMES.length);
      expect(frames).toEqual(RETREAT_BUMP_PREPARATION_FRAMES.slice(0,frames.length));
      expect(p.presentation.action==='bump'&&p.presentation.phase==='prepare').toBe(false);cancelled=true;
     }
    }
    previous.set(p.id,pose.action);
   }
   expect(JSON.stringify({players:a.allPlayers(),ball:a.ball})).toBe(JSON.stringify({players:b.allPlayers(),ball:b.ball}));
  }
  expect(received).toBe(true);expect(cancelled).toBe(true);
 },15000);
});
