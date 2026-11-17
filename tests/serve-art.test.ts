/** Actual World input -> sprite phase contracts, not artistic acceptance. */
import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { FIXED_DT } from '../src/core/rules';
import { TEAMS } from '../src/game/teams';
import { Renderer, serveSpriteState } from '../src/render/renderer';
import { Camera } from '../src/render/camera';
import { type Ball } from '../src/core/ball';
import { CONTACT_FRAME, SpriteTimeline } from '../src/render/sprite-figure';
import { STANDING_SERVE_SWING_FRAMES, STANDING_SERVE_TOSS_RELEASE_FRAMES } from '../src/render/serve-swing';
import { JUMP_SERVE_TOSS_FRAMES, JUMP_SERVE_RUNUP_FRAMES } from '../src/render/jump-serve-entry';

function scene() {
  const world = new World({ home: TEAMS[0], away: TEAMS[1], seed: 77, difficulty: 1, humanControlsHome: true });
  return { world, p: world.home.server, clock: new SpriteTimeline() };
}

describe('drawn service follows actual input and flight', () => {
  it.each([48, 66, 120])('never teleports the last approach step after a %i-step load', steps => {
    const { world, p } = scene();
    for (let i = 0; i < steps; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0;
      world.step(cmd); world.drainEvents();
    }
    world.step(idleCommand());
    let planted = false, contacted = false;
    for (let i = 0; i < 300 && !contacted; i++) {
      const before = { ...p.pos }, speed = Math.max(p.runSpeed, Math.hypot(p.vel.x, p.vel.y));
      const grounded = !p.airborne, tossed = world.serveTossInFlight;
      const cmd = idleCommand(); cmd.actionPressed = world.serveStrikeReady;
      world.step(cmd);
      if (tossed && grounded) {
        expect(Math.hypot(p.pos.x - before.x, p.pos.y - before.y)).toBeLessThanOrEqual(speed * FIXED_DT + 1e-6);
        if (p.presentation.phase === 'plant') planted = true;
      }
      for (const event of world.drainEvents()) if (event.type === 'contact' && event.kind === 'serve') {
        expect(event.airborne).toBe(true); contacted = true;
      }
    }
    expect(planted).toBe(true); expect(contacted).toBe(true);
  });
  it.each([10, 66])('keeps the %i-step toss visibly rising without changing its physics', steps => {
    const { world } = scene();
    // No DOM is needed to exercise the real authored palm/ball conversion.
    const renderer: Renderer = Object.assign(Object.create(Renderer.prototype), {
      camera: new Camera(), sheets: {}, serveBallRelease: null,
    });
    const view = () => {
      const physical = { ...world.ball.pos }, velocity = { ...world.ball.vel };
      const ready = world.serveStrikeReady;
      const result = (renderer as any).viewServeBall(world, world.ball) as Ball;
      expect(world.ball.pos).toEqual(physical); expect(world.ball.vel).toEqual(velocity);
      expect(world.serveStrikeReady).toBe(ready);
      expect(Object.values(result.pos).every(Number.isFinite)).toBe(true);
      return result;
    };
    for (let i = 0; i < steps; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0;
      world.step(cmd); view();
    }
    world.step(idleCommand());
    let last = view().pos.z;
    while (!world.serveTossInFlight) {
      world.step(idleCommand());
      const z = view().pos.z;
      expect(z).toBeGreaterThanOrEqual(last - 1e-6); last = z;
    }
    let ascending = 0, descending = 0;
    for (let i = 0; i < 300 && world.serveTossInFlight; i++) {
      world.step(idleCommand());
      if (!world.serveTossInFlight) break;
      const drawn = view();
      if (world.ball.vel.z > 0) {
        expect(drawn.pos.z).toBeGreaterThanOrEqual(last - 1e-6); ascending++;
      } else {
        expect(drawn.pos).toEqual(world.ball.pos); descending++;
      }
      last = drawn.pos.z;
    }
    expect(ascending).toBeGreaterThan(20); expect(descending).toBeGreaterThan(20);
    expect(world.serveTossInFlight).toBe(false);
    const reset = view();
    if (world.phase === 'serve') {
      // A missed practice toss can be caught and returned to the same server.
      // The new held-ball offset must replace the previous high release.
      expect(world.ball.frozen).toBe(true);
      expect(world.home.server.plansJumpServe).toBe(false);
      expect(world.home.server.approaching).toBe(false);
      expect((renderer as any).serveBallRelease.offset).toEqual({
        x: reset.pos.x - world.ball.pos.x, y: reset.pos.y - world.ball.pos.y,
        z: reset.pos.z - world.ball.pos.z,
      });
    } else expect((renderer as any).serveBallRelease).toBeNull();
  });

  it('does not invent a toss while waiting, including after the old timeout', () => {
    const { world, p, clock } = scene();
    const start = { ...p.pos };
    for (let i = 0; i < 1200; i++) {
      world.step(idleCommand());
      expect(clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p))).toMatchObject({ action: 'serve', frame: 0 });
      expect(world.drainEvents().some(e => e.type === 'contact')).toBe(false);
    }
    expect(world.ball.frozen).toBe(true);
    expect(p.pos).toEqual(start);
    expect(serveSpriteState(world, world.away.server)).toBeUndefined();
  });

  it.each([10, 66])('keeps the %i-step charge on preparation drawings without moving', steps => {
    const { world, p, clock } = scene();
    const start = { ...p.pos };
    const visited = new Set<number>();
    for (let i = 0; i < steps; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0;
      world.step(cmd);
      const sample = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
      visited.add(sample.frame);
      expect(sample.action).toBe('serve'); expect(sample.frame).toBeLessThan(6);
      expect(world.ball.frozen).toBe(true); expect(p.pos).toEqual(start);
    }
    expect(visited.size).toBeGreaterThan(1);
    world.step(idleCommand());
    expect(world.serveTossGestureProgress).toBe(0);
    for (let i = 0; i < 30 && !world.serveTossInFlight; i++) {
      expect(world.ball.frozen).toBe(true); expect(p.pos).toEqual(start);
      const gesture = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
      expect(steps > 30 ? [3,32,33,34,35,...JUMP_SERVE_TOSS_FRAMES] : [1,32,33,4,5,6]).toContain(gesture.frame);
      world.step(idleCommand());
    }
    expect(world.serveTossInFlight).toBe(true);
    expect(world.ball.frozen).toBe(false);
    const released = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
    expect(released).toMatchObject({ action: steps > 30 ? 'jumpServe' : 'serve', frame: steps > 30 ? 3 : 7 });
  });

  it('never shows the standing contact drawing without the second input', () => {
    const { world, p, clock } = scene();
    for (let i = 0; i < 10; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0; world.step(cmd);
    }
    world.step(idleCommand());
    for (let i = 0; i < 30 && !world.serveTossInFlight; i++) world.step(idleCommand());
    let readyFrames = 0;
    for (let i = 0; i < 300 && world.serveTossInFlight; i++) {
      if (world.serveStrikeReady) readyFrames++;
      const sample = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
      expect(sample.action).toBe('serve');
      expect(sample.frame < CONTACT_FRAME.serve!
        || (STANDING_SERVE_SWING_FRAMES as readonly number[]).includes(sample.frame)
        || (STANDING_SERVE_TOSS_RELEASE_FRAMES as readonly number[]).includes(sample.frame)).toBe(true);
      world.step(idleCommand());
      expect(world.drainEvents().some(e => e.type === 'contact')).toBe(false);
    }
    expect(readyFrames).toBeGreaterThan(10);
  });

  it('retains the jump-serve drawing from its real contact through the real landing', () => {
    const { world, p, clock } = scene();
    for (let i = 0; i < 66; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0; world.step(cmd);
    }
    world.step(idleCommand());
    let contact = false, landed = false;
    const frames = new Set<number>();
    for (let i = 0; i < 500 && !landed; i++) {
      const cmd = idleCommand(); if (!contact && world.serveStrikeReady) cmd.actionPressed = true;
      world.step(cmd);
      let justHit = false;
      for (const ev of world.drainEvents()) if (ev.type === 'contact' && ev.playerId === p.id && ev.kind === 'serve') {
        expect(ev.airborne).toBe(true); clock.cue(p.id, ev.kind, ev.airborne); contact = justHit = true;
      }
      const sample = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
      frames.add(sample.frame);
      if (justHit) expect(sample).toMatchObject({ action: 'jumpServe', frame: 18 });
      if (contact) {
        expect(sample.action).toBe(justHit ? 'jumpServe' : 'jumpServeFollow');
        if (!justHit && p.height > 0.02) expect(sample.frame).toBeLessThan(17);
        if (p.height === 0) {
          expect(p.presentation).toMatchObject({ action: 'jumpServe', phase: 'land' });
          expect(sample.frame).toBeGreaterThanOrEqual(17); landed = true;
        }
      } else expect([0,32,33,34,35, ...JUMP_SERVE_TOSS_FRAMES, ...JUMP_SERVE_RUNUP_FRAMES, 10, 11, 12, 13, 14, 15, 16, 17]).toContain(sample.frame);
    }
    expect(contact).toBe(true); expect(landed).toBe(true);
    for (let frame = 3; frame <= 12; frame++) expect(frames.has(frame), `missing approach/plant drawing ${frame}`).toBe(true);
    expect(frames.has(12)).toBe(true); expect(frames.has(17)).toBe(true);
  });
});
