import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { type SpriteAction } from '../src/render/sprites';

const ACTIONS: SpriteAction[] = [
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

const CELL = 512;
const COLS = 6;
const ROWS = 4;
const EXPECTED_W = CELL * COLS;
const EXPECTED_H = CELL * ROWS;

interface Png {
  width: number;
  height: number;
  colourType: number;
  pixels: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function readPng(path: string): Png {
  if (!existsSync(path)) throw new Error(`missing sprite sheet: ${path}`);
  const data = readFileSync(path);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error(`${path}: not a PNG`);
  if (data.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${path}: missing IHDR`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24];
  const colourType = data[25];
  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(`${path}: motion QC requires 8-bit RGBA PNG, got bitDepth=${bitDepth} type=${colourType}`);
  }

  const idat: Buffer[] = [];
  let at = 8;
  while (at < data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(data.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }

  const inflated = inflateSync(Buffer.concat(idat));
  const channels = 4;
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
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
          throw new Error(`${path}: unsupported PNG row filter ${filter}`);
      }
    }
  }
  return { width, height, colourType, pixels };
}

function alphaAt(sheet: Png, frame: number, x: number, y: number): number {
  const col = frame % COLS;
  const row = (frame / COLS) | 0;
  const px = col * CELL + x;
  const py = row * CELL + y;
  return sheet.pixels[(py * sheet.width + px) * 4 + 3];
}

function rgbaAt(sheet: Png, frame: number, x: number, y: number): [number, number, number, number] {
  const col = frame % COLS;
  const row = (frame / COLS) | 0;
  const px = col * CELL + x;
  const py = row * CELL + y;
  const i = (py * sheet.width + px) * 4;
  return [sheet.pixels[i], sheet.pixels[i + 1], sheet.pixels[i + 2], sheet.pixels[i + 3]];
}

function frameAlphaPixels(sheet: Png, frame: number): number {
  let count = 0;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (alphaAt(sheet, frame, x, y) > 32) count++;
    }
  }
  return count;
}

function frameSignature(sheet: Png, frame: number): string {
  const bins: string[] = [];
  for (let gy = 0; gy < 18; gy++) {
    for (let gx = 0; gx < 18; gx++) {
      let alpha = 0;
      let blue = 0;
      let dark = 0;
      for (let sy = 0; sy < 10; sy++) {
        for (let sx = 0; sx < 10; sx++) {
          const x = Math.min(CELL - 1, Math.round(gx * (CELL / 18) + sx * 2.4));
          const y = Math.min(CELL - 1, Math.round(gy * (CELL / 18) + sy * 2.4));
          const [r, g, b, a] = rgbaAt(sheet, frame, x, y);
          if (a > 32) alpha++;
          if (a > 32 && b > r + 18) blue++;
          if (a > 32 && r + g + b < 160) dark++;
        }
      }
      bins.push(`${Math.round(alpha / 9)}${Math.round(blue / 9)}${Math.round(dark / 9)}`);
    }
  }
  return bins.join('.');
}

function changedPixels(sheet: Png, aFrame: number, bFrame: number): number {
  let changed = 0;
  for (let y = 0; y < CELL; y += 2) {
    for (let x = 0; x < CELL; x += 2) {
      const a = rgbaAt(sheet, aFrame, x, y);
      const b = rgbaAt(sheet, bFrame, x, y);
      const delta =
        Math.abs(a[0] - b[0]) +
        Math.abs(a[1] - b[1]) +
        Math.abs(a[2] - b[2]) +
        Math.abs(a[3] - b[3]) * 1.8;
      if (delta > 72) changed++;
    }
  }
  return changed * 4;
}

interface Bounds {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centreX: number;
  centreY: number;
}

function frameBounds(sheet: Png, frame: number): Bounds {
  let minX = CELL;
  let minY = CELL;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (alphaAt(sheet, frame, x, y) <= 32) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return { width: 0, height: 0, minX: CELL, minY: CELL, maxX: -1, maxY: -1, centreX: 0, centreY: 0 };
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    minX,
    minY,
    maxX,
    maxY,
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const thresholds: Record<SpriteAction, { distinct: number; medianChange: number }> = {
  idle: { distinct: 8, medianChange: 360 },
  walk: { distinct: 20, medianChange: 900 },
  shuffle: { distinct: 24, medianChange: 900 },
  run: { distinct: 20, medianChange: 1250 },
  approach: { distinct: 20, medianChange: 1350 },
  spike: { distinct: 20, medianChange: 1150 },
  spikeFollow: { distinct: 24, medianChange: 720 },
  block: { distinct: 18, medianChange: 900 },
  bump: { distinct: 17, medianChange: 720 },
  set: { distinct: 17, medianChange: 720 },
  backSet: { distinct: 24, medianChange: 720 },
  turn: { distinct: 24, medianChange: 720 },
  runTurn: { distinct: 24, medianChange: 720 },
  turnStop: { distinct: 24, medianChange: 720 },
  runBrake: { distinct: 24, medianChange: 720 },
  backpedal: { distinct: 24, medianChange: 900 },
  dive: { distinct: 20, medianChange: 1200 },
  serve: { distinct: 18, medianChange: 800 },
  jumpServe: { distinct: 20, medianChange: 1050 },
  jumpServeFollow: { distinct: 24, medianChange: 720 },
  celebrate: { distinct: 18, medianChange: 760 },
};

const report: Record<string, unknown> = {};
const geometry: Partial<Record<SpriteAction, number[]>> = {};
const grounded = new Set<SpriteAction>(['idle', 'walk', 'shuffle', 'backpedal', 'runTurn', 'turnStop', 'runBrake', 'turn', 'approach', 'bump', 'set', 'backSet', 'serve', 'celebrate']);
for (const action of ACTIONS) {
  const path = resolve('public/sprites', `${action}.png`);
  const sheet = readPng(path);
  if (sheet.width !== EXPECTED_W || sheet.height !== EXPECTED_H) {
    throw new Error(`${path}: expected ${EXPECTED_W}x${EXPECTED_H}, got ${sheet.width}x${sheet.height}`);
  }
  const alpha = Array.from({ length: 24 }, (_, frame) => frameAlphaPixels(sheet, frame));
  const signatures = new Set(Array.from({ length: 24 }, (_, frame) => frameSignature(sheet, frame)));
  const changes = Array.from({ length: 23 }, (_, frame) => changedPixels(sheet, frame, frame + 1));
  const bounds = Array.from({ length: 24 }, (_, frame) => frameBounds(sheet, frame));
  const medianWidth = median(bounds.map((b) => b.width));
  const medianHeight = median(bounds.map((b) => b.height));
  const minimumMargin = Math.min(
    ...bounds.map((b) => Math.min(b.minX, b.minY, CELL - 1 - b.maxX, CELL - 1 - b.maxY)),
  );
  const centreJumps = bounds.slice(1).map((b, i) =>
    Math.hypot(b.centreX - bounds[i].centreX, b.centreY - bounds[i].centreY),
  );
  const maxCentreJump = Math.max(...centreJumps);
  const groundedBottomRange = Math.max(...bounds.map((b) => b.maxY)) - Math.min(...bounds.map((b) => b.maxY));
  geometry[action] = bounds.map(b => b.width);
  const distinct = signatures.size;
  const medianChange = median(changes);
  const emptyFrames = alpha.map((value, frame) => ({ value, frame })).filter(({ value }) => value < 1800);
  const threshold = thresholds[action];
  report[action] = {
    distinctFrames: distinct,
    medianChangedPixels: medianChange,
    medianWidth,
    medianHeight,
    minimumMargin,
    maxCentreJump: Number(maxCentreJump.toFixed(2)),
    groundedBottomRange,
    medianAspect: Number((medianWidth / Math.max(1, medianHeight)).toFixed(3)),
    minAlphaPixels: Math.min(...alpha),
    maxAlphaPixels: Math.max(...alpha),
  };
  console.log(
    `${action.padEnd(11)} distinct: ${String(distinct).padStart(2)}/24  median changed px: ${String(
      medianChange,
    ).padStart(5)}  alpha px: ${Math.min(...alpha)}..${Math.max(...alpha)}  bbox ${medianWidth}x${medianHeight}`,
  );
  if (emptyFrames.length) {
    throw new Error(`${action}: empty or near-empty frames: ${emptyFrames.map(({ frame }) => frame + 1).join(', ')}`);
  }
  if (distinct < threshold.distinct) {
    throw new Error(`${action}: only ${distinct} distinct frames; expected >= ${threshold.distinct}`);
  }
  if (medianChange < threshold.medianChange) {
    throw new Error(`${action}: median frame change ${medianChange}; expected >= ${threshold.medianChange}`);
  }
  if (minimumMargin < 6) {
    throw new Error(`${action}: artwork reaches the cell edge; safe margin is only ${minimumMargin}px`);
  }
  if (maxCentreJump > 78) {
    throw new Error(`${action}: body registration jumps ${maxCentreJump.toFixed(1)}px between adjacent frames`);
  }
  if (grounded.has(action) && groundedBottomRange > 2) {
    throw new Error(`${action}: grounded feet bounce across ${groundedBottomRange}px instead of sharing one baseline`);
  }
  if (action === 'shuffle') {
    // Full-body settling redraws: the head must follow the neighbouring poses
    // instead of shrinking/dipping for a single drawing. Check imported art,
    // not just the number of distinct cells (shuffle-settle-generation.json).
    const settleCrownRows = [[11, 12, 13, 14], [16, 17, 18], [21, 22, 23]]
      .map(frames => frames.map(i => bounds[i].minY));
    for (const rows of settleCrownRows) {
      if (rows.slice(1).some((y, i) => Math.abs(y - rows[i]) > 6)) {
        throw new Error(`shuffle: settling head registration jumps (${rows.join(', ')})`);
      }
    }
    Object.assign(report[action] as object, { settleCrownRows });
  }
  if (action === 'run') {
    // The separately drawn run includes brief flight. Grounding every frame
    // erased that phase. Verify the IMPORTED pixels against the registered
    // floor, including both landings and the authored airborne drawings.
    const halfCycle = [0, 0, 0, 0, 0, 0, 0, 8, 17, 25, 17, 8];
    const expectedLift = [...halfCycle, ...halfCycle];
    // Independently redrawn first-flight inbetweens (run-flight-generation.json).
    // Their knees now unfold instead of duplicating the push pose. Sole height
    // is not a body trajectory: forcing the old 8px offset onto bent legs would
    // translate the whole head downward. These registrations preserve its arc.
    expectedLift[7] = 34;
    expectedLift[8] = 19;
    // Opposite-leg flight redraws (run-second-flight-generation.json).
    expectedLift[19] = 54;
    expectedLift[20] = 23;
    // Newly drawn landings preserve the head arc and reach real floor contact
    // before the support keys; do not re-float the whole body to old offsets.
    expectedLift[10] = 27;
    expectedLift[11] = 0;
    expectedLift[22] = 0;
    expectedLift[23] = 0;
    const actualLift = bounds.map(b => 470 - b.maxY);
    const floorErrors = actualLift.map((lift, i) => Math.abs(lift - expectedLift[i]));
    if (Math.max(...floorErrors) > 3) {
      throw new Error(`run: support/flight registration differs from the annotated floor: ${actualLift.join(', ')}`);
    }
    const flightCrownRows = [6, 7, 8, 9].map(i => bounds[i].minY);
    const flightCrownRange = Math.max(...flightCrownRows) - Math.min(...flightCrownRows);
    if (flightCrownRange > 8) {
      throw new Error(`run: first-flight head registration bobs ${flightCrownRange}px (${flightCrownRows.join(', ')})`);
    }
    const secondFlightCrownRows = [18, 19, 20, 21].map(i => bounds[i].minY);
    // Preserve the original endpoints' crown arc; inserted drawings must lie
    // between them, not introduce a new reversal or vertical spike.
    const secondFlightSteps = secondFlightCrownRows.slice(1).map((y, i) => y - secondFlightCrownRows[i]);
    if (secondFlightSteps.some(step => step < 0 || step > 8)) {
      throw new Error(`run: second-flight head registration reverses or jumps (${secondFlightCrownRows.join(', ')})`);
    }
    const landingCrownRows = [[9, 10, 11, 12], [21, 22, 23, 0]].map(frames => frames.map(i => bounds[i].minY));
    for (const rows of landingCrownRows) {
      const direction = Math.sign(rows.at(-1)! - rows[0]);
      const steps = rows.slice(1).map((y, i) => (y - rows[i]) * direction);
      if (steps.some(step => step < 0 || step > 8)) {
        throw new Error(`run: landing head registration reverses or jumps (${rows.join(', ')})`);
      }
    }
    Object.assign(report[action] as object, { registeredSoleLiftPixels: actualLift, firstFlightCrownRows: flightCrownRows, secondFlightCrownRows, landingCrownRows });
    console.log(`run: registered support/flight sole offsets ${actualLift.join(',')}`);
  }
}

// Check changes within a cycle. A walk is not required to be 36% narrower
// than a run: that old rule encouraged squeezing the lower-body drawings and
// is unrelated to human gait. The passing poses must close the stance between
// the two contacts. For the new run, compression/passing is at 3/4 and 15/16;
// 6/7 and 18/19 are extended push-off, not passing poses. Silhouette width is
// only a coarse layout proxy; art style and anatomy require visual inspection.
for (const action of ['walk', 'run'] as const) {
  const widths = geometry[action]!;
  const passingFrames = action === 'walk' ? [5, 6, 7, 17, 18, 19] : [3, 4, 15, 16];
  const passing = median(passingFrames.map(i => widths[i]));
  const contacts = median([0, 1, 11, 12, 13, 23].map(i => widths[i]));
  if (passing > contacts * 0.88) {
    throw new Error(`${action}: passing poses do not close the stance (${passing}px vs ${contacts}px at contact)`);
  }
  console.log(`${action}: passing/contact widths ${passing}/${contacts}px`);
}

const output = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/sprite-motion-qc.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log('sprite motion QC passed');
