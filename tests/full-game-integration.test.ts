import { describe, expect, it } from 'vitest';
import { contactRadius } from '../src/core/contact';
import { v3 } from '../src/core/math3';
import type { MatchFormat } from '../src/core/match-format';
import { BALL_RADIUS, FIXED_DT, PLAYER_REACH, attackDir, otherSide, type Side } from '../src/core/rules';
import { World, idleCommand, type Command, type GameEvent } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { awardMatch, createProgression, type CompletedMatchResult } from '../src/game/progression';

const makeWorld = (format: MatchFormat = { bestOf: 3, scoring: 'rally25' }) => new World({
  home: TEAMS[0], away: TEAMS[1], seed: 707, difficulty: 1,
  humanControlsHome: true, humanControlsAway: true, format,
});

function stepBoth(world: World, home = idleCommand(), away = idleCommand()): GameEvent[] {
  world.step(home, FIXED_DT, away);
  return world.drainEvents();
}

/** Enter through the live-ball adjudication path, rather than call the scoring helper. */
function finishRally(world: World, winner: Side): GameEvent[] {
  world.drainEvents();
  world.phase = 'rally';
  world.rallyTime = 4;
  world.lastToucherSide = winner;
  world.ball.reset(v3(0, attackDir(winner) * 6, BALL_RADIUS));
  world.ball.grounded = true;
  return stepBoth(world);
}

function nextServe(world: World): GameEvent[] {
  const events: GameEvent[] = [];
  for (let step = 0; step < 120 * 5 && world.phase !== 'serve'; step++) {
    events.push(...stepBoth(world));
  }
  expect(world.phase).toBe('serve');
  return events;
}

function playableBall(world: World, side: Side) {
  const team = world.team(side);
  const player = team.active;
  for (const p of world.allPlayers()) {
    p.pos = v3(3.5, -attackDir(p.side) * 7, 0);
    p.vel = v3();
  }
  player.pos = v3(0, -attackDir(side) * 4, 0);
  world.phase = 'rally';
  world.phaseTimer = 0;
  world.possession = side;
  world.touches = 0;
  world.lastToucherSide = otherSide(side);
  world.lastToucherId = world.team(otherSide(side)).server.id;
  world.ball.reset(v3(player.pos.x, player.pos.y + attackDir(side) * .2, 1.35), v3(0, 0, -1));
  world.drainEvents();
  return player;
}

