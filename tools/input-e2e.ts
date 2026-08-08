/**
 * End-to-end control check: drives the real game in a browser and asserts that
 * each arrow key moves the active player the way the screen implies.
 *
 * This exists because the input mapping silently rotated 90 degrees when the
 * camera changed from behind-the-court to side-on, and nothing noticed: the
 * simulation was correct, the renderer was correct, every unit test passed,
 * and the game was unplayable. Only pressing the actual keys catches that
 * class of bug, so this presses the actual keys.
 *
 *   CHROMIUM_PATH=/path/to/chrome npx tsx tools/input-e2e.ts
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

interface ActiveState {
  x: number;
  y: number;
  facing: number;
  phase: string;
}

async function main(): Promise<void> {
  const server = await createServer({ server: { port: 5176, strictPort: true } });
  await server.listen();

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5176/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Through the menu: press until a World actually exists, rather than pressing
  // a fixed number of times and hoping. The menu's input cooldown is enforced
  // against frame time, so on a slow headless renderer a fixed 360 ms gap
  // silently swallows presses and the match never starts — which then fails as
  // a timeout somewhere further down, blaming the wrong thing.
  let started = false;
  for (let i = 0; i < 12 && !started; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(420);
    started = await page.evaluate(() =>
      Boolean((window as unknown as { __sv90?: { world?: unknown } }).__sv90?.world),
    );
  }
  if (!started) throw new Error('the menu never started a match');

  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __sv90?: { world?: { phase: string } } }).__sv90;
      return g?.world?.phase === 'serve';
    },
    undefined,
    { timeout: 8000 },
  );

  const active = (): Promise<ActiveState> =>
    page.evaluate(() => {
      const g = (
        window as unknown as {
          __sv90: {
            world: {
              phase: string;
              home: { active: { pos: { x: number; y: number }; facing: number } };
            };
          };
        }
      ).__sv90;
      const a = g.world.home.active;
      return { x: a.pos.x, y: a.pos.y, facing: a.facing, phase: g.world.phase };
    });

  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail: string): void => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`);
    if (!ok) failures.push(label);
  };

  const hold = async (key: string, ms: number): Promise<void> => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
  };

  // The server is held behind the end line until the ball is struck, so the
  // forward axis has to be measured from further back: step away from the line
  // first, then push forward and check the player comes back towards it.
  await hold('ArrowLeft', 600);
  let before = await active();
  await hold('ArrowRight', 600);
  let after = await active();
  check(
    'ArrowRight moves along the court (+y)',
    after.y - before.y > 0.8,
    `dy=${(after.y - before.y).toFixed(2)}`,
  );
  check(
    'ArrowRight does not move across the court',
    Math.abs(after.x - before.x) < 0.35,
    `dx=${(after.x - before.x).toFixed(2)}`,
  );
  check('moving right faces right', after.facing === 1, `facing=${after.facing}`);

  before = after;
  await hold('ArrowLeft', 450);
  after = await active();
  check(
    'ArrowLeft moves back along the court (-y)',
    after.y - before.y < -0.6,
    `dy=${(after.y - before.y).toFixed(2)}`,
  );

  before = after;
  await hold('ArrowUp', 500);
  after = await active();
  check(
    'ArrowUp steps across the court (+x)',
    after.x - before.x > 0.6,
    `dx=${(after.x - before.x).toFixed(2)}`,
  );
  check(
    'ArrowUp does not move along the court',
    Math.abs(after.y - before.y) < 0.35,
    `dy=${(after.y - before.y).toFixed(2)}`,
  );

  before = after;
  await hold('ArrowDown', 500);
  after = await active();
  check(
    'ArrowDown steps across the court (-x)',
    after.x - before.x < -0.6,
    `dx=${(after.x - before.x).toFixed(2)}`,
  );
  check('checks ran during the serve phase', after.phase === 'serve', `phase=${after.phase}`);

  await browser.close();
  await server.close();

  if (failures.length) {
    console.error(`\n${failures.length} control check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nall control checks passed');
  }
}

main();
