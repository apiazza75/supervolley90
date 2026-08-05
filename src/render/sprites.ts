/**
 * Sprite sheets.
 *
 * Procedural vector figures assembled from capsules and ellipses cannot reach
 * hand-drawn character art, and several rounds of trying established that
 * clearly enough. Drawn frames can, so this loads them.
 *
 * Every sheet is the same shape: a title bar, a 6x4 grid of 24 numbered
 * frames, a footer bar. The loader slices the grid, removes the paper the art
 * was drawn on, measures where the feet are, and hands the renderer a frame at
 * a time.
 *
 * The whole system is optional. If the files are absent — which they are until
 * someone puts them there — `loadSheets` resolves with nothing and the game
 * goes on drawing its vector figures, so a missing asset can never break a
 * build or a match.
 */

/** The actions a sheet can describe. One PNG each. */
export type SpriteAction =
  | 'idle'
  | 'approach'
  | 'spike'
  | 'block'
  | 'bump'
  | 'set'
  | 'dive'
  | 'serve'
  | 'jumpServe'
  | 'celebrate';

export interface SheetLayout {
  cols: number;
  rows: number;
  /** Chrome to cut away, as a fraction of the image, before slicing the grid. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /**
   * Where the floor sits inside a cell, as a fraction of cell height.
   *
   * Frames are aligned on this line rather than on the bottom of the drawing,
   * so a figure that leaves the ground rises in the art instead of being
   * dragged back down to stand on its own lowest pixel.
   */
  baseline: number;
  /**
   * Whether the art already contains the jump.
   *
   * For a spike or a block it does, and adding the simulation's own height on
   * top would launch the sprite twice as high as the physics says it is.
   */
  artHasLift: boolean;
  /**
   * Frames to skip, by index, because the drawing holds something other than
   * the player.
   *
   * One block frame has the net drawn into it, attached to the hitter's hands,
   * so it survives every filter as part of the figure and would appear on court
   * beside the net the game draws for itself. It was briefly rejected by how
   * wide it measured, but that margin was thin — 1.68 times the sheet's median
   * against 1.54 for a genuine spike stride — and it stopped holding the moment
   * the crop changed. Naming the frame is the honest way to say it: this one
   * cell is not a pose.
   */
  skip?: number[];
}

// Measured off the drawn sheets with tools/measure-sheet.ts, not read off a
// picture. The first set of these numbers was guessed from looking at one, and
// every one of them was wrong — the footer is nearly twice as deep as it looks
// and the floor line sits far lower in the cell than the drawing suggests.
const GRID: SheetLayout = {
  cols: 6,
  rows: 4,
  top: 0.079,
  bottom: 0.095,
  left: 0.0076,
  right: 0.0076,
  baseline: 0.978,
  artHasLift: false,
};

export const SHEETS: Record<SpriteAction, SheetLayout> = {
  idle: { ...GRID },
  approach: { ...GRID },
  spike: { ...GRID, artHasLift: true },
  block: { ...GRID, artHasLift: true, skip: [16] },
  bump: { ...GRID },
  set: { ...GRID },
  dive: { ...GRID, artHasLift: true },
  serve: { ...GRID },
  jumpServe: { ...GRID, artHasLift: true },
  celebrate: { ...GRID },
};

const SHEET_SCALE = 0.5;

/**
 * How much of a row has to be paper for it to count as inside the frame.
 *
 * Half was too strict. On the spike sheet the frames where the hitter is at
 * full stretch put a head, a raised arm and the drawn ball on the same rows,
 * which between them cover more than half the width — so the frame stopped
 * growing just under the head and cropped it off, and the headless body was
 * then scaled up to fill the missing height.
 *
 * There is room to be generous: a border or the floor plank is barely paper at
 * all, so anything above roughly a third separates them from a busy row.
 */
const PAPER_FRAC = 0.3;

export interface Frame {
  /** Source rectangle inside the keyed sheet canvas. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Where the figure's feet are, relative to the frame's top-left. */
  footX: number;
  footY: number;
  /** Tight bounds of the drawing, so a frame can be scaled by body height. */
  boxTop: number;
  boxBottom: number;
}

