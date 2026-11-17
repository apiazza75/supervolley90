import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CONTACT_FRAME, SPRITE_CONTACT_PIXELS } from '../src/render/sprite-figure';
import { GRANDSTAND_MANGA_SOURCE } from '../src/render/arena-art';
import { JUMP_SERVE_TOSS_PALMS } from '../src/render/jump-serve-entry';
import { SERVE_CHARGE_RELEASE_PALMS } from '../src/render/serve-charge-release';

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
}

function pngInfo(path: string): PngInfo {
  if (!existsSync(path)) throw new Error(`missing asset: ${path}`);
  const data = readFileSync(path);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error(`${path}: not a PNG`);
  if (data.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${path}: missing IHDR`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colourType: data[25],
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngPixels(path: string): { info: PngInfo; pixels: Uint8Array } {
  const data = readFileSync(path);
  const info = pngInfo(path);
  if (info.bitDepth !== 8) throw new Error(`${path}: pixel validation requires 8-bit PNG`);
  if (info.colourType !== 2 && info.colourType !== 6) {
    throw new Error(`${path}: pixel validation supports RGB/RGBA PNG only`);
  }
  const channels = info.colourType === 2 ? 3 : 4;
  const idat: Buffer[] = [];
  let at = 8;
  while (at < data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + length);
    if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = info.width * channels;
  const out = new Uint8Array(info.width * info.height * channels);
  let src = 0;
  for (let y = 0; y < info.height; y++) {
    const filter = inflated[src++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[src++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior ? prior[x] : 0;
      const upLeft = prior && x >= channels ? prior[x - channels] : 0;
      switch (filter) {
        case 0:
          row[x] = raw;
          break;
        case 1:
          row[x] = (raw + left) & 0xff;
          break;
        case 2:
          row[x] = (raw + up) & 0xff;
          break;
        case 3:
          row[x] = (raw + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          row[x] = (raw + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`${path}: unsupported PNG filter ${filter}`);
      }
    }
  }
  return { info, pixels: out };
}

function expectPng(path: string, width: number, height: number, colourType?: number): void {
  const info = pngInfo(path);
  if (info.width !== width || info.height !== height) {
    throw new Error(`${path}: expected ${width}x${height}, got ${info.width}x${info.height}`);
  }
  if (info.bitDepth !== 8) throw new Error(`${path}: expected 8-bit PNG`);
  if (colourType !== undefined && info.colourType !== colourType) {
    throw new Error(`${path}: expected PNG colour type ${colourType}, got ${info.colourType}`);
  }
  console.log(`${path}: ${info.width}x${info.height}, type ${info.colourType}`);
}

function expectNeutralFloorTexture(path: string): void {
  const { info, pixels } = pngPixels(path);
  const channels = info.colourType === 2 ? 3 : 4;
  let maxChroma = 0;
  let tooBright = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma > maxChroma) maxChroma = chroma;
    if ((r + g + b) / 3 > 214) tooBright++;
  }
  if (maxChroma > 1) {
    throw new Error(`${path}: floor texture must stay neutral grayscale; max chroma ${maxChroma}`);
  }
  if (tooBright > 0) {
    throw new Error(`${path}: floor texture contains ${tooBright} near-white pixels that could draw extra court lines`);
  }
  console.log(`${path}: neutral grayscale grain, no near-white court-line pixels`);
}

function expectMangaFloorAtlas(path: string): void {
  const { info, pixels } = pngPixels(path);
  const channels = info.colourType === 2 ? 3 : 4;
  let warm = 0, cool = 0, top = 0, bottom = 0, white = 0;
  for (let y = 1; y < info.height - 1; y += 4) for (let x = 1; x < info.width - 1; x += 4) {
    const at = (y * info.width + x) * channels;
    const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
    if (r >= 242 && g >= 242 && b >= 242) white++;
    if (y < info.height / 2) { top++; if (r > b + 30 && r > g + 10) warm++; }
    else { bottom++; if (g > r + 10 && b > r + 10) cool++; }
  }
  if (warm / top < .9 || cool / bottom < .9 || white > 0) {
    throw new Error(`${path}: wrong material halves or unexpected white markings`);
  }
  console.log(`${path}: wood/teal atlas halves, no sampled hard-white markings; visual review still required`);
}


const sprites = [
  'idle',
  'walk',
  'shuffle',
  'run',
  'approach',
  'spike',
  'spikeFollow',
  'block',
  'bump',
  'set',
  'backSet',
  'turn',
  'backpedal', 'runTurn', 'turnStop', 'runBrake',
  'dive',
  'serve',
  'jumpServe',
  'jumpServeFollow',
  'celebrate',
];
for (const name of sprites) expectPng(`public/sprites/${name}.png`, 3072, 2048, 6);
expectPng('public/sprites/run-passing.png', 1024, 512, 6);
expectPng('public/sprites/set-entry.png', 2048, 512, 6);
expectPng('public/sprites/set-return.png', 2048, 512, 6);
expectPng('public/sprites/dive-recovery.png', 2048, 512, 6);
expectPng('public/sprites/dive-floor.png', 2048, 512, 6);
expectPng('public/sprites/dive-rise.png', 2048, 512, 6);
expectPng('public/sprites/dive-impact.png', 2048, 512, 6);
expectPng('public/sprites/dive-turn.png', 2048, 512, 6);
expectPng('public/sprites/jump-serve-entry.png', 2048, 512, 6);
expectPng('public/sprites/jump-serve-toss.png', 2048, 512, 6);
expectPng('public/sprites/jump-serve-rise.png', 2048, 512, 6);
expectPng('public/sprites/bump-follow.png', 2048, 512, 6);
expectPng('public/sprites/celebrate-follow.png', 2048, 512, 6);
expectPng('public/sprites/spike-rise.png', 2048, 512, 6);
expectPng('public/sprites/spike-cock.png', 2048, 512, 6);
expectPng('public/sprites/spike-descent.png', 2048, 512, 6);
expectPng('public/sprites/backpedal-entry.png', 2048, 512, 6);
expectPng('public/sprites/serve-swing.png', 2048, 512, 6);
expectPng('public/sprites/serve-follow.png', 2048, 512, 6);
expectPng('public/sprites/serve-charge-release.png', 2048, 512, 6);
expectPng('public/sprites/serve-toss-release.png', 2048, 512, 6);
expectPng('public/sprites/serve-follow-between.png', 2048, 512, 6);
expectPng('public/sprites/backset-recovery.png', 2048, 512, 6);
expectPng('public/sprites/block-landing.png', 2048, 512, 6);
expectPng('public/sprites/block-landing-between.png', 2048, 512, 6);
expectPng('public/sprites/block-descent.png', 2048, 512, 6);
expectPng('public/sprites/bump-preparation.png', 2048, 512, 6);
expectPng('public/sprites/bump-release.png', 2048, 512, 6);
expectPng('public/sprites/bump-release-early.png', 2048, 512, 6);
expectPng('public/sprites/bump-moving-entry.png', 2048, 512, 6);
expectPng('public/sprites/ready-retreat.png', 2048, 512, 6);
expectPng('public/sprites/ready-lateral.png', 2048, 512, 6);
for(let i=1;i<=9;i++)expectPng(`public/sprites/approach-steps-${i}.png`,2048,512,6);
expectPng('public/sprites/approach-plant.png',2048,512,6);
expectPng('public/sprites/walk-release.png', 2048, 512, 6);
expectPng('public/sprites/walk-arm-release.png', 2048, 512, 6);

// A redraw can pass dimensions/motion QC while leaving the ball's old hand
// coordinate floating beside the arm. Check the newly reviewed palm against
// the actual source pixels, in addition to projection tests in sprites.test.
{
  const { info, pixels } = pngPixels('public/sprites/spike.png');
  const frame = CONTACT_FRAME.spike!, palm = SPRITE_CONTACT_PIXELS.spike!;
  const x = frame % 6 * 512 + palm.x, y = Math.floor(frame / 6) * 512 + palm.y;
  const at = (y * info.width + x) * 4;
  const [r, g, b, a] = pixels.slice(at, at + 4);
  if (a < 220 || !(r > g && g > b && r > 150)) {
    throw new Error('spike: reviewed contact anchor is not on opaque palm artwork');
  }
  console.log('spike: reviewed contact anchor lies on opaque palm artwork');
}

{
  const { info, pixels } = pngPixels('public/sprites/jump-serve-toss.png');
  for (const [index, palm] of Object.entries(JUMP_SERVE_TOSS_PALMS)) {
    const x = (Number(index) - 28) * 512 + palm!.x;
    const at = (palm!.y * info.width + x) * 4;
    const [r, g, b, a] = pixels.slice(at, at + 4);
    if (a < 220 || !(r > g && g > b && r > 150)) {
      throw new Error(`jumpServe ${index}: toss anchor is not on opaque palm artwork`);
    }
  }
  console.log('jumpServe: all four added toss anchors lie on opaque palm artwork');
}

{
  const { info, pixels } = pngPixels('public/sprites/serve-charge-release.png');
  for (const [index, palm] of Object.entries(SERVE_CHARGE_RELEASE_PALMS)) {
    const at = (palm.y * info.width + (Number(index) - 32) * 512 + palm.x) * 4;
    const [r,g,b,a] = pixels.slice(at, at + 4);
    if (a < 220 || !(r > g && g > b && r > 150)) throw new Error(`serve ${index}: charge-release anchor is not on opaque palm artwork`);
  }
  console.log('serve: all four charge-release anchors lie on opaque palm artwork');
}

// Recovery V3: these five authored layers are the release arena. Transparent
// layers are required to be RGBA (PNG colour type 6); backdrop and floor are
// intentionally opaque RGB (type 2), avoiding needless alpha memory.
expectPng('public/arena/v3/backdrop.png', 2560, 1440, 2);
expectPng('public/arena/v3/crowd-far.png', 2560, 900, 6);
// Pixel components cannot judge illustrated people: overlapping spectators
// form shared components, while stamped busts passed this former aesthetic gate.
// Keep the source format check; inspect rendered stands as part of visual QA.
expectPng('public/arena/v3/grandstand-manga.png', 2048, 768, 2);
// Preserved older illustrations must not accidentally satisfy the active asset check.
expectPng(`public/arena/v3/${GRANDSTAND_MANGA_SOURCE}`, 2048, 768, 2);
expectPng('public/arena/v3/led-mid.png', 2560, 512, 6);
expectPng('public/arena/v3/floor.png', 2048, 1024, 2);
expectNeutralFloorTexture('public/arena/v3/floor.png');
// New runtime material atlas; the former grayscale source remains preserved.
expectPng('public/arena/v3/surface-manga.png', 1254, 1254, 2);
expectMangaFloorAtlas('public/arena/v3/surface-manga.png');
expectPng('public/arena/v3/foreground.png', 2560, 512, 6);

// Dedicated officials atlas. It is delivered opaque because the generated
// checkerboard is removed per cell at load time by a border flood; keeping its
// exact grid dimensions is therefore part of the renderer contract.
expectPng('public/officials/v1.png', 1536, 1024, 2);
expectPng('public/officials/manga-seated.png', 1536, 1024, 6);
