import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { FIXED_DT, GAME_SPEED } from '../src/core/rules';
import { CELEBRATE_FRAMES, CONTACT_FRAME, SpriteTimeline, approachFrameForPlayer } from '../src/render/sprite-figure';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { BUMP_PREPARATION_FRAMES } from '../src/render/bump-preparation';
import { APPROACH_RUN_FRAMES, APPROACH_PLANT_FRAMES } from '../src/render/approach-steps';

const player = (id = 7) => new Player(id, 'home', 'outside', 'TEST', defaultStats());

describe('ready, approach and grounded celebration drawings', () => {
  it('prepares the designated deep passer before a low fast serve reaches him', () => {
    const config = { home: TEAMS[0], away: TEAMS[1], seed: 4242,
      difficulty: 1, humanControlsHome: false };
    const w = new World(config), noSpriteReads = new World(config), clock = new SpriteTimeline();
    let preparedAt: number | undefined;
    for (let step = 0; step < 1200; step++) {
      w.step(idleCommand());
      noSpriteReads.step(idleCommand());
      const events = w.drainEvents();
      expect(events).toEqual(noSpriteReads.drainEvents());
      for (const e of events) if (e.type === 'contact') clock.cue(e.playerId, e.kind, e.airborne, e.facing, e.backSet);
      for (const p of w.allPlayers()) clock.frameFor(p, FIXED_DT);
      expect(w.ball).toEqual(noSpriteReads.ball);
      expect(w.allPlayers()).toEqual(noSpriteReads.allPlayers());
      const passer = w.away.players.find(p => p.id === 104)!;
      if (passer.anim === 'bump_ready') preparedAt ??= step / 120;
      const contact = events.find(e => e.type === 'contact' && e.kind === 'bump' && e.playerId === 104);
      if (contact?.type === 'contact') {
        expect(preparedAt).toBeDefined();
        expect(step / 120 - preparedAt!).toBeGreaterThanOrEqual(.18);
        // AI braking intentionally changes where the passer stands. Compare
        // identical simulations above to prove sprite reads change no physics,
        // rather than freezing the old sliding receiver's contact coordinates.
        expect(contact.at.z).toBeLessThan(1);
        expect(passer.vel.x).toBe(0); expect(passer.vel.y).toBe(0);
        return;
      }
    }
    throw new Error('The seeded low service reception did not occur');
  });

  it.each(['bump', 'set'] as const)('keeps %s preparation in order and holds before the actual contact cue', action => {
    const p = player(), clock = new SpriteTimeline(); p.setAnim(action === 'bump' ? 'bump_ready' : 'set_ready');
    const frames: number[] = [];
    for (let i = 0; i <= 50; i++) {
      p.animTime = i * .01;
      frames.push(clock.frameFor(p, .01).frame);
    }
    const order: readonly number[] = action === 'bump' ? BUMP_PREPARATION_FRAMES : Array.from({ length: CONTACT_FRAME[action]! }, (_, i) => i);
    expect([...new Set(frames)]).toEqual(order);
    for (let i = 1; i < frames.length; i++) expect(order.indexOf(frames[i])).toBeGreaterThanOrEqual(order.indexOf(frames[i - 1]));
    expect(frames.at(-1)).toBe(CONTACT_FRAME[action]! - 1);
    p.setAnim(action === 'bump' ? 'bump_contact' : 'set_contact'); clock.cue(p.id, action, false);
    expect(clock.frameFor(p, .01).frame).toBe(CONTACT_FRAME[action]);
  });

  it('starts an approach with the first step, despite a buffered spike or previous running phase', () => {
    const p = player(), clock = new SpriteTimeline();
    p.vel.y = 4; p.setAnim('run');
    clock.frameFor(p, .35, 'run');
    p.licenseApproach('attack', 1.2);
    expect(clock.frameFor(p, .01, 'spike')).toMatchObject({ action: 'approach', frame: APPROACH_RUN_FRAMES[0] });
    p.approachAge = .3;
    expect(clock.frameFor(p, .01, 'spike').frame).toBe(APPROACH_RUN_FRAMES[Math.floor(.3/.58*APPROACH_RUN_FRAMES.length)]);
    p.approachAge = 1;
    expect(clock.frameFor(p, .01, 'spike').frame).toBe(15);
  });

  it.each([60,120])('samples the authored plant at %i Hz, then yields to airborne spike', hz => {
    const p = player(), clock = new SpriteTimeline();
    p.licenseApproach('attack', 1.2); p.approachAge = .58;
    expect(clock.frameFor(p, .01, 'spike').frame).toBe(15);
    p.cancelApproach(); p.setAnim('plant');
    const frames: number[] = [];
    for (let i = 0; i <= Math.ceil(.1 * hz / GAME_SPEED); i++) {
      p.animTime = i * GAME_SPEED / hz;
      const sample = clock.frameFor(p, GAME_SPEED / hz, 'spike');
      expect(sample.action).toBe('approach'); frames.push(sample.frame);
    }
    // A 60 Hz display has only eleven samples in this physical .1 s plant;
    // it must not delay takeoff to squeeze in the twelfth drawing.
    expect([...new Set(frames)]).toEqual(hz === 60
      ? [15,16,17,18,19,20,60,62,22,63,23] : APPROACH_PLANT_FRAMES);
    p.jump();
    expect(clock.frameFor(p, .01, 'spike').action).toBe('spike');
  });

  it('a frozen plant cannot advance its hands just because rendering is called', () => {
    const p = player(); p.licenseApproach('attack', 1); p.setAnim('plant'); p.animTime = .04;
    for (let i = 0; i < 30; i++) expect(approachFrameForPlayer(p).frame).toBe(19);
  });

  it('plays one complete victory gesture, holds its recovery and never loops into another punch', () => {
    const p = player(), clock = new SpriteTimeline(); p.celebrate(1.8);
    const frames: number[] = [];
    for (let i = 0; i < 160; i++) {
      p.step(GAME_SPEED / 60, 0, 0);
      const sample = clock.frameFor(p, GAME_SPEED / 60, 'bump');
      expect(sample.action).toBe('celebrate');
      expect(p.height).toBe(0); frames.push(sample.frame);
    }
    expect([...new Set(frames)]).toEqual(CELEBRATE_FRAMES);
    expect(frames.slice(-20)).toEqual(Array(20).fill(23));
  });

  it('keeps idle athletes planted instead of cycling noisy waiting drawings', () => {
    const a = player(1), b = player(2), clock = new SpriteTimeline();
    for (let tick = 0; tick < 120; tick++) {
      expect(clock.frameFor(a, 1 / 60, 'idle').frame).toBe(0);
      expect(clock.frameFor(b, 1 / 60, 'idle').frame).toBe(0);
    }
  });

  it('does not replace an airborne blocker with grounded celebration artwork', () => {
    const p = player(); p.jump(); p.setAnim('block'); p.celebrate(1.8);
    expect(p.anim).toBe('block'); expect(p.cheerTime).toBe(0);
  });
});
