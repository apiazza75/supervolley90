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

type Harness = {
  world?: {
    phase?: string;
    serveTossInFlight?: boolean;
    serveStrikeReady?: boolean;
  };
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const server = await createServer({ server: { port: 5174, strictPort: true } });
  await server.listen();
  const url = 'http://localhost:5174/';

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  // Move through the four menu rows and prove that a World was actually made.
  for (let i = 0; i < 8; i++) {
    const started = await page.evaluate(
      () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world),
    );
    if (started) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world),
    undefined,
    { timeout: 5000 },
  );
  await page.waitForTimeout(900);

  // The current serve is a two-stage action. Load power by holding the button,
  // release to toss, then strike only when the simulation says the authored
  // contact window is ready. Fixed sleeps previously missed that window and
  // produced six pictures of a ball still in the server's hand.
  await page.keyboard.down('Space');
  await page.waitForTimeout(460);
  await page.keyboard.up('Space');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world?.serveTossInFlight),
    undefined,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sv90?: Harness }).__sv90?.world?.serveStrikeReady),
    undefined,
    { timeout: 5000 },
  );
  await page.screenshot({ path: `${OUT}/02-serve.png` });
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window as unknown as { __sv90?: Harness }).__sv90?.world?.phase === 'rally',
    undefined,
    { timeout: 5000 },
  );

  for (const [name, wait] of [
    ['03-rally', 450],
    ['04-rally', 850],
    ['05-rally', 1250],
  ] as const) {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/06-late.png` });

  const stats = await page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    const world = (window as unknown as { __sv90?: Harness }).__sv90?.world;
    return {
      canvas: canvas ? `${canvas.width}x${canvas.height}` : 'missing',
      phase: world?.phase ?? 'missing',
      nonBlank: (() => {
        if (!canvas) return false;
        const context = canvas.getContext('2d');
        if (!context) return false;
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const seen = new Set<string>();
        for (let i = 0; i < data.length; i += 4 * 977) {
          seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          if (seen.size > 40) return true;
        }
        return seen.size > 40;
      })(),
    };
  });

  console.log('canvas:', stats.canvas);
  console.log('final phase:', stats.phase);
  console.log('frame has varied content:', stats.nonBlank);
  console.log(errors.length ? `ERRORS:\n  ${errors.join('\n  ')}` : 'no page errors');

  await browser.close();
  await server.close();
  if (!stats.nonBlank || errors.length) process.exitCode = 1;
}

void main();
