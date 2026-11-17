/** Capture naturally occurring approach and celebration; no assigned poses. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const out = resolve('artifacts/ready-art-review');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  await page.evaluate(() => {
    (globalThis as any).__name = (fn: unknown) => fn;
    (window as any).__sv90.startDemoMatch(4242);
  });
  const result = await page.evaluate(async () => {
    const g = (window as any).__sv90, render = (window as any).__sv90render;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const tracks = new Map<string, any>(), complete = new Map<string, any>();
    const start = performance.now();
    while (performance.now() - start < 60000 && complete.size < 2) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const w = g.world, sprites = render.sprites();
      for (const p of w.allPlayers()) {
        const sprite = sprites.find((s: any) => s.playerId === p.id);
        for (const action of ['approach', 'celebrate']) {
          if (complete.has(action)) continue;
          const key = `${action}/${p.id}`;
          let track = tracks.get(key);
          if (!track && (action === 'approach'
            ? sprite?.action === 'approach' && p.approachAge < .1
            : p.anim === 'cheer' && p.animTime < .1)) {
            track = { action, playerId: p.id, sinceSeq: w.eventSeq - w.lastEvents.length,
              samples: [], seenPlant: false, seenAir: false, seenContact: false, match: '' };
            tracks.set(key, track);
          }
          if (!track) continue;
          if (p.anim === 'plant') track.seenPlant = true;
          if (p.height > .02) track.seenAir = true;
          const events = w.recentEvents.filter((r: any) => r.seq > track.sinceSeq && r.event.playerId === p.id)
            .map((r: any) => r.event);
          if (events.some((e: any) => e.type === 'contact' && ['spike', 'power'].includes(e.kind))) track.seenContact = true;
          const previous = track.samples.at(-1);
          if (sprite && (!previous || previous.action !== sprite.action || previous.frame !== sprite.frame || previous.anim !== p.anim)) {
            const floor = g.renderer.camera.projectFloor(p.pos.x, p.pos.y);
            const air = g.renderer.camera.project(p.pos.x, p.pos.y, p.height);
            const crop = document.createElement('canvas'); crop.width = 250; crop.height = 290;
            const k = canvas.width / 1280;
            const top = Math.min(floor.y - 260, air.y - 200);
            crop.getContext('2d')!.drawImage(canvas, (floor.x - 125) * k, top * k, 250 * k, 290 * k, 0, 0, 250, 290);
            track.samples.push({ t: (performance.now() - start) / 1000, action: sprite.action,
              frame: sprite.frame, anim: p.anim, animTime: p.animTime, height: p.height,
              approachAge: p.approachAge, distance: p.approachDistance, phase: p.presentation.phase,
              speed: Math.hypot(p.vel.x, p.vel.y), crop });
          }
          const done = action === 'approach' ? track.seenPlant && track.seenAir && track.seenContact
            : p.anim === 'cheer' && p.animTime >= 1.24 && sprite?.action === 'celebrate' && sprite.frame === 23;
          if (done) {
            track.match = canvas.toDataURL(); track.events = events; complete.set(action, track);
          } else if (action === 'celebrate' && p.anim !== 'cheer' || action === 'approach' && !p.approaching && p.height === 0 && p.anim !== 'plant') {
            tracks.delete(key);
          }
        }
      }
    }
    return ['approach', 'celebrate'].map(action => {
      const track = complete.get(action);
      if (!track) return { action, complete: false };
      const samples = track.samples;
      const selected = Array.from({ length: Math.min(12, samples.length) }, (_, i) =>
        samples[Math.round(i * (samples.length - 1) / (Math.min(12, samples.length) - 1))]);
      const sheet = document.createElement('canvas'); sheet.width = 1040; sheet.height = 1050;
      const c = sheet.getContext('2d')!; c.fillStyle = '#15252d'; c.fillRect(0, 0, sheet.width, sheet.height);
      c.fillStyle = '#e9eff2'; c.font = '18px monospace'; c.fillText(`${action} — actual AI rally — player ${track.playerId}`, 12, 26);
      selected.forEach((s, i) => {
        const x = i % 4 * 260 + 5, y = Math.floor(i / 4) * 330 + 40;
        c.drawImage(s.crop, x, y); c.fillStyle = '#e9eff2'; c.font = '13px monospace';
        c.fillText(`${s.action} ${s.frame} ${s.phase}`, x, y + 307);
        c.fillText(`height ${s.height.toFixed(2)}m`, x, y + 323);
      });
      return { action, complete: true, playerId: track.playerId, seenPlant: track.seenPlant,
        seenAir: track.seenAir, seenContact: track.seenContact, events: track.events,
        samples: samples.map(({ crop: _crop, ...s }: any) => s), match: track.match, png: sheet.toDataURL() };
    });
  });
  for (const r of result) {
    const { png, match, ...metrics } = r as any;
    if (png) writeFileSync(resolve(out, `${r.action}.png`), Buffer.from(png.split(',')[1], 'base64'));
    if (match) writeFileSync(resolve(out, `${r.action}-match.png`), Buffer.from(match.split(',')[1], 'base64'));
    writeFileSync(resolve(out, `${r.action}.json`), JSON.stringify({ seed: 4242, ...metrics, errors }, null, 2));
    console.log(JSON.stringify({ action: r.action, complete: r.complete, playerId: metrics.playerId,
      frames: [...new Set(metrics.samples?.filter((s: any) => s.action === r.action).map((s: any) => s.frame))],
      seenPlant: metrics.seenPlant, seenAir: metrics.seenAir, seenContact: metrics.seenContact, errors }));
  }
  if (errors.length || result.some(r => !r.complete)) process.exitCode = 1;
} finally { await browser.close(); }
