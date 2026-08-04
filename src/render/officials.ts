import { clamp } from '../core/math3';
import { Rng } from '../core/rng';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, Side } from '../core/rules';
import { Camera } from './camera';

/**
 * The people around the court who are not playing: two referees, two line
 * judges and three ball kids.
 *
 * They are what separates a court with players on it from a match. The first
 * referee stands on the podium at the far post and signals every point; the
 * second works the near side; the line judges flag the corners; and between
 * rallies a ball kid trots out, collects the ball and jogs back to their
 * corner. None of it changes the simulation — it is all driven from events the
 * game already emits — but a dead ball with nobody reacting to it is the single
 * clearest sign that a game is a toy.
 */

/** How long an official holds a signal after a whistle. */
const SIGNAL_TIME = 2.2;

interface Kid {
  /** Their corner, which they always return to. */
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** 'wait' at the corner, 'fetch' walking out, 'return' coming back. */
  state: 'wait' | 'fetch' | 'return';
  /** Bounce phase so three kids do not move as one. */
  phase: number;
  shirt: string;
  skin: string;
  hair: string;
}

const SKINS = ['#f2c6a0', '#d79f72', '#a9713f', '#7a4c25'];
const HAIRS = ['#241a16', '#0f0d10', '#54341c', '#7d5326'];

export class Officials {
  /** Seconds left of the whistle-and-signal beat. */
  private signal = 0;
  /** Which side the point was awarded to, for the arm that goes up. */
  private signalSide: Side | null = null;
  /** Rises for a moment on every whistle, so the arms snap rather than drift. */
  private whistleFlash = 0;
  private kids: Kid[] = [];
  private time = 0;

  constructor(seed = 0x0ff1c1a1) {
    const rng = new Rng(seed);
    const corners: [number, number][] = [
      [COURT_HALF_WIDTH + 1.7, COURT_HALF_LENGTH + 1.5],
      [-COURT_HALF_WIDTH - 1.7, -COURT_HALF_LENGTH - 1.5],
      [-COURT_HALF_WIDTH - 1.9, COURT_HALF_LENGTH + 1.9],
    ];
    for (const [x, y] of corners) {
      this.kids.push({
        homeX: x,
        homeY: y,
        x,
        y,
        targetX: x,
        targetY: y,
        state: 'wait',
        phase: rng.range(0, Math.PI * 2),
        shirt: '#f2b134',
        skin: SKINS[rng.int(0, SKINS.length)],
        hair: HAIRS[rng.int(0, HAIRS.length)],
      });
    }
  }

  /**
   * Authorise the serve: a whistle and an arm swept towards the serving side,
   * which is the signal the server is actually waiting for.
   */
  authoriseServe(side: Side): void {
    this.signal = 1.1;
    this.signalSide = side;
    this.whistleFlash = 1;
  }

  /** A point has been awarded: whistle, and put an arm up for the side. */
  callPoint(side: Side): void {
    this.signal = SIGNAL_TIME;
    this.signalSide = side;
    this.whistleFlash = 1;
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
    best.targetX = clamp(x, -COURT_HALF_WIDTH - 2.2, COURT_HALF_WIDTH + 2.2);
    best.targetY = clamp(y, -COURT_HALF_LENGTH - 2.2, COURT_HALF_LENGTH + 2.2);
  }

