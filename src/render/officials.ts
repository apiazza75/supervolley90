import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, Side } from '../core/rules';
import { Camera } from './camera';

/**
 * The people around the court who are not playing: the first referee on the
 * stand, and the line judges at the corners.
 *
 * They are drawn here, by this file, from its own primitives. The previous
 * version imported `Player`, `drawPlayer`, `drawFrame` and the player sprite
 * sheets and dressed athletes in referee colours, on the theory that one good
 * figure pipeline beats two. In practice it produced officials built like
 * hitters, sharing the players' animation state and palette, indistinguishable
 * from a seventh player loitering at the net — and it also meant every change
 * to how players are drawn silently changed the officials.
 *
 * An official is a different kind of figure with a different job: still,
 * upright, seen from a fixed angle, carrying a flag or a whistle. That is a
 * small amount of drawing, and it belongs to them.
 *
 * There are deliberately no ball kids. From this camera they were three yellow
 * figures moving in the corners of the frame, competing with the play for
 * attention and adding nothing.
 */

/** How long an official holds a signal after a whistle. */
const SIGNAL_TIME = 2.2;

/** Referee kit: shirt, trim. */
const REF_SHIRT = '#1d2a44';
const REF_TRIM = '#e8b53a';
/** Line judge kit, deliberately unlike either team's. */
const JUDGE_SHIRT = '#2f3d34';
const JUDGE_TRIM = '#d9dee2';
const FLAG = '#d8332f';
const SKIN = '#d8a877';
const OUTLINE = '#101418';

/** What a line judge is signalling. */
export type JudgeSignal = 'idle' | 'in' | 'out' | 'touch';

interface LineJudge {
  /** Court position, in metres. */
  x: number;
  y: number;
  /** Seconds left on the current signal. */
  hold: number;
  signal: JudgeSignal;
}

