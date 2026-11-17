/** Observe real rendering without screenshots, canvas readback or forced poses. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const label = process.argv.includes('--baseline') ? 'baseline' : 'current';
const gpuRequested = process.argv.includes('--gpu');
const profileRequested = process.argv.includes('--profile');
const headed = process.argv.includes('--headed');
const numericOption = (name: string, fallback: number) => {
  const value = Number(process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid --${name}`);
  return value;
};
const width = numericOption('width', 1280), height = numericOption('height', 720), dpr = numericOption('dpr', 1);
const url = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5176/';
const seed = numericOption('seed', 4242), seconds = numericOption('seconds', 36);
if (!Number.isSafeInteger(seed) || seconds > 180) throw new Error('Seed must be an integer; sampling is limited to 180 seconds');
if (!Number.isInteger(width) || !Number.isInteger(height) || width > 7680 || height > 4320 || dpr > 3) {
  throw new Error('Viewport must use integer CSS pixels up to 7680x4320, DPR at most 3');
}
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/render-performance');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: !headed, args: gpuRequested
  ? ['--enable-gpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] : [] });
try {
  const info = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const gpu = { requested: gpuRequested, devices: info.gpu.devices, features: info.gpu.featureStatus ?? {} };
  if (gpuRequested && (gpu.features['2d_canvas'] !== 'enabled' || gpu.features.gpu_compositing !== 'enabled')) {
    throw new Error(`Requested accelerated QA but canvas/compositing are unavailable: ${JSON.stringify(gpu)}`);
  }
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  // This session belongs only to the new QA browser, never a user's open tabs.
  const profiler = profileRequested ? await page.context().newCDPSession(page) : undefined;
  if (profiler) {
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 });
    await profiler.send('Profiler.start');
  }
  const result = await page.evaluate(async ({ seed, seconds }) => {
    (globalThis as any).__name = (fn: unknown) => fn;
    // Use the exact module instance imported by the live renderer. A dynamic
    // Vite import without its HMR timestamp can create a second empty cache.
    const frameVariantStats = (window as any).__sv90render.frameCache;
    const g = (window as any).__sv90;
    const render = (window as any).__sv90render;
    const actions: Record<string, number> = {}, histories = new Map<number, any[]>();
    const shortActionReversals: any[] = [];
    let incompleteBodyFrames = 0;
    render.reset();
    const samples: any[] = [];
    const start = performance.now();
    let last = start, updateMs = 0;
    const update = g.update, draw = g.draw;
    g.update = (dt: number) => {
      const before = performance.now(); update.call(g, dt); updateMs = performance.now() - before;
    };
    g.draw = (dt: number) => {
      const before = performance.now();
      const counts = Object.values(g.renderer.sheets).reduce((n: number, s: any) => n + s.variants.size, 0);
      const frameCount = frameVariantStats?.generated ?? 0;
      draw.call(g, dt);
      const after = performance.now();
      const poses = render.sprites();
      if (g.world && poses.length !== 12) incompleteBodyFrames++;
      for (const pose of poses) {
        actions[pose.action] = (actions[pose.action] ?? 0) + 1;
        const history = histories.get(pose.playerId) ?? [];
        if (history.at(-1)?.action === pose.action) continue;
        history.push({ action: pose.action, frame: pose.frame, t: before - start });
        if (history.length > 3) history.shift();
        histories.set(pose.playerId, history);
        if (history.length === 3 && history[0].action === history[2].action && history[2].t - history[1].t < 100) {
          shortActionReversals.push({ playerId: pose.playerId, phase: g.world?.phase, sequence: [...history] });
        }
      }
      const variants = Object.values(g.renderer.sheets).reduce((n: number, s: any) => n + s.variants.size, 0);
      samples.push({ t: before - start, interval: before - last, updateMs, drawMs: after - before,
        newVariants: variants - counts, variants,
        newFrameVariants: (frameVariantStats?.generated ?? 0) - frameCount,
        frameCacheSize: frameVariantStats?.entries ?? 0, phase: g.world?.phase });
      last = before;
    };
    try {
      g.startDemoMatch(seed);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } finally { g.update = update; g.draw = draw; }
    const summary = (subset: any[]) => {
      const stats = (field: string) => {
        const values = subset.map(s => s[field]).sort((a, b) => a - b);
        return { mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length),
          p95: values[Math.floor(values.length * .95)] ?? 0, max: values.at(-1) ?? 0 };
      };
      return { count: subset.length, interval: stats('interval'), updateMs: stats('updateMs'),
        drawMs: stats('drawMs'), over33ms: subset.filter(s => s.interval > 33.5).length };
    };
    return { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, seed,
      seconds, pageClockStartMs: start,
      note: 'Isolated QA Chromium, wall-clock AI rally, no screenshots during sampling. Read browserMode and GPU metadata; this is not the user Chrome profile. CPU profiling, when enabled, adds sampling overhead.',
      // The first interval is not a complete display interval, but its DRAW
      // must remain visible: it can be the cause of the second frame's gap.
      startup: samples[0],
      all: summary(samples.slice(1)), firstTenSeconds: summary(samples.filter(s => s.t < 10000).slice(1)),
      later: summary(samples.filter(s => s.t >= 10000)),
      frameCache: frameVariantStats ? { ...frameVariantStats } : null,
      motion: { actions, incompleteBodyFrames, shortActionReversals,
        vectorFallbackMax: render.vectorFallbackMax(), maxBodiesPerPlayer: render.max(),
        note: 'Short A-B-A action reversals are review candidates, not automatic anatomical failures. Actual per-frame rendered poses are observed, never forced.' },
      paletteMissFrames: samples.filter(s => s.newVariants > 0),
      slowFrames: samples.filter(s => s.drawMs > 12 || s.updateMs > 8),
      displayGaps: samples.flatMap((sample, i) => i > 0 && sample.interval > 25
        ? [{ previous: samples[i - 1], current: sample }] : []), samples };
  }, { seed, seconds });
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop');
    writeFileSync(resolve(out, `${label}.cpuprofile`), JSON.stringify(profile));
    await profiler.detach();
  }
  writeFileSync(resolve(out, `${label}.json`), JSON.stringify({ ...result, browserMode: headed ? 'headed QA Chromium' : 'headless QA Chromium', gpu, profileRequested, errors }, null, 2));
  const { samples: _samples, slowFrames, paletteMissFrames, displayGaps, ...report } = result;
  console.log(JSON.stringify({ ...report, gpu, slowFrameCount: slowFrames.length,
    displayGaps: displayGaps.length, profileRequested, paletteMissFrames: paletteMissFrames.length, errors }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