  update(dt: number): void {
    this.time += dt;
    this.signal = Math.max(0, this.signal - dt);
    this.whistleFlash = Math.max(0, this.whistleFlash - dt * 3);

    for (const k of this.kids) {
      if (k.state === 'wait') continue;
      const dx = k.targetX - k.x;
      const dy = k.targetY - k.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.12) {
        if (k.state === 'fetch') {
          k.state = 'return';
          k.targetX = k.homeX;
          k.targetY = k.homeY;
        } else {
          k.state = 'wait';
          k.x = k.homeX;
          k.y = k.homeY;
        }
        continue;
      }
      const speed = 4.6 * dt;
      k.x += (dx / d) * Math.min(speed, d);
      k.y += (dy / d) * Math.min(speed, d);
    }
  }

  /**
   * Everyone standing on the far side of the court, drawn before the players
   * so the play always reads in front of them.
   */
  drawFar(ctx: CanvasRenderingContext2D, cam: Camera): void {
    // First referee, on the podium beside the far post. The podium raises them
    // to the tape, which is the whole point of it.
    // Stepped just off the net line: from directly side-on, everything at y=0
    // shares one screen column, so a referee standing exactly on the net line
    // looks like they are standing *on the net*.
    const px = COURT_HALF_WIDTH + 0.95;
    const py = 0.55;
    this.drawPodium(ctx, cam, px, py);
    const raise: 'left' | 'right' | null =
      this.signal > 0 ? (this.signalSide === 'home' ? 'left' : 'right') : null;
    this.figure(ctx, cam, px, py, NET_HEIGHT - 0.55, {
      shirt: '#20242e',
      shorts: '#20242e',
      skin: '#e8bd94',
      hair: '#2b2119',
      raise,
      whistle: this.whistleFlash > 0.2,
      bob: 0.02,
      phase: 0,
    });

    // Far line judge, at the diagonal corner.
    this.figure(ctx, cam, COURT_HALF_WIDTH + 1.25, -COURT_HALF_LENGTH - 1.1, 0, {
      shirt: '#2b3b52',
      shorts: '#20242e',
      skin: '#c98d5c',
      hair: '#181310',
      raise: this.signal > 0 ? 'right' : null,
      flag: this.signal > 0,
      bob: 0.03,
      phase: 1.4,
    });

    for (const k of this.kids) if (k.x > 0) this.drawKid(ctx, cam, k);
  }

  /** The near-side officials, drawn after the players so they sit in front. */
  drawNear(ctx: CanvasRenderingContext2D, cam: Camera): void {
    this.figure(ctx, cam, -COURT_HALF_WIDTH - 0.95, -0.55, 0, {
      shirt: '#20242e',
      shorts: '#20242e',
      skin: '#a9713f',
      hair: '#12100e',
      raise: this.signal > 0 ? (this.signalSide === 'home' ? 'left' : 'right') : null,
      whistle: this.whistleFlash > 0.2,
      bob: 0.03,
      phase: 2.2,
    });

    this.figure(ctx, cam, -COURT_HALF_WIDTH - 1.25, COURT_HALF_LENGTH + 1.1, 0, {
      shirt: '#2b3b52',
      shorts: '#20242e',
      skin: '#f0c49b',
      hair: '#6b4a24',
      raise: this.signal > 0 ? 'left' : null,
      flag: this.signal > 0,
      bob: 0.03,
      phase: 3.1,
    });

    for (const k of this.kids) if (k.x <= 0) this.drawKid(ctx, cam, k);
  }

  private drawKid(ctx: CanvasRenderingContext2D, cam: Camera, k: Kid): void {
    const moving = k.state !== 'wait';
    this.figure(ctx, cam, k.x, k.y, 0, {
      shirt: k.shirt,
      shorts: '#2b3b52',
      skin: k.skin,
      hair: k.hair,
      raise: null,
      // Crouched and still while waiting, upright and bobbing while running.
      crouch: moving ? 0 : 0.35,
      bob: moving ? 0.09 : 0.01,
      phase: k.phase,
      run: moving,
      scale: 0.82,
    });
  }

  /** The referee's podium: a slim tower with a platform at tape height. */
  private drawPodium(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number): void {
    const foot = cam.project(x, y, 0);
    const deck = cam.project(x, y, NET_HEIGHT - 0.55);
    const u = foot.scale * 42;
    const w = u * 0.42;

    ctx.save();
    ctx.strokeStyle = '#5d667a';
    ctx.lineWidth = Math.max(2, u * 0.07);
    ctx.beginPath();
    ctx.moveTo(foot.x - w * 0.55, foot.y);
    ctx.lineTo(deck.x - w * 0.3, deck.y);
    ctx.moveTo(foot.x + w * 0.55, foot.y);
    ctx.lineTo(deck.x + w * 0.3, deck.y);
    ctx.stroke();
    // Cross-bracing, which is what makes it read as a structure.
    ctx.lineWidth = Math.max(1, u * 0.035);
    ctx.strokeStyle = 'rgba(93,102,122,0.7)';
    for (let i = 0; i < 3; i++) {
      const a = i / 3;
      const b = (i + 1) / 3;
      ctx.beginPath();
      ctx.moveTo(lerp(foot.x - w * 0.55, deck.x - w * 0.3, a), lerp(foot.y, deck.y, a));
      ctx.lineTo(lerp(foot.x + w * 0.55, deck.x + w * 0.3, b), lerp(foot.y, deck.y, b));
      ctx.stroke();
    }
    ctx.fillStyle = '#39414f';
    ctx.fillRect(deck.x - w * 0.7, deck.y - u * 0.05, w * 1.4, u * 0.1);
    ctx.restore();
  }

  /**
   * A compact vector figure — head, torso, arms, legs.
   *
   * Deliberately simpler than the players: officials and ball kids are scenery,
   * and giving them the full articulated body would both cost frame time and
   * pull the eye away from the six people who matter.
   */
  private figure(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    x: number,
    y: number,
    z: number,
    o: {
      shirt: string;
      shorts: string;
      skin: string;
      hair: string;
      raise: 'left' | 'right' | null;
      whistle?: boolean;
      flag?: boolean;
      crouch?: number;
      bob: number;
      phase: number;
      run?: boolean;
      scale?: number;
    },
  ): void {
    const t = this.time;
    const bob = Math.sin(t * (o.run ? 9 : 1.6) + o.phase) * o.bob;
    const p = cam.project(x, y, z + bob);
    const u = p.scale * 42 * (o.scale ?? 1);
    const crouch = o.crouch ?? 0;

    const hipY = p.y - u * (1.0 - crouch * 0.45);
    const shoulderY = hipY - u * 0.62;
    const headR = u * 0.155;
    const headY = shoulderY - headR * 1.35;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Contact shadow, so nobody floats.
    if (z < 0.2) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, u * 0.3, u * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legs.
    const stride = o.run ? Math.sin(t * 9 + o.phase) * u * 0.24 : u * 0.07;
    ctx.strokeStyle = o.skin;
    ctx.lineWidth = u * 0.13;
    ctx.beginPath();
    ctx.moveTo(p.x - u * 0.07, hipY);
    ctx.lineTo(p.x - u * 0.07 - stride, p.y);
    ctx.moveTo(p.x + u * 0.07, hipY);
    ctx.lineTo(p.x + u * 0.07 + stride, p.y);
    ctx.stroke();

    // Shorts.
    ctx.fillStyle = o.shorts;
    ctx.fillRect(p.x - u * 0.17, hipY - u * 0.12, u * 0.34, u * 0.28);

    // Torso.
    ctx.fillStyle = o.shirt;
    ctx.beginPath();
    ctx.moveTo(p.x - u * 0.19, shoulderY);
    ctx.quadraticCurveTo(p.x - u * 0.2, hipY - u * 0.2, p.x - u * 0.16, hipY);
    ctx.lineTo(p.x + u * 0.16, hipY);
    ctx.quadraticCurveTo(p.x + u * 0.2, hipY - u * 0.2, p.x + u * 0.19, shoulderY);
    ctx.closePath();
    ctx.fill();

    // Arms. A raised arm is the signal; the other stays down.
    ctx.strokeStyle = o.skin;
    ctx.lineWidth = u * 0.105;
    const armSwing = o.run ? Math.sin(t * 9 + o.phase + Math.PI) * u * 0.2 : 0;
    for (const side of [-1, 1] as const) {
      const up = (o.raise === 'left' && side < 0) || (o.raise === 'right' && side > 0);
      ctx.beginPath();
      ctx.moveTo(p.x + side * u * 0.18, shoulderY + u * 0.04);
      if (up) {
        ctx.lineTo(p.x + side * u * 0.3, shoulderY - u * 0.3);
        ctx.lineTo(p.x + side * u * 0.26, shoulderY - u * 0.78);
      } else {
        ctx.lineTo(p.x + side * u * 0.26, shoulderY + u * 0.3);
        ctx.lineTo(p.x + side * u * 0.22 + armSwing * side, hipY + u * 0.02);
      }
      ctx.stroke();

      // The line judge's flag rides on the raised arm.
      if (up && o.flag) {
        ctx.fillStyle = '#ff4a3d';
        ctx.beginPath();
        ctx.moveTo(p.x + side * u * 0.26, shoulderY - u * 0.78);
        ctx.lineTo(p.x + side * u * 0.62, shoulderY - u * 0.66);
        ctx.lineTo(p.x + side * u * 0.3, shoulderY - u * 0.42);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Head, hair, and the whistle flash at the mouth.
    ctx.fillStyle = o.skin;
    ctx.beginPath();
    ctx.arc(p.x, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = o.hair;
    ctx.beginPath();
    ctx.arc(p.x, headY - headR * 0.14, headR * 0.99, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    ctx.fill();

    if (o.whistle) {
      const glow = ctx.createRadialGradient(p.x, headY + headR * 0.5, 0, p.x, headY + headR * 0.5, headR * 2.2);
      glow.addColorStop(0, 'rgba(255,255,255,0.85)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, headY + headR * 0.5, headR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
