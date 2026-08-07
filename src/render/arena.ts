import { Rng } from '../core/rng';
import {
  ANTENNA_HEIGHT,
  ATTACK_LINE,
  COURT_HALF_LENGTH,
  COURT_HALF_WIDTH,
  NET_HEIGHT,
} from '../core/rules';
import { ArenaArtwork } from './arena-art';
import { Camera } from './camera';

const LINE = 'rgba(255,255,255,0.94)';
const COURT_NEAR = '#b85d3a';
const SURROUND = '#173844';

export interface ArenaDrawable {
  depth: number;
  draw: () => void;
}

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
 * Illustrated layers are loaded when present; the procedural arena remains
 * a complete fallback. Court lines, lighting and match reactions stay live and
 * razor sharp at any resolution, including a Retina Mac backing store.
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
  /** Optional illustrated layers; procedural drawing remains the fallback. */
  private readonly artwork = new ArenaArtwork();

  get artAssetCount(): number {
    return this.artwork.loadedCount;
  }

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

    if (this.artwork.complete) {
      // Recovery V3 is one authored composition.  Returning here is deliberate:
      // no legacy crowd, roof, barrier or ribbon may be painted over these layers.
      this.artwork.drawBackdrop(ctx, w, h);
      this.artwork.drawCrowdFar(ctx, w, h);
      this.artwork.drawLedMid(ctx, w, h);
      this.drawShafts(ctx, cam, time);
      this.drawFloor(ctx, cam);
      return;
    }

    if (!import.meta.env.DEV) {
      // A release with incomplete art must be visibly broken and fail visual QA,
      // rather than silently shipping the legacy arena again.
      ctx.fillStyle = '#07101f';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.fillStyle = '#ff8f8f';
      ctx.font = '700 15px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `ARENA V3 INCOMPLETE — ${this.artwork.loadedCount}/5 layers`,
        24,
        38,
      );
      const failed = this.artwork.failedLayers.join(', ');
      if (failed) ctx.fillText(`failed: ${failed}`, 24, 60);
      ctx.restore();
      return;
    }

    // Development-only fallback: useful while an artist is regenerating files.
    ctx.fillStyle = '#10182b';
    ctx.fillRect(0, 0, w, h);
    this.drawCrowd(ctx, cam, time);
    this.drawRoof(ctx, cam);
    this.drawShafts(ctx, cam, time);
    this.drawBarrier(ctx, cam);
    this.drawFloor(ctx, cam);
    this.drawRibbon(ctx, cam, time);
  }

  /** Near camera/rail silhouettes, always after players and particles. */
  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (this.artwork.complete) {
      this.artwork.drawForeground(ctx, cam.viewWidth, cam.viewHeight);
    }
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

  /**
   * Light shafts from the roof banks down onto the court.
   *
   * The lamps were bright dots with a glow and nothing between them and the
   * floor, which is why the hall read as a flat backdrop with a court painted
   * on it. Real arena light is visible in the air — that volume is most of
   * what makes a lit space look lit, and it costs five gradients.
   */
  private drawShafts(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const { viewWidth: w, viewHeight: h } = cam;
    const back = rowDepth(STAND_ROWS - 1);
    const top = cam.project(back, -34, rowHeight(STAND_ROWS - 1) + 0.55).y - 26;
    const floorY = cam.projectFloor(0, 0).y;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const cx = (w * (i + 0.5)) / 5;
      // A shaft widens as it falls and shimmers very slightly, which is what
      // stops five identical cones reading as wallpaper.
      const sway = Math.sin(time * 0.5 + i) * 6;
      const spread = w * 0.085;
      const grad = ctx.createLinearGradient(0, top, 0, floorY);
      grad.addColorStop(0, 'rgba(126,232,255,0.11)');
      grad.addColorStop(0.55, 'rgba(103,210,238,0.04)');
      grad.addColorStop(1, 'rgba(73,180,214,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - 26, top);
      ctx.lineTo(cx + 26, top);
      ctx.lineTo(cx + spread + sway, floorY);
      ctx.lineTo(cx - spread + sway, floorY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    void h;
  }

  /**
   * The LED ribbon that runs the length of the barrier.
   *
   * Every arena built since about 2005 has one, and nothing dates a hall
   * faster than its absence: a static painted hoarding is a 1990s photograph.
   */
  private drawRibbon(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const x = STAND_FRONT - 0.34;
    const top = cam.project(x, -34, 0.62);
    const bottom = cam.project(x, -34, 0.12);
    const right = cam.project(x, 34, 0.12);
    const height = bottom.y - top.y;
    const width = right.x - top.x;
    if (height < 4) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(top.x, top.y, width, height);
    ctx.clip();
    ctx.fillStyle = '#070a14';
    ctx.fillRect(top.x, top.y, width, height);

    // A band of lit cells sliding along the boards.
    const cell = 13;
    const offset = (time * 62) % (cell * 2);
    for (let i = -2; i * cell < width + cell * 2; i++) {
      const cx = top.x + i * cell - offset;
      const phase = (i * 0.35 + time * 0.9) % 3;
      const hue = phase < 1 ? '255,196,72' : phase < 2 ? '90,170,255' : '236,240,255';
      // Dim. A ribbon board is scenery at the edge of the eye, and at full
      // strength it pulled attention clean off the court — the one thing the
      // background must never do.
      const lit = 0.07 + 0.16 * Math.abs(Math.sin(i * 0.7 + time * 2.2));
      ctx.fillStyle = `rgba(${hue},${lit})`;
      ctx.fillRect(cx, top.y + 1, cell - 3, height - 2);
    }

    // Bloom over the strip, so it reads as emitting rather than painted.
    const glow = ctx.createLinearGradient(0, top.y - height, 0, top.y + height * 2);
    glow.addColorStop(0, 'rgba(255,220,150,0)');
    glow.addColorStop(0.5, 'rgba(255,220,150,0.06)');
    glow.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.fillRect(top.x, top.y - height, width, height * 3);
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

    if (this.artwork.complete) {
      // The 2048 x 1024 texture contains both free zone and regulation court.
      this.artwork.drawArenaFloor(ctx, cam, outX, outY);
    } else {
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
    }

    this.drawLightPools(ctx, cam, outX, outY);
    this.drawLines(ctx, cam);
    ctx.save();
    ctx.strokeStyle = 'rgba(73,220,255,0.24)';
    ctx.lineWidth = Math.max(1, cam.projectFloor(0, 0).scale * 1.6);
    strokePath(ctx, cam, [
      [-COURT_HALF_WIDTH - 0.24, -COURT_HALF_LENGTH - 0.24],
      [COURT_HALF_WIDTH + 0.24, -COURT_HALF_LENGTH - 0.24],
      [COURT_HALF_WIDTH + 0.24, COURT_HALF_LENGTH + 0.24],
      [-COURT_HALF_WIDTH - 0.24, COURT_HALF_LENGTH + 0.24],
      [-COURT_HALF_WIDTH - 0.24, -COURT_HALF_LENGTH - 0.24],
    ]);
    ctx.restore();
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
      pool.addColorStop(0, 'rgba(126,232,255,0.13)');
      pool.addColorStop(0.5, 'rgba(86,197,225,0.055)');
      pool.addColorStop(1, 'rgba(73,180,214,0)');
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
   * Regulation-height net drawn as a projected plane.
   *
   * The previous side-on column ran from the tape all the way to the floor and
   * made the net look like a fence. The camera now has a restrained 2.5D shear,
   * so the four real corners can be projected directly: one-metre mesh, bright
   * top tape, separate posts and antennas, all in the same geometry as the court.
   */
  /**
   * Net pieces that can be interleaved with bodies by camera depth.
   *
   * The four regulation corners are projected once.  Twenty-four narrow strips
   * interpolate inside that quadrilateral; each receives its own world-depth,
   * so far-side players pass in front of the far mesh while the near mesh can
   * correctly pass in front of near-side players.
   */
  netDrawables(ctx: CanvasRenderingContext2D, cam: Camera): ArenaDrawable[] {
    const W = COURT_HALF_WIDTH;
    const bottomZ = NET_HEIGHT - 1.0;
    const farTop = cam.project(W, 0, NET_HEIGHT);
    const nearTop = cam.project(-W, 0, NET_HEIGHT);
    const farBottom = cam.project(W, 0, bottomZ);
    const nearBottom = cam.project(-W, 0, bottomZ);
    const lerpPoint = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      t: number,
    ): { x: number; y: number } => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

    const out: ArenaDrawable[] = [];
    const columns = 24;
    for (let i = 0; i < columns; i++) {
      const t0 = i / columns;
      const t1 = (i + 1) / columns;
      const x0 = lerp(W, -W, t0);
      const x1 = lerp(W, -W, t1);
      const top0 = lerpPoint(farTop, nearTop, t0);
      const top1 = lerpPoint(farTop, nearTop, t1);
      const bottom0 = lerpPoint(farBottom, nearBottom, t0);
      const bottom1 = lerpPoint(farBottom, nearBottom, t1);
      const depth = cam.project((x0 + x1) / 2, 0, NET_HEIGHT / 2).depth;
      out.push({
        depth,
        draw: () => this.drawNetStrip(ctx, cam, top0, top1, bottom0, bottom1, i === columns - 1),
      });
    }

    for (const x of [W + 0.55, -W - 0.55]) {
      const depth = cam.project(x, 0, NET_HEIGHT / 2).depth;
      out.push({ depth, draw: () => this.drawNetPost(ctx, cam, x) });
    }
    for (const x of [W, -W]) {
      const depth = cam.project(x, 0, (NET_HEIGHT + ANTENNA_HEIGHT) / 2).depth;
      out.push({ depth, draw: () => this.drawAntenna(ctx, cam, x) });
    }
    return out;
  }

  /** Compatibility path for tests/tools that render the net by itself. */
  drawNet(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const pieces = this.netDrawables(ctx, cam).sort((a, b) => b.depth - a.depth);
    for (const piece of pieces) piece.draw();
  }

  private drawNetStrip(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    top0: { x: number; y: number },
    top1: { x: number; y: number },
    bottom0: { x: number; y: number },
    bottom1: { x: number; y: number },
    closeNearEdge: boolean,
  ): void {
    const u = cam.projectFloor(0, 0).scale * 42;
    const point = (
      top: { x: number; y: number },
      bottom: { x: number; y: number },
      t: number,
    ): { x: number; y: number } => ({ x: lerp(top.x, bottom.x, t), y: lerp(top.y, bottom.y, t) });

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y);
    ctx.lineTo(top1.x, top1.y);
    ctx.lineTo(bottom1.x, bottom1.y);
    ctx.lineTo(bottom0.x, bottom0.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,14,26,0.13)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(218,231,248,0.58)';
    ctx.lineWidth = Math.max(0.75, u * 0.018);
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y);
    ctx.lineTo(bottom0.x, bottom0.y);
    if (closeNearEdge) {
      ctx.moveTo(top1.x, top1.y);
      ctx.lineTo(bottom1.x, bottom1.y);
    }
    ctx.stroke();
    for (let row = 1; row <= 9; row++) {
      const a = point(top0, bottom0, row / 9);
      const b = point(top1, bottom1, row / 9);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(12,20,38,0.72)';
    ctx.lineWidth = Math.max(6, u * 0.15);
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y + 1);
    ctx.lineTo(top1.x, top1.y + 1);
    ctx.stroke();
    ctx.strokeStyle = '#f7fbff';
    ctx.lineWidth = Math.max(4, u * 0.1);
    ctx.beginPath();
    ctx.moveTo(top0.x, top0.y);
    ctx.lineTo(top1.x, top1.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,240,252,0.72)';
    ctx.lineWidth = Math.max(2, u * 0.045);
    ctx.beginPath();
    ctx.moveTo(bottom0.x, bottom0.y);
    ctx.lineTo(bottom1.x, bottom1.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawNetPost(ctx: CanvasRenderingContext2D, cam: Camera, x: number): void {
    const u = cam.projectFloor(0, 0).scale * 42;
    const foot = cam.project(x, 0, 0);
    const top = cam.project(x, 0, NET_HEIGHT + 0.38);
    const padTop = cam.project(x, 0, 1.25);
    const postWidth = Math.max(5, u * 0.11);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(14,22,38,0.8)';
    ctx.lineWidth = postWidth + 4;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const grad = ctx.createLinearGradient(foot.x - postWidth, 0, foot.x + postWidth, 0);
    grad.addColorStop(0, '#12324f');
    grad.addColorStop(0.5, '#2b8bb4');
    grad.addColorStop(1, '#0c2138');
    ctx.strokeStyle = grad;
    ctx.lineWidth = postWidth;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(padTop.x, padTop.y);
    ctx.stroke();
    ctx.strokeStyle = '#d9e5f3';
    ctx.lineWidth = Math.max(2, u * 0.04);
    ctx.beginPath();
    ctx.moveTo(padTop.x, padTop.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawAntenna(ctx: CanvasRenderingContext2D, cam: Camera, x: number): void {
    const u = cam.projectFloor(0, 0).scale * 42;
    const from = cam.project(x, 0, NET_HEIGHT);
    const to = cam.project(x, 0, ANTENNA_HEIGHT);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i / 6;
      const b = (i + 1) / 6;
      ctx.strokeStyle = i % 2 === 0 ? '#ff3f55' : '#ffffff';
      ctx.lineWidth = Math.max(2.5, u * 0.055);
      ctx.beginPath();
      ctx.moveTo(lerp(from.x, to.x, a), lerp(from.y, to.y, a));
      ctx.lineTo(lerp(from.x, to.x, b), lerp(from.y, to.y, b));
      ctx.stroke();
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
