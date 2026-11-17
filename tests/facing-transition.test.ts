import { describe, expect, it } from 'vitest';
import { FacingTransition, PIVOT_DURATION, PIVOT_INTENT_HOLD } from '../src/render/facing-transition';
import { GAME_SPEED } from '../src/core/rules';

describe('illustrated grounded turn clock', () => {
  it('exposes the orientation used for gait selection without advancing a pending turn', () => {
    const clock=new FacingTransition();
    expect(clock.facingFor(7)).toBeUndefined();
    clock.sample(7,1,0,true);
    clock.sample(7,-1,.02,true);
    expect(clock.facingFor(7)).toBe(1);
    clock.sample(7,-1,PIVOT_INTENT_HOLD,true);
    expect(clock.facingFor(7)).toBe(1);
    clock.sample(7,-1,PIVOT_DURATION,true);
    expect(clock.facingFor(7)).toBe(-1);
    expect(clock.sample(7,-1,.01,true).facing).toBe(-1);
    clock.reset(7);
    expect(clock.facingFor(7)).toBeUndefined();
  });
  it('remembers a runner decelerating during the direction debounce', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true);
    expect(clock.sample(7, -1, .02, true, true)).toEqual({ facing: 1 });
    expect(clock.sample(7, -1, .03, true, false))
      .toEqual({ facing: 1, turnPhase: 0, movingTurn: true });
    expect(clock.sample(7, -1, PIVOT_DURATION, true))
      .toEqual({ facing: 1, turnPhase: 1, movingTurn: true, stoppingTurn: true });
    expect(clock.sample(7, -1, .01, true))
      .toEqual({ facing: -1, completedStoppingTurn: true });
    expect(clock.sample(7, -1, 0, true)).toEqual({ facing: -1 });
  });
  it('chooses braking at the shared midpoint and keeps that ending if speed changes again', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true);
    expect(clock.sample(7, -1, PIVOT_INTENT_HOLD, true, true))
      .toEqual({ facing: 1, turnPhase: 0, movingTurn: true });
    expect(clock.sample(7, -1, PIVOT_DURATION / 2, true, false))
      .toEqual({ facing: 1, turnPhase: .5, movingTurn: true, stoppingTurn: true });
    expect(clock.sample(7, -1, PIVOT_DURATION / 4, true, true))
      .toEqual({ facing: 1, turnPhase: .75, movingTurn: true, stoppingTurn: true });
    expect(clock.sample(7, -1, .01, false, true)).toEqual({ facing: -1 });
  });
  it('keeps the running ending once selected at the midpoint', () => {
    const clock = new FacingTransition();clock.sample(7,1,0,true);
    clock.sample(7,-1,PIVOT_INTENT_HOLD,true,true);
    expect(clock.sample(7,-1,PIVOT_DURATION/2,true,true))
      .toEqual({facing:1,turnPhase:.5,movingTurn:true});
    expect(clock.sample(7,-1,PIVOT_DURATION/2,true,false))
      .toEqual({facing:1,turnPhase:1,movingTurn:true});
    expect(clock.sample(7,-1,.01,true)).toEqual({facing:-1,completedMovingTurn:true});
  });
  it.each([1, -1] as const)('turns from %i through every authored frame before releasing the new facing', from => {
    const clock = new FacingTransition(), to = -from as -1 | 1;
    clock.sample(7, from, 0, true);
    expect(clock.sample(7, to, PIVOT_INTENT_HOLD, true)).toEqual({ facing: from, turnPhase: 0 });
    const frames = new Set([0]);
    for (let i = 0; i < 100; i++) {
      const sample = clock.sample(7, to, GAME_SPEED / 60, true);
      if (sample.turnPhase === undefined) {
        expect(sample.facing).toBe(to);
        expect([...frames]).toEqual(Array.from({length:24}, (_,n)=>n));
        return;
      }
      expect(sample.facing).toBe(from);
      frames.add(Math.min(23, Math.floor(sample.turnPhase * 24)));
    }
    throw Error('Turn never finishes');
  });

  it('does not turn for a transient opposite request or when paused', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true);
    expect(clock.sample(7, -1, .02, true)).toEqual({ facing: 1 });
    expect(clock.sample(7, 1, .02, true)).toEqual({ facing: 1 });
    for (let i=0;i<30;i++) expect(clock.sample(7, -1, 0, true)).toEqual({ facing: 1 });
  });

  it('gives a new physical skill priority over an unfinished pivot', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true);
    clock.sample(7, -1, PIVOT_INTENT_HOLD, true);
    expect(clock.sample(7, -1, .01, false)).toEqual({ facing: -1 });
    expect(clock.sample(7, -1, .01, true)).toEqual({ facing: -1 });
  });

  it('commits a started pivot before beginning the next grounded direction', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true);
    clock.sample(7, -1, PIVOT_INTENT_HOLD, true);
    expect(clock.sample(7, 1, PIVOT_DURATION, true)).toEqual({ facing: 1, turnPhase: 1 });
    expect(clock.sample(7, 1, .01, true)).toEqual({ facing: -1, completedPlantedTurn: true });
    expect(clock.sample(7, 1, PIVOT_INTENT_HOLD, true)).toEqual({ facing: -1, turnPhase: 0 });
  });

  it('resets the relevant player or the complete match without stale turns', () => {
    const clock = new FacingTransition();
    clock.sample(7, 1, 0, true); clock.sample(8, 1, 0, true);
    clock.reset(7);
    expect(clock.sample(7, -1, 0, true)).toEqual({ facing: -1 });
    expect(clock.sample(8, -1, 0, true)).toEqual({ facing: 1 });
    clock.reset();
    expect(clock.sample(8, -1, 0, true)).toEqual({ facing: -1 });
  });

  it.each(['planted', 'running', 'stopping'] as const)('does not hand off the last %s turn drawing during a pause', kind => {
    const clock = new FacingTransition(), moving = kind !== 'planted';
    clock.sample(7, 1, 0, true);
    clock.sample(7, -1, PIVOT_INTENT_HOLD, true, moving);
    const last = clock.sample(7, -1, PIVOT_DURATION, true, kind === 'running');
    expect(last.turnPhase).toBe(1);
    for (let i = 0; i < 20; i++) expect(clock.sample(7, -1, 0, true, kind === 'running')).toEqual(last);
    const resumed = clock.sample(7, -1, .01, true, kind === 'running');
    expect(resumed.facing).toBe(-1);
    expect(resumed.turnPhase).toBeUndefined();
  });
});
