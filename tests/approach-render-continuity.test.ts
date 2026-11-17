import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { FIXED_DT, attackDir } from '../src/core/rules';
import { Renderer } from '../src/render/renderer';
import { SpriteTimeline, approachFrameForPlayer } from '../src/render/sprite-figure';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

const renderer = Object.create(Renderer.prototype) as Renderer;
const project = (p: Player, lead: number): Player => (renderer as any).viewPlayer(p, lead);

describe('attack approach render continuity', () => {
  it.each(['home', 'away'] as const)('does not mirror a %s hitter away from the net during target corrections', side => {
    const p = new Player(7, side, 'outside', 'TEST', defaultStats());
    const clock = new SpriteTimeline();
    p.presentation.sourceJob = 'attack';
    p.facing = attackDir(side);
    clock.frameFor(p, FIXED_DT);
    p.licenseApproach('attack', 1, .49);
    for (let i = 0; i < 48; i++) {
      p.approachAge = i * FIXED_DT;
      p.facing = i % 2 ? 1 : -1;
      const before = JSON.stringify(p);
      expect(clock.frameFor(p, FIXED_DT)).toMatchObject({ action: 'approach', facing: attackDir(side) });
      expect(JSON.stringify(p)).toBe(before);
    }
    p.setAnim('plant');
    expect(approachFrameForPlayer(p).facing).toBe(attackDir(side));
    p.jump();
    expect(clock.frameFor(p, 0).action).toBe('spike');
  });

  it('advances the run-up and gather drawings on the same fractional clock as the body', () => {
    const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
    p.licenseApproach('attack', 1, .49);
    p.approachAge = .23;
    p.vel.y = 2;
    const snapshot = JSON.stringify(p), lead = FIXED_DT * .7;
    const view = project(p, lead);
    expect(view.approachAge).toBeCloseTo(p.approachAge + lead, 12);
    expect(view.pos.y).toBeCloseTo(p.pos.y + p.vel.y * lead, 12);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(project(p, 0)).toBe(p);
    p.cancelApproach(); p.setAnim('plant'); p.animTime = .04;
    expect(project(p, lead).animTime).toBeCloseTo(.04 + lead, 12);
    expect(p.animTime).toBe(.04);
  });

  it('keeps complete natural approaches facing the net without changing a simulation tick', () => {
    const config = { home: TEAMS[0], away: TEAMS[1], seed: 1337, difficulty: 1, humanControlsHome: false };
    const w = new World(config), untouched = new World(config), clock = new SpriteTimeline();
    const observed = new Map<number, number>(), finished = new Set<number>();
    for (let tick = 0; tick < 6000 && finished.size < 2; tick++) {
      w.step(null); untouched.step(null);
      const events = w.drainEvents(); expect(events).toEqual(untouched.drainEvents());
      for (const e of events) if (e.type === 'contact') clock.cue(e.playerId, e.kind, e.airborne, e.facing, e.backSet);
      for (const p of w.allPlayers()) {
        const pose = clock.frameFor(project(p, FIXED_DT * .7), FIXED_DT);
        if (p.height === 0 && !p.landingPlant && p.presentation.sourceJob === 'attack' && (p.approaching || p.anim === 'plant')) {
          observed.set(p.id, (observed.get(p.id) ?? 0) + 1);
          expect(pose.action).toBe('approach');expect(pose.facing).toBe(attackDir(p.side));
          expect(clock.frameFor(project(p, FIXED_DT * .7), 0)).toEqual(pose);
        } else if (p.height > 0 && observed.has(p.id)) finished.add(p.id);
      }
      expect(w.ball).toEqual(untouched.ball);expect(w.allPlayers()).toEqual(untouched.allPlayers());
    }
    expect(finished.size).toBe(2);
    for(const id of finished)expect(observed.get(id)).toBeGreaterThan(10);
  });
});
