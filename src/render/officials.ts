import { Player } from '../core/player';
import { Rng } from '../core/rng';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, Side } from '../core/rules';
import { Camera } from './camera';
import { OUTLINE, capsule, drawPlayer, drawPlayerShadow, shade } from './players';

/**
 * The people around the court who are not playing: the two referees and three
 * ball kids.
 *
 * They are drawn through the same figure pipeline as the players — same
 * anatomy, same shading, same shadows. An earlier version gave them their own
 * simplified stick-figure renderer, and the result was exactly what you would
 * expect: mannequins standing next to properly drawn athletes, worse than
 * having nobody there at all. There is no reason for a second, poorer way to
 * draw a person.
 *
 * Line judges are gone. From this angle they stand at the far corners of the
 * frame doing nothing that reads, and they cost two more bodies competing with
 * the play for attention.
 */

/** How long an official holds a signal after a whistle. */
const SIGNAL_TIME = 2.2;

/** Referee kit, and the ball kids' bib. */
const REF_KIT: [string, string] = ['#b6122b', '#f2f2f4'];
const KID_KIT: [string, string] = ['#f2b134', '#2b3b52'];

interface Kid {
  id: number;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  /** 'wait' at the corner, 'fetch' walking out, 'return' coming back. */
  state: 'wait' | 'fetch' | 'return';
}

/**
 * The minimum a figure needs for `drawPlayer`, which only ever reads these.
 * Cast rather than constructed as a real `Player` so officials never end up in
 * the simulation by accident.
 */
function figure(o: {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  anim: string;
  facing: number;
}): Player {
  return {
    id: o.id,
    pos: { x: o.x, y: o.y, z: 0 },
    vel: { x: o.vx, y: o.vy, z: 0 },
    height: o.z,
    vertVel: 0,
    anim: o.anim,
    facing: o.facing,
    swing: 0,
    airborne: false,
    rotationSlot: 1,
  } as unknown as Player;
}

export class Officials {
  private signal = 0;
  private signalSide: Side | null = null;
  private kids: Kid[] = [];

