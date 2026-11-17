/**
 * Visual QA, driven by the real game.
 *
 *   npx tsx tools/visual-qa-v3.ts
 *
 * This replaces tools/visual-overhaul-shots.ts, which built its "evidence" by
 * assigning `p.height`, `p.anim` and `p.swing` directly and then photographing
 * the result. That proves the renderer can draw a pose. It does not prove the
 * AI, the rules and the input ever produce one — and a screenshot of a block
 * that the game never performed is worse than no screenshot at all.
 *
 * The rules this harness plays by:
 *
 *   - it may choose the seed, the teams and the difficulty, and it may send
 *     input, because those are the game's own public commands;
 *   - it may stop the clock, so that a moment which really happened can be
 *     photographed before it passes;
 *   - it may NOT write `anim`, `height`, `swing`, `airborne`, or any other
 *     piece of simulation state.
 *
 * Every shot below is therefore a moment the simulation actually reached. If
 * the game stops producing real blocks, or stops jumping to serve, the shots
 * time out and this exits non-zero rather than quietly photographing a lie.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkGameplayGates, measureGameplay } from '../src/qa/gameplay-metrics';
import { HOT_TIMING_GRAMMAR } from '../src/render/volleyball';
import { runServeSweep, summarizeServeSweep } from './serve-lab';
import { observeLocomotion } from './observe-locomotion';

const OUT = resolve('artifacts/visual-qa-v3');
const SHOTS = resolve(OUT, 'screenshots');
const VIDEOS = resolve(OUT, 'videos');
const PORT = 5183;
const URL = `http://localhost:${PORT}/`;
const SEED = 1337;

/**
 * How much faster than real time the match runs while stills are captured.
 *
 * At 1, waiting for a jump serve or a Lethal Maneuver took minutes per shot and
 * the whole pass ran past twenty. The simulation steps are identical; only the
 * wall clock is compressed.
 *
 * It is not set higher because the observer can only sample once per animation
 * frame: at 6x that is roughly 96 ms of simulated time between looks, which is
 * wide enough to step over a short-lived state — the settled serve formation
 * was missed entirely. Three keeps the sampling fine enough to see it.
 */
const FAST = 3;

/** Chromium in CI images is not always where the bundled version expects. */
const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

const LAUNCH = {
  executablePath,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
};

/**
 * The conditions the harness waits for, evaluated inside the page against live
 * simulation state. Each one is a question about what the game is doing now.
 */
const CONDITIONS = `
window.__qaCond = {
  // Not merely "the serve phase has begun": at that instant the teams are still
  // jogging back into formation from the previous rally, and the shot showed a
  // court full of running. This waits for a composed formation — nobody running
  // and nobody driving an attack approach.
  //
  // It deliberately does not demand all eleven at a dead stop. That state is
  // real but brief, and an observer sampling once per animation frame steps
  // over it often enough to make the run slow and flaky. The strict form of the
  // requirement is measured instead, across every serve in the sample, by
  // serveFormationSettled — better evidence anyway, since one photograph only
  // shows that it happened once.
  serveReady: (g, w) => {
    if (w.phase !== 'serve' || !w.ball.frozen) return false;
    const serverId = w.team(w.servingSide).server.id;
    return window
      .__qaPlayers(w)
      .filter((p) => p.id !== serverId)
      .every((p) => {
        const loco = p.presentation.locomotion;
        return loco !== 'run' && loco !== 'approach' && Math.hypot(p.vel.x, p.vel.y) < 1.6;
      });
  },
  jumpServeToss: (g, w) => {
    const s = w.team(w.servingSide).server;
    // The whole flight of the toss, not just its rise: a two-frame window is
    // not something a screenshot can be expected to land on.
    return (
      w.phase === 'serve' &&
      s.plansJumpServe &&
      !w.ball.frozen &&
      !s.airborne &&
      w.ball.pos.z > 1.25 &&
      w.ball.pos.z < 3.5
    );
  },
  jumpServeApproach: (g, w) => {
    const s = w.team(w.servingSide).server;
    return s.plansJumpServe && s.presentation.locomotion === 'approach' && !s.airborne;
  },
  jumpServeApex: (g, w) => {
    const s = w.team(w.servingSide).server;
    return s.plansJumpServe && s.airborne && s.vertVel <= 0.2 && s.height > 0.4;
  },
  jumpServeContact: (g, w) => {
    const s = w.team(w.servingSide).server;
    return (
      (s.plansJumpServe &&
        s.presentation.action === 'jumpServe' &&
        s.presentation.phase === 'contact' &&
        s.airborne) ||
      window.__qaSince(w).some((e) => e.type === 'contact' && e.kind === 'serve' && e.airborne)
    );
  },
  spikeApproach: (g, w) =>
    window.__qaPlayers(w).some(
      (p) => p.presentation.locomotion === 'approach' && p.presentation.sourceJob === 'attack',
    ),
  spikePlant: (g, w) =>
    window.__qaPlayers(w).some((p) => p.presentation.action === 'spike' && p.presentation.phase === 'plant'),
  spikeContact: (g, w) =>
    window.__qaSince(w).some(
      (e) => e.type === 'contact' && (e.kind === 'spike' || e.kind === 'power') && e.airborne,
    ),
  blockApex: (g, w) =>
    window.__qaPlayers(w).some(
      (p) => p.presentation.action === 'block' && p.airborne && p.height > 0.45 && p.vertVel <= 0.3,
    ),
  bumpContact: (g, w) => window.__qaSince(w).some((e) => e.type === 'contact' && e.kind === 'bump'),
  setContact: (g, w) => window.__qaSince(w).some((e) => e.type === 'contact' && e.kind === 'set'),
  powerMove: (g, w) => window.__qaSince(w).some((e) => e.type === 'powerMove'),
  hotTimingCue: (g, w) => Boolean(w.playCue?.ready === true || w.serveStrikeReady === true),
  hotRallyTimingCue: (g, w) => w.phase === 'rally' && w.playCue?.ready === true,
  shuffleFootwork: (g, w) => {
    if (w.phase !== 'rally') return false;
    const players = window.__qaPlayers(w);
    const walkers = players.filter(
      (p) =>
        p.presentation.locomotion === 'walk' &&
        p.presentation.sourceJob === 'cover' &&
        Math.hypot(p.vel.x, p.vel.y) >= 0.18 &&
        Math.hypot(p.vel.x, p.vel.y) < 0.8,
    );
    const approachers = players.filter((p) => p.presentation.locomotion === 'approach');
    return walkers.length >= 2 && approachers.length <= 1;
  },
  runFootwork: (g, w) => {
    if (w.phase !== 'rally') return false;
    return window.__qaPlayers(w).some((p) => {
      const speed = Math.hypot(p.vel.x, p.vel.y);
      return p.presentation.action === 'none' && p.presentation.locomotion === 'run' && speed > 2.35;
    });
  },
  rally: (g, w) => w.phase === 'rally',
  replay: (g) => Boolean(g.replay && g.replay.isPlaying),
};
window.__qaPlayers = (w) => [...w.home.players, ...w.away.players];
// Events emitted since the current condition was armed. Checking only the last
// frame's events is a one-frame race: a contact can be emitted and overwritten
// between two observations.
window.__qaSince = (w) =>
  w.recentEvents.filter((r) => r.seq > (window.__qaSeq || 0)).map((r) => r.event);
`;

/** Install the observer: it watches every frame and freezes on a match. */
const OBSERVER = `
${CONDITIONS}
window.__qaArm = (name) => {
  window.__qaHit = null;
  window.__qaWanted = name;
  const g = window.__sv90;
  // Only events from here on count towards this condition.
  window.__qaSeq = g && g.world ? g.world.eventSeq : 0;
  if (g) g.qaFreeze = false;
};
window.__qaRelease = () => {
  window.__qaWanted = null;
  window.__qaHit = null;
  const g = window.__sv90;
  if (g) g.qaFreeze = false;
};
(function watch() {
  const g = window.__sv90;
  const w = g && g.world;
  const wanted = window.__qaWanted;
  if (w && wanted && !window.__qaHit) {
    const fn = window.__qaCond[wanted];
    try {
      if (fn && fn(g, w)) {
        window.__qaHit = wanted;
        g.qaFreeze = true;
      }
    } catch (err) {
      window.__qaError = String(err);
    }
  }
  requestAnimationFrame(watch);
})();
`;

interface Shot {
  file: string;
  condition: string | null;
  /** Seconds to allow before giving up on the moment ever arriving. */
  timeout?: number;
}

/** Every required screenshot, and the real moment each one waits for. */
const SHOT_LIST: Shot[] = [
  { file: '02-formation-ready.png', condition: 'serveReady', timeout: 120 },
  { file: '03-jump-serve-toss.png', condition: 'jumpServeToss', timeout: 120 },
  { file: '04-jump-serve-approach.png', condition: 'jumpServeApproach', timeout: 60 },
  { file: '05-jump-serve-apex.png', condition: 'jumpServeApex', timeout: 60 },
  { file: '06-jump-serve-contact.png', condition: 'jumpServeContact', timeout: 60 },
  { file: '07-spike-approach.png', condition: 'spikeApproach' },
  { file: '08-spike-plant.png', condition: 'spikePlant' },
  { file: '09-spike-contact.png', condition: 'spikeContact' },
  { file: '10-block-apex.png', condition: 'blockApex', timeout: 150 },
  { file: '11-bump-contact.png', condition: 'bumpContact' },
  { file: '12-set-contact.png', condition: 'setContact' },
  { file: '13-officials.png', condition: 'serveReady', timeout: 120 },
  { file: '17-super-fx.png', condition: 'powerMove', timeout: 180 },
  { file: '18-replay.png', condition: 'replay', timeout: 180 },
];

const SPRITE_QC_ACTIONS = [
  'idle',
  'walk',
  'run',
  'approach',
  'spike',
  'block',
  'bump',
  'set',
  'dive',
  'serve',
  'jumpServe',
  'celebrate',
] as const;

const ANIMATION_RICHNESS_ROWS = [
  {
    label: 'run stride: both legs alternate',
    action: 'run',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 20,
    minMotionScore: 0.008,
  },
  {
    label: 'small walk / shuffle: not a sprint',
    action: 'walk',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'spike: plant/rise/hit/follow',
    action: 'spike',
    frames: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 14,
    minMotionScore: 0.008,
  },
  {
    label: 'standing serve: toss/contact/recover',
    action: 'serve',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'jump serve: toss/run/jump/hit/follow',
    action: 'jumpServe',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'block: load/rise/apex/landing',
    action: 'block',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'bump receive: crouch/platform/recover',
    action: 'bump',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'set: hands/load/release/recover',
    action: 'set',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
  {
    label: 'dive: launch/slide/recover',
    action: 'dive',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    minDistinct: 24,
    minMotionScore: 0.008,
  },
] as const;

interface Scene {
  file: string;
  /** Wait for this before recording starts. */
  condition: string | null;
  seconds: number;
}

const VIDEO_LIST: Scene[] = [
  { file: '01-serve-ready.webm', condition: 'serveReady', seconds: 4.5 },
  { file: '02-jump-serve-full.webm', condition: 'jumpServeToss', seconds: 6 },
  { file: '03-rally-spike-block.webm', condition: 'spikeApproach', seconds: 12 },
  { file: '04-bump-set-spike.webm', condition: 'bumpContact', seconds: 10 },
  { file: '05-super-move.webm', condition: 'powerMove', seconds: 6 },
];

const failures: string[] = [];

async function startDemo(page: Page, seed: number, timeScale = 1): Promise<void> {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__sv90));
  await page.evaluate(OBSERVER);
  // The harness's entire influence on the match: which teams, how hard, and
  // which seed. Everything after this is the game playing itself.
  await page.evaluate((s) => (window as never as Record<string, any>).__sv90.startDemoMatch(s), seed);
  await page.waitForFunction(() => Boolean((window as never as Record<string, any>).__sv90.world));
  // Screenshots run the match fast so rare moments arrive in seconds. Videos
  // are recorded at 1, because they are meant to be watched.
  await page.evaluate((t) => ((window as never as Record<string, any>).__sv90.qaTimeScale = t), timeScale);
}

/** Wait for a real moment, with the clock stopped on arrival. */
async function awaitMoment(page: Page, name: string, timeoutSec = 120): Promise<boolean> {
  await page.evaluate((n) => (window as never as Record<string, any>).__qaArm(n), name);
  try {
    await page.waitForFunction(
      (n) => (window as never as Record<string, any>).__qaHit === n,
      name,
      { timeout: timeoutSec * 1000, polling: 50 },
    );
    return true;
  } catch {
    failures.push(`never observed: ${name}`);
    await page.evaluate(() => (window as never as Record<string, any>).__qaRelease());
    return false;
  }
}

async function release(page: Page): Promise<void> {
  await page.evaluate(() => (window as never as Record<string, any>).__qaRelease());
}

