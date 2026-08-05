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

  for (let i = 0; i < 40; i++) {
    const started = await page.evaluate(
      () => Boolean((window as unknown as { __sv90?: { world?: unknown } }).__sv90?.world),
    );
    if (started) break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
  }

  const count = await page
    .waitForFunction(
      () => {
        const n = (window as unknown as { __sv90?: { renderer?: { spriteCount: number } } })
          .__sv90?.renderer?.spriteCount;
        return n && n >= 10 ? n : false;
      },
      undefined,
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => 0);

  const failures: string[] = [];
  if (count !== 10) failures.push(`expected 10 sprite sheets in the built bundle, got ${count}`);
  for (const p of problems) failures.push(p);

  console.log(`sprite sheets loaded from the build: ${count}/10`);
  for (const f of failures) console.log(`FAIL  ${f}`);
  if (!failures.length) console.log('build check passed');

  await browser.close();
  await server.close();
  if (failures.length) process.exitCode = 1;
}

void main();
