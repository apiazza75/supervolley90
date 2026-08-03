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
  /** Label of the jump button on the current input device, for coaching text. */
  jumpLabel?: string;
}

export class Renderer {
  readonly camera = new Camera();
  readonly effects = new Effects();
  private readonly arena = new Arena();
  private readonly rng = new Rng(0xbadc0de);
  private readonly rand = () => this.rng.next();

  /** Freeze-frame timer used to punctuate kills, as arcade games did. */
  private hitStop = 0;
  /** Full-screen white flash, 0..1, for the moment a Lethal Maneuver lands. */
  private flash = 0;
  /** Seconds remaining of the fiery ball trail after a power move. */
  private powerTrail = 0;
  /** Coaching banner countdown, started when the human's gauge fills. */
  private promptTimer = 0;
  /** Clock for the landing-marker arrow bounce. */
  private markerTime = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
  }

  /** Convert simulation events into visual and audio-visual flourishes. */
  handleEvents(world: World, events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'powerMove': {
          // The screen should tell you, unmistakably, that a gauge was spent.
          this.effects.announce({ x: 0, y: 0, z: 3.6 }, ev.name, '#ff8a3d', 54);
          this.effects.burst(ev.at, 'rgba(255,180,80,0.8)');
          this.effects.impact(ev.at, 30, this.rand, 'rgba(255,150,60,');
          this.camera.addShake(26);
          this.hitStop = Math.max(this.hitStop, 0.2);
          this.flash = 0.35;
          this.powerTrail = 0.9;
          this.arena.cheer(1);
          break;
        }
        case 'powerReady': {
          const team = world.team(ev.side);
          this.effects.announce(
            { x: 0, y: ev.side === 'home' ? -5 : 5, z: 2.8 },
            'POWER READY',
            team.config.colors[0],
            26,
          );
          // The maneuver spans two inputs separated in time, which no gauge
          // can explain by itself — so when the human's fills, say the words.
          if (world.humanTeam?.side === ev.side) this.promptTimer = 5;
          break;
        }
        case 'contact': {
          const power = clamp(ev.speed / 3, 1, 12);
          if (ev.kind === 'power') {
            this.effects.impact(ev.at, 34, this.rand, 'rgba(255,190,90,');
          } else if (ev.kind === 'spike') {
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
          this.arena.cheer(0.75);
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
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    if (this.powerTrail > 0) this.powerTrail = Math.max(0, this.powerTrail - dt);
    if (this.promptTimer > 0) this.promptTimer = Math.max(0, this.promptTimer - dt);
    this.markerTime += dt;

    cam.follow(world.ball.pos, dt);
    this.effects.pushTrail(world.ball.pos, Math.hypot(world.ball.vel.x, world.ball.vel.y, world.ball.vel.z));
    this.effects.update(dt);

    ctx.clearRect(0, 0, cam.viewWidth, cam.viewHeight);
    this.arena.update(dt);
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
              charge: p.id === active ? p.charge : 0,
              time: state.time,
              dt,
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
    this.drawPowerCoach(world, state.time, state.jumpLabel ?? 'SHIFT');
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,236,196,${this.flash})`;
      ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);
    }

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
    const cam = this.camera;
    const s = cam.projectFloor(pred.point.x, pred.point.y);

    const inCourt = isInsideCourt(pred.point.x, pred.point.y);
    // Which side is about to receive this ball — that player needs the loudest
    // signal, because standing under the marker in time is the whole game.
    const yours = world.humanTeam !== null && pred.point.y < -0.2;
    // 0 when the ball has just left a hand, 1 as it arrives.
    const urgency = clamp(1 - pred.time / 1.6, 0, 1);

    const color = !inCourt ? '#ff6b5e' : yours ? '#ffe27a' : 'rgba(255,255,255,0.85)';
    const u = s.scale * 42;
    const rx = 0.62 * u;

    ctx.save();

    // Outer ring: where the ball will land.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, 4 * s.scale);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Countdown ring: closes onto the spot as the ball arrives. This is the
    // timing cue — when the two rings meet, the ball is there.
    const cr = rx * (1.9 - urgency * 0.92);
    ctx.globalAlpha = 0.35 + 0.5 * urgency;
    ctx.lineWidth = Math.max(2, 3 * s.scale);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, cr, cr * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();

    // The arrow, bouncing over the spot — the marker the arcade original used.
    const bob = Math.sin(this.markerTime * 9) * 4 * s.scale;
    const ah = 15 * s.scale;
    const aw = 11 * s.scale;
    const ay = s.y - 22 * s.scale + bob;
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(10,10,20,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, ay);
    ctx.lineTo(s.x - aw / 2, ay - ah * 0.55);
    ctx.lineTo(s.x - aw * 0.22, ay - ah * 0.55);
    ctx.lineTo(s.x - aw * 0.22, ay - ah);
    ctx.lineTo(s.x + aw * 0.22, ay - ah);
    ctx.lineTo(s.x + aw * 0.22, ay - ah * 0.55);
    ctx.lineTo(s.x + aw / 2, ay - ah * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Drop line from the ball to its floor shadow, so height stays legible.
    const ballFloor = cam.projectFloor(world.ball.pos.x, world.ball.pos.y);
    const ballAir = cam.projectVec(world.ball.pos);
    ctx.globalAlpha = 0.28;
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = '#dfe6f5';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ballFloor.x, ballFloor.y);
    ctx.lineTo(ballAir.x, ballAir.y);
    ctx.stroke();
    ctx.setLineDash([]);
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
    // Drawn well over physical size, as every arcade volleyball game does: the
    // ball is the object the whole game is read through, so it gets ~2x scale
    // and a floor of several pixels.
    const r = Math.max(8 * (this.camera.viewWidth / 1280), BALL_RADIUS * s.scale * 42 * 1.9);
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);

    // A power-move ball burns; an ordinary one leaves a pale streak.
    this.effects.drawTrail(
      ctx,
      this.camera,
      this.powerTrail > 0 ? 'rgba(255,140,50,0.95)' : 'rgba(255,236,180,0.9)',
    );

    ctx.save();
    // Only genuinely violent balls stretch — spikes and power moves. At rally
    // speeds the ball stays perfectly round; a permanently oval ball was one
    // of the clearest tells that something was off.
    const stretch = speed > 24 ? clamp((speed - 24) / 40, 0, 0.3) : 0;
    const angle = Math.atan2(-ball.vel.z, ball.vel.x || 0.001);
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    ctx.scale(1 + stretch, 1 - stretch * 0.32);
    ctx.rotate(-angle);

    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, this.powerTrail > 0 ? '#ffb040' : '#ffd873');
    grad.addColorStop(1, this.powerTrail > 0 ? '#e04a12' : '#e08a2a');
    ctx.fillStyle = grad;

    if (this.powerTrail > 0) {
      // Halo around a live Lethal Maneuver, so it reads even against the crowd.
      const halo = ctx.createRadialGradient(0, 0, r, 0, 0, r * 3.2);
      halo.addColorStop(0, 'rgba(255,150,60,0.55)');
      halo.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = grad;
    }
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

  /**
   * On-screen coaching for the Lethal Maneuver.
   *
   * The mechanic is jump, then the jump button again in mid-air — two inputs
   * separated in time. That is undiscoverable from a gauge alone, so the game
   * says exactly what to press and marks the moment the window is open.
   */
  private drawPowerCoach(world: World, time: number, jumpLabel: string): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const team = world.humanTeam;

    if (team?.powerReady && world.phase === 'rally') {
      const p = team.active;
      if (p.specialArmed) {
        // Armed: the player burns until the strike lands.
        const body = cam.project(p.pos.x, p.pos.y, p.height + 0.9);
        const r = (46 + Math.sin(time * 12) * 7) * body.scale;
        const halo = ctx.createRadialGradient(body.x, body.y, r * 0.2, body.x, body.y, r);
        halo.addColorStop(0, 'rgba(255,170,70,0.5)');
        halo.addColorStop(1, 'rgba(255,90,30,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.airborne) {
        // The window is open right now: name the button, loudly.
        const s = cam.project(p.pos.x, p.pos.y, p.height + 2.35);
        const bounce = Math.sin(time * 14) * 4;
        ctx.save();
        ctx.font = '900 26px "Arial Black", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(6,8,18,0.9)';
        ctx.strokeText(`${jumpLabel}!`, s.x, s.y + bounce);
        ctx.fillStyle = '#ffe27a';
        ctx.fillText(`${jumpLabel}!`, s.x, s.y + bounce);
        ctx.restore();
      }
    }

    if (this.promptTimer > 0) {
      const text = `GAUGE FULL!  JUMP, THEN PRESS ${jumpLabel} IN MID-AIR`;
      const x = cam.viewWidth / 2;
      const y = cam.viewHeight - 148;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.promptTimer);
      ctx.font = '800 19px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 44;
      ctx.fillStyle = 'rgba(8,11,24,0.86)';
      ctx.fillRect(x - w / 2, y - 27, w, 40);
      ctx.strokeStyle = `rgba(255,226,122,${0.45 + 0.55 * Math.abs(Math.sin(time * 6))})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - w / 2, y - 27, w, 40);
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(text, x, y);
      ctx.restore();
    }
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
