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
import { World, idleCommand, type Command } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { runServeSweep, summarizeServeSweep } from '../tools/serve-lab';

const makeWorld = (seed = 42) =>
  new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });

const aggressiveHumanCommand = (world: World, step: number): Command => {
  const cmd = idleCommand();
  cmd.aim = { x: 0, depth: 0.4 };
  if (world.phase === 'serve') {
    // A playable human serve is an edge, not a level held forever: tap to toss,
    // then tap again on the timing cue. Holding the button down for simulated
    // minutes used to rely on the eight-second auto-whistle, which is exactly
    // the behaviour the game must not have.
    if (world.serveTossInFlight) {
      cmd.actionPressed = world.serveStrikeReady;
      cmd.actionHeld = world.serveStrikeReady;
    } else {
      cmd.actionPressed = step % 30 === 0;
      cmd.actionHeld = step % 30 === 0;
    }
    return cmd;
  }
  cmd.actionPressed = true;
  cmd.actionHeld = true;
  return cmd;
};

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
  it('moves every rotation holder through the regulation clockwise order', () => {
    const team = new Team('home', TEAMS[0], new Rng(1), 0);
    const holders = team.squad.filter((p) => p.role !== 'libero');
    const before = new Map(holders.map((p) => [p.id, p.rotationSlot]));
    team.rotate();
    for (const p of holders) {
      const old = before.get(p.id) as number;
      const expected = old === 1 ? 6 : old - 1;
      expect(p.rotationSlot).toBe(expected);
    }
    expect(team.server.id).toBe(holders.find((p) => before.get(p.id) === 2)?.id);
  });

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

  it('reports libero substitutions across a full rotation cycle', () => {
    const team = new Team('home', TEAMS[0], new Rng(1), 0);
    const changes = [];
    for (let i = 0; i < 6; i++) {
      const report = team.rotate();
      if (report.liberoChange) changes.push(report.liberoChange);
    }
    expect(changes.some((c) => c.entered)).toBe(true);
    expect(changes.some((c) => !c.entered)).toBe(true);
    for (const c of changes) {
      expect(c.name).toBeTruthy();
      expect(c.slot).toBeGreaterThanOrEqual(1);
      expect(c.slot).toBeLessThanOrEqual(6);
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

  it('announces and visibly delays a side-out rotation instead of teleporting it', () => {
    const world = makeWorld(31);
    const away = world.away;
    const before = new Map(away.squad.map((p) => [p.id, p.rotationSlot]));
    const score = world as unknown as {
      awardPoint(side: 'home' | 'away', reason: 'out'): void;
    };
    score.awardPoint('away', 'out');
    expect(world.rotatingSide).toBe('away');
    for (const p of away.squad) expect(p.rotationSlot).toBe(before.get(p.id));

    for (let i = 0; i < 120 * 1.7; i++) world.step(null);
    const events = world.drainEvents();
    expect(events.some((ev) => ev.type === 'rotation' && ev.side === 'away')).toBe(true);
    for (const p of away.squad.filter((p) => p.role !== 'libero')) {
      const old = before.get(p.id) as number;
      expect(p.rotationSlot).toBe(old === 1 ? 6 : old - 1);
    }
  });

  it('emits a libero-change event when delayed rotation changes the substitution', () => {
    const world = makeWorld(31);
    const away = world.away;
    const first = away.rotate();
    expect(first.liberoChange).toBeUndefined();

    const internals = world as unknown as {
      pendingRotationSide: 'away';
      rotationApplied: boolean;
    };
    world.phase = 'dead';
    world.phaseTimer = 1.7;
    internals.pendingRotationSide = 'away';
    internals.rotationApplied = false;

    world.step(null);
    const change = world
      .drainEvents()
      .find((ev) => ev.type === 'liberoChange' && ev.side === 'away');
    expect(change).toMatchObject({
      type: 'liberoChange',
      side: 'away',
      name: expect.any(String),
      entered: false,
      slot: expect.any(Number),
    });
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
  it('keeps a human server in ready stance until the player presses serve', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 78,
      difficulty: 1,
      humanControlsHome: true,
    });
    const server = world.home.server;

    for (let i = 0; i < 180; i++) {
      world.step(idleCommand());
      world.drainEvents();
    }

    expect(world.phase).toBe('serve');
    expect(world.serveTossInFlight).toBe(false);
    expect(world.ball.frozen).toBe(true);
    expect(server.anim).toBe('ready');
    expect(server.presentation.action).toBe('none');
  });

  it('does not auto-serve for the human after the old eight-second whistle timeout', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 79,
      difficulty: 1,
      humanControlsHome: true,
    });
    const server = world.home.server;
    const contacts: string[] = [];

    for (let i = 0; i < 120 * 10; i++) {
      world.step(idleCommand());
      for (const ev of world.drainEvents()) {
        if (ev.type === 'contact') contacts.push(ev.kind);
      }
    }

    expect(world.phase).toBe('serve');
    expect(world.serveTossInFlight).toBe(false);
    expect(world.ball.frozen).toBe(true);
    expect(server.anim).toBe('ready');
    expect(server.presentation.action).toBe('none');
    expect(contacts).not.toContain('serve');
  });

  it('turns a loaded human serve into a visible run-up and airborne contact', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 77,
      difficulty: 1,
      humanControlsHome: true,
    });
    const server = world.home.server;
    const readyY = server.pos.y;
    let holdMinY = server.pos.y;
    let holdMaxY = server.pos.y;
    let runMinY = server.pos.y;
    let runMaxY = server.pos.y;
    let contact: { airborne: boolean; height: number } | null = null;

    // Load long enough to choose the jump serve. The server must stay still
    // while the ball is still in hand; the run-up starts only after release.
    for (let i = 0; i < 66; i++) {
      const cmd = idleCommand();
      cmd.actionHeld = true;
      cmd.actionPressed = i === 0;
      world.step(cmd);
      holdMinY = Math.min(holdMinY, server.pos.y);
      holdMaxY = Math.max(holdMaxY, server.pos.y);
      world.drainEvents();
    }
    world.step(idleCommand()); // release: toss and reverse into the approach

    for (let i = 0; i < 240 && !contact; i++) {
      const cmd = idleCommand();
      if (world.serveStrikeReady) cmd.actionPressed = true;
      world.step(cmd);
      runMinY = Math.min(runMinY, server.pos.y);
      runMaxY = Math.max(runMaxY, server.pos.y);
      for (const ev of world.drainEvents()) {
        if (ev.type === 'contact' && ev.kind === 'serve' && ev.playerId === server.id) {
          contact = { airborne: ev.airborne, height: ev.height };
        }
      }
    }

    expect(holdMinY).toBeCloseTo(readyY, 2);
    expect(holdMaxY).toBeCloseTo(readyY, 2);
    expect(runMaxY - runMinY).toBeGreaterThanOrEqual(1.0);
    expect(server.lastApproachDistance).toBeGreaterThanOrEqual(1.2);
    expect(contact).toMatchObject({ airborne: true });
    expect(contact?.height ?? 0).toBeGreaterThan(0.5);
  });

  it('varies jump-serve trajectories instead of landing every serve in one corridor', () => {
    const results = runServeSweep(32);
    const summary = summarizeServeSweep(results);

    expect(summary.served).toBeGreaterThanOrEqual(24);
    expect(summary.jumped).toBeGreaterThanOrEqual(10);
    expect(summary.inLandings).toBeGreaterThanOrEqual(20);
    // The user-visible failure is a canned serve: same lane, same depth, same
    // pace. Gate all three dimensions so variety cannot be faked by only
    // changing speed while the ball keeps landing in one place.
    expect(summary.landingSpreadX).toBeGreaterThanOrEqual(0.75);
    expect(summary.landingSpreadY).toBeGreaterThanOrEqual(0.9);
    expect(summary.speedSpread).toBeGreaterThanOrEqual(2.0);
    expect(summary.jumpServeMeanSpeed).toBeGreaterThan(summary.standingServeMeanSpeed + 2.5);
  });

  it('completes a full match within a sane number of steps', () => {
    const world = makeWorld(3);
    let steps = 0;
    // Rallies got considerably longer once every ball was covered, and a real
    // five-set match runs an hour and a half, so the budget is generous: this
    // guards against a match that can never end, not against a long one.
    const limit = 120 * 60 * 100; // 100 simulated minutes
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
    // A guard against the old failure, where roughly a quarter of all rallies
    // ended with nobody coming for the ball — not a precision target.
    expect(dropped / points).toBeLessThan(0.1);
  });

  it('puts a block up against attacks, and keeps everyone out of the net', () => {
    const world = makeWorld(21);
    let attacks = 0;
    let unopposed = 0;
    let doubled = 0;
    let inTheNet = 0;
    let samples = 0;

    for (let i = 0; i < 120 * 60 * 6; i++) {
      world.step(null);
      for (const ev of world.drainEvents()) {
        if (ev.type !== 'contact') continue;
        if (ev.kind !== 'spike' && ev.kind !== 'power') continue;
        attacks++;
        const defenders = world.team(ev.side === 'home' ? 'away' : 'home').players;
        const up = defenders.filter((p) => p.airborne && Math.abs(p.pos.y) < 1.6).length;
        if (up === 0) unopposed++;
        if (up >= 2) doubled++;
      }
      if (i % 12 !== 0) continue;
      samples++;
      // Nobody stands in the net. Airborne blockers may press right up to it.
      for (const p of world.allPlayers()) {
        if (!p.airborne && Math.abs(p.pos.y) < 0.5) inTheNet++;
      }
    }

    expect(attacks).toBeGreaterThan(20);
    // The block used to be triggered by an opponent who was ALREADY in the
    // air, which is a jump too late for anyone to arrive. Measured on this
    // exact loop before the fix: 94-100% of attacks across four seeds met
    // nobody in the air at all, and a two-man block never once happened.
    expect(unopposed / attacks).toBeLessThan(0.7);
    expect(doubled / attacks).toBeGreaterThan(0.03);
    expect(inTheNet / (samples * 12)).toBeLessThan(0.02);
  });

  it('lets the human call a coordinated two-player block at the net', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 21,
      difficulty: 1,
      humanControlsHome: true,
    });
    world.phase = 'rally';
    world.possession = 'away';
    world.ball.frozen = false;
    world.ball.grounded = false;
    world.ball.pos = v3(0.25, 1.5, NET_HEIGHT + 0.9);
    world.ball.vel = v3(0, -1, -0.2);

    const blockers = world.home.frontRow();
    const caller = blockers[1];
    const mate = blockers[0];
    world.home.activeId = caller.id;
    caller.pos = v3(0.05, -0.72, 0);
    mate.pos = v3(0.95, -0.82, 0);
    // Closer in X, but not at the tape: this body must not suppress the valid
    // two-man block with the mate already beside the caller.
    blockers[2].pos = v3(0.18, -4.2, 0);
    for (const p of blockers) {
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
    }

    world.step({
      ...idleCommand(),
      actionPressed: true,
      actionHeld: true,
    });
    world.step(idleCommand());

    const attempts = world
      .drainEvents()
      .filter((ev): ev is { type: 'blockAttempt'; side: 'home'; playerId: number; height: number } => {
        return ev.type === 'blockAttempt' && ev.side === 'home';
      })
      .map((ev) => ev.playerId);

    expect(new Set(attempts)).toEqual(new Set([caller.id, mate.id]));
    expect(caller.airborne).toBe(true);
    expect(mate.airborne).toBe(true);
    expect(caller.presentation.action).toBe('block');
    expect(mate.presentation.action).toBe('block');
  });

  it('treats the jump button as a manual block call at the tape', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 22,
      difficulty: 1,
      humanControlsHome: true,
    });
    world.phase = 'rally';
    world.possession = 'away';
    world.ball.frozen = false;
    world.ball.grounded = false;
    world.ball.pos = v3(0.35, 1.4, NET_HEIGHT + 0.7);
    world.ball.vel = v3(0, -1, -0.2);

    const blockers = world.home.frontRow();
    const caller = blockers[1];
    const mate = blockers[0];
    world.home.activeId = caller.id;
    // Deliberately inside the action-button block window but outside the old
    // jump-button-only 2.2 m gate.
    caller.pos = v3(0.05, -2.32, 0);
    mate.pos = v3(0.88, -2.28, 0);
    for (const p of blockers) {
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
    }

    world.step({
      ...idleCommand(),
      jumpPressed: true,
    });
    world.step(idleCommand());

    const attempts = world
      .drainEvents()
      .filter((ev): ev is { type: 'blockAttempt'; side: 'home'; playerId: number; height: number } => {
        return ev.type === 'blockAttempt' && ev.side === 'home';
      })
      .map((ev) => ev.playerId);

    expect(new Set(attempts)).toEqual(new Set([caller.id, mate.id]));
    expect(caller.presentation.action).toBe('block');
    expect(mate.presentation.action).toBe('block');
  });

  it('switches human control to the net blocker before a manual block jump', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 24,
      difficulty: 1,
      humanControlsHome: true,
    });
    world.phase = 'rally';
    world.possession = 'away';
    world.ball.frozen = false;
    world.ball.grounded = false;
    world.ball.pos = v3(0.12, 1.35, NET_HEIGHT + 0.95);
    world.ball.vel = v3(0, -0.7, -0.2);

    const blockers = world.home.frontRow();
    const caller = blockers[1];
    const mate = blockers[0];
    const backRow = world.home.players.find((p) => !world.home.isFrontRow(p));
    expect(backRow).toBeDefined();
    world.home.activeId = backRow!.id;

    caller.pos = v3(0.04, -0.72, 0);
    mate.pos = v3(0.82, -0.78, 0);
    blockers[2].pos = v3(3.4, -0.75, 0);
    for (const p of world.home.players) {
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
    }

    // The first frame selects the correct human-controlled blocker for the
    // visible threat. The player can then press jump on the next frame and the
    // input goes to the body standing at the tape, not a back-row defender.
    world.step(idleCommand());
    expect(world.home.activeId).toBe(caller.id);

    world.step({
      ...idleCommand(),
      jumpPressed: true,
    });
    world.step(idleCommand());

    const attempts = world
      .drainEvents()
      .filter((ev): ev is { type: 'blockAttempt'; side: 'home'; playerId: number; height: number } => {
        return ev.type === 'blockAttempt' && ev.side === 'home';
      })
      .map((ev) => ev.playerId);

    expect(new Set(attempts)).toEqual(new Set([caller.id, mate.id]));
    expect(caller.presentation.action).toBe('block');
    expect(mate.presentation.action).toBe('block');
  });

  it('times an AI double block from a stable read instead of jumping on the first cue frame', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 23,
      difficulty: 1,
      humanControlsHome: false,
    });
    world.phase = 'rally';
    world.possession = 'away';
    world.touches = 2; // A real set, not the opponent's first pass or serve.
    world.ball.frozen = false;
    world.ball.grounded = false;
    world.ball.pos = v3(0.05, 1.15, NET_HEIGHT + 1.1);
    world.ball.vel = v3(0, -0.6, -0.35);

    const blockers = world.home.frontRow();
    const left = blockers[0];
    const middle = blockers[1];
    const far = blockers[2];
    left.pos = v3(-0.72, -0.7, 0);
    middle.pos = v3(0.08, -0.7, 0);
    far.pos = v3(3.65, -0.7, 0);
    for (const p of blockers) {
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
      p.vel = v3();
    }

    // First frame reads the cue and arms the decision; it must not look like a
    // random instant jump the moment the ball happens to be high.
    world.step(null);
    expect(world.drainEvents().filter((ev) => ev.type === 'blockAttempt')).toHaveLength(0);
    expect(blockers.some((p) => p.airborne)).toBe(false);

    const attemptsByFrame: number[][] = [];
    const firstAttemptFrame = new Map<number, number>();
    for (let i = 0; i < 10; i++) {
      world.step(null);
      const ids = world
        .drainEvents()
        .filter((ev): ev is { type: 'blockAttempt'; side: 'home'; playerId: number; height: number } => {
          return ev.type === 'blockAttempt' && ev.side === 'home';
        })
        .map((ev) => ev.playerId);
      for (const id of ids) {
        if (!firstAttemptFrame.has(id)) firstAttemptFrame.set(id, i);
      }
      if (ids.length) attemptsByFrame.push(ids);
    }

    const attempts = new Set(attemptsByFrame.flat());
    expect(attempts).toEqual(new Set([middle.id, left.id]));
    expect(attempts.has(far.id)).toBe(false);
    expect(Math.abs(firstAttemptFrame.get(middle.id)! - firstAttemptFrame.get(left.id)!)).toBeLessThanOrEqual(4);
    expect(middle.presentation.action).toBe('block');
    expect(left.presentation.action).toBe('block');
    expect(Math.abs(middle.pos.x - left.pos.x)).toBeGreaterThan(0.45);
  });

  it('never leaves the floor to pass, and never blocks a serve', () => {
    // A human mashing the button, which is exactly how the rules got broken:
    // the press-to-jump shortcut fired on any high ball, so trying to pass a
    // serve launched the passer into a mid-air set.
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 21,
      difficulty: 1,
      humanControlsHome: true,
    });
    let bumps = 0;
    let airborneBumps = 0;
    let serveBlocks = 0;
    const airborne = new Map<number, boolean>();

    // Six simulated minutes keeps the sample above the evidence floor even
    // when a more effective block ends a handful of rallies before the dig.
    for (let i = 0; i < 120 * 60 * 6; i++) {
      const duringServe = world.serveInFlight;
      world.step(aggressiveHumanCommand(world, i));
      // Read the bodies AFTER the step: contacts are resolved at the end of it,
      // so a player sampled beforehand may well have landed in between — which
      // is how this test first accused the game of three fouls it never made.
      airborne.clear();
      for (const p of world.allPlayers()) airborne.set(p.id, p.airborne && !p.diving);
      for (const ev of world.drainEvents()) {
        if (ev.type !== 'contact') continue;
        if (ev.kind === 'bump') {
          bumps++;
          if (airborne.get(ev.playerId)) airborneBumps++;
        }
        if (ev.kind === 'block' && duringServe) serveBlocks++;
      }
    }

    expect(bumps).toBeGreaterThan(25);
    // A pass or a dig needs a platform and a base under it.
    expect(airborneBumps).toBe(0);
    // Blocking a serve is a fault, so it must not be possible to make one.
    expect(serveBlocks).toBe(0);
  });

  it('never plays the ball across the net, and never gets a fourth touch', () => {
    const world = new World({
      home: TEAMS[0],
      away: TEAMS[1],
      seed: 21,
      difficulty: 1,
      humanControlsHome: true,
    });
    let reachOvers = 0;
    let longestRun = 0;
    let run = 0;
    let runSide = '';
    let contacts = 0;

    // The longer, readable side-out/rotation pause reduces contacts per wall
    // clock minute, so sample seven simulated minutes without lowering the
    // evidence floor for reach-over and fourth-touch rules.
    for (let i = 0; i < 120 * 60 * 7; i++) {
      world.step(aggressiveHumanCommand(world, i));
      for (const ev of world.drainEvents()) {
        if (ev.type === 'point') {
          run = 0;
          runSide = '';
          continue;
        }
        if (ev.type !== 'contact') continue;
        contacts++;
        // A block is the one contact allowed to meet the ball over the tape,
        // and it is a free touch, so it breaks the run rather than joining it.
        if (ev.kind === 'block') {
          run = 0;
          runSide = '';
          continue;
        }
        // `at.y` positive means the ball is in the away half; a side may only
        // play it on its own side. Reaching across scooped balls out of the
        // opponent's court AND handed the team an extra touch, because the
        // ball had never changed hands.
        const dir = ev.side === 'home' ? 1 : -1;
        if (ev.at.y * dir > 0.05) reachOvers++;
        if (ev.side === runSide) run++;
        else {
          runSide = ev.side;
          run = 1;
        }
        longestRun = Math.max(longestRun, run);
      }
    }

    expect(contacts).toBeGreaterThan(150);
    expect(reachOvers).toBe(0);
    expect(longestRun).toBeLessThanOrEqual(3);
  });

  it('fields a libero who never serves and never plays the front row', () => {
    const world = makeWorld(21);
    let seen = 0;

    for (let i = 0; i < 120 * 60 * 6; i++) {
      world.step(null);
      world.drainEvents();
      if (i % 20 !== 0) continue;
      for (const side of ['home', 'away'] as const) {
        const team = world.team(side);
        const libero = team.players.find((p) => p.role === 'libero');
        if (!libero) continue;
        seen++;
        // Slots 2, 3 and 4 are the front row, and slot 1 serves.
        expect([5, 6]).toContain(libero.rotationSlot);
        expect(team.server.role).not.toBe('libero');
        // Never both liberos of a side on court, and always six players.
        expect(team.players.length).toBe(6);
      }
    }

    expect(seen).toBeGreaterThan(100);
  });

  it('keeps six players in six places instead of walking through each other', () => {
    const world = makeWorld(21);
    // Must match src/render/camera.ts: the flat side elevation compresses the
    // court's width, so two players a metre apart across it are only 30 px
    // apart on screen. A formation can be tactically right and still draw as a
    // heap, which is exactly what happened, so the check is done in screen
    // space rather than in metres.
    const PIXELS_PER_METRE = 55;
    const DEPTH_RISE = 30;
    const BODY_PX = 46;

    let pairs = 0;
    let overlapping = 0;
    let spread = 0;
    let formations = 0;

    for (let i = 0; i < 120 * 60 * 6; i++) {
      world.step(null);
      world.drainEvents();
      if (i % 12 !== 0) continue;
      if (world.phase !== 'rally' && world.phase !== 'serve') continue;

      for (const side of ['home', 'away'] as const) {
        const team = world.team(side).players;
        const rows = team.map((p) => -p.pos.x * DEPTH_RISE);
        spread += Math.max(...rows) - Math.min(...rows);
        formations++;
        for (let a = 0; a < team.length; a++) {
          for (let b = a + 1; b < team.length; b++) {
            const dx = (team[a].pos.y - team[b].pos.y) * PIXELS_PER_METRE;
            const dy = rows[a] - rows[b];
            pairs++;
            if (Math.hypot(dx, dy) < BODY_PX) overlapping++;
          }
        }
      }
    }

    expect(formations).toBeGreaterThan(500);
    // Was 6.9% before the separation term and the widened tactical lanes.
    expect(overlapping / pairs).toBeLessThan(0.03);
    // And the six of them have to be spread across the court, not stacked in
    // the middle of it: a team used to occupy 119 px of the 270 px available.
    expect(spread / formations).toBeGreaterThan(150);
  });
});
