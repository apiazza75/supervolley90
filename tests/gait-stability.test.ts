import { describe, expect, it, vi } from 'vitest';
import * as presentation from '../src/core/presentation';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { groundGait, RUN_GAIT_CONFIRMATION, RUN_SPEED_THRESHOLD, type Locomotion } from '../src/core/presentation';
import { Player, defaultStats } from '../src/core/player';
import { SpriteTimeline } from '../src/render/sprite-figure';

describe('stable presentation gait', () => {
  it.each(['home','away'] as const)('keeps fast %s lateral coverage in the lateral drawings without hiding forward runs', side => {
    const p=new Player(7,side,'outside','TEST',defaultStats()),clock=new SpriteTimeline();
    const net=side==='home'?1:-1;p.facing=net;p.presentation.sourceJob='cover';
    p.presentation.locomotion='run';p.anim='run';p.vel.x=3.25;p.vel.y=-net*.88;
    p.locomotionIntent={x:.53,y:-net*.143};
    expect(clock.actionFor(p)).toBe('shuffle');
    p.vel.x=.2;p.vel.y=net*3.25;p.locomotionIntent={x:.03,y:net*.53};
    expect(clock.actionFor(p)).toBe('run');
    p.presentation.sourceJob='set';p.vel.x=3.25;p.vel.y=0;p.locomotionIntent={x:.53,y:0};
    expect(clock.actionFor(p)).toBe('run');
    p.licenseApproach('attack');expect(clock.frameFor(p,.01).action).toBe('approach');
  });

  it('does not flash a running drawing for a one-tick speed spike', () => {
    const spike = groundGait(2.8, 'shuffle', 0, 1 / 120, false);
    expect(spike.locomotion).toBe('shuffle');
    const settle = groundGait(2.1, spike.locomotion, spike.runAge, 1 / 120, false);
    expect(settle).toEqual({ locomotion: 'shuffle', runAge: 0 });
  });

  it('enters running promptly for sustained travel, independent of tick size', () => {
    for (const dt of [1 / 240, 1 / 120, 1 / 60]) {
      let loco: Locomotion = 'shuffle', age = 0, elapsed = 0;
      while (loco !== 'run' && elapsed < 1) {
        const next = groundGait(2.8, loco, age, dt, false);
        loco = next.locomotion; age = next.runAge; elapsed += dt;
      }
      expect(loco).toBe('run');
      expect(elapsed).toBeGreaterThanOrEqual(RUN_GAIT_CONFIRMATION - 1e-9);
      expect(elapsed).toBeLessThan(RUN_GAIT_CONFIRMATION + dt + 1e-9);
    }
  });

  it('does not delay the running drawing once the speed is unambiguously high', () => {
    expect(groundGait(3.3, 'shuffle', 0, 1 / 120, false)).toEqual({ locomotion: 'run', runAge: 0 });
  });

  it('does not chatter between run and shuffle around the old threshold', () => {
    let loco: Locomotion = 'run', age = 0;
    for (const speed of [2.34, 2.37, 2.32, 2.40, 2.22, 2.36]) {
      const next = groundGait(speed, loco, age, 1 / 120, false);
      expect(next.locomotion).toBe('run');
      loco = next.locomotion; age = next.runAge;
    }
    const slow = groundGait(2.0, loco, age, 1 / 120, false);
    expect(slow.locomotion).toBe('shuffle');
    expect(groundGait(RUN_SPEED_THRESHOLD + .05, slow.locomotion, 0, 1, false).locomotion).toBe('shuffle');
  });

  it('stops or walks immediately when the body actually slows, without a minimum run hold', () => {
    expect(groundGait(0, 'run', .04, 1 / 120, false)).toEqual({ locomotion: 'ready', runAge: 0 });
    expect(groundGait(.4, 'run', .04, 1 / 120, false)).toEqual({ locomotion: 'walk', runAge: 0 });
  });

  it('does not defer an explicitly licensed attack approach', () => {
    expect(groundGait(3, 'shuffle', 0, 1 / 120, true)).toEqual({ locomotion: 'approach', runAge: 0 });
    expect(groundGait(0, 'approach', .04, 1 / 120, true)).toEqual({ locomotion: 'ready', runAge: 0 });
  });

  it('preserves the authored stride phase when the stabilized gait changes', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    p.presentation.locomotion = 'shuffle'; p.anim = 'shuffle'; p.vel.y = 2;
    clock.frameFor(p, 0); const before = clock.frameFor(p, .23);
    p.presentation.locomotion = 'run'; p.anim = 'run'; p.vel.y = 3.2;
    expect(clock.frameFor(p, 0).frame).toBe(before.frame);
    p.presentation.locomotion = 'shuffle'; p.anim = 'shuffle'; p.vel.y = 2;
    expect(clock.frameFor(p, 0).frame).toBe(before.frame);
  });

  it('leaves the same seeded rally physics unchanged', () => {
    const simulate = () => {
      const world = new World({ home: TEAMS[0], away: TEAMS[1], seed: 4242,
        difficulty: 1, humanControlsHome: false });
      const physicalStates: unknown[] = [];
      for (let i = 0; i < 3600; i++) {
        world.step(null);
        if (i % 12 !== 0) continue;
        physicalStates.push({ phase: world.phase,
          ball: { pos: { ...world.ball.pos }, vel: { ...world.ball.vel } },
          players: world.allPlayers().map(p => ({ id: p.id, pos: { ...p.pos }, vel: { ...p.vel },
            height: p.height, vertVel: p.vertVel, rotationSlot: p.rotationSlot })) });
      }
      return physicalStates;
    };
    const legacy = vi.spyOn(presentation, 'groundGait').mockImplementation(speedAndApproach);
    let before: unknown[];
    try { before = simulate(); } finally { legacy.mockRestore(); }
    expect(simulate()).toEqual(before);
  });
});

/** The pre-fix presentation thresholds, used only for physical equivalence. */
function speedAndApproach(speed: number, _previous: Locomotion, _age: number, _dt: number, approaching: boolean) {
  const locomotion: Locomotion = approaching && speed > .8 ? 'approach'
    : speed < .12 ? 'ready' : speed < .8 ? 'walk' : speed >= 2.35 ? 'run' : 'shuffle';
  return { locomotion, runAge: 0 };
}