describe('match options applied to actual rallies', () => {
  it('gives the receiver only the serve in side-out scoring, then rotates exactly once', () => {
    const world = makeWorld({ bestOf: 3, scoring: 'sideout15' });
    world.home.points = 8;
    world.away.points = 9;
    const rotationBefore = new Map(world.away.squad.map(p => [p.id, p.rotationSlot]));
    const receivingWin = finishRally(world, 'away');

    expect([world.home.points, world.away.points]).toEqual([8, 9]);
    expect(world.servingSide).toBe('away');
    expect(receivingWin).toContainEqual(expect.objectContaining({ type: 'point', side: 'away', scored: false }));
    expect(receivingWin).toContainEqual({ type: 'sideout', side: 'away' });
    expect(world.rotatingSide).toBe('away');
    for (const p of world.away.squad) expect(p.rotationSlot).toBe(rotationBefore.get(p.id));

    const between = nextServe(world);
    expect(between.filter(e => e.type === 'rotation' && e.side === 'away')).toHaveLength(1);
    expect(between.some(e => e.type === 'point')).toBe(false);
    for (const p of world.away.squad.filter(p => p.role !== 'libero')) {
      const before = rotationBefore.get(p.id)!;
      expect(p.rotationSlot).toBe(before === 1 ? 6 : before - 1);
    }

    const servingWin = finishRally(world, 'away');
    expect([world.home.points, world.away.points]).toEqual([8, 10]);
    expect(servingWin).toContainEqual(expect.objectContaining({ type: 'point', side: 'away', scored: true }));
    expect(servingWin.some(e => e.type === 'sideout')).toBe(false);
    expect(nextServe(world).some(e => e.type === 'rotation')).toBe(false);
  });

  it('cannot win a side-out set by receiving at set point', () => {
    const world = makeWorld({ bestOf: 3, scoring: 'sideout15' });
    world.startSet(1, 'away');
    world.home.points = 14;
    world.away.points = 13;

    expect(finishRally(world, 'home').some(e => e.type === 'setWon')).toBe(false);
    expect(world.home.points).toBe(14);
    expect(world.home.setsWon).toBe(0);
    nextServe(world);
    expect(finishRally(world, 'home')).toContainEqual({ type: 'setWon', side: 'home', setNumber: 1 });
    expect(world.home.setScores).toEqual([15]);
  });

  for (const scoring of ['rally25', 'rally15'] as const) {
    it(`counts receiving wins and requires a two-point advantage in ${scoring}`, () => {
      const world = makeWorld({ bestOf: 3, scoring });
      const target = world.pointsToWinSet;
      world.startSet(1, 'away');
      world.home.points = target - 1;
      world.away.points = target - 1;

      expect(finishRally(world, 'home').some(e => e.type === 'setWon')).toBe(false);
      expect(world.home.points).toBe(target);
      expect(world.home.setsWon).toBe(0);
      nextServe(world);
      expect(finishRally(world, 'home')).toContainEqual({ type: 'setWon', side: 'home', setNumber: 1 });
      expect(world.home.setScores).toEqual([target + 1]);
      expect(world.away.setScores).toEqual([target - 1]);
    });
  }

  for (const bestOf of [3, 5] as const) {
    it(`plays ${bestOf}-set matches through a 15-point deciding set and stops once won`, () => {
      const world = makeWorld({ bestOf, scoring: 'rally25' });
      const winners: Side[] = bestOf === 3 ? ['home', 'away', 'home'] : ['home', 'away', 'home', 'away', 'home'];
      const wonEvents: GameEvent[] = [];
      expect(world.setsNeeded).toBe(bestOf === 3 ? 2 : 3);

      for (let i = 0; i < winners.length; i++) {
        const winner = winners[i];
        const target = i === bestOf - 1 ? 15 : 25;
        expect(world.setNumber).toBe(i + 1);
        expect(world.pointsToWinSet).toBe(target);
        world.team(winner).points = target - 1;
        world.team(otherSide(winner)).points = target - 3;
        wonEvents.push(...finishRally(world, winner));
        if (i < winners.length - 1) {
          expect(world.phase).toBe('setBreak');
          nextServe(world);
          expect([world.home.points, world.away.points]).toEqual([0, 0]);
        }
      }

      expect(world.phase).toBe('matchOver');
      expect([world.home.setsWon, world.away.setsWon]).toEqual([(bestOf + 1) / 2, (bestOf - 1) / 2]);
      expect(wonEvents.filter(e => e.type === 'matchWon')).toEqual([{ type: 'matchWon', side: 'home' }]);
      expect(world.home.setScores).toHaveLength(bestOf);
      const finalScore = world.scoreLine();
      for (let step = 0; step < 240; step++) {
        expect(stepBoth(world).some(e => e.type === 'matchWon' || e.type === 'point')).toBe(false);
      }
      expect(world.scoreLine()).toBe(finalScore);
    });
  }

  it('resumes an ordinary rally within 2.1 seconds with the completed rotation', () => {
    const world = makeWorld();
    finishRally(world, 'away');
    let seconds = 0;
    const events: GameEvent[] = [];
    while (world.phase !== 'serve' && seconds < 2.1) {
      events.push(...stepBoth(world));
      seconds += FIXED_DT;
    }
    expect(world.phase).toBe('serve');
    expect(seconds).toBeLessThan(2.1);
    expect(events.filter(e => e.type === 'rotation')).toHaveLength(1);
    expect(world.away.activeId).toBe(world.away.server.id);
  });
});

