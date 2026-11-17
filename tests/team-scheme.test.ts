import { describe, expect, it } from 'vitest';
import { v3, distXY } from '../src/core/math3';
import { attackDir } from '../src/core/rules';
import { attackFormation, attackerLane, clearAttackLanding, defenceFormation, serveFormation, servePassers } from '../src/core/tactics';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline } from '../src/render/sprite-figure';

const world = (human = false, seed = 4242) => new World({
  home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: human,
});

describe('volleyball team scheme', () => {
  it.each(['home', 'away'] as const)('clears the %s landing lane even when cover starts in front of the hitter', side => {
    const dir = attackDir(side);
    for (const x of [-2.45, 0, 2.45]) for (const dx of [-1.4, -.35, 0, .35, 1.4]) {
      const attack = v3(x, -dir * 2.1, 3.4);
      const target = v3(x + dx, -dir * 1.2, 0);
      const before = { ...target };
      const cover = clearAttackLanding(side, target, attack);
      expect(target).toEqual(before);
      expect(distXY(cover, attack)).toBeGreaterThanOrEqual(1.95 - 1e-8);
      expect(-dir * cover.y).toBeGreaterThan(-dir * attack.y);
      expect(cover.x).toBeCloseTo(target.x);
      expect(cover.z).toBe(0);
    }
  });

  it('prepares the unselected front players for coverage during the pass-to-set flight', () => {
    const w = world();
    for (const team of [w.home, w.away]) {
      const hitter = team.frontRow().find(p => p.role === 'opposite')!;
      const x = attackerLane(hitter) * attackDir(team.side);
      const afterPass = attackFormation(team.players, hitter.id, x, 1);
      const afterSet = attackFormation(team.players, hitter.id, x, 2);
      for (const p of team.frontRow().filter(p => p.id !== hitter.id && p.role !== 'setter')) {
        expect(afterPass.get(p.id)).toEqual(afterSet.get(p.id));
        expect(Math.abs(afterPass.get(p.id)!.y)).toBeGreaterThan(3);
      }
    }
  });

  it('gets the covering middle behind a planned pin spike before contact, even when cover starts in front', () => {
    const w = world(false, 1337);
    // A controlled high pass establishes the case; set variety may change
    // which player spikes first in a seed, but may not remove landing space.
    w.phase='rally';w.possession='home';w.touches=1;w.lastToucherId=4;w.lastToucherSide='home';
    w.ball.frozen=false;w.ball.grounded=false;w.ball.pos=v3(2.1,-1.9,4.8);w.ball.vel=v3(0,0,-1.5);
    const hitter=w.findPlayer(3)!,middle=w.findPlayer(2)!;
    w.home.setter.pos=v3(2.1,-1.9,0);hitter.pos=v3(2.45,-4.4,0);
    hitter.stats.power=.98;hitter.stats.jump=.98;
    for(const p of w.home.frontRow().filter(p=>p!==hitter)){p.stats.power=.15;p.stats.jump=.15;}
    middle.pos=v3(2.05,-1.2,0);
    for (let i = 0; i < 10000; i++) {
      w.step(idleCommand());
      const hit = w.drainEvents().find(e => e.type === 'contact' && e.kind === 'spike');
      if (!hit || hit.type !== 'contact') continue;
      expect(hit.playerId).toBe(hitter.id);
      expect(middle.presentation.sourceJob).toBe('cover');
      expect(distXY(hitter.pos, middle.pos)).toBeGreaterThan(1.7);
      expect((hitter.pos.y - middle.pos.y) * attackDir(hit.side)).toBeGreaterThan(.9);
      return;
    }
    throw new Error('The seeded rally did not produce a spike');
  });

  it.each([0, 1, 2, 3, 4, 5])('keeps legal, distinct serve formations on both sides in rotation %i', rotation => {
    const w = world();
    for (let i = 0; i < rotation; i++) { w.home.rotate(); w.away.rotate(); }
    for (const team of [w.home, w.away]) {
      const dir = attackDir(team.side);
      const receive = serveFormation(team.players, false), serving = serveFormation(team.players, true);
      const passers = servePassers(team.players);
      expect(new Set(passers).size).toBe(3);
      expect(passers).not.toContain(team.setter.id);
      for (const p of team.frontRow()) expect(Math.abs(serving.get(p.id)!.y)).toBeCloseTo(.95);
      for (const positions of [receive, serving]) {
        const local = (slot: number) => {
          const at = positions.get(team.players.find(p => p.rotationSlot === slot)!.id)!;
          return { x: dir * at.x, depth: Math.abs(at.y) };
        };
        for (const row of [[4, 3, 2], [5, 6, 1]]) {
          expect(local(row[1]).x - local(row[0]).x).toBeGreaterThanOrEqual(.64);
          expect(local(row[2]).x - local(row[1]).x).toBeGreaterThanOrEqual(.64);
        }
        for (const [front, back] of [[4, 5], [3, 6], [2, 1]]) {
          expect(local(back).depth - local(front).depth).toBeGreaterThan(.5);
        }
        for (const at of positions.values()) {
          expect(Math.abs(at.x)).toBeLessThan(4.5);
          expect(Math.abs(at.y)).toBeLessThan(9);
          expect(at.y * dir).toBeLessThan(0);
        }
      }
    }
  });

  it.each([0, 1, 2, 3, 4, 5])('has no non-server footwork while the human waits in rotation %i', rotation => {
    const w = world(true), clock = new SpriteTimeline();
    for (let i = 0; i < rotation; i++) { w.home.rotate(); w.away.rotate(); }
    (w as any).setupServe();
    const start = new Map(w.allPlayers().map(p => [p.id, { ...p.pos }]));
    for (let i = 0; i < 1200; i++) {
      w.step(idleCommand()); w.drainEvents();
      for (const p of w.allPlayers()) {
        if (p.id === w.home.server.id) continue;
        expect(distXY(p.pos, start.get(p.id)!)).toBe(0);
        expect(p.vel).toEqual(v3());
        expect(['stand', 'ready']).toContain(p.presentation.locomotion);
        if (i % 120 === 0) expect(clock.frameFor(p, 1 / 120).action).toBe('idle');
      }
    }
    expect(w.phase).toBe('serve');
    expect(w.ball.frozen).toBe(true);
    expect(w.home.frontRow().every(p => p.presentation.sourceJob === 'block')).toBe(true);
    expect(w.away.players.filter(p => p.presentation.sourceJob === 'receive')).toHaveLength(3);
  });

  it('assigns distinct cover lanes with a libero and even when only one blocker is available', () => {
    const w = world();
    for (let rotation = 0; rotation < 6; rotation++) {
      for (const team of [w.home, w.away]) {
        const front = team.frontRow();
        for (const threat of [-2.95, 0, 2.95]) for (const count of [0, 1, 2]) {
          const ids = front.slice(0, count).map(p => p.id);
          const formation = defenceFormation(team.players, threat, ids);
          const cover = team.players.filter(p => !ids.includes(p.id));
          for (let a = 0; a < cover.length; a++) for (let b = a + 1; b < cover.length; b++) {
            expect(distXY(formation.get(cover[a].id)!, formation.get(cover[b].id)!)).toBeGreaterThan(.6);
          }
        }
        for (const hitter of front.filter(p => p.role !== 'setter')) for (const touches of [1, 2]) {
          const formation = attackFormation(team.players, hitter.id, attackerLane(hitter) * attackDir(team.side), touches);
          const cover = team.players.filter(p => p.id !== hitter.id && p.role !== 'setter');
          for (let a = 0; a < cover.length; a++) for (let b = a + 1; b < cover.length; b++) {
            expect(distXY(formation.get(cover[a].id)!, formation.get(cover[b].id)!)).toBeGreaterThan(.6);
          }
        }
      }
      w.home.rotate(); w.away.rotate();
    }
  });

  it('keeps its own serve in defence and preserves the serve flag through the net crossing', () => {
    const w = world();
    let ownServeSamples = 0, crossedServeSamples = 0, firstPasses = 0;
    for (let i = 0; i < 12000; i++) {
      const wasServe = w.serveInFlight;
      w.step(null);
      if (w.phase === 'rally' && w.serveInFlight) {
        const serving = w.team(w.servingSide);
        for (const p of serving.players) {
          if (p.id !== serving.server.id && !p.airborne && !p.diving && p.downTime <= 0 && p.gettingUp <= 0) {
            expect(p.facing).toBe(attackDir(w.servingSide));
          }
        }
        const brain = (w as any).brains[w.servingSide];
        // The contact step was assigned while phase=serve; all following steps
        // must be defensive, including the time before the ball crosses.
        if (wasServe) for (const p of serving.players) {
          expect(['block', 'cover']).toContain(brain.states.get(p.id).job);
          expect(brain.states.get(p.id).wantsAction).toBe(false);
        }
        ownServeSamples++;
        if (w.ball.pos.y * attackDir(w.servingSide) > 0) crossedServeSamples++;
      }
      for (const e of w.drainEvents()) if (wasServe && e.type === 'contact' && e.kind !== 'serve') {
        expect(e.side).not.toBe(w.servingSide);
        expect(e.kind).not.toBe('block');
        expect(w.serveInFlight).toBe(false);
        firstPasses++;
      }
    }
    expect(ownServeSamples).toBeGreaterThan(100);
    expect(crossedServeSamples).toBeGreaterThan(100);
    expect(firstPasses).toBeGreaterThan(3);
  });

  it('allows a legal block on either side of the tape but not against a serve or a teammates ball', () => {
    const w = world(), p = w.home.frontRow()[0];
    w.phase = 'rally'; w.possession = 'away'; w.touches = 3; w.lastToucherSide = 'away';
    p.pos = v3(0, -.65, 0); p.height = 1; p.setAnim('block');
    for (const y of [-.5, .1]) {
      w.ball.pos = v3(0, y, 3); w.ball.vel = v3(0, -20, -2);
      expect((w as any).classifyContact(p, w.home)).toBe('block');
    }
    (w as any).serveInFlightFlag = true;
    expect((w as any).classifyContact(p, w.home)).not.toBe('block');
    (w as any).serveInFlightFlag = false; w.lastToucherSide = 'home';
    expect((w as any).classifyContact(p, w.home)).not.toBe('block');
  });

  it('does not let the striker cooldown suppress an actual legal block', () => {
    const w = world(), p = w.home.frontRow()[0];
    w.phase = 'rally'; w.possession = 'away'; w.touches = 3; w.lastToucherSide = 'away';
    p.pos = v3(0, -.65, 0); p.height = 1; p.setAnim('block'); p.actionBuffer = .1;
    w.ball.frozen = false; w.ball.grounded = false; w.ball.touchCooldown = .08;
    w.ball.pos = v3(0, -.5, 3); w.ball.vel = v3(0, -20, -2);
    (w as any).resolveContacts(new Map());
    expect(w.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'blockContact', playerId: p.id, airborne: true }),
    ]));
  });

  it('never knocks a wall down remotely when the opponent strikes', () => {
    const w = world(); let attacks = 0;
    for (let i = 0; i < 12000; i++) {
      const up = w.allPlayers().filter(p => p.height > .3 && p.downTime <= 0).map(p => p.id);
      w.step(null);
      for (const e of w.drainEvents()) if (e.type === 'contact' && ['spike', 'power'].includes(e.kind)) {
        attacks++;
        for (const p of w.allPlayers().filter(p => p.side !== e.side && up.includes(p.id))) {
          expect(p.downTime).toBeLessThanOrEqual(0);
          expect(p.height).toBeGreaterThan(0);
        }
      }
    }
    expect(attacks).toBeGreaterThan(5);
  });
});