export interface Sheet {
  canvas: HTMLCanvasElement;
  frames: Frame[];
  layout: SheetLayout;
  /** Hue of the kit as drawn, in degrees. Used to find what to recolour. */
  kitHue: number;
  /** Recoloured copies, keyed by target colour. */
  variants: Map<string, HTMLCanvasElement>;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s < 1e-6) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  const hh = h / 360;
  return [
    Math.round(f(hh + 1 / 3) * 255),
    Math.round(f(hh) * 255),
    Math.round(f(hh - 1 / 3) * 255),
  ];
}

/**
 * The hue that dominates the drawing's saturated pixels.
 *
 * A sheet is drawn in one kit, and both teams have to be told apart on court,
 * so the kit has to be found before it can be swapped. Skin, hair, shoes and
 * the ball are mostly desaturated or a different hue, so weighting by
 * saturation and taking the strongest bucket finds the shirt reliably without
 * anyone having to hand-annotate a palette.
 */
function dominantHue(ctx: CanvasRenderingContext2D, frames: Frame[]): number {
  const bins = new Float64Array(36);
  // Sampled inside the frames only. Measuring the whole image would count the
  // sheet's own dark chrome — which covers more of the PNG than the figures do
  // — and hand back the colour of the title bar as the kit.
  for (const f of frames) {
    const d = ctx.getImageData(f.sx, f.sy, f.sw, f.sh).data;
    for (let i = 0; i < f.sw * f.sh; i += 3) {
      if (d[i * 4 + 3] < 40) continue;
      const [hue, s, l] = rgbToHsl(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      if (s < 0.25 || l < 0.08 || l > 0.94) continue;
      bins[Math.min(35, Math.floor(hue / 10))] += s;
    }
  }
  let best = 0;
  for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
  return best * 10 + 5;
}

/**
 * A copy of the sheet with the kit remapped to `hex`.
 *
 * Only pixels within a hue window of the drawn kit move, and only their hue
 * and saturation move: the lightness is left exactly as the artist set it, so
 * every fold, shadow and highlight in the shirt survives the swap. Repainting
 * the whole silhouette instead would flatten the drawing into a stencil.
 */
function recolour(sheet: Sheet, hex: string): HTMLCanvasElement {
  const cached = sheet.variants.get(hex);
  if (cached) return cached;

  const src = sheet.canvas;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);

  const n = parseInt(hex.replace('#', ''), 16);
  const [th, ts] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  // Memoised by packed RGB. A drawing uses a few hundred distinct colours over
  // a million and a half pixels, and converting each pixel through HSL and back
  // stalled startup long enough to be visible; looking the answer up instead
  // makes the swap effectively free.
  const map = new Map<number, number>();
  for (let i = 0; i < out.width * out.height; i++) {
    if (d[i * 4 + 3] < 40) continue;
    const key = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    let val = map.get(key);
    if (val === undefined) {
      val = key;
      const [hue, s, l] = rgbToHsl(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      let diff = Math.abs(hue - sheet.kitHue);
      if (diff > 180) diff = 360 - diff;
      if (s >= 0.18 && diff <= 40) {
        const [r, g, b] = hslToRgb(th, Math.max(ts * 0.8, s), l);
        val = (r << 16) | (g << 8) | b;
      }
      map.set(key, val);
    }
    if (val === key) continue;
    d[i * 4] = (val >> 16) & 255;
    d[i * 4 + 1] = (val >> 8) & 255;
    d[i * 4 + 2] = val & 255;
  }
  ctx.putImageData(img, 0, 0);
  sheet.variants.set(hex, out);
  return out;
}

/** The sheet's canvas painted in a team's kit colour. */
export function kitCanvas(sheet: Sheet, hex: string): HTMLCanvasElement {
  return recolour(sheet, hex);
}

/**
 * Strip the paper.
 *
 * A luminance threshold would eat the kit's white panels, the socks and the
 * shoes along with the background, so instead this floods inward from the
 * frame's edges and only clears white that is CONNECTED to the outside. White
 * enclosed by the drawing — which is all of the white worth keeping — survives.
 */
function keyOut(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  w: number,
  h: number,
): void {
  const img = ctx.getImageData(rx, ry, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];

  const isPaper = (i: number): boolean =>
    d[i * 4] > 218 && d[i * 4 + 1] > 218 && d[i * 4 + 2] > 214;

  // Seeded from THIS CELL's border, not the sheet's. Flooding the whole image
  // never reached the paper at all: every cell is ringed by dark chrome, so
  // the fill stopped at the outer edge and the sheets came through with their
  // backgrounds intact — white slabs laid over the court.
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  while (stack.length) {
    const i = stack.pop() as number;
    if (i < 0 || i >= w * h || seen[i]) continue;
    if (!isPaper(i)) continue;
    seen[i] = 1;
    d[i * 4 + 3] = 0;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  ctx.putImageData(img, rx, ry);
}

/**
 * Keep only the biggest drawn shape in the frame, and erase the rest.
 *
 * What survives the paper strip is not only the player. Every cell carries its
 * frame number in the corner, several carry the ball the artist drew, and the
 * cell borders leave fragments along the edges. Cropping them away is not an
 * option: the numbers sit exactly where a jumping figure's head goes, so any
 * inset big enough to lose the number decapitates the spike.
 *
 * They are all, however, separate from the body — and much smaller than it. So
 * the figure is found rather than framed: label the connected shapes, keep the
 * largest, clear everything else. That also drops the drawn ball for free,
 * which the game needs gone regardless since it draws its own.
 */
function keepLargestBlob(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  w: number,
  h: number,
): void {
  const img = ctx.getImageData(rx, ry, w, h);
  const d = img.data;
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(w * h);

  for (let start = 0; start < w * h; start++) {
    if (label[start] >= 0 || d[start * 4 + 3] < 40) continue;
    const id = sizes.length;
    let size = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = id;
    while (head < tail) {
      const i = queue[head++];
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      // Eight-connected: drawn linework thins to a diagonal hairline at the
      // wrists and ankles, and four-connectivity snaps a hand off there.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] >= 0 || d[n * 4 + 3] < 40) continue;
          label[n] = id;
          queue[tail++] = n;
        }
      }
    }
    sizes.push(size);
  }

  if (!sizes.length) return;
  let largest = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largest]) largest = i;

  // Biggest is not always the player. Some frames have the net drawn in, and a
  // net is a tall lattice that can outweigh the figure — on one block frame it
  // won outright and the player was the thing that got erased. Among shapes
  // substantial enough to be a body, take the one nearest the middle of the
  // cell: the artist composed the player there and put the net at the edge.
  const centreX = w / 2;
  let best = largest;
  let bestDist = Infinity;
  const sums = new Float64Array(sizes.length);
  const counts = new Float64Array(sizes.length);
  for (let i = 0; i < w * h; i++) {
    const id = label[i];
    if (id < 0) continue;
    sums[id] += i % w;
    counts[id]++;
  }
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] < sizes[largest] * 0.25) continue;
    const dist = Math.abs(sums[id] / counts[id] - centreX);
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== best) d[i * 4 + 3] = 0;
  }
  ctx.putImageData(img, rx, ry);
}

