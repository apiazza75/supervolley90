/**
 * Screenshot the animation strips.
 *
 * Every action is drawn as a numbered row of frames with its timestamp, so a
 * review can name the exact frame that is wrong instead of the whole move.
 *
 *   CHROMIUM_PATH=... npx tsx tools/anim-sheet.ts [outFile] ['?only=dive,run']
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'anim-sheet.png');

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });
  const server = await createServer({ server: { port: 5179, strictPort: true } });
  await server.listen();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:5179/anim-sheet.html${process.argv[3] ?? ''}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(400);
  await page.locator('#sheet').screenshot({ path: OUT });
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : `wrote ${OUT}`);

  await browser.close();
  await server.close();
}

main();
