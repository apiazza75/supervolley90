import { describe, expect, it } from 'vitest';
import { TeamBrain } from '../src/core/ai';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT, POINT_BREAK_SECONDS, type Side } from '../src/core/rules';
import { SpriteTimeline, locomotionPlaybackScale } from '../src/render/sprite-figure';

const lastDeparture = POINT_BREAK_SECONDS - .18;
const config = { home: TEAMS[0], away: TEAMS[1], seed: 4242, difficulty: 1, humanControlsHome: false };
const brainsOf = (world: World) => (world as unknown as { brains: Record<Side, TeamBrain> }).brains;

function returnScene(age: number, speed = 0) {
  const world = new World(config), p = world.home.players[0];
  world.phase = 'dead'; world.phaseTimer = age;
  p.pos = { x: 0, y: -5, z: 0 }; p.home = { x: 3, y: -5, z: 0 };
  p.vel = { x: speed, y: 0, z: 0 }; p.height = 0; p.vertVel = 0; p.cheerTime = 0;
  p.setAnim('ready');
  world.home.players.filter(m => m !== p).forEach((m, i) => { m.pos = { x: 10 + i * 2, y: -8, z: 0 }; });
  const brain = brainsOf(world).home;
  brain.think(FIXED_DT);
  return { world, p, brain };
}

function trace(seed: number, allowLateStarts: boolean) {
  const world = new World({ ...config, seed });
  let lateStarts = 0;
  for (const brain of Object.values(brainsOf(world))) {
    const commandFor = brain.commandFor.bind(brain);
    brain.commandFor = p => {
      const age = world.phaseTimer;
      const stoppedAtEnd = world.phase === 'dead' && age >= lastDeparture
        && p.height === 0 && p.vertVel === 0 && p.vel.x === 0 && p.vel.y === 0;
      // The control run evaluates only the AI's reset command before the
      // departure cutoff. Restore the actual clock before World advances:
      // no old implementation, pose override or altered phase duration.
      if (allowLateStarts && stoppedAtEnd) world.phaseTimer = lastDeparture - FIXED_DT;
      try {
        const cmd = commandFor(p);
        if (stoppedAtEnd && Math.hypot(cmd.moveX, cmd.moveY) > .05) lateStarts++;
        return cmd;
      } finally { world.phaseTimer = age; }
    };
  }
  const live: unknown[] = [], events: unknown[] = [], breaks: number[] = [];
  let pointAt = -1;
  for (let tick = 0; tick < 6000; tick++) {
    world.step(null);
    for (const event of world.drainEvents()) {
      events.push({ tick, event });
      if (event.type === 'point') pointAt = tick;
      if (event.type === 'whistle' && pointAt >= 0) { breaks.push(tick - pointAt); pointAt = -1; }
    }
    if (tick % 12 === 0 && (world.phase === 'serve' || world.phase === 'rally')) {
      live.push({ tick, phase: world.phase, phaseTimer: world.phaseTimer, rallyTime: world.rallyTime,
        ball: { pos: { ...world.ball.pos }, vel: { ...world.ball.vel }, spin: { ...world.ball.spin } },
        score: [world.home.points, world.away.points],
        players: world.allPlayers().map(p => ({ id: p.id, pos: { ...p.pos }, vel: { ...p.vel }, height: p.height, slot: p.rotationSlot })) });
    }
  }
  return { lateStarts, live, events, breaks };
}

