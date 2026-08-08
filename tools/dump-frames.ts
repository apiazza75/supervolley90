/**
 * Dump what the sprite loader actually produced, one contact sheet per action.
 *
 * The game screenshot is too small to judge a frame by: a plank stuck to a
 * player's feet or a frame number riding on their shoulder is a few pixels
 * there and unmissable here. This renders every sliced frame large, on a
 * magenta ground, with the floor line drawn across it.
 *
 *   CHROMIUM_PATH=... npx tsx tools/dump-frames.ts [outDir] [--kit=#rrggbb]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const kit = args.find((a) => a.startsWith('--kit='))?.slice(6) ?? '';
const OUT = resolve(args.find((a) => !a.startsWith('--')) ?? 'frame-dump');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 5183, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 300, height: 200 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5183/frames.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as any).__contact), undefined, {
    timeout: 30000,
  });

  const loaded: string[] = await page.evaluate(() => (window as any).__loaded);
  console.log(`sheets loaded: ${loaded.length ? loaded.join(', ') : 'NONE'}`);
  for (const action of loaded) {
    const data: string | null = await page.evaluate(
      ([a, k]) => (window as any).__contact(a, k),
      [action, kit] as [string, string],
    );
    if (!data) continue;
    writeFileSync(resolve(OUT, `${action}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`wrote ${action}.png`);
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

  await browser.close();
  await server.close();
}

void main();
