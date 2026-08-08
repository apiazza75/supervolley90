import { existsSync, readFileSync } from 'node:fs';

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

const sprites = [
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
];
for (const name of sprites) expectPng(`public/sprites/${name}.png`, 3072, 2048, 6);

// Recovery V3: these five authored layers are the release arena. Transparent
// layers are required to be RGBA (PNG colour type 6); backdrop and floor are
// intentionally opaque RGB (type 2), avoiding needless alpha memory.
expectPng('public/arena/v3/backdrop.png', 2560, 1440, 2);
expectPng('public/arena/v3/crowd-far.png', 2560, 900, 6);
expectPng('public/arena/v3/led-mid.png', 2560, 512, 6);
expectPng('public/arena/v3/floor.png', 2048, 1024, 2);
expectPng('public/arena/v3/foreground.png', 2560, 512, 6);