describe('settled players wait for the imminent service placement', () => {
  it.each([lastDeparture, POINT_BREAK_SECONDS - FIXED_DT, POINT_BREAK_SECONDS])('keeps a stopped AI command quiet at dead age %s', age => {
    const { p, brain } = returnScene(age), before = { pos: { ...p.pos }, vel: { ...p.vel } };
    const cmd = brain.commandFor(p);
    expect(cmd.moveX).toBe(0); expect(cmd.moveY).toBe(0);
    expect({ pos: p.pos, vel: p.vel }).toEqual(before);
  });

  it('still starts an ordinary return before the final settling interval', () => {
    const { p, brain } = returnScene(lastDeparture - FIXED_DT);
    const cmd = brain.commandFor(p);
    expect(cmd.moveX).toBeGreaterThan(0); expect(cmd.moveY).toBe(0);
    p.step(FIXED_DT, cmd.moveX, cmd.moveY); expect(p.pos.x).toBeGreaterThan(0);
  });

  it.each([.001, .7, 1.9])('preserves an already moving AI command exactly at speed %s', speed => {
    const earlier = returnScene(lastDeparture - FIXED_DT, speed), later = returnScene(POINT_BREAK_SECONDS - FIXED_DT, speed);
    const expected = earlier.brain.commandFor(earlier.p), actual = later.brain.commandFor(later.p);
    expect(actual).toEqual(expected); expect(actual.moveX).toBeGreaterThan(0);
    later.p.step(FIXED_DT, actual.moveX, actual.moveY); expect(later.p.pos.x).toBeGreaterThan(0);
  });

  it.each(['home', 'away'] as const)('preserves late human movement, charge and jump input on %s', side => {
    const makeWorld = () => {
      const world = new World({ ...config, humanControlsHome: true, humanControlsAway: true });
      world.phase = 'dead'; world.phaseTimer = POINT_BREAK_SECONDS - .1;
      return world;
    };
    const world = makeWorld(), p = world.team(side).active;
    const move = { ...idleCommand(), moveX: 1, actionHeld: true };
    world.step(side === 'home' ? move : null, FIXED_DT, side === 'away' ? move : null);
    expect(p.locomotionIntent).toEqual({ x: 1, y: 0 }); expect(p.vel.x).toBeGreaterThan(0); expect(p.charge).toBeGreaterThan(0);
    const jumping = makeWorld(), jumper = jumping.team(side).active, jump = { ...idleCommand(), jumpPressed: true };
    jumping.step(side === 'home' ? jump : null, FIXED_DT, side === 'away' ? jump : null);
    expect(jumper.airborne).toBe(true);
  });

  it('removes the natural player-2 false departure before service without hiding the pose', () => {
    const world = new World(config), clock = new SpriteTimeline();
    let point = false, served = false, samples = 0;
    let stopped: { x: number; y: number } | undefined;
    const poses = new Set<string>();
    for (let tick = 0; tick < 4000 && !served; tick++) {
      world.step(null);
      for (const event of world.drainEvents()) {
        if (event.type === 'contact') clock.cue(event.playerId,event.kind,event.airborne,event.facing,event.backSet);
        if (event.type === 'point') point = true;
        if (event.type === 'whistle' && point) served = true;
      }
      const p = world.findPlayer(2)!, requested = clock.actionFor(p), speed = Math.hypot(p.vel.x,p.vel.y);
      const physical = JSON.stringify(p), pose = clock.frameFor(p,FIXED_DT * locomotionPlaybackScale(requested,speed),undefined,undefined,FIXED_DT);
      expect(JSON.stringify(p)).toBe(physical);
      if (!point || world.phase !== 'dead' || world.phaseTimer < lastDeparture) continue;
      stopped ??= { ...p.pos }; samples++; poses.add(`${pose.action}/${pose.frame}`);
      expect(p.locomotionIntent).toEqual({ x: 0, y: 0 }); expect(speed).toBe(0);
      expect(p.pos.x).toBe(stopped.x); expect(p.pos.y).toBe(stopped.y);
    }
    expect(served).toBe(true); expect(samples).toBeGreaterThan(15); expect([...poses]).toEqual(['idle/0']);
  });

  it.each([7, 1337, 4242])('keeps live trajectories, contacts, rotations and point-break timing identical for seed %s', seed => {
    const control = trace(seed, true), guarded = trace(seed, false);
    expect(guarded.lateStarts).toBe(0);
    if (seed === 4242) expect(control.lateStarts).toBeGreaterThan(0);
    expect(guarded.live).toEqual(control.live); expect(guarded.events).toEqual(control.events);
    expect(guarded.breaks).toEqual(control.breaks); expect(guarded.breaks.length).toBeGreaterThan(0);
    for (const ticks of guarded.breaks) {
      expect((ticks - 1) * FIXED_DT).toBeLessThanOrEqual(POINT_BREAK_SECONDS);
      expect(ticks * FIXED_DT).toBeGreaterThan(POINT_BREAK_SECONDS);
    }
  });
});