/** Tight bounds of the drawn pixels inside a source rectangle. */
function measure(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): { top: number; bottom: number; centreX: number } {
  const img = ctx.getImageData(sx, sy, sw, sh);
  const d = img.data;
  let top = sh;
  let bottom = 0;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (d[(y * sw + x) * 4 + 3] < 40) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      sum += x;
      count++;
    }
  }
  return {
    top: count ? top : 0,
    bottom: count ? bottom : sh,
    centreX: count ? sum / count : sw / 2,
  };
}

/**
 * The paper interior of one cell.
 *
 * A uniform grid is close but never exact — the borders wander a few pixels
 * from where dividing the sheet evenly says they are — and cropping on a
 * nominal edge leaves part of the border inside the frame. That residue is not
 * harmless: the anti-aliased shoulder of a border sits around RGB 170, too
 * dark to be keyed as paper, and it touches the figure often enough that the
 * blob filter adopts it, so pale hairlines trail off the player.
 *
 * Chasing the border by looking for the darkest line nearby fails on the
 * bottom edge, where the darkest line is the far side of the floor plank and
 * snapping to it drags the whole plank into frame.
 *
 * So the frame is defined by what it IS rather than by what surrounds it: find
 * the rows and columns that are mostly paper. Borders are not paper, the plank
 * is not paper, and a figure never covers enough of a row or column to make it
 * stop being mostly paper. The bottom of that region is where the paper meets
 * the plank, which is exactly the line the artist drew the feet standing on.
 */
