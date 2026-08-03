/**
 * Drive the real game in a browser and capture frames.
 *
 * This is the only way to check that the renderer, input and loop actually
 * work together — a passing type-check says nothing about whether anything
 * appears on screen.
 *
 *   npx tsx tools/screenshot.ts [outputDir]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'shots');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const server = await createServer({ server: { port: 5174, strictPort: true } });
  await server.listen();
  const url = `http://localhost:5174/`;

  const browser = await chromium.launch({
    // PLAYWRIGHT_BROWSERS_PATH points at the preinstalled bundle; `chromium`
    // there is a symlink to the versioned directory, so resolve it explicitly.
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  // Confirm the match starts: the menu's confirm button walks down the rows.
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/02-serve.png` });

  // Serve: one tap tosses the ball, a second tap hits it at the top.
  await page.keyboard.press('Space');
  await page.waitForTimeout(780);
  await page.keyboard.press('Space');

  for (const [name, wait] of [
    ['03-rally', 1400],
    ['04-rally', 1600],
    ['05-rally', 1800],
  ] as const) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  // Let the AI play both sides for a while and grab a late-match frame.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/06-late.png` });

  // Report what the game thinks its state is, straight from the page.
  const stats = await page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement | null;
    return {
      canvas: c ? `${c.width}x${c.height}` : 'missing',
      // Sample some pixels to prove the frame is not blank.
      nonBlank: (() => {
        if (!c) return false;
        const ctx = c.getContext('2d');
        if (!ctx) return false;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const seen = new Set<string>();
        for (let i = 0; i < d.length; i += 4 * 977) {
          seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
          if (seen.size > 40) return true;
        }
        return seen.size > 40;
      })(),
    };
  });

  console.log('canvas:', stats.canvas);
  console.log('frame has varied content:', stats.nonBlank);
  console.log(errors.length ? `ERRORS:\n  ${errors.join('\n  ')}` : 'no page errors');

  await browser.close();
  await server.close();
  if (errors.length) process.exitCode = 1;
}

main();
