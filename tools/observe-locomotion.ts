import type { Page } from 'playwright';
import { RUN_STRIDE_FRAMES } from '../src/render/run-stride';

/** Observe an uninterrupted cycle from ONE live player. Never writes a pose. */
export async function observeLocomotion(page: Page, locomotion: 'walk' | 'shuffle' | 'run', title: string, timeoutMs = 45000): Promise<Record<string, any>> {
  await page.evaluate(() => { (globalThis as any).__name = (fn: unknown) => fn; });
  const order: readonly number[] = locomotion === 'run' ? RUN_STRIDE_FRAMES : Array.from({length:24},(_,i)=>i);
  return page.evaluate(async ({ locomotion, title, timeoutMs, order }) => {
    const game = (window as any).__sv90;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const render = (window as any).__sv90render;
    if (!game?.world || !canvas || !render) return { observed: false, error: 'game unavailable' };
    game.qaTimeScale = 1;
    if ((window as any).__qaRelease) (window as any).__qaRelease();
    else game.qaFreeze = false;

    type Sample = { playerId: number; t: number; spriteFrame: number; locomotion: string; action: string;
      speed: number; x: number; y: number; crop: HTMLCanvasElement };
    type Track = { playerId: number; progress: number; distance: number; lastX: number; lastY: number; samples: Sample[] };
    const tracks = new Map<number, Track>();
    let best: Track | undefined;
    let completeCycle = false;
    const start = performance.now();
    while (performance.now() - start < timeoutMs && !completeCycle) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const liveIds = new Set<number>();
      for (const p of game.world.allPlayers()) {
        const speed = Math.hypot(p.vel.x, p.vel.y);
        const sprite = render.sprites().find((s: any) => s.playerId === p.id);
        const eligible = p.presentation.locomotion === locomotion && p.presentation.action === 'none'
          && !p.airborne && !p.diving && sprite?.action === locomotion
          && (locomotion === 'run' ? speed > 2.35 : locomotion === 'walk' ? speed >= .18 && speed < .8 : speed >= .8 && speed <= 2.4);
        if (!eligible) continue;
        liveIds.add(p.id);
        let track = tracks.get(p.id);
        const previous = track?.samples.at(-1);
        const advance = previous ? (order.indexOf(sprite.frame) - order.indexOf(previous.spriteFrame) + order.length) % order.length : 0;
        if (!track || advance > 4) {
          track = { playerId: p.id, progress: 0, distance: 0, lastX: p.pos.x, lastY: p.pos.y, samples: [] };
          tracks.set(p.id, track);
        }
        track.distance += Math.hypot(p.pos.x - track.lastX, p.pos.y - track.lastY);
        track.lastX = p.pos.x; track.lastY = p.pos.y;
        if (track.samples.length && advance === 0) continue;
        if (track.samples.length) track.progress += advance;
        const floor = game.renderer.camera.projectFloor(p.pos.x, p.pos.y);
        const crop = document.createElement('canvas'); crop.width = 180; crop.height = 208;
        const c = crop.getContext('2d')!;
        const pixelScale = canvas.width / 1280;
        c.drawImage(canvas, (floor.x - 90) * pixelScale, (floor.y - 183) * pixelScale,
          180 * pixelScale, 208 * pixelScale, 0, 0, 180, 208);
        track.samples.push({ playerId: p.id, t: (performance.now() - start) / 1000,
          spriteFrame: sprite.frame, locomotion, action: sprite.action, speed,
          x: p.pos.x, y: p.pos.y, crop });
        if (!best || track.progress > best.progress) best = { ...track, samples: [...track.samples] };
        if (track.progress >= order.length && new Set(track.samples.map(s => s.spriteFrame)).size === order.length) {
          best = track; completeCycle = true; break;
        }
      }
      // A change of action, gait, roster or speed band ends a continuous take.
      // Never resume it later or substitute a different player into the take.
      for (const id of tracks.keys()) if (!liveIds.has(id)) tracks.delete(id);
    }
    if (!best?.samples.length) return { observed: false, completeCycle: false, error: 'no eligible movement observed' };
    const all = best.samples;
    const selected = Array.from({ length: Math.min(12, all.length) }, (_, i) => all[Math.round(i * (all.length - 1) / (Math.min(12, all.length) - 1 || 1))]);
    const sheet = document.createElement('canvas'); sheet.width = 1536; sheet.height = 1424;
    const c = sheet.getContext('2d')!;
    c.fillStyle = '#0b1220'; c.fillRect(0, 0, sheet.width, sheet.height);
    c.fillStyle = '#e0e6ef'; c.font = 'bold 23px monospace';
    c.fillText(`${title} — player ${best.playerId} — ${completeCycle ? 'complete timeline cycle' : 'INCOMPLETE TAKE'}`, 20, 34);
    c.font = '16px monospace'; c.fillText('Crops from real gameplay. Timeline coverage is not anatomical approval.', 20, 61);
    for (const [i, s] of selected.entries()) {
      const x = 12 + i % 4 * 384, y = 82 + Math.floor(i / 4) * 446;
      // Uniform 2x zoom: a review of proportions must not squash its crops.
      c.drawImage(s.crop, x, y, 360, 416);
      c.fillStyle = '#e0e6ef'; c.font = '16px monospace';
      c.fillText(`id ${s.playerId}  frame ${s.spriteFrame}  t ${(s.t - all[0].t).toFixed(2)}s`, x, y + 435);
    }
    return {
      observed: true, completeCycle, playerId: best.playerId, frames: selected.length,
      matchingSamples: selected.length, maxMatchingSpeed: Math.max(...all.map(s => s.speed)),
      distance: best.distance, displacement: Math.hypot(all.at(-1)!.x - all[0].x, all.at(-1)!.y - all[0].y),
      durationSeconds: all.at(-1)!.t - all[0].t, distinctAnimTicks: new Set(all.map(s => s.spriteFrame)).size,
      visitedFrames: [...new Set(all.map(s => s.spriteFrame))], frameSequence: all.map(s => s.spriteFrame),
      playerIds: [...new Set(all.map(s => s.playerId))], locomotions: [locomotion],
      samples: selected.map(({ crop: _crop, ...s }) => s), dataUrl: sheet.toDataURL('image/png'),
    };
  }, { locomotion, title, timeoutMs, order });
}