describe('two human sides share one simulation without sharing input', () => {
  for (const side of ['home', 'away'] as const) {
    it(`keeps the ${side} human server idle for more than the old timeout`, () => {
      const world = makeWorld();
      world.startSet(1, side);
      const server = world.team(side).server;
      const position = { ...server.pos };
      const events: GameEvent[] = [];
      for (let step = 0; step < 120 * 10; step++) events.push(...stepBoth(world));

      expect(world.isHumanControlled(side)).toBe(true);
      expect(world.phase).toBe('serve');
      expect(world.serveTossInFlight).toBe(false);
      expect(world.ball.frozen).toBe(true);
      expect(server.plansJumpServe).toBe(false);
      expect(server.pos).toEqual(position);
      expect(events.some(e => e.type === 'contact' && e.kind === 'serve')).toBe(false);
    });

    it(`does not let AI contact a playable ball on behalf of an idle ${side} player`, () => {
      const world = makeWorld();
      const active = playableBall(world, side);
      expect(world.playCueFor(side)?.ready).toBe(true);
      const events = stepBoth(world);
      expect(events.some(e => e.type === 'contact' && e.playerId === active.id)).toBe(false);
      expect(world.lastToucherSide).toBe(otherSide(side));
      expect(active.charge).toBe(0);
      expect(active.actionBuffer).toBe(0);
    });

    it(`honours a deliberate red-cue press and reports the reward for ${side}`, () => {
      const world = makeWorld();
      const active = playableBall(world, side);
      expect(world.playCueFor(side)?.ready).toBe(true);
      expect(world.playCueFor(otherSide(side))?.ready).not.toBe(true);
      const press: Command = { ...idleCommand(), actionPressed: true };
      const events = side === 'home' ? stepBoth(world, press) : stepBoth(world, idleCommand(), press);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'contact', playerId: active.id, side, timing: 'perfect',
      }));

      const heldWorld = makeWorld();
      const heldPlayer = playableBall(heldWorld, side);
      const held = { ...idleCommand(), actionHeld: true };
      const heldEvents = side === 'home' ? stepBoth(heldWorld, held) : stepBoth(heldWorld, idleCommand(), held);
      expect(heldEvents).toContainEqual(expect.objectContaining({ type: 'contact', playerId: heldPlayer.id }));
      expect(heldEvents.some(e => e.type === 'contact' && e.timing === 'perfect')).toBe(false);
      expect(world.team(side).power).toBeGreaterThan(heldWorld.team(side).power);
    });
  }

  it('moves both selected players independently in the same fixed step', () => {
    const world = makeWorld();
    const home = world.home.active;
    const away = world.away.active;
    world.phase = 'rally';
    world.ball.frozen = true;
    stepBoth(world, { ...idleCommand(), moveX: 1 }, { ...idleCommand(), moveX: -1 });
    expect(home.vel.x).toBeGreaterThan(0);
    expect(away.vel.x).toBeLessThan(0);
  });

  it('does not offer the away red cue for a low ball across the net or a repeated touch', () => {
    const world = makeWorld();
    const active = playableBall(world, 'away');
    active.pos = v3(0, .4, 0);
    world.ball.reset(v3(0, -.2, 1.35), v3(0, 0, -1));
    expect(world.playCueFor('away')).toBeNull();

    world.ball.reset(v3(0, .5, 1.35), v3(0, 0, -1));
    world.lastToucherId = active.id;
    expect(world.playCueFor('away')).toBeNull();
  });
});

