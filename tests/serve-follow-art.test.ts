import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { FIXED_DT } from '../src/core/rules';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline, jumpServeFollowFrame, remainingJumpFlight } from '../src/render/sprite-figure';
import { Renderer, serveSpriteState } from '../src/render/renderer';

function scene() {
  const world = new World({ home: TEAMS[0], away: TEAMS[1], seed: 77, difficulty: 1, humanControlsHome: true });
  return { world, p: world.home.server, clock: new SpriteTimeline() };
}

describe('authored jump-serve follow-through', () => {
  it('uses all 24 new drawings after an actual serve, reserving planted poses for the floor', () => {
    const { world, p, clock } = scene();
    for (let i = 0; i < 66; i++) {
      const cmd = idleCommand(); cmd.actionHeld = true; cmd.actionPressed = i === 0; world.step(cmd);
    }
    world.step(idleCommand());
    let contact = false, lastFrame = -1, finished = false;
    const visited = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const cmd = idleCommand();
      if (!contact && world.serveStrikeReady) cmd.actionPressed = true;
      world.step(cmd);
      let justHit = false;
      for (const ev of world.drainEvents()) if (ev.type === 'contact' && ev.kind === 'serve' && ev.playerId === p.id) {
        clock.cue(p.id, ev.kind, ev.airborne, ev.facing); contact = justHit = true;
      }
      const stateBefore = JSON.stringify({ pos: p.pos, height: p.height, vel: p.vel, vertVel: p.vertVel, ball: world.ball.pos });
      const sample = clock.frameFor(p, FIXED_DT, undefined, serveSpriteState(world, p));
      expect(JSON.stringify({ pos: p.pos, height: p.height, vel: p.vel, vertVel: p.vertVel, ball: world.ball.pos })).toBe(stateBefore);
      if (justHit) expect(sample).toMatchObject({ action: 'jumpServe', frame: 18 });
      else if (sample.action === 'jumpServeFollow') {
        expect(sample.frame).toBeGreaterThanOrEqual(lastFrame);
        expect(sample.frame - lastFrame).toBeLessThanOrEqual(1);
        expect(sample.frame >= 17).toBe(!p.airborne);
        visited.add(sample.frame); lastFrame = sample.frame;
      } else if (visited.size) { finished = true; break; }
    }
    expect(contact).toBe(true); expect(finished).toBe(true);
    expect([...visited]).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it.each([-1, 1] as const)('keeps contact facing %i through the separate follow sheet without changing the body', facing => {
    const { p, clock } = scene();
    p.height = 1; p.vertVel = 2; p.setAnim('air_contact_jump_serve');
    clock.cue(p.id, 'serve', true, facing);
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'jumpServe', frame: 18, facing });
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'jumpServe', frame: 18, facing });
    p.facing = -facing;
    expect(clock.frameFor(p, FIXED_DT)).toMatchObject({ action: 'jumpServeFollow', frame: 0, facing });
    // Rendering alone must not animate a second ballistic clock.
    expect(clock.frameFor(p, 0.2)).toMatchObject({ action: 'jumpServeFollow', frame: 0, facing });
    p.height = 0; p.vertVel = 0; p.setAnim('land');
    // setAnim itself enforces net facing; only the renderer must be read-only.
    p.facing = -facing;
    expect(clock.frameFor(p, FIXED_DT)).toMatchObject({ action: 'jumpServeFollow', frame: 17, facing });
    expect(p.facing).toBe(-facing);
  });

  it('uses actual flight left for late contacts rather than holding a crouch above the floor', () => {
    const { p } = scene();
    p.height = 0.08; p.vertVel = -3;
    const flight = remainingJumpFlight(p);
    expect(flight).toBeGreaterThan(0); expect(flight).toBeLessThan(0.03);
    expect(jumpServeFollowFrame(p, flight).frame).toBe(0);
    p.height = 0.002; p.vertVel = -3.2;
    expect(jumpServeFollowFrame(p, flight).frame).toBe(16);
    p.height = 0; p.vertVel = 0;
    expect(jumpServeFollowFrame(p, flight, 0)).toMatchObject({ action: 'jumpServeFollow', frame: 17 });
    expect(jumpServeFollowFrame(p, flight, 0.149).frame).toBe(23);
  });

  it('matches a floor pose to the rendered landing when the physics tick still has a few centimetres left', () => {
    const { p } = scene();
    p.height = 0.04; p.vertVel = -5.7;
    const renderer = Object.create(Renderer.prototype) as Renderer;
    const drawn = (renderer as any).viewPlayer(p, 0.008);
    expect(drawn.height).toBe(0);
    expect(p.height).toBe(0.04);
    expect(jumpServeFollowFrame(drawn, 0.8).frame).toBe(17);
    expect(jumpServeFollowFrame(p, 0.8).frame).toBe(16);
  });
});