/** A limb or torso segment: a tapered, rounded bar between two points. */
function limb(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r1: number,
  r2: number,
  fill: string,
  lw: number,
): void {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const dx1 = Math.cos(a) * r1;
  const dy1 = Math.sin(a) * r1;
  const dx2 = Math.cos(a) * r2;
  const dy2 = Math.sin(a) * r2;
  ctx.beginPath();
  ctx.moveTo(x1 + dx1, y1 + dy1);
  ctx.lineTo(x2 + dx2, y2 + dy2);
  ctx.arc(x2, y2, r2, a, a + Math.PI, false);
  ctx.lineTo(x1 - dx1, y1 - dy1);
  ctx.arc(x1, y1, r1, a + Math.PI, a + Math.PI * 2, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

export class Officials {
  private signal = 0;
  private signalSide: Side | null = null;
  private readonly judges: LineJudge[];

  constructor() {
    // Diagonally opposite corners of the free zone, which is where the two
    // line judges of a four-official crew stand.
    this.judges = [
      { x: COURT_HALF_WIDTH + 1.5, y: -COURT_HALF_LENGTH - 1.4, hold: 0, signal: 'idle' },
      { x: -COURT_HALF_WIDTH - 1.5, y: COURT_HALF_LENGTH + 1.4, hold: 0, signal: 'idle' },
    ];
  }

  /** Ball kids were removed for this release; kept as a fact the QA can read. */
  get ballKids(): readonly never[] {
    return [];
  }

  /** Authorise the serve: a whistle, arm towards the serving side. */
  authoriseServe(side: Side): void {
    this.signal = 1.1;
    this.signalSide = side;
  }

  /** A point has been awarded: whistle, and put an arm up for the side. */
  callPoint(side: Side): void {
    this.signal = SIGNAL_TIME;
    this.signalSide = side;
  }

  /**
   * Flag a ball that has landed. The nearer judge raises the signal the call
   * actually was, which is the only reason to have them in frame at all.
   */
  callLine(x: number, y: number, inside: boolean): void {
    let best = this.judges[0];
    let bestD = Infinity;
    for (const j of this.judges) {
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    best.signal = inside ? 'in' : 'out';
    best.hold = SIGNAL_TIME;
  }

  /** A ball deflected off the block on its way out. */
  callTouch(x: number, y: number): void {
    let best = this.judges[0];
    let bestD = Infinity;
    for (const j of this.judges) {
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    best.signal = 'touch';
    best.hold = SIGNAL_TIME;
  }

  update(dt: number): void {
    this.signal = Math.max(0, this.signal - dt);
    for (const j of this.judges) {
      if (j.hold > 0) {
        j.hold = Math.max(0, j.hold - dt);
        if (j.hold === 0) j.signal = 'idle';
      }
    }
  }

  /**
   * Everyone on the far side of the court, drawn before the players so the
   * play always reads in front of them.
   */
  drawFar(ctx: CanvasRenderingContext2D, cam: Camera): void {
    // Stepped just off the net line: from directly side-on everything at y = 0
    // shares one screen column, so a referee standing exactly on the net line
    // looks like they are standing on the net.
    this.referee(ctx, cam, COURT_HALF_WIDTH + 0.95, 0.7);
    for (const j of this.judges) if (j.y > 0) this.lineJudge(ctx, cam, j);
  }

  /** The near-side figures, drawn after the players so they sit in front. */
  drawNear(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const j of this.judges) if (j.y <= 0) this.lineJudge(ctx, cam, j);
  }

  /**
   * The first referee, on the stand beside the post.
   *
   * Seen face-on: referees stand at the post and watch across the net, which
   * is straight down the camera axis. They never celebrate — the arm goes up
   * to award the point and comes down again.
   */
  private referee(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number): void {
    const standTop = NET_HEIGHT - 0.62;
    this.stand(ctx, cam, x, y, standTop);

    const p = cam.project(x, y, standTop);
    const u = 1.9 * p.scale * 42;
    if (u < 6) return;

    const lw = Math.max(0.7, u * 0.018);
    const hipY = p.y - u * 0.47;
    const shoulderY = p.y - u * 0.8;
    const headH = u * 0.077;
    const headY = shoulderY - u * 0.028 - headH * 0.92;
    // Arm up towards whichever side has just been awarded the point.
    const raise = this.signal > 0 ? (this.signalSide === 'home' ? -1 : 1) : 0;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Legs, seen front-on and therefore apart.
    for (const s of [-1, 1] as const) {
      limb(ctx, p.x + s * u * 0.055, hipY, p.x + s * u * 0.062, p.y, u * 0.052, u * 0.036, '#242c3a', lw);
    }
    // Torso.
    limb(ctx, p.x, hipY, p.x, shoulderY, u * 0.095, u * 0.115, REF_SHIRT, lw);
    // Collar stripe, so the kit reads as a uniform rather than a colour.
    ctx.fillStyle = REF_TRIM;
    ctx.fillRect(p.x - u * 0.1, shoulderY - u * 0.01, u * 0.2, u * 0.022);

    // Arms. One is raised when a call is being made; otherwise both rest.
    for (const s of [-1, 1] as const) {
      const up = raise !== 0 && s === raise;
      const sx = p.x + s * u * 0.11;
      const ex = p.x + s * (up ? u * 0.17 : u * 0.13);
      const ey = up ? shoulderY - u * 0.3 : hipY - u * 0.02;
      limb(ctx, sx, shoulderY + u * 0.01, ex, ey, u * 0.05, u * 0.038, REF_SHIRT, lw);
      limb(ctx, ex, ey, ex + s * u * 0.02, ey + (up ? -u * 0.12 : u * 0.11), u * 0.038, u * 0.031, SKIN, lw);
    }

    // Head, with a cap peak: the quickest way to read "official" at this size.
    ctx.beginPath();
    ctx.ellipse(p.x, headY, u * 0.062, headH, 0, 0, Math.PI * 2);
    ctx.fillStyle = SKIN;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(p.x, headY - headH * 0.42, u * 0.066, headH * 0.46, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = REF_SHIRT;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** The referee's stand: a platform and a ladder, behind the figure. */
  private stand(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    x: number,
    y: number,
    top: number,
  ): void {
    const base = cam.project(x, y, 0);
    const head = cam.project(x, y, top);
    const u = 1.9 * base.scale * 42;
    if (u < 6) return;
    const w = u * 0.2;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(0.7, u * 0.016);

    // Two uprights and the rungs between them.
    ctx.fillStyle = '#3a4354';
    ctx.fillRect(head.x - w, head.y, w * 0.18, base.y - head.y);
    ctx.fillRect(head.x + w * 0.82, head.y, w * 0.18, base.y - head.y);
    ctx.strokeRect(head.x - w, head.y, w * 0.18, base.y - head.y);
    ctx.strokeRect(head.x + w * 0.82, head.y, w * 0.18, base.y - head.y);
    ctx.fillStyle = '#2b3242';
    for (let i = 1; i <= 3; i++) {
      const ry = head.y + ((base.y - head.y) * i) / 4;
      ctx.fillRect(head.x - w, ry, w * 2, u * 0.022);
    }
    // The platform the referee stands on.
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(head.x - w * 1.15, head.y - u * 0.03, w * 2.3, u * 0.05);
    ctx.strokeRect(head.x - w * 1.15, head.y - u * 0.03, w * 2.3, u * 0.05);
    ctx.restore();
  }

  /**
   * A line judge at a corner, seen from behind or three-quarters behind.
   *
   * That is the honest view: they stand at the corners of the free zone facing
   * in towards the court, so the camera is behind them. They hold the flag
   * down at rest, out for "in", up for "out", and fingertips-to-palm for a
   * touch. They never celebrate.
   */
  private lineJudge(ctx: CanvasRenderingContext2D, cam: Camera, j: LineJudge): void {
    const p = cam.project(j.x, j.y, 0);
    const u = 1.55 * p.scale * 42;
    if (u < 6) return;

    const lw = Math.max(0.7, u * 0.018);
    const hipY = p.y - u * 0.47;
    const shoulderY = p.y - u * 0.8;
    const headH = u * 0.075;
    const headY = shoulderY - u * 0.026 - headH * 0.92;
    // Which way the flag arm points, in screen space, towards the court.
    const inward = j.x > 0 ? -1 : 1;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.fillStyle = 'rgba(7,16,6,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, u * 0.15, u * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();

    for (const s of [-1, 1] as const) {
      limb(ctx, p.x + s * u * 0.05, hipY, p.x + s * u * 0.057, p.y, u * 0.05, u * 0.034, '#1f2a24', lw);
    }
    limb(ctx, p.x, hipY, p.x, shoulderY, u * 0.09, u * 0.11, JUDGE_SHIRT, lw);
    // Seen from behind: a yoke across the shoulders instead of a collar.
    ctx.fillStyle = JUDGE_TRIM;
    ctx.fillRect(p.x - u * 0.095, shoulderY + u * 0.02, u * 0.19, u * 0.02);

    // Resting arm.
    const restX = p.x - inward * u * 0.12;
    limb(ctx, p.x - inward * u * 0.105, shoulderY + u * 0.01, restX, hipY - u * 0.02, u * 0.047, u * 0.036, JUDGE_SHIRT, lw);

    // Flag arm, positioned by the call.
    const sx = p.x + inward * u * 0.105;
    let ex = sx + inward * u * 0.12;
    let ey = hipY - u * 0.02;
    if (j.signal === 'in') {
      ex = sx + inward * u * 0.26;
      ey = shoulderY + u * 0.16;
    } else if (j.signal === 'out') {
      ex = sx + inward * u * 0.08;
      ey = shoulderY - u * 0.26;
    } else if (j.signal === 'touch') {
      ex = sx + inward * u * 0.05;
      ey = shoulderY - u * 0.12;
    }
    limb(ctx, sx, shoulderY + u * 0.01, ex, ey, u * 0.047, u * 0.036, JUDGE_SHIRT, lw);

    // The flag itself: a short staff and a square of cloth.
    const fx = ex + inward * u * 0.02;
    const fy = ey + (j.signal === 'out' ? -u * 0.1 : j.signal === 'in' ? u * 0.02 : u * 0.1);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(0.8, u * 0.02);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    const fw = u * 0.13;
    ctx.fillStyle = FLAG;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + inward * fw, fy - fw * 0.28);
    ctx.lineTo(fx + inward * fw, fy + fw * 0.62);
    ctx.lineTo(fx, fy + fw * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.stroke();

    // Head, from behind: no face, just the back of the skull and the hairline.
    ctx.beginPath();
    ctx.ellipse(p.x, headY, u * 0.06, headH, 0, 0, Math.PI * 2);
    ctx.fillStyle = SKIN;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(p.x, headY - headH * 0.18, u * 0.061, headH * 0.78, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#2b211c';
    ctx.fill();
    ctx.restore();
  }
}
