/** Physics/presentation contracts. Artistic acceptance needs the real capture. */
import { describe, expect, it } from 'vitest';
import { Ball } from '../src/core/ball';
import { canReach, performBump, NEUTRAL_AIM } from '../src/core/contact';
import { Player, defaultStats } from '../src/core/player';
import { Rng } from '../src/core/rng';
import { DIVE_EXTENSION_TIME, GAME_SPEED, FIXED_DT } from '../src/core/rules';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { CONTACT_FRAME, DIVE_IMPACT_FRAMES, DIVE_FLOOR_FRAMES, DIVE_RECOVERY_FRAMES, SpriteTimeline } from '../src/render/sprite-figure';

const player = () => {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
  p.pos.y = -7;
  return p;
};
const dt = GAME_SPEED / 60;

describe('dive drawings follow the body', () => {
  it('cannot make a save before extending, even when the ball is already nearby', () => {
    const p = player(), ball = new Ball(), clock = new SpriteTimeline();
    p.dive(0, 1);
    const frames: number[] = [];
    while (p.animTime < DIVE_EXTENSION_TIME) {
      ball.pos = { ...p.pos, z: p.height + .25 };
      const before = JSON.stringify({ p, ball });
      expect(canReach(p, ball)).toBe(false);
      expect(JSON.stringify({ p, ball })).toBe(before);
      frames.push(clock.frameFor(p, FIXED_DT).frame);
      p.step(FIXED_DT, 0, 0);
    }
    ball.pos = { ...p.pos, z: p.height + .25 };
    expect(canReach(p, ball)).toBe(true);
    expect([...new Set(frames)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('finishes the drawn reach by the early low-save window without skipping at 60 Hz', () => {
    const p = player(), clock = new SpriteTimeline(), frames: number[] = [];
    p.dive(0, 1);
    for (let i = 0; i < 10; i++) {
      frames.push(clock.frameFor(p, dt).frame);
      p.step(dt, 0, 0);
    }
    expect([...new Set(frames)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p.diving).toBe(true);
    expect(p.presentation.phase).toBe('rise');
  });

  it.each([false, true])('keeps flight, slide and get-up in order (save=%s)', hit => {
    const p = player(), clock = new SpriteTimeline(), ball = new Ball();
    const frames: number[] = [];
    let contact = false, recovered = false, recoveryPosition: typeof p.pos | undefined;
    p.dive(0, 1);
    for (let i = 0; i < 180; i++) {
      if (hit && !contact && p.presentation.startedAt >= .25) {
        ball.pos = { ...p.pos, z: p.height + .25 };
        const r = performBump({ player: p, ball, aim: NEUTRAL_AIM, rng: new Rng(1), charge: 0, errorScale: 0 });
        expect(r.kind).toBe('save');
        expect(p.anim).toBe('dive_contact');
        expect(p.presentation.phase).toBe('contact');
        clock.cue(p.id, r.kind, p.airborne); contact = true;
        expect(clock.frameFor(p, 0)).toMatchObject({ action: 'dive', frame: CONTACT_FRAME.dive });
      }
      const sample = clock.frameFor(p, dt);
      if (sample.action === 'dive') frames.push(sample.frame);
      if (p.diving) {
        expect(sample.frame).toBeLessThan(12);
        if (!contact) expect(sample.frame).not.toBe(CONTACT_FRAME.dive);
      } else if (p.downTime > 0) {
        expect(sample.action).toBe('dive');
        expect(DIVE_FLOOR_FRAMES).toContain(sample.frame);
        expect(p.height).toBe(0);
      } else if (p.gettingUp > 0) {
        expect(sample.action).toBe('dive');
        expect(sample.frame).toBeGreaterThanOrEqual(18);
        expect(p.canAct).toBe(false);
        expect(p.jump()).toBe(false);
        expect(p.dive(0, 1)).toBe(false);
        ball.pos = { ...p.pos, z: .5 };
        expect(canReach(p, ball)).toBe(false);
        recoveryPosition ??= { ...p.pos };
        expect(p.pos).toEqual(recoveryPosition);
        expect(Math.hypot(p.vel.x, p.vel.y)).toBe(0);
      } else { recovered = true; break; }
      p.step(dt, 0, 1); // A held movement command must not drive the get-up.
    }
    expect(recovered).toBe(true); expect(recoveryPosition).toBeDefined();
    expect(p.canAct).toBe(true);
    for (let f = 0; f < 40; f++) if (f !== 12 && (hit || f !== 9)) expect(frames, `drawing ${f}`).toContain(f);
    expect(frames).not.toContain(12); // Superseded abrupt chest/palm registration.
    const authoredOrder = [...Array.from({ length: 12 }, (_, i) => i), ...DIVE_FLOOR_FRAMES, ...DIVE_RECOVERY_FRAMES];
    for (let i = 1; i < frames.length; i++) {
      expect(authoredOrder.indexOf(frames[i])).toBeGreaterThanOrEqual(authoredOrder.indexOf(frames[i - 1]));
    }
    expect(clock.frameFor(p, dt).action).not.toBe('dive');
  });

  it('does not replace the diving body with a buffered bump or old swing', () => {
    const p = player(), clock = new SpriteTimeline();
    clock.cue(p.id, 'set', false);
    p.dive(0, 1);
    for (let i = 0; i < 8; i++) {
      expect(clock.frameFor(p, dt, 'bump').action).toBe('dive');
      p.step(dt, 0, 0);
    }
    p.knockDown();
    expect(clock.frameFor(p, dt, 'set')).toMatchObject({ action: 'dive', frame: DIVE_IMPACT_FRAMES[0] });
  });

  it.each([60, 90, 120, 144])('finishes the get-up through all authored inbetweens at %s Hz', hz => {
    const p = player(), clock = new SpriteTimeline(), frames: number[] = [];
    const step = GAME_SPEED / hz;
    p.gettingUp = .26; p.setAnim('getUp');
    while (p.gettingUp > 0) {
      const before = JSON.stringify(p);
      const sample = clock.frameFor(p, step);
      expect(sample.action).toBe('dive');
      expect(JSON.stringify(p)).toBe(before);
      frames.push(sample.frame);
      expect(clock.frameFor(p, 0)).toEqual(sample);
      p.step(step, 0, 0);
    }
    expect([...new Set(frames)]).toEqual([18, 19, 20, 21, 24, 22, 23, 32, 33, 25, 34, 35, 26, 27]);
    expect(frames.at(-1)).toBe(27);
    expect(p.canAct).toBe(true);
    clock.cue(p.id, 'bump', false);
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'bump', frame: CONTACT_FRAME.bump });
  });

  it.each([60, 90, 120, 144])('preserves compression and completes the hand push-up at %s Hz', hz => {
    const p = player(), clock = new SpriteTimeline(), frames: number[] = [];
    const step = GAME_SPEED / hz;
    p.downTime = .5; p.setAnim('down');
    while (p.downTime > 0) {
      const before = JSON.stringify(p), sample = clock.frameFor(p, step);
      expect(sample.action).toBe('dive');
      expect(JSON.stringify(p)).toBe(before);
      if (p.animTime < .25) expect(sample.frame).toBe(DIVE_IMPACT_FRAMES[Math.min(5, Math.floor(p.animTime / (.25 / 6)))]);
      frames.push(sample.frame);
      expect(clock.frameFor(p, 0)).toEqual(sample);
      p.step(step, 0, 0);
    }
    expect([...new Set(frames)]).toEqual(DIVE_FLOOR_FRAMES);
    expect(p.gettingUp).toBe(.26);
    expect(p.canAct).toBe(false);
  });

  it('preserves a baseline-facing save through the whole recovery', () => {
    const p = player();
    p.dive(0, -1);
    let sawGetUp = false;
    for (let i = 0; i < 150 && (p.diving || p.downTime > 0 || p.gettingUp > 0); i++) {
      expect(p.facing).toBe(-1);
      expect(p.presentation.lockedFacing).toBe(-1);
      if (i === 15) p.setAnim('dive_contact');
      if (p.gettingUp > 0) { sawGetUp = true; p.celebrate(1); expect(p.anim).toBe('getUp'); }
      p.step(dt, 0, 1);
    }
    expect(sawGetUp).toBe(true);
  });

  it('does not move or mirror planted recovery hands when a teammate passes', () => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 1, difficulty: 1, humanControlsHome: false });
    const [p, mate] = w.home.players.filter(p => p.id !== w.home.server.id);
    p.pos = { x: 0, y: -4, z: 0 }; mate.pos = { x: 0, y: -4.1, z: 0 };
    p.vel = { x: 0, y: 0, z: 0 }; p.facing = -1; p.gettingUp = .26; p.setAnim('getUp');
    const start = { ...p.pos };
    w.step(null);
    expect(p.gettingUp).toBeGreaterThan(0);
    expect(p.pos).toEqual(start);
    expect(p.facing).toBe(-1);
  });

  it('completes a naturally occurring AI save with correct floor/recovery poses', () => {
    // Use the same fixed match cohort as gameplay acceptance. Team schemes
    // change which rally needs a dive; do not require one obsolete seed to
    // make an unnecessary save. No pose, ball or job is assigned here.
    let save = false, completed = false;
    for (const seed of [1337, 4242, 90210, 7, 11, 2026]) {
      const w = new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });
      const clock = new SpriteTimeline();
      const extensionFrames = new Map<number, Set<number>>();
      let diver: Player | undefined, recovery = false;
      for (let i = 0; i < 6000 && !completed; i++) {
        w.step(null);
        for (const p of w.allPlayers()) {
          if (!p.diving) extensionFrames.delete(p.id);
          else if (p.anim === 'dive') {
            const frames = extensionFrames.get(p.id) ?? new Set<number>();
            frames.add(clock.frameFor(p, FIXED_DT).frame);
            extensionFrames.set(p.id, frames);
          }
        }
        for (const e of w.drainEvents()) if (e.type === 'contact') {
          clock.cue(e.playerId, e.kind, e.airborne);
          if (!diver && e.kind === 'save') {
            diver = w.findPlayer(e.playerId);
            // The first actual save must not skip from push-off to contact.
            // Recording only after the event concealed that regression.
            // The contact tick may already select impact pose10 before the
            // explicit visual cue below. It must follow the complete extension.
            const extension = [...(extensionFrames.get(e.playerId) ?? [])];
            expect(extension.slice(0,9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
            expect(extension.slice(9).every(frame => frame === 10)).toBe(true);
          }
          if (e.playerId === diver?.id && e.kind === 'save') save = true;
        }
        if (!diver) continue;
        const sample = clock.frameFor(diver, FIXED_DT);
        if (diver.diving) expect(sample).toMatchObject({ action: 'dive' });
        if (!diver.diving && diver.downTime > 0) {
          expect(DIVE_FLOOR_FRAMES).toContain(sample.frame);
        }
        if (diver.gettingUp > 0) {
          recovery = true;
          expect(sample).toMatchObject({ action: 'dive' });
          expect(sample.frame).toBeGreaterThanOrEqual(18); expect(diver.canAct).toBe(false);
        }
        if (recovery && diver.gettingUp <= 0) completed = true;
      }
      // Once an actual save occurs, its recovery must pass. Do not skip a bad
      // recovery in favour of a different seed.
      if (save) break;
    }
    expect(save).toBe(true); expect(completed).toBe(true);
  });

  it('does not assign the next reception or attack to a player still getting up', () => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false });
    const p = w.home.players.find(p => p.role === 'outside')!;
    const brain = (w as any).brains.home;
    p.gettingUp = .26; p.setAnim('getUp');
    w.ball.pos = { ...p.pos, z: 1 };
    const prediction = { valid: true, point: { ...p.pos }, time: .2 };
    brain.designatedAttacker = p.id;
    expect(brain.pickReceiver()).not.toBe(p.id);
    expect(brain.pickBallHandler(prediction, () => 0)).not.toBe(p.id);
    expect(brain.pickAttackerHandler(prediction)).not.toBe(p.id);
    expect(brain.pickAttacker()).not.toBe(p.id);
    expect(brain.passers()).not.toContain(p.id);
  });
});
