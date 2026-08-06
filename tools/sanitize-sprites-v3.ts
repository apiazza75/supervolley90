/**
 * Remove matte fringing from the committed sprite sheets, offline.
 *
 *   npx tsx tools/sanitize-sprites-v3.ts [--dry]
 *
 * The runtime cleanup only reaches white that is connected to the outside of a
 * cell, so white sealed between a limb and the outline — and the pale halo left
 * where the figure was cut from its background — survives it and shows up in
 * play. Fixing that at runtime, every frame, on every sheet, is also the wrong
 * place to do it: the sheets are static, so this is a build-time problem.
 *
 * What it does, per 512 px cell: find almost-white, almost-opaque pixels that
 * touch a transparent one, and repaint them with the nearest genuine colour
 * from the body. Repainting rather than erasing keeps the silhouette intact —
 * erasing the fringe eats a pixel off every edge and thins the figure. Pixels
 * with no real colour nearby are cleared instead, because that is halo with
 * nothing behind it.
 *
 * Hashes before and after are printed, as the brief asks, so the change to the
 * committed art is auditable.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const PORT = 5185;
const DRY = process.argv.includes('--dry');

const executablePath =
  process.env.CHROMIUM_PATH ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function main(): Promise<void> {
  const server = await createServer({ server: { port: PORT, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

  const report: Record<string, { before: string; after: string; repainted: number; cleared: number }> = {};

  for (const action of ACTIONS) {
    const file = resolve('public/sprites', `${action}.png`);
    const before = sha(readFileSync(file));

    // Source text, not a closure: tsx compiles nested functions with a
    // `__name` helper that does not exist in the page.
    const result = (await page.evaluate(`(async () => {
      const img = new Image();
      img.src = 'sprites/${action}.png';
      await img.decode();
      const w = img.naturalWidth, h = img.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const image = ctx.getImageData(0, 0, w, h);
      const d = image.data;

      const isFringe = (i) => d[i + 3] >= 200 && d[i] >= 238 && d[i + 1] >= 238 && d[i + 2] >= 238;
      const alphaAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);

      let repainted = 0, cleared = 0;
      // Two passes: removing the outer ring can expose a second one beneath it.
      for (let pass = 0; pass < 2; pass++) {
        const targets = [];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (!isFringe(i)) continue;
            if (alphaAt(x - 1, y) < 40 || alphaAt(x + 1, y) < 40 ||
                alphaAt(x, y - 1) < 40 || alphaAt(x, y + 1) < 40) {
              targets.push([x, y]);
            }
          }
        }
        if (!targets.length) break;
        for (const [x, y] of targets) {
          const i = (y * w + x) * 4;
          // Nearest genuine colour: opaque, and not itself near-white.
          let best = -1, bestDist = 99;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = (ny * w + nx) * 4;
              if (d[j + 3] < 200) continue;
              if (d[j] >= 238 && d[j + 1] >= 238 && d[j + 2] >= 238) continue;
              const dist = Math.abs(dx) + Math.abs(dy);
              if (dist < bestDist) { bestDist = dist; best = j; }
            }
          }
          if (best >= 0) {
            d[i] = d[best]; d[i + 1] = d[best + 1]; d[i + 2] = d[best + 2];
            repainted++;
          } else {
            d[i + 3] = 0;
            cleared++;
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      return { png: cv.toDataURL('image/png'), repainted, cleared };
    })()`)) as { png: string; repainted: number; cleared: number };

    const buf = Buffer.from(result.png.split(',')[1], 'base64');
    if (!DRY) writeFileSync(file, buf);
    const after = sha(buf);
    report[action] = { before, after, repainted: result.repainted, cleared: result.cleared };
    console.log(
      `${action.padEnd(11)} ${before} -> ${after}  repainted ${result.repainted}, cleared ${result.cleared}`,
    );
  }

  await browser.close();
  await server.close();

  writeFileSync('artifacts-sprite-sanitize.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(DRY ? '\ndry run: nothing written' : '\nsheets rewritten in public/sprites');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