function paperInterior(
  isPaperAt: (x: number, y: number) => boolean,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const fracRow = (y: number): number => {
    let n = 0;
    for (let x = x0; x <= x1; x += 2) if (isPaperAt(x, y)) n++;
    return n / ((x1 - x0) / 2 + 1);
  };
  const fracCol = (x: number): number => {
    let n = 0;
    for (let y = y0; y <= y1; y += 2) if (isPaperAt(x, y)) n++;
    return n / ((y1 - y0) / 2 + 1);
  };

  // Rows grow OUTWARD from the middle of the cell. Scanning inward from below
  // instead put the bottom edge wherever the first mostly-paper row happened to
  // be, and with the grid drifting a few pixels that row belongs to the NEXT
  // cell: the crop then swallowed the floor plank and a slice of the frame
  // underneath. Starting inside and stopping at the first row that is not paper
  // cannot leave the cell it started in.
  const mid = (y0 + y1) >> 1;
  let top = mid;
  while (top > y0 && fracRow(top - 1) >= PAPER_FRAC) top--;
  let bottom = mid;
  while (bottom < y1 && fracRow(bottom + 1) >= PAPER_FRAC) bottom++;
  let left = x0;
  while (left < x1 && fracCol(left) < PAPER_FRAC) left++;
  let right = x1;
  while (right > left && fracCol(right) < PAPER_FRAC) right--;

  // A couple of pixels off the top and sides. The row where paper meets border
  // is a blend of the two, light enough to pass as paper and dark enough to
  // survive keying, and it shows up as a hairline ruled across the top of the
  // frame. The bottom is left alone: that edge is the floor.
  top += 5;
  left += 2;
  right -= 2;

  if (right - left < 16 || bottom - top < 16) return null;
  return { sx: left, sy: top, sw: right - left + 1, sh: bottom - top + 1 };
}

/**
 * Replace frames that do not hold a whole figure.
 *
 * Not every cell on a drawn sheet is a pose. One block sheet spends a frame on
 * a close-up of the player's face, and a couple of others are mostly net. Drawn
 * as-is these are scaled to body height like everything else, so the close-up
 * becomes a head the size of a person and the net-only cell becomes a player
 * who vanishes for a frame.
 *
 * They are recognisable without knowing what they contain: a sheet's frames all
 * hold a figure of roughly one height, and these do not. Anything far off the
 * sheet's own median defers to the nearest frame that is not, which costs a
 * little animation and never shows a monster.
 */
function dropOutliers(frames: Frame[], skip: number[]): Frame[] {
  const heights = frames.map((f) => f.footY - f.boxTop);
  const median = [...heights].sort((a, b) => a - b)[heights.length >> 1];
  if (!median) return frames;
  const ok = heights.map(
    (h, i) => h > median * 0.55 && h < median * 1.5 && !skip.includes(i),
  );
  if (ok.every(Boolean) || !ok.some(Boolean)) return frames;

  return frames.map((f, i) => {
    if (ok[i]) return f;
    for (let d = 1; d < frames.length; d++) {
      const a = i - d;
      const b = i + d;
      if (a >= 0 && ok[a]) return frames[a];
      if (b < frames.length && ok[b]) return frames[b];
    }
    return f;
  });
}

