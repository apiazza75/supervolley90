import { describe, expect, it } from 'vitest';
import { TeamBrain } from '../src/core/ai';
import { Ball, predictLanding } from '../src/core/ball';
import {
  BLOCK_EFFICACY_MULTIPLIER, canAttackAboveNet, canReach, contactRadius,
  performAttack, performSet, timingReward,
} from '../src/core/contact';
import { v3 } from '../src/core/math3';
import { Player, defaultStats } from '../src/core/player';
import { Rng } from '../src/core/rng';
import { ATTACK_LINE, FIXED_DT, NET_HEIGHT, PLAYER_RADIUS, attackDir } from '../src/core/rules';
import { SetPlay, setFlightTime, setTargetFor } from '../src/core/set-play';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { canPlantForGroundContact } from '../src/core/receive-plant';

function hitter(side: 'home' | 'away' = 'home'): Player {
  const p = new Player(4, side, 'outside', 'TEST', defaultStats());
  p.rotationSlot = 4; p.pos = v3(0, -attackDir(side) * 2.1, 0);
  p.height = 1; p.setAnim('jump');
  return p;
}

describe('arcade volleyball tuning', () => {
  it('increases the physical block coverage by exactly 25 percent at every incoming pace', () => {
    const p = hitter(); p.pos.y = -.72; p.setAnim('block');
    for (const speed of [0, 12, 20, 28, 38]) {
      const ball = new Ball(); ball.pos = v3(0, -.72, 3.2); ball.vel = v3(0, -speed, 0);
      const pace = Math.max(0, Math.min(1, (speed - 12) / 16));
      const oldRadius = (PLAYER_RADIUS + .42) * (1 - .55 * pace);
      expect(contactRadius(p, ball) / oldRadius).toBeCloseTo(1.25, 10);
      ball.pos.x = oldRadius * 1.12;
      expect(canReach(p, ball)).toBe(true);
      ball.pos.x = oldRadius * 1.251;
      expect(canReach(p, ball)).toBe(false);
    }
    expect(BLOCK_EFFICACY_MULTIPLIER).toBe(1.25);
  });

  it('rewards a deliberate red-cue swing with more speed and tighter aim', () => {
    const player = hitter();
    const makeBall = () => { const b = new Ball(); b.pos = v3(.45, -2.1, 3); return b; };
    const plain = makeBall(), timed = makeBall();
    expect(timingReward(player, timed)).toBeGreaterThan(.5);
    const base = { player, aim: { x: .4, depth: .45 }, charge: 0 };
    const ordinary = performAttack({ ...base, ball: plain, rng: new Rng(72) });
    const excellent = performAttack({ ...base, ball: timed, rng: new Rng(72), timingBonus: 1 });
    expect(excellent.kind).toBe('spike');
    expect(excellent.speed).toBeGreaterThan(ordinary.speed * 1.12);
    expect(Math.abs(excellent.target.x - 1.6)).toBeLessThan(Math.abs(ordinary.target.x - 1.6));
    timed.pos.x = 8;
    expect(timingReward(player, timed)).toBe(0);
  });

  it.each(['home', 'away'] as const)('keeps quick/back/pipe deliveries playable and distinct for %s', side => {
    const player = hitter(side), dir = attackDir(side);
    player.height = 0; player.setAnim('ready'); player.pos = v3(dir * 2.1, -dir * 1.2, 0);
    const times: Record<string, number> = {};
    for (const play of ['high', 'quick', 'back', 'pipe', 'feint'] as SetPlay[]) {
      const attacker = hitter(side);
      if (play === 'pipe') attacker.rotationSlot = 6;
      const target = setTargetFor(attacker, play), before = { ...target };
      const ball = new Ball(); ball.pos = v3(player.pos.x, player.pos.y, 2.25);
      const result = performSet({ player, ball, rng: new Rng(1), charge: 0,
        aim: { x: 0, depth: 0 }, attackerTarget: target, setPlay: play, errorScale: 0 });
      const pred = predictLanding(ball, result.target.z);
      expect(target).toEqual(before);
      expect(pred.valid).toBe(true);
      expect(pred.point.x).toBeCloseTo(target.x, 1);
      expect(pred.point.y).toBeCloseTo(target.y, 1);
      expect(pred.point.y * dir).toBeLessThan(0);
      times[play] = pred.time;
      if (play === 'pipe') expect(-dir * pred.point.y).toBeGreaterThan(ATTACK_LINE + .45);
    }
    expect(times.quick).toBeLessThan(times.high * .7);
    expect(times.back).toBeLessThan(times.high);
    expect(times.pipe).toBeGreaterThan(times.quick * 1.5);
  });

  it.each(['home', 'away'] as const)('uses the %s takeoff position for legal second-line attacks', side => {
    const p = hitter(side), dir = attackDir(side); p.rotationSlot = 6;
    p.height = 0; p.vertVel = 0; p.pos.y = -dir * 3.6;
    expect(p.jump()).toBe(true);
    p.step(FIXED_DT, 0, 0);
    p.pos.y = -dir * 2.4;
    expect(canAttackAboveNet(p, false)).toBe(true);
    p.takeoffY = -dir * 2.95; p.pos.y = -dir * 3.5;
    expect(canAttackAboveNet(p, false)).toBe(false);
    const libero = new Player(7, side, 'libero', 'LIBERO', defaultStats());
    libero.pos.y = -dir * 5;
    expect(canAttackAboveNet(libero, false)).toBe(false);
  });

  it('makes skill attack power and set tempo change the actual ball flight', () => {
    const player = hitter();
    const shoot = (powerMultiplier: number) => {
      const ball = new Ball(); ball.pos = v3(.25, -2.1, 3.2);
      return performAttack({ player, ball, rng: new Rng(1), charge: 0,
        aim: { x: 0, depth: .4 }, modifiers: { powerMultiplier } });
    };
    expect(shoot(1.2).speed / shoot(1).speed).toBeCloseTo(1.2);
    const from = v3(2.1, -1.2, 2.2), target = v3(0, -1.6, 3.4);
    expect(setFlightTime('quick', from, target)).toBeLessThan(setFlightTime('high', from, target));
  });

  it('waits for a later planted contact when it stays reachable, but preserves a moving emergency', () => {
    const p = hitter(); p.height = 0; p.setAnim('ready'); p.pos = v3(0, -4, 0); p.vel = v3(3, 0, 0);
    const safe = new Ball(); safe.pos = v3(.8, -4, 2.1); safe.vel = v3(0, 0, -.5);
    expect(canReach(p, safe)).toBe(true);
    expect(canPlantForGroundContact(p, safe)).toBe(true);
    const late = new Ball(); late.pos = v3(.8, -4, .2); late.vel = v3(8, 0, -3);
    expect(canPlantForGroundContact(p, late)).toBe(false);
  });
});

