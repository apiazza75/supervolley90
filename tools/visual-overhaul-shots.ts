/**
 * Agency-level visual regression capture for the 2026 overhaul.
 *
 * It verifies the real menu and a real loaded jump serve, then creates two
 * deterministic live-world tableaux through the existing debug handle so the
 * team palette, skin masks, jump lift, net geometry, officials and HUD are all
 * visible in one reviewable image rather than left to chance in a rally.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'visual-overhaul-shots');

type Harness = {
  world?: any;
  renderer?: { spriteCount: number; maskedSpriteCount: number; arenaAssetCount: number };
  replay?: { stop(): void };
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 5183, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => errors.push(`request: ${request.url()}`));

  await page.goto('http://localhost:5183/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  for (let i = 0; i < 30; i++) {
    const started = await page.evaluate(() => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world));
    if (started) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(
    () => {
      const game = (window as unknown as { __sv90?: Harness }).__sv90;
      return Boolean(
        game?.world?.phase === 'serve' &&
        game.renderer?.spriteCount === 10 &&
        game.renderer.maskedSpriteCount === 10 &&
        game.renderer.arenaAssetCount === 3,
      );
    },
    undefined,
    { timeout: 30000 },
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/02-serve-ready.png` });

  // A loaded serve is the jump-serve path. Hold, release, then meet the toss.
  await page.keyboard.down('Space');
  await page.waitForTimeout(560);
  await page.keyboard.up('Space');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world?.serveTossInFlight),
    undefined,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => {
      const w = (window as unknown as { __sv90?: Harness }).__sv90?.world;
      return Boolean(w && w.team(w.servingSide).server.height > 0.3);
    },
    undefined,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${OUT}/03-jump-serve-rise.png` });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world?.serveStrikeReady),
    undefined,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${OUT}/04-jump-serve-contact.png` });
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window as unknown as { __sv90?: Harness }).__sv90?.world?.phase === 'rally',
    undefined,
    { timeout: 5000 },
  );

  // Deterministic spike-vs-double-block tableau using live renderer/world data.
  await page.evaluate(() => {
    const game = (window as unknown as { __sv90: Harness }).__sv90;
    const w = game.world;
    game.replay?.stop();
    w.phase = 'rally';
    w.ball.frozen = true;
    w.ball.grounded = false;
    w.ball.pos = { x: -0.15, y: 0, z: 3.45 };
    w.ball.vel = { x: 0, y: 0, z: 0 };
    const home = w.home.players;
    const away = w.away.players;
    const homePlaces = [
      [-3.1, -6.5], [0.0, -0.72], [2.9, -2.1], [-2.9, -3.0], [2.7, -6.4], [0.2, -5.0],
    ];
    const awayPlaces = [
      [3.1, 6.4], [-0.8, 0.55], [0.25, 0.47], [2.8, 3.0], [-2.9, 6.3], [0.1, 4.8],
    ];
    home.forEach((p: any, i: number) => {
      p.pos.x = homePlaces[i][0]; p.pos.y = homePlaces[i][1];
      p.height = 0; p.vertVel = 0; p.vel.x = 0; p.vel.y = 0;
      p.anim = 'idle'; p.animTime = 0; p.swing = 0; p.facing = 1;
    });
    away.forEach((p: any, i: number) => {
      p.pos.x = awayPlaces[i][0]; p.pos.y = awayPlaces[i][1];
      p.height = 0; p.vertVel = 0; p.vel.x = 0; p.vel.y = 0;
      p.anim = 'idle'; p.animTime = 0; p.swing = 0; p.facing = -1;
    });
    home[1].height = 1.3;
    home[1].anim = 'spike';
    home[1].swing = 0.28;
    away[1].height = 1.16;
    away[1].anim = 'block';
    away[2].height = 1.08;
    away[2].anim = 'block';
    w.prediction.valid = false;
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: `${OUT}/05-spike-double-block.png` });

  // Grounded formation isolates the exact defects reported by the user:
  // white paper between legs, same-colour skin and indistinguishable teams.
  await page.evaluate(() => {
    const w = (window as unknown as { __sv90: Harness }).__sv90.world;
    w.ball.pos = { x: 0, y: 11.5, z: 1.4 };
    w.home.players.forEach((p: any) => { p.height = 0; p.anim = 'idle'; p.animTime = 0; p.swing = 0; });
    w.away.players.forEach((p: any) => { p.height = 0; p.anim = 'idle'; p.animTime = 0; p.swing = 0; });
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: `${OUT}/06-team-identity.png` });

  const report = await page.evaluate(() => {
    const game = (window as unknown as { __sv90: Harness }).__sv90;
    const w = game.world;
    return {
      assets: game.renderer,
      homeColours: w.home.config.colors,
      awayColours: w.away.config.colors,
      homeHeights: w.home.players.map((p: any) => p.height),
      awayHeights: w.away.players.map((p: any) => p.height),
      canvas: (() => {
        const c = document.getElementById('game') as HTMLCanvasElement | null;
        return c ? `${c.width}x${c.height}` : 'missing';
      })(),
    };
  });
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ ...report, errors }, null, 2));

  console.log(JSON.stringify(report));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
  await browser.close();
  await server.close();
}

void main();
