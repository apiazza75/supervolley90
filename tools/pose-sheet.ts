/**
 * Screenshot the development pose sheet.
 *
 *   CHROMIUM_PATH=... npx tsx tools/pose-sheet.ts [outFile]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'pose-sheet.png');

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });
  const server = await createServer({ server: { port: 5178, strictPort: true } });
  await server.listen();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const query = process.argv[3] ?? '';
  await page.goto(`http://localhost:5178/pose-sheet.html${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const canvas = page.locator('#sheet');
  await canvas.screenshot({ path: OUT });
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  console.log(`wrote ${OUT}`);

  await browser.close();
  await server.close();
}

main();
