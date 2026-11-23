/**
 * Check the BUILT bundle, not the dev server.
 *
 * Everything else in this repository is verified against `vite dev`, where the
 * page and its assets share an origin and paths resolve from the project root.
 * The packaged application is neither of those things, and a build shipped in
 * which not one sprite sheet loaded: the game fell back to its vector figures,
 * silently, and the only symptom was that the players looked like the old ones.
 *
 * So this serves `dist` the way the bundle will be served, starts a match, and
 * asserts that the drawn sheets actually arrived — and that nothing was logged
 * to the console while it happened.
 *
 *   CHROMIUM_PATH=... npx tsx tools/build-check.ts
 */
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { ARENA_V3_LAYER_NAMES } from '../src/render/arena-art';
import { SHEETS } from '../src/render/sprites';

/**
 * How many arena assets the bundle has to load.
 *
 * Read from the layer list rather than written down. This was the literal 3 of
 * the pre-V3 arena and stayed there when the arena became five layers, so the
 * check failed on a correct build and said "expected 3, got 5" — a number out
 * of date, reported as a defect. Deriving it means the next change to the
 * arena cannot leave this behind again.
 */
const EXPECTED_ARENA_ASSETS = ARENA_V3_LAYER_NAMES.length;
const EXPECTED_SPRITE_SHEETS = Object.keys(SHEETS).length;

async function main(): Promise<void> {
  const server = await preview({ preview: { port: 5188, strictPort: true } });

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));

  await page.goto('http://localhost:5188/', { waitUntil: 'networkidle' });

  // The menu is a DOM form now, not a canvas screen: pressing Space with
  // nothing focused starts nothing, so this loop used to spin forty times on
  // the menu and the check then reported the referee as "not drawn" when no
  // match had ever begun. Start the match the way a person does — by the
  // button, once the athletes have loaded — and fail by name if that is
  // impossible, rather than as a missing official.
  await page.waitForSelector('#menu-start:not([disabled])', { timeout: 30000 });
  await page.click('#menu-start');
  const started = await page
    .waitForFunction(
      () => Boolean((window as unknown as { __sv90?: { world?: unknown } }).__sv90?.world),
      undefined,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!started) problems.push('the match did not start from the menu button');

  type AssetCounts = { sprites: number; masks: number; arena: number };
  const rawAssets = await page
    .waitForFunction(
      ({ wantArena, wantSprites }: { wantArena: number; wantSprites: number }) => {
        const renderer = (window as unknown as {
          __sv90?: { renderer?: { spriteCount: number; maskedSpriteCount: number; arenaAssetCount: number } };
        }).__sv90?.renderer;
        if (!renderer) return false;
        return renderer.spriteCount >= wantSprites &&
          renderer.maskedSpriteCount >= wantSprites &&
          renderer.arenaAssetCount >= wantArena
          ? { sprites: renderer.spriteCount, masks: renderer.maskedSpriteCount, arena: renderer.arenaAssetCount }
          : false;
      },
      { wantArena: EXPECTED_ARENA_ASSETS, wantSprites: EXPECTED_SPRITE_SHEETS },
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => false);

  const assets: AssetCounts =
    rawAssets && typeof rawAssets === 'object'
      ? (rawAssets as AssetCounts)
      : { sprites: 0, masks: 0, arena: 0 };

  const officialsDrawn = await page.waitForFunction(() => {
    const diagnostics = (window as unknown as {
      __sv90?: { renderer?: { officialDiagnostics?: {
        atlas: { loaded: boolean };
        referee: { rasterDraws: number };
      } } };
    }).__sv90?.renderer?.officialDiagnostics;
    return diagnostics?.atlas.loaded && diagnostics.referee.rasterDraws > 0;
  }, undefined, { timeout: 15000 }).then(() => true).catch(() => false);

  const failures: string[] = [];
  if (!officialsDrawn) failures.push('illustrated officials were not loaded and drawn from the built bundle');
  if (assets.sprites !== EXPECTED_SPRITE_SHEETS) {
    failures.push(`expected ${EXPECTED_SPRITE_SHEETS} sprite sheets in the built bundle, got ${assets.sprites}`);
  }
  if (assets.masks !== EXPECTED_SPRITE_SHEETS) {
    failures.push(`expected ${EXPECTED_SPRITE_SHEETS} material masks in the built bundle, got ${assets.masks}`);
  }
  if (assets.arena !== EXPECTED_ARENA_ASSETS) {
    failures.push(
      `expected ${EXPECTED_ARENA_ASSETS} arena assets in the built bundle, got ${assets.arena}`,
    );
  }
  for (const p of problems) failures.push(p);

  console.log(`sprite sheets loaded from the build: ${assets.sprites}/${EXPECTED_SPRITE_SHEETS}`);
  console.log(`material masks loaded from the build: ${assets.masks}/${EXPECTED_SPRITE_SHEETS}`);
  console.log(`arena assets loaded from the build: ${assets.arena}/${EXPECTED_ARENA_ASSETS}`);
  console.log(`illustrated officials drawn from the build: ${officialsDrawn}`);
  const output = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length) ?? 'artifacts/build-check');
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'match.png') });
  for (const f of failures) console.log(`FAIL  ${f}`);
  if (!failures.length) console.log('build check passed');

  await browser.close();
  await server.close();
  if (failures.length) process.exitCode = 1;
}

void main();