describe('team-supported double blocks', () => {
  it.each(['home', 'away'] as const)('jumps with two legal unselected %s blockers while the controlled player stays down', side => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 23, difficulty: 1, humanControlsHome: true });
    const team = w.team(side), dir = attackDir(side), brain = new TeamBrain(w, team, 1);
    w.phase = 'rally'; w.possession = side === 'home' ? 'away' : 'home'; w.touches = 2;
    w.ball.frozen = false; w.ball.grounded = false;
    w.ball.pos = v3(.05, dir * 1.15, NET_HEIGHT + 1.1); w.ball.vel = v3(0, -.6 * dir, -.35);
    const front = team.frontRow();
    front.forEach((p, index) => { p.pos = v3([0, -.8, .8][index], -dir * .72, 0); p.vel = v3(); });
    const controlled = front[0]; brain.suppress(controlled.id);
    const attemptsByFrame: number[][] = [];
    for (let i = 0; i < 10; i++) {
      brain.think(FIXED_DT);
      for (const p of team.players) p.step(FIXED_DT, 0, 0);
      const ids = w.drainEvents().filter(e => e.type === 'blockAttempt').map(e => e.playerId);
      if (ids.length) attemptsByFrame.push(ids);
    }
    expect(attemptsByFrame).toHaveLength(1);
    expect(new Set(attemptsByFrame[0])).toEqual(new Set(front.slice(1).map(p => p.id)));
    expect(controlled.airborne).toBe(false);
    expect(front.slice(1).every(p => p.airborne && p.presentation.action === 'block')).toBe(true);
    expect(team.backRow().every(p => !p.airborne)).toBe(true);
  });

  it('keeps both automatic blockers down against a served ball', () => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 23, difficulty: 1, humanControlsHome: false });
    const brain = new TeamBrain(w, w.home, 1);
    w.phase = 'rally'; w.possession = 'away'; w.touches = 2;
    w.ball.pos = v3(0, 1.2, 3.5); w.ball.vel = v3(0, -1, -.3);
    (w as unknown as { serveInFlightFlag: boolean }).serveInFlightFlag = true;
    for (let i = 0; i < 30; i++) brain.think(FIXED_DT);
    expect(w.drainEvents().filter(e => e.type === 'blockAttempt')).toHaveLength(0);
    expect(w.home.players.every(p => !p.airborne)).toBe(true);
  });

  it('supports an idle human against a real AI pass-set-spike with two automatic blockers', () => {
    let attacks = 0;
    for (const seed of [23, 42, 1337, 4242]) {
      const w = new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: true });
      w.phase = 'rally'; w.possession = 'away'; w.touches = 1; w.lastToucherId = 104; w.lastToucherSide = 'away';
      w.ball.frozen = false; w.ball.grounded = false;
      w.ball.pos = v3(-2.1, 1.9, 4.8); w.ball.vel = v3(0, 0, -1.5);
      w.away.setter.pos = v3(-2.1, 1.9, 0); w.findPlayer(103)!.pos = v3(-2.45, 4.4, 0);
      w.home.frontRow().forEach((p, i) => { p.pos = v3([-2.95, 0, 2.95][i], -.72, 0); });
      let found = false;
      for (let i = 0; i < 600; i++) {
        const controlled = w.home.activeId;
        w.step(idleCommand());
        for (const e of w.drainEvents()) {
          if (e.type === 'blockAttempt' && e.side === 'home') expect(e.playerId).not.toBe(controlled);
          if (e.type !== 'contact' || e.side !== 'away' || !['spike', 'power'].includes(e.kind)) continue;
          expect(w.home.frontRow().filter(p => p.airborne && p.presentation.action === 'block').length).toBeGreaterThanOrEqual(2);
          attacks++; found = true;
        }
        if (found) break;
      }
      expect(found).toBe(true);
    }
    expect(attacks).toBe(4);
  });
});

describe('tactical variety in complete rallies', () => {
  it('delivers every set family and produces real, legal back-row spikes', () => {
    const delivered = new Map<string, number>();
    let backRowSpikes = 0;
    for (const seed of [23, 1337, 4242]) {
      const w = new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });
      for (let step = 0; step < 16000; step++) {
        w.step(null);
        for (const e of w.drainEvents()) {
          if (e.type !== 'contact') continue;
          if (e.kind === 'set' && e.setPlay) delivered.set(e.setPlay, (delivered.get(e.setPlay) ?? 0) + 1);
          if (!['spike', 'power'].includes(e.kind)) continue;
          const p = w.findPlayer(e.playerId)!;
          if (w.team(e.side).isFrontRow(p)) continue;
          expect(p.role).not.toBe('libero');
          expect(e.airborne).toBe(true);
          expect(-attackDir(e.side) * (p.takeoffY ?? p.pos.y)).toBeGreaterThan(ATTACK_LINE);
          backRowSpikes++;
        }
      }
    }
    for (const play of ['high', 'quick', 'back', 'pipe', 'feint']) expect(delivered.get(play) ?? 0).toBeGreaterThan(2);
    expect(backRowSpikes).toBeGreaterThan(3);
  });
});
