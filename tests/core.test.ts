import { describe, expect, it } from 'vitest';

import { Ball, predictLanding, solveArc, solveArcOverNet } from '../src/core/ball';
import { v3 } from '../src/core/math3';
import { Rng } from '../src/core/rng';
import {
  BALL_RADIUS,
  COURT_HALF_LENGTH,
  FIXED_DT,
  NET_HEIGHT,
  isSetWon,
  setTarget,
} from '../src/core/rules';
import { Team } from '../src/core/team';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

const makeWorld = (seed = 42) =>
  new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('stays inside the requested range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
  });
});

describe('scoring rules', () => {
  it('plays the deciding set to 15 and the others to 25', () => {
    expect(setTarget(1)).toBe(25);
    expect(setTarget(4)).toBe(25);
    expect(setTarget(5)).toBe(15);
  });

  it('requires a two point lead', () => {
    expect(isSetWon(25, 24, 1)).toBe(false);
    expect(isSetWon(25, 23, 1)).toBe(true);
    expect(isSetWon(26, 24, 1)).toBe(true);
    expect(isSetWon(24, 10, 1)).toBe(false);
    expect(isSetWon(15, 13, 5)).toBe(true);
    expect(isSetWon(15, 14, 5)).toBe(false);
  });
});

describe('rotation', () => {
  it('cycles all six slots and returns to the start', () => {
    const team = new Team('home', TEAMS[0], new Rng(1), 0);
    const initial = team.players.map((p) => p.rotationSlot);
    for (let i = 0; i < 6; i++) team.rotate();
    expect(team.players.map((p) => p.rotationSlot)).toEqual(initial);
  });

  it('keeps exactly three players in the front row at every rotation', () => {
    const team = new Team('home', TEAMS[0], new Rng(1), 0);
    for (let i = 0; i < 12; i++) {
      expect(team.frontRow()).toHaveLength(3);
      expect(team.backRow()).toHaveLength(3);
      team.rotate();
    }
  });

  it('gives every player a distinct slot', () => {
    const team = new Team('away', TEAMS[1], new Rng(9), 100);
    for (let i = 0; i < 6; i++) {
      const slots = team.players.map((p) => p.rotationSlot).sort();
      expect(slots).toEqual([1, 2, 3, 4, 5, 6]);
      team.rotate();
    }
  });
});

describe('ball physics', () => {
  it('lands where predictLanding says it will', () => {
    const ball = new Ball();
    // A lob that stays on its own side of the net: with real gravity the old
    // test trajectory (vy = 6) genuinely clips the tape now, and the predictor
    // correctly reports such a ball as never arriving.
    ball.reset(v3(1, -6, 2), v3(0.5, 3, 5));
    const pred = predictLanding(ball);
    expect(pred.valid).toBe(true);

    for (let i = 0; i < 1200 && !ball.grounded; i++) ball.step(FIXED_DT);
    expect(ball.grounded).toBe(true);
    expect(ball.pos.x).toBeCloseTo(pred.point.x, 1);
    expect(ball.pos.y).toBeCloseTo(pred.point.y, 1);
  });

  it('never traps the ball inside the net band', () => {
    const ball = new Ball();
    // Fired straight at the middle of the net, the worst case for the band.
    ball.reset(v3(0, -2, 2.0), v3(0, 12, 0.2));
    for (let i = 0; i < 1200 && !ball.grounded; i++) ball.step(FIXED_DT);
    expect(ball.grounded).toBe(true);
    // It must have been sent back to the side it came from, not stuck at y ~ 0.
    expect(ball.pos.y).toBeLessThan(0);
  });

  it('does not gain energy bouncing off the net', () => {
    const ball = new Ball();
    ball.reset(v3(0, -1, 2.3), v3(0, 8, 0));
    const before = 0.5 * (8 * 8) + 9.81 * 1.35 * 2.3;
    for (let i = 0; i < 240; i++) ball.step(FIXED_DT);
    const speed2 = ball.vel.x ** 2 + ball.vel.y ** 2 + ball.vel.z ** 2;
    const after = 0.5 * speed2 + 9.81 * 1.35 * ball.pos.z;
    expect(after).toBeLessThan(before);
  });

  it('comes to rest on the floor rather than bouncing forever', () => {
    const ball = new Ball();
    ball.reset(v3(0, -4, 3), v3(0, 0, 0));
    for (let i = 0; i < 2400; i++) ball.step(FIXED_DT);
    expect(ball.pos.z).toBeCloseTo(BALL_RADIUS, 2);
    expect(Math.abs(ball.vel.z)).toBeLessThan(0.5);
  });
});

