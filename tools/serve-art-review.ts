/** Real menu + keyboard service capture. Never sets poses, ball or match state. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';
import { HOT_TIMING_GRAMMAR } from '../src/render/volleyball';

const gpuRequested = process.argv.includes('--gpu');
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--out=') && arg !== '--gpu');
const kinds = args.length ? args : ['serve', 'jumpServe'];
if (kinds.some(k => !['serve', 'jumpServe'].includes(k))) throw new Error('Choose serve and/or jumpServe');
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length) ?? 'artifacts/serve-art-review');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: gpuRequested
  ? ['--enable-gpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] : [] });
try {
  const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const gpu = { requested: gpuRequested, devices: info.gpu.devices, features: info.gpu.featureStatus ?? {} };
  if (gpuRequested && (gpu.features['2d_canvas'] !== 'enabled' || gpu.features.gpu_compositing !== 'enabled')) {
    throw new Error('Accelerated serve review requested but unavailable');
  }
  for (const kind of kinds) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 },
      recordVideo: { dir: resolve(out, 'video'), size: { width: 1280, height: 720 } } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5176/');
    await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
    for (let i = 0; i < 16; i++) {
      if (await page.evaluate(() => Boolean((window as any).__sv90.world))) break;
      await page.keyboard.press('Space'); await page.waitForTimeout(420);
    }
    await page.waitForFunction(() => (window as any).__sv90.world?.phase === 'serve');
    await page.waitForTimeout(800); // let the ordinary menu input lock expire
    await page.evaluate(() => {
      (globalThis as any).__name = (fn: unknown) => fn;
      const g = (window as any).__sv90, render = (window as any).__sv90render;
      const canvas = document.getElementById('game') as HTMLCanvasElement;
      const p = g.world.home.server;
      const data: any = { start: performance.now(), playerId: p.id, samples: [], all: [],
        sinceSeq: g.world.eventSeq, stopped: false, images: {}, readyPixels: [] };
      (window as any).__serveArtCapture = data;
      const record = () => {
        if (data.stopped) return;
        const w = g.world, sprite = render.sprites().find((s: any) => s.playerId === p.id);
        const gesture = w.serveTossGestureProgress;
        const stage = w.phase !== 'serve' ? 'rally' : gesture !== undefined ? 'gesture' : w.serveTossInFlight ? 'toss' : 'hold';
        const sample = { t: (performance.now() - data.start) / 1000, stage,
          hold: w.serveHoldSeconds, tossAge: w.serveTossElapsed, gesture,
          frozen: w.ball.frozen, ready: w.serveStrikeReady,
          phaseTimer: w.phaseTimer, accumulator: g.accumulator, input: g.input.command(),
          strikeQueued: w.serveStrikeQueued, actionBuffer: p.actionBuffer,
          plannedJump: p.plansJumpServe,
          action: sprite?.action, frame: sprite?.frame, phase: p.presentation.phase,
          facing: sprite?.facing, maxBodies: render.max(), vectorFallbackMax: render.vectorFallbackMax(),
          renderedHeight: sprite?.renderedHeight,
          x: p.pos.x, y: p.pos.y, height: p.height, vertVel: p.vertVel,
          ball: { ...w.ball.pos } };
        data.all.push(sample);
        const key = `${stage}/${sample.action}/${sample.frame}/${sample.ready}`;
        if (key !== data.lastKey) {
          const floor = g.renderer.camera.projectFloor(p.pos.x, p.pos.y);
          const air = g.renderer.camera.project(p.pos.x, p.pos.y, p.height);
          const crop = document.createElement('canvas'); crop.width = 220; crop.height = 310;
          const top = Math.min(floor.y - 280, air.y - 230), k = canvas.width / 1280;
          crop.getContext('2d')!.drawImage(canvas, (floor.x - 110) * k, top * k, 220 * k, 310 * k, 0, 0, 220, 310);
          data.samples.push({ ...sample, png: crop.toDataURL() });
          if (sample.ready && !data.images.ready) data.images.ready = canvas.toDataURL();
          if (sample.ready) {
            // Inspect the real ball region, not the red HUD word or the
            // configured palette. Nothing is drawn into the game by this QA.
            const point = g.renderer.camera.projectVec(w.ball.pos), radius = 38 * k;
            const x = Math.max(0, Math.floor(point.x * k - radius)), y = Math.max(0, Math.floor(point.y * k - radius));
            const width = Math.min(canvas.width - x, Math.ceil(radius * 2)), height = Math.min(canvas.height - y, Math.ceil(radius * 2));
            const pixels = canvas.getContext('2d')!.getImageData(x, y, width, height).data;
            let red = 0;
            for (let o = 0; o < pixels.length; o += 4) if (pixels[o] > 180 && pixels[o] > pixels[o + 1] * 1.6 && pixels[o] > pixels[o + 2] * 1.3) red++;
            data.readyPixels.push({ t: sample.t, red, x, y, width, height });
          }
          if (sample.phase === 'contact' && !data.images.contact) data.images.contact = canvas.toDataURL();
          data.lastKey = key;
        }
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    // Prove the human does not auto-start even past the former 8s timeout.
    await page.waitForFunction(() => (window as any).__sv90.world.phaseTimer > 9.1, undefined, { timeout: 25000 });
    await page.screenshot({ path: resolve(out, `${kind}-waiting.png`) });
    await page.keyboard.down('Space');
    await page.waitForTimeout(kind === 'jumpServe' ? 1100 : 150);
    await page.keyboard.up('Space');
    try {
      await page.waitForFunction(() => (window as any).__sv90.world.serveStrikeReady, undefined, { timeout: 6000 });
      await page.keyboard.down('Space'); await page.waitForTimeout(60); await page.keyboard.up('Space');
      await page.waitForFunction(() => (window as any).__sv90.world.phase === 'rally', undefined, { timeout: 6000 });
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${kind}-failure.png`) });
      const failure = await page.evaluate(() => {
        const data = (window as any).__serveArtCapture, world = (window as any).__sv90.world;
        data.stopped = true;
        return { all: data.all, events: world.recentEvents.filter((r: any) => r.seq > data.sinceSeq),
          phase: world.phase, serveKind: world.serveKind, phaseTimer: world.phaseTimer };
      });
      writeFileSync(resolve(out, `${kind}-failure.json`), JSON.stringify({ ...failure, errors, failure: String(error) }, null, 2));
      throw error;
    }
    await page.waitForTimeout(2500);
    const result = await page.evaluate(async () => {
      const data = (window as any).__serveArtCapture, world = (window as any).__sv90.world;
      data.stopped = true;
      const events = world.recentEvents.filter((r: any) => r.seq > data.sinceSeq && r.event.playerId === data.playerId)
        .map((r: any) => r.event);
      // Do not let the longer post-service walk displace the toss/air/landing
      // evidence. These remain actual captured frames, not atlas reconstructions.
      const meaningful = data.samples.filter((s: any) => ['serve', 'jumpServe', 'jumpServeFollow'].includes(s.action));
      const chosen = Array.from({ length: Math.min(12, meaningful.length) }, (_, i) =>
        meaningful[Math.round(i * (meaningful.length - 1) / (Math.min(12, meaningful.length) - 1))]);
      const sheet = document.createElement('canvas'); sheet.width = 960; sheet.height = 1150;
      const c = sheet.getContext('2d')!; c.fillStyle = '#12212a'; c.fillRect(0, 0, sheet.width, sheet.height);
      c.font = '18px monospace'; c.fillStyle = '#edf1f4'; c.fillText('Real menu + keyboard input — no staged poses', 15, 28);
      await Promise.all(chosen.map(async (s: any, i: number) => {
        const img = new Image(); img.src = s.png; await img.decode();
        const x = i % 4 * 240 + 10, y = Math.floor(i / 4) * 365 + 50;
        c.drawImage(img, x, y, 220, 310); c.fillStyle = '#edf1f4'; c.font = '13px monospace';
        c.fillText(`${s.action} ${s.frame} ${s.stage}`, x, y + 327);
        c.fillText(`h=${s.height.toFixed(2)} ${s.phase}`, x, y + 346);
      }));
      // Consecutive actual rendered frames, not a reconstructed atlas preview.
      // The evenly spaced whole-serve montage can hide a skipped swing pose.
      const swing = [13, 14, 15, 32, 33, 34, 35, 16, 17, 18].map(frame =>
        data.samples.find((s: any) => s.action === 'jumpServe' && s.frame === frame)).filter(Boolean);
      if (swing.length) {
        const strip = document.createElement('canvas'); strip.width = 660; strip.height = Math.ceil(swing.length / 3) * 350;
        const ink = strip.getContext('2d')!; ink.fillStyle = '#12212a'; ink.fillRect(0, 0, strip.width, strip.height);
        await Promise.all(swing.map(async (s: any, i: number) => {
          const img = new Image(); img.src = s.png; await img.decode();
          const x = i % 3 * 220, y = Math.floor(i / 3) * 350;
          ink.drawImage(img, x, y, 220, 310); ink.fillStyle = '#edf1f4'; ink.font = '13px monospace';
          ink.fillText(`jumpServe ${s.frame}  h=${s.height.toFixed(2)}`, x + 8, y + 333);
        }));
        data.images.swing = strip.toDataURL();
      }
      return { captureStartedAt: data.start / 1000, all: data.all, samples: data.samples.map(({ png: _png, ...s }: any) => s),
        readyPixels: data.readyPixels, swingFrames: swing.map((s: any) => s.frame), images: data.images, events, montage: sheet.toDataURL() };
    });
    const { montage, images, ...metrics } = result;
    for (const [name, value] of Object.entries({ montage, ...images })) {
      writeFileSync(resolve(out, `${kind}-${name}.png`), Buffer.from((value as string).split(',')[1], 'base64'));
    }
    const still = metrics.all.filter((s: any) => s.stage === 'hold');
    const gestures = metrics.all.filter((s: any) => s.stage === 'gesture');
    const contact = metrics.events.find((e: any) => e.type === 'contact' && e.kind === 'serve');
    const spread = (samples: any[]) => Math.max(...samples.map(s => s.y)) - Math.min(...samples.map(s => s.y));
    const failures = [...errors];
    if (spread(still) > .02) failures.push('server moved while holding');
    if (still.some((s: any) => s.plannedJump)) failures.push('jump serve preselected before the human released the toss input');
    if (!gestures.length || gestures.some((s: any) => !s.frozen) || spread(gestures) > .02) failures.push('toss gesture was not stationary with ball held');
    if (!contact || contact.airborne !== (kind === 'jumpServe')) failures.push('wrong/missing actual serve contact');
    if (!images.ready || !images.contact) failures.push('missing rendered ready/contact evidence');
    if (!metrics.readyPixels.length || metrics.readyPixels.some((s: any) => s.red < HOT_TIMING_GRAMMAR.minimumLiveRedPixels)) failures.push('timing-ready ball is not visibly red in the rendered game');
    if (metrics.all.some((s: any) => s.maxBodies > 1 || s.vectorFallbackMax > 0)) failures.push('body duplication or vector fallback');
    if (kind === 'jumpServe') {
      if ([13, 14, 15, 32, 33, 34, 35, 16, 17, 18].some(frame => !metrics.swingFrames.includes(frame))) failures.push('missing rendered pre-contact swing pose');
      const follow = metrics.all.filter((s: any) => s.action === 'jumpServeFollow');
      if (!follow.some((s: any) => s.frame === 0) || !follow.some((s: any) => s.frame === 23)) failures.push('missing follow-through endpoints');
      // Rendering leads the latest physics tick by at most 8.2 ms. Compare
      // the floor pose with that SAME rendered body's height, not stale physics.
      if (follow.some((s: any) => s.renderedHeight === undefined || s.frame >= 17 && s.renderedHeight > 0.001)) failures.push('planted pose shown in the air');
    }
    writeFileSync(resolve(out, `${kind}.json`), JSON.stringify({ ...metrics, gpu, failures }, null, 2));
    console.log(JSON.stringify({ kind, holdSpread: spread(still), gestureSpread: spread(gestures),
      gestureFrames: [...new Set(gestures.map((s: any) => s.frame))], contact, failures }));
    if (failures.length) process.exitCode = 1;
    await page.close();
    await page.video()?.saveAs(resolve(out, `${kind}.webm`));
  }
} finally { await browser.close(); }
