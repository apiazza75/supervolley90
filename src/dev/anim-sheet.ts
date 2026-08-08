/**
 * Animation strip sheet.
 *
 * The pose sheet shows each pose once, held still. That is enough to judge
 * anatomy and nothing else — and every complaint about the animation has been
 * about MOTION: how a run reads, how a dive starts and lands, whether a jump
 * has weight. You cannot review motion from one frame any more than you can
 * review a song from one note.
 *
 * So this draws each action as a numbered strip across the page: the same
 * figure, the same `drawPlayer` the match uses, sampled every few hundredths
 * of a second through the whole move. Every frame is captioned with its time,
 * which gives anyone reviewing it something exact to point at — "the dive is
 * wrong from 0.15 s", "frame 4 of the run has the wrong arm" — instead of
 * "the movement is bad".
 *
 * Not part of the game build: only `index.html` is bundled.
 */
import { Player, defaultStats } from '../core/player';
import { Camera } from '../render/camera';
import { drawPlayer } from '../render/players';

interface Strip {
  /** What the row is called, and what it is meant to show. */
  label: string;
  note: string;
  /** Seconds covered by the strip. */
  span: number;
  /** Put the figure into its starting state. */
  start: (p: Player) => void;
  /** Advance one step. `t` is seconds since the strip began. */
  step: (p: Player, dt: number, t: number) => void;
}

const STRIPS: Strip[] = [
  {
    label: 'idle',
    note: 'ready stance — knees flexed, weight forward, breathing',
    span: 1.2,
    start: (p) => p.setAnim('idle'),
    step: (p, dt) => p.step(dt, 0, 0),
  },
  {
    label: 'walk',
    note: 'a positional adjustment: short stride, arms quiet',
    span: 1.2,
    start: (p) => p.setAnim('run'),
    step: (p, dt) => p.step(dt, 0, 0.32),
  },
  {
    label: 'run',
    note: 'full sprint — contralateral stride, elbows folded forward',
    span: 1.2,
    start: (p) => p.setAnim('run'),
    step: (p, dt) => p.step(dt, 0, 1),
  },
  {
    label: 'jump',
    note: 'load, rise, apex, fall, landing compression',
    span: 1.3,
    start: (p) => {
      p.setAnim('idle');
    },
    step: (p, dt, t) => {
      if (t > 0.2 && !p.airborne && p.height <= 0) p.jump();
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'spike',
    note: 'approach, arch at the apex, whip through, follow the arm down',
    span: 1.4,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      if (t > 0.2 && !p.airborne && p.height <= 0) p.jump();
      if (p.airborne && p.vertVel < 0 && p.swing <= 0 && p.anim !== 'spike') {
        p.setAnim('spike');
        p.swing = 0.3;
      }
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'block',
    note: 'both arms straight up, body a plank, penetrating over the tape',
    span: 1.1,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      if (t > 0.2 && !p.airborne && p.height <= 0) {
        p.jump();
        p.setAnim('block');
      }
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'dive',
    note: 'launch low and flat, land, SLIDE, then gather up off the floor',
    span: 1.9,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      // Exactly one dive per strip. Re-triggering whenever the body was back
      // on its feet turned the row into a stuttering loop of half-dives, which
      // is a fault in this harness rather than in the game.
      if (t > 0.15 && t < 0.16) p.dive(0, 1);
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'bump',
    note: 'platform out in front, knees under it, weight through the ball',
    span: 1.0,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      if (t > 0.15 && p.anim !== 'bump') {
        p.setAnim('bump');
        p.swing = 0.22;
      }
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'set',
    note: 'hands above the forehead, elbows out, knees loaded',
    span: 1.0,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      if (t > 0.15 && p.anim !== 'set') {
        p.setAnim('set');
        p.swing = 0.22;
      }
      p.step(dt, 0, 0);
    },
  },
  {
    label: 'celebrate',
    note: 'arms up after the point',
    span: 1.4,
    start: (p) => p.setAnim('idle'),
    step: (p, dt, t) => {
      if (t > 0.15 && p.cheerTime <= 0) p.celebrate(1.1);
      p.step(dt, 0, 0);
    },
  },
];

/** How often the strip samples, in seconds. */
const SAMPLE = 0.09;
const SIM_DT = 1 / 120;

export function drawAnimSheet(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const only = (params.get('only') ?? '').split(',').filter(Boolean);
  const strips = only.length ? STRIPS.filter((s) => only.includes(s.label)) : STRIPS;
  const cellW = Number(params.get('cell') ?? 205);
  const cellH = Math.round(cellW * 1.5);
  const cols = Math.max(...strips.map((s) => Math.ceil(s.span / SAMPLE)));
  const headerH = 40;
  const rowH = cellH + headerH;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = cols * cellW + 20;
  const height = strips.length * rowH + 20;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#141a26';
  ctx.fillRect(0, 0, width, height);

  const cam = new Camera();
  const kit: [string, string] = ['#2f6fe0', '#0f1c3a'];

  strips.forEach((strip, row) => {
    const top = 10 + row * rowH;

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(strip.label, 12, top + 18);
    ctx.fillStyle = 'rgba(190,205,230,0.75)';
    ctx.font = '400 12px system-ui, sans-serif';
    ctx.fillText(strip.note, 12 + ctx.measureText(strip.label).width + 60, top + 18);

    // One player per row, stepped forward and screenshotted at intervals. The
    // simulation runs at the real fixed timestep so the strip shows what the
    // game shows, not an idealised version of it.
    const p = new Player(row, 'home', 'outside', 'DEV', defaultStats());
    p.facing = 1;
    strip.start(p);

    let t = 0;
    let nextSample = 0;
    let col = 0;
    const frames = Math.ceil(strip.span / SIM_DT);

    for (let i = 0; i <= frames; i++) {
      if (t >= nextSample - 1e-6 && col < cols) {
        const x = 10 + col * cellW;
        const y = top + headerH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellW - 2, cellH - 2);
        ctx.clip();
        ctx.fillStyle = col % 2 ? '#1a2231' : '#171e2b';
        ctx.fillRect(x, y, cellW - 2, cellH - 2);

        // Floor line, so height off the ground is readable at a glance.
        const floorY = y + cellH * 0.86;
        ctx.strokeStyle = 'rgba(120,200,150,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, floorY);
        ctx.lineTo(x + cellW, floorY);
        ctx.stroke();

        // Park the camera so the figure lands on the floor line at a good size.
        cam.resize(cellW * 4.4, cellH * 1.9);
        cam.panY = p.pos.y;
        const proj = cam.project(0, p.pos.y, 0);
        ctx.translate(x + cellW / 2 - proj.x, floorY - proj.y);
        const ghost = { ...p, pos: { ...p.pos, x: 0 } } as unknown as Player;
        drawPlayer(ctx, cam, ghost, kit, { active: false, charge: 0, time: t, dt: SAMPLE });
        ctx.restore();

        ctx.fillStyle = 'rgba(150,170,200,0.8)';
        ctx.font = '500 10px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${col} · ${t.toFixed(2)}s`, x + 6, y + 15);
        // Name the pose the renderer actually chose, which is the thing to
        // change when a frame looks wrong.
        ctx.fillStyle = 'rgba(255,209,102,0.85)';
        ctx.fillText(p.anim, x + 5, y + cellH - 8);

        col++;
        nextSample += SAMPLE;
      }
      strip.step(p, SIM_DT, t);
      t += SIM_DT;
    }
  });
}

const canvas = document.getElementById('sheet') as HTMLCanvasElement | null;
if (canvas) drawAnimSheet(canvas, new URLSearchParams(location.search));
