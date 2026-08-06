import { Ball } from '../core/ball';
import { Vec3, clamp } from '../core/math3';
import { Player } from '../core/player';
import { Rng } from '../core/rng';
import { BALL_RADIUS, GAME_SPEED, NET_HEIGHT, isInsideCourt } from '../core/rules';
import { GameEvent, World } from '../core/world';
import { Arena } from './arena';
import { Camera } from './camera';
import { Effects } from './fx';
import { Officials } from './officials';
import { drawActiveRing, drawPlayer, drawPlayerShadow, shade } from './players';
import {
  beginRenderFrame,
  cueSpriteContact,
  drawSpritePlayer,
  type SpriteRenderStyle,
} from './sprite-figure';
import { type SheetSet, loadSheets } from './sprites';
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
  private readonly officials = new Officials();
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
  /** Last phase seen, so the referee can whistle each serve into play. */
  private lastPhase = '';
  /**
   * Drawn sprite sheets, if any were found.
   *
   * Loading is fire-and-forget and failure is silent by design: until the art
   * exists the game draws its vector figures, and dropping a PNG into
   * public/sprites is the entire installation procedure.
   */
  private sheets: SheetSet = {};
  /** Turn the drawn figures off, for comparing them against the vector ones. */
  useSprites = true;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    // Taken on one at a time as each finishes preparing, rather than all at the
    // end: the match is playable from the first frame and simply swaps each
    // action over to its drawn sheet as that sheet becomes ready.
    void loadSheets(
      'sprites',
      (action, sheet) => {
        this.sheets[action] = sheet;
      },
      (action, reason) => {
        this.spriteErrors.push(`${action}: ${reason}`);
      },
    ).catch((err: unknown) => {
      this.spriteErrors.push(String(err));
    });
  }

  /**
   * Why the drawn art is missing, shown on screen.
   *
   * A packaged build has no console to open, so a sheet that fails to load has
   * no way of saying so — and falling back to the vector figures looks exactly
   * like a game that was never given any art. This is only drawn when
   * something actually went wrong, so a working build never shows it.
   */
  private spriteErrors: string[] = [];

  private drawSpriteTrouble(h: number): void {
    if (!this.spriteErrors.length) return;
    const ctx = this.ctx;
    const lines = [
      `drawn art unavailable — ${this.spriteCount}/10 sheets loaded`,
      ...this.spriteErrors.slice(0, 4),
    ];
    ctx.save();
    // Alignment is set explicitly. The drawing code that runs before this
    // leaves it centred, which put every line of the message a few hundred
    // pixels off the left edge of the screen — a diagnostic you cannot read is
    // no better than the silence it replaced.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 13px ui-monospace, monospace';
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24;
    const top = h * 0.18;
    ctx.fillStyle = 'rgba(30, 6, 10, 0.88)';
    ctx.fillRect(12, top - 18, width, 20 * lines.length + 12);
    ctx.fillStyle = '#ff9b9b';
    lines.forEach((l, i) => {
      ctx.fillText(l, 24, top + 20 * i);
    });
    ctx.restore();
  }

  /** How many drawn actions are available, for the diagnostics overlay. */
  get spriteCount(): number {
    return Object.keys(this.sheets).length;
  }

  get maskedSpriteCount(): number {
    return Object.values(this.sheets).filter(
      (sheet) => Boolean(sheet?.maskCanvas && sheet.hairMaskCanvas),
    ).length;
  }

  get arenaAssetCount(): number {
    return this.arena.artAssetCount;
  }

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
          const player = world.findPlayer(ev.playerId);
          cueSpriteContact(ev.playerId, ev.kind, player?.airborne ?? false);
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
          // The officials react: a whistle and an arm up for the side that
          // scored, and — where the call is theirs to make — the nearer line
          // judge flags the ball in or out.
          this.officials.callPoint(ev.side);
          if (ev.reason === 'out') {
            this.officials.callLine(world.ball.pos.x, world.ball.pos.y, false);
          } else if (ev.reason === 'kill') {
            this.officials.callLine(world.ball.pos.x, world.ball.pos.y, true);
          } else if (ev.reason === 'block') {
            this.officials.callTouch(world.ball.pos.x, world.ball.pos.y);
          }
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
   * a replay is for watching, not for playing. Recorded poses use the same
   * illustrated sheets and kit remapping as live play, with the vector figure
   * retained as the safe fallback.
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

    beginRenderFrame();
    cam.follow(frame.ball, dt);
    ctx.clearRect(0, 0, cam.viewWidth, cam.viewHeight);
    this.arena.update(dt);
    this.arena.drawBackground(ctx, cam, time);
    this.officials.update(dt);
    this.officials.drawFar(ctx, cam);
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
          const kit = kitFor(ghost, colors);
          if (
            this.useSprites &&
            drawSpritePlayer(ctx, cam, ghost, this.sheets, dt, spriteStyleFor(ghost, colors))
          ) {
            return;
          }
          drawPlayer(ctx, cam, ghost, kit, { active: false, charge: 0, time, dt });
        },
      });
    }
    const netProj = cam.project(0, 0, NET_HEIGHT / 2);
    drawables.push({ depth: netProj.depth, draw: () => this.arena.drawNet(ctx, cam) });
    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    this.officials.drawNear(ctx, cam);

    const ballPos = { x: frame.ball.x, y: frame.ball.y, z: frame.ball.z };
    this.drawBall({ pos: ballPos, vel: { x: 0, y: 0, z: 0 }, roll: frame.ball.roll } as Ball);
    this.drawVignette(ctx, cam);

    // Broadcast furniture. A replay has to announce itself: played straight,
    // it just looks like the game stuttering and repeating itself.
    const w = cam.viewWidth;
    const h = cam.viewHeight;
    const grow = clamp(age / 0.18, 0, 1);
    const bar = h * 0.09 * grow;
    ctx.save();

    // Letterbox bars use the same technical rails as the live HUD.
    const topGrad = ctx.createLinearGradient(0, 0, 0, bar);
    topGrad.addColorStop(0, 'rgba(2,5,13,0.98)');
    topGrad.addColorStop(1, 'rgba(8,15,29,0.92)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
    ctx.fillStyle = '#49dcff';
    ctx.fillRect(0, Math.max(0, bar - 3), w * 0.52, 3);
    ctx.fillStyle = '#ff5f5a';
    ctx.fillRect(w * 0.52, Math.max(0, bar - 3), w * 0.48, 3);
    ctx.fillStyle = '#ffd35c';
    ctx.fillRect(0, h - bar, w, 2);

    // Opening card: a centred cut-corner broadcast plate, not a full-width slab.
    if (age < REPLAY_INTRO + 0.35) {
      const k = clamp((REPLAY_INTRO + 0.35 - age) / 0.35, 0, 1);
      const cardW = Math.min(720, w * 0.68);
      const cardH = 132;
      const x = w / 2 - cardW / 2;
      const y = h / 2 - cardH / 2;
      ctx.globalAlpha = k;
      cutPanel(ctx, x, y, cardW, cardH, 24);
      const card = ctx.createLinearGradient(x, y, x + cardW, y + cardH);
      card.addColorStop(0, 'rgba(12,27,49,0.97)');
      card.addColorStop(0.5, 'rgba(4,9,21,0.98)');
      card.addColorStop(1, 'rgba(31,16,29,0.97)');
      ctx.fillStyle = card;
      ctx.fill();
      ctx.strokeStyle = 'rgba(73,220,255,0.78)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ffd35c';
      ctx.fillRect(x + 50, y, cardW - 100, 4);
      ctx.save();
      ctx.translate(w / 2, h / 2 - 9);
      ctx.transform(1, 0, -0.12, 1, 0, 0);
      ctx.textAlign = 'center';
      const pop = 1 + (1 - clamp(age / 0.2, 0, 1)) * 0.36;
      ctx.font = `950 ${Math.round(50 * pop)}px "Arial Black", "Inter", system-ui, sans-serif`;
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(3,7,17,0.98)';
      ctx.strokeText('INSTANT REPLAY', 0, 0);
      ctx.fillStyle = '#f4f7ff';
      ctx.fillText('INSTANT REPLAY', 0, 0);
      ctx.restore();
      ctx.font = '900 15px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd35c';
      ctx.fillText(label, w / 2, h / 2 + 39);
      ctx.globalAlpha = 1;
    }

    if (bar > 18) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const indicator = 6 + Math.sin(time * 9) * 1.5;
      ctx.save();
      ctx.translate(30, bar / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ff5f5a';
      ctx.fillRect(-indicator, -indicator, indicator * 2, indicator * 2);
      ctx.restore();
      ctx.font = '950 19px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#f4f7ff';
      ctx.fillText(`REPLAY  //  ${label}`, 52, bar / 2);
      ctx.textAlign = 'right';
      ctx.font = '900 11px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = `rgba(220,235,252,${0.55 + 0.35 * Math.sin(time * 5)})`;
      ctx.fillText('ANY KEY  //  SKIP', w - 28, bar / 2);
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

    // One display frame begins here; the body-draw counter is per frame.
    beginRenderFrame();

    // The sprite clock has to run on the same time base as the simulation.
    // The world advances at GAME_SPEED, but the sheets were being played at
    // wall-clock rate, so the poses ran about a fifth faster than the bodies
    // they belong to: feet cycled quicker than the player travelled, and every
    // action read as hurried. This is the coordination the pace work needs —
    // slowing the game down without it just made the mismatch more obvious.
    const animDt = dt * GAME_SPEED;

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
    if (world.phase === 'serve' && this.lastPhase !== 'serve') {
      this.officials.authoriseServe(world.servingSide);
    }
    this.lastPhase = world.phase;
    this.officials.update(dt);
    this.officials.drawFar(ctx, cam);

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
            const kit = kitFor(p, team.config.colors);
            const spriteStyle = spriteStyleFor(p, team.config.colors);
            const serverHint =
              world.phase === 'serve' && p.id === world.team(world.servingSide).server.id
                ? p.airborne
                  ? 'jumpServe'
                  : 'serve'
                : undefined;
            const bufferedHint =
              p.actionBuffer > 0 || p.heldAction
                ? world.possession !== p.side
                  ? p.airborne && Math.abs(p.pos.y) < 2.4
                    ? 'block'
                    : 'bump'
                  : world.touches === 1
                    ? 'set'
                    : world.touches >= 2
                      ? 'spike'
                      : undefined
                : undefined;
            if (
              this.useSprites &&
              drawSpritePlayer(
                ctx,
                cam,
                p,
                this.sheets,
                animDt,
                spriteStyle,
                serverHint ?? bufferedHint,
              )
            )
              return;
            drawPlayer(ctx, cam, p, kit, {
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

    // Near-side officials sit in front of the play, as they do from this angle.
    this.officials.drawNear(ctx, cam);

    this.effects.draw(ctx, cam);
    this.drawVignette(ctx, cam);
    this.drawTimingCue(world, state.time);
    this.drawPowerCoach(world, state.time, state.jumpLabel ?? 'SHIFT');
    this.drawSpriteTrouble(cam.viewHeight);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,236,196,${this.flash})`;
      ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);
    }

    return this.hitStop;
  }

  /**
   * A soft darkening towards the frame edges, and a faint warm lift through the
   * middle band where the play happens.
   *
   * This is the cheapest single thing that moves the picture out of the flat,
   * evenly-lit look of a 90s cabinet: real arena footage has the light falling
   * off towards the corners, and the eye follows the bright part of the frame
   * without being told to.
   */
  private drawVignette(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const w = cam.viewWidth;
    const h = cam.viewHeight;
    ctx.save();
    const v = ctx.createRadialGradient(w / 2, h * 0.6, h * 0.25, w / 2, h * 0.6, w * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.65, 'rgba(2,4,10,0.14)');
    v.addColorStop(1, 'rgba(2,4,10,0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    // A warm lift through the band the play happens in, and a cool cast in the
    // shadows. This is colour grading, and it is the cheapest thing that stops
    // a picture reading as flat fills straight out of a 1990s palette.
    ctx.globalCompositeOperation = 'lighter';
    const warm = ctx.createLinearGradient(0, h * 0.34, 0, h * 0.92);
    warm.addColorStop(0, 'rgba(255,196,120,0)');
    warm.addColorStop(0.45, 'rgba(255,190,116,0.055)');
    warm.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'source-over';
    const cool = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    cool.addColorStop(0, 'rgba(24,44,92,0.2)');
    cool.addColorStop(1, 'rgba(24,44,92,0)');
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, w, h * 0.42);
    ctx.restore();
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

    // Faceted target brackets: the landing mechanic keeps its clear floor
    // footprint, but now shares the angular broadcast language of the HUD.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, 4 * s.scale);
    facetedEllipse(ctx, s.x, s.y, rx, rx * 0.32, 12, Math.PI / 12);
    ctx.stroke();

    const tti = Math.min(pred.time, 2.2);
    const cr = rx * (1 + tti * 1.5);
    ctx.globalAlpha = 0.45 + 0.5 * urgency;
    ctx.lineWidth = Math.max(2, 3 * s.scale);
    facetedEllipse(ctx, s.x, s.y, cr, cr * 0.32, 12, -Math.PI / 12);
    ctx.stroke();

    // Four short corner brackets remain legible over any floor texture.
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(2, 3.2 * s.scale);
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(s.x + side * rx * 0.72, s.y - rx * 0.23);
      ctx.lineTo(s.x + side * rx, s.y - rx * 0.23);
      ctx.lineTo(s.x + side * rx, s.y - rx * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x + side * rx * 0.72, s.y + rx * 0.23);
      ctx.lineTo(s.x + side * rx, s.y + rx * 0.23);
      ctx.lineTo(s.x + side * rx, s.y + rx * 0.08);
      ctx.stroke();
    }

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
      facetedEllipse(ctx, s.x, s.y, r * 1.5 * pulse, r * 1.5 * pulse, 10, time * 0.8);
      ctx.stroke();

      const p = world.humanTeam ? world.team(world.humanTeam.side).active : null;
      if (p) {
        const head = cam.project(p.pos.x, p.pos.y, p.height + 2.5);
        ctx.save();
        ctx.translate(head.x, head.y);
        ctx.transform(1, 0, -0.12, 1, 0, 0);
        ctx.font = '950 22px "Arial Black", "Inter", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(6,8,18,0.94)';
        ctx.strokeText('PRESS!', 0, 0);
        ctx.fillStyle = '#ffd35c';
        ctx.fillText('PRESS!', 0, 0);
        ctx.restore();
      }
    } else if (cue.time < 1.1) {
      // Closing in: the ring's radius IS the time left.
      const k = clamp(cue.time / 1.1, 0, 1);
      ctx.strokeStyle = '#7ef0ff';
      ctx.globalAlpha = 0.35 + 0.5 * (1 - k);
      ctx.lineWidth = Math.max(2, 3.5 * s.scale);
      const cueR = r * (1.5 + k * 5);
      facetedEllipse(ctx, s.x, s.y, cueR, cueR, 10, -time * 0.45);
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
      const label = world.serveStrikeReady ? 'HIT!' : 'LOCKING';
      const panelW = world.serveStrikeReady ? 88 : 118;
      cutPanel(ctx, s.x - panelW / 2, s.y - 27, panelW, 34, 8);
      ctx.fillStyle = 'rgba(4,9,20,0.88)';
      ctx.fill();
      ctx.strokeStyle = world.serveStrikeReady ? '#ffd35c' : 'rgba(73,220,255,0.58)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '950 16px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = world.serveStrikeReady ? '#ffd35c' : 'rgba(220,235,252,0.76)';
      ctx.fillText(label, s.x, s.y - 5);
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
        ctx.translate(s.x, s.y + bounce);
        ctx.transform(1, 0, -0.13, 1, 0, 0);
        ctx.font = '950 26px "Arial Black", "Inter", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(6,8,18,0.94)';
        ctx.strokeText(`${jumpLabel}!`, 0, 0);
        ctx.fillStyle = '#ffd35c';
        ctx.fillText(`${jumpLabel}!`, 0, 0);
        ctx.restore();
      }
    }

    if (this.promptTimer > 0) {
      const text = `GAUGE FULL!  JUMP, THEN PRESS ${jumpLabel} IN MID-AIR`;
      const x = cam.viewWidth / 2;
      const y = cam.viewHeight - 148;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.promptTimer);
      ctx.font = '900 15px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(text).width + 64;
      cutPanel(ctx, x - w / 2, y - 29, w, 42, 11);
      const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      grad.addColorStop(0, 'rgba(12,26,48,0.92)');
      grad.addColorStop(0.5, 'rgba(22,35,56,0.96)');
      grad.addColorStop(1, 'rgba(12,26,48,0.92)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,211,92,${0.5 + 0.5 * Math.abs(Math.sin(time * 6))})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffd35c';
      ctx.fillText(text, x, y - 7);
      ctx.restore();
    }
  }


}

function facetedEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments: number,
  phase = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = phase + (i / segments) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function cutPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/** Shouts for a full-power swing, in the spirit of the era's arcade games. */
/**
 * The kit a player wears.
 *
 * A libero must be dressed in contrast to their team — it is a rule of the
 * sport, not a decoration, and it exists precisely so that anyone watching can
 * tell at a glance which player on court may not attack or block. Deriving it
 * from the team's own second colour keeps each side's libero recognisably
 * theirs while still reading as the odd one out.
 */
function kitFor(p: Player, colors: [string, string]): [string, string] {
  if (p.role !== 'libero') return colors;
  return [shade(colors[1], 0.62), colors[0]];
}

const SKIN_PALETTE = ['#f0c29b', '#e4b184', '#c98b5a', '#a96d42', '#8b572f', '#6d4128'];
const HAIR_PALETTE = ['#1b1514', '#3a2418', '#0d1118', '#5a321d', '#28212a', '#7a5934'];

/** Stable visual variation without changing collision or gameplay geometry. */
function spriteStyleFor(p: Player, colors: [string, string]): SpriteRenderStyle {
  const kit = kitFor(p, colors);
  const roleHeight: Record<Player['role'], number> = {
    setter: 0.98,
    outside: 1,
    opposite: 1.035,
    middle: 1.065,
    libero: 0.93,
  };
  const roleWidth: Record<Player['role'], number> = {
    setter: 0.97,
    outside: 1,
    opposite: 1.035,
    middle: 1.02,
    libero: 0.94,
  };
  const jitter = (((p.id * 37) % 7) - 3) * 0.008;
  return {
    palette: {
      primary: kit[0],
      secondary: kit[1],
      // Skin and hair use explicit material masks, never the uniform hue.
      // A stable id palette gives twelve readable individuals without changing
      // collision or animation geometry.
      skin: SKIN_PALETTE[Math.abs(p.id * 5 + (p.side === 'home' ? 1 : 3)) % SKIN_PALETTE.length],
      hair: HAIR_PALETTE[Math.abs(p.id * 3 + 2) % HAIR_PALETTE.length],
    },
    heightScale: roleHeight[p.role] + jitter,
    widthScale: roleWidth[p.role] - jitter * 0.5,
  };
}

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