describe('skills and progression use real match outcomes', () => {
  for (const side of ['home', 'away'] as const) {
    for (const legal of [true, false]) {
      it(`${legal ? 'allows' : 'rejects'} an airborne ${side} back-row attack based on its real takeoff`, () => {
        const world = makeWorld();
        const team = world.team(side);
        const hitter = team.backRow().find(p => p.role !== 'libero')!;
        team.activeId = hitter.id;
        playableBall(world, side);
        hitter.pos.y = -attackDir(side) * (legal ? 3.5 : 2.85);
        world.possession = side;
        world.touches = 2;
        world.lastToucherSide = side;
        world.lastToucherId = team.players.find(p => p.id !== hitter.id)!.id;
        world.ball.frozen = true;
        const run = { ...idleCommand(), moveY: attackDir(side) };
        for (let step = 0; step < 10; step++) {
          if (side === 'home') stepBoth(world, run);
          else stepBoth(world, idleCommand(), run);
        }
        const takeoff = hitter.pos.y;
        expect(Math.abs(takeoff) > 3).toBe(legal);
        for (let step = 0; step < 24; step++) {
          const command = { ...run, jumpPressed: step === 0 };
          if (side === 'home') stepBoth(world, command);
          else stepBoth(world, idleCommand(), command);
        }

        expect(hitter.airborne).toBe(true);
        expect(hitter.takeoffY).toBe(takeoff);
        expect(Math.abs(hitter.pos.y)).toBeLessThan(3);
        world.ball.reset(v3(hitter.pos.x, hitter.pos.y + attackDir(side) * .2, hitter.height + PLAYER_REACH * .85));
        const press = { ...idleCommand(), actionPressed: true };
        const events = side === 'home' ? stepBoth(world, press) : stepBoth(world, idleCommand(), press);
        if (legal) {
          expect(events).toContainEqual(expect.objectContaining({
            type: 'contact', side, playerId: hitter.id, kind: 'spike', airborne: true,
          }));
        } else {
          expect(events.some(e => e.type === 'contact' && e.playerId === hitter.id)).toBe(false);
        }
      });
    }
  }

  it('a charged defense skill reaches a ball the same unskilled player cannot touch', () => {
    const normal = makeWorld();
    const enhanced = new World({
      home: { ...TEAMS[0], skillId: 'guardian' }, away: TEAMS[1], seed: 707,
      humanControlsHome: true, humanControlsAway: true,
      format: { bestOf: 3, scoring: 'rally25' },
    });
    const normalPlayer = playableBall(normal, 'home');
    const enhancedPlayer = playableBall(enhanced, 'home');
    const offset = contactRadius(normalPlayer, normal.ball) * 1.075;
    normal.ball.pos.x = normalPlayer.pos.x + offset;
    enhanced.ball.pos.x = enhancedPlayer.pos.x + offset;
    enhanced.home.skillState.charge = 45;
    const press = { ...idleCommand(), actionPressed: true };

    expect(stepBoth(normal, press).some(e => e.type === 'contact')).toBe(false);
    const events = stepBoth(enhanced, press);
    expect(events).toContainEqual(expect.objectContaining({ type: 'contact', playerId: enhancedPlayer.id, side: 'home' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'skill', skillId: 'guardian', side: 'home' }));
    expect(enhanced.home.skillState.activations).toBe(1);
    expect(enhanced.home.skillState.charge).toBeLessThan(45);
  });

  it('keeps Meteora charged when a low contact produces a tip instead of a powered spike', () => {
    const world = new World({
      home: { ...TEAMS[0], skillId: 'meteor' }, away: TEAMS[1], seed: 707,
      humanControlsHome: true, humanControlsAway: true,
    });
    const active = playableBall(world, 'home');
    world.possession = 'home';
    world.touches = 2;
    world.lastToucherSide = 'home';
    world.lastToucherId = world.home.players.find(p => p.id !== active.id)!.id;
    world.home.skillState.charge = 50;
    const events = stepBoth(world, { ...idleCommand(), actionPressed: true });

    expect(events).toContainEqual(expect.objectContaining({ type: 'contact', playerId: active.id, kind: 'tip' }));
    expect(events.some(e => e.type === 'skill')).toBe(false);
    expect(world.home.skillState.activations).toBe(0);
    expect(world.home.skillState.charge).toBeGreaterThanOrEqual(50);
  });

  it('keeps the precision skill charged when the player spends the separate power-move gauge', () => {
    const world = new World({
      home: { ...TEAMS[0], skillId: 'sniper' }, away: TEAMS[1], seed: 707,
      humanControlsHome: true, humanControlsAway: true,
    });
    world.home.activeId = world.home.frontRow()[0].id;
    const active = playableBall(world, 'home');
    world.possession = 'home';
    world.touches = 2;
    world.lastToucherSide = 'home';
    world.lastToucherId = world.home.players.find(p => p.id !== active.id)!.id;
    world.ball.frozen = true;
    for (let step = 0; step < 24; step++) stepBoth(world, { ...idleCommand(), jumpPressed: step === 0 });
    world.ball.reset(v3(active.pos.x, active.pos.y + .2, active.height + PLAYER_REACH * .85));
    world.home.power = 100;
    world.home.skillState.charge = 50;
    const events = stepBoth(world, { ...idleCommand(), actionPressed: true, jumpPressed: true });

    expect(events).toContainEqual(expect.objectContaining({ type: 'contact', playerId: active.id, kind: 'power' }));
    expect(events.some(e => e.type === 'skill')).toBe(false);
    expect(world.home.skillState.activations).toBe(0);
    expect(world.home.skillState.charge).toBeGreaterThanOrEqual(50);
  });

  it('awards a finished World match once and rejects that match as a demo or abandonment', () => {
    const world = makeWorld({ bestOf: 3, scoring: 'rally15' });
    const initial = createProgression();
    const resultFromWorld = (mode: CompletedMatchResult['mode'], completed: boolean): CompletedMatchResult => ({
      id: 'integration-world-707', mode, completed, humanActions: 16,
      won: world.home.setsWon >= world.setsNeeded,
      pointsWon: world.home.setScores.reduce((sum, score) => sum + score, 0),
      pointsLost: world.away.setScores.reduce((sum, score) => sum + score, 0),
      setsPlayed: world.home.setScores.length,
      skillUses: world.home.skillState.activations,
    });

    world.home.points = 14;
    world.away.points = 8;
    finishRally(world, 'home');
    nextServe(world);
    const abandoned = awardMatch(initial, resultFromWorld('solo', false));
    expect(abandoned).toMatchObject({ awarded: false, reason: 'incomplete', xpGained: 0 });
    expect(abandoned.profile).toBe(initial);

    world.home.points = 14;
    world.away.points = 8;
    const finalEvents = finishRally(world, 'home');
    expect(finalEvents.filter(e => e.type === 'matchWon')).toEqual([{ type: 'matchWon', side: 'home' }]);
    const complete = world.phase === 'matchOver';
    const demo = awardMatch(initial, resultFromWorld('demo', complete));
    expect(demo).toMatchObject({ awarded: false, reason: 'demo', xpGained: 0 });
    expect(demo.profile).toBe(initial);

    const reward = awardMatch(initial, resultFromWorld('versus', complete));
    expect(reward.awarded).toBe(true);
    expect(reward.profile).toMatchObject({ matchesPlayed: 1, wins: 1, pointsWon: 30 });
    expect(reward.xpGained).toBeGreaterThan(0);
    expect(awardMatch(reward.profile, resultFromWorld('versus', complete))).toMatchObject({
      awarded: false, reason: 'duplicate', xpGained: 0, profile: reward.profile,
    });
  });
});
