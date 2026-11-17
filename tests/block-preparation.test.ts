import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { BLOCK_PREPARATION_TIME } from '../src/core/presentation';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline, blockFrameForPlayer } from '../src/render/sprite-figure';
import { v3 } from '../src/core/math3';

const blocker = (id = 3) => {
  const p=new Player(id,'home','middle','TEST',defaultStats());
  p.setAnim('ready');p.presentation.sourceJob='block';p.blockPreparationAge=0;
  return p;
};

describe('grounded illustrated block preparation', () => {
  it('plays seven compression drawings without declaring a jump or contact', () => {
    const p=blocker(),clock=new SpriteTimeline();
    p.vel.x=1.5;
    for(let frame=0;frame<7;frame++) {
      p.blockPreparationAge=(frame+.1)/7*BLOCK_PREPARATION_TIME;
      expect(clock.frameFor(p,.01)).toMatchObject({action:'block',frame});
      expect(p.presentation.action).toBe('none');
      expect(p.height).toBe(0);expect(p.vertVel).toBe(0);
    }
    p.blockPreparationAge=1;
    expect(clock.frameFor(p,.01).frame).toBe(6);
    p.jump();p.setAnim('block');
    expect(blockFrameForPlayer(p).frame).toBeGreaterThanOrEqual(7);
  });

  it('keeps an already planted blocker on the grounded preparation drawings', () => {
    const p=blocker(),clock=new SpriteTimeline();
    for(let frame=2;frame<7;frame++) {
      p.blockPreparationAge=(frame-2+.1)/5*BLOCK_PREPARATION_TIME;
      expect(clock.frameFor(p,.01)).toMatchObject({action:'block',frame});
      expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame});
      expect(p.height).toBe(0);
    }
  });

  it('latches moving entry through the stop and clears the choice for the next preparation', () => {
    const p=blocker(),clock=new SpriteTimeline();
    p.vel.x=1.5;
    expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:0});
    p.vel.x=0;p.blockPreparationAge=BLOCK_PREPARATION_TIME/7;
    expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:1});
    p.blockPreparationAge=undefined;clock.frameFor(p,0);
    p.blockPreparationAge=0;
    expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:2});
    clock.reset(p.id);p.vel.x=1.5;
    expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:0});
    clock.reset();p.vel.x=0;
    expect(clock.frameFor(p,0)).toMatchObject({action:'block',frame:2});
  });

  it('lets real contacts interrupt planted preparation and isolates players', () => {
    const p=blocker(),other=blocker(4),clock=new SpriteTimeline();
    other.vel.x=1.5;
    expect(clock.frameFor(p,0).frame).toBe(2);
    expect(clock.frameFor(other,0).frame).toBe(0);
    clock.cue(p.id,'bump',false,1);
    expect(clock.frameFor(p,0)).toMatchObject({action:'bump',frame:9});
  });

  it('gives a real pass, dive or jump priority over a stale preparation marker', () => {
    for(const anim of ['bump_ready','set_ready','dive','block'] as const) {
      const p=blocker();p.setAnim(anim);
      if(anim==='dive')p.dive(0,1);
      if(anim==='block') {p.height=.5;p.vertVel=3;}
      const sample=new SpriteTimeline().frameFor(p,0);
      expect(sample.action).toBe(anim==='bump_ready'?'bump':anim==='set_ready'?'set':anim);
      if(anim==='block')expect(sample.frame).toBeGreaterThanOrEqual(7);
    }
    const p=blocker(),clock=new SpriteTimeline();clock.frameFor(p,0);
    clock.cue(p.id,'bump',false,1);
    expect(clock.frameFor(p,.01)).toMatchObject({action:'bump',frame:9});
  });

  it('shows both real blockers gathering before the same synchronized takeoff', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    // A high set gives the pair a full read and gather. Quicks and emergency
    // transition balls deliberately offer less time, so the first block of a
    // seeded match is no longer a reliable sample of this complete technique.
    w.phase='rally';w.possession='away';w.touches=2;w.lastToucherSide='away';
    w.ball.frozen=false;w.ball.grounded=false;w.ball.pos=v3(0,1.7,5.25);w.ball.vel=v3(0,0,-.5);
    w.home.frontRow().forEach((p,i)=>{p.pos=v3([-.5,.35,3.5][i],-.72,0);p.vel=v3(i<2?1.5:0,0,0);});
    w.away.players.forEach(p=>{p.pos.y=7;});
    const clock=new SpriteTimeline(),frames=new Map<number,Set<number>>(),speeds=new Map<number,number>();
    for(let i=0;i<1000;i++) {
      w.step(null);
      for(const p of w.allPlayers()) {
        const s=clock.frameFor(p,1/120);
        if(p.blockPreparationAge===undefined)continue;
        expect(w.serveInFlight).toBe(false);expect(w.touches).toBeGreaterThanOrEqual(2);
        expect(w.possession).not.toBe(p.side);expect(p.presentation.action).toBe('none');
        expect(s.action).toBe('block');expect(s.frame).toBeLessThan(7);
        const seen=frames.get(p.id)??new Set<number>();seen.add(s.frame);frames.set(p.id,seen);
        speeds.set(p.id,Math.hypot(p.vel.x,p.vel.y));
      }
      const attempts=w.drainEvents().filter(e=>e.type==='blockAttempt');
      if(!attempts.length)continue;
      expect(attempts).toHaveLength(2);
      for(const e of attempts) {
        expect([...frames.get(e.playerId)!]).toEqual([0,1,2,3,4,5,6]);
        expect(speeds.get(e.playerId)).toBe(0);
        expect(w.findPlayer(e.playerId)!.height).toBeGreaterThan(0);
      }
      return;
    }
    throw new Error('No synchronized block observed');
  });

  it('clears anticipation when the opponent build-up ends', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    for(let i=0;i<1000;i++) {
      w.step(null);w.drainEvents();
      const p=w.allPlayers().find(p=>p.blockPreparationAge!==undefined);
      if(!p)continue;
      w.phase='dead';
      w.step(null);
      expect(w.allPlayers().every(p=>p.blockPreparationAge===undefined)).toBe(true);
      return;
    }
    throw new Error('No preparation observed');
  });
});
