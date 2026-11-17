/** Observe a real AI rally, including a diving SAVE, slide and get-up. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const baseline = process.argv.includes('--baseline');
// Baseline used seed 1. After correcting recovery availability the rallies
// legitimately differ; 4242 is an existing acceptance seed with a low save.
const seed = Number(process.argv.find(s => s.startsWith('--seed='))?.split('=')[1] ?? (baseline ? 1 : 4242));
if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
const out = resolve(process.argv.find(s => s.startsWith('--out='))?.slice(6)
  ?? `artifacts/dive-review/${baseline ? 'baseline' : 'current'}`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  await page.evaluate(seed => {
    (globalThis as any).__name = (fn: unknown) => fn;
    (window as any).__sv90.startDemoMatch(seed);
  }, seed);
  const result = await page.evaluate(async () => {
    const g = (window as any).__sv90, render = (window as any).__sv90render;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const tracks = new Map<number, any>(), rejected: any[] = [];
    const start = performance.now();
    let complete: any = null;
    while (performance.now() - start < 90000 && !complete) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const w = g.world, sprites = render.sprites();
      for (const p of w.allPlayers()) {
        let track = tracks.get(p.id);
        if (!track && p.diving && p.animTime < .08) {
          track = { playerId: p.id, samples: [], all: [], seenAir: false, seenSlide: false,
            seenGetUp: false, sinceSeq: w.eventSeq - w.lastEvents.length, match: '' };
          tracks.set(p.id, track);
        }
        if (!track) continue;
        const sprite = sprites.find((s: any) => s.playerId === p.id);
        const s = { t: (performance.now() - start) / 1000, frame: sprite?.frame, action: sprite?.action,
          phase: p.presentation.phase, anim: p.anim, animTime: p.animTime, x: p.pos.x, y: p.pos.y,
          height: p.height, vertVel: p.vertVel, diving: p.diving, downTime: p.downTime,
          gettingUp: p.gettingUp, sliding: p.sliding, canAct: p.canAct,
          speed: Math.hypot(p.vel.x, p.vel.y), ball: { ...w.ball.pos } };
        track.all.push(s);
        if (p.diving && p.height > 0) track.seenAir = true;
        if (track.seenAir && p.height === 0 && p.sliding > 0) track.seenSlide = true;
        if (track.seenSlide && p.gettingUp > 0) track.seenGetUp = true;
        const key = `${s.action}/${s.frame}/${s.anim}`;
        if (key !== track.lastKey) {
          const floor = g.renderer.camera.projectFloor(p.pos.x, p.pos.y);
          const crop = document.createElement('canvas'); crop.width = 320; crop.height = 250;
          const left = Math.max(0, Math.min(960, floor.x - 160));
          const top = Math.max(0, Math.min(470, floor.y - 220));
          const k = canvas.width / 1280;
          crop.getContext('2d')!.drawImage(canvas, left * k, top * k, 320 * k, 250 * k, 0, 0, 320, 250);
          track.samples.push({ ...s, crop }); track.lastKey = key;
        }
        const events = w.recentEvents.filter((r: any) => r.seq > track.sinceSeq && r.event.playerId === p.id)
          .map((r: any) => r.event);
        const save = events.some((e: any) => e.type === 'contact' && e.kind === 'save');
        if (save && !track.match) track.match = canvas.toDataURL();
        if (track.seenGetUp && p.gettingUp <= 0 && p.downTime <= 0 && !p.diving) {
          track.events = events;
          if (save && track.samples.length >= 8) complete = track;
          else rejected.push({ playerId: p.id, reason: save ? 'too few captured poses' : 'dive attempt without a save' });
          tracks.delete(p.id);
        }
      }
    }
    if (!complete) return { complete: false, rejected, reason: 'No complete save/slide/get-up observed in 90 seconds' };
    const samples = complete.samples;
    const chosen = Array.from({ length: Math.min(12, samples.length) }, (_, i) =>
      samples[Math.round(i * (samples.length - 1) / (Math.min(12, samples.length) - 1))]);
    const sheet = document.createElement('canvas'); sheet.width = 1000; sheet.height = 1230;
    const c = sheet.getContext('2d')!; c.fillStyle = '#12212a'; c.fillRect(0, 0, 1000, 1230);
    c.fillStyle = '#e9eff2'; c.font = '18px monospace'; c.fillText('Diving save — real rally, no assigned poses', 14, 28);
    chosen.forEach((s, i) => {
      const x = i % 3 * 330 + 10, y = Math.floor(i / 3) * 295 + 48;
      c.drawImage(s.crop, x, y); c.fillStyle = '#e9eff2'; c.font = '13px monospace';
      c.fillText(`${s.action} ${s.frame} ${s.anim}`, x, y + 266);
      c.fillText(`h=${s.height.toFixed(2)} v=${s.speed.toFixed(2)} ${s.phase}`, x, y + 283);
    });
    return { complete: true, playerId: complete.playerId, events: complete.events, rejected,
      all: complete.all, samples: samples.map(({ crop: _crop, ...s }: any) => s),
      png: sheet.toDataURL(), match: complete.match };
  });
  const { png, match, ...metrics } = result as any;
  if (png) writeFileSync(resolve(out, 'sequence.png'), Buffer.from(png.split(',')[1], 'base64'));
  if (match) writeFileSync(resolve(out, 'match.png'), Buffer.from(match.split(',')[1], 'base64'));
  writeFileSync(resolve(out, 'metrics.json'), JSON.stringify({ seed, ...metrics, errors }, null, 2));
  console.log(JSON.stringify({ seed, complete: metrics.complete, playerId: metrics.playerId,
    frames: [...new Set(metrics.samples?.filter((s: any) => s.action === 'dive').map((s: any) => s.frame) ?? [])],
    events: metrics.events, rejected: metrics.rejected, errors }));
  if (!metrics.complete || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
