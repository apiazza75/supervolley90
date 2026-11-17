import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, GAME_SPEED } from '../src/core/rules';
import { DURATION, SpriteTimeline, locomotionPlaybackScale } from '../src/render/sprite-figure';
import { SHEETS } from '../src/render/sprites';
import { RUN_BRAKE_STEP_FRAME } from '../src/render/run-brake';

function defender(speed: number): Player {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
  p.pos.y = -5; p.vel.x = speed; p.anim = 'shuffle';
  p.presentation.locomotion = speed < .8 ? 'walk' : 'shuffle';
  p.presentation.sourceJob = 'cover';
  return p;
}

describe('authored low defensive step-together', () => {
  it.each([.3, 1.1, 2.2])('uses the low drawings for a %s m/s defensive adjustment', speed => {
    expect(new SpriteTimeline().frameFor(defender(speed), 0)).toMatchObject({ action: 'shuffle', frame: 0 });
    expect(SHEETS.shuffle.artHasLift).toBe(false);
  });

  it('keeps the upright walk for returning from the service zone', () => {
    const p = defender(2); p.pos.y = -COURT_HALF_LENGTH - .5;
    expect(new SpriteTimeline().frameFor(p, 0).action).toBe('walk');
  });

  it.each([-1,1])('does not change ready footwork when crossing sideline %s during coverage', sign => {
    const p=defender(1.5),clock=new SpriteTimeline();p.pos.x=sign*(COURT_HALF_WIDTH-.05);
    clock.frameFor(p,0);const inside=clock.frameFor(p,.2);
    p.pos.x=sign*(COURT_HALF_WIDTH+.6);
    const outside=clock.frameFor(p,.01);
    expect(outside.action).toBe('shuffle');expect(outside.frame).toBeGreaterThanOrEqual(inside.frame);
    p.presentation.sourceJob='serve';expect(clock.actionFor(p)).toBe('walk');
  });

  it.each(['idle', 'serve'] as const)('preserves walking when the job is %s, not a defensive adjustment', job => {
    const p = defender(.6); p.presentation.sourceJob = job;
    expect(new SpriteTimeline().frameFor(p, 0).action).toBe('walk');
  });

  it.each([.25, .7, 1.8, 2.5])('plays every drawn shuffle frame without skipping at %s m/s on 60 Hz', speed => {
    const p = defender(speed), clock = new SpriteTimeline();
    const dt = GAME_SPEED / 60 * locomotionPlaybackScale('shuffle', speed);
    const seen = new Set<number>();
    let previous = clock.frameFor(p, 0).frame;
    for (let t = 0; t < DURATION.shuffle * 2; t += dt) {
      const sample = clock.frameFor(p, dt);
      expect(sample.action).toBe('shuffle');
      expect((sample.frame - previous + 24) % 24).toBeLessThanOrEqual(1);
      previous = sample.frame; seen.add(sample.frame);
    }
    expect(seen.size).toBe(24);
  });

  it('does not inherit an unrelated sprint foot-crossing phase', () => {
    const p = defender(4), clock = new SpriteTimeline();
    p.presentation.locomotion = 'run'; p.anim = 'run';
    clock.frameFor(p, 0); clock.frameFor(p, .38);
    p.presentation.locomotion = 'shuffle'; p.anim = 'shuffle'; p.vel.x = 1;
    expect(clock.frameFor(p, 0).action).toBe('runBrake');
    // Still travelling: use the authored trailing-foot step, not the hidden
    // sprint phase and not the two-foot planted drawing reserved for a stop.
    expect(clock.frameFor(p, .31)).toMatchObject({ action: 'shuffle', frame: RUN_BRAKE_STEP_FRAME });
  });

  it('freezes footwork when actual ground travel stops, instead of stepping on the spot', () => {
    const p = defender(1), clock = new SpriteTimeline();
    clock.frameFor(p, 0); const moving = clock.frameFor(p, .2);
    expect(locomotionPlaybackScale('shuffle', 0)).toBe(0);
    p.vel.x = 0;
    for (let i = 0; i < 30; i++) {
      expect(clock.frameFor(p, GAME_SPEED / 60 * locomotionPlaybackScale('shuffle', 0))).toEqual(moving);
    }
  });

  it('never steals the body from a licensed attack approach', () => {
    const p = defender(2); p.licenseApproach('attack', 1);
    expect(new SpriteTimeline().frameFor(p, 0).action).toBe('approach');
  });
});
