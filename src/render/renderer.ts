import { Ball } from '../core/ball';
import { Vec3, clamp } from '../core/math3';
import { Player } from '../core/player';
import { Rng } from '../core/rng';
import { BALL_RADIUS, NET_HEIGHT, isInsideCourt } from '../core/rules';
import { GameEvent, World } from '../core/world';
import { Arena } from './arena';
import { Camera } from './camera';
import { Effects } from './fx';
import { drawActiveRing, drawPlayer, drawPlayerShadow, shade } from './players';

/** Interpolated view of a rally, so rendering is smooth between sim steps. */
export interface RenderState {
  /** 0..1 blend between the previous and current simulation step. */
  alpha: number;
  /** Wall-clock seconds since the game started. */
  time: number;
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private readonly arena = new Arena();
  private readonly rng = new Rng(0xbadc0de);
  private readonly rand = () => this.rng.next();

  /** Freeze-frame timer used to punctuate kills, as arcade games did. */
  private hitStop = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
  }

  /** Convert simulation events into visual and audio-visual flourishes. */
  handleEvents(world: World, events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'contact': {
          const power = clamp(ev.speed / 3, 1, 12);
          if (ev.kind === 'spike') {
            this.effects.impact(ev.at, power * 1.4, this.rand, 'rgba(255,196,90,');
            this.camera.addShake(clamp(ev.speed * 0.28, 2, 12));
            this.hitStop = Math.max(this.hitStop, clamp(ev.speed * 0.0025, 0, 0.05));
          } else if (ev.kind === 'block') {
            this.effects.impact(ev.at, power, this.rand, 'rgba(150,220,255,');
            this.camera.addShake(6);
          } else if (ev.kind === 'save') {
            this.effects.dust(ev.at, 16, this.rand);
          } else {
            this.effects.impact(ev.at, power * 0.5, this.rand, 'rgba(230,240,255,');
          }
          break;
        }
        case 'bounce': {
          this.effects.dust(ev.at, 10 + ev.speed, this.rand);
          this.camera.addShake(clamp(ev.speed * 0.14, 0, 7));
          break;
        }
        case 'point': {
          const team = world.team(ev.side);
          const label = POINT_LABEL[ev.reason] ?? 'POINT';
          // Centre court, well above the net: always legible, never hidden
          // behind whichever bodies happen to be in the way.
          const at: Vec3 = { x: 0, y: 0, z: 3.2 };
          this.effects.announce(at, label, team.config.colors[0], 46);
          this.effects.burst(at, 'rgba(255,220,140,0.55)');
          this.camera.addShake(9);
          this.hitStop = Math.max(this.hitStop, 0.07);
          break;
        }
        case 'setWon':
          this.effects.announce({ x: 0, y: 0, z: 3.4 }, `SET ${ev.setNumber}`, '#ffe27a', 54);
          break;
        case 'matchWon':
          this.effects.announce(
            { x: 0, y: 0, z: 3.6 },
            `${world.team(ev.side).config.name.toUpperCase()} WIN`,
            '#ffe27a',
            56,
          );
          break;
        default:
          break;
      }
    }
  }

  /**
   * Draw one frame.
   *
   * Returns the remaining hit-stop, which the game loop uses to briefly hold
   * the simulation after a big hit.
   */
  draw(world: World, state: RenderState, dt: number): number {
    const ctx = this.ctx;
    const cam = this.camera;

    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);

    cam.follow(world.ball.pos, dt);
    this.effects.pushTrail(world.ball.pos, Math.hypot(world.ball.vel.x, world.ball.vel.y, world.ball.vel.z));
    this.effects.update(dt);

    ctx.clearRect(0, 0, cam.viewWidth, cam.viewHeight);
    this.arena.drawBackground(ctx, cam, state.time);

    this.drawLandingMarker(world);
    this.drawBallShadow(world.ball);
    for (const p of world.allPlayers()) drawPlayerShadow(ctx, cam, p);

    // Depth sort everything that stands up off the floor. Painter's algorithm
    // on the camera depth is exact here because nothing interpenetrates.
    const drawables: { depth: number; draw: () => void }[] = [];

    for (const side of ['away', 'home'] as const) {
      const team = world.team(side);
      const active = world.humanTeam?.side === side ? team.activeId : -1;
      for (const p of team.players) {
        const proj = cam.project(p.pos.x, p.pos.y, p.height);
        drawables.push({
          depth: proj.depth,
          draw: () => {
            if (p.id === active) drawActiveRing(ctx, cam, p, '#7ef0ff', state.time);
            drawPlayer(ctx, cam, p, team.config.colors, {
              active: p.id === active,
              far: side === 'away',
              charge: p.id === active ? p.charge : 0,
              time: state.time,
            });
          },
        });
      }
    }

    const netProj = cam.project(0, 0, NET_HEIGHT / 2);
    drawables.push({ depth: netProj.depth, draw: () => this.arena.drawNet(ctx, cam) });

    const ballProj = cam.projectVec(world.ball.pos);
    drawables.push({ depth: ballProj.depth, draw: () => this.drawBall(world.ball) });

    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    this.effects.draw(ctx, cam);
    this.drawVignette();

    return this.hitStop;
  }

  /**
   * The landing marker: the mechanic the whole game is built around. It shows
   * where the ball will touch down, so positioning is a decision rather than a
   * guess, exactly as the arcade original did with its on-court arrow.
   */
  private drawLandingMarker(world: World): void {
    const pred = world.prediction;
    if (!pred.valid || world.phase !== 'rally') return;
    if (world.ball.grounded) return;

    const ctx = this.ctx;
    const s = this.camera.projectFloor(pred.point.x, pred.point.y);
    if (s.behind) return;

    const inCourt = isInsideCourt(pred.point.x, pred.point.y);
    const urgency = clamp(1 - pred.time / 1.6, 0, 1);
    const color = inCourt ? '#ffe27a' : '#ff6b5e';
    const r = (0.85 + urgency * 0.35) * s.scale * 42;

    ctx.save();
    ctx.globalAlpha = 0.35 + urgency * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, (2 + urgency * 3) * s.scale);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Inner ring closes in as the ball arrives: a readable countdown.
    ctx.globalAlpha = 0.6 * urgency;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * (1 - urgency * 0.75), r * 0.34 * (1 - urgency * 0.75), 0, 0, Math.PI * 2);
    ctx.stroke();

    // A vertical tick joining the marker to the ball makes height legible.
    const ballFloor = this.camera.projectFloor(world.ball.pos.x, world.ball.pos.y);
    const ballAir = this.camera.projectVec(world.ball.pos);
    if (!ballFloor.behind && !ballAir.behind) {
      ctx.globalAlpha = 0.18;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ballFloor.x, ballFloor.y);
      ctx.lineTo(ballAir.x, ballAir.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawBallShadow(ball: Ball): void {
    const s = this.camera.projectFloor(ball.pos.x, ball.pos.y);
    if (s.behind) return;
    const lift = clamp(ball.pos.z / 5, 0, 1);
    const r = BALL_RADIUS * s.scale * 42 * (1 + lift * 2.6);
    this.ctx.save();
    this.ctx.globalAlpha = 0.4 * (1 - lift * 0.7);
    this.ctx.fillStyle = '#05070f';
    this.ctx.beginPath();
    this.ctx.ellipse(s.x, s.y, r, r * 0.36, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawBall(ball: Ball): void {
    const ctx = this.ctx;
    const s = this.camera.projectVec(ball.pos);
    if (s.behind) return;
    const r = Math.max(2.5, BALL_RADIUS * s.scale * 42);
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);

    this.effects.drawTrail(ctx, this.camera, 'rgba(255,236,180,0.9)');

    ctx.save();
    // Fast balls stretch along their direction of travel: cheap, and it reads
    // as speed far better than a bigger trail.
    const stretch = clamp(speed / 34, 0, 0.6);
    const angle = Math.atan2(-ball.vel.z, ball.vel.x || 0.001);
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    ctx.scale(1 + stretch, 1 - stretch * 0.32);
    ctx.rotate(-angle);

    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#ffd873');
    grad.addColorStop(1, '#e08a2a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Panel seams, rotating with the ball so spin is visible.
    if (r > 4) {
      ctx.strokeStyle = 'rgba(120,60,10,0.6)';
      ctx.lineWidth = Math.max(0.8, r * 0.14);
      for (let i = 0; i < 3; i++) {
        const a = ball.roll + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.92, r * 0.32, a, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawVignette(): void {
    const { viewWidth: w, viewHeight: h } = this.camera;
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 1.05);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

const POINT_LABEL: Record<string, string> = {
  kill: 'POINT!',
  out: 'OUT!',
  net: 'NET!',
  antenna: 'OUT!',
  fourTouches: '4 TOUCHES',
  serveFault: 'SERVE FAULT',
  block: 'BLOCK!',
};

export { shade };
export type { Player };
