/**
 * The five arena layers, drawn rather than painted.
 *
 * Recovery V3 shipped these as authored PNGs, and three of the five did not
 * survive contact with the game:
 *
 *   - `floor.png` was a court, so it replaced the projected one and put a
 *     lattice across the free zone at an angle this camera never produces;
 *   - `backdrop.png` carried a large scoreboard exactly where the HUD's own
 *     scoreboard sits, and the two read as one broken panel;
 *   - `foreground.png` laid an opaque rail across the bottom eighty pixels,
 *     which is where the control hints and both overdrive meters live.
 *
 * Two more were merely invisible. `crowd-far.png` anchors its first spectator
 * row at scene y 590; the projected floor's far edge is at screen y 299, which
 * is scene y 598, so the whole crowd was drawn and then covered by the court.
 * `led-mid.png` anchored lower still and never appeared at all.
 *
 * The cause is the same in every case: the artwork was composed for a scene
 * that is 2560x1440 of nothing in particular, while the game's camera is an
 * orthographic side elevation whose bands are fixed and computable. So the
 * bands are computed here, from the camera's own constants, and the art is
 * drawn to fit them.
 *
 *   npm run arena:v3          # rewrites public/arena/v3/*.png
 *
 * SCENE BANDS, at the 1280x720 the visual QA runs at (scene = 2 x screen):
 *
 *   scene    screen   what lives there
 *   0..200     0..100  HUD scoreboard — nothing bright, no typography
 *   200..350 100..175  roof trusses and light banks
 *   350..400 175..200  upper fascia, small dim signage
 *   400..700 200..350  crowd bank            (crowd-far.png, anchored 400)
 *   520..616 260..308  barrier and LED ribbon (led-mid.png, anchored 520)
 *   598..1304 299..652 the projected floor — backdrop hidden inside the quad
 *   1240..1404 620..702 HUD hints and overdrive meters — nothing opaque
 */
import { Rng } from '../core/rng';

/** The virtual composition every screen-space layer shares. */
export const SCENE_WIDTH = 2560;
export const SCENE_HEIGHT = 1440;

export type ArenaLayerName = 'backdrop' | 'crowd-far' | 'led-mid' | 'floor' | 'foreground';