/**
 * Decode a sheet into something a canvas can be read back from.
 *
 * Fetched as bytes and decoded from a Blob rather than pointed at with an
 * `<img src>`. Every part of this file works by reading pixels back out of a
 * canvas, and a canvas that has had a cross-origin image drawn into it refuses
 * to be read — `getImageData` throws instead of returning. In the browser, dev
 * server and page share an origin so nothing is cross-origin; in the packaged
 * application the files arrive over the shell's own protocol, which need not
 * count as the same origin as the page. A Blob always does.
 */
function fromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`could not decode ${src}`));
    el.src = src;
  });
}

async function decode(url: string): Promise<ImageBitmap | HTMLImageElement> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await fromUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (err) {
    // The packaged application restricts what the page may connect to, and the
    // fetch itself can be refused. Loading the file directly is then the only
    // route left; it risks the tainting this function exists to avoid, but a
    // route that might work beats one that certainly does not, and the caller
    // reports it either way.
    console.warn(`[sprites] fetch failed for ${url}, loading directly:`, err);
    return fromUrl(url);
  }
}

async function loadOne(url: string, layout: SheetLayout): Promise<Sheet | null> {
  const img = await decode(url);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const gx = layout.left * canvas.width;
  const gy = layout.top * canvas.height;
  const gw = canvas.width * (1 - layout.left - layout.right);
  const gh = canvas.height * (1 - layout.top - layout.bottom);
  const cw = gw / layout.cols;
  const ch = gh / layout.rows;

  // One pass over the sheet, used to locate each cell's paper interior.
  const full = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const isPaperAt = (x: number, y: number): boolean => {
    const i = (y * canvas.width + x) * 4;
    return full[i] > 218 && full[i + 1] > 218 && full[i + 2] > 214;
  };

  const frames: Frame[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      // Yield between cells. Preparing a whole sheet in one go blocks for the
      // better part of a second, and ten of those in a row is long enough that
      // the opening keypresses land on a frozen game and are lost. A cell is
      // small enough that nobody can see the pause.
      await new Promise((res) => setTimeout(res, 0));
      // A small inset clears the cell border. The bottom is cut at the floor
      // line instead, which is what removes the wooden plank the artist drew
      // under each row — keyed art would otherwise carry a length of flooring
      // around the court under every player.
      const rect = paperInterior(
        isPaperAt,
        Math.max(0, Math.round(gx + c * cw) - 2),
        Math.max(0, Math.round(gy + r * ch) - 2),
        Math.min(canvas.width - 1, Math.round(gx + (c + 1) * cw) + 2),
        Math.min(canvas.height - 1, Math.round(gy + (r + 1) * ch) + 2),
      );
      if (!rect) continue;
      const { sx, sy, sw, sh } = rect;
      keyOut(ctx, sx, sy, sw, sh);
      keepLargestBlob(ctx, sx, sy, sw, sh);
      const m = measure(ctx, sx, sy, sw, sh);
      frames.push({
        sx,
        sy,
        sw,
        sh,
        // Anchored on the cell's centre rather than the drawing's centroid.
        // The centroid shifts whenever a limb extends, so a run cycle anchored
        // on it slides the player sideways on every frame; the artist composed
        // each pose inside its cell, so the cell is the registration.
        footX: sw / 2,
        // The paper ends where the plank begins, so the bottom of the crop
        // IS the line the artist drew the feet standing on.
        footY: sh,
        boxTop: m.top,
        boxBottom: m.bottom,
      });
    }
  }
  const kitHue = dominantHue(ctx, frames);

  // Kept at half size from here on. The sheets are drawn far larger than they
  // are ever shown — a frame is over 200 pixels tall and a player on court is
  // under 90 — and every recoloured kit is a whole copy of the sheet, so at
  // full resolution the two teams and their liberos would hold a quarter of a
  // gigabyte of canvases between them. The keying and the shape-finding were
  // done at full resolution, where the edges are still crisp; only the result
  // is shrunk.
  // Repacked with a transparent gutter around every frame, rather than kept as
  // one shrunken photograph of the sheet.
  //
  // Drawing a sub-rectangle of an image at a reduced size samples slightly
  // OUTSIDE that rectangle, and what lies immediately outside a frame is the
  // cell border. That bleed put a pale line across the players on court while
  // the frames themselves were provably clean — measuring one found no wide
  // run of pixels in it anywhere. Give each frame empty space to bleed into
  // and there is nothing left to drag in.
  const picked = dropOutliers(frames, layout.skip ?? []);
  const gut = 3;
  const cellW = Math.ceil(Math.max(...picked.map((f) => f.sw)) * SHEET_SCALE) + gut * 2;
  const cellH = Math.ceil(Math.max(...picked.map((f) => f.sh)) * SHEET_SCALE) + gut * 2;

  const small = document.createElement('canvas');
  small.width = cellW * layout.cols;
  small.height = cellH * layout.rows;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.imageSmoothingQuality = 'high';

  const scaled = picked.map((f, i) => {
    const dw = Math.round(f.sw * SHEET_SCALE);
    const dh = Math.round(f.sh * SHEET_SCALE);
    const dx = (i % layout.cols) * cellW + gut;
    const dy = ((i / layout.cols) | 0) * cellH + gut;
    sctx.drawImage(canvas, f.sx, f.sy, f.sw, f.sh, dx, dy, dw, dh);
    return {
      sx: dx,
      sy: dy,
      sw: dw,
      sh: dh,
      footX: f.footX * SHEET_SCALE,
      footY: f.footY * SHEET_SCALE,
      boxTop: f.boxTop * SHEET_SCALE,
      boxBottom: f.boxBottom * SHEET_SCALE,
    };
  });

  return { canvas: small, frames: scaled, layout, kitHue, variants: new Map() };
}

