import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { FIXED_DT } from '../src/core/rules';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline, SPIKE_FOLLOW_AIR_FRAMES, SPIKE_FOLLOW_LANDING_FRAMES } from '../src/render/sprite-figure';

function scene() {
  return new World({ home: TEAMS[0], away: TEAMS[1], seed: 1337, difficulty: 1, humanControlsHome: false });
}

describe('authored spike follow-through', () => {
  it('plays all 27 accepted follow drawings in authored order after a real AI spike without modifying physics', () => {
    const world = scene(), clock = new SpriteTimeline();
    let id: number | undefined, last = -1, finished = false;
    const visited = new Set<number>();
    const order = [...SPIKE_FOLLOW_AIR_FRAMES,...SPIKE_FOLLOW_LANDING_FRAMES];
    for (let i = 0; i < 10000; i++) {
      world.step(idleCommand());
      let justHit = false;
      for (const event of world.drainEvents()) if (event.type === 'contact' && event.kind === 'spike' && id === undefined) {
        id = event.playerId; justHit = true;
        clock.cue(id, event.kind, event.airborne, event.facing);
      }
      if (id === undefined) continue;
      const p = world.findPlayer(id)!;
      const physical = () => JSON.stringify({ pos: p.pos, vel: p.vel, height: p.height, vertVel: p.vertVel, ball: world.ball.pos });
      const before = physical(), sample = clock.frameFor(p, FIXED_DT);
      expect(physical()).toBe(before);
      if (justHit) expect(sample).toMatchObject({ action: 'spike', frame: 18 });
      else if (sample.action === 'spikeFollow' && sample.frame < 28) {
        const index = order.indexOf(sample.frame as typeof order[number]);
        expect(index).toBeGreaterThanOrEqual(last);
        expect(index - last).toBeLessThanOrEqual(1);
        // airborne uses a 2 cm rule tolerance, not the visible floor.
        expect((SPIKE_FOLLOW_LANDING_FRAMES as readonly number[]).includes(sample.frame)).toBe(p.height <= 0.001);
        visited.add(sample.frame); last = index;
      } else if (visited.size) {
        // The same atlas now also holds a separately tested grounded departure.
        if (sample.action === 'spikeFollow') expect(sample.frame).toBe(28);
        finished = true; break;
      }
    }
    expect(id).toBeDefined(); expect(finished).toBe(true);
    expect([...visited]).toEqual(order);
  });

  it.each([['spike', -1], ['spike', 1], ['power', -1], ['power', 1]] as const)(
    'keeps %s contact facing %i through flight and landing', (kind, facing) => {
      const p = scene().home.players[0], clock = new SpriteTimeline();
      p.height = 1.2; p.vertVel = 1; p.setAnim('air_contact_spike');
      clock.cue(p.id, kind, true, facing);
      expect(clock.frameFor(p, 0)).toMatchObject({ action: 'spike', frame: 18, facing });
      p.facing = -facing;
      expect(clock.frameFor(p, FIXED_DT)).toMatchObject({ action: 'spikeFollow', frame: 0, facing });
      expect(clock.frameFor(p, 0.2)).toMatchObject({ action: 'spikeFollow', frame: 0, facing });
      p.height = 0; p.vertVel = 0; p.setAnim('land'); p.facing = -facing;
      expect(clock.frameFor(p, FIXED_DT)).toMatchObject({ action: 'spikeFollow', frame: 17, facing });
      expect(p.facing).toBe(-facing);
    });
});