describe('arc solvers', () => {
  it('solveArc reaches the requested point at the requested time', () => {
    const from = v3(0, -7, 1.2);
    const to = v3(1.5, 6, 0.105);
    const vel = solveArc(from, to, 1.4);
    const ball = new Ball();
    ball.reset(from, vel);
    const steps = Math.round(1.4 / FIXED_DT);
    for (let i = 0; i < steps; i++) ball.step(FIXED_DT);
    // The solver inverts the same drag model the ball integrates, so this
    // should be accurate to a few centimetres, not "roughly there".
    expect(ball.pos.x).toBeCloseTo(to.x, 1);
    expect(ball.pos.y).toBeCloseTo(to.y, 1);
    expect(ball.pos.z).toBeCloseTo(to.z, 1);
  });

  it('solveArcOverNet clears the tape even from a low contact point', () => {
    const from = v3(0, -8.5, 0.9);
    const to = v3(0, 7.5, BALL_RADIUS);
    const vel = solveArcOverNet(from, to, 0.4, 0.9, 2.4);
    const ball = new Ball();
    ball.reset(from, vel);

    let clearedAt = -1;
    for (let i = 0; i < 600 && ball.pos.y < 0; i++) {
      ball.step(FIXED_DT);
      if (ball.pos.y >= 0 && clearedAt < 0) clearedAt = ball.pos.z;
    }
    expect(clearedAt).toBeGreaterThan(NET_HEIGHT);
  });

  it('solveArcOverNet leaves same-side arcs alone', () => {
    const from = v3(0, -7, 1);
    const to = v3(2, -2, 3.4);
    const direct = solveArc(from, to, 1.1);
    const guarded = solveArcOverNet(from, to, 0.3, 1.1, 2.2);
    expect(guarded.x).toBeCloseTo(direct.x, 6);
    expect(guarded.z).toBeCloseTo(direct.z, 6);
  });
});

describe('match simulation', () => {
  it('completes a full match within a sane number of steps', () => {
    const world = makeWorld(3);
    let steps = 0;
    const limit = 120 * 60 * 55; // 55 simulated minutes
    while (world.phase !== 'matchOver' && steps < limit) {
      world.step(null);
      steps++;
    }
    expect(world.phase).toBe('matchOver');
    expect(Math.max(world.home.setsWon, world.away.setsWon)).toBe(3);
  });

  it('is fully deterministic for a given seed', () => {
    const run = () => {
      const w = makeWorld(99);
      for (let i = 0; i < 120 * 90; i++) w.step(null);
      return `${w.home.points}-${w.away.points}/${w.setNumber}/${w.ball.pos.x.toFixed(6)}`;
    };
    expect(run()).toEqual(run());
  });

  it('never lets the same player touch the ball twice in a row', () => {
    const world = makeWorld(5);
    let previous = -1;
    let violations = 0;
    let blockJustHappened = false;

    for (let i = 0; i < 120 * 240; i++) {
      world.step(null);
      for (const ev of world.drainEvents()) {
        if (ev.type !== 'contact') continue;
        // A new rally's serve is legal whoever ended the previous rally, so
        // it is never itself a violation — but the server still may not be
        // the next toucher, which keeping them as `previous` verifies.
        if (ev.kind === 'serve') {
          previous = ev.playerId;
          blockJustHappened = false;
          continue;
        }
        if (ev.playerId === previous && !blockJustHappened) violations++;
        blockJustHappened = ev.kind === 'block';
        previous = ev.playerId;
      }
    }
    expect(violations).toBe(0);
  });

  it('never awards more than three touches to one side in a possession', () => {
    const world = makeWorld(17);
    let maxTouches = 0;
    for (let i = 0; i < 120 * 240; i++) {
      world.step(null);
      maxTouches = Math.max(maxTouches, world.touches);
    }
    expect(maxTouches).toBeLessThanOrEqual(3);
  });

  it('keeps every player inside the arena and on their own side', () => {
    const world = makeWorld(23);
    for (let i = 0; i < 120 * 120; i++) {
      world.step(null);
      for (const p of world.allPlayers()) {
        expect(Number.isFinite(p.pos.x)).toBe(true);
        expect(Number.isFinite(p.pos.y)).toBe(true);
        if (p.side === 'home') expect(p.pos.y).toBeLessThan(0);
        else expect(p.pos.y).toBeGreaterThan(0);
        expect(Math.abs(p.pos.y)).toBeLessThanOrEqual(COURT_HALF_LENGTH + 3);
      }
    }
  });

  it('produces rallies with real exchanges, not instant points', () => {
    const world = makeWorld(31);
    const rallies: number[] = [];
    let contacts = 0;
    for (let i = 0; i < 120 * 600 && rallies.length < 40; i++) {
      world.step(null);
      for (const ev of world.drainEvents()) {
        if (ev.type === 'contact') contacts++;
        if (ev.type === 'point') {
          rallies.push(contacts);
          contacts = 0;
        }
      }
    }
    const avg = rallies.reduce((a, b) => a + b, 0) / rallies.length;
    // A serve plus a three-touch reply is four contacts; anything less means
    // the ball is dying before anyone gets to play it.
    expect(avg).toBeGreaterThan(4);
  });

  it('covers its own passes and sets instead of letting them hit the floor', () => {
    const world = makeWorld(21);
    let lastKind = 'none';
    let dropped = 0;
    let points = 0;

    for (let i = 0; i < 120 * 60 * 25; i++) {
      world.step(null);
      for (const ev of world.drainEvents()) {
        if (ev.type === 'contact') lastKind = ev.kind;
        if (ev.type === 'point') {
          points++;
          // 'net' is the own-error reason: the ball landed on the floor of the
          // side that touched it last. After a pass or a set that means nobody
          // came for the next ball — a rally thrown away by the team's own
          // organisation, not by the opponent.
          if (ev.reason === 'net' && (lastKind === 'bump' || lastKind === 'set')) dropped++;
        }
      }
      if (world.phase === 'matchOver') break;
    }

    expect(points).toBeGreaterThan(40);
    // Jobs used to go to a fixed setter and a fixed attacker, so a setter who
    // had just passed — or a hitter stranded across the court — left the ball
    // unclaimed: roughly a quarter of all rallies ended that way.
    expect(dropped / points).toBeLessThan(0.06);
  });
});