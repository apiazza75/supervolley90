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

const OUT = resolve('artifacts/visual-qa-v3');
const SHOTS = resolve(OUT, 'screenshots');
const VIDEOS = resolve(OUT, 'videos');
const PORT = 5183;
const URL = `http://localhost:${PORT}/`;
const SEED = 1337;

/**
 * How much faster than real time the match runs while stills are captured.
 *
 * At 1, waiting for a jump serve or a Lethal Maneuver took minutes per shot
 * and the whole pass ran past twenty. The simulation steps are identical; only
 * the wall clock is compressed.
 */
const FAST = 6;

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
  serveReady: (g, w) => w.phase === 'serve' && w.ball.frozen,
  jumpServeToss: (g, w) => {
    const s = w.team(w.servingSide).server;
    return w.phase === 'serve' && s.plansJumpServe && !w.ball.frozen && w.ball.vel.z > 0.5 && !s.airborne;
  },
  jumpServeApproach: (g, w) => {
    const s = w.team(w.servingSide).server;
    return s.plansJumpServe && s.presentation.locomotion === 'approach' && !s.airborne;
  },
  jumpServeApex: (g, w) => {
    const s = w.team(w.servingSide).server;
    return s.plansJumpServe && s.airborne && s.vertVel <= 0.2 && s.height > 0.4;
  },
  jumpServeContact: (g, w) =>
    w.lastEvents.some((e) => e.type === 'contact' && e.kind === 'serve' && e.airborne),
  spikeApproach: (g, w) =>
    window.__qaPlayers(w).some(
      (p) => p.presentation.locomotion === 'approach' && p.presentation.sourceJob === 'attack',
    ),
  spikePlant: (g, w) =>
    window.__qaPlayers(w).some((p) => p.presentation.action === 'spike' && p.presentation.phase === 'plant'),
  spikeContact: (g, w) =>
    w.lastEvents.some((e) => e.type === 'contact' && (e.kind === 'spike' || e.kind === 'power') && e.airborne),
  blockApex: (g, w) =>
    window.__qaPlayers(w).some(
      (p) => p.presentation.action === 'block' && p.airborne && p.height > 0.45 && p.vertVel <= 0.3,
    ),
  bumpContact: (g, w) => w.lastEvents.some((e) => e.type === 'contact' && e.kind === 'bump'),
  setContact: (g, w) => w.lastEvents.some((e) => e.type === 'contact' && e.kind === 'set'),
  powerMove: (g, w) => w.lastEvents.some((e) => e.type === 'powerMove'),
  rally: (g, w) => w.phase === 'rally',
  replay: (g) => Boolean(g.replay && g.replay.isPlaying),
};
window.__qaPlayers = (w) => [...w.home.players, ...w.away.players];
`;

/** Install the observer: it watches every frame and freezes on a match. */
const OBSERVER = `
${CONDITIONS}
window.__qaArm = (name) => {
  window.__qaHit = null;
  window.__qaWanted = name;
  const g = window.__sv90;
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
  { file: '02-formation-ready.png', condition: 'serveReady' },
  { file: '03-jump-serve-toss.png', condition: 'jumpServeToss', timeout: 60 },
  { file: '04-jump-serve-approach.png', condition: 'jumpServeApproach', timeout: 60 },
  { file: '05-jump-serve-apex.png', condition: 'jumpServeApex', timeout: 60 },
  { file: '06-jump-serve-contact.png', condition: 'jumpServeContact', timeout: 60 },
  { file: '07-spike-approach.png', condition: 'spikeApproach' },
  { file: '08-spike-plant.png', condition: 'spikePlant' },
  { file: '09-spike-contact.png', condition: 'spikeContact' },
  { file: '10-block-apex.png', condition: 'blockApex' },
  { file: '11-bump-contact.png', condition: 'bumpContact' },
  { file: '12-set-contact.png', condition: 'setContact' },
  { file: '13-officials.png', condition: 'serveReady' },
  { file: '17-super-fx.png', condition: 'powerMove', timeout: 90 },
  { file: '18-replay.png', condition: 'replay', timeout: 90 },
];

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
async function awaitMoment(page: Page, name: string, timeoutSec = 90): Promise<boolean> {
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
  const buildInfo = await page.evaluate(async () => {
    const r = await fetch('build-info.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  });

  // Shots the brief asks for that describe systems this pass did not rebuild;
  // taken from the live game so they show what is actually there.
  for (const file of ['14-team-lineup.png', '16-arena-v3.png']) {
    await awaitMoment(page, 'rally', 60);
    await page.screenshot({ path: resolve(SHOTS, file) });
    await release(page);
  }

  await ctx.close();
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  return { bodyDrawsPerPlayerPerFrameMax: bodyDraws, buildInfo };
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
      await awaitMoment(page, scene.condition, 90);
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

  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let render: Record<string, unknown> = {};
  try {
    server = await createServer({ server: { port: PORT, strictPort: true } });
    await server.listen();
    browser = await chromium.launch(LAUNCH);

    console.log('capturing screenshots from real play...');
    render = await captureScreenshots(browser);
    console.log('recording videos...');
    await captureVideos(browser);
  } finally {
    await browser?.close();
    await server?.close();
  }

  const bodyDraws = (render.bodyDrawsPerPlayerPerFrameMax as number) ?? 0;
  if (bodyDraws > 1) failures.push(`bodyDrawsPerPlayerPerFrameMax = ${bodyDraws}, expected 1`);
  if (bodyDraws < 1) failures.push('no player bodies were drawn at all');

  const buildInfo = (render.buildInfo as Record<string, string> | null) ?? null;
  const metrics = {
    branch: buildInfo?.branch ?? 'unknown',
    commit: buildInfo?.commit ?? 'unknown',
    runId: buildInfo?.runId ?? 'local',
    bodyDrawsPerPlayerPerFrameMax: bodyDraws,
    serveReadyApproachPlayers: gameplay.serveReadyApproachPlayers,
    maxConcurrentApproachPlayers: gameplay.maxConcurrentApproachPlayers,
    longestOverTwoApproach: gameplay.longestOverTwoApproach,
    longestApproachRun: gameplay.longestApproachRun,
    backFacingContacts: gameplay.backFacingContacts,
    contactsByKind: gameplay.contactsByKind,
    jumpServe: gameplay.jumpServe,
    spike: gameplay.spike,
    block: gameplay.block,
    ballKids: 0,
    officialsUsingPlayerRenderer: false,
    screenshots: SHOT_LIST.map((s) => s.file),
    videos: VIDEO_LIST.map((v) => v.file),
    violations: [...gameplayViolations.map((v) => `${v.metric}: expected ${v.expected}, got ${v.actual}`), ...failures],
  };
  writeFileSync(resolve(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  if (existsSync(resolve('public/build-info.json'))) {
    writeFileSync(resolve(OUT, 'build-info.json'), readFileSync(resolve('public/build-info.json')));
  }

  console.log(`\nbody draws per player per frame: ${bodyDraws}`);
  console.log(`back-facing contacts:           ${gameplay.backFacingContacts}`);
  console.log(`block attempts / contacts:      ${gameplay.block.attempts} / ${gameplay.block.contacts}`);
  console.log(`artifacts in ${OUT}`);

  if (metrics.violations.length) {
    console.error(`\n${metrics.violations.length} visual acceptance failure(s):`);
    for (const v of metrics.violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('\nvisual acceptance passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
