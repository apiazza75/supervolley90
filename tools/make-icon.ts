/**
 * Generate the app icon as a PNG, with no image libraries and no binary blobs
 * checked into the repository.
 *
 * Run `npm run icon` to regenerate, then `npm run tauri icon` to derive the
 * full macOS icon set (.icns and the various @2x sizes) from it.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SIZE = 1024;

type Rgb = [number, number, number];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Signed distance from a point to a line segment, used for the net band. */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function render(): Buffer {
  // One RGBA row per line, each prefixed with a PNG filter byte.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

  const bgTop: Rgb = [26, 34, 62];
  const bgBottom: Rgb = [10, 13, 28];
  const ballLight: Rgb = [255, 236, 168];
  const ballMid: Rgb = [255, 200, 82];
  const ballDark: Rgb = [214, 122, 32];

  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (SIZE * 4 + 1);
    raw[rowStart] = 0; // filter: none

    for (let x = 0; x < SIZE; x++) {
      const i = rowStart + 1 + x * 4;
      const u = x / SIZE;
      const v = y / SIZE;

      let color = mix(bgTop, bgBottom, v);
      let alpha = 255;

      // Rounded-square mask, matching the macOS icon grid.
      const inset = SIZE * 0.09;
      const r = SIZE * 0.22;
      const qx = Math.max(inset + r - x, x - (SIZE - inset - r), 0);
      const qy = Math.max(inset + r - y, y - (SIZE - inset - r), 0);
      const cornerDist = Math.hypot(qx, qy);
      if (cornerDist > r) {
        alpha = Math.max(0, 255 - (cornerDist - r) * 255);
      }
      if (x < inset || x > SIZE - inset || y < inset || y > SIZE - inset) {
        const edge = Math.min(x - inset, SIZE - inset - x, y - inset, SIZE - inset - y);
        alpha = Math.min(alpha, Math.max(0, 255 + edge * 255));
      }

      // The ball: a lit sphere, upper left.
      const bx = SIZE * 0.44;
      const by = SIZE * 0.42;
      const br = SIZE * 0.235;
      const d = Math.hypot(x - bx, y - by);
      if (d < br) {
        const nx = (x - bx) / br;
        const ny = (y - by) / br;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        // Lambert term with the key light up and to the left.
        const light = Math.max(0, -nx * 0.5 - ny * 0.55 + nz * 0.67);
        color = mix(ballDark, ballMid, Math.min(1, light * 1.5));
        color = mix(color, ballLight, Math.max(0, light - 0.62) * 2.4);

        // Panel seams.
        const seam = Math.abs(Math.sin(Math.atan2(ny, nx) * 1.5 + nz * 2.6));
        if (seam < 0.09) color = mix(color, [150, 74, 18], 1 - seam / 0.09);

        // Antialias the silhouette.
        if (d > br - 2) alpha = Math.min(alpha, Math.round((br - d) * 127));
      } else {
        // Net band sweeping under the ball.
        const nd = distToSegment(x, y, SIZE * 0.12, SIZE * 0.78, SIZE * 0.88, SIZE * 0.66);
        if (nd < SIZE * 0.035) {
          const t = 1 - nd / (SIZE * 0.035);
          color = mix(color, [244, 249, 255], Math.min(1, t * 2.2));
        } else if (nd < SIZE * 0.12) {
          // Faint mesh below the tape.
          const mesh = Math.abs(Math.sin(u * 92)) < 0.13 || Math.abs(Math.sin(v * 92)) < 0.13;
          if (mesh) color = mix(color, [200, 214, 236], 0.22);
        }
      }

      raw[i] = Math.round(color[0]);
      raw[i + 1] = Math.round(color[1]);
      raw[i + 2] = Math.round(color[2]);
      raw[i + 3] = Math.round(alpha);
    }
  }

  return encodePng(raw, SIZE, SIZE);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

function encodePng(raw: Buffer, width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = process.argv[2] ?? 'src-tauri/icons/icon.png';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, render());
console.log(`wrote ${out} (${SIZE}x${SIZE})`);
