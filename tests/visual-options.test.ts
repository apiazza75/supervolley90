import { afterEach, describe, expect, it, vi } from 'vitest';
import { Arena } from '../src/render/arena';
import { Camera } from '../src/render/camera';
import { CrowdReactions, crowdGestureMotion, crowdSourcePlacement } from '../src/render/crowd-reactions';
import { Effects } from '../src/render/fx';
import { OFFICIAL_LAYOUT, Officials, REFEREE_SIZE_MULTIPLIER } from '../src/render/officials';
import { BALL_STYLES } from '../src/game/teams';
import { drawVolleyball } from '../src/render/volleyball';

afterEach(() => vi.unstubAllGlobals());

function drawingContext() {
  const fills: { color: string; composite: string }[] = [];
  const translations: number[][] = [];
  const images: unknown[][] = [];
  const gradient = { addColorStop() {} };
  const state: Record<string, any> = {
    canvas: { width: 1280, height: 720 }, globalCompositeOperation: 'source-over',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
    createPattern: () => null, createRadialGradient: () => gradient, createLinearGradient: () => gradient,
    fill() { fills.push({ color: state.fillStyle, composite: state.globalCompositeOperation }); },
    fillRect() { fills.push({ color: state.fillStyle, composite: state.globalCompositeOperation }); },
    translate(...at: number[]) { translations.push(at); },
    drawImage(...args: unknown[]) { images.push(args); },
    getImageData() { throw new Error('animated scenery must never read image pixels during play'); },
  };
  const ctx = new Proxy(state, { get: (target, key) => key in target ? target[key as string] : () => {} }) as CanvasRenderingContext2D;
  return { ctx, fills, translations, images };
}

describe('match cosmetics and live crowd', () => {
  it('preserves the selected three ball panels in ordinary and special shots', () => {
    for (const style of BALL_STYLES) {
      const normal = drawingContext(), special = drawingContext();
      drawVolleyball(normal.ctx, 12, .8, { style });
      new Effects().drawPowerBall(special.ctx, 12, .8, false, style);
      for (const color of style.colors) {
        expect(normal.fills.some(fill => fill.color === color)).toBe(true);
        expect(special.fills.some(fill => fill.color === color)).toBe(true);
      }
    }
  });

  it('reduces the complete referee and chair by exactly 10% around the same floor anchor', async () => {
    class LoadedOfficial {
      naturalWidth = 1536; naturalHeight = 1024; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', LoadedOfficial);
    const officials = new Officials(); await Promise.resolve();
    const paint = drawingContext(), camera = new Camera();
    officials.drawFar(paint.ctx, camera);
    const floor = camera.projectFloor(OFFICIAL_LAYOUT.referee.x, OFFICIAL_LAYOUT.referee.y);
    expect(REFEREE_SIZE_MULTIPLIER).toBe(.9);
    expect(paint.translations[0]).toEqual([floor.x, floor.y]);
    const k = 1.9 * 1.76 * .9 * floor.scale * 42 / 460;
    expect(paint.images[0].slice(5)).toEqual([-192 * k, -486 * k, 384 * k, 512 * k]);
    expect((paint.images[0][6] as number) + 486 / 512 * (paint.images[0][8] as number)).toBeCloseTo(0);
  });

  it('keeps crowd accessories at the same authored hand positions when letterboxed or resized', () => {
    const a = crowdSourcePlacement(1280, 720), b = crowdSourcePlacement(1920, 1080);
    expect(b.x).toBeCloseTo(a.x * 1.5); expect(b.y).toBeCloseTo(a.y * 1.5);
    expect(b.scale).toBeCloseTo(a.scale * 1.5);
    // Source's bottom rail is exactly the bottom of the 580px virtual stand.
    expect(a.y + 768 * a.scale).toBeCloseTo(310);
    const handY = a.y + 680 * a.scale;
    expect(handY).toBeGreaterThan(250); expect(handY).toBeLessThan(300);
  });

  it('animates individual fans at rest and reacts smoothly to real point events without readback', () => {
    const crowd = new CrowdReactions(), paint = drawingContext();
    crowd.draw(paint.ctx, 1280, 720, 0);
    const idle = crowdGestureMotion(1, .7, 0);
    expect(crowdGestureMotion(1.5, .7, 0)).not.toEqual(idle);
    crowd.cheer(1, 'home');
    expect(crowd.diagnostics.intensity).toBe(1);
    expect(crowdGestureMotion(1, .7, crowd.diagnostics.intensity).lift).toBeGreaterThan(idle.lift);
    crowd.update(1 / 60); crowd.draw(paint.ctx, 1280, 720, 1);
    expect(crowd.diagnostics.intensity).toBeLessThan(1);
    expect(crowd.diagnostics.intensity).toBeGreaterThan(.98);
    crowd.update(10);
    expect(crowd.diagnostics.intensity).toBeLessThan(.001);
    expect(crowd.diagnostics.draws).toBe(2);
    expect(crowd.diagnostics.movesBackground).toBe(false);
    const close = crowdGestureMotion(1 + 1 / 120, .7, 1), prior = crowdGestureMotion(1, .7, 1);
    expect(Math.abs(close.sway - prior.sway)).toBeLessThan(.3);
    expect(Math.abs(close.lift - prior.lift)).toBeLessThan(.2);
  });

  it('recolors the real floor once per selection and keeps the texture cache through 60 moving frames', () => {
    class LoadedArena {
      complete = true; naturalWidth = 2048; naturalHeight = 768; onload?: () => void;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal('Image', LoadedArena);
    const raster = drawingContext();
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => raster.ctx }) });
    const arena = new Arena(), camera = new Camera(), target = drawingContext();
    arena.setCourtStyle('arctic');
    for (let i = 0; i < 60; i++) {
      arena.setCourtStyle('arctic');
      camera.follow({ x: 0, y: Math.sin(i / 10) * 8, z: 2 }, 1 / 60);
      arena.prepareGround(target.ctx, camera);
    }
    const recolors = () => raster.fills.filter(fill => fill.composite === 'color');
    expect(recolors()).toHaveLength(2);
    expect(arena.courtStyleId).toBe('arctic');
    arena.setCourtStyle('walnut'); arena.prepareGround(target.ctx, camera);
    expect(recolors()).toHaveLength(4);
    arena.setCourtStyle('unknown');
    expect(arena.courtStyleId).toBe('maple');
  });
});
