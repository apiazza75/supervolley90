import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { DURATION, SpriteTimeline, spriteActionForContact, BACK_SET_FOLLOW_FRAMES, backSetFollowFrame } from '../src/render/sprite-figure';
import { FIXED_DT, GAME_SPEED } from '../src/core/rules';

const match = () => new World({ home: TEAMS[0], away: TEAMS[1], seed: 4242,
  difficulty: 1, humanControlsHome: false });

describe('directional set artwork', () => {
  it.each([59.94,60,75,90,120,144])('shows every recovery in-between once at %s Hz without extending the action', hz => {
    const frames: number[] = [];
    for (let t = 9 / 24 * DURATION.backSet; t < DURATION.backSet + GAME_SPEED / hz; t += GAME_SPEED / hz) {
      const pose = backSetFollowFrame(t);
      if (frames.at(-1) !== pose.frame) frames.push(pose.frame);
      expect(backSetFollowFrame(t)).toEqual(pose);
    }
    expect(frames).toEqual(BACK_SET_FOLLOW_FRAMES);
    expect(backSetFollowFrame(DURATION.backSet)).toMatchObject({action:'backSet',frame:23});
  });
  it.each([60,90,120,144])('does not insert a forward-set restart in the natural recovery at %s Hz', hz => {
    const w=match(),clock=new SpriteTimeline(),dt=GAME_SPEED/hz;
    let accumulator=0,checked=0,receiver:number|undefined,completed=false;
    const frames:number[]=[];
    for(let frame=0;frame<hz*90;frame++){
      accumulator+=dt;
      while(accumulator>=FIXED_DT){
        w.step(null);accumulator-=FIXED_DT;
        for(const e of w.drainEvents())if(e.type==='contact'){
          clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
          if(receiver===undefined&&e.kind==='set'&&e.backSet)receiver=e.playerId;
        }
      }
      if(receiver===undefined)continue;
      const p=w.findPlayer(receiver)!,physical=JSON.stringify(p),pose=clock.frameFor(p,dt);
      expect(JSON.stringify(p)).toBe(physical);
      if(pose.action==='backSet'){
        checked++;if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
        const paused=clock.frameFor(p,0);
        expect({action:paused.action,frame:paused.frame,facing:paused.facing??p.facing})
          .toEqual({action:pose.action,frame:pose.frame,facing:pose.facing??p.facing});
      }else{
        // Observe the actual directional contact, not a historical setter or
        // rally clock. The complete return strip must precede its next job.
        expect(p.presentation.action!=='set'||p.presentation.phase!=='contact').toBe(true);
        completed=true;break;
      }
    }
    expect(checked).toBeGreaterThan(8);expect(completed).toBe(true);
    expect(frames).toEqual(BACK_SET_FOLLOW_FRAMES);
  });

  it.each([0,1/240,1/120,1/60])('does not restart a forward set between backward-set recovery and the next physics tick (dt %s)', dt => {
    const p=match().away.setter,clock=new SpriteTimeline();p.setAnim('set_contact');
    clock.cue(p.id,'set',false,-1,true);
    expect(clock.frameFor(p,0)).toMatchObject({action:'backSet',frame:9});
    expect(clock.frameFor(p,DURATION.backSet)).toMatchObject({action:'backSet',frame:23});
    const body=JSON.stringify(p);
    for(let i=0;i<3;i++)expect(clock.frameFor(p,dt)).toMatchObject({action:'backSet',frame:23,facing:-1});
    expect(JSON.stringify(p)).toBe(body);
    p.setAnim('set_ready');expect(clock.frameFor(p,dt).action).toBe('set');
    clock.cue(p.id,'bump',false,-1);expect(clock.frameFor(p,dt)).toMatchObject({action:'bump',frame:9});
  });

  it('uses a dedicated drawing, not a mirrored forward set', () => {
    expect(spriteActionForContact('set', false, true)).toBe('backSet');
    expect(spriteActionForContact('set', false, false)).toBe('set');
    expect(spriteActionForContact('bump', false, true)).toBe('bump');
  });

  it('plays every backward-set follow-through pose before releasing to the next job', () => {
    const p = match().home.setter, clock = new SpriteTimeline();
    clock.cue(p.id, 'set', false, -1, true);
    p.facing = 1; p.vel.y = 3.5; p.setAnim('run');
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'backSet', frame: 9, facing: -1 });
    const frames = new Set([9]);
    for (let i = 0; i < 120; i++) {
      const sample = clock.frameFor(p, GAME_SPEED / 60, 'run');
      if (sample.action !== 'backSet') {
        expect(sample.action).toBe('run');
        expect(sample.facing).toBe(-1);
        expect([...frames]).toEqual(BACK_SET_FOLLOW_FRAMES);
        const turns = new Set<number>();
        for (let j = 0; j < 100; j++) {
          const next = clock.frameFor(p, GAME_SPEED / 60, 'run');
          if (next.action === 'runTurn') {
            expect(next.facing).toBe(-1); turns.add(next.frame);
          } else if (turns.size) {
            expect(next).toMatchObject({ action: 'run', frame: 6, facing: 1 });
            expect([...turns]).toEqual(Array.from({ length: 24 }, (_, n) => n));
            return;
          }
        }
        throw new Error('Backward-set release did not complete its moving turn');
      }
      frames.add(sample.frame);
      expect(sample.facing).toBe(-1);
      expect(p.facing).toBe(1);
    }
    throw new Error('Backward set did not finish');
  });

  it.each([[1, 2, false], [-1, -2, false], [1, -2, true], [-1, 2, true]] as const)(
    'records facing %i and outgoing y velocity %i as backSet=%s', (facing, velocity, backward) => {
      const w = match(), p = w.home.setter;
      p.facing = facing; w.ball.vel.y = velocity;
      (w as any).registerTouch(p, 'set', 8);
      expect(w.drainEvents().find(e => e.type === 'contact')).toMatchObject({ type: 'contact', kind: 'set', facing, backSet: backward });
      expect(w.ball.vel.y).toBe(velocity);
      expect(p.facing).toBe(facing);
    });

  it('recognises the actual backward set without changing the seeded pass', () => {
    const w = match(), withoutArt = match(), clock = new SpriteTimeline();
    const physical = (world: World) => JSON.stringify({
      ball: world.ball, players: world.allPlayers(), rng: world.rng,
      phase: world.phase, possession: world.possession, touches: world.touches,
      lastToucherId: world.lastToucherId,
    });
    let setStep = -1;
    for (let step = 0; step < 8000; step++) {
      w.step(idleCommand());
      withoutArt.step(idleCommand());
      const events = w.drainEvents();
      expect(events).toEqual(withoutArt.drainEvents());
      for (const ev of events) if (ev.type === 'contact') {
        clock.cue(ev.playerId, ev.kind, ev.airborne, ev.facing, ev.backSet);
        if (ev.kind === 'set' && ev.backSet && setStep < 0) {
          expect(ev).toMatchObject({ kind: 'set', backSet: true });
          expect(w.ball.vel.y * ev.facing).toBeLessThan(0);
          expect(clock.frameFor(w.findPlayer(ev.playerId)!, 0))
            .toMatchObject({ action: 'backSet', frame: 9, facing: ev.facing });
          setStep = step;
        }
      }
      for (const p of w.allPlayers()) clock.frameFor(p, FIXED_DT);
      // Compare the same tactical simulation with and without animation reads.
      // A historical contact coordinate would freeze unrelated team positioning
      // rather than prove that the artwork leaves the physical pass untouched.
      expect(physical(w)).toBe(physical(withoutArt));
      if (setStep >= 0 && step - setStep >= 120) return;
    }
    throw new Error('The seeded set did not occur');
  });
});
