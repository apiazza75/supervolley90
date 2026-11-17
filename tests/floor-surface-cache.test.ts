import { afterEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../src/render/camera';
import { FloorSurfaceCache, floorSurfaceBounds, floorSurfacePlacement } from '../src/render/floor-surface-cache';

afterEach(() => vi.unstubAllGlobals());

describe('projected floor surface cache', () => {
  it('has room for both service zones and the outermost plank', () => {
    const camera = new Camera(), bounds = floorSurfaceBounds(camera, 6.3, 18);
    for (const x of [-6.3, 6.3]) for (const y of [-18, 18]) {
      const p = camera.projectFloor(x, y);
      expect(p.x).toBeGreaterThan(bounds.x + 7);
      expect(p.x).toBeLessThan(bounds.x + bounds.width - 7);
      expect(p.y).toBeGreaterThan(bounds.y + 7);
      expect(p.y).toBeLessThan(bounds.y + bounds.height - 7);
    }
  });

  it('keeps every floor point aligned with the live camera through pan, zoom and shake', () => {
    const reference = new Camera(), current = new Camera();
    const bounds = floorSurfaceBounds(reference, 6.3, 18);
    current.addShake(12);
    for (let i = 0; i < 80; i++) {
      current.follow({ x: 0, y: Math.sin(i / 10) * 13, z: 2 }, 1 / 60,
        i < 25 ? { x: 3.5, y: -12.5, z: 0 } : undefined);
      const placement = floorSurfacePlacement(reference, current, bounds);
      for (const x of [-6.3, -4.5, 0, 4.5, 6.3]) for (const y of [-18, -9, -3, 0, 3, 9, 18]) {
        const p = reference.projectFloor(x, y), actual = current.projectFloor(x, y);
        expect(placement.x + (p.x - bounds.x) * placement.scale).toBeCloseTo(actual.x, 8);
        expect(placement.y + (p.y - bounds.y) * placement.scale).toBeCloseTo(actual.y, 8);
      }
    }
  });

  function environment(available = true) {
    const raster = { setTransform: vi.fn() };
    const canvases: { width: number; height: number; getContext: () => typeof raster | null }[] = [];
    vi.stubGlobal('document', { createElement: vi.fn(() => {
      const canvas = { width: 0, height: 0, getContext: () => available ? raster : null };
      canvases.push(canvas); return canvas;
    }) });
    const ctx = { getTransform: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1 })), drawImage: vi.fn() };
    return { ctx, canvasContext: ctx as unknown as CanvasRenderingContext2D, canvases, raster };
  }

  it('composes the complete base once and reuses it while the camera moves', () => {
    const env = environment(), cache = new FloorSurfaceCache(), camera = new Camera(), paint = vi.fn();
    for (let i = 0; i < 90; i++) {
      camera.follow({ x: 0, y: 8, z: 2 }, 1 / 60);
      expect(cache.draw(env.canvasContext, camera, 6.3, 18, true, paint)).toBe(true);
    }
    expect(paint).toHaveBeenCalledTimes(1);
    expect(cache.diagnostics).toEqual({ generations: 1, draws: 90 });
    expect(env.ctx.drawImage).toHaveBeenCalledTimes(90);
    const sourceRects = env.ctx.drawImage.mock.calls.map(call => call.slice(0, 5));
    expect(sourceRects.every(rect => rect.every((value, i) => value === sourceRects[0][i]))).toBe(true);
  });

  it('prepares once offscreen during the menu and reuses it on the first match draw', () => {
    const env = environment(), cache = new FloorSurfaceCache(), camera = new Camera(), paint = vi.fn();
    for (let i = 0; i < 60; i++) {
      expect(cache.prepare(env.canvasContext, camera, 6.3, 18, true, paint)).toBe(true);
    }
    expect(paint).toHaveBeenCalledTimes(1);
    expect(env.ctx.drawImage).not.toHaveBeenCalled();
    expect(cache.diagnostics).toEqual({ generations: 1, draws: 0 });
    expect(cache.draw(env.canvasContext, camera, 6.3, 18, true, paint)).toBe(true);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(cache.diagnostics).toEqual({ generations: 1, draws: 1 });
  });

  it('waits for complete art when preparing and refreshes density before entry', () => {
    const env = environment(), cache = new FloorSurfaceCache(), camera = new Camera(), paint = vi.fn();
    expect(cache.prepare(env.canvasContext, camera, 6.3, 18, false, paint)).toBe(false);
    expect(env.canvases).toHaveLength(0);
    cache.prepare(env.canvasContext, camera, 6.3, 18, true, paint);
    env.ctx.getTransform.mockReturnValue({ a: 2, b: 0, c: 0, d: 2 });
    cache.prepare(env.canvasContext, camera, 6.3, 18, true, paint);
    cache.draw(env.canvasContext, camera, 6.3, 18, true, paint);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(cache.diagnostics).toEqual({ generations: 2, draws: 1 });
  });

  it('rebuilds for Retina, viewport and surface changes, never for an individual camera pan', () => {
    const env = environment(), cache = new FloorSurfaceCache(), camera = new Camera(), paint = vi.fn();
    cache.draw(env.canvasContext, camera, 6.3, 18, true, paint);
    const firstWidth = env.canvases[0].width;
    env.ctx.getTransform.mockReturnValue({ a: 2, b: 0, c: 0, d: 2 });
    cache.draw(env.canvasContext, camera, 6.3, 18, true, paint);
    expect(env.canvases[1].width).toBeGreaterThan(firstWidth);
    expect(env.canvases[1].width).toBeGreaterThanOrEqual(floorSurfaceBounds(camera, 6.3, 18).width * 2);
    camera.resize(1600, 900);
    cache.draw(env.canvasContext, camera, 6.3, 18, true, paint);
    cache.draw(env.canvasContext, camera, 7, 18, true, paint);
    expect(paint).toHaveBeenCalledTimes(4);
  });

  it('does not cache incomplete artwork and lets the normal renderer handle unavailable canvases', () => {
    const env = environment(false), cache = new FloorSurfaceCache(), camera = new Camera(), paint = vi.fn();
    expect(cache.draw(env.canvasContext, camera, 6.3, 18, false, paint)).toBe(false);
    expect(env.canvases).toHaveLength(0);
    expect(cache.draw(env.canvasContext, camera, 6.3, 18, true, paint)).toBe(false);
    expect(paint).not.toHaveBeenCalled();
    expect(env.ctx.drawImage).not.toHaveBeenCalled();
    expect(cache.diagnostics).toEqual({ generations: 0, draws: 0 });
  });
});
