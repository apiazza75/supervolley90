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
import { INTRO as REPLAY_INTRO, type ReplayFrame } from '../game/replay';

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
  /** Rotates the spike shout, so the same words never land twice running. */
  private callIndex = 0;

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
          this.effects.announce({ x: 0, y: 0, z: 3.6 }, ev.name, '#ff8a3d', 66);
          this.effects.burst(ev.at, 'rgba(255,180,80,0.8)');
          this.effects.impact(ev.at, 40, this.rand, 'rgba(255,150,60,');
          this.effects.shockwave(ev.at, 'rgba(255,150,60,');
          this.effects.shockwave({ x: ev.at.x, y: ev.at.y, z: ev.at.z + 0.4 }, 'rgba(255,220,140,');
          this.camera.addShake(30);
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
            // A swing hit at full stretch deserves to be named.
            if (ev.speed > 26) {
              this.effects.announce(
                { x: ev.at.x, y: ev.at.y, z: ev.at.z + 1.1 },
                SPIKE_CALLS[this.callIndex++ % SPIKE_CALLS.length],
                '#ffd166',
                48,
              );
              this.effects.shockwave(ev.at, 'rgba(255,214,120,');
            }
          } else if (ev.kind === 'block') {
            this.effects.impact(ev.at, power, this.rand, 'rgba(150,220,255,');
            this.camera.addShake(6);
            if (ev.speed > 17) {
              this.effects.announce(
                { x: ev.at.x, y: ev.at.y, z: ev.at.z + 1.1 },
                'MONSTER BLOCK',
                '#8fd8ff',
                48,
              );
              this.effects.shockwave(ev.at, 'rgba(150,220,255,');
              this.camera.addShake(12);
            }
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
          // Only a ball buried hard enough to end the rally marks the floor.
          if (ev.speed > 21) {
            this.effects.crack(ev.at, clamp(ev.speed / 26, 0.6, 1.6), this.rand);
            this.effects.shockwave(ev.at, 'rgba(255,240,214,');
            this.effects.impact(ev.at, ev.speed * 0.6, this.rand, 'rgba(255,240,214,');
            this.camera.addShake(clamp(ev.speed * 0.34, 8, 20));
          }
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
          this.effects.announce({ x: 0, y: 0, z: 3.4 }, `SET ${ev.setNumber}`, '#ffe27a', 62);
          this.effects.confetti(this.rand, 90);
          this.arena.cheer(1);
          this.camera.addShake(10);
          break;
        case 'matchWon':
          this.effects.announce(
            { x: 0, y: 0, z: 3.6 },
            `${world.team(ev.side).config.name.toUpperCase()} WIN`,
            '#ffe27a',
            70,
          );
          this.effects.confetti(this.rand, 160);
          this.arena.cheer(1);
          this.flash = 0.3;
          break;
        default:
          break;
      }
    }
  }

  /**
   * Draw a recorded frame instead of the live world.
   *
   * Only the court, the bodies and the ball: no markers, no cues, no gauges —
   * a replay is for watching, not for playing. The recorded players are cast
   * to `Player` because `drawPlayer` only ever reads the fields a snapshot
   * carries.
   */
  drawReplay(
    world: World,
    frame: ReplayFrame,
    label: string,
    age: number,
    dt: number,
    time: number,
  ): void {
    const ctx = this.ctx;
    const cam = this.camera;

    cam.follow(frame.ball, dt);
    ctx.clearRect(0, 0, cam.viewWidth, cam.viewHeight);
    this.arena.update(dt);
    this.arena.drawBackground(ctx, cam, time);
    this.effects.drawFloor(ctx, cam);

    const drawables: { depth: number; draw: () => void }[] = [];
    for (const rp of frame.players) {
      const colors = world.team(rp.side).config.colors;
      const proj = cam.project(rp.pos.x, rp.pos.y, rp.height);
      // A separate id space, so replay bodies do not disturb the smoothing
      // state of the live figures they are copies of.
      const ghost = { ...rp, id: rp.id + 1000 } as unknown as Player;
      drawables.push({
        depth: proj.depth,
        draw: () => {
          drawPlayerShadow(ctx, cam, ghost);
          drawPlayer(ctx, cam, ghost, colors, { active: false, charge: 0, time, dt });
        },
      });
    }
    const netProj = cam.project(0, 0, NET_HEIGHT / 2);
    drawables.push({ depth: netProj.depth, draw: () => this.arena.drawNet(ctx, cam) });
    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    const ballPos = { x: frame.ball.x, y: frame.ball.y, z: frame.ball.z };
    this.drawBall({ pos: ballPos, vel: { x: 0, y: 0, z: 0 }, roll: frame.ball.roll } as Ball);

    // Broadcast furniture. A replay has to announce itself: played straight,
    // it just looks like the game stuttering and repeating itself.
    const w = cam.viewWidth;
    const h = cam.viewHeight;
    const grow = clamp(age / 0.18, 0, 1);
    const bar = h * 0.09 * grow;
    ctx.save();

    // Bars wipe in from the edges.
    ctx.fillStyle = 'rgba(4,6,14,0.9)';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    ctx.strokeStyle = 'rgba(255,90,77,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bar);
    ctx.lineTo(w, bar);
    ctx.moveTo(0, h - bar);
    ctx.lineTo(w, h - bar);
    ctx.stroke();

    // The opening card: a full-width slab that slams in and slides away.
    if (age < REPLAY_INTRO + 0.35) {
      const k = clamp((REPLAY_INTRO + 0.35 - age) / 0.35, 0, 1);
      const slabH = h * 0.2;
      const y = h / 2 - slabH / 2;
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(8,10,22,0.88)';
      ctx.fillRect(0, y, w, slabH);
      ctx.fillStyle = '#ff5a4d';
      ctx.fillRect(0, y, w, 5);
      ctx.fillRect(0, y + slabH - 5, w, 5);
      ctx.textAlign = 'center';
      const pop = 1 + (1 - clamp(age / 0.2, 0, 1)) * 0.5;
      ctx.font = `900 ${Math.round(58 * pop)}px "Arial Black", system-ui, sans-serif`;
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,8,18,0.95)';
      ctx.strokeText('INSTANT REPLAY', w / 2, h / 2 + 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('INSTANT REPLAY', w / 2, h / 2 + 6);
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.fillText(label, w / 2, h / 2 + 44);
      ctx.globalAlpha = 1;
    }

    if (bar > 18) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ff5a4d';
      ctx.beginPath();
      ctx.arc(38, bar / 2, 9 + Math.sin(time * 9) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '900 26px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`REPLAY — ${label}`, 62, bar / 2 + 9);
      ctx.textAlign = 'right';
      ctx.font = '800 17px system-ui, sans-serif';
      ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * Math.sin(time * 5)})`;
      ctx.fillText('ANY KEY TO SKIP', w - 30, bar / 2 + 6);
    }
    ctx.restore();
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

    this.effects.drawFloor(ctx, cam);
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
              // The only thing still worth charging is the underarm serve, so
              // that is the only time a meter appears over anyone's head.
              charge:
                p.id === active && world.phase === 'serve' ? world.serveHoldFraction : 0,
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
    const hot = world.playCue?.ready === true || world.serveStrikeReady;
    drawables.push({ depth: ballProj.depth, draw: () => this.drawBall(world.ball, hot) });

    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    this.effects.draw(ctx, cam);
    this.drawTimingCue(world, state.time);
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

    // A run guide: a line from the player you are steering to the spot they
    // need to reach. In a side elevation the court's depth is only a few
    // pixels, so "which way do I go, and how far" is genuinely hard to read
    // from a marker alone — the line answers both at a glance.
    if (yours && inCourt && world.humanTeam) {
      const me = world.team(world.humanTeam.side).active;
      const from = cam.projectFloor(me.pos.x, me.pos.y);
      const dist = Math.hypot(pred.point.x - me.pos.x, pred.point.y - me.pos.y);
      if (dist > 0.55) {
        ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -this.markerTime * 34;
        ctx.strokeStyle = 'rgba(126,240,255,0.75)';
        ctx.lineWidth = Math.max(1.6, 2.4 * s.scale);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }

    // Outer ring: where the ball will land.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, 4 * s.scale);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Countdown ring: its radius IS the time to impact, closing continuously
    // through the whole flight and meeting the landing ellipse exactly as the
    // ball arrives. That collapse is the "move now" signal.
    const tti = Math.min(pred.time, 2.2);
    const cr = rx * (1 + tti * 1.5);
    ctx.globalAlpha = 0.5 + 0.45 * urgency;
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

  private drawBall(ball: Ball, hot = false): void {
    const ctx = this.ctx;
    const s = this.camera.projectVec(ball.pos);
    if (s.behind) return;
    // Drawn well over physical size, as every arcade volleyball game does: the
    // ball is the object the whole game is read through, so it gets ~2x scale
    // and a floor of several pixels.
    const r = Math.max(11 * (this.camera.viewWidth / 1280), BALL_RADIUS * s.scale * 42 * 2.2);
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

    if (this.powerTrail > 0) {
      // A live Lethal Maneuver burns: fire ball with a halo, so it reads even
      // against the crowd. This is the only time the ball glows.
      const halo = ctx.createRadialGradient(0, 0, r, 0, 0, r * 3.2);
      halo.addColorStop(0, 'rgba(255,150,60,0.55)');
      halo.addColorStop(1, 'rgba(255,80,30,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      const fire = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      fire.addColorStop(0, '#ffffff');
      fire.addColorStop(0.55, '#ffb040');
      fire.addColorStop(1, '#e04a12');
      ctx.fillStyle = fire;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,40,5,0.7)';
      ctx.lineWidth = Math.max(0.8, r * 0.12);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.92, r * 0.32, ball.roll + (i * Math.PI) / 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // A real volleyball's panels: three parallel stripes wrapping the ball,
    // white / blue / yellow, rotating with the spin. Overlapping ellipses at
    // three different angles — the previous attempt — draw a rosette, not a
    // ball: on a sphere the seams you can see all run the SAME way.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f5f8';
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.rotate(ball.roll * 0.6);
    // Stripe boundaries as fractions of the diameter, and the colour of the
    // stripe below each one. The seams bow, because they are drawn on a ball.
    const stripes: [number, number, string][] = [
      [-1.05, -0.34, '#f4f5f8'],
      [-0.34, 0.3, '#2a5bd7'],
      [0.3, 1.05, '#ffc531'],
    ];
    for (const [top, bottom, color] of stripes) {
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, top * r);
      ctx.quadraticCurveTo(0, top * r - r * 0.16, r * 1.1, top * r);
      ctx.lineTo(r * 1.1, bottom * r);
      ctx.quadraticCurveTo(0, bottom * r - r * 0.16, -r * 1.1, bottom * r);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    // Seams between the panels.
    ctx.strokeStyle = 'rgba(24,32,52,0.5)';
    ctx.lineWidth = Math.max(0.7, r * 0.05);
    for (const edge of [-0.34, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, edge * r);
      ctx.quadraticCurveTo(0, edge * r - r * 0.16, r * 1.1, edge * r);
      ctx.stroke();
    }
    // The cross seams that split each stripe into panels, only where a real
    // ball shows them: a short arc near the middle of the visible face.
    if (r > 7) {
      ctx.lineWidth = Math.max(0.6, r * 0.04);
      ctx.beginPath();
      ctx.moveTo(r * 0.12, -r * 1.05);
      ctx.quadraticCurveTo(r * 0.3, 0, r * 0.12, r * 1.05);
      ctx.stroke();
    }
    ctx.rotate(-ball.roll * 0.6);
    // Volume: a highlight where the light hits and a shaded lower-right limb.
    const sh = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.15, 0, 0, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.6)');
    sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(18,26,48,0.4)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // THE moment: the ball goes red when the player you are steering can
    // actually hit it. A ring beside the ball is something to notice; the ball
    // changing colour is impossible to miss.
    if (hot) {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = hot ? '#ffe6e0' : 'rgba(20,26,42,0.8)';
    ctx.lineWidth = Math.max(0.9, r * (hot ? 0.11 : 0.07));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * On-screen coaching for the Lethal Maneuver.
   *
   * The mechanic is jump, then the jump button again in mid-air — two inputs
   * separated in time. That is undiscoverable from a gauge alone, so the game
   * says exactly what to press and marks the moment the window is open.
   */
  /**
   * The WHEN indicator.
   *
   * A ring around the ball closes as the ball drops into the active player's
   * reach and snaps to a bright flash the moment it is actually playable, with
   * PRESS! over the player. Before this the game only ever said *where* the
   * ball would land, so a player standing in exactly the right place still had
   * to guess the moment — and a press a fraction early was simply discarded.
   */
  private drawTimingCue(world: World, time: number): void {
    const cue = world.playCue;
    if (!cue) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.projectVec(world.ball.pos);
    const r = Math.max(11 * (cam.viewWidth / 1280), BALL_RADIUS * s.scale * 42 * 2.2);

    ctx.save();
    if (cue.ready) {
      // Playable right now: a hard white ring, pulsing fast.
      const pulse = 1 + Math.sin(time * 30) * 0.12;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(3, 5 * s.scale);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.5 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      const p = world.humanTeam ? world.team(world.humanTeam.side).active : null;
      if (p) {
        const head = cam.project(p.pos.x, p.pos.y, p.height + 2.5);
        ctx.font = '900 22px "Arial Black", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(6,8,18,0.9)';
        ctx.strokeText('PRESS!', head.x, head.y);
        ctx.fillStyle = '#fff27a';
        ctx.fillText('PRESS!', head.x, head.y);
      }
    } else if (cue.time < 1.1) {
      // Closing in: the ring's radius IS the time left.
      const k = clamp(cue.time / 1.1, 0, 1);
      ctx.strokeStyle = '#7ef0ff';
      ctx.globalAlpha = 0.35 + 0.5 * (1 - k);
      ctx.lineWidth = Math.max(2, 3.5 * s.scale);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * (1.5 + k * 5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPowerCoach(world: World, time: number, jumpLabel: string): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const team = world.humanTeam;

    // Serve coaching: once the toss is up, say when to swing.
    if (team && world.phase === 'serve' && world.serveTossInFlight) {
      const server = world.team(team.side).server;
      const s = cam.project(server.pos.x, server.pos.y, server.height + 2.4);
      ctx.save();
      ctx.font = '900 24px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,8,18,0.9)';
      const label = world.serveStrikeReady ? 'HIT!' : '...';
      ctx.strokeText(label, s.x, s.y);
      ctx.fillStyle = world.serveStrikeReady ? '#ffe27a' : 'rgba(230,238,255,0.8)';
      ctx.fillText(label, s.x, s.y);
      ctx.restore();
    }

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


}

/** Shouts for a full-power swing, in the spirit of the era's arcade games. */
const SPIKE_CALLS = ['KILLER SPIKE', 'THUNDER HIT', 'ROLLING SMASH', 'BLAZE SPIKE'];

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
