/**
 * Sprite white-leak QC.
 *
 *   npx tsx tools/sprite-qc-v3.ts
 *
 * Renders every action sheet over a checkerboard, magenta and black, so a
 * stray white fringe has nowhere to hide, and counts the leak so the check is
 * a number rather than an opinion.
 *
 * What counts as a leak: an almost-white, almost-opaque pixel that touches a
 * transparent one. That is matte fringing and white sealed against the edge of
 * a limb — the two things the runtime cleanup does not reliably remove. It
 * deliberately does not count white in the interior of the figure, because
 * socks, numbers and eyes are supposed to be white and a check that flags them
 * would simply be turned off.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ACTIONS = [
  'idle',
  'approach',
  'spike',
  'block',
  'bump',
  'set',
  'dive',
  'serve',
  'jumpServe',
  'celebrate',
] as const;

const OUT = resolve('artifacts/sprite-qc');
const PORT = 5184;

/**
 * Allowed fringe, in pixels, per sheet.
 *
 * A regression guard rather than a target: it is set just above what the
 * committed art currently measures, so the number cannot quietly grow. Lower
 * it when the sheets are re-cut.
 */
const BUDGET = Number(process.env.SPRITE_WHITE_BUDGET ?? 400);

const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

async function main(): Promise<void> {
  for (const sub of ['checker', 'magenta', 'black']) {
    mkdirSync(resolve(OUT, sub), { recursive: true });
  }

  const server = await createServer({ server: { port: PORT, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

  const report: Record<string, { whiteLeakPixels: number; width: number; height: number }> = {};
  let total = 0;

  for (const action of ACTIONS) {
    // Passed as source text, not as a closure: tsx compiles nested function
    // declarations with a `__name` helper that does not exist in the page.
    const result = (await page.evaluate(`(async () => {
      const img = new Image();
      img.src = 'sprites/${action}.png';
      await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;

      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;

      // Fringe: near-white and near-opaque, with a transparent neighbour.
      let leak = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 200) continue;
          if (data[i] < 238 || data[i + 1] < 238 || data[i + 2] < 238) continue;
          const l = (x > 0) ? data[(y * w + x - 1) * 4 + 3] : 0;
          const r = (x < w - 1) ? data[(y * w + x + 1) * 4 + 3] : 0;
          const u = (y > 0) ? data[((y - 1) * w + x) * 4 + 3] : 0;
          const d = (y < h - 1) ? data[((y + 1) * w + x) * 4 + 3] : 0;
          if (l < 40 || r < 40 || u < 40 || d < 40) leak++;
        }
      }

      // Three backgrounds, scaled so a whole sheet is one reviewable page.
      const scale = 0.25;
      const ow = Math.round(w * scale), oh = Math.round(h * scale);
      const shots = {};
      for (const key of ['checker', 'magenta', 'black']) {
        const out = document.createElement('canvas');
        out.width = ow; out.height = oh;
        const oc = out.getContext('2d');
        if (key === 'checker') {
          const sq = 16;
          for (let y = 0; y < oh; y += sq) {
            for (let x = 0; x < ow; x += sq) {
              oc.fillStyle = (((x / sq) | 0) + ((y / sq) | 0)) % 2 ? '#9aa0a6' : '#4b5157';
              oc.fillRect(x, y, sq, sq);
            }
          }
        } else {
          oc.fillStyle = key === 'magenta' ? '#ff00ff' : '#000000';
          oc.fillRect(0, 0, ow, oh);
        }
        oc.imageSmoothingEnabled = true;
        oc.drawImage(img, 0, 0, ow, oh);
        shots[key] = out.toDataURL('image/png');
      }
      return { leak, w, h, shots };
    })()`)) as { leak: number; w: number; h: number; shots: Record<string, string> };

    for (const [key, dataUrl] of Object.entries(result.shots)) {
      writeFileSync(
        resolve(OUT, key, `${action}-${key}.png`),
        Buffer.from(dataUrl.split(',')[1], 'base64'),
      );
    }
    report[action] = { whiteLeakPixels: result.leak, width: result.w, height: result.h };
    total += result.leak;
    console.log(`${action.padEnd(11)} ${result.w}x${result.h}  white fringe: ${result.leak}`);
  }

  await browser.close();
  await server.close();

  const worst = Math.max(...Object.values(report).map((r) => r.whiteLeakPixels));
  const failed = Object.entries(report).filter(([, r]) => r.whiteLeakPixels > BUDGET);
  writeFileSync(
    resolve(OUT, 'sprite-qc-report.json'),
    `${JSON.stringify({ budget: BUDGET, totalWhiteLeakPixels: total, worstSheet: worst, sheets: report }, null, 2)}\n`,
  );

  console.log(`\ntotal white fringe: ${total} px, worst sheet ${worst} px (budget ${BUDGET})`);
  if (failed.length) {
    console.error('\nsheets over the white-fringe budget:');
    for (const [name, r] of failed) console.error(`  ${name}: ${r.whiteLeakPixels}`);
    process.exit(1);
  }
  console.log('sprite QC passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