async function captureAnimationFrameRichness(page: Page): Promise<Record<string, unknown>> {
  try {
    await page.evaluate(() => {
      (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
    });
    const report = (await page.evaluate(async (rows) => {
      type Row = {
        label: string;
        action: string;
        frames: readonly number[];
        minDistinct: number;
        minMotionScore: number;
      };
      type Metric = {
        label: string;
        action: string;
        frames: readonly number[];
        distinctFrames: number;
        minDistinct: number;
        motionScore: number;
        minMotionScore: number;
      };

      const typedRows = rows as readonly Row[];
      const cell = 512;
      const thumb = 54;
      const gap = 5;
      const labelW = 260;
      const rowH = 90;
      const pad = 14;
      const width = 1280;
      const height = pad * 2 + 42 + typedRows.length * rowH;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable for animation richness sheet');
      const sample = document.createElement('canvas');
      sample.width = 48;
      sample.height = 48;
      const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      if (!sampleCtx) throw new Error('2D sample canvas unavailable for animation richness sheet');

      const images = new Map<string, HTMLImageElement>();
      for (const row of typedRows) {
        if (images.has(row.action)) continue;
        const image = new Image();
        image.src = `sprites/${row.action}.png`;
        await image.decode();
        images.set(row.action, image);
      }

      const frameSignature = (image: HTMLImageElement, frame: number): { hash: string; rgba: Uint8ClampedArray } => {
        const sx = (frame % 6) * cell;
        const sy = Math.floor(frame / 6) * cell;
        sampleCtx.clearRect(0, 0, sample.width, sample.height);
        sampleCtx.drawImage(image, sx, sy, cell, cell, 0, 0, sample.width, sample.height);
        const data = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
        let alpha = 0;
        let weightedX = 0;
        let weightedY = 0;
        let ink = 0;
        let warm = 0;
        let cool = 0;
        // Preserve spatial pose information at the same 48 px scale used by
        // the on-court sprite.  The former six-number aggregate collapsed a
        // lifted heel and a planted heel to the same hash even though the
        // silhouettes were visibly different, producing a false "21/24"
        // result for a genuinely distinct walk cycle.
        const silhouette = new Float32Array(64);
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          if (a < 0.08) continue;
          const px = (i / 4) % sample.width;
          const py = Math.floor(i / 4 / sample.width);
          const luma = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
          const weight = a * (1 - Math.min(0.96, luma));
          alpha += a;
          ink += weight;
          weightedX += px * weight;
          weightedY += py * weight;
          warm += Math.max(0, data[i] - data[i + 2]) * a;
          cool += Math.max(0, data[i + 2] - data[i]) * a;
          silhouette[Math.floor(py / 6) * 8 + Math.floor(px / 6)] += a;
        }
        const q = (n: number): number => Math.round(n);
        const hash = [
          q(alpha / 6),
          q((weightedX / Math.max(1, ink)) * 2),
          q((weightedY / Math.max(1, ink)) * 2),
          q(ink / 3),
          q(warm / 400),
          q(cool / 400),
          ...Array.from(silhouette, (value) => q(value / 2)),
        ].join(':');
        return { hash, rgba: new Uint8ClampedArray(data) };
      };

      const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
        let total = 0;
        for (let i = 0; i < a.length; i += 4) {
          total +=
            Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2]) +
            Math.abs(a[i + 3] - b[i + 3]);
        }
        return total / (a.length * 255);
      };

      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, height);
      ctx.font = '700 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d7dde8';
      ctx.fillText('animation frame richness: consecutive authored frames used by live render timelines', pad, pad + 12);

      const metrics: Metric[] = [];
      for (let rowIndex = 0; rowIndex < typedRows.length; rowIndex++) {
        const row = typedRows[rowIndex];
        const y = pad + 42 + rowIndex * rowH;
        const image = images.get(row.action);
        if (!image) throw new Error(`missing image for ${row.action}`);
        const signatures = row.frames.map((frame) => frameSignature(image, frame));
        const distinctFrames = new Set(signatures.map((s) => s.hash)).size;
        const diffs: number[] = [];
        for (let i = 1; i < signatures.length; i++) diffs.push(diff(signatures[i - 1].rgba, signatures[i].rgba));
        const motionScore = diffs.reduce((sum, n) => sum + n, 0) / Math.max(1, diffs.length);
        metrics.push({
          label: row.label,
          action: row.action,
          frames: row.frames,
          distinctFrames,
          minDistinct: row.minDistinct,
          motionScore: Number(motionScore.toFixed(4)),
          minMotionScore: row.minMotionScore,
        });

        ctx.fillStyle = '#d7dde8';
        ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(row.label, pad, y + 34);
        ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle =
          distinctFrames >= row.minDistinct && motionScore >= row.minMotionScore ? '#9ae6b4' : '#feb2b2';
        ctx.fillText(
          `distinct ${distinctFrames}/${row.frames.length}  motion ${motionScore.toFixed(4)}`,
          pad,
          y + 56,
        );

        const bgW = Math.min(row.frames.length, 16) * (thumb + gap) - gap;
        const x0 = labelW;
        const sq = 10;
        for (let yy = 0; yy < thumb; yy += sq) {
          for (let xx = 0; xx < bgW; xx += sq) {
            ctx.fillStyle = (((xx / sq) | 0) + ((yy / sq) | 0)) % 2 ? '#737a84' : '#2f3742';
            ctx.fillRect(x0 + xx, y + 4 + yy, sq, sq);
          }
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (let i = 0; i < row.frames.length && i < 16; i++) {
          const frame = row.frames[i];
          const sx = (frame % 6) * cell;
          const sy = Math.floor(frame / 6) * cell;
          const dx = x0 + i * (thumb + gap);
          const dy = y + 4;
          ctx.drawImage(image, sx, sy, cell, cell, dx, dy, thumb, thumb);
          ctx.strokeStyle = 'rgba(215,221,232,0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, thumb - 1, thumb - 1);
          ctx.fillStyle = 'rgba(17,24,39,0.78)';
          ctx.fillRect(dx + 3, dy + thumb - 17, 29, 13);
          ctx.fillStyle = '#d7dde8';
          ctx.fillText(String(frame).padStart(2, '0'), dx + 6, dy + thumb - 10);
        }
      }

      return { dataUrl: canvas.toDataURL('image/png'), metrics };
    }, ANIMATION_RICHNESS_ROWS)) as { dataUrl: string; metrics: Record<string, unknown>[] };

    writeFileSync(resolve(SHOTS, '24-animation-frame-richness.png'), Buffer.from(report.dataUrl.split(',')[1], 'base64'));
    for (const row of report.metrics as Array<{ label: string; distinctFrames: number; minDistinct: number; motionScore: number; minMotionScore: number }>) {
      if (row.distinctFrames < row.minDistinct || row.motionScore < row.minMotionScore) {
        failures.push(`animation frame richness: ${row.label} has ${JSON.stringify(row)}`);
      }
    }
    return { observed: true, rows: report.metrics };
  } catch (err) {
    failures.push(`24-animation-frame-richness.png: ${String(err)}`);
    return { observed: false, error: String(err) };
  }
}