export type SheetSet = Partial<Record<SpriteAction, Sheet>>;

/**
 * Load whatever is present under `/sprites`. Missing files are not an error:
 * the caller falls back to the vector figures for anything absent.
 */
export async function loadSheets(
  base = 'sprites',
  onSheet?: (action: SpriteAction, sheet: Sheet) => void,
  onError?: (action: SpriteAction, reason: string) => void,
): Promise<SheetSet> {
  const names = Object.keys(SHEETS) as SpriteAction[];
  const out: SheetSet = {};
  // One sheet at a time, yielding in between. Preparing all ten at once holds
  // the main thread for seconds — long enough that the game does not respond to
  // its first inputs — because each one is flood-filled and shape-labelled a
  // cell at a time. Handing each finished sheet over as it arrives means the
  // match starts on vector figures and takes on the drawn ones as they land,
  // instead of waiting for the slowest.
  for (const n of names) {
    // Resolved against the document rather than left relative, so it does not
    // depend on what the page's path happens to be once bundled.
    const url = new URL(`${base}/${n}.png`, document.baseURI).href;
    const sheet = await loadOne(url, SHEETS[n]).catch((err: unknown) => {
      // Said out loud. Falling back to the vector figures is the right
      // behaviour when a sheet is genuinely absent, but doing it silently is
      // how a build shipped where NOTHING loaded and the only clue was that
      // the players looked like the old ones.
      console.error(`[sprites] ${n} failed to load from ${url}:`, err);
      onError?.(n, err instanceof Error ? err.message : String(err));
      return null;
    });
    if (sheet) {
      out[n] = sheet;
      onSheet?.(n, sheet);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * Draw one frame with its feet at (x, y) and the figure scaled to `height`
 * pixels from the floor to the top of the head.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  index: number,
  x: number,
  y: number,
  height: number,
  facing = 1,
  kit?: string,
): void {
  const f = sheet.frames[Math.max(0, Math.min(sheet.frames.length - 1, index))];
  if (!f) return;
  // Scale so the drawn body occupies `height`, measured from the sheet's floor
  // line to the highest drawn pixel. Scaling by the cell instead would make the
  // figure shrink and grow as the pose reached higher or lower.
  const drawn = Math.max(1, f.footY - f.boxTop);
  const k = height / drawn;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.drawImage(
    kit ? kitCanvas(sheet, kit) : sheet.canvas,
    f.sx,
    f.sy,
    f.sw,
    f.sh,
    -f.footX * k,
    -f.footY * k,
    f.sw * k,
    f.sh * k,
  );
  ctx.restore();
}
