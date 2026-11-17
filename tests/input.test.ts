import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../src/game/input';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

afterEach(() => vi.unstubAllGlobals());

function keyboard() {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  const input = new InputManager(undefined, target);
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat }));
  };
  return { input, target, key };
}

describe('keyboard edges across display and simulation clocks', () => {
  it('keeps human ownership during menu input lock instead of handing the server to AI', () => {
    const {input,key}=keyboard();key('keydown','Space');input.poll();
    for(let seed=1;seed<=24;seed++) {
      const world=new World({home:TEAMS[0],away:TEAMS[1],seed,difficulty:1,humanControlsHome:true});
      const server=world.home.server,start={...server.pos};
      for(let step=0;step<60;step++)world.step(input.command(true));
      expect(world.serveHoldSeconds).toBe(0);expect(world.serveTossInFlight).toBe(false);
      expect(server.plansJumpServe).toBe(false);expect(server.pos).toEqual(start);
    }
    expect(input.command(true)).toMatchObject({actionPressed:false,actionHeld:false,jumpPressed:false,moveX:0,moveY:0});
    // Suppression is a neutral command, not a mutation of the physical keys.
    expect(input.command().actionHeld).toBe(true);
  });

  it('retains a tap when a display frame has no fixed simulation step', () => {
    const { input, key } = keyboard();
    key('keydown', 'Space'); key('keyup', 'Space');
    input.poll();
    expect(input.command().actionPressed).toBe(true);
    // A fast display may draw again before the fixed 120 Hz clock steps.
    // Menu edges are per display frame; the match command must remain pending.
    input.poll();
    expect(input.actionPressed).toBe(false);
    expect(input.command().actionPressed).toBe(true);
  });

  it('consumes one press once and never turns a held toss button into a strike', () => {
    const { input, key } = keyboard();
    key('keydown', 'Space'); input.poll();
    expect(input.command().actionPressed).toBe(true);
    input.consumeCommandEdges();
    for (let i = 0; i < 6; i++) {
      input.poll();
      expect(input.command().actionPressed).toBe(false);
      expect(input.command().actionHeld).toBe(true);
    }
    key('keyup', 'Space'); input.poll();
    expect(input.command().actionHeld).toBe(false);
    key('keydown', 'Space'); input.poll();
    expect(input.command().actionPressed).toBe(true);
  });

  it('keeps an unconsumed jump independently of the action button', () => {
    const { input, key } = keyboard();
    key('keydown', 'ShiftLeft'); key('keyup', 'ShiftLeft');
    input.poll(); input.poll();
    expect(input.command().jumpPressed).toBe(true);
    expect(input.command().actionPressed).toBe(false);
    input.consumeCommandEdges(); input.poll();
    expect(input.command().jumpPressed).toBe(false);
  });

  it('does not preserve a released level just because its press is pending', () => {
    const { input, key } = keyboard();
    key('keydown', 'Space'); input.poll();
    key('keyup', 'Space'); input.poll();
    expect(input.command().actionPressed).toBe(true);
    expect(input.command().actionHeld).toBe(false);
  });

  it('discards pending presses when changing screens or losing focus', () => {
    const { input, target, key } = keyboard();
    for (const end of [() => input.reset(), () => target.dispatchEvent(new Event('blur'))]) {
      key('keydown', 'Space'); key('keydown', 'ShiftLeft'); input.poll();
      end(); input.poll();
      const command = input.command();
      expect(command.actionPressed).toBe(false);
      expect(command.jumpPressed).toBe(false);
      expect(command.actionHeld).toBe(false);
    }
  });

  it('ignores OS key repeat after the first command was consumed', () => {
    const { input, key } = keyboard();
    key('keydown', 'Space'); input.poll(); input.consumeCommandEdges();
    key('keydown', 'Space', true); input.poll();
    expect(input.command().actionPressed).toBe(false);
  });

  it('delivers a between-frame tap exactly once at a 240 Hz display and a slower fixed simulation', () => {
    const { input, key } = keyboard();
    let accumulator = 0, presses = 0;
    for (let frame = 0; frame < 20; frame++) {
      if (frame === 0) { key('keydown', 'Space'); key('keyup', 'Space'); }
      input.poll();
      accumulator += (1 / 240) * .7;
      while (accumulator >= 1 / 120) {
        if (input.command().actionPressed) presses++;
        input.consumeCommandEdges();
        accumulator -= 1 / 120;
      }
    }
    expect(presses).toBe(1);
  });
});