export interface LayerSpec {
  name: ArenaLayerName;
  width: number;
  height: number;
  /** PNG colour type the asset validator requires: 2 is RGB, 6 is RGBA. */
  colourType: 2 | 6;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/* ------------------------------------------------------------------ palette */

const ROOF_VOID = '#04070e';
const HALL_DEEP = '#081420';
const HALL_NEAR = '#0a1c26';
const DECK = '#0e1c30';
const DECK_LIT = '#16283f';
const CYAN = '73,220,255';
const GOLD = '255,211,92';
const CORAL = '255,95,90';

const SEAT_SHIRTS = [
  '#d94f4f', '#3f7fd0', '#e0a63a', '#4aa76a', '#8a54c4', '#d76fa8',
  '#e7e7ec', '#33404f', '#e2703a', '#2f9ea6', '#b5495f', '#5b6ec7',
];
const SEAT_SKINS = ['#f2c6a0', '#dfa877', '#c08553', '#94602f', '#6b4324'];
const SEAT_HAIRS = ['#241a16', '#0f0d10', '#54341c', '#7d5326', '#332520', '#8d8d95'];

/**
 * How strongly a shape at scene x competes with the HUD scoreboard.
 *
 * The scoreboard is centred and at most 720 screen pixels wide, so scene
 * x 560..2000 is spoken for. Anything drawn in the roof is faded across that
 * span rather than moved out of it, which keeps the structure continuous while
 * leaving the panel a quiet field to sit on.
 */
function hudClearance(x: number): number {
  const centre = SCENE_WIDTH / 2;
  const half = 760;
  const t = Math.min(1, Math.abs(x - centre) / half);
  return 0.22 + 0.78 * t * t;
}

function verticalGradient(
  ctx: CanvasRenderingContext2D,
  top: number,
  bottom: number,
  stops: [number, string][],
): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

/* ----------------------------------------------------------------- backdrop */

/**
 * The hall itself: roof, light banks, upper deck, and the dark ground the
 * court is laid on.
 *
 * Opaque, because it is the first thing drawn and everything else composites
 * onto it. It carries no scoreboard and no large lettering: the HUD owns the
 * top of the frame, and the one piece of arena signage here is small, dim, and
 * on the fascia at screen y 180, well clear of it.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  const rng = new Rng(0x5b90);
  const W = SCENE_WIDTH;
  const H = SCENE_HEIGHT;

  // Ground tone. Dark at the roof, marginally warmer where the hall floor
  // reaches the camera, so the free zone reads as the lit part of the room.
  ctx.fillStyle = verticalGradient(ctx, 0, H, [
    [0, ROOF_VOID],
    [0.24, '#060c16'],
    [0.42, HALL_DEEP],
    [0.9, HALL_NEAR],
    [1, '#0b2029'],
  ]);
  ctx.fillRect(0, 0, W, H);

  // Roof trusses. Long diagonals with a second, shallower set crossing them,
  // faded towards the middle so the scoreboard has somewhere quiet to sit.
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = -6; i < 34; i++) {
    const x = (i * W) / 26;
    const clear = hudClearance(x + 120);
    ctx.strokeStyle = `rgba(96,132,180,${0.05 + 0.1 * clear})`;
    ctx.lineWidth = 5 + rng.next() * 7;
    ctx.beginPath();
    ctx.moveTo(x, -40);
    ctx.lineTo(x + 300, 420);
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const y = 44 + i * 68;
    ctx.strokeStyle = `rgba(120,158,205,${0.04 + i * 0.012})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + 26);
    ctx.stroke();
  }
  ctx.restore();

  // Light banks. Below the scoreboard band on purpose: a bright rectangle
  // behind translucent HUD glass is the one thing that makes a score hard to
  // read, and there is no reason for the lamps to be up there.
  for (let i = 0; i < 9; i++) {
    const x = 120 + (i * (W - 240)) / 8 + rng.spread(26);
    const y = 262 + rng.spread(16);
    drawLightBank(ctx, x, y, 0.55 + 0.45 * hudClearance(x));
  }

  // Upper deck: three receding tiers with vomitory openings.
  const deckTop = 352;
  ctx.fillStyle = verticalGradient(ctx, deckTop, 700, [
    [0, DECK],
    [0.5, DECK_LIT],
    [1, '#0b1727'],
  ]);
  ctx.fillRect(0, deckTop, W, 700 - deckTop);

  ctx.save();
  ctx.strokeStyle = 'rgba(122,163,214,0.16)';
  ctx.lineWidth = 2;
  for (const y of [deckTop + 2, 404, 470, 548, 632]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();

  for (let i = 0; i < 7; i++) {
    const x = 96 + (i * (W - 260)) / 6;
    ctx.fillStyle = 'rgba(3,6,12,0.82)';
    ctx.fillRect(x, 412, 116, 132);
    ctx.fillStyle = `rgba(${CYAN},0.34)`;
    ctx.fillRect(x, 412, 116, 5);
  }

  // The fascia. Deliberately wordless.
  //
  // A first pass ran small repeated arena signage along here. At 1280x720 it
  // came out as a legible band of type at screen y 188, which is the same
  // mistake the V3 backdrop made with its scoreboard, only lower down: the
  // background had started talking. Panel divisions say "signage" without
  // saying anything.
  ctx.fillStyle = 'rgba(6,12,22,0.9)';
  ctx.fillRect(0, 352, W, 48);
  ctx.fillStyle = `rgba(${CYAN},0.18)`;
  ctx.fillRect(0, 396, W, 3);
  for (let i = 0; i < 24; i++) {
    const x = 24 + (i * (W - 48)) / 24;
    ctx.fillStyle = `rgba(146,182,226,${0.03 + 0.03 * hudClearance(x)})`;
    ctx.fillRect(x, 360, (W - 48) / 24 - 16, 30);
  }

  // The hall ground. Almost all of this is behind the projected floor; what
  // shows are the wedges left and right of the court and the strip along the
  // bottom of the frame, which is where the HUD's hints sit — so it stays flat
  // and dark rather than patterned.
  ctx.fillStyle = verticalGradient(ctx, 700, H, [
    [0, '#0a1a26'],
    [0.35, '#0b1f29'],
    [0.78, '#091822'],
    [1, '#07131b'],
  ]);
  ctx.fillRect(0, 700, W, H - 700);

  // A single soft pool of light where the court will be laid, so the wedges at
  // the sides fall away from it instead of being uniformly black.
  const pool = ctx.createRadialGradient(W / 2, 980, 80, W / 2, 980, 1500);
  pool.addColorStop(0, 'rgba(86,170,200,0.12)');
  pool.addColorStop(0.55, 'rgba(60,130,160,0.05)');
  pool.addColorStop(1, 'rgba(40,100,130,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 700, W, H - 700);
}

function drawLightBank(ctx: CanvasRenderingContext2D, x: number, y: number, strength: number): void {
  const w = 118;
  const h = 30;
  ctx.save();
  ctx.fillStyle = 'rgba(18,32,52,0.95)';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = `rgba(${CYAN},${0.3 * strength})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  for (let i = 0; i < 6; i++) {
    const lx = x - w / 2 + 14 + i * 18;
    ctx.fillStyle = `rgba(226,244,255,${0.62 * strength})`;
    ctx.beginPath();
    ctx.arc(lx, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(x, y, 4, x, y, 190);
  glow.addColorStop(0, `rgba(190,226,255,${0.2 * strength})`);
  glow.addColorStop(0.45, `rgba(150,200,245,${0.06 * strength})`);
  glow.addColorStop(1, 'rgba(120,180,240,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ---------------------------------------------------------------- crowd-far */

/**
 * The stand, sized to the gap it actually has.
 *
 * Anchored at scene 400, the visible slot between the fascia and the far edge
 * of the projected floor is 200 scene pixels — one hundred on screen. Three
 * receding rows fill it; the rows below continue behind the court and show
 * only in the wedges beside it, which is what a stand does.
 */
function drawCrowdFar(ctx: CanvasRenderingContext2D): void {
  const rng = new Rng(0x7c11);
  const W = SCENE_WIDTH;

  // Row 0 is furthest and smallest. Each row sits on its own step.
  //
  // The first three are sized to the slot that actually exists. Anchored at
  // scene 400, the barrier lands at screen y 264 and the court's far edge at
  // 299, so the crowd has sixty-four screen pixels above the boards — 128 in
  // scene units. Rows four and five run on below that: they are covered by the
  // barrier over the court, and show in the wedges left and right of it, which
  // is where a stand carries on.
  const rows = [
    { y: 6, scale: 0.58, alpha: 0.5 },
    { y: 46, scale: 0.68, alpha: 0.62 },
    { y: 90, scale: 0.78, alpha: 0.72 },
    { y: 142, scale: 0.9, alpha: 0.78 },
    { y: 204, scale: 1.02, alpha: 0.82 },
  ];

  for (const row of rows) {
    // The step the row sits on.
    ctx.fillStyle = `rgba(11,23,38,${0.55 + row.alpha * 0.3})`;
    ctx.fillRect(0, row.y - 6, W, 62 * row.scale);
    ctx.fillStyle = 'rgba(140,178,222,0.07)';
    ctx.fillRect(0, row.y - 6, W, 3);

    const step = 34 * row.scale;
    for (let x = -20; x < W + 20; x += step) {
      if (rng.chance(0.09)) continue; // empty seats
      const cx = x + rng.spread(4);
      const cy = row.y + 28 * row.scale + rng.spread(3);
      const r = 9.5 * row.scale;
      ctx.globalAlpha = row.alpha;

      ctx.fillStyle = SEAT_SHIRTS[rng.int(0, SEAT_SHIRTS.length)];
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 1.5, r * 1.8, r * 1.35, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = SEAT_SKINS[rng.int(0, SEAT_SKINS.length)];
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = SEAT_HAIRS[rng.int(0, SEAT_HAIRS.length)];
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.17, r * 0.97, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Two flags, one per side, so the stand has an allegiance. Kept inside the
  // visible slot rather than above it, where the fascia would clip them.
  for (const [x, colour] of [[430, `rgba(${CYAN},0.8)`], [2120, `rgba(${CORAL},0.8)`]] as const) {
    ctx.strokeStyle = 'rgba(226,238,255,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x, 22);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, 26);
    ctx.lineTo(x + 74, 50);
    ctx.lineTo(x, 74);
    ctx.closePath();
    ctx.fill();
  }

  // Fade the bottom of the bank away, so the rows that continue behind the
  // court do not end on a hard edge in the wedges beside it.
  const fade = ctx.createLinearGradient(0, 262, 0, 340);
  fade.addColorStop(0, 'rgba(6,12,22,0)');
  fade.addColorStop(1, 'rgba(6,12,22,0.92)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 262, W, 78);
}

/* ------------------------------------------------------------------ led-mid */

/**
 * Advertising boards and the LED ribbon along the front of the stand.
 *
 * Anchored at scene 520, so its base lands on the far edge of the projected
 * floor at screen y 299 and the court appears to start behind it. Dim on
 * purpose: a ribbon board is scenery at the edge of the eye, and at full
 * strength it pulls attention off the ball.
 */
function drawLedMid(ctx: CanvasRenderingContext2D): void {
  const W = SCENE_WIDTH;

  // Boards.
  ctx.fillStyle = 'rgba(15,27,47,0.96)';
  ctx.fillRect(0, 8, W, 46);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 8, W, 12);
  const panels = 18;
  const step = W / panels;
  for (let i = 0; i < panels; i++) {
    ctx.fillStyle = i % 2 ? `rgba(90,140,220,0.13)` : `rgba(${GOLD},0.1)`;
    ctx.fillRect(i * step + step * 0.09, 16, step * 0.82, 30);
  }

  // The ribbon: a dark strip of lit cells.
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 54, W, 30);
  const cell = 26;
  for (let i = 0; i * cell < W; i++) {
    const phase = (i * 0.35) % 3;
    const hue = phase < 1 ? GOLD : phase < 2 ? '90,170,255' : '236,240,255';
    const lit = 0.08 + 0.17 * Math.abs(Math.sin(i * 0.7));
    ctx.fillStyle = `rgba(${hue},${lit})`;
    ctx.fillRect(i * cell, 57, cell - 6, 24);
  }

  // Bloom over the strip, so it reads as emitting rather than painted.
  const glow = ctx.createLinearGradient(0, 30, 0, 118);
  glow.addColorStop(0, `rgba(${GOLD},0)`);
  glow.addColorStop(0.5, `rgba(${GOLD},0.07)`);
  glow.addColorStop(1, `rgba(${GOLD},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 30, W, 88);

  // Kick plate, fading out where the floor takes over.
  const base = ctx.createLinearGradient(0, 84, 0, 118);
  base.addColorStop(0, 'rgba(5,10,18,0.9)');
  base.addColorStop(1, 'rgba(5,10,18,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 84, W, 34);
}

/* -------------------------------------------------------------------- floor */

/**
 * Grain, wear and sheen — and deliberately nothing else.
 *
 * The court itself is drawn by `Arena.drawGrain()`, which lays its planks by
 * sampling the camera's own floor projection and is therefore in perspective
 * by construction. This layer composites over it in `soft-light`, and its base
 * is mid grey: soft-light leaves the pixels underneath untouched wherever the
 * source is 50% grey, so only the deviations drawn here reach the screen. That
 * is what makes it possible to lay authored texture on a projected surface
 * without the two arguing about where the court is.
 *
 * Image x runs along court length, image y from the far sideline to the near
 * one, over the whole free zone.
 */
function drawFloorGrain(ctx: CanvasRenderingContext2D): void {
  const rng = new Rng(0x3f42);
  const W = 2048;
  const H = 1024;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);

  // Plank-direction grain: long horizontal streaks.
  //
  // Stronger than a first pass had it. The texture covers 2048x1024 and lands
  // on roughly 1110x350 screen pixels, so it is downsampled by three and the
  // finest detail averages itself away before anyone sees it. Measured off the
  // sheet, that first pass reached the screen as a mean shift of 1.7 levels
  // out of 255 — arithmetic, not grain.
  for (let i = 0; i < 6400; i++) {
    const y = rng.range(0, H);
    const x = rng.range(0, W);
    const len = rng.range(30, 340);
    const lift = rng.next() < 0.5 ? 1 : -1;
    const amount = rng.range(0.05, 0.19);
    ctx.strokeStyle = lift > 0
      ? `rgba(255,255,255,${amount})`
      : `rgba(0,0,0,${amount})`;
    ctx.lineWidth = rng.range(1.4, 4.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + rng.spread(1.2));
    ctx.stroke();
  }

  // Board seams, faint: the renderer draws the real ones, these only add the
  // sense that the surface is made of pieces.
  for (let y = 0; y < H; y += 8) {
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + rng.next() * 0.06})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y + rng.spread(0.6));
    ctx.lineTo(W, y + rng.spread(0.6));
    ctx.stroke();
  }

  // Scuffs from shoes: short darker arcs, clustered where players land.
  for (let i = 0; i < 320; i++) {
    const cx = rng.range(W * 0.12, W * 0.88);
    const cy = rng.range(H * 0.18, H * 0.9);
    ctx.strokeStyle = `rgba(0,0,0,${rng.range(0.06, 0.17)})`;
    ctx.lineWidth = rng.range(2.5, 8);
    ctx.beginPath();
    ctx.arc(cx, cy, rng.range(10, 46), rng.range(0, Math.PI), rng.range(Math.PI, Math.PI * 2));
    ctx.stroke();
  }

  // The sheen. Overhead banks throw a long specular sweep down a varnished
  // floor; this is that sweep, plus a gentle falloff towards both sidelines.
  const sheen = ctx.createLinearGradient(0, 0, W * 0.7, H);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.38, 'rgba(255,255,255,0.1)');
  sheen.addColorStop(0.52, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(0.66, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  const falloff = verticalGradient(ctx, 0, H, [
    [0, 'rgba(0,0,0,0.16)'],
    [0.3, 'rgba(0,0,0,0)'],
    [0.72, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.13)'],
  ]);
  ctx.fillStyle = falloff;
  ctx.fillRect(0, 0, W, H);
}

/* --------------------------------------------------------------- foreground */

/**
 * The near-camera layer, which is optics and not furniture.
 *
 * The V3 asset put an opaque broadcast rail across the bottom of the frame.
 * There is no room for one: the projected floor reaches screen y 652 and the
 * HUD's overdrive meters and control hints occupy 620 to 702, so a rail that
 * clears the court necessarily lands on the HUD, and one that clears the HUD
 * lands on the court. What the layer can do, and does here, is shape the light
 * — a lens falloff at the edges and a soft floor under the hints, which makes
 * the court the brightest thing on screen and the HUD easier to read rather
 * than harder.
 *
 * Drawn from scene 928, so image row r lands at screen 464 + r/2. Rows 312 to
 * 476 are the HUD band and carry gradient only, never an edge.
 */
function drawForeground(ctx: CanvasRenderingContext2D): void {
  const W = SCENE_WIDTH;
  const H = 512;

  // Floor under the frame: nothing at the top, deepening towards the bottom.
  const base = verticalGradient(ctx, 0, H, [
    [0, 'rgba(3,7,14,0)'],
    [0.42, 'rgba(3,7,14,0.06)'],
    [0.68, 'rgba(3,7,14,0.26)'],
    [1, 'rgba(3,7,14,0.5)'],
  ]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Lens falloff at the sides, full height, so the picture is framed.
  const left = ctx.createLinearGradient(0, 0, W * 0.16, 0);
  left.addColorStop(0, 'rgba(2,5,12,0.42)');
  left.addColorStop(1, 'rgba(2,5,12,0)');
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, W * 0.16, H);

  const right = ctx.createLinearGradient(W, 0, W * 0.84, 0);
  right.addColorStop(0, 'rgba(2,5,12,0.42)');
  right.addColorStop(1, 'rgba(2,5,12,0)');
  ctx.fillStyle = right;
  ctx.fillRect(W * 0.84, 0, W * 0.16, H);

  // A single warm rail line at the very near edge of the free zone — one pixel
  // of arena, at screen y 604, above everything the HUD owns.
  ctx.fillStyle = `rgba(${GOLD},0.07)`;
  ctx.fillRect(0, 278, W, 3);
}

/* --------------------------------------------------------------------- spec */

export const ARENA_V3_LAYERS: LayerSpec[] = [
  { name: 'backdrop', width: SCENE_WIDTH, height: SCENE_HEIGHT, colourType: 2, draw: drawBackdrop },
  { name: 'crowd-far', width: SCENE_WIDTH, height: 900, colourType: 6, draw: drawCrowdFar },
  { name: 'led-mid', width: SCENE_WIDTH, height: 512, colourType: 6, draw: drawLedMid },
  { name: 'floor', width: 2048, height: 1024, colourType: 2, draw: drawFloorGrain },
  { name: 'foreground', width: SCENE_WIDTH, height: 512, colourType: 6, draw: drawForeground },
];

/** Render one layer into a canvas and hand back its raw RGBA bytes. */
export function renderLayer(canvas: HTMLCanvasElement, name: ArenaLayerName): Uint8ClampedArray {
  const spec = ARENA_V3_LAYERS.find((l) => l.name === name);
  if (!spec) throw new Error(`unknown arena layer: ${name}`);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.clearRect(0, 0, spec.width, spec.height);
  spec.draw(ctx);
  return ctx.getImageData(0, 0, spec.width, spec.height).data;
}
