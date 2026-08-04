import { Rng } from '../core/rng';
import {
  ANTENNA_HEIGHT,
  ATTACK_LINE,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  NET_HEIGHT,
} from '../core/rules';
import { Camera } from './camera';

const LINE = 'rgba(255,255,255,0.94)';
const COURT_NEAR = '#c9713a';
const SURROUND = '#2f6a5a';

interface Spectator {
  /** Seat position: x is the depth into the stand, y runs along it. */
  x: number;
  y: number;
  /** Height of this seat above the floor. */
  tier: number;
  shirt: string;
  skin: string;
  hair: string;
  /** Phase offset so the crowd does not move as one body. */
  phase: number;
  /** Some spectators stand and wave during big moments. */
  lively: number;
}

const SHIRTS = [
  '#d94f4f', '#3f7fd0', '#e0a63a', '#4aa76a', '#8a54c4', '#d76fa8',
  '#e7e7ec', '#33404f', '#e2703a', '#2f9ea6', '#b5495f', '#5b6ec7',
];
const CROWD_SKINS = ['#f2c6a0', '#dfa877', '#c08553', '#94602f', '#6b4324'];
const CROWD_HAIRS = ['#241a16', '#0f0d10', '#54341c', '#7d5326', '#332520', '#8d8d95'];

/**
 * Arena scenery drawn for the flat side-on camera: crowd, floor, court
 * markings, net and posts.
 *
 * Everything is procedural, so the build stays asset-free and the court is
 * razor sharp at any resolution — including the 2x backing store a Retina Mac
 * gives us.
 */
/** Where the stand starts, how deep it is, and how steeply it climbs. */
const STAND_FRONT = COURT_HALF_WIDTH + 2.1;
const STAND_ROWS = 8;
// Shallow rows, and shallower still now the width axis is drawn at twice the
// scale: every metre of depth climbs the screen, so a stand built to real
// spacing walks straight out of the top of the frame.
const STAND_ROW_DEPTH = 0.3;
const STAND_ROW_RISE = 0.13;
const STAND_BASE_HEIGHT = 0.45;

const rowDepth = (row: number): number => STAND_FRONT + row * STAND_ROW_DEPTH;
const rowHeight = (row: number): number => STAND_BASE_HEIGHT + row * STAND_ROW_RISE;

export class Arena {
  private crowd: Spectator[] = [];
  /** Rises after a point and decays, making the stand come alive. */
  private excitement = 0;

  constructor(seed = 4242) {
    const rng = new Rng(seed);
    for (let row = 0; row < STAND_ROWS; row++) {
      // Rows are shallow and closely spaced on purpose. The oblique projection
      // pushes every metre of depth a long way up the screen, so a stand with
      // realistic spacing would climb straight out of the frame.
      const x = rowDepth(row);
      const count = 44 + row * 3;
      for (let i = 0; i < count; i++) {
        if (rng.chance(0.07)) continue; // empty seats
        const y = -34 + (68 * (i + rng.range(0.05, 0.95))) / count;
        this.crowd.push({
          x: x + rng.spread(0.1),
          y,
          tier: rowHeight(row) + rng.spread(0.05),
          shirt: SHIRTS[rng.int(0, SHIRTS.length)],
          skin: CROWD_SKINS[rng.int(0, CROWD_SKINS.length)],
          hair: CROWD_HAIRS[rng.int(0, CROWD_HAIRS.length)],
          phase: rng.range(0, Math.PI * 2),
          lively: rng.next(),
        });
      }
    }
  }

