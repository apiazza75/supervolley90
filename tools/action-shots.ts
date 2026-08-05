/**
 * Action-frame capture: drives the real game and screenshots the exact moments
 * that matter — the spike arch at the apex, the block, the serve toss, and a
 * human jump serve performed through the actual keys.
 *
 * This exists because still frames taken at random moments only ever showed
 * players standing between actions, which let bad action poses ship unseen.
 *
 *   CHROMIUM_PATH=... npx tsx tools/action-shots.ts [outDir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'action-shots');

interface Snapshot {
  phase: string;
  tossInFlight: boolean;
  strikeReady: boolean;
  serverAirborne: boolean;
  airborne: { anim: string; vertVel: number; side: string }[];
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 5177, strictPort: true } });
  await server.listen();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  // Press until the match actually starts, rather than assuming four presses
  // at a fixed cadence get through the menu. The menu holds a cooldown between
  // presses and the sheets are being prepared in the background, so a fixed
  // rhythm can lose a press and leave the harness waiting on a menu.
  for (let i = 0; i < 40; i++) {
    const started = await page.evaluate(
      () => Boolean((window as unknown as { __sv90?: { world?: unknown } }).__sv90?.world),
    );
    if (started) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(
    () => (window as unknown as { __sv90?: { world?: { phase: string } } }).__sv90?.world?.phase === 'serve',
    undefined,
    { timeout: 15000 },
  );

  const snap = (): Promise<Snapshot> =>
    page.evaluate(() => {
      const w = (window as unknown as { __sv90: { world: any } }).__sv90.world;
      const server = w.team(w.servingSide).server;
      return {
        phase: w.phase,
        tossInFlight: w.serveTossInFlight,
        strikeReady: w.serveStrikeReady,
        serverAirborne: server.airborne,
        airborne: w
          .allPlayers()
          .filter((p: any) => p.airborne)
          .map((p: any) => ({ anim: p.anim, vertVel: p.vertVel, side: p.side })),
      };
    });

  // ---- 1. A human jump serve, through the keys. Two taps: the approach jump
  // between them is the game's job, so this is the whole player input.
  await page.keyboard.press('Space'); // tap: toss
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/serve-toss-airborne.png` });
  const midJump = await snap();
  await page.keyboard.press('Space'); // tap: strike
  await page.waitForTimeout(200);
  const afterServe = await snap();
  console.log(
    `jump serve: mid-air=${midJump.serverAirborne} tossUp=${midJump.tossInFlight} ` +
      `-> phase after=${afterServe.phase} (rally means the serve fired)`,
  );
  await page.screenshot({ path: `${OUT}/serve-struck.png` });

  // ---- 2. Watch AI play and snap labelled action frames.
  const wanted = new Set([
    'spike-cock',
    'spike-hit',
    'block',
    'bump',
    'timing-cue',
    'replay',
    'cheer',
  ]);
  const deadline = Date.now() + 75000;
  while (wanted.size > 0 && Date.now() < deadline) {
    const s = await snap();
    for (const a of s.airborne) {
      if (wanted.has('spike-cock') && (a.anim === 'jump' || a.anim === 'spike') && Math.abs(a.vertVel) < 1.6) {
        await page.screenshot({ path: `${OUT}/spike-cock.png` });
        wanted.delete('spike-cock');
        console.log('captured spike-cock (airborne near apex)');
      } else if (wanted.has('spike-hit') && a.anim === 'spike') {
        await page.screenshot({ path: `${OUT}/spike-hit.png` });
        wanted.delete('spike-hit');
        console.log('captured spike-hit');
      } else if (wanted.has('block') && a.anim === 'block') {
        await page.screenshot({ path: `${OUT}/block.png` });
        wanted.delete('block');
        console.log('captured block');
      }
    }
    if (wanted.has('cheer')) {
      const cheering = await page.evaluate(() => {
        const w = (window as unknown as { __sv90: { world: any } }).__sv90.world;
        return w.allPlayers().filter((p: any) => p.anim === 'cheer').length;
      });
      if (cheering >= 2) {
        await page.screenshot({ path: `${OUT}/cheer.png` });
        wanted.delete('cheer');
        console.log(`captured cheer (${cheering} players celebrating)`);
      }
    }
    if (wanted.has('replay')) {
      const replaying = await page.evaluate(() =>
        Boolean((window as unknown as { __sv90: { replay?: { isPlaying: boolean } } }).__sv90.replay?.isPlaying),
      );
      if (replaying) {
        await page.screenshot({ path: `${OUT}/replay.png` });
        wanted.delete('replay');
        console.log('captured replay');
      }
    }
    if (wanted.has('timing-cue')) {
      const cued = await page.evaluate(() => {
        const w = (window as unknown as { __sv90: { world: any } }).__sv90.world;
        return Boolean(w.playCue);
      });
      if (cued) {
        await page.screenshot({ path: `${OUT}/timing-cue.png` });
        wanted.delete('timing-cue');
        console.log('captured timing-cue');
      }
    }
    if (wanted.has('bump')) {
      const bumping = await page.evaluate(() => {
        const w = (window as unknown as { __sv90: { world: any } }).__sv90.world;
        return w.allPlayers().some((p: any) => p.anim === 'bump' && p.animTime < 0.3);
      });
      if (bumping) {
        await page.screenshot({ path: `${OUT}/bump.png` });
        wanted.delete('bump');
        console.log('captured bump');
      }
    }
    await page.waitForTimeout(45);
  }
  if (wanted.size) console.log(`not captured in time: ${[...wanted].join(', ')}`);

  await browser.close();
  await server.close();
}

main();
