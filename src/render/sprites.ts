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
}

const GRID: SheetLayout = {
  cols: 6,
  rows: 4,
  top: 0.072,
  bottom: 0.052,
  left: 0.006,
  right: 0.006,
  baseline: 0.93,
  artHasLift: false,
};

export const SHEETS: Record<SpriteAction, SheetLayout> = {
  idle: { ...GRID },
  approach: { ...GRID },
  spike: { ...GRID, artHasLift: true },
  block: { ...GRID, artHasLift: true },
  bump: { ...GRID },
  set: { ...GRID },
  dive: { ...GRID, artHasLift: true },
  serve: { ...GRID },
  jumpServe: { ...GRID, artHasLift: true },
  celebrate: { ...GRID },
};

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
  return { top: count ? top : 0, bottom: count ? bottom : sh, centreX: count ? sum / count : sw / 2 };
}

async function loadOne(url: string, layout: SheetLayout): Promise<Sheet | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = url;
  });
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const gx = layout.left * canvas.width;
  const gy = layout.top * canvas.height;
  const gw = canvas.width * (1 - layout.left - layout.right);
  const gh = canvas.height * (1 - layout.top - layout.bottom);
  const cw = gw / layout.cols;
  const ch = gh / layout.rows;

  const frames: Frame[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      // Inset: the cells carry a border, and a frame number in the top-left
      // corner that would otherwise be keyed as part of the drawing and follow
      // the player around the court.
      const pad = cw * 0.035;
      const numberBand = ch * 0.1;
      const sx = Math.round(gx + c * cw + pad);
      const sy = Math.round(gy + r * ch + pad + numberBand);
      const sw = Math.round(cw - pad * 2);
      const sh = Math.round(ch - pad * 2 - numberBand);
      keyOut(ctx, sx, sy, sw, sh);
      const m = measure(ctx, sx, sy, sw, sh);
      frames.push({
        sx,
        sy,
        sw,
        sh,
        footX: m.centreX,
        footY: sh * ((layout.baseline - 0.1) / 0.9),
        boxTop: m.top,
        boxBottom: m.bottom,
      });
    }
  }
  return {
    canvas,
    frames,
    layout,
    kitHue: dominantHue(ctx, frames),
    variants: new Map(),
  };
}

export type SheetSet = Partial<Record<SpriteAction, Sheet>>;

/**
 * Load whatever is present under `/sprites`. Missing files are not an error:
 * the caller falls back to the vector figures for anything absent.
 */
export async function loadSheets(base = 'sprites'): Promise<SheetSet> {
  const names = Object.keys(SHEETS) as SpriteAction[];
  const loaded = await Promise.all(
    names.map((n) => loadOne(`${base}/${n}.png`, SHEETS[n]).catch(() => null)),
  );
  const out: SheetSet = {};
  names.forEach((n, i) => {
    const sheet = loaded[i];
    if (sheet) out[n] = sheet;
  });
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
