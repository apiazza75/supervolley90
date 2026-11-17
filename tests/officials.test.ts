import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL_ATLAS, OFFICIAL_LAYOUT, Officials } from '../src/render/officials';
import type { Camera } from '../src/render/camera';

afterEach(() => vi.unstubAllGlobals());

describe('illustrated officials', () => {
  it('selects the serve and point illustrations and returns to the seated idle pose', () => {
    const o = new Officials();
    o.authoriseServe('home');
    expect(o.snapshotForDiagnostics().referee.frame).toBe(OFFICIAL_ATLAS.frames.refereeServe);
    o.update(1.2);
    expect(o.snapshotForDiagnostics().referee.frame).toBe(OFFICIAL_ATLAS.frames.refereeIdle);
    o.callPoint('home');
    expect(o.snapshotForDiagnostics().referee.frame).toBe(OFFICIAL_ATLAS.frames.refereePointHome);
    o.callPoint('away');
    expect(o.snapshotForDiagnostics().referee.frame).toBe(OFFICIAL_ATLAS.frames.refereePointAway);
    o.update(2.3);
    expect(o.snapshotForDiagnostics().referee.frame).toBe(OFFICIAL_ATLAS.frames.refereeIdle);
  });

  it('uses the nearest corner judge and the actual in/out/touch illustration', () => {
    const o = new Officials();
    const near = OFFICIAL_LAYOUT.lineJudges[0];
    o.callLine(near.x, near.y, true);
    expect(o.snapshotForDiagnostics().lineJudges.judges.map(j => j.frame)).toEqual([5, 4]);
    o.callLine(near.x, near.y, false);
    expect(o.snapshotForDiagnostics().lineJudges.judges.map(j => j.frame)).toEqual([6, 4]);
    o.callTouch(near.x, near.y);
    expect(o.snapshotForDiagnostics().lineJudges.judges.map(j => j.frame)).toEqual([7, 4]);
    o.update(.5);
    expect(o.snapshotForDiagnostics().lineJudges.judges[0].holdingSignal).toBe(true);
    o.update(2);
    expect(o.snapshotForDiagnostics().lineJudges.judges.map(j => j.frame)).toEqual([4, 4]);
    expect(o.snapshotForDiagnostics().lineJudges.diagonalCorners).toBe(true);
    expect(o.ballKids).toHaveLength(0);
  });

  it('draws the whole seated referee and chair at one undistorted scale, without primitive overlays', async () => {
    class LoadedImage {
      naturalWidth = 1536;
      naturalHeight = 1024;
      onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', LoadedImage);
    const o = new Officials();
    await Promise.resolve();
    const drawImage = vi.fn();
    // No primitive paint methods: any reconstructed chair/limb would throw.
    const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage } as unknown as CanvasRenderingContext2D;
    const cam = { projectFloor: () => ({ x: 100, y: 200, scale: 1 }) } as unknown as Camera;
    o.drawFar(ctx, cam);
    expect(drawImage).toHaveBeenCalledTimes(2);
    const [, sx, sy, sw, sh, , , dw, dh] = drawImage.mock.calls[0];
    expect([sx, sy, sw, sh]).toEqual([0, 0, 384, 512]);
    expect(dw / dh).toBeCloseTo(384 / 512);
    expect(o.snapshotForDiagnostics().referee.rasterDraws).toBe(1);
    expect(o.snapshotForDiagnostics().atlas.loaded).toBe(true);
  });

  it('keeps missing official art visible to diagnostics and draws no substitute people', () => {
    const o = new Officials();
    const drawImage = vi.fn();
    o.drawFar({ drawImage } as unknown as CanvasRenderingContext2D, {} as Camera);
    expect(drawImage).not.toHaveBeenCalled();
    expect(o.snapshotForDiagnostics().atlas.loaded).toBe(false);
    expect(o.snapshotForDiagnostics().referee.rasterDraws).toBe(0);
  });
});