  constructor(seed = 0x0ff1c1a1) {
    const rng = new Rng(seed);
    const corners: [number, number][] = [
      [COURT_HALF_WIDTH + 1.6, COURT_HALF_LENGTH + 1.6],
      [-COURT_HALF_WIDTH - 1.6, -COURT_HALF_LENGTH - 1.6],
      [-COURT_HALF_WIDTH - 1.9, COURT_HALF_LENGTH + 2.0],
    ];
    corners.forEach(([x, y], i) => {
      this.kids.push({
        // A private id space, well away from the players', so the animation
        // smoothing state of a kid never collides with a player's.
        id: 900 + i + rng.int(0, 3),
        homeX: x,
        homeY: y,
        x,
        y,
        targetX: x,
        targetY: y,
        vx: 0,
        vy: 0,
        state: 'wait',
      });
    });
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

  /** The ball is dead and lying somewhere: send the nearest kid for it. */
  fetchBall(x: number, y: number): void {
    let best: Kid | null = null;
    let bestD = Infinity;
    for (const k of this.kids) {
      if (k.state !== 'wait') continue;
      const d = Math.hypot(k.homeX - x, k.homeY - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (!best) return;
    best.state = 'fetch';
    best.targetX = Math.max(-COURT_HALF_WIDTH - 2.2, Math.min(COURT_HALF_WIDTH + 2.2, x));
    best.targetY = Math.max(-COURT_HALF_LENGTH - 2.2, Math.min(COURT_HALF_LENGTH + 2.2, y));
  }

  update(dt: number): void {
    this.signal = Math.max(0, this.signal - dt);

    for (const k of this.kids) {
      if (k.state === 'wait') {
        k.vx = 0;
        k.vy = 0;
        continue;
      }
      const dx = k.targetX - k.x;
      const dy = k.targetY - k.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.15) {
        if (k.state === 'fetch') {
          k.state = 'return';
          k.targetX = k.homeX;
          k.targetY = k.homeY;
        } else {
          k.state = 'wait';
          k.x = k.homeX;
          k.y = k.homeY;
        }
        k.vx = 0;
        k.vy = 0;
        continue;
      }
      const speed = 4.4;
      k.vx = (dx / d) * speed;
      k.vy = (dy / d) * speed;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
    }
  }

  /**
   * Everyone on the far side of the court, drawn before the players so the
   * play always reads in front of them.
   */
  drawFar(ctx: CanvasRenderingContext2D, cam: Camera, time: number, dt: number): void {
    // Stepped just off the net line: from directly side-on, everything at y=0
    // shares one screen column, so a referee standing exactly on the net line
    // looks like they are standing on the net.
    const px = COURT_HALF_WIDTH + 0.95;
    const py = 0.7;
    this.drawPodium(ctx, cam, px, py);
    // The far referee faces across the court, which is straight at the camera.
    this.official(ctx, cam, px, py, NET_HEIGHT - 0.62, true);

    for (const k of this.kids) if (k.x > 0) this.kid(ctx, cam, k, time, dt);
  }

  /** The near-side referee, drawn after the players so they sit in front. */
  drawNear(ctx: CanvasRenderingContext2D, cam: Camera, time: number, dt: number): void {
    // The near referee faces the other way, so we are behind them.
    this.official(ctx, cam, -COURT_HALF_WIDTH - 0.95, -0.7, 0, false);
    for (const k of this.kids) if (k.x <= 0) this.kid(ctx, cam, k, time, dt);
  }

  /**
   * A referee, drawn face-on or from behind.
   *
   * Everyone else in this game is seen in profile, and correctly so: players
   * face along the court, which is across the camera. Referees do not. They
   * stand at the posts and face ACROSS the court, watching the net — so from
   * a camera looking along that same axis, the referee on the far post is
   * facing us and the one on the near post has their back to us. Drawing them
   * in profile like everybody else was simply the wrong view of the body, and
   * it is why they read as a seventh player loitering by the net.
   */
  private official(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    x: number,
    y: number,
    z: number,
    facingCamera: boolean,
  ): void {
    const p = cam.project(x, y, z);
    const u = 1.9 * p.scale * 42;
    if (u < 6) return;

    // Frontal proportions: this is the view where the shoulders are their full
    // BREADTH rather than their depth, which is most of what makes it read as
    // a different view of the same body.
    const hipY = p.y - u * 0.47;
    const shoulderY = p.y - u * 0.8;
    const halfShoulder = u * 0.118;
    const halfWaist = u * 0.079;
    const halfHip = u * 0.097;
    const headW = u * 0.062;
    const headH = u * 0.077;
    const headY = shoulderY - u * 0.028 - headH * 0.92;
    const outline = Math.max(0.7, u * 0.018);
    const [shirt, trim] = REF_KIT;
    const skin = '#d8a877';
    // Arm up towards whichever side has just been awarded the point.
    const raise = this.signal > 0 ? (this.signalSide === 'home' ? -1 : 1) : 0;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (z < 0.1) {
      ctx.fillStyle = 'rgba(7,16,6,0.34)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, u * 0.16, u * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trousers: two legs straight down, seen front-on and therefore apart.
    for (const side of [-1, 1] as const) {
      capsule(
        ctx,
        p.x + side * u * 0.045,
        hipY,
        p.x + side * u * 0.055,
        p.y - u * 0.03,
        u * 0.062,
        u * 0.05,
        side < 0 ? shade('#2b3350', 0.05) : '#2b3350',
        outline,
      );
      // Shoe.
      ctx.beginPath();
      ctx.ellipse(p.x + side * u * 0.055, p.y - u * 0.012, u * 0.042, u * 0.022, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#1b1e28';
      ctx.fill();
      ctx.lineWidth = outline;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }

    // Torso: shoulders to hips, seen across their full width.
    const grad = ctx.createLinearGradient(p.x - halfShoulder, 0, p.x + halfShoulder, 0);
    grad.addColorStop(0, shade(shirt, 0.14));
    grad.addColorStop(0.55, shirt);
    grad.addColorStop(1, shade(shirt, -0.24));
    ctx.beginPath();
    ctx.moveTo(p.x - halfShoulder, shoulderY);
    ctx.quadraticCurveTo(p.x - halfWaist - u * 0.01, (shoulderY + hipY) / 2, p.x - halfWaist, hipY - u * 0.06);
    ctx.lineTo(p.x - halfHip, hipY + u * 0.02);
    ctx.lineTo(p.x + halfHip, hipY + u * 0.02);
    ctx.lineTo(p.x + halfWaist, hipY - u * 0.06);
    ctx.quadraticCurveTo(p.x + halfWaist + u * 0.01, (shoulderY + hipY) / 2, p.x + halfShoulder, shoulderY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Collar, or the number panel on the back.
    ctx.fillStyle = trim;
    if (facingCamera) {
      ctx.beginPath();
      ctx.moveTo(p.x - halfShoulder * 0.4, shoulderY);
      ctx.lineTo(p.x, shoulderY + u * 0.06);
      ctx.lineTo(p.x + halfShoulder * 0.4, shoulderY);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.75;
      ctx.fillRect(p.x - halfShoulder * 0.42, shoulderY + u * 0.09, halfShoulder * 0.84, u * 0.1);
      ctx.globalAlpha = 1;
    }

    // Arms, one down and one possibly raised in a signal.
    for (const side of [-1, 1] as const) {
      const up = raise === side;
      const sx = p.x + side * halfShoulder * 0.92;
      const ex = up ? sx + side * u * 0.03 : sx + side * u * 0.02;
      const ey = up ? shoulderY - u * 0.34 : hipY + u * 0.02;
      capsule(ctx, sx, shoulderY + u * 0.01, ex, ey, u * 0.052, u * 0.04, shirt, outline);
      // Forearm and hand in skin.
      const fx = up ? ex + side * u * 0.01 : ex + side * u * 0.01;
      const fy = up ? ey - u * 0.22 : ey + u * 0.14;
      capsule(ctx, ex, ey, fx, fy, u * 0.04, u * 0.032, skin, outline);
    }

    // Head: face-on has features, the rear view is hair and an ear-line only.
    ctx.beginPath();
    ctx.ellipse(p.x, headY, headW, headH, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(p.x, headY - headH * 0.22, headW * 1.02, headH * 0.72, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#26201c';
    ctx.fill();
    if (facingCamera && u > 34) {
      ctx.fillStyle = '#20202c';
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.ellipse(p.x + side * headW * 0.38, headY, headW * 0.1, headH * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // The whistle, which is the whole job.
      ctx.strokeStyle = 'rgba(230,232,240,0.9)';
      ctx.lineWidth = Math.max(0.8, u * 0.012);
      ctx.beginPath();
      ctx.moveTo(p.x - headW * 0.5, headY + headH * 0.2);
      ctx.quadraticCurveTo(p.x, headY + headH * 1.5, p.x + headW * 0.5, headY + headH * 0.2);
      ctx.stroke();
    } else if (u > 34) {
      ctx.fillStyle = 'rgba(38,32,28,0.55)';
      ctx.beginPath();
      ctx.ellipse(p.x, headY + headH * 0.1, headW * 0.72, headH * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private kid(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    k: Kid,
    time: number,
    dt: number,
  ): void {
    const moving = k.state !== 'wait';
    const f = figure({
      id: k.id,
      x: k.x,
      y: k.y,
      z: 0,
      vx: k.vx,
      vy: k.vy,
      anim: moving ? 'run' : 'idle',
      facing: k.vy >= 0 ? 1 : -1,
    });
    drawPlayerShadow(ctx, cam, f);
    drawPlayer(ctx, cam, f, KID_KIT, { active: false, charge: 0, time, dt });
  }

  /** The referee's podium: a slim tower with a platform at tape height. */
  private drawPodium(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number): void {
    const foot = cam.project(x, y, 0);
    const deck = cam.project(x, y, NET_HEIGHT - 0.62);
    const u = foot.scale * 42;
    const w = u * 0.5;

    ctx.save();
    ctx.strokeStyle = '#5d667a';
    ctx.lineWidth = Math.max(2, u * 0.07);
    ctx.beginPath();
    ctx.moveTo(foot.x - w * 0.6, foot.y);
    ctx.lineTo(deck.x - w * 0.32, deck.y);
    ctx.moveTo(foot.x + w * 0.6, foot.y);
    ctx.lineTo(deck.x + w * 0.32, deck.y);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, u * 0.035);
    ctx.strokeStyle = 'rgba(93,102,122,0.7)';
    for (let i = 0; i < 3; i++) {
      const a = i / 3;
      const b = (i + 1) / 3;
      ctx.beginPath();
      ctx.moveTo(lerp(foot.x - w * 0.6, deck.x - w * 0.32, a), lerp(foot.y, deck.y, a));
      ctx.lineTo(lerp(foot.x + w * 0.6, deck.x + w * 0.32, b), lerp(foot.y, deck.y, b));
      ctx.stroke();
    }
    ctx.fillStyle = '#39414f';
    ctx.fillRect(deck.x - w * 0.75, deck.y - u * 0.05, w * 1.5, u * 0.1);
    ctx.restore();
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
