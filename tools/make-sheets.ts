/**
 * Write the placeholder sprite sheets to public/sprites.
 *
 * Run once to give the sprite pipeline something to load. Replace any file
 * with a drawn sheet of the same name and the game picks it up with no code
 * change at all.
 *
 *   CHROMIUM_PATH=... npx tsx tools/make-sheets.ts
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('public/sprites');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 5182, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5182/make-sheets.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as any).__makeSheet));

  const actions: string[] = await page.evaluate(() => (window as any).__actions);
  for (const action of actions) {
    const data: string = await page.evaluate((a) => (window as any).__makeSheet(a), action);
    writeFileSync(resolve(OUT, `${action}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`wrote public/sprites/${action}.png`);
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

  await browser.close();
  await server.close();
}

main();