async function captureScreenshots(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The menu, and the build identity that names this commit.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(SHOTS, '01-menu.png') });
  await page.screenshot({ path: resolve(SHOTS, '00-build-id.png') });

  await startDemo(page, SEED, FAST);
  let arenaV3LayersLoaded = 0;
  try {
    await page.waitForFunction(
      'window.__sv90 && window.__sv90.renderer && window.__sv90.renderer.arenaAssetCount === 5',
      undefined,
      { timeout: 15_000, polling: 100 },
    );
    arenaV3LayersLoaded = await page.evaluate(
      'window.__sv90.renderer.arenaAssetCount',
    ) as number;
  } catch {
    arenaV3LayersLoaded = await page.evaluate(
      'window.__sv90 && window.__sv90.renderer ? window.__sv90.renderer.arenaAssetCount : 0',
    ) as number;
    failures.push(`arenaV3LayersLoaded = ${arenaV3LayersLoaded}, expected 5`);
  }
  for (const shot of SHOT_LIST) {
    if (shot.condition && !(await awaitMoment(page, shot.condition, shot.timeout ?? 90))) {
      continue;
    }
    await page.screenshot({ path: resolve(SHOTS, shot.file) });
    await release(page);
  }

  // Render diagnostics, sampled over a stretch of ordinary play.
  await page.evaluate(() => (window as never as Record<string, any>).__sv90render.reset());
  await page.waitForTimeout(6000);
  const bodyDraws = await page.evaluate(
    () => (window as never as Record<string, any>).__sv90render.max() as number,
  );
  const vectorFallbackDraws = await page.evaluate(
    () => (window as never as Record<string, any>).__sv90render.vectorFallbackMax() as number,
  );
  const buildInfo = await page.evaluate(async () => {
    const r = await fetch('build-info.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  });
  const officialDiagnostics = await page.evaluate(() => {
    const render = (window as never as Record<string, any>).__sv90render;
    return typeof render?.officials === 'function' ? render.officials() : null;
  });
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  // A reviewable white-leak sheet over a checkerboard, generated inside this
  // pass so visual QA is self-contained.  The same page pass also scans every
  // source pixel for hard white and near-white matte leakage.  The screenshot
  // is the human evidence; the zero-budget pixel counts make it falsifiable.
  let spriteWhiteMatteQc: Record<string, unknown> = { observed: false };
  try {
    const qc = (await page.evaluate(async (actions) => {
      const rows: { action: string; image: HTMLImageElement }[] = [];
      for (const action of actions) {
        const image = new Image();
        image.src = `sprites/${action}.png`;
        await image.decode();
        rows.push({ action, image });
      }

      const full = document.createElement('canvas');
      const fullCtx = full.getContext('2d', { willReadFrequently: true });
      if (!fullCtx) throw new Error('2D canvas unavailable for sprite pixel QC');
      const rgbaAt = (data: Uint8ClampedArray, w: number, x: number, y: number): [number, number, number, number] => {
        const i = (y * w + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
      };
      const touchesTransparency = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean => {
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true;
          if (rgbaAt(data, w, nx, ny)[3] < 40) return true;
        }
        return false;
      };
      const bodyColour = (px: [number, number, number, number]): boolean => {
        const [r, g, b, a] = px;
        if (a < 150) return false;
        return !(Math.min(r, g, b) >= 218 && Math.max(r, g, b) - Math.min(r, g, b) <= 38);
      };
      const enclosedByBody = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean => {
        const cellX0 = Math.floor(x / 512) * 512;
        const cellX1 = Math.min(cellX0 + 512, w);
        const cellY0 = Math.floor(y / 512) * 512;
        const localY = y - cellY0;
        if (localY < 512 * 0.34) return false;

        let left = false;
        let right = false;
        for (let xx = Math.max(cellX0, x - 28); xx < x; xx++) left ||= bodyColour(rgbaAt(data, w, xx, y));
        for (let xx = x + 1; xx < Math.min(cellX1, x + 29); xx++) right ||= bodyColour(rgbaAt(data, w, xx, y));
        if (left && right) return true;

        for (let yy = Math.max(cellY0 + Math.floor(512 * 0.34), y - 8); yy < Math.min(h, y + 9); yy++) {
          left = false;
          right = false;
          for (let xx = Math.max(cellX0, x - 20); xx < x; xx++) left ||= bodyColour(rgbaAt(data, w, xx, yy));
          for (let xx = x + 1; xx < Math.min(cellX1, x + 21); xx++) right ||= bodyColour(rgbaAt(data, w, xx, yy));
          if (left && right) return true;
        }
        return false;
      };
      const hardWhiteLeakPixel = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean => {
        const [r, g, b, a] = rgbaAt(data, w, x, y);
        return a >= 200 && r >= 238 && g >= 238 && b >= 238 && touchesTransparency(data, w, h, x, y);
      };
      const matteLeakPixel = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean => {
        const [r, g, b, a] = rgbaAt(data, w, x, y);
        if (a < 120 || a >= 220) return false;
        if (Math.min(r, g, b) < 222 || Math.max(r, g, b) - Math.min(r, g, b) > 30) return false;
        return touchesTransparency(data, w, h, x, y) && enclosedByBody(data, w, h, x, y);
      };
      const perAction: Record<string, { hardWhiteLeakPixels: number; nearWhiteMattePixels: number; width: number; height: number }> = {};
      let totalHardWhiteLeakPixels = 0;
      let totalNearWhiteMattePixels = 0;
      for (const { action, image } of rows) {
        full.width = image.naturalWidth;
        full.height = image.naturalHeight;
        fullCtx.clearRect(0, 0, full.width, full.height);
        fullCtx.drawImage(image, 0, 0);
        const data = fullCtx.getImageData(0, 0, full.width, full.height).data;
        let hardWhiteLeakPixels = 0;
        let nearWhiteMattePixels = 0;
        for (let y = 0; y < full.height; y++) {
          for (let x = 0; x < full.width; x++) {
            if (hardWhiteLeakPixel(data, full.width, full.height, x, y)) hardWhiteLeakPixels++;
            if (matteLeakPixel(data, full.width, full.height, x, y)) nearWhiteMattePixels++;
          }
        }
        totalHardWhiteLeakPixels += hardWhiteLeakPixels;
        totalNearWhiteMattePixels += nearWhiteMattePixels;
        perAction[action] = {
          hardWhiteLeakPixels,
          nearWhiteMattePixels,
          width: full.width,
          height: full.height,
        };
      }

      const labelW = 132;
      const rowH = 104;
      const pad = 12;
      const cell = 512;
      const sampleFrames = [0, 3, 6, 9, 12, 15, 18, 21];
      const thumb = 88;
      const width = 1280;
      const height = pad * 2 + 34 + rowH * rows.length;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable for sprite QC sheet');
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, height);
      ctx.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#d7dde8';
      ctx.fillText('sprite white-matte QC: sampled authored frames on checkerboard', pad, pad + 10);

      for (let row = 0; row < rows.length; row++) {
        const y = pad + 34 + row * rowH;
        const { action, image } = rows[row];
        ctx.fillStyle = '#d7dde8';
        ctx.fillText(action, pad, y + rowH / 2);

        const x0 = labelW;
        const bgW = sampleFrames.length * (thumb + 10) - 10;
        const bgH = thumb;
        const sq = 12;
        for (let yy = 0; yy < bgH; yy += sq) {
          for (let xx = 0; xx < bgW; xx += sq) {
            ctx.fillStyle = (((xx / sq) | 0) + ((yy / sq) | 0)) % 2 ? '#737a84' : '#2f3742';
            ctx.fillRect(x0 + xx, y + 4 + yy, sq, sq);
          }
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (let i = 0; i < sampleFrames.length; i++) {
          const frame = sampleFrames[i];
          const sx = (frame % 6) * cell;
          const sy = Math.floor(frame / 6) * cell;
          const dx = x0 + i * (thumb + 10);
          const dy = y + 4;
          ctx.drawImage(image, sx, sy, cell, cell, dx, dy, thumb, thumb);
          ctx.strokeStyle = 'rgba(215,221,232,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + 0.5, dy + 0.5, thumb - 1, thumb - 1);
          ctx.fillStyle = 'rgba(17,24,39,0.78)';
          ctx.fillRect(dx + 3, dy + thumb - 18, 30, 14);
          ctx.fillStyle = '#d7dde8';
          ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillText(String(frame).padStart(2, '0'), dx + 6, dy + thumb - 10);
          ctx.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';
        }
      }

      return {
        dataUrl: canvas.toDataURL('image/png'),
        metrics: {
          observed: true,
          hardWhiteBudget: 0,
          nearWhiteMatteBudget: 0,
          totalHardWhiteLeakPixels,
          totalNearWhiteMattePixels,
          perAction,
        },
      };
    }, [...SPRITE_QC_ACTIONS])) as { dataUrl: string; metrics: Record<string, unknown> };
    writeFileSync(resolve(SHOTS, '15-sprite-white-qc.png'), Buffer.from(qc.dataUrl.split(',')[1], 'base64'));
    spriteWhiteMatteQc = qc.metrics;
    const totalHard = (spriteWhiteMatteQc.totalHardWhiteLeakPixels as number) ?? 0;
    const totalMatte = (spriteWhiteMatteQc.totalNearWhiteMattePixels as number) ?? 0;
    if (totalHard !== 0 || totalMatte !== 0) {
      failures.push(`sprite white matte QC: expected 0/0, got hard=${totalHard}, matte=${totalMatte}`);
    }
  } catch (err) {
    failures.push(`15-sprite-white-qc.png: ${String(err)}`);
    spriteWhiteMatteQc = { observed: false, error: String(err) };
  }
  let liveRenderWhiteMatteQc: Record<string, unknown> = { observed: false };
  try {
    if (await awaitMoment(page, 'rally', 60)) {
      await release(page);
    }
    const liveQc = (await page.evaluate(async () => {
      type PlayerBox = {
        id: number;
        side: string;
        action: string;
        locomotion: string;
        x: number;
        y: number;
        w: number;
        h: number;
        hardWhitePixels: number;
        rawCentralVoidWhitePixels: number;
        centralVoidWhitePixels: number;
        centralVoidCandidates?: { x: number; y: number }[];
      };
      type Frame = {
        index: number;
        hardWhitePixels: number;
        rawCentralVoidWhitePixels: number;
        centralVoidWhitePixels: number;
        boxes: PlayerBox[];
        dataUrl: string;
      };

      const game = (window as never as Record<string, any>).__sv90;
      const canvas = document.getElementById('game') as HTMLCanvasElement | null;
      const camera = game?.renderer?.camera;
      if (!game?.world || !canvas || !camera?.project) {
        return { observed: false, error: 'game canvas/camera unavailable' };
      }

      game.qaTimeScale = 1;
      const cssToPixelX = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
      const cssToPixelY = canvas.height / Math.max(1, canvas.clientHeight || canvas.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { observed: false, error: '2D canvas unavailable' };

      const rgbaAt = (data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
      };
      const isHardWhite = ([r, g, b, a]: [number, number, number, number]): boolean =>
        a >= 245 && r >= 242 && g >= 242 && b >= 242 && Math.max(r, g, b) - Math.min(r, g, b) <= 16;
      const isBodyInk = ([r, g, b, a]: [number, number, number, number]): boolean => {
        if (a < 245) return false;
        if (isHardWhite([r, g, b, a])) return false;
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        return luma < 225;
      };
      const hasBodyOnBothSides = (
        data: Uint8ClampedArray,
        width: number,
        height: number,
        x: number,
        y: number,
        box: { x0: number; x1: number },
      ): boolean => {
        let left = false;
        let right = false;
        for (let xx = Math.max(box.x0, x - 18); xx < x; xx++) {
          if (isBodyInk(rgbaAt(data, width, xx, y))) left = true;
        }
        for (let xx = x + 1; xx <= Math.min(box.x1, x + 18); xx++) {
          if (isBodyInk(rgbaAt(data, width, xx, y))) right = true;
        }
        if (left && right) return true;
        for (let yy = Math.max(0, y - 5); yy <= Math.min(height - 1, y + 5); yy++) {
          left = false;
          right = false;
          for (let xx = Math.max(box.x0, x - 14); xx < x; xx++) {
            if (isBodyInk(rgbaAt(data, width, xx, yy))) left = true;
          }
          for (let xx = x + 1; xx <= Math.min(box.x1, x + 14); xx++) {
            if (isBodyInk(rgbaAt(data, width, xx, yy))) right = true;
          }
          if (left && right) return true;
        }
        return false;
      };
      const visibleVoidPixels = (points: { x: number; y: number }[]): number => {
        // Single anti-aliased pixels from highlights or subpixel compositing are
        // not the user-visible defect. The rejected defect is a visible white
        // island/slit between body parts, so count only connected components
        // large enough to be seen at game scale.
        const keys = new Set(points.map((p) => `${p.x},${p.y}`));
        let visible = 0;
        for (const key of [...keys]) {
          if (!keys.has(key)) continue;
          const stack = [key];
          keys.delete(key);
          let size = 0;
          while (stack.length) {
            const current = stack.pop() as string;
            size++;
            const [x, y] = current.split(',').map(Number);
            for (const [nx, ny] of [
              [x - 1, y],
              [x + 1, y],
              [x, y - 1],
              [x, y + 1],
            ] as const) {
              const next = `${nx},${ny}`;
              if (keys.delete(next)) stack.push(next);
            }
          }
          if (size >= 32) visible += size;
        }
        return visible;
      };

      const readFrame = (index: number): Frame => {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const players = [...game.world.home.players, ...game.world.away.players];
        const boxes: PlayerBox[] = [];
        let frameHard = 0;
        let frameRawVoid = 0;
        let frameVoid = 0;
        for (const p of players) {
          const feet = camera.project(p.pos.x, p.pos.y, p.height);
          const unit = 1.9 * feet.scale * 42;
          const x0 = Math.max(0, Math.floor((feet.x - unit * 0.46) * cssToPixelX));
          const x1 = Math.min(canvas.width - 1, Math.ceil((feet.x + unit * 0.46) * cssToPixelX));
          const y0 = Math.max(0, Math.floor((feet.y - unit * 1.88) * cssToPixelY));
          const y1 = Math.min(canvas.height - 1, Math.ceil((feet.y + unit * 0.16) * cssToPixelY));
          const centerX0 = Math.max(x0, Math.floor((feet.x - unit * 0.16) * cssToPixelX));
          const centerX1 = Math.min(x1, Math.ceil((feet.x + unit * 0.16) * cssToPixelX));
          const legY0 = Math.max(y0, Math.floor((feet.y - unit * 0.94) * cssToPixelY));
          const legY1 = Math.min(y1, Math.ceil((feet.y - unit * 0.2) * cssToPixelY));
          let hardWhitePixels = 0;
          const centralVoidCandidates: { x: number; y: number }[] = [];
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              if (!isHardWhite(rgbaAt(image.data, image.width, x, y))) continue;
              hardWhitePixels++;
              if (
                x >= centerX0 &&
                x <= centerX1 &&
                y >= legY0 &&
                y <= legY1 &&
                hasBodyOnBothSides(image.data, image.width, image.height, x, y, { x0, x1 })
              ) {
                centralVoidCandidates.push({ x, y });
              }
            }
          }
          const rawCentralVoidWhitePixels = centralVoidCandidates.length;
          const centralVoidWhitePixels = visibleVoidPixels(centralVoidCandidates);
          frameHard += hardWhitePixels;
          frameRawVoid += rawCentralVoidWhitePixels;
          frameVoid += centralVoidWhitePixels;
          boxes.push({
            id: p.id,
            side: p.side,
            action: p.presentation.action,
            locomotion: p.presentation.locomotion,
            x: x0,
            y: y0,
            w: x1 - x0 + 1,
            h: y1 - y0 + 1,
            hardWhitePixels,
            rawCentralVoidWhitePixels,
            centralVoidWhitePixels,
            centralVoidCandidates:
              centralVoidWhitePixels > 0
                ? centralVoidCandidates.slice(0, 900).map((point) => ({ x: point.x, y: point.y }))
                : undefined,
          });
        }
        return {
          index,
          hardWhitePixels: frameHard,
          rawCentralVoidWhitePixels: frameRawVoid,
          centralVoidWhitePixels: frameVoid,
          boxes,
          dataUrl: canvas.toDataURL('image/png'),
        };
      };

      const frames: Frame[] = [];
      for (let i = 0; i < 8; i++) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, 120));
        frames.push(readFrame(i));
      }

      const load = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('failed to decode live render QC frame'));
          img.src = src;
        });
      const images = await Promise.all(frames.map((f) => load(f.dataUrl)));
      const sheet = document.createElement('canvas');
      sheet.width = 1280;
      sheet.height = 720;
      const out = sheet.getContext('2d');
      if (!out) return { observed: false, error: '2D canvas unavailable for live render QC' };
      out.fillStyle = '#0b1220';
      out.fillRect(0, 0, sheet.width, sheet.height);
      out.fillStyle = '#d7dde8';
      out.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
      out.fillText('live render white-matte QC: real player boxes, 8 rally frames', 18, 30);
      const thumbW = 296;
      const thumbH = 166;
      const gapX = 16;
      const gapY = 70;
      for (let i = 0; i < frames.length; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = 18 + col * (thumbW + gapX);
        const y = 54 + row * (thumbH + gapY);
        out.drawImage(images[i], x, y, thumbW, thumbH);
        const sx = thumbW / canvas.width;
        const sy = thumbH / canvas.height;
        const offenders = frames[i].boxes.filter((b) => b.centralVoidWhitePixels > 0);
        for (const b of frames[i].boxes) {
          out.strokeStyle = b.centralVoidWhitePixels > 0 ? '#ff5b5b' : 'rgba(154,230,180,0.55)';
          out.lineWidth = b.centralVoidWhitePixels > 0 ? 2 : 1;
          out.strokeRect(x + b.x * sx, y + b.y * sy, b.w * sx, b.h * sy);
          if (b.centralVoidCandidates?.length) {
            out.fillStyle = 'rgba(255,230,60,0.9)';
            for (const point of b.centralVoidCandidates) {
              out.fillRect(x + point.x * sx, y + point.y * sy, 1.5, 1.5);
            }
          }
        }
        out.fillStyle = 'rgba(11,18,32,0.84)';
        out.fillRect(x, y + thumbH - 31, thumbW, 31);
        out.fillStyle = offenders.length ? '#ffb4a6' : '#b9f6ca';
        out.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        out.fillText(
          `#${i} hard=${frames[i].hardWhitePixels} raw=${frames[i].rawCentralVoidWhitePixels} visible=${frames[i].centralVoidWhitePixels}`,
          x + 8,
          y + thumbH - 18,
        );
        out.fillText(`offenders=${offenders.map((b) => b.id).join(',') || '-'}`, x + 8, y + thumbH - 6);
      }

      const boxes = frames.flatMap((f) => f.boxes);
      const worstBoxes = boxes
        .filter((b) => b.hardWhitePixels > 0 || b.centralVoidWhitePixels > 0)
        .sort((a, b) => b.centralVoidWhitePixels - a.centralVoidWhitePixels || b.hardWhitePixels - a.hardWhitePixels)
        .slice(0, 12);
      return {
        observed: true,
        frames: frames.length,
        boxes: boxes.length,
        totalHardWhitePixels: frames.reduce((sum, f) => sum + f.hardWhitePixels, 0),
        rawCentralVoidWhitePixels: frames.reduce((sum, f) => sum + f.rawCentralVoidWhitePixels, 0),
        totalCentralVoidWhitePixels: frames.reduce((sum, f) => sum + f.centralVoidWhitePixels, 0),
        worstBoxes,
        frameMetrics: frames.map(({ dataUrl: _dataUrl, ...f }) => f),
        dataUrl: sheet.toDataURL('image/png'),
      };
    })) as Record<string, any>;
    if (typeof liveQc.dataUrl === 'string') {
      writeFileSync(resolve(SHOTS, '32-live-render-white-qc.png'), Buffer.from(liveQc.dataUrl.split(',')[1], 'base64'));
      delete liveQc.dataUrl;
    }
    liveRenderWhiteMatteQc = liveQc;
    if (liveQc.observed !== true) {
      failures.push(`live render white matte QC: not observed (${JSON.stringify(liveQc)})`);
    }
    if (((liveQc.totalCentralVoidWhitePixels as number | undefined) ?? Infinity) !== 0) {
      failures.push(
        `live render white matte QC: expected 0 central white void pixels, got ${liveQc.totalCentralVoidWhitePixels ?? 'missing'}`,
      );
    }
  } catch (err) {
    failures.push(`32-live-render-white-qc.png: ${String(err)}`);
    liveRenderWhiteMatteQc = { observed: false, error: String(err) };
  }

  const captureHotCueQc = async (
    condition: 'hotTimingCue' | 'hotRallyTimingCue',
    file: string,
    label: string,
  ): Promise<Record<string, unknown>> => {
    let result: Record<string, unknown> = { observed: false };
    try {
      if (await awaitMoment(page, condition, 120)) {
        await page.screenshot({ path: resolve(SHOTS, file) });
        result = (await page.evaluate(() => {
          const game = (window as never as Record<string, any>).__sv90;
          const canvas = document.getElementById('game') as HTMLCanvasElement | null;
          const camera = game?.renderer?.camera;
          if (!game?.world || !canvas || !camera?.projectVec) {
            return { observed: false, error: 'game canvas/camera unavailable' };
          }
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return { observed: false, error: '2D canvas unavailable' };
          const cssToPixelX = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
          const cssToPixelY = canvas.height / Math.max(1, canvas.clientHeight || canvas.height);
          const ball = camera.projectVec(game.world.ball.pos);
          const cx = Math.round(ball.x * cssToPixelX);
          const cy = Math.round(ball.y * cssToPixelY);
          const radius = Math.max(28, Math.round(54 * cssToPixelX));
          const x0 = Math.max(0, cx - radius);
          const x1 = Math.min(canvas.width - 1, cx + radius);
          const y0 = Math.max(0, cy - radius);
          const y1 = Math.min(canvas.height - 1, cy + radius);
          const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
          let redPixels = 0;
          let hotDominantPixels = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 180) continue;
            if (r >= 185 && g <= 120 && b <= 140) redPixels++;
            if (r >= 170 && r >= g * 1.55 && r >= b * 1.35) hotDominantPixels++;
          }
          return {
            observed: true,
            phase: game.world.phase,
            cueReady: game.world.playCue?.ready === true,
            serveStrikeReady: game.world.serveStrikeReady === true,
            redPixels,
            hotDominantPixels,
            ball: { x: cx, y: cy, radius },
          };
        })) as Record<string, unknown>;
        await release(page);
      }
      if (result.observed !== true) {
        failures.push(`${label} QC: not observed (${JSON.stringify(result)})`);
      }
      if (((result.redPixels as number | undefined) ?? 0) < HOT_TIMING_GRAMMAR.minimumLiveRedPixels) {
        failures.push(
          `${label} QC: expected >= ${HOT_TIMING_GRAMMAR.minimumLiveRedPixels} red pixels around ball, got ${
            result.redPixels ?? 'missing'
          }`,
        );
      }
      if (((result.hotDominantPixels as number | undefined) ?? 0) < HOT_TIMING_GRAMMAR.minimumLiveRedPixels) {
        failures.push(
          `${label} QC: expected >= ${HOT_TIMING_GRAMMAR.minimumLiveRedPixels} hot-dominant red pixels on/around ball, got ${
            result.hotDominantPixels ?? 'missing'
          }`,
        );
      }
    } catch (err) {
      failures.push(`${file}: ${String(err)}`);
      result = { observed: false, error: String(err) };
    }
    return result;
  };

  const hotTimingCueQc = await captureHotCueQc('hotTimingCue', '33-hot-timing-cue.png', 'hot timing cue');
  await page.evaluate(() => {
    const game = (window as never as Record<string, any>).__sv90;
    game.startQaHotTimingCueScenario(2027, 1);
  });
  const hotRallyTimingCueQc = await captureHotCueQc(
    'hotRallyTimingCue',
    '34-hot-rally-timing-cue.png',
    'hot rally timing cue',
  );

  const animationFrameRichness = await captureAnimationFrameRichness(page);

  // Comparative lineup: a real composed serve formation, not an arbitrary
  // rally frame.  It shows home 1–6 and away 1–6 simultaneously.
  if (await awaitMoment(page, 'serveReady', 120)) {
    await page.screenshot({ path: resolve(SHOTS, '14-team-lineup.png') });
    await release(page);
  }
  if (await awaitMoment(page, 'rally', 60)) {
    await page.screenshot({ path: resolve(SHOTS, '16-arena-v3.png') });
    await release(page);
  }

  await ctx.close();
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  return {
    bodyDrawsPerPlayerPerFrameMax: bodyDraws,
    vectorFallbackDrawsPerFrameMax: vectorFallbackDraws,
    buildInfo,
    arenaV3LayersLoaded,
    officialDiagnostics,
    spriteWhiteMatteQc,
    liveRenderWhiteMatteQc,
    hotTimingCueQc,
    hotRallyTimingCueQc,
    animationFrameRichness,
  };
}

