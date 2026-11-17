import { afterEach, describe, expect, it, vi } from 'vitest';
import { Arena } from '../src/render/arena';
import { Camera } from '../src/render/camera';

afterEach(() => vi.unstubAllGlobals());

function scene(ready = true) {
  class TestImage {
    complete = ready;
    naturalWidth = 2048;
    naturalHeight = 768;
    onload?: () => void;
    set src(_value: string) { if (ready) this.onload?.(); }
  }
  vi.stubGlobal('Image', TestImage);
  const arena = new Arena(), camera = new Camera();
  const prepare = vi.spyOn(arena, 'prepareGround').mockImplementation(() => {});
  const draw = vi.spyOn(arena, 'drawBackground').mockImplementation(() => {});
  const ctx = { canvas: { width: 3456, height: 1944 }, save: vi.fn(), restore: vi.fn() };
  return { arena, camera, prepare, draw, ctx, context: ctx as unknown as CanvasRenderingContext2D };
}

describe('illustrated scenery preparation before the opaque menu', () => {
  it('submits the complete scene once, not just the offscreen floor or every menu frame', () => {
    const s = scene();
    for (let i = 0; i < 120; i++) s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.prepare).toHaveBeenCalledTimes(120);
    expect(s.draw).toHaveBeenCalledTimes(1);
    expect(s.draw).toHaveBeenCalledWith(s.context, s.camera, 0);
    expect(s.ctx.save).toHaveBeenCalledTimes(1);
    expect(s.ctx.restore).toHaveBeenCalledTimes(1);
    expect(s.ctx.save.mock.invocationCallOrder[0]).toBeLessThan(s.draw.mock.invocationCallOrder[0]);
    expect(s.draw.mock.invocationCallOrder[0]).toBeLessThan(s.ctx.restore.mock.invocationCallOrder[0]);
  });

  it('never warms the procedural fallback while illustrated layers are missing', () => {
    const s = scene(false);
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.prepare).toHaveBeenCalledOnce();
    expect(s.draw).not.toHaveBeenCalled();
    expect(s.ctx.save).not.toHaveBeenCalled();
  });

  it('refreshes on backing-store and viewport changes, but not camera motion', () => {
    const s = scene();
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    s.camera.follow({ x: 0, y: 8, z: 2 }, 1 / 60);
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.draw).toHaveBeenCalledTimes(1);
    s.ctx.canvas.width = 3458;
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.draw).toHaveBeenCalledTimes(2);
    s.camera.resize(1600, 900);
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.draw).toHaveBeenCalledTimes(3);
  });

  it('restores context state and retries if the preparation draw fails', () => {
    const s = scene();
    s.draw.mockImplementationOnce(() => { throw new Error('temporary draw failure'); });
    expect(() => s.arena.prepareSceneryForMenu(s.context, s.camera)).toThrow('temporary draw failure');
    expect(s.ctx.restore).toHaveBeenCalledTimes(1);
    s.arena.prepareSceneryForMenu(s.context, s.camera);
    expect(s.draw).toHaveBeenCalledTimes(2);
    expect(s.ctx.restore).toHaveBeenCalledTimes(2);
  });
});
