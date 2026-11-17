/** Actual-match action capture. Never assigns player poses or ball positions. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--out='));
const actions = args.length ? args : ['block', 'spike'];
if (actions.some(a => !['block', 'spike'].includes(a))) throw new Error('Choose block and/or spike');
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/attack-review');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  await page.evaluate(() => {
    (globalThis as any).__name = (fn: unknown) => fn;
    (window as any).__sv90.startDemoMatch(1337);
  });
  const results = await page.evaluate(async actions => {
    const game = (window as any).__sv90, render = (window as any).__sv90render;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const tracks = new Map<number, any>();
    const completed = new Map<string, any>();
    const start = performance.now();
    while (performance.now() - start < 60000 && completed.size < actions.length) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const sprites = render.sprites();
      for (const p of game.world.allPlayers()) {
        const sprite = sprites.find((s: any) => s.playerId === p.id);
        const preparingBlock = p.blockPreparationAge !== undefined && sprite?.action === 'block';
        const observedAction = preparingBlock ? 'block' : p.presentation.action;
        const observedPhase = preparingBlock ? 'prepare' : p.presentation.phase;
        let track = tracks.get(p.id);
        if (!track && actions.includes(observedAction) && !completed.has(observedAction)
          && (preparingBlock || p.presentation.phase === 'plant' || p.presentation.phase === 'rise')
          && (preparingBlock || p.animTime < .08)) {
          const currentFrameFirstSeq = game.world.eventSeq - game.world.lastEvents.length;
          track = { action: observedAction, playerId: p.id, samples: [], seenAir: false, seenLand: false,
            sinceSeq: currentFrameFirstSeq, match: '' };
          tracks.set(p.id, track);
        }
        if (!track || completed.has(track.action)) continue;
        if (p.airborne) track.seenAir = true;
        if (track.seenAir && !p.airborne && Math.abs(p.vertVel) < .01 && p.presentation.phase === 'land') track.seenLand = true;
        const last = track.samples.at(-1);
        const followsSpike = track.action === 'spike' && sprite?.action === 'spikeFollow';
        if ((sprite?.action === track.action || followsSpike) && (!last || last.action !== sprite.action || last.frame !== sprite.frame || last.phase !== observedPhase)) {
          const floor = game.renderer.camera.projectFloor(p.pos.x, p.pos.y);
          const air = game.renderer.camera.project(p.pos.x, p.pos.y, p.height);
          const crop = document.createElement('canvas'); crop.width = 220; crop.height = 300;
          const scale = canvas.width / 1280;
          // Follow the body's real lift so raised fingers remain in the crop.
          // The separately saved full-match image retains the fixed camera.
          const cropTop = Math.min(floor.y - 280, air.y - 225);
          crop.getContext('2d')!.drawImage(canvas, (floor.x - 110) * scale, cropTop * scale,
            220 * scale, 300 * scale, 0, 0, 220, 300);
          track.samples.push({ t: (performance.now() - start) / 1000, frame: sprite.frame,
            action: sprite.action, phase: observedPhase, height: p.height, vertVel: p.vertVel,
            speed: Math.hypot(p.vel.x, p.vel.y),
            renderedHeight: sprite.renderedHeight, facing: sprite.facing,
            maxBodies: render.max(), vectorFallbackMax: render.vectorFallbackMax(),
            x: p.pos.x, y: p.pos.y, crop });
          if (p.airborne && sprite.action === track.action && sprite.frame === (track.action === 'block' ? 16 : 18)) track.match = canvas.toDataURL();
        }
        if (track.seenLand && p.presentation.action !== track.action) {
          const events = game.world.recentEvents.filter((r: any) => r.seq > track.sinceSeq && r.event.playerId === p.id
            && (r.event.type === 'blockAttempt' || r.event.type === 'contact')).map((r: any) => r.event);
          track.events = events;
          const contact = events.some((e: any) => e.type === 'contact' && ['spike', 'power'].includes(e.kind));
          if (track.samples.length >= 6 && (track.action === 'block' || contact)) completed.set(track.action, track);
          tracks.delete(p.id);
        } else if (p.presentation.action !== track.action && !p.airborne && !preparingBlock) tracks.delete(p.id);
      }
    }
    return actions.map(action => {
      const track = completed.get(action);
      if (!track) return { action, complete: false, reason: 'No complete qualifying live action in 60s' };
      const samples = track.samples;
      const selected = Array.from({ length: Math.min(9, samples.length) }, (_, i) =>
        samples[Math.round(i * (samples.length - 1) / (Math.min(9, samples.length) - 1))]);
      const sheet = document.createElement('canvas'); sheet.width = 1050; sheet.height = 1474;
      const c = sheet.getContext('2d')!;
      c.fillStyle = '#0b1220'; c.fillRect(0, 0, sheet.width, sheet.height);
      c.fillStyle = '#e6edf5'; c.font = '20px monospace';
      c.fillText(`${action} — real match — player ${track.playerId}`, 16, 28);
      c.font = '14px monospace'; c.fillText('Unforced gameplay crops. Timeline coverage is not artistic approval.', 16, 51);
      selected.forEach((s, i) => {
        const x = i % 3 * 350 + 10, y = Math.floor(i / 3) * 470 + 64;
        c.drawImage(s.crop, x, y, 330, 450);
        c.fillStyle = '#e6edf5'; c.fillText(`${s.action} ${s.frame} ${s.phase} h=${s.height.toFixed(2)}`, x, y + 465);
      });
      // Preserve adjacent contact/follow samples as well as the broad montage:
      // evenly spaced selection alone can hide a one-frame anatomical jump.
      let transition = '';
      if (action === 'spike') {
        const boundary = [['spike', 17], ['spike', 18], ['spikeFollow', 0],
          ['spikeFollow', 1], ['spikeFollow', 2], ['spikeFollow', 3]]
          .map(([a, f]) => samples.find((s: any) => s.action === a && s.frame === f));
        if (boundary.every(Boolean)) {
          const strip = document.createElement('canvas'); strip.width = 990; strip.height = 950;
          const b = strip.getContext('2d')!; b.fillStyle = '#0b1220'; b.fillRect(0, 0, 990, 950);
          boundary.forEach((s, i) => {
            const x = i % 3 * 330, y = Math.floor(i / 3) * 475;
            b.drawImage(s.crop, x, y, 330, 450);
            b.fillStyle = '#e6edf5'; b.font = '16px monospace';
            b.fillText(`${s.action} ${s.frame} / h=${s.height.toFixed(2)}`, x + 6, y + 470);
          });
          transition = strip.toDataURL();
        }
      }
      return { action, complete: true, playerId: track.playerId, seenAir: track.seenAir, seenLand: track.seenLand,
        events: track.events, visitedFrames: [...new Set(samples.map((s: any) => s.frame))],
        framesByAction: Object.fromEntries([...new Set(samples.map((s: any) => s.action))].map(action =>
          [action, [...new Set(samples.filter((s: any) => s.action === action).map((s: any) => s.frame))]])),
        durationSeconds: samples.at(-1).t - samples[0].t,
        samples: samples.map(({ crop: _crop, ...sample }: any) => sample),
        png: sheet.toDataURL(), transition, match: track.match };
    });
  }, actions);
  const pageIdentity = { url: page.url(), title: await page.title(),
    gameCanvases: await page.locator('#game').count(), errorOverlays: await page.locator('vite-error-overlay').count() };
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sv90.screen === 'paused');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__sv90.screen === 'match');
  for (const result of results) {
    const { png, transition, match, ...metrics } = result as any;
    const failures: string[] = [];
    if (pageIdentity.gameCanvases !== 1 || pageIdentity.errorOverlays !== 0) failures.push('missing game canvas or framework overlay');
    if (result.action === 'block' && metrics.complete) {
      const prepare = metrics.samples.filter((s: any) => s.phase === 'prepare');
      const frames = new Set(prepare.map((s: any) => s.frame));
      if (Array.from({ length: 7 }, (_, n) => n).some(n => !frames.has(n))) failures.push('missing grounded block preparation drawings');
      if (prepare.some((s: any) => s.height !== 0 || s.renderedHeight !== 0)) failures.push('block compression shown above the floor');
    }
    if (metrics.samples?.some((s: any) => s.maxBodies > 1 || s.vectorFallbackMax > 0)) failures.push('body duplication or vector fallback');
    if (metrics.samples?.some((s: any) => s.action === 'spikeFollow' && (s.frame >= 17) !== (s.renderedHeight === 0))) failures.push('landing pose disagrees with rendered flight');
    if (png) writeFileSync(resolve(out, `${result.action}.png`), Buffer.from(png.split(',')[1], 'base64'));
    if (match) writeFileSync(resolve(out, `${result.action}-match.png`), Buffer.from(match.split(',')[1], 'base64'));
    if (transition) writeFileSync(resolve(out, `${result.action}-transition.png`), Buffer.from(transition.split(',')[1], 'base64'));
    writeFileSync(resolve(out, `${result.action}.json`), JSON.stringify({ ...metrics, pageIdentity, pauseResume: true, errors, failures }, null, 2));
    console.log(JSON.stringify({ action: result.action, complete: result.complete, playerId: metrics.playerId,
      frames: metrics.framesByAction, durationSeconds: metrics.durationSeconds, events: metrics.events, errors, failures }));
    if (failures.length) process.exitCode = 1;
  }
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: resolve(out, 'match-compact.png') });
  if (errors.length || results.some(r => !r.complete)) process.exitCode = 1;
} finally { await browser.close(); }