async function captureManualBlockInput(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__sv90));
  await page.evaluate(() => {
    const game = (window as never as Record<string, any>).__sv90;
    game.startQaManualBlockScenario(2026, 1);
  });
  await page.waitForFunction(
    () => {
      const w = (window as never as Record<string, any>).__sv90.world;
      return w.phase === 'rally' && w.possession === 'away' && w.home.active && Math.abs(w.home.active.pos.y) < 2.4;
    },
    undefined,
    { timeout: 5000, polling: 25 },
  );
  await page.evaluate(() => window.focus());
  await page.mouse.click(640, 360);

  const manualBlockReady = async (): Promise<boolean> =>
    page.evaluate(() => {
      const w = (window as never as Record<string, any>).__sv90.world;
      const attempts = w.recentEvents.filter((r: any) => r.event.type === 'blockAttempt' && r.event.side === 'home');
      const blockers = w.home.frontRow().filter((p: any) => p.presentation.action === 'block' && p.airborne);
      return attempts.length >= 2 && blockers.length >= 2;
    });

  for (const key of ['Shift', 'K']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
    if (await manualBlockReady()) break;
    await page.waitForTimeout(80);
  }
  if (!(await manualBlockReady())) {
    for (const key of [
      { key: 'Shift', code: 'ShiftLeft' },
      { key: 'K', code: 'KeyK' },
      { key: ' ', code: 'Space' },
    ]) {
      await page.evaluate(({ key: k, code }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true }));
      }, key);
      await page.waitForTimeout(120);
      await page.evaluate(({ key: k, code }) => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true, cancelable: true }));
      }, key);
      if (await manualBlockReady()) break;
      await page.waitForTimeout(80);
    }
  }
  if (!(await manualBlockReady())) {
    const game = '__sv90' as const;
    for (const code of ['ShiftLeft', 'KeyK', 'Space']) {
      await page.evaluate(
        ({ game: g, keyCode }) => (window as never as Record<string, any>)[g].qaPressKey(keyCode),
        { game, keyCode: code },
      );
      await page.waitForTimeout(120);
      await page.evaluate(
        ({ game: g, keyCode }) => (window as never as Record<string, any>)[g].qaReleaseKey(keyCode),
        { game, keyCode: code },
      );
      if (await manualBlockReady()) break;
      await page.waitForTimeout(80);
    }
  }
  if (!(await manualBlockReady())) {
    for (const code of ['ShiftLeft', 'KeyK', 'Space']) {
      await page.evaluate((keyCode) => {
        (window as never as Record<string, any>).__sv90.qaTapKeyAndStep(keyCode, 6);
      }, code);
      if (await manualBlockReady()) break;
    }
  }
  await page.waitForFunction(
    () => {
      const w = (window as never as Record<string, any>).__sv90.world;
      const attempts = w.recentEvents.filter((r: any) => r.event.type === 'blockAttempt' && r.event.side === 'home');
      const blockers = w.home.frontRow().filter((p: any) => p.presentation.action === 'block' && p.airborne);
      return attempts.length >= 2 && blockers.length >= 2;
    },
    undefined,
    { timeout: 3000, polling: 25 },
  ).catch(() => failures.push('manual block input: jump key did not produce a two-player airborne block'));

  await page.evaluate(() => ((window as never as Record<string, any>).__sv90.qaFreeze = true));
  await page.screenshot({ path: resolve(SHOTS, '19-manual-block-input.png') });
  const result = await page.evaluate(() => {
    const w = (window as never as Record<string, any>).__sv90.world;
    const attempts = w.recentEvents
      .filter((r: any) => r.event.type === 'blockAttempt' && r.event.side === 'home')
      .map((r: any) => r.event.playerId);
    const blockers = w.home.frontRow()
      .filter((p: any) => p.presentation.action === 'block' && p.airborne)
      .map((p: any) => ({
        id: p.id,
        height: p.height,
        action: p.presentation.action,
        phase: p.presentation.phase,
      }));
    return {
      attempts,
      airborneBlockers: blockers,
      activeId: w.home.activeId,
      phase: w.phase,
    };
  });

  await ctx.close();
  if (errors.length) failures.push(`manual block page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureHumanServeIdle(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__sv90));
  for (let i = 0; i < 40; i++) {
    const started = await page.evaluate(
      () => Boolean((window as never as Record<string, any>).__sv90.world),
    );
    if (started) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(
    () => (window as never as Record<string, any>).__sv90.world?.phase === 'serve',
    undefined,
    { timeout: 15_000, polling: 50 },
  );

  // Wait long enough that the old menu-confirm/action leak or the hidden
  // "server is ready, start the serve animation" path would be visible.
  await page.waitForTimeout(1600);
  await page.evaluate(() => ((window as never as Record<string, any>).__sv90.qaFreeze = true));
  await page.screenshot({ path: resolve(SHOTS, '20-human-serve-idle-no-auto.png') });
  const result = await page.evaluate(() => {
    const w = (window as never as Record<string, any>).__sv90.world;
    const server = w.team(w.servingSide).server;
      const contacts = w.recentEvents
        .filter((r: any) => r.event.type === 'contact')
        .map((r: any) => r.event.kind);
      const sprite = (window as never as Record<string, any>).__sv90render
        ?.sprites?.()
        ?.find((s: any) => s.playerId === server.id);
      return {
        phase: w.phase,
        ballFrozen: w.ball.frozen,
        serveTossInFlight: w.serveTossInFlight,
        serveStrikeReady: w.serveStrikeReady,
        contacts,
        sprite,
        server: {
          id: server.id,
          anim: server.anim,
        action: server.presentation.action,
        phase: server.presentation.phase,
        locomotion: server.presentation.locomotion,
        height: server.height,
        plansJumpServe: server.plansJumpServe,
      },
    };
  });

  const server = (result as { server?: { anim?: string; action?: string; locomotion?: string } }).server;
  const sprite = (result as { sprite?: { action?: string } }).sprite;
  const ok =
    (result as { phase?: string }).phase === 'serve' &&
    (result as { ballFrozen?: boolean }).ballFrozen === true &&
    (result as { serveTossInFlight?: boolean }).serveTossInFlight === false &&
    (result as { contacts?: unknown[] }).contacts?.length === 0 &&
    server?.action === 'none' &&
    server?.locomotion !== 'approach' &&
    sprite?.action === 'idle' &&
    !['serve_toss', 'serve_contact', 'air_contact_jump_serve', 'approach_run'].includes(server?.anim ?? '');
  if (!ok) {
    failures.push(`human serve idle: serve started or animated without input (${JSON.stringify(result)})`);
  }

  await ctx.close();
  if (errors.length) failures.push(`human serve idle page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureSingleAttackerShape(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'spikeApproach', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.screenshot({ path: resolve(SHOTS, '21-single-attacker-shape.png') });
  const result = await page.evaluate(() => {
    const w = (window as never as Record<string, any>).__sv90.world;
    const side = w.possession;
    const team = w.team(side);
    const players = team.players.map((p: any) => ({
      id: p.id,
      role: p.role,
      slot: p.rotationSlot,
      x: Number(p.pos.x.toFixed(2)),
      y: Number(p.pos.y.toFixed(2)),
      distanceToBall: Number(Math.hypot(p.pos.x - w.ball.pos.x, p.pos.y - w.ball.pos.y).toFixed(2)),
      action: p.presentation.action,
      phase: p.presentation.phase,
      locomotion: p.presentation.locomotion,
      sourceJob: p.presentation.sourceJob,
    }));
    return {
      observed: true,
      side,
      touches: w.touches,
      ball: {
        x: Number(w.ball.pos.x.toFixed(2)),
        y: Number(w.ball.pos.y.toFixed(2)),
        z: Number(w.ball.pos.z.toFixed(2)),
      },
      attackApproachers: players.filter((p: any) => p.sourceJob === 'attack' && p.locomotion === 'approach'),
      attackJobs: players.filter((p: any) => p.sourceJob === 'attack'),
      approachLocomotion: players.filter((p: any) => p.locomotion === 'approach'),
      supportShape: players.filter((p: any) => p.sourceJob !== 'attack'),
      players,
    };
  });
  await release(page);

  const attackApproachers = (result as { attackApproachers?: unknown[] }).attackApproachers ?? [];
  const attackJobs = (result as { attackJobs?: unknown[] }).attackJobs ?? [];
  const approachLocomotion = (result as { approachLocomotion?: unknown[] }).approachLocomotion ?? [];
  if (attackApproachers.length !== 1 || attackJobs.length !== 1 || approachLocomotion.length !== 1) {
    failures.push(`single attacker shape: expected one attack approacher, got ${JSON.stringify(result)}`);
  }

  await ctx.close();
  if (errors.length) failures.push(`single attacker shape page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiveAttackShapeSequence(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'spikeApproach', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  const result = (await page.evaluate(async () => {
    type PlayerSample = {
      id: number;
      role: string;
      slot: number;
      distanceToBall: number;
      action: string;
      locomotion: string;
      sourceJob: string;
    };
    type Sample = {
      index: number;
      t: number;
      side: string;
      touches: number;
      ball: { x: number; y: number; z: number };
      attackJobs: number;
      attackApproachers: number;
      approachLocomotion: number;
      nonPlayingSupportNearBall: number;
      closestSupportDistance: number;
      players: PlayerSample[];
      dataUrl: string;
    };
    const game = (window as never as Record<string, any>).__sv90;
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!game?.world || !canvas) return { observed: false, error: 'game canvas unavailable' };

    game.qaTimeScale = 1;
    const sampleStep = 0.096;
    const samples: Sample[] = [];
    const sample = (index: number): void => {
      const w = game.world;
      const side = w.possession;
      const team = w.team(side);
      const players: PlayerSample[] = team.players.map((p: any): PlayerSample => ({
        id: p.id,
        role: p.role,
        slot: p.rotationSlot,
        distanceToBall: Number(Math.hypot(p.pos.x - w.ball.pos.x, p.pos.y - w.ball.pos.y).toFixed(2)),
        action: p.presentation.action,
        locomotion: p.presentation.locomotion,
        sourceJob: p.presentation.sourceJob,
      }));
      const nonPlayingSupport = players.filter(
        (p: PlayerSample) => p.sourceJob !== 'attack' && p.action === 'none' && p.locomotion !== 'approach',
      );
      samples.push({
        index,
        t: Number((index * sampleStep).toFixed(3)),
        side,
        touches: w.touches,
        ball: {
          x: Number(w.ball.pos.x.toFixed(2)),
          y: Number(w.ball.pos.y.toFixed(2)),
          z: Number(w.ball.pos.z.toFixed(2)),
        },
        attackJobs: players.filter((p: PlayerSample) => p.sourceJob === 'attack').length,
        attackApproachers: players.filter((p: PlayerSample) => p.sourceJob === 'attack' && p.locomotion === 'approach').length,
        approachLocomotion: players.filter((p: PlayerSample) => p.locomotion === 'approach').length,
        nonPlayingSupportNearBall: nonPlayingSupport.filter((p: PlayerSample) => p.distanceToBall < 2.15).length,
        closestSupportDistance: Number(
          Math.min(...nonPlayingSupport.map((p: PlayerSample) => p.distanceToBall), Number.POSITIVE_INFINITY).toFixed(2),
        ),
        players,
        dataUrl: canvas.toDataURL('image/png'),
      });
    };

    sample(0);
    (window as never as Record<string, any>).__qaRelease();
    for (let i = 1; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, sampleStep * 1000));
      sample(i);
    }

    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('failed to decode attack shape frame'));
        img.src = src;
      });
    const images = await Promise.all(samples.map((s) => load(s.dataUrl)));
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 720;
    const out = sheet.getContext('2d');
    if (!out) return { observed: false, error: '2D canvas unavailable' };
    out.fillStyle = '#0b1220';
    out.fillRect(0, 0, sheet.width, sheet.height);
    out.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    out.textBaseline = 'alphabetic';
    out.fillStyle = '#d7dde8';
    out.fillText('live attack shape: one hitter approaches, support keeps formation', 18, 30);

    const thumbW = 296;
    const thumbH = 166;
    const gapX = 16;
    const gapY = 44;
    const startY = 54;
    for (let i = 0; i < images.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 18 + col * (thumbW + gapX);
      const y = startY + row * (thumbH + gapY);
      out.drawImage(images[i], x, y, thumbW, thumbH);
      out.strokeStyle = 'rgba(215,221,232,0.5)';
      out.lineWidth = 1;
      out.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1);
      out.fillStyle = 'rgba(11,18,32,0.82)';
      out.fillRect(x, y + thumbH - 31, thumbW, 31);
      out.fillStyle = '#d7dde8';
      out.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const s = samples[i];
      out.fillText(
        `#${String(i).padStart(2, '0')} jobs=${s.attackJobs} atkApp=${s.attackApproachers} app=${s.approachLocomotion}`,
        x + 8,
        y + thumbH - 18,
      );
      out.fillText(
        `support<2.15=${s.nonPlayingSupportNearBall} closest=${s.closestSupportDistance}`,
        x + 8,
        y + thumbH - 6,
      );
    }

    const evaluated = samples.filter((s) => s.attackJobs > 0 || s.attackApproachers > 0);
    return {
      observed: true,
      frames: samples.length,
      evaluatedFrames: evaluated.length,
      maxAttackJobs: Math.max(...samples.map((s) => s.attackJobs)),
      maxAttackApproachers: Math.max(...samples.map((s) => s.attackApproachers)),
      maxApproachLocomotion: Math.max(...samples.map((s) => s.approachLocomotion)),
      maxNonPlayingSupportNearBall: Math.max(...samples.map((s) => s.nonPlayingSupportNearBall)),
      minClosestSupportDistance: Number(Math.min(...samples.map((s) => s.closestSupportDistance)).toFixed(2)),
      samples: samples.map(({ dataUrl: _dataUrl, ...s }) => s),
      dataUrl: sheet.toDataURL('image/png'),
    };
  })) as Record<string, any>;

  if (typeof result.dataUrl === 'string') {
    writeFileSync(resolve(SHOTS, '30-live-attack-shape.png'), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
  }
  if (result.observed !== true) failures.push(`live attack shape: not observed (${JSON.stringify(result)})`);
  if (((result.evaluatedFrames as number | undefined) ?? 0) < 4) {
    failures.push(`live attack shape: expected >= 4 attack-shape frames, got ${result.evaluatedFrames ?? 'missing'}`);
  }
  if (((result.maxAttackJobs as number | undefined) ?? Infinity) > 1) {
    failures.push(`live attack shape: maxAttackJobs ${result.maxAttackJobs}, expected <= 1`);
  }
  if (((result.maxAttackApproachers as number | undefined) ?? Infinity) > 1) {
    failures.push(`live attack shape: maxAttackApproachers ${result.maxAttackApproachers}, expected <= 1`);
  }
  if (((result.maxApproachLocomotion as number | undefined) ?? Infinity) > 1) {
    failures.push(`live attack shape: maxApproachLocomotion ${result.maxApproachLocomotion}, expected <= 1`);
  }
  if (((result.maxNonPlayingSupportNearBall as number | undefined) ?? Infinity) > 2) {
    failures.push(
      `live attack shape: maxNonPlayingSupportNearBall ${result.maxNonPlayingSupportNearBall}, expected <= 2`,
    );
  }

  await ctx.close();
  if (errors.length) failures.push(`live attack shape page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureShuffleFootwork(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'shuffleFootwork', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.screenshot({ path: resolve(SHOTS, '22-shuffle-footwork.png') });
  const result = await page.evaluate(() => {
    const w = (window as never as Record<string, any>).__sv90.world;
    const players = w.allPlayers().map((p: any) => ({
      id: p.id,
      side: p.side,
      role: p.role,
      speed: Number(Math.hypot(p.vel.x, p.vel.y).toFixed(2)),
      action: p.presentation.action,
      locomotion: p.presentation.locomotion,
      sourceJob: p.presentation.sourceJob,
      airborne: p.airborne,
    }));
    const byLocomotion = players.reduce((acc: Record<string, number>, p: any) => {
      acc[p.locomotion] = (acc[p.locomotion] ?? 0) + 1;
      return acc;
    }, {});
    return {
      observed: true,
      phase: w.phase,
      byLocomotion,
      walkers: players.filter(
        (p: any) => p.locomotion === 'walk' && p.sourceJob === 'cover' && p.speed >= 0.18 && p.speed < 0.8,
      ),
      shufflers: players.filter(
        (p: any) => p.locomotion === 'shuffle' && p.sourceJob !== 'attack' && p.speed >= 0.25 && p.speed <= 1.65,
      ),
      approachers: players.filter((p: any) => p.locomotion === 'approach'),
      runners: players.filter((p: any) => p.locomotion === 'run'),
      players,
    };
  });
  await release(page);

  const walkers = (result as { walkers?: unknown[] }).walkers ?? [];
  const approachers = (result as { approachers?: unknown[] }).approachers ?? [];
  if (walkers.length < 2 || approachers.length > 1) {
    failures.push(`walk footwork: expected visible walk with at most one approacher, got ${JSON.stringify(result)}`);
  }

  await ctx.close();
  if (errors.length) failures.push(`shuffle footwork page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiberoVisibility(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'serveReady', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.screenshot({ path: resolve(SHOTS, '23-libero-visibility.png') });
  const result = await page.evaluate(() => {
    const w = (window as never as Record<string, any>).__sv90.world;
    const sides = ['home', 'away'].map((side) => {
      const team = w.team(side);
      const liberos = team.players
        .filter((p: any) => p.role === 'libero')
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          slot: p.rotationSlot,
          x: Number(p.pos.x.toFixed(2)),
          y: Number(p.pos.y.toFixed(2)),
          locomotion: p.presentation.locomotion,
          action: p.presentation.action,
        }));
      return {
        side,
        shortName: team.config.shortName,
        playerCount: team.players.length,
        serverRole: team.server.role,
        liberoCount: liberos.length,
        liberos,
      };
    });
    return {
      observed: true,
      phase: w.phase,
      servingSide: w.servingSide,
      sides,
    };
  });
  await release(page);

  const sides = (result as { sides?: { liberoCount: number; playerCount: number; serverRole: string; liberos: { slot: number }[] }[] }).sides ?? [];
  const ok =
    sides.length === 2 &&
    sides.every(
      (side) =>
        side.playerCount === 6 &&
        side.liberoCount === 1 &&
        side.serverRole !== 'libero' &&
        side.liberos.every((libero) => [5, 6].includes(libero.slot)),
    );
  if (!ok) failures.push(`libero visibility: expected one back-row libero per side, got ${JSON.stringify(result)}`);

  await ctx.close();
  if (errors.length) failures.push(`libero visibility page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureRotationLiberoCycle(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'serveReady', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  const result = (await page.evaluate(() => {
    type SlotPlayer = {
      id: number;
      name: string;
      role: string;
      slot: number;
      onCourt: boolean;
      liberoReplacement: boolean;
    };
    type Step = {
      index: number;
      rotationOffset: number;
      playerCount: number;
      serverRole: string;
      frontRowCount: number;
      distinctSlots: number;
      liberoCount: number;
      liberoSlots: number[];
      slots: SlotPlayer[];
      holders: SlotPlayer[];
    };

    const w = (window as never as Record<string, any>).__sv90.world;
    const team = w.home;
    const allSquad = () => (team.squad ?? team.players) as any[];
    const holderPlayers = () => allSquad().filter((p: any) => p.role !== 'libero');
    const onCourtIds = (): Set<number> => new Set<number>(team.players.map((p: any) => p.id));
    const slotPlayer = (p: any, ids: Set<number>): SlotPlayer => ({
      id: p.id,
      name: p.name,
      role: p.role,
      slot: p.rotationSlot,
      onCourt: ids.has(p.id),
      liberoReplacement: p.role === 'libero' || !ids.has(p.id),
    });
    const snapshot = (index: number): Step => {
      const ids = onCourtIds();
      const liberos = team.players.filter((p: any) => p.role === 'libero');
      const slots = team.players
        .map((p: any) => slotPlayer(p, ids))
        .sort((a: SlotPlayer, b: SlotPlayer) => a.slot - b.slot);
      const holders = holderPlayers()
        .map((p: any) => slotPlayer(p, ids))
        .sort((a: SlotPlayer, b: SlotPlayer) => a.slot - b.slot);
      return {
        index,
        rotationOffset: team.rotationOffset,
        playerCount: team.players.length,
        serverRole: team.server.role,
        frontRowCount: team.frontRow().length,
        distinctSlots: new Set(team.players.map((p: any) => p.rotationSlot)).size,
        liberoCount: liberos.length,
        liberoSlots: liberos.map((p: any) => p.rotationSlot),
        slots,
        holders,
      };
    };
    const holderMap = (step: Step) => new Map(step.holders.map((p) => [p.id, p.slot]));

    const steps: Step[] = [];
    const transitions: Array<{
      from: number;
      to: number;
      clockwise: boolean;
      serverFromPreviousSlot2: boolean;
      liberoChange?: { playerId: number; name: string; entered: boolean; slot: number };
    }> = [];
    const initial = snapshot(0);
    steps.push(initial);
    let before = initial;

    for (let i = 0; i < 6; i++) {
      const report = team.rotate();
      team.resetPositions();
      const after = snapshot(i + 1);
      const beforeSlots = holderMap(before);
      const afterSlots = holderMap(after);
      const clockwise = [...beforeSlots.entries()].every(([id, oldSlot]) => {
        const expected = oldSlot === 1 ? 6 : oldSlot - 1;
        return afterSlots.get(id) === expected;
      });
      const oldSlot2 = before.holders.find((p) => p.slot === 2);
      const serverFromPreviousSlot2 = Boolean(oldSlot2 && after.slots.find((p) => p.slot === 1)?.id === oldSlot2.id);
      transitions.push({
        from: before.index,
        to: after.index,
        clockwise,
        serverFromPreviousSlot2,
        liberoChange: report.liberoChange,
      });
      if (i < 5) steps.push(after);
      before = after;
    }

    const final = before;
    const initialSlots = holderMap(initial);
    const finalSlots = holderMap(final);
    const returnedToInitial =
      initial.rotationOffset === final.rotationOffset &&
      [...initialSlots.entries()].every(([id, slot]) => finalSlots.get(id) === slot);

    const stepFailures = steps.flatMap((step) => {
      const out: string[] = [];
      if (step.playerCount !== 6) out.push(`step ${step.index}: playerCount ${step.playerCount}`);
      if (step.distinctSlots !== 6) out.push(`step ${step.index}: distinctSlots ${step.distinctSlots}`);
      if (step.frontRowCount !== 3) out.push(`step ${step.index}: frontRowCount ${step.frontRowCount}`);
      if (step.serverRole === 'libero') out.push(`step ${step.index}: libero is serving`);
      if (step.liberoCount > 1) out.push(`step ${step.index}: liberoCount ${step.liberoCount}`);
      if (!step.liberoSlots.every((slot) => slot === 5 || slot === 6)) {
        out.push(`step ${step.index}: liberoSlots ${step.liberoSlots.join(',')}`);
      }
      return out;
    });
    const transitionFailures = transitions.flatMap((t) => {
      const out: string[] = [];
      if (!t.clockwise) out.push(`transition ${t.from}->${t.to}: not clockwise`);
      if (!t.serverFromPreviousSlot2) out.push(`transition ${t.from}->${t.to}: server did not come from slot 2`);
      return out;
    });
    const hadLiberoOn = steps.some((step) => step.liberoCount === 1);
    const hadLiberoOff = steps.some((step) => step.liberoCount === 0);
    const entered = transitions.some((t) => t.liberoChange?.entered === true);
    const exited = transitions.some((t) => t.liberoChange?.entered === false);
    const failures = [
      ...stepFailures,
      ...transitionFailures,
      ...(returnedToInitial ? [] : ['six rotations did not return holders to initial slots']),
      ...(hadLiberoOn && hadLiberoOff ? [] : ['libero did not visibly alternate on/off court across the cycle']),
      ...(entered && exited ? [] : ['libero substitution reports did not include both entry and exit']),
    ];

    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 940;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#071a1d';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#f6e8bd';
    c.font = '700 34px ui-monospace, Menlo, monospace';
    c.fillText('Rotation + libero cycle: real Team.rotate() diagnostic', 42, 58);
    c.font = '500 18px ui-monospace, Menlo, monospace';
    c.fillStyle = failures.length ? '#ffb4a6' : '#b9f6ca';
    c.fillText(
      failures.length
        ? `${failures.length} invariant failures`
        : 'PASS: clockwise order, server from slot 2, libero enters/exits only back row, three front-row players',
      42,
      90,
    );
    c.fillStyle = '#9cc9c6';
    c.fillText('Slot order: 1 serve -> 6 -> 5 -> 4 -> 3 -> 2 -> 1. Front row: 2, 3, 4.', 42, 118);

    const slotCoords: Record<number, [number, number]> = {
      4: [88, 72],
      3: [250, 72],
      2: [412, 72],
      5: [88, 238],
      6: [250, 238],
      1: [412, 238],
    };
    const roleColour: Record<string, string> = {
      libero: '#ffd166',
      setter: '#70d6ff',
      outside: '#caffbf',
      opposite: '#ffadad',
      middle: '#bdb2ff',
    };

    for (const step of steps) {
      const col = step.index % 3;
      const row = Math.floor(step.index / 3);
      const ox = 42 + col * 516;
      const oy = 158 + row * 372;
      c.fillStyle = '#0e2b30';
      c.strokeStyle = '#3e8787';
      c.lineWidth = 3;
      c.beginPath();
      c.roundRect(ox, oy, 472, 318, 18);
      c.fill();
      c.stroke();

      c.fillStyle = '#f6e8bd';
      c.font = '700 20px ui-monospace, Menlo, monospace';
      c.fillText(`Rotation ${step.index}  offset ${step.rotationOffset}`, ox + 18, oy + 34);
      c.font = '600 13px ui-monospace, Menlo, monospace';
      c.fillStyle = '#92babb';
      c.fillText(`server: ${step.slots.find((p) => p.slot === 1)?.name ?? '?'} (${step.serverRole})`, ox + 18, oy + 58);

      c.strokeStyle = '#66a6a1';
      c.lineWidth = 2;
      c.strokeRect(ox + 56, oy + 76, 380, 206);
      c.beginPath();
      c.moveTo(ox + 56, oy + 179);
      c.lineTo(ox + 436, oy + 179);
      c.moveTo(ox + 246, oy + 76);
      c.lineTo(ox + 246, oy + 282);
      c.stroke();

      for (const p of step.slots) {
        const [x, y] = slotCoords[p.slot];
        const cx = ox + x;
        const cy = oy + y;
        const front = [2, 3, 4].includes(p.slot);
        c.fillStyle = front ? '#173b34' : '#153042';
        c.beginPath();
        c.roundRect(cx - 48, cy - 32, 96, 64, 14);
        c.fill();
        c.strokeStyle = p.slot === 1 ? '#ffffff' : '#3e8787';
        c.lineWidth = p.slot === 1 ? 4 : 2;
        c.stroke();

        c.fillStyle = roleColour[p.role] ?? '#f6e8bd';
        c.font = '800 20px ui-monospace, Menlo, monospace';
        c.fillText(String(p.slot), cx - 38, cy - 8);
        c.font = '700 12px ui-monospace, Menlo, monospace';
        c.fillText(p.role === 'libero' ? 'LIB' : p.role.slice(0, 3).toUpperCase(), cx - 12, cy - 8);
        c.fillStyle = '#f6e8bd';
        c.font = '600 11px ui-monospace, Menlo, monospace';
        c.fillText(p.name.slice(0, 10), cx - 38, cy + 15);
      }

      const transition = transitions[step.index];
      if (transition) {
        c.fillStyle = transition.clockwise && transition.serverFromPreviousSlot2 ? '#b9f6ca' : '#ffb4a6';
        c.font = '700 13px ui-monospace, Menlo, monospace';
        c.fillText(`next: ${transition.clockwise ? 'clockwise' : 'bad order'} / ${transition.serverFromPreviousSlot2 ? 'slot2->serve' : 'bad server'}`, ox + 18, oy + 302);
      }
    }

    return {
      observed: true,
      side: team.side,
      steps,
      transitions,
      returnedToInitial,
      failures,
      dataUrl: canvas.toDataURL('image/png'),
    };
  })) as Record<string, any>;

  writeFileSync(resolve(SHOTS, '29-rotation-libero-cycle.png'), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  delete result.dataUrl;
  if (!result.observed || result.failures.length) {
    failures.push(`rotation/libero cycle: ${JSON.stringify(result)}`);
  }

  await release(page);
  await ctx.close();
  if (errors.length) failures.push(`rotation/libero cycle page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiveSpikeSequence(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'spikePlant', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  const result = (await page.evaluate(async () => {
    type Sample = {
      index: number;
      t: number;
      playerId: number | null;
      action: string;
      phase: string;
      anim: string;
      airborne: boolean;
      height: number;
      contactEvents: number;
      dataUrl: string;
    };
    const game = (window as never as Record<string, any>).__sv90;
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!game?.world || !canvas) return { observed: false, error: 'game canvas unavailable' };

    game.qaTimeScale = 1;
    const sampleStep = 0.096;
    const samples: Sample[] = [];
    const firstSeq = game.world.eventSeq;
    let trackedId: number | null = null;

    const pickSpike = (): any | null => {
      const players = [...game.world.home.players, ...game.world.away.players];
      if (trackedId !== null) {
        const tracked = players.find((p: any) => p.id === trackedId);
        if (tracked) return tracked;
      }
      return (
        players.find((p: any) => p.presentation.action === 'spike') ??
        players.find((p: any) => p.presentation.sourceJob === 'attack' && p.airborne) ??
        players.find((p: any) => p.presentation.sourceJob === 'attack') ??
        null
      );
    };
    const sample = (index: number): void => {
      const p = pickSpike();
      if (trackedId === null && p?.id !== undefined) trackedId = p.id;
      const contactEvents = game.world.recentEvents.filter(
        (r: any) =>
          r.seq >= firstSeq &&
          r.event.type === 'contact' &&
          (r.event.kind === 'spike' || r.event.kind === 'power'),
      ).length;
      samples.push({
        index,
        t: Number((index * sampleStep).toFixed(3)),
        playerId: p?.id ?? null,
        action: p?.presentation?.action ?? 'none',
        phase: p?.presentation?.phase ?? 'none',
        anim: p?.anim ?? 'none',
        airborne: Boolean(p?.airborne),
        height: Number((p?.height ?? 0).toFixed(2)),
        contactEvents,
        dataUrl: canvas.toDataURL('image/png'),
      });
    };

    sample(0);
    (window as never as Record<string, any>).__qaRelease();
    for (let i = 1; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, sampleStep * 1000));
      sample(i);
    }

    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('failed to decode spike frame'));
        img.src = src;
      });
    const images = await Promise.all(samples.map((s) => load(s.dataUrl)));
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 1120;
    const out = sheet.getContext('2d');
    if (!out) return { observed: false, error: '2D canvas unavailable' };
    out.fillStyle = '#0b1220';
    out.fillRect(0, 0, sheet.width, sheet.height);
    out.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    out.textBaseline = 'alphabetic';
    out.fillStyle = '#d7dde8';
    out.fillText('live spike sequence: real match frames after spike plant', 18, 30);

    const thumbW = 296;
    const thumbH = 166;
    const gapX = 16;
    const gapY = 42;
    const startY = 54;
    for (let i = 0; i < images.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 18 + col * (thumbW + gapX);
      const y = startY + row * (thumbH + gapY);
      out.drawImage(images[i], x, y, thumbW, thumbH);
      out.strokeStyle = 'rgba(215,221,232,0.5)';
      out.lineWidth = 1;
      out.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1);
      out.fillStyle = 'rgba(11,18,32,0.78)';
      out.fillRect(x, y + thumbH - 24, thumbW, 24);
      out.fillStyle = '#d7dde8';
      out.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const s = samples[i];
      out.fillText(
        `#${String(i).padStart(2, '0')} t=${s.t}s ${s.action}:${s.phase} anim=${s.anim} h=${s.height} air=${s.airborne ? 'Y' : 'N'}`,
        x + 8,
        y + thumbH - 8,
      );
    }

    const spikeActions = [...new Set(samples.map((s) => s.action).filter((p) => p !== 'none'))];
    const spikePhases = [...new Set(samples.map((s) => s.phase).filter((p) => p !== 'none'))];
    const anims = [...new Set(samples.map((s) => s.anim).filter((a) => a !== 'none'))];
    const trackedSamples = trackedId === null ? 0 : samples.filter((s) => s.playerId === trackedId).length;
    const contactIndex = samples.findIndex((s) => s.contactEvents > 0);
    const afterContact = contactIndex >= 0 ? samples.slice(contactIndex + 1) : [];
    return {
      observed: true,
      playerId: trackedId,
      frames: samples.length,
      trackedSamples,
      spikeActions,
      spikePhases,
      anims,
      airborneFrames: samples.filter((s) => s.airborne).length,
      postContactFrames: afterContact.length,
      postContactFollowFrames: afterContact.filter((s) => s.phase === 'follow').length,
      landingFrames: afterContact.filter((s) => s.phase === 'land' || s.anim === 'land').length,
      recoveryFrames: afterContact.filter((s) => s.phase === 'recover').length,
      contactEvents: Math.max(...samples.map((s) => s.contactEvents)),
      samples: samples.map(({ dataUrl: _dataUrl, ...s }) => s),
      dataUrl: sheet.toDataURL('image/png'),
    };
  })) as Record<string, any>;

  if (typeof result.dataUrl === 'string') {
    writeFileSync(resolve(SHOTS, '25-live-spike-sequence.png'), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
  }

  const phases = new Set((result.spikePhases as string[] | undefined) ?? []);
  for (const phase of ['plant', 'rise', 'contact', 'follow']) {
    if (!phases.has(phase)) failures.push(`live spike sequence: missing ${phase} phase`);
  }
  if ((result.airborneFrames as number | undefined) === undefined || result.airborneFrames < 3) {
    failures.push(`live spike sequence: expected >= 3 airborne frames, got ${result.airborneFrames ?? 'missing'}`);
  }
  if ((result.contactEvents as number | undefined) === undefined || result.contactEvents < 1) {
    failures.push(`live spike sequence: expected a real spike/power contact event, got ${result.contactEvents ?? 'missing'}`);
  }
  if ((result.frames as number | undefined) !== 20) {
    failures.push(`live spike sequence: expected 20 tracked frames, got ${result.frames ?? 'missing'}`);
  }
  if (((result.trackedSamples as number | undefined) ?? 0) < 12) {
    failures.push(`live spike sequence: expected to keep the same hitter in view, got ${result.trackedSamples ?? 'missing'} tracked samples`);
  }
  if (((result.postContactFollowFrames as number | undefined) ?? 0) < 2) {
    failures.push(`live spike sequence: expected >= 2 follow-through frames after contact, got ${result.postContactFollowFrames ?? 'missing'}`);
  }
  if (((result.landingFrames as number | undefined) ?? 0) < 1) {
    failures.push(`live spike sequence: expected a visible landing frame after contact, got ${result.landingFrames ?? 'missing'}`);
  }

  await ctx.close();
  if (errors.length) failures.push(`live spike sequence page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiveDoubleBlockSequence(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  const result = (await page.evaluate(async () => {
    type BlockerSample = {
      id: number;
      side: string;
      x: number;
      y: number;
      height: number;
      phase: string;
    };
    type Sample = {
      index: number;
      t: number;
      phase: string;
      possession: string;
      ball: { x: number; y: number; z: number };
      attackerId: number | null;
      attackerSide: string | null;
      attackerPhase: string;
      attackerHeight: number;
      airborneBlockers: number;
      maxBlockHeight: number;
      blockerIds: number[];
      blockers: BlockerSample[];
      blockAttempts: number;
      blockContacts: number;
      attackContacts: number;
      attackContactsSinceSample: number;
      dataUrl: string;
    };

    const game = (window as never as Record<string, any>).__sv90;
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!game?.world || !canvas) return { observed: false, error: 'game canvas unavailable' };

    game.qaTimeScale = 1;
    const sampleStep = 0.064;
    const preRoll = 6;
    const windowSize = 12;
    const maxSamples = 320;
    const firstSeq = game.world.eventSeq;
    let lastSampleSeq = firstSeq;
    const rolling: Sample[] = [];
    const selected: Sample[] = [];
    const observations: Omit<Sample, 'dataUrl'>[] = [];
    const firstJumpFrame = new Map<number, number>();
    let triggerIndex = -1;

    const allPlayers = (): any[] => [...game.world.home.players, ...game.world.away.players];
    const readEvents = () =>
      game.world.recentEvents
        .filter((r: any) => r.seq >= firstSeq)
        .map((r: any) => r.event);
    const pickAttacker = (): any | null => {
      const players = allPlayers();
      return (
        players.find((p: any) => p.presentation.action === 'spike') ??
        players.find((p: any) => p.presentation.sourceJob === 'attack' && p.airborne) ??
        players.find((p: any) => p.presentation.sourceJob === 'attack') ??
        null
      );
    };
    const sample = (index: number): Sample => {
      const w = game.world;
      const attacker = pickAttacker();
      const newEvents = game.world.recentEvents
        .filter((r: any) => r.seq > lastSampleSeq)
        .map((r: any) => r.event);
      lastSampleSeq = game.world.eventSeq;
      const blockers = allPlayers()
        .filter((p: any) => p.presentation.action === 'block' && p.airborne && Math.abs(p.pos.y) < 1.7)
        .map(
          (p: any): BlockerSample => ({
            id: p.id,
            side: p.side,
            x: Number(p.pos.x.toFixed(2)),
            y: Number(p.pos.y.toFixed(2)),
            height: Number(p.height.toFixed(2)),
            phase: p.presentation.phase,
          }),
        )
        .sort((a: BlockerSample, b: BlockerSample) => a.id - b.id);
      for (const b of blockers) {
        if (b.height > 0.1 && !firstJumpFrame.has(b.id)) firstJumpFrame.set(b.id, index);
      }
      const events = readEvents();
      return {
        index,
        t: Number((index * sampleStep).toFixed(3)),
        phase: w.phase,
        possession: w.possession,
        ball: {
          x: Number(w.ball.pos.x.toFixed(2)),
          y: Number(w.ball.pos.y.toFixed(2)),
          z: Number(w.ball.pos.z.toFixed(2)),
        },
        attackerId: attacker?.id ?? null,
        attackerSide: attacker?.side ?? null,
        attackerPhase: attacker?.presentation?.phase ?? 'none',
        attackerHeight: Number((attacker?.height ?? 0).toFixed(2)),
        airborneBlockers: blockers.length,
        maxBlockHeight: Number((blockers.reduce((max: number, b: BlockerSample) => Math.max(max, b.height), 0)).toFixed(2)),
        blockerIds: blockers.map((b: BlockerSample) => b.id),
        blockers,
        blockAttempts: events.filter((e: any) => e.type === 'blockAttempt').length,
        blockContacts: events.filter(
          (e: any) => e.type === 'blockContact' || (e.type === 'contact' && e.kind === 'block'),
        ).length,
        attackContacts: events.filter(
          (e: any) => e.type === 'contact' && (e.kind === 'spike' || e.kind === 'power'),
        ).length,
        attackContactsSinceSample: newEvents.filter(
          (e: any) => e.type === 'contact' && (e.kind === 'spike' || e.kind === 'power'),
        ).length,
        dataUrl: canvas.toDataURL('image/png'),
      };
    };

    for (let i = 0; i < maxSamples; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, sampleStep * 1000));
      const s = sample(i);
      const withoutData = (({ dataUrl: _dataUrl, ...rest }) => rest)(s);
      observations.push(withoutData);
      if (triggerIndex < 0) {
        rolling.push(s);
        if (rolling.length > preRoll + 1) rolling.shift();
        const doubleBlockIsReadable = s.airborneBlockers >= 2 && s.maxBlockHeight >= 0.35;
        const activeAttackCue =
          s.attackerPhase === 'rise' ||
          s.attackerPhase === 'contact' ||
          s.attackerPhase === 'follow' ||
          s.attackContactsSinceSample > 0;
        if (doubleBlockIsReadable && activeAttackCue) {
          triggerIndex = i;
          selected.push(...rolling);
        }
      } else if (selected.length < windowSize) {
        selected.push(s);
      }
      if (triggerIndex >= 0 && selected.length >= windowSize) break;
    }

    if (selected.length === 0) selected.push(...rolling.slice(-windowSize));

    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('failed to decode double-block frame'));
        img.src = src;
      });
    const images = await Promise.all(selected.map((s) => load(s.dataUrl)));
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 720;
    const out = sheet.getContext('2d');
    if (!out) return { observed: false, error: '2D canvas unavailable' };
    out.fillStyle = '#0b1220';
    out.fillRect(0, 0, sheet.width, sheet.height);
    out.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    out.textBaseline = 'alphabetic';
    out.fillStyle = '#d7dde8';
    out.fillText('live double block sequence: real rally read, jump, apex/contact window', 18, 30);

    const thumbW = 296;
    const thumbH = 166;
    const gapX = 16;
    const gapY = 44;
    const startY = 54;
    for (let i = 0; i < images.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 18 + col * (thumbW + gapX);
      const y = startY + row * (thumbH + gapY);
      out.drawImage(images[i], x, y, thumbW, thumbH);
      out.strokeStyle = 'rgba(215,221,232,0.5)';
      out.lineWidth = 1;
      out.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1);
      out.fillStyle = 'rgba(11,18,32,0.82)';
      out.fillRect(x, y + thumbH - 34, thumbW, 34);
      out.fillStyle = '#d7dde8';
      out.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const s = selected[i];
      out.fillText(
        `#${String(s.index).padStart(3, '0')} atk=${s.attackerPhase} h=${s.attackerHeight} blk=${s.airborneBlockers} maxH=${s.maxBlockHeight}`,
        x + 8,
        y + thumbH - 20,
      );
      out.fillText(
        `attempts=${s.blockAttempts} bContacts=${s.blockContacts} atkContacts=${s.attackContacts}`,
        x + 8,
        y + thumbH - 7,
      );
    }

    const selectedNoData = selected.map(({ dataUrl: _dataUrl, ...s }) => s);
    const maxAirborneBlockers = Math.max(0, ...selected.map((s) => s.airborneBlockers));
    const maxBlockHeight = Math.max(0, ...selected.map((s) => s.maxBlockHeight));
    const doubleBlockFrames = selected.filter((s) => s.airborneBlockers >= 2).length;
    let currentAttackHasContact = false;
    const preAttackDoubleFrames = selected.filter((s) => {
      const beforeContact = !currentAttackHasContact;
      if (s.attackContactsSinceSample > 0 || s.attackerPhase === 'contact') currentAttackHasContact = true;
      return beforeContact && s.airborneBlockers >= 2;
    }).length;
    const blockAttempts = Math.max(0, ...observations.map((s) => s.blockAttempts));
    const blockContacts = Math.max(0, ...observations.map((s) => s.blockContacts));
    const attackContacts = Math.max(0, ...selected.map((s) => s.attackContacts));
    const syncSamples = selected.filter((s) => triggerIndex < 0 || s.index >= triggerIndex);
    const jumpFrames = syncSamples
      .flatMap((s) => s.blockers.filter((b) => b.height > 0.1).map((b) => [b.id, s.index] as const))
      .reduce((acc: Map<number, number>, [id, index]) => {
        if (!acc.has(id)) acc.set(id, index);
        return acc;
      }, new Map<number, number>());
    const firstJumpFrames = [...jumpFrames.values()];
    const firstJumpLagFrames =
      firstJumpFrames.length >= 2 ? Math.max(...firstJumpFrames) - Math.min(...firstJumpFrames) : null;

    return {
      observed: triggerIndex >= 0,
      triggerIndex,
      framesSeen: observations.length,
      frames: selected.length,
      maxAirborneBlockers,
      maxBlockHeight: Number(maxBlockHeight.toFixed(2)),
      doubleBlockFrames,
      preAttackDoubleFrames,
      blockAttempts,
      blockContacts,
      attackContacts,
      firstJumpLagFrames,
      selectedSamples: selectedNoData,
      observations: observations.slice(-24),
      dataUrl: sheet.toDataURL('image/png'),
    };
  })) as Record<string, any>;

  if (typeof result.dataUrl === 'string') {
    writeFileSync(resolve(SHOTS, '31-live-double-block-sequence.png'), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
  }
  if (result.observed !== true) failures.push(`live double block sequence: not observed (${JSON.stringify(result)})`);
  if (((result.frames as number | undefined) ?? 0) < 10) {
    failures.push(`live double block sequence: expected >= 10 frames, got ${result.frames ?? 'missing'}`);
  }
  if (((result.maxAirborneBlockers as number | undefined) ?? 0) < 2) {
    failures.push(
      `live double block sequence: expected >= 2 simultaneous airborne blockers, got ${result.maxAirborneBlockers ?? 'missing'}`,
    );
  }
  if (((result.maxBlockHeight as number | undefined) ?? 0) < 0.45) {
    failures.push(`live double block sequence: expected max block height >= 0.45, got ${result.maxBlockHeight ?? 'missing'}`);
  }
  if (((result.doubleBlockFrames as number | undefined) ?? 0) < 2) {
    failures.push(`live double block sequence: expected >= 2 double-block frames, got ${result.doubleBlockFrames ?? 'missing'}`);
  }
  if (((result.preAttackDoubleFrames as number | undefined) ?? 0) < 1) {
    failures.push(
      `live double block sequence: expected the double block to be up before/during attack contact, got ${result.preAttackDoubleFrames ?? 'missing'} pre-contact frames`,
    );
  }
  if (((result.blockAttempts as number | undefined) ?? 0) < 2) {
    failures.push(`live double block sequence: expected >= 2 blockAttempt events, got ${result.blockAttempts ?? 'missing'}`);
  }
  if (((result.firstJumpLagFrames as number | null | undefined) ?? Infinity) > 4) {
    failures.push(
      `live double block sequence: expected blockers to jump together within 4 frames, got ${result.firstJumpLagFrames ?? 'missing'}`,
    );
  }

  await ctx.close();
  if (errors.length) failures.push(`live double block sequence page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiveJumpServeSequence(browser: Browser): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, 'jumpServeApproach', 120))) {
    await ctx.close();
    return { observed: false };
  }
  await page.evaluate(() => {
    (globalThis as never as { __name?: <T>(target: T) => T }).__name = (target) => target;
  });

  const result = (await page.evaluate(async () => {
    type Sample = {
      index: number;
      t: number;
      playerId: number;
      action: string;
      phase: string;
      locomotion: string;
      airborne: boolean;
      height: number;
      y: number;
      ballFrozen: boolean;
      ballZ: number;
      contactEvents: number;
      dataUrl: string;
    };
    const game = (window as never as Record<string, any>).__sv90;
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    if (!game?.world || !canvas) return { observed: false, error: 'game canvas unavailable' };

    game.qaTimeScale = 1;
    const sampleStep = 0.096;
    const server = game.world.team(game.world.servingSide).server;
    const serverId = server.id;
    const firstSeq = game.world.eventSeq;
    const samples: Sample[] = [];
    const sample = (index: number): void => {
      const s = game.world.team(game.world.servingSide).players.find((p: any) => p.id === serverId) ?? server;
      const contactEvents = game.world.recentEvents.filter(
        (r: any) =>
          r.seq >= firstSeq &&
          r.event.type === 'contact' &&
          r.event.kind === 'serve' &&
          r.event.airborne,
      ).length;
      samples.push({
        index,
        t: Number((index * sampleStep).toFixed(3)),
        playerId: serverId,
        action: s.presentation?.action ?? 'missing',
        phase: s.presentation?.phase ?? 'missing',
        locomotion: s.presentation?.locomotion ?? 'missing',
        airborne: Boolean(s.airborne),
        height: Number((s.height ?? 0).toFixed(2)),
        y: Number((s.pos?.y ?? 0).toFixed(2)),
        ballFrozen: Boolean(game.world.ball.frozen),
        ballZ: Number((game.world.ball.pos?.z ?? 0).toFixed(2)),
        contactEvents,
        dataUrl: canvas.toDataURL('image/png'),
      });
    };

    sample(0);
    (window as never as Record<string, any>).__qaRelease();
    for (let i = 1; i < 18; i++) {
      await new Promise((resolve) => setTimeout(resolve, sampleStep * 1000));
      sample(i);
    }

    const load = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('failed to decode jump-serve frame'));
        img.src = src;
      });
    const images = await Promise.all(samples.map((s) => load(s.dataUrl)));
    const sheet = document.createElement('canvas');
    sheet.width = 1280;
    sheet.height = 720;
    const out = sheet.getContext('2d');
    if (!out) return { observed: false, error: '2D canvas unavailable' };
    out.fillStyle = '#0b1220';
    out.fillRect(0, 0, sheet.width, sheet.height);
    out.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    out.textBaseline = 'alphabetic';
    out.fillStyle = '#d7dde8';
    out.fillText('live jump serve sequence: real run-up, toss, jump and airborne contact', 18, 30);

    const thumbW = 170;
    const thumbH = 96;
    const gapX = 8;
    const gapY = 42;
    const startY = 54;
    for (let i = 0; i < images.length; i++) {
      const col = i % 7;
      const row = Math.floor(i / 7);
      const x = 18 + col * (thumbW + gapX);
      const y = startY + row * (thumbH + gapY);
      out.drawImage(images[i], x, y, thumbW, thumbH);
      out.strokeStyle = 'rgba(215,221,232,0.5)';
      out.lineWidth = 1;
      out.strokeRect(x + 0.5, y + 0.5, thumbW - 1, thumbH - 1);
      out.fillStyle = 'rgba(11,18,32,0.78)';
      out.fillRect(x, y + thumbH - 22, thumbW, 22);
      out.fillStyle = '#d7dde8';
      out.font = '700 8px ui-monospace, SFMono-Regular, Menlo, monospace';
      const s = samples[i];
      out.fillText(
        `#${String(i).padStart(2, '0')} ${s.action}:${s.phase} ${s.locomotion} h=${s.height} ball=${s.ballZ}`,
        x + 5,
        y + thumbH - 7,
      );
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const runUpDistance = Math.abs(last.y - first.y);
    return {
      observed: true,
      playerId: serverId,
      frames: samples.length,
      runUpDistance: Number(runUpDistance.toFixed(2)),
      phases: [...new Set(samples.map((s) => `${s.action}:${s.phase}`))],
      locomotions: [...new Set(samples.map((s) => s.locomotion))],
      airborneFrames: samples.filter((s) => s.airborne).length,
      ballReleasedFrames: samples.filter((s) => !s.ballFrozen).length,
      contactEvents: Math.max(...samples.map((s) => s.contactEvents)),
      samples: samples.map(({ dataUrl: _dataUrl, ...s }) => s),
      dataUrl: sheet.toDataURL('image/png'),
    };
  })) as Record<string, any>;

  if (typeof result.dataUrl === 'string') {
    writeFileSync(resolve(SHOTS, '28-live-jump-serve-sequence.png'), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
  }

  const phases = new Set((result.phases as string[] | undefined) ?? []);
  const locomotions = new Set((result.locomotions as string[] | undefined) ?? []);
  if (!locomotions.has('approach')) failures.push('live jump serve sequence: missing approach run-up');
  for (const phase of ['jumpServe:plant', 'jumpServe:rise', 'jumpServe:contact']) {
    if (!phases.has(phase)) failures.push(`live jump serve sequence: missing ${phase}`);
  }
  if (((result.runUpDistance as number | undefined) ?? 0) < 0.8) {
    failures.push(`live jump serve sequence: expected run-up >= 0.8 m, got ${result.runUpDistance ?? 'missing'}`);
  }
  if (((result.airborneFrames as number | undefined) ?? 0) < 3) {
    failures.push(`live jump serve sequence: expected >= 3 airborne frames, got ${result.airborneFrames ?? 'missing'}`);
  }
  if (((result.ballReleasedFrames as number | undefined) ?? 0) < 6) {
    failures.push(`live jump serve sequence: expected visible tossed ball, got ${result.ballReleasedFrames ?? 'missing'} released frames`);
  }
  if (((result.contactEvents as number | undefined) ?? 0) < 1) {
    failures.push(`live jump serve sequence: expected airborne serve contact, got ${result.contactEvents ?? 'missing'}`);
  }
  const samples = (result.samples as { action?: string; phase?: string; contactEvents?: number }[] | undefined) ?? [];
  const firstContactIndex = samples.findIndex((s) => (s.contactEvents ?? 0) > 0);
  const fakeServeContacts = samples
    .slice(0, firstContactIndex < 0 ? samples.length : firstContactIndex)
    .filter((s) => s.action === 'serve' && s.phase === 'contact').length;
  if (fakeServeContacts > 0) {
    failures.push(
      `live jump serve sequence: observed ${fakeServeContacts} serve:contact frame(s) before the actual serve contact event`,
    );
  }

  await ctx.close();
  if (errors.length) failures.push(`live jump serve sequence page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureLiveLocomotionSequence(
  browser: Browser,
  opts: {
    condition: string;
    file: string;
    title: string;
    locomotion: 'run' | 'shuffle' | 'walk';
    minMatchingSamples: number;
    minDistance: number;
    timeout?: number;
  },
): Promise<Record<string, unknown>> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startDemo(page, SEED, FAST);
  if (!(await awaitMoment(page, opts.condition, opts.timeout ?? 120))) {
    await ctx.close();
    return { observed: false };
  }
  const result = await observeLocomotion(page, opts.locomotion, opts.title, 45000);

  if (typeof result.dataUrl === 'string') {
    writeFileSync(resolve(SHOTS, opts.file), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    delete result.dataUrl;
  }
  if (result.observed !== true) {
    failures.push(`${opts.file}: locomotion sequence not observed (${JSON.stringify(result)})`);
  }
  if ((result.frames as number | undefined) !== 12) {
    failures.push(`${opts.file}: expected 12 frames, got ${result.frames ?? 'missing'}`);
  }
  if (((result.matchingSamples as number | undefined) ?? 0) < opts.minMatchingSamples) {
    failures.push(
      `${opts.file}: expected >= ${opts.minMatchingSamples} ${opts.locomotion} samples, got ${result.matchingSamples ?? 'missing'}`,
    );
  }
  if (((result.distance as number | undefined) ?? 0) < opts.minDistance) {
    failures.push(`${opts.file}: expected distance >= ${opts.minDistance} m, got ${result.distance ?? 'missing'}`);
  }
  if (opts.locomotion === 'walk' && ((result.maxMatchingSpeed as number | undefined) ?? Infinity) > 0.8) {
    failures.push(`${opts.file}: walk exceeded short-step speed, max ${result.maxMatchingSpeed ?? 'missing'} m/s`);
  }
  if (opts.locomotion === 'shuffle' && ((result.maxMatchingSpeed as number | undefined) ?? Infinity) > 1.65) {
    failures.push(`${opts.file}: shuffle exceeded walk speed, max ${result.maxMatchingSpeed ?? 'missing'} m/s`);
  }
  if (opts.locomotion === 'run' || opts.locomotion === 'walk') {
    if (result.completeCycle !== true || result.distinctAnimTicks !== 24 || result.playerIds?.length !== 1) {
      failures.push(`${opts.file}: no complete uninterrupted 24-frame cycle of one player (${JSON.stringify({ playerIds: result.playerIds, frames: result.visitedFrames })})`);
    }
  }
  if (opts.locomotion !== 'walk' && ((result.distinctAnimTicks as number | undefined) ?? 0) < 3) {
    failures.push(
      `${opts.file}: expected at least 3 distinct animation ticks, got ${result.distinctAnimTicks ?? 'missing'}`,
    );
  }

  await ctx.close();
  if (errors.length) failures.push(`${opts.file} page errors: ${errors.slice(0, 3).join(' | ')}`);
  return result as Record<string, unknown>;
}

async function captureVideos(browser: Browser): Promise<void> {
  for (const scene of VIDEO_LIST) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: VIDEOS, size: { width: 1280, height: 720 } },
    });
    const page = await ctx.newPage();
    // Fast-forward to just before the moment, then drop to real time and film.
    await startDemo(page, SEED, FAST);
    if (scene.condition) {
      await awaitMoment(page, scene.condition, scene.condition === 'jumpServeToss' ? 120 : 90);
      await page.evaluate(() => ((window as never as Record<string, any>).__sv90.qaTimeScale = 1));
      await release(page);
    }
    await page.waitForTimeout(scene.seconds * 1000);
    const video = page.video();
    await ctx.close();
    if (!video) {
      failures.push(`no video recorded for ${scene.file}`);
      continue;
    }
    const raw = await video.path();
    renameSync(raw, resolve(VIDEOS, scene.file));
    console.log(`  recorded ${scene.file}`);
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(VIDEOS, { recursive: true });

  // Gameplay numbers come from headless matches: many more of them, and no
  // browser in the way. The same module gates the unit tests.
  console.log('measuring gameplay...');
  const gameplay = measureGameplay([1337, 4242, 90210, 7, 11, 2026], 9000);
  const gameplayViolations = checkGameplayGates(gameplay);
  console.log('measuring serve trajectory variety...');
  const serveLab = summarizeServeSweep(runServeSweep(32));
  if (serveLab.served < 24) {
    failures.push(`serveLab.served: expected >= 24, got ${serveLab.served}`);
  }
  if (serveLab.jumped < 10) {
    failures.push(`serveLab.jumped: expected >= 10, got ${serveLab.jumped}`);
  }
  if (serveLab.inLandings < 20) {
    failures.push(`serveLab.inLandings: expected >= 20, got ${serveLab.inLandings}`);
  }
  if (serveLab.landingSpreadX < 0.75) {
    failures.push(`serveLab.landingSpreadX: expected >= 0.75, got ${serveLab.landingSpreadX.toFixed(2)}`);
  }
  if (serveLab.landingSpreadY < 0.9) {
    failures.push(`serveLab.landingSpreadY: expected >= 0.90, got ${serveLab.landingSpreadY.toFixed(2)}`);
  }
  if (serveLab.speedSpread < 2) {
    failures.push(`serveLab.speedSpread: expected >= 2.0, got ${serveLab.speedSpread.toFixed(2)}`);
  }
  if (serveLab.jumpServeMeanSpeed <= serveLab.standingServeMeanSpeed + 2.5) {
    failures.push(
      `serveLab.jumpServeMeanSpeed: expected > standing + 2.5, got ${serveLab.jumpServeMeanSpeed.toFixed(2)} vs ${serveLab.standingServeMeanSpeed.toFixed(2)}`,
    );
  }

  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let render: Record<string, unknown> = {};
  try {
    server = await createServer({ server: { port: PORT, strictPort: true } });
    await server.listen();
    browser = await chromium.launch(LAUNCH);

    console.log('capturing screenshots from real play...');
    render = await captureScreenshots(browser);
    console.log('capturing manual block input...');
    render.manualBlockInput = await captureManualBlockInput(browser);
    console.log('capturing human serve idle...');
    render.humanServeIdle = await captureHumanServeIdle(browser);
    console.log('capturing single attacker shape...');
    render.singleAttackerShape = await captureSingleAttackerShape(browser);
    console.log('capturing live attack shape...');
    render.liveAttackShape = await captureLiveAttackShapeSequence(browser);
    console.log('capturing shuffle footwork...');
    render.shuffleFootwork = await captureShuffleFootwork(browser);
    console.log('capturing libero visibility...');
    render.liberoVisibility = await captureLiberoVisibility(browser);
    console.log('capturing rotation/libero cycle...');
    render.rotationLiberoCycle = await captureRotationLiberoCycle(browser);
    console.log('capturing live spike sequence...');
    render.liveSpikeSequence = await captureLiveSpikeSequence(browser);
    console.log('capturing live double block sequence...');
    render.liveDoubleBlockSequence = await captureLiveDoubleBlockSequence(browser);
    console.log('capturing live jump serve sequence...');
    render.liveJumpServeSequence = await captureLiveJumpServeSequence(browser);
    console.log('capturing live run stride...');
    render.liveRunStride = await captureLiveLocomotionSequence(browser, {
      condition: 'runFootwork',
      file: '26-live-run-stride.png',
      title: 'live run stride: real match frames with a travelling runner',
      locomotion: 'run',
      minMatchingSamples: 4,
      minDistance: 0.45,
    });
    console.log('capturing live walk stride...');
    render.liveWalkStride = await captureLiveLocomotionSequence(browser, {
      condition: 'shuffleFootwork',
      file: '27-live-walk-stride.png',
      title: 'live walk stride: real match frames during short repositioning',
      locomotion: 'walk',
      minMatchingSamples: 6,
      minDistance: 0.04,
    });
    console.log('recording videos...');
    await captureVideos(browser);
  } finally {
    await browser?.close();
    await server?.close();
  }

  const bodyDraws = (render.bodyDrawsPerPlayerPerFrameMax as number) ?? 0;
  if (bodyDraws > 1) failures.push(`bodyDrawsPerPlayerPerFrameMax = ${bodyDraws}, expected 1`);
  if (bodyDraws < 1) failures.push('no player bodies were drawn at all');
  const vectorFallbackDraws = (render.vectorFallbackDrawsPerFrameMax as number) ?? 0;
  if (vectorFallbackDraws !== 0) {
    failures.push(`vectorFallbackDrawsPerFrameMax = ${vectorFallbackDraws}, expected 0`);
  }

  const buildInfo = (render.buildInfo as Record<string, string> | null) ?? null;
  const arenaV3LayersLoaded = (render.arenaV3LayersLoaded as number) ?? 0;
  if (arenaV3LayersLoaded !== 5) {
    failures.push(`arenaV3LayersLoaded = ${arenaV3LayersLoaded}, expected 5`);
  }
  const officialDiagnostics = (render.officialDiagnostics as Record<string, any> | null) ?? null;
  if (!officialDiagnostics) {
    failures.push('officialDiagnostics missing from renderer');
  } else {
    if (officialDiagnostics.ballKids !== 0) {
      failures.push(`officialDiagnostics.ballKids = ${officialDiagnostics.ballKids}, expected 0`);
    }
    if (officialDiagnostics.officialsUsingPlayerRenderer !== false) {
      failures.push('officialDiagnostics.officialsUsingPlayerRenderer must be false');
    }
    if (officialDiagnostics.referee?.seated !== true) {
      failures.push('officialDiagnostics.referee.seated must be true');
    }
    if (officialDiagnostics.atlas?.loaded !== true || !(officialDiagnostics.referee?.rasterDraws > 0)) {
      failures.push('official illustrations were not loaded and drawn');
    }
    if (officialDiagnostics.referee?.spriteCropBottom !== 1) {
      failures.push(
        'the seated referee and chair must be drawn as a complete illustration',
      );
    }
    if (officialDiagnostics.referee?.lowerBodyPaintOrder !== 'included-in-illustration') {
      failures.push('the referee must use his illustrated seated legs');
    }
    if (officialDiagnostics.referee?.hasStool !== true || officialDiagnostics.referee?.hasLadder !== true) {
      failures.push('officialDiagnostics.referee chair must include stool and ladder');
    }
    if (officialDiagnostics.referee?.chairStyle !== 'complete-manga-chair-and-seated-referee') {
      failures.push('the complete illustrated referee/chair asset must be used');
    }
    if (officialDiagnostics.referee?.chairSilhouette !== 'authored-full-cutout') {
      failures.push(
        'the referee/chair must use the full cutout',
      );
    }
    if (officialDiagnostics.referee?.proceduralBodyDraws !== 0) {
      failures.push('procedural officials must not cover the illustrations');
    }
    if (((officialDiagnostics.referee?.visualScale as number | undefined) ?? 0) < 1.3) {
      failures.push('officialDiagnostics.referee.visualScale must be >= 1.3');
    }
    if (officialDiagnostics.referee?.offsetFromNetLine !== true) {
      failures.push('officialDiagnostics.referee must be offset from the net line');
    }
    if (officialDiagnostics.lineJudges?.count !== 2) {
      failures.push(`officialDiagnostics.lineJudges.count = ${officialDiagnostics.lineJudges?.count}, expected 2`);
    }
    if (officialDiagnostics.lineJudges?.diagonalCorners !== true) {
      failures.push('officialDiagnostics.lineJudges.diagonalCorners must be true');
    }
    if (officialDiagnostics.atlas?.frameCount !== 8) {
      failures.push(`officialDiagnostics.atlas.frameCount = ${officialDiagnostics.atlas?.frameCount}, expected 8`);
    }
  }
  const metrics = {
    branch: buildInfo?.branch ?? 'unknown',
    commit: buildInfo?.commit ?? 'unknown',
    runId: buildInfo?.runId ?? 'local',
    bodyDrawsPerPlayerPerFrameMax: bodyDraws,
    vectorFallbackDrawsPerFrameMax: vectorFallbackDraws,
    arenaV3LayersLoaded,
    distinctCharacterSignaturesHome: gameplay.distinctCharacterSignaturesHome,
    distinctCharacterSignaturesAway: gameplay.distinctCharacterSignaturesAway,
    serveReadyApproachPlayers: gameplay.serveReadyApproachPlayers,
    maxConcurrentApproachPlayers: gameplay.maxConcurrentApproachPlayers,
    maxConcurrentAttackJobs: gameplay.maxConcurrentAttackJobs,
    longestOverTwoApproach: gameplay.longestOverTwoApproach,
    longestApproachRun: gameplay.longestApproachRun,
    locomotion: gameplay.locomotion,
    courtOrder: gameplay.courtOrder,
    backFacingContacts: gameplay.backFacingContacts,
    contactsByKind: gameplay.contactsByKind,
    jumpServe: gameplay.jumpServe,
    serveLab,
    spike: gameplay.spike,
    block: gameplay.block,
    ballKids: 0,
    officialsUsingPlayerRenderer: false,
    officialDiagnostics,
    screenshots: [
      '00-build-id.png',
      '01-menu.png',
      ...SHOT_LIST.map((s) => s.file),
      '14-team-lineup.png',
      '15-sprite-white-qc.png',
      '32-live-render-white-qc.png',
      '33-hot-timing-cue.png',
      '34-hot-rally-timing-cue.png',
      '16-arena-v3.png',
      '19-manual-block-input.png',
      '20-human-serve-idle-no-auto.png',
      '21-single-attacker-shape.png',
      '30-live-attack-shape.png',
      '22-shuffle-footwork.png',
      '23-libero-visibility.png',
      '24-animation-frame-richness.png',
      '25-live-spike-sequence.png',
      '26-live-run-stride.png',
      '27-live-walk-stride.png',
      '28-live-jump-serve-sequence.png',
      '29-rotation-libero-cycle.png',
      '31-live-double-block-sequence.png',
    ],
    videos: VIDEO_LIST.map((v) => v.file),
    spriteWhiteMatteQc: render.spriteWhiteMatteQc,
    liveRenderWhiteMatteQc: render.liveRenderWhiteMatteQc,
    hotTimingCueQc: render.hotTimingCueQc,
    hotRallyTimingCueQc: render.hotRallyTimingCueQc,
    animationFrameRichness: render.animationFrameRichness,
    manualBlockInput: render.manualBlockInput,
    humanServeIdle: render.humanServeIdle,
    singleAttackerShape: render.singleAttackerShape,
    liveAttackShape: render.liveAttackShape,
    shuffleFootwork: render.shuffleFootwork,
    liberoVisibility: render.liberoVisibility,
    rotationLiberoCycle: render.rotationLiberoCycle,
    liveSpikeSequence: render.liveSpikeSequence,
    liveDoubleBlockSequence: render.liveDoubleBlockSequence,
    liveJumpServeSequence: render.liveJumpServeSequence,
    liveRunStride: render.liveRunStride,
    liveWalkStride: render.liveWalkStride,
    violations: [...gameplayViolations.map((v) => `${v.metric}: expected ${v.expected}, got ${v.actual}`), ...failures],
  };
  writeFileSync(resolve(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  if (existsSync(resolve('public/build-info.json'))) {
    writeFileSync(resolve(OUT, 'build-info.json'), readFileSync(resolve('public/build-info.json')));
  }

  console.log(`\nbody draws per player per frame: ${bodyDraws}`);
  console.log(`vector fallback draws/frame:     ${vectorFallbackDraws}`);
  console.log(`arena v3 layers:                ${arenaV3LayersLoaded}/5`);
  console.log(`character signatures:           ${gameplay.distinctCharacterSignaturesHome} / ${gameplay.distinctCharacterSignaturesAway}`);
  console.log(`back-facing contacts:           ${gameplay.backFacingContacts}`);
  console.log(`block attempts / contacts:      ${gameplay.block.attempts} / ${gameplay.block.contacts}`);
  console.log(`artifacts in ${OUT}`);

  if (metrics.violations.length) {
    console.error(`\n${metrics.violations.length} automated visual QA failure(s):`);
    for (const v of metrics.violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('\nautomated visual QA passed; artistic review still required');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
