/**
 * Development pose sheet.
 *
 * Draws every pose the game can show, large, on one page, using the exact
 * `drawPlayer` the match renderer uses. In-match screenshots put figures at
 * roughly 90 px tall, which is far too small to judge anatomy — bad
 * proportions survived several rounds of review precisely because nobody
 * could see them. This is the artist's turnaround sheet for that problem.
 *
 * Not part of the game build: only `index.html` is bundled.
 */
import { Player, PlayerAnim, defaultStats } from '../core/player';
import { Camera } from '../render/camera';
import { drawPlayer } from '../render/players';

interface Cell {
  label: string;
  anim: PlayerAnim;
  /** Overrides applied before drawing, to reach the airborne sub-poses. */
  setup?: (p: Player) => void;
}

const CELLS: Cell[] = [
  { label: 'idle', anim: 'idle' },
  { label: 'run', anim: 'run' },
  { label: 'run 2', anim: 'run' },
  { label: 'run 3', anim: 'run' },
  { label: 'run 4', anim: 'run' },
  {
    label: 'jump rise',
    anim: 'jump',
    setup: (p) => {
      p.height = 0.6;
      p.vertVel = 3;
    },
  },
  {
    label: 'spike cock',
    anim: 'jump',
    setup: (p) => {
      p.height = 0.9;
      p.vertVel = 0.2;
    },
  },
  {
    label: 'spike hit',
    anim: 'spike',
    setup: (p) => {
      p.height = 0.85;
      p.vertVel = -0.6;
      p.swing = 0.3;
    },
  },
  { label: 'block', anim: 'block', setup: (p) => (p.height = 0.7) },
  { label: 'set', anim: 'set' },
  { label: 'bump', anim: 'bump' },
  { label: 'serve', anim: 'serve' },
  { label: 'dive', anim: 'dive', setup: (p) => (p.height = 0.3) },
  { label: 'land', anim: 'land' },
  { label: 'down', anim: 'down' },
];

// Layout is URL-tunable so a single pose can be blown up for inspection:
//   /pose-sheet.html?unit=420&cols=3&only=idle,bump,spike hit
const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => Number(params.get(k) ?? d) || d;
const UNIT = num('unit', 190); // drawn standing height, in pixels
const COLS = num('cols', 6);
const CELL_W = num('cellw', Math.round(UNIT * 1.2));
const CELL_H = num('cellh', Math.round(UNIT * 1.9));
const ONLY = (params.get('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function main(): void {
  const canvas = document.getElementById('sheet') as HTMLCanvasElement;
  const shown = ONLY.length ? CELLS.filter((c) => ONLY.includes(c.label)).length : CELLS.length;
  const rows = Math.ceil(shown / COLS);
  canvas.width = COLS * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#141a2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cam = new Camera();
  // The sheet lays figures out on a grid, so the camera is replaced by a
  // straight "put the feet here" projection at a fixed scale.
  let originX = 0;
  let originY = 0;
  const scale = UNIT / 1.9 / 42;
  const fake = {
    x: 0,
    y: 0,
    depth: 0,
    scale,
    behind: false,
  };
  (cam as unknown as { project: (x: number, y: number, z: number) => typeof fake }).project = (
    _x,
    _y,
    z,
  ) => ({ ...fake, x: originX, y: originY - z * UNIT * 0.4 });
  (cam as unknown as { projectFloor: (x: number, y: number) => typeof fake }).projectFloor = () => ({
    ...fake,
    x: originX,
    y: originY,
  });

  const cells = ONLY.length ? CELLS.filter((c) => ONLY.includes(c.label)) : CELLS;
  cells.forEach((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    originX = col * CELL_W + CELL_W / 2;
    originY = row * CELL_H + CELL_H - Math.round(UNIT * 0.3);

    // Baseline and label, so the standing height is checkable by eye.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(col * CELL_W + 12, originY + 0.5);
    ctx.lineTo(col * CELL_W + CELL_W - 12, originY + 0.5);
    ctx.moveTo(col * CELL_W + 12, originY - UNIT + 0.5);
    ctx.lineTo(col * CELL_W + CELL_W - 12, originY - UNIT + 0.5);
    ctx.stroke();

    const p = new Player(i, 'home', 'outside', cell.label, defaultStats());
    p.rotationSlot = (i % 6) + 1;
    p.facing = 1;
    p.anim = cell.anim;
    cell.setup?.(p);

    // A one-second dt makes the pose smoothing land on its target instantly,
    // so a single draw shows the pose exactly as the library defines it.
    drawPlayer(ctx, cam as Camera, p, ['#2f6fd8', '#1b2b52'], {
      active: false,
      charge: 0,
      time: 0,
      dt: 1,
    });

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 ${Math.round(UNIT * 0.08)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(cell.label, originX, originY + UNIT * 0.18);
  });
}

main();
