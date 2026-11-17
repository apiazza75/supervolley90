import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { captureReplayPlayer, interpolateReplay, INTRO, Replay, type ReplayFrame } from '../src/game/replay';
import { Camera } from '../src/render/camera';
import { drawSpritePlayer, playerSpriteDiagnostics } from '../src/render/sprite-figure';
import { SHEETS, type Sheet } from '../src/render/sprites';

function frame(x: number, pose = 24): ReplayFrame {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
  p.pos.x = x; p.height = x * .2;
  return { ball: { x, y: 0, z: 1 + x, roll: x * 2 },
    players: [captureReplayPlayer(p, { action: 'run', frame: pose, facing: -1 })] };
}

describe('timestamped replay of the actual painted view', () => {
  it.each([30, 59.94, 60, 75, 120, 144])('has continuous positions at %s Hz, independent of recording intervals', hz => {
    const r = new Replay();
    let t = 0;
    for (let i = 0; t < 1.5; i++) {
      const dt = [.017, .009, .021, .013][i % 4];
      t += dt; r.record(frame(t), dt);
    }
    expect(r.start('TEST')).toBe(true);
    const first = r.step(INTRO)!;
    let previous = first.ball.x;
    for (let i = 1; i <= hz; i++) {
      const f = r.step(1 / hz)!;
      expect(f.ball.x - previous).toBeCloseTo(.8 / hz, 10);
      expect(f.players[0].pos.x).toBeCloseTo(first.ball.x + i * .8 / hz, 10);
      expect(f.players[0].height).toBeCloseTo(f.ball.x * .2, 10);
      previous = f.ball.x;
    }
  });

  it('holds the recorded pose until its timestamp, without anticipating contact', () => {
    const a = frame(0, 24), b = frame(.1, 5), snapshot = JSON.stringify([a, b]);
    expect(interpolateReplay(a, b, .99).players[0].sprite.frame).toBe(24);
    expect(interpolateReplay(a, b, 1).players[0].sprite.frame).toBe(5);
    expect(interpolateReplay(a, b, .5).players[0].facing).toBe(-1);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });

  it('does not invent travel across a substitution or point reset', () => {
    expect(interpolateReplay(frame(0), frame(5), .5).players[0].pos.x).toBe(0);
    const b = frame(.1); b.players[0].id = 8;
    expect(interpolateReplay(frame(0), b, .5).players[0].id).toBe(7);
  });

  it('accounts only for the fraction after the intro and freezes on zero dt', () => {
    const r = new Replay();
    for (let i = 0; i <= 100; i++) r.record(frame(i / 100), .01);
    expect(r.start('TEST')).toBe(true);
    expect(r.step(INTRO - .01)!.ball.x).toBe(0);
    const f = r.step(.03)!;
    expect(f.ball.x).toBeCloseTo(.016, 10);
    expect(r.step(0)).toEqual(f);
    expect(r.step(-1)).toEqual(f);
  });

  it('copies source poses, ignores paused recordings, and clears all clocks on stop', () => {
    const r = new Replay(), f = frame(0);
    r.record(f, .01); f.players[0].sprite.frame = 99; f.ball.x = 99;
    for (let i = 1; i <= 100; i++) r.record(frame(i / 100), .01);
    expect(r.start('FIRST')).toBe(true);
    expect(r.step(0)!.players[0].sprite.frame).toBe(24);
    expect(r.step(0)!.ball.x).toBe(0);
    r.stop(); expect(r.age).toBe(0); expect(r.step(1)).toBeNull();
    for (let i = 0; i < 1000; i++) r.record(frame(0), 0);
    expect(r.start('EMPTY')).toBe(false);
    for (let i = 0; i < 50; i++) r.record(frame(0), .01);
    expect(r.start('SHORT')).toBe(false);
  });

  it('keeps only the rolling time window and finishes after its actual duration', () => {
    const r = new Replay();
    for (let i = 0; i < 1000; i++) r.record(frame(i * .01), .01);
    expect(r.start('WINDOW')).toBe(true);
    expect(r.step(0)!.ball.x).toBeGreaterThan(8.3);
    expect(r.step(INTRO + 2.1)).toBeNull();
  });

  it('draws the saved action, frame and facing even when live state says something else', () => {
    const p = new Player(1007, 'home', 'outside', 'TEST', defaultStats());
    p.facing = 1;
    const cam = new Camera(); cam.resize(1280, 720);
    const sheet: Sheet = { canvas: {} as HTMLCanvasElement,
      frames: Array.from({ length: 26 }, () => ({ sx: 0, sy: 0, sw: 512, sh: 512,
        footX: 256, footY: 470, boxTop: 15, boxBottom: 470 })),
      nativeBodyHeight: 480, layout: SHEETS.run, kitHue: 220, variants: new Map() };
    let draws = 0;
    const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage() { draws++; } } as unknown as CanvasRenderingContext2D;
    for (const dt of [0, .016, .1, 1]) {
      expect(drawSpritePlayer(ctx, cam, p, { run: sheet }, dt, {}, undefined, undefined,
        { action: 'run', frame: 24, facing: -1 })).toBe(true);
      expect(playerSpriteDiagnostics().find(d => d.playerId === p.id)).toMatchObject({ action: 'run', frame: 24, facing: -1 });
    }
    expect(draws).toBe(4);
  });
});
