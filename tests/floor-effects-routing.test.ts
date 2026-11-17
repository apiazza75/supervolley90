import { describe, expect, it, vi } from 'vitest';
import { BALL_RADIUS } from '../src/core/rules';
import type { GameEvent, World } from '../src/core/world';
import type { ContactKind } from '../src/core/contact';
import { Renderer } from '../src/render/renderer';
import { Effects } from '../src/render/fx';
import { Camera } from '../src/render/camera';
import { POWER_FLOOR_SCAR_STYLE } from '../src/render/volleyball';

function fixture() {
  const effects = new Effects();
  const renderer: Renderer = Object.assign(Object.create(Renderer.prototype), {
    camera: new Camera(), effects, sheets: {}, hitStop: 0, callIndex: 0,
    powerBallActive: false, powerTrail: 0, rand: () => .5,
    arena: { cheer: vi.fn() }, officials: { callPoint: vi.fn(), callLine: vi.fn(), callTouch: vi.fn() },
  });
  const world = { findPlayer: () => undefined, ball: { pos: { x: 0, y: 3, z: 0 } },
    team: () => ({ config: { colors: ['#286adc', '#e3e5df'] } }) } as unknown as World;
  const send = (...events: GameEvent[]) => renderer.handleEvents(world, events);
  const contact = (kind: ContactKind): GameEvent => ({ type: 'contact', kind,
    playerId: 7, side: 'home', speed: 29, at: { x: 0, y: -1, z: 3 },
    height: 1, airborne: true, facing: 1 });
  const bounce = (z = BALL_RADIUS): GameEvent => ({ type: 'bounce', at: { x: 2, y: 4, z }, speed: 32 });
  return { effects, renderer, send, contact, bounce };
}

describe('floor effects follow physical landing, not airborne hand contacts', () => {
  it('keeps a dive save free of opaque floor debris', () => {
    const f = fixture(); f.send(f.contact('save'));
    const snapshot = f.effects.snapshotForDiagnostics();
    expect(snapshot.particles.some(p => p.kind === 'spark')).toBe(true);
    expect(snapshot.particles.some(p => p.kind === 'dust')).toBe(false);
    expect(snapshot.particles.some(p => p.kind === 'shock')).toBe(false);
    expect(snapshot.cracks).toHaveLength(0);
  });

  it('delays the powered floor scar until the ball actually lands', () => {
    const f = fixture(); f.send(f.contact('power'));
    expect(f.effects.snapshotForDiagnostics().cracks).toHaveLength(0);
    expect(f.effects.snapshotForDiagnostics().particles.some(p => p.kind === 'dust')).toBe(false);
    f.send(f.bounce());
    expect(f.effects.snapshotForDiagnostics().cracks).toMatchObject([{ strokeColor: POWER_FLOOR_SCAR_STYLE.stroke }]);
    expect((f.effects as any).cracks[0].pos).toEqual({ x: 2, y: 4, z: 0 });
    expect((f.renderer as any).powerBallActive).toBe(false);
  });

  it.each(['block', 'save', 'bump', 'set', 'serve'] as const)('ends the powered flight on %s', kind => {
    const f = fixture(); f.send(f.contact('power'), f.contact(kind), f.bounce());
    expect(f.effects.snapshotForDiagnostics().cracks[0].strokeColor).not.toBe(POWER_FLOOR_SCAR_STYLE.stroke);
    expect((f.renderer as any).powerTrail).toBe(0);
  });

  it.each([.5, 2.5, 5])('does not treat an out/antenna event at height %s as a floor collision', z => {
    const f = fixture(); f.send(f.contact('power'), f.bounce(z));
    expect(f.effects.snapshotForDiagnostics().cracks).toHaveLength(0);
    expect(f.effects.snapshotForDiagnostics().particles.some(p => p.kind === 'dust')).toBe(false);
    expect((f.renderer as any).powerBallActive).toBe(false);
  });

  it('clears pending power after a point without a bounce', () => {
    const f = fixture(); f.send(f.contact('power'), { type: 'point', side: 'away', reason: 'out', rallyLength: 4 }, f.bounce());
    expect(f.effects.snapshotForDiagnostics().cracks[0].strokeColor).not.toBe(POWER_FLOOR_SCAR_STYLE.stroke);
  });

  it.each([0, 16, 50, 1000])('limits floor debris at intensity %s to a small, short-lived accent', amount => {
    const fx = new Effects(); fx.dust({ x: 2, y: 4, z: 3 }, amount, () => .999);
    const particles = (fx as any).particles;
    expect(particles.length).toBeLessThanOrEqual(12);
    for (const p of particles) {
      expect(p.size).toBeLessThanOrEqual(1.6);
      expect(p.life).toBeLessThanOrEqual(.38);
      expect(p.pos.z).toBe(.03);
      expect(p.vel.z).toBeLessThan(.48);
    }
    fx.update(.4);
    expect(fx.snapshotForDiagnostics().particles).toHaveLength(0);
  });
});
