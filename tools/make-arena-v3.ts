/**
 * Write the five Recovery V3 arena layers to public/arena/v3.
 *
 *   npm run arena:v3
 *
 * The art is drawn in src/dev/arena-v3-art.ts, in the browser, on a canvas —
 * the same route tools/make-sheets.ts uses. This side does two things a canvas
 * cannot: it encodes PNG colour type 2 for the layers the asset validator
 * requires to be opaque, and it writes the files.
 *
 * Why an encoder at all: `canvas.toDataURL('image/png')` always emits RGBA,
 * and tools/validate-art-assets.ts requires backdrop.png and floor.png to be
 * type 2. Rather than relax the validator — those two really are opaque, and
 * an alpha channel on a 2560x1440 layer is 3.7 MB of nothing — the raw pixels
 * come back and are encoded here.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('public/arena/v3');
const PORT = 5186;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Per-row filter choice.
 *
 * Filtering is not cosmetic here: these layers are large, smooth gradients,
 * and writing every row unfiltered produced a 1.4 MB backdrop where the
 * adaptive choice produces a fraction of that. The heuristic is the one the
 * PNG specification suggests — pick the filter whose output has the smallest
 * sum of absolute values, treating bytes as signed.
 */
function filterRow(
  raw: Buffer,
  prior: Buffer | null,
  bpp: number,
): { filter: number; data: Buffer } {
  const n = raw.length;
  const candidates: Buffer[] = [];

  const none = Buffer.from(raw);
  candidates[0] = none;

  const sub = Buffer.alloc(n);
  for (let i = 0; i < n; i++) sub[i] = (raw[i] - (i >= bpp ? raw[i - bpp] : 0)) & 0xff;
  candidates[1] = sub;

  const up = Buffer.alloc(n);
  for (let i = 0; i < n; i++) up[i] = (raw[i] - (prior ? prior[i] : 0)) & 0xff;
  candidates[2] = up;

  const avg = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? raw[i - bpp] : 0;
    const b = prior ? prior[i] : 0;
    avg[i] = (raw[i] - ((a + b) >> 1)) & 0xff;
  }
  candidates[3] = avg;

  const paeth = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? raw[i - bpp] : 0;
    const b = prior ? prior[i] : 0;
    const c = prior && i >= bpp ? prior[i - bpp] : 0;
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    paeth[i] = (raw[i] - pred) & 0xff;
  }
  candidates[4] = paeth;

  let best = 0;
  let bestScore = Infinity;
  for (let f = 0; f < candidates.length; f++) {
    let score = 0;
    const data = candidates[f];
    for (let i = 0; i < n; i++) score += data[i] < 128 ? data[i] : 256 - data[i];
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return { filter: best, data: candidates[best] };
}

function encodePng(
  width: number,
  height: number,
  rgba: Buffer,
  colourType: 2 | 6,
): Buffer {
  const channels = colourType === 2 ? 3 : 4;
  const stride = width * channels;
  const rows: Buffer[] = [];
  let prior: Buffer | null = null;

  for (let y = 0; y < height; y++) {
    const raw = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = x * channels;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (channels === 4) raw[d + 3] = rgba[s + 3];
    }
    const { filter, data } = filterRow(raw, prior, channels);
    rows.push(Buffer.concat([Buffer.from([filter]), data]));
    prior = raw;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface LayerInfo {
  name: string;
  width: number;
  height: number;
  colourType: 2 | 6;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: PORT, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 240, height: 200 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/make-arena-v3.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean((window as never as Record<string, unknown>).__renderLayer));

  const layers = (await page.evaluate(
    () => (window as never as Record<string, unknown>).__layers,
  )) as LayerInfo[];

  for (const layer of layers) {
    const base64 = (await page.evaluate(
      (n) => (window as never as Record<string, any>).__renderLayer(n),
      layer.name,
    )) as string;
    const rgba = Buffer.from(base64, 'base64');
    const expected = layer.width * layer.height * 4;
    if (rgba.length !== expected) {
      throw new Error(`${layer.name}: got ${rgba.length} bytes, expected ${expected}`);
    }
    const png = encodePng(layer.width, layer.height, rgba, layer.colourType);
    const file = resolve(OUT, `${layer.name}.png`);
    writeFileSync(file, png);
    console.log(
      `wrote public/arena/v3/${layer.name}.png  ${layer.width}x${layer.height}` +
        `  type ${layer.colourType}  ${(png.length / 1024).toFixed(0)} KiB`,
    );
  }

  if (errors.length) console.error(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  await server.close();
  if (errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
