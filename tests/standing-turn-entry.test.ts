import { describe, it, expect } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { GAME_SPEED, FIXED_DT } from '../src/core/rules';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline, locomotionPlaybackScale } from '../src/render/sprite-figure';
import { PIVOT_DURATION } from '../src/render/facing-transition';
import { STANDING_TURN_REVIEW_POSES } from '../src/render/turn-playback';

function scene() {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
  p.facing = 1; clock.frameFor(p, 0, 'idle'); p.facing = -1;
  return { p, clock };
}

describe('standing player loads the knees before a planted pivot', () => {
  it.each([59.94,60,75,90,120,144])('shows the existing four loading poses and all turn drawings at %s Hz', hz => {
    const { p, clock } = scene(), dt = GAME_SPEED / hz;
    const first = clock.frameFor(p, .05, 'idle');
    expect(first).toMatchObject({ action: 'idle', frame: 28, facing: 1 });
    const sequence = [{ action: first.action, frame: first.frame }];
    let time = 0, completed = false;
    for (let i = 0; i < 200; i++) {
      const before = JSON.stringify(p), pose = clock.frameFor(p, 0, 'idle', undefined, dt);
      time += dt;
      expect(JSON.stringify(p)).toBe(before);
      if (pose.facing === -1) {
        expect(pose).toMatchObject({ action: 'idle', frame: 0 });
        expect(time).toBeGreaterThanOrEqual(PIVOT_DURATION);
        expect(time).toBeLessThan(PIVOT_DURATION + dt * 2.01);
        completed = true; break;
      }
      const current = { action: pose.action, frame: pose.frame };
      if (JSON.stringify(sequence.at(-1)) !== JSON.stringify(current)) sequence.push(current);
      expect(clock.frameFor(p, 0, 'idle', undefined, 0)).toEqual(pose);
    }
    expect(completed).toBe(true);
    expect(sequence).toEqual(STANDING_TURN_REVIEW_POSES);
  });

  it.each([28,29,30,31])('allows immediate contact during reused loading drawing %s', target => {
    const { p, clock } = scene(); clock.frameFor(p, .05, 'idle');
    for (let i = 0; i < 100; i++) {
      const pose = clock.frameFor(p, .002, 'idle');
      if (pose.action === 'idle' && pose.frame === target) {
        clock.cue(p.id, 'set', false, -1);
        expect(clock.frameFor(p, 0, 'idle')).toMatchObject({ action: 'set', frame: 9, facing: -1 });
        return;
      }
    }
    throw Error('Loading pose not reached');
  });

  it('does not add another knee loading to a defender already in a low lateral support', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.facing = 1; clock.frameFor(p, 0, 'shuffle'); p.facing = -1;
    expect(clock.frameFor(p, .05, 'shuffle')).toMatchObject({ action: 'turn', frame: 0, facing: 1 });
  });

  it('does not retain a previous match loading gesture after reset', () => {
    const { p, clock } = scene(); clock.frameFor(p, .05, 'idle'); clock.reset();
    const pose = clock.frameFor(p, 0, 'idle');
    expect(pose).toMatchObject({ action: 'idle', frame: 0 });
    expect(pose.facing ?? p.facing).toBe(-1);
  });

  it('connects the natural second-service stationary turn without changing match state', () => {
    const config = { home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false };
    const world = new World(config), reference = new World(config), clock = new SpriteTimeline();
    const frames: number[] = [];
    let reached = false;
    for (let i = 0; i < 3500; i++) {
      world.step(null); reference.step(null);
      const events = world.drainEvents(); expect(events).toEqual(reference.drainEvents());
      const p = world.findPlayer(104)!;
      for (const e of events) if (e.type === 'contact' && e.playerId === p.id) clock.cue(p.id, e.kind, e.airborne, e.facing, e.backSet);
      const action = clock.actionFor(p), speed = Math.hypot(p.vel.x,p.vel.y);
      const scale = ['walk','shuffle','backpedal','run'].includes(action) ? locomotionPlaybackScale(action,speed) : 1;
      const before = JSON.stringify(p), pose = clock.frameFor(p,FIXED_DT*scale,undefined,undefined,FIXED_DT);
      expect(JSON.stringify(p)).toBe(before);
      if (world.home.points+world.away.points === 1 && world.phase === 'serve') {
        if (pose.action === 'idle' && pose.frame >= 28 && frames.at(-1) !== pose.frame) frames.push(pose.frame);
        if (world.phaseTimer > .6) { reached = true; break; }
      }
    }
    expect(reached).toBe(true);
    expect(frames).toEqual([28,29,30,31]);
    expect(world.ball).toEqual(reference.ball);
    expect(world.allPlayers()).toEqual(reference.allPlayers());
  });
});
