import { describe, it, expect } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { GAME_SPEED, FIXED_DT } from '../src/core/rules';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline, locomotionPlaybackScale } from '../src/render/sprite-figure';
import { PIVOT_DURATION } from '../src/render/facing-transition';
import { STOPPING_TURN_END_FRAMES, STOPPING_TURN_REVIEW_FRAMES, stoppingTurnFrame } from '../src/render/turn-playback';

describe('authored running turn to stop inbetweens', () => {
  it.each([59.94, 60, 75, 90, 120, 144])('shows all authored poses without changing pivot duration at %s Hz', hz => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.vel.y = 4; p.facing = 1; clock.frameFor(p, 0, 'run'); p.facing = -1;
    expect(clock.frameFor(p, .05, 'run')).toMatchObject({ action: 'runTurn', frame: 0 });
    p.vel.y = 0;
    const sequence = [0], dt = GAME_SPEED / hz;
    let elapsed = 0, finished = false;
    for (let i = 0; i < 200; i++) {
      const before = JSON.stringify(p), pose = clock.frameFor(p, 0, 'shuffle', undefined, dt);
      elapsed += dt;
      expect(JSON.stringify(p)).toBe(before);
      if (pose.action !== 'runTurn' && pose.action !== 'turnStop') {
        expect(elapsed).toBeGreaterThanOrEqual(PIVOT_DURATION);
        expect(elapsed).toBeLessThan(PIVOT_DURATION + dt * 2.01);
        expect(pose).toMatchObject({ action: 'shuffle', frame: 0, facing: -1 });
        finished = true; break;
      }
      if (sequence.at(-1) !== pose.frame) sequence.push(pose.frame);
      expect(pose.facing).toBe(1);
      if (pose.action === 'turnStop') expect(STOPPING_TURN_END_FRAMES).toContain(pose.frame);
      for (let repaint = 0; repaint < 3; repaint++) expect(clock.frameFor(p, 0, 'shuffle', undefined, 0)).toEqual(pose);
    }
    expect(finished).toBe(true);
    expect(sequence).toEqual(STOPPING_TURN_REVIEW_FRAMES);
  });

  it.each([24,25,26,27])('lets an actual contact interrupt new pose %s without delay', target => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.vel.y = 4; p.facing = 1; clock.frameFor(p, 0, 'run'); p.facing = -1;
    clock.frameFor(p, .05, 'run'); p.vel.y = 0;
    let found = false;
    for (let i = 0; i < 200; i++) {
      const pose = clock.frameFor(p, .003, 'shuffle');
      if (pose.action === 'turnStop' && pose.frame === target) {
        clock.cue(p.id, 'bump', false, -1);
        expect(clock.frameFor(p, 0, 'shuffle')).toMatchObject({ action: 'bump', frame: 9, facing: -1 });
        found = true; break;
      }
    }
    expect(found).toBe(true);
  });

  it('keeps the shared first half and the exact end pose', () => {
    for (let i = 0; i < 12; i++) expect(stoppingTurnFrame((i + .1) / 24)).toBe(i);
    expect(stoppingTurnFrame(.5)).toBe(24);
    expect(stoppingTurnFrame(1)).toBe(23);
    expect(stoppingTurnFrame(5)).toBe(23);
    expect(stoppingTurnFrame(-1)).toBe(0);
  });

  it('keeps the calm seeded post-point walk without rendering mutations', () => {
    const config = { home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false };
    const world = new World(config), reference = new World(config), clock = new SpriteTimeline();
    const observed: number[] = [];
    const postPointActions = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      world.step(null); reference.step(null);
      reference.drainEvents();
      const p = world.findPlayer(3)!;
      for (const e of world.drainEvents()) if (e.type === 'contact' && e.playerId === p.id) clock.cue(p.id, e.kind, e.airborne, e.facing, e.backSet);
      const requested = clock.actionFor(p), speed = Math.hypot(p.vel.x,p.vel.y);
      const scale = ['walk','shuffle','backpedal','run'].includes(requested) ? locomotionPlaybackScale(requested, speed) : 1;
      const before = JSON.stringify(p), pose = clock.frameFor(p, FIXED_DT * scale, undefined, undefined, FIXED_DT);
      expect(JSON.stringify(p)).toBe(before);
      if (world.phase === 'dead') postPointActions.add(pose.action);
      if (pose.action === 'turnStop' && observed.at(-1) !== pose.frame) observed.push(pose.frame);
      if (world.home.points + world.away.points === 1 && world.phase === 'dead' && world.phaseTimer > 1.5) break;
    }
    expect(observed).toEqual([]);
    expect(postPointActions.has('walk')).toBe(true);
    expect(postPointActions.has('runTurn')).toBe(false);
    expect(world.allPlayers().map(p => ({ pos: p.pos, vel: p.vel, height: p.height })))
      .toEqual(reference.allPlayers().map(p => ({ pos: p.pos, vel: p.vel, height: p.height })));
    expect(world.ball.pos).toEqual(reference.ball.pos);
    expect(world.ball.vel).toEqual(reference.ball.vel);
    expect(world.recentEvents).toEqual(reference.recentEvents);
  });

  it('plays the full stopping turn from a current natural running pivot without rendering mutations', () => {
    // Exercise the current tactical world. Replacing reset steering with a
    // legacy implementation no longer guarantees a running pivot after point1.
    const config = { home: TEAMS[0], away: TEAMS[1], seed: 4242, difficulty: 1, humanControlsHome: false };
    const world = new World(config), reference = new World(config), clock = new SpriteTimeline();
    const incoming = new Map<number, number[]>(), observed: number[] = [];
    let pivot: { id: number; facing: number } | undefined, completed = false;
    for (let i = 0; i < 8000; i++) {
      world.step(null); reference.step(null);
      const events = world.drainEvents(); expect(events).toEqual(reference.drainEvents());
      for (const e of events) if (e.type === 'contact') clock.cue(e.playerId, e.kind, e.airborne, e.facing, e.backSet);
      for (const p of world.allPlayers()) {
        const requested = clock.actionFor(p), speed = Math.hypot(p.vel.x,p.vel.y);
        const scale = ['walk','shuffle','backpedal','run'].includes(requested) ? locomotionPlaybackScale(requested, speed) : 1;
        const physical = JSON.stringify(p), pose = clock.frameFor(p, FIXED_DT * scale, undefined, undefined, FIXED_DT);
        expect(JSON.stringify(p)).toBe(physical);
        if (pose.action === 'runTurn') {
          const frames = incoming.get(p.id) ?? [];
          if (frames.at(-1) !== pose.frame) frames.push(pose.frame);
          incoming.set(p.id, frames);
        } else if (!pivot && pose.action === 'turnStop') {
          pivot = { id: p.id, facing: pose.facing! };
          observed.push(...(incoming.get(p.id) ?? []));
        } else if (!pivot) incoming.delete(p.id);
        if (p.id !== pivot?.id) continue;
        if (pose.action === 'turnStop') {
          if (observed.at(-1) !== pose.frame) observed.push(pose.frame);
          expect(pose.facing).toBe(pivot.facing);
          const paused = clock.frameFor(p, 0); expect(paused.action).toBe(pose.action); expect(paused.frame).toBe(pose.frame);
        } else {
          expect(['walk','shuffle']).toContain(pose.action);
          expect(pose.facing ?? p.facing).toBe(-pivot.facing);
          completed = true;
        }
      }
      if (completed) break;
    }
    expect(completed).toBe(true); expect(observed).toEqual(STOPPING_TURN_REVIEW_FRAMES);
    expect(world.allPlayers()).toEqual(reference.allPlayers());
    expect(world.ball).toEqual(reference.ball); expect(world.rng).toEqual(reference.rng);
  });
});
