import { Rng } from '../core/rng';
import {
  ANTENNA_HEIGHT,
  ATTACK_LINE,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  NET_BOTTOM,
  NET_HEIGHT,
} from '../core/rules';
import { Camera } from './camera';

const LINE = 'rgba(255,255,255,0.92)';
const COURT_IN = '#c9713a';
const COURT_OUT = '#2f6a5a';

/**
 * The static scenery: crowd, floor, court markings, net and posts.
 *
 * All of it is drawn procedurally. That keeps the build asset-free and, more
 * usefully, means the court stays razor sharp at any resolution — including
 * the 2x Retina backing store a Mac gives us.
 */
export class Arena {
  private crowd: { x: number; y: number; r: number; c: string }[] = [];

  constructor(seed = 4242) {
    const rng = new Rng(seed);
    const palette = ['#2b3350', '#3a2f4d', '#243a52', '#4a3350', '#1f2c44', '#553a46'];
    // Two banks of spectators behind the far baseline.
    for (let i = 0; i < 900; i++) {
      this.crowd.push({
        x: rng.range(-30, 30),
        y: rng.range(12, 30),
        r: rng.range(0.16, 0.3),
        c: palette[rng.int(0, palette.length)],
      });
    }
  }

  drawBackground(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const { viewWidth: w, viewHeight: h } = cam;

    // Hall interior: dark up top, warm light spilling onto the floor.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a0d1c');
    sky.addColorStop(0.42, '#141a30');
    sky.addColorStop(0.66, '#1d2440');
    sky.addColorStop(1, '#10152a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this.drawCrowd(ctx, cam, time);
    this.drawFloor(ctx, cam);
  }

  private drawCrowd(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    ctx.save();
    for (let i = 0; i < this.crowd.length; i++) {
      const c = this.crowd[i];
      // Tiered seating: further back means higher up.
      const tier = (c.y - 12) * 0.42 + 1.2;
      const sway = Math.sin(time * 1.6 + i * 0.7) * 0.05;
      const s = cam.project(c.x, c.y, tier + sway);
      if (s.behind || s.scale <= 0) continue;
      const r = c.r * s.scale * 42;
      if (r < 0.4) continue;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = c.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const outX = COURT_HALF_WIDTH + 5.5;
    const outY = COURT_HALF_LENGTH + 5.0;

    fillQuad(
      ctx,
      cam,
      [
        [-outX, -outY],
        [outX, -outY],
        [outX, outY],
        [-outX, outY],
      ],
      COURT_OUT,
    );

    // Court surface with a subtle two-tone so the halves read apart.
    fillQuad(
      ctx,
      cam,
      [
        [-COURT_HALF_WIDTH, -COURT_HALF_LENGTH],
        [COURT_HALF_WIDTH, -COURT_HALF_LENGTH],
        [COURT_HALF_WIDTH, 0],
        [-COURT_HALF_WIDTH, 0],
      ],
      COURT_IN,
    );
    fillQuad(
      ctx,
      cam,
      [
        [-COURT_HALF_WIDTH, 0],
        [COURT_HALF_WIDTH, 0],
        [COURT_HALF_WIDTH, COURT_HALF_LENGTH],
        [-COURT_HALF_WIDTH, COURT_HALF_LENGTH],
      ],
      '#bd6835',
    );

    // Pool of light under the net, the way an arena spot would fall.
    const centre = cam.projectFloor(0, 0);
    if (!centre.behind) {
      const r = 520 * centre.scale;
      const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, r);
      glow.addColorStop(0, 'rgba(255,236,196,0.20)');
      glow.addColorStop(1, 'rgba(255,236,196,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawLines(ctx, cam);
  }

  private drawLines(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const W = COURT_HALF_WIDTH;
    const L = COURT_HALF_LENGTH;
    strokePath(ctx, cam, [
      [-W, -L],
      [W, -L],
      [W, L],
      [-W, L],
      [-W, -L],
    ]);
    strokePath(ctx, cam, [
      [-W, 0],
      [W, 0],
    ]);
    strokePath(ctx, cam, [
      [-W, -ATTACK_LINE],
      [W, -ATTACK_LINE],
    ]);
    strokePath(ctx, cam, [
      [-W, ATTACK_LINE],
      [W, ATTACK_LINE],
    ]);
  }

  /**
   * The net is drawn after the far team and before the near team, so bodies
   * correctly pass behind and in front of it.
   */
  drawNet(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const W = COURT_HALF_WIDTH;

    // Posts.
    for (const x of [-W - 0.5, W + 0.5]) {
      const foot = cam.project(x, 0, 0);
      const top = cam.project(x, 0, NET_HEIGHT + 0.35);
      if (foot.behind || top.behind) continue;
      ctx.strokeStyle = '#8b93a8';
      ctx.lineWidth = Math.max(2, 7 * top.scale);
      ctx.beginPath();
      ctx.moveTo(foot.x, foot.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }

    // Mesh: vertical then horizontal strands, faded so it never hides the ball.
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = '#e8eef8';
    ctx.lineWidth = 1;
    const cols = 46;
    for (let i = 0; i <= cols; i++) {
      const x = -W + (2 * W * i) / cols;
      const a = cam.project(x, 0, NET_BOTTOM);
      const b = cam.project(x, 0, NET_HEIGHT);
      if (a.behind || b.behind) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const rows = 10;
    for (let j = 0; j <= rows; j++) {
      const z = NET_BOTTOM + ((NET_HEIGHT - NET_BOTTOM) * j) / rows;
      const a = cam.project(-W, 0, z);
      const b = cam.project(W, 0, z);
      if (a.behind || b.behind) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // The white tape along the top: the single most important visual reference
    // for judging whether a spike will clear.
    const tapeL = cam.project(-W, 0, NET_HEIGHT);
    const tapeR = cam.project(W, 0, NET_HEIGHT);
    if (!tapeL.behind && !tapeR.behind) {
      ctx.strokeStyle = '#f7fbff';
      ctx.lineWidth = Math.max(2.5, 9 * tapeL.scale);
      ctx.beginPath();
      ctx.moveTo(tapeL.x, tapeL.y);
      ctx.lineTo(tapeR.x, tapeR.y);
      ctx.stroke();
    }

    // Antennae.
    for (const x of [-W, W]) {
      const a = cam.project(x, 0, NET_HEIGHT);
      const b = cam.project(x, 0, ANTENNA_HEIGHT);
      if (a.behind || b.behind) continue;
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        ctx.strokeStyle = i % 2 === 0 ? '#ff4a3d' : '#ffffff';
        ctx.lineWidth = Math.max(1.5, 4 * a.scale);
        ctx.beginPath();
        ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
        ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
        ctx.stroke();
      }
    }
  }
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  pts: [number, number][],
  color: string,
): void {
  ctx.beginPath();
  let started = false;
  for (const [x, y] of pts) {
    const s = cam.projectFloor(x, y);
    if (s.behind) return;
    if (!started) {
      ctx.moveTo(s.x, s.y);
      started = true;
    } else {
      ctx.lineTo(s.x, s.y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function strokePath(ctx: CanvasRenderingContext2D, cam: Camera, pts: [number, number][]): void {
  ctx.beginPath();
  let started = false;
  let scale = 1;
  for (const [x, y] of pts) {
    const s = cam.projectFloor(x, y);
    if (s.behind) return;
    scale = Math.max(scale, s.scale);
    if (!started) {
      ctx.moveTo(s.x, s.y);
      started = true;
    } else {
      ctx.lineTo(s.x, s.y);
    }
  }
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, 5 * scale);
  ctx.stroke();
}
