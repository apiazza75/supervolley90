import { Player } from '../core/player';
import { Rng } from '../core/rng';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, Side } from '../core/rules';
import { Camera } from './camera';
import { drawPlayer, drawPlayerShadow } from './players';

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
    this.official(ctx, cam, 901, px, py, NET_HEIGHT - 0.62, time, dt);

    for (const k of this.kids) if (k.x > 0) this.kid(ctx, cam, k, time, dt);
  }

  /** The near-side referee, drawn after the players so they sit in front. */
  drawNear(ctx: CanvasRenderingContext2D, cam: Camera, time: number, dt: number): void {
    this.official(ctx, cam, 902, -COURT_HALF_WIDTH - 0.95, -0.7, 0, time, dt);
    for (const k of this.kids) if (k.x <= 0) this.kid(ctx, cam, k, time, dt);
  }

  private official(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    id: number,
    x: number,
    y: number,
    z: number,
    time: number,
    dt: number,
  ): void {
    // A whistled point puts the arm up, which the cheer pose already does; the
    // rest of the time they stand and watch the ball.
    const anim = this.signal > 0 ? 'cheer' : 'idle';
    const facing = this.signalSide === 'home' ? -1 : 1;
    const f = figure({ id, x, y, z, vx: 0, vy: 0, anim, facing });
    if (z < 0.1) drawPlayerShadow(ctx, cam, f);
    drawPlayer(ctx, cam, f, REF_KIT, { active: false, charge: 0, time, dt, official: true });
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