  /** Called when something worth cheering happens. */
  cheer(amount = 1): void {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  update(dt: number): void {
    this.excitement = Math.max(0, this.excitement - dt * 0.5);
  }

  drawBackground(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const { viewWidth: w, viewHeight: h } = cam;

    // Flat fills, deliberately: gradients read as a lit 3D scene, and this
    // game is meant to read as a drawn 2D one.
    ctx.fillStyle = '#10182b';
    ctx.fillRect(0, 0, w, h);

    this.drawCrowd(ctx, cam, time);
    this.drawRoof(ctx, cam);
    this.drawBarrier(ctx, cam);
    this.drawFloor(ctx, cam);
  }

  /**
   * The stand. Each spectator is a head, hair and a pair of shoulders — three
   * shapes, but enough that the block reads as people rather than confetti,
   * which is what a bank of plain dots looked like.
   */
  private drawCrowd(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    ctx.save();
    // The stand must sit visually *behind* the play: at full strength the
    // warm-toned heads compete with the ball for attention in the exact band
    // of the screen the ball flies through.
    ctx.globalAlpha = 0.66;
    for (const s of this.crowd) {
      const bob =
        Math.sin(time * 2.2 + s.phase) * 0.035 +
        (s.lively < this.excitement ? Math.abs(Math.sin(time * 7 + s.phase)) * 0.3 : 0);

      const p = cam.project(s.x, s.y, s.tier + bob);
      const u = p.scale * 42;
      const headR = 0.115 * u;
      if (headR < 1.1) continue;

      // Shoulders.
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + headR * 1.5, headR * 1.75, headR * 1.3, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = s.shirt;
      ctx.fill();

      // Head.
      ctx.beginPath();
      ctx.arc(p.x, p.y, headR, 0, Math.PI * 2);
      ctx.fillStyle = s.skin;
      ctx.fill();

      // Hair cap.
      ctx.beginPath();
      ctx.arc(p.x, p.y - headR * 0.16, headR * 0.98, Math.PI * 1.03, Math.PI * 1.97);
      ctx.closePath();
      ctx.fillStyle = s.hair;
      ctx.fill();

      // Raised arms for the ones on their feet.
      if (s.lively < this.excitement && headR > 2) {
        ctx.strokeStyle = s.skin;
        ctx.lineWidth = headR * 0.45;
        ctx.lineCap = 'round';
        const wave = Math.sin(time * 9 + s.phase) * headR * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x - headR * 1.2, p.y + headR * 1.4);
        ctx.lineTo(p.x - headR * 1.5 + wave, p.y - headR * 1.1);
        ctx.moveTo(p.x + headR * 1.2, p.y + headR * 1.4);
        ctx.lineTo(p.x + headR * 1.5 + wave, p.y - headR * 1.1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Roof and upper deck. Without them the stand simply runs off the top of the
   * frame, which reads as an unfinished background rather than a building.
   */
  private drawRoof(ctx: CanvasRenderingContext2D, cam: Camera): void {
    // Sit the roof just above the back row, derived from the same numbers the
    // seating uses so the two can never drift apart.
    const back = rowDepth(STAND_ROWS - 1);
    const top = rowHeight(STAND_ROWS - 1) + 0.55;
    const left = cam.project(back, -34, top);
    const right = cam.project(back, 34, top);
    const { viewWidth: w } = cam;

    ctx.save();
    // Dark mass above the last row, fading down into the crowd.
    const grad = ctx.createLinearGradient(0, left.y - 140, 0, left.y + 16);
    grad.addColorStop(0, '#05070f');
    grad.addColorStop(0.7, '#080c18');
    grad.addColorStop(1, 'rgba(8,12,24,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, Math.min(0, left.y - 200), w, Math.max(0, left.y + 16));

    // Roof truss.
    ctx.strokeStyle = 'rgba(150,170,205,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, left.y);
    ctx.lineTo(w, right.y);
    ctx.stroke();

    // Floodlight banks.
    for (let i = 0; i < 5; i++) {
      const cx = (w * (i + 0.5)) / 5;
      const cy = left.y - 26 + (right.y - left.y) * ((i + 0.5) / 5);
      ctx.fillStyle = 'rgba(30,38,58,0.9)';
      ctx.fillRect(cx - 58, cy - 12, 116, 22);
      for (let j = 0; j < 4; j++) {
        const lx = cx - 42 + j * 28;
        const glow = ctx.createRadialGradient(lx, cy, 1, lx, cy, 34);
        glow.addColorStop(0, 'rgba(255,246,214,0.55)');
        glow.addColorStop(1, 'rgba(255,246,214,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, cy, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff6d6';
        ctx.beginPath();
        ctx.arc(lx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Advertising boards between the crowd and the court. */
  private drawBarrier(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const x = STAND_FRONT - 0.35;
    const top = cam.project(x, -34, 1.0);
    const bottom = cam.project(x, -34, 0);
    const right = cam.project(x, 34, 0);
    const height = bottom.y - top.y;

    ctx.save();
    ctx.fillStyle = '#16203a';
    ctx.fillRect(top.x, top.y, right.x - top.x, height);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(top.x, top.y, right.x - top.x, height * 0.28);

    // Repeating panels, so the boards read as boards and not a painted stripe.
    const panels = 16;
    const step = (right.x - top.x) / panels;
    for (let i = 0; i < panels; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(90,140,220,0.16)' : 'rgba(255,190,90,0.14)';
      ctx.fillRect(top.x + i * step + step * 0.1, top.y + height * 0.22, step * 0.8, height * 0.5);
    }
    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const outX = STAND_FRONT - 0.3;
    const outY = COURT_HALF_LENGTH + 9;

    fillQuad(ctx, cam, [[-outX, -outY], [outX, -outY], [outX, outY], [-outX, outY]], SURROUND);

    fillQuad(
      ctx,
      cam,
      [
        [-COURT_HALF_WIDTH, -COURT_HALF_LENGTH],
        [COURT_HALF_WIDTH, -COURT_HALF_LENGTH],
        [COURT_HALF_WIDTH, 0],
        [-COURT_HALF_WIDTH, 0],
      ],
      COURT_NEAR,
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
      COURT_NEAR,
    );

    this.drawGrain(ctx, cam, outX, outY);
    this.drawLightPools(ctx, cam, outX, outY);
    this.drawLines(ctx, cam);
  }

  /**
   * Wood.
   *
   * A sports hall is laid in narrow planks running the length of the court,
   * which in this projection means seams at closely spaced depths — horizontal
   * screen lines. Two things sell it: the seams themselves, and the fact that
   * every plank takes the light slightly differently, so the floor has a tone
   * that varies band to band instead of being one flat colour.
   */
  private drawGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    outX: number,
    outY: number,
  ): void {
    const rng = new Rng(0x9d0c);
    const left = cam.projectFloor(0, -outY).x;
    const right = cam.projectFloor(0, outY).x;

    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(left, right), 0, Math.abs(right - left), cam.viewHeight);
    ctx.clip();

    const PLANK = 0.16;
    for (let x = -outX; x <= outX; x += PLANK) {
      const y = cam.projectFloor(x, 0).y;
      const onCourt = Math.abs(x) <= COURT_HALF_WIDTH;
      // Tone variation, plank by plank.
      ctx.fillStyle = onCourt
        ? `rgba(${rng.next() < 0.5 ? '255,214,170' : '120,52,20'},${0.03 + rng.next() * 0.05})`
        : `rgba(${rng.next() < 0.5 ? '190,235,215' : '20,60,48'},${0.03 + rng.next() * 0.05})`;
      ctx.fillRect(Math.min(left, right), y - Math.abs(cam.projectFloor(x + PLANK, 0).y - y), Math.abs(right - left), Math.abs(cam.projectFloor(x + PLANK, 0).y - y) + 1);

      // The seam itself.
      ctx.strokeStyle = onCourt ? 'rgba(90,38,14,0.22)' : 'rgba(12,44,34,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      // Grain: short dashes along the plank, broken so it never reads as a rule.
      ctx.strokeStyle = onCourt ? 'rgba(70,30,10,0.14)' : 'rgba(10,40,30,0.14)';
      for (let k = 0; k < 5; k++) {
        const a = lerp(left, right, rng.next());
        const len = Math.abs(right - left) * (0.02 + rng.next() * 0.06);
        ctx.beginPath();
        ctx.moveTo(a, y - 1);
        ctx.lineTo(a + len, y - 1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * The floodlights, on the floor.
   *
   * Overhead banks throw overlapping pools onto a polished floor and a long
   * specular sheen along it. Without them the court is a flat swatch of colour,
   * which is exactly the 90s look this is meant to leave behind: light is what
   * tells you the surface is varnished wood in a lit building.
   */
  private drawLightPools(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    outX: number,
    outY: number,
  ): void {
    const top = cam.projectFloor(outX, 0).y;
    const bottom = cam.projectFloor(-outX, 0).y;
    const left = cam.projectFloor(0, -outY).x;
    const right = cam.projectFloor(0, outY).x;
    const height = bottom - top;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const cx = lerp(left, right, (i + 0.5) / 5);
      const cy = top + height * 0.45;
      const pool = ctx.createRadialGradient(cx, cy, 1, cx, cy, height * 1.5);
      pool.addColorStop(0, 'rgba(255,238,200,0.13)');
      pool.addColorStop(0.5, 'rgba(255,238,200,0.05)');
      pool.addColorStop(1, 'rgba(255,238,200,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.ellipse(cx, cy, height * 1.5, height * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // A darker free zone, so the court itself is the brightest thing on screen
    // and the eye goes where the ball is.
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,16,0.28)';
    const cTop = cam.projectFloor(COURT_HALF_WIDTH, 0).y;
    const cBottom = cam.projectFloor(-COURT_HALF_WIDTH, 0).y;
    ctx.fillRect(left, top, right - left, cTop - top);
    ctx.fillRect(left, cBottom, right - left, bottom - cBottom);
    ctx.restore();
  }

  private drawLines(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const W = COURT_HALF_WIDTH;
    const L = COURT_HALF_LENGTH;
    strokePath(ctx, cam, [[-W, -L], [W, -L], [W, L], [-W, L], [-W, -L]]);
    for (const y of [0, -ATTACK_LINE, ATTACK_LINE]) {
      strokePath(ctx, cam, [[-W, y], [W, y]]);
    }
  }

  /**
   * The net.
   *
   * Seen from directly side-on it has no width at all: every point of it shares
   * one screen column, so it is drawn as a narrow vertical post running from the
   * top of the far antenna down to the near sideline. That is precisely how the
   * arcade original renders it, and trying to give it visible area was what made
   * the earlier version look like an angled 3D scene.
   */
  drawNet(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const W = COURT_HALF_WIDTH;
    const cx = cam.projectFloor(0, 0).x;
    const u = cam.projectFloor(0, 0).scale * 42;
    const half = Math.max(2.5, u * 0.055);

    // Screen extents: far side is highest, near side lowest.
    const tapeFar = cam.project(W, 0, NET_HEIGHT).y;
    const tapeNear = cam.project(-W, 0, NET_HEIGHT).y;
    const footFar = cam.project(W, 0, 0).y;
    const footNear = cam.project(-W, 0, 0).y;

    ctx.save();

    // Posts, standing just outside each sideline.
    for (const [x, y] of [
      [W + 0.55, cam.project(W + 0.55, 0, 0).y],
      [-W - 0.55, cam.project(-W - 0.55, 0, 0).y],
    ] as [number, number][]) {
      const top = cam.project(x, 0, NET_HEIGHT + 0.35).y;
      ctx.strokeStyle = '#9aa3b8';
      ctx.lineWidth = half * 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, top);
      ctx.stroke();
    }

    // The net itself: a pale vertical band from the far tape to the near floor.
    const grad = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    grad.addColorStop(0, 'rgba(214,224,240,0.55)');
    grad.addColorStop(0.5, 'rgba(246,250,255,0.9)');
    grad.addColorStop(1, 'rgba(214,224,240,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - half, tapeFar, half * 2, footNear - tapeFar);

    // Mesh, as fine horizontal ticks down the band.
    ctx.strokeStyle = 'rgba(60,74,102,0.5)';
    ctx.lineWidth = 1;
    for (let y = tapeFar; y < footNear; y += Math.max(3, u * 0.09)) {
      ctx.beginPath();
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx + half, y);
      ctx.stroke();
    }

    // Bright tape along the run of the net's top edge, and the base line.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = half * 1.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx, tapeFar);
    ctx.lineTo(cx, tapeNear);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,164,190,0.8)';
    ctx.lineWidth = half;
    ctx.beginPath();
    ctx.moveTo(cx, footFar);
    ctx.lineTo(cx, footNear);
    ctx.stroke();

    // Antennae: the striped markers at each sideline, above the tape.
    for (const x of [W, -W]) {
      const a = cam.project(x, 0, NET_HEIGHT).y;
      const b = cam.project(x, 0, ANTENNA_HEIGHT).y;
      const segs = 4;
      ctx.lineWidth = half * 1.1;
      for (let i = 0; i < segs; i++) {
        ctx.strokeStyle = i % 2 === 0 ? '#ff4a3d' : '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx, a + ((b - a) * i) / segs);
        ctx.lineTo(cx, a + ((b - a) * (i + 1)) / segs);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  pts: [number, number][],
  color: string,
): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const s = cam.projectFloor(x, y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function strokePath(ctx: CanvasRenderingContext2D, cam: Camera, pts: [number, number][]): void {
  ctx.beginPath();
  let scale = 1;
  pts.forEach(([x, y], i) => {
    const s = cam.projectFloor(x, y);
    scale = Math.max(scale, s.scale);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2, 4.5 * scale);
  ctx.stroke();
}
