import { Ball } from '../core/ball';
import type { ContactKind } from '../core/contact';
import { Vec3, clamp, approach } from '../core/math3';
import { Player } from '../core/player';
import { Rng } from '../core/rng';
import { BALL_RADIUS, FIXED_DT, GAME_SPEED, GRAVITY, PLAYER_FRICTION, TOSS_SPEED, isInsideCourt, type Side } from '../core/rules';
import { GameEvent, World } from '../core/world';
import { BALL_STYLES, type BallStyle } from '../game/teams';
import { Arena } from './arena';
import { Camera } from './camera';
import { characterSignatureFor } from './character-signature';
import { Effects } from './fx';
import { Officials, type OfficialsDiagnostics } from './officials';
import { drawActiveRing, drawPlayerShadow, playerGaitDiagnostics, shade } from './players';
import {
  beginRenderFrame,
  cueSpriteContact,
  drawMatchSpritePlayer,
  drawSpritePlayer,
  playerSpriteDiagnostics,
  playerSpriteScreenTop,
  shouldUseRasterSprite,
  spriteContactPoint,
  spriteServePalmPoint,
  type ServeSpriteState,
  type SpriteRenderStyle,
} from './sprite-figure';
import { SHEETS, type SheetSet, loadSheets } from './sprites';
import { standingServeSwingProgress } from './serve-swing';
import { HOT_TIMING_GRAMMAR, POWER_VISUAL_GRAMMAR, drawVolleyball } from './volleyball';
import { captureReplayPlayer, type ReplayFrame } from '../game/replay';
import { roundTransitionOpacity } from './round-transition';

export const READABILITY_FREEZE = {
  // Impacts are communicated by the ball, drawn follow-through and local FX.
  // Freezing all twelve athletes on every touch interrupts continuous motion.
  softContact: 0,
  set: 0,
  serve: 0,
  save: 0,
  spikeMin: 0,
  spikeMax: 0,
  blockMin: 0,
  blockMax: 0,
  powerContact: 0,
  hardBounce: 0,
} as const;

export function contactReadabilityFreeze(kind: ContactKind, speed: number): number {
  switch (kind) {
    case 'power':
      return READABILITY_FREEZE.powerContact;
    case 'spike':
      return clamp(0.032 + speed * 0.0017, READABILITY_FREEZE.spikeMin, READABILITY_FREEZE.spikeMax);
    case 'block':
      return clamp(0.03 + speed * 0.0022, READABILITY_FREEZE.blockMin, READABILITY_FREEZE.blockMax);
    case 'set':
      return READABILITY_FREEZE.set;
    case 'serve':
      return READABILITY_FREEZE.serve;
    case 'save':
      return READABILITY_FREEZE.save;
    case 'bump':
    case 'tip':
      return READABILITY_FREEZE.softContact;
    default:
      return 0;
  }
}

/** Interpolated view of a rally, so rendering is smooth between sim steps. */
export interface RenderState {
  /** 0..1 blend between the previous and current simulation step. */
  alpha: number;
  /** Wall-clock seconds since the game started. */
  time: number;
  /** Label of the jump button on the current input device, for coaching text. */
  jumpLabel?: string;
  awayJumpLabel?: string;
  touch?: boolean;
}

const CONTACT_RELEASE_TIME = 0.085;

/** Only the actual server receives a service clock; no inferred auto-swing. */
export function serveSpriteState(world: World, p: Player, visualLead = 0): ServeSpriteState | undefined {
  if (world.phase !== 'serve' || world.team(world.servingSide).server.id !== p.id) return undefined;
  return { holding: !world.serveTossInFlight, holdSeconds: world.serveHoldSeconds,
    tossElapsed: world.serveTossElapsed + (world.serveTossInFlight && !p.plansJumpServe ? clamp(visualLead, 0, FIXED_DT) : 0), jumping: p.plansJumpServe,
    tossGestureProgress: world.serveTossGestureProgressAt(visualLead), runupProgress: world.serveRunupProgressAt(visualLead),
    standingSwingProgress: standingServeSwingProgress(world) };
}

/** Smoothly release the drawn ball from the authored hand point to physics. */
export function contactReleaseMix(age: number): number {
  const u = clamp(age / CONTACT_RELEASE_TIME, 0, 1);
  return u * u * (3 - 2 * u);
}

interface VisualBallContact {
  playerId: number;
  kind: ContactKind;
  airborne: boolean;
  facing: number;
  backSet?: boolean;
  age: number;
}

export class Renderer {
  /** Last painted live view, including the exact authored drawings. */
  replayFrame: ReplayFrame | null = null;
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
  private powerBallActive = false;
  /** Coaching banner countdown, started when the human's gauge fills. */
  private promptTimer = 0;
  private promptSide: Side = 'home';
  /** Clock for the landing-marker arrow bounce. */
  private markerTime = 0;
  /** Rotates the spike shout, so the same words never land twice running. */
  private callIndex = 0;
  /** Last phase seen, so the referee can whistle each serve into play. */
  private lastPhase = '';
  /**
   * Very short visual join between the authored hand and the released ball.
   * Physics stays untouched; this only removes the one-frame gap made visible
   * by the generous arcade reach envelope.
   */
  private visualBallContact: VisualBallContact | null = null;
  private serveBallRelease: { playerId: number; offset: Vec3 } | null = null;
  /**
   * Drawn manga sprite sheets.
   *
   * They are installed atomically: no sheet is used until all authored actions
   * have loaded. Partial loading was the source of visible "species switching"
   * where a movement could briefly fall back to the old ellipse/capsule figure.
   */
  private sheets: SheetSet = {};
  private ballStyle: BallStyle = BALL_STYLES[0];
  /** Turn the drawn figures off, for comparing them against the vector ones. */
  useSprites = true;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    void loadSheets('sprites', undefined, (action, reason) => {
      this.spriteErrors.push(`${action}: ${reason}`);
    }).then((sheets) => {
      if (Object.keys(sheets).length === Object.keys(SHEETS).length) {
        this.sheets = sheets;
      } else {
        this.spriteErrors.push(`incomplete manga sprite set: ${Object.keys(sheets).length}/${Object.keys(SHEETS).length}`);
      }
    }).catch((err: unknown) => {
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

  private get spritesReady(): boolean {
    return this.spriteCount === Object.keys(SHEETS).length;
  }

  private drawSpriteTrouble(h: number): void {
    if (!this.spriteErrors.length && this.spritesReady) return;
    const ctx = this.ctx;
    const expected = Object.keys(SHEETS).length;
    const lines = this.spriteErrors.length
      ? [`manga player art unavailable — ${this.spriteCount}/${expected} sheets loaded`, ...this.spriteErrors.slice(0, 4)]
      : [`loading manga player art — ${this.spriteCount}/${expected} sheets loaded`];
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

  /** Share already loaded manga art with the menu, without another atlas load. */
  get menuPortrait() { return this.sheets.idle; }

  get maskedSpriteCount(): number {
    return Object.values(this.sheets).filter(
      (sheet) => Boolean(sheet?.materialMask || (sheet?.maskCanvas && sheet.hairMaskCanvas)),
    ).length;
  }

  get arenaAssetCount(): number {
    return this.arena.artAssetCount;
  }

  get officialDiagnostics(): OfficialsDiagnostics {
    return this.officials.snapshotForDiagnostics();
  }

  get crowdDiagnostics() { return this.arena.crowdDiagnostics; }

  get cosmeticDiagnostics() {
    return { ballId: this.ballStyle.id, courtId: this.arena.courtStyleId };
  }

  setCosmetics({ ballId, courtId }: { ballId: string; courtId: string }): void {
    this.ballStyle = BALL_STYLES.find(style => style.id === ballId) ?? BALL_STYLES[0];
    this.arena.setCourtStyle(courtId);
  }

  get gaitDiagnostics(): ReturnType<typeof playerGaitDiagnostics> {
    return playerGaitDiagnostics();
  }

  get spriteDiagnostics(): ReturnType<typeof playerSpriteDiagnostics> {
    return playerSpriteDiagnostics();
  }

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
  }

  prepareScenery(): void {
    this.arena.prepareSceneryForMenu(this.ctx, this.camera);
  }

  /**
   * Fractional simulation time not yet integrated by the fixed-step loop.
   *
   * The simulation is intentionally deterministic and advances in 120 Hz
   * chunks. A 60/75 Hz display almost never lands exactly on those chunks, so
   * drawing the raw world position makes bodies and the ball advance in tiny
   * visible stair-steps. Rendering a read-only copy a fraction of a step ahead
   * keeps the physics unchanged while the picture tracks display time.
   */
  private visualLead(state: RenderState): number {
    return clamp(state.alpha, 0, 0.98) * FIXED_DT;
  }

  private viewBall(ball: Ball, lead: number): Ball {
    if (lead <= 0 || ball.frozen) return ball;
    const view = Object.assign(Object.create(Object.getPrototypeOf(ball)), ball) as Ball;
    view.pos = {
      x: ball.pos.x + ball.vel.x * lead,
      y: ball.pos.y + ball.vel.y * lead,
      z: Math.max(BALL_RADIUS, ball.pos.z + ball.vel.z * lead),
    };
    view.roll = ball.roll + Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) * lead * 2.4;
    return view;
  }

  private viewPlayer(p: Player, lead: number): Player {
    if (lead <= 0) return p;
    const view = Object.assign(Object.create(Object.getPrototypeOf(p)), p) as Player;
    const diveSequence = p.diving || p.downTime > 0 || p.gettingUp > 0;
    // Grounded preparation and landing must share the sub-tick display clock
    // with the body. Raw 120Hz animTime skipped intermediate drawings on a
    // 60Hz display even when their duration exceeded a display frame. This
    // copy never advances physics, a contact cue or the physical landing lock.
    const groundedSequence = p.anim === 'bump_ready' || p.anim === 'set_ready' || p.anim === 'plant'
      || (p.landingPlant && p.presentation.phase === 'land');
    const jumpServeRise = p.presentation?.action === 'jumpServe' && p.presentation.phase === 'rise';
    if (diveSequence || jumpServeRise || groundedSequence && p.height === 0 && p.vertVel === 0) {
      view.animTime += Math.min(FIXED_DT, lead);
    }
    // The run-up uses a physical deadline, not the free-running gait clock.
    // Sample it at the same sub-tick instant as the projected feet; otherwise
    // the body moves smoothly while its many approach drawings arrive in
    // alternating short/long holds. This never extends the real jump deadline.
    if (p.approaching && p.height === 0 && p.vertVel === 0) {
      view.approachAge += Math.min(FIXED_DT, lead);
    }
    // A dive/slide has no steering acceleration: interpolate towards the
    // next semi-implicit physics position, including that tick's friction.
    // Using the old velocity overshoots and snaps backwards at each update;
    // returning the raw player instead freezes it between those updates.
    const drag = diveSequence ? PLAYER_FRICTION * (p.diving ? .55 : p.sliding > 0 ? .9 : 0) : 0;
    const vx = drag ? approach(p.vel.x, 0, drag * FIXED_DT) : p.vel.x;
    const vy = drag ? approach(p.vel.y, 0, drag * FIXED_DT) : p.vel.y;
    view.pos = {
      x: p.pos.x + vx * lead,
      y: p.pos.y + vy * lead,
      z: p.pos.z,
    };
    if (p.height > 0 || p.vertVel !== 0) {
      const gravity = GRAVITY * 1.15;
      // Interpolate toward Player.step's semi-implicit next tick, updating
      // BOTH ballistic coordinates. A projected height with the old velocity
      // made remainingJumpFlight increase between ticks: visible pose 2 -> 1.
      // The endpoint matches the next simulation height exactly, so crossing
      // a fixed-tick boundary cannot reset the silhouette backwards either.
      view.height = Math.max(0, p.height + (p.vertVel + gravity * FIXED_DT) * lead);
      // Until the physical dive lands, retain its descending phase even if
      // the fractional view has reached the floor. Zero velocity here made
      // the pose selector rewind from palms-down frame 11 to reach frame 8.
      view.vertVel = view.height > 0 || p.diving ? p.vertVel + gravity * lead : 0;
    }
    // Projected momentum must respect the same near-net clearance as the
    // laid-out body. clampToArena writes only this copy's independent pos.
    if (diveSequence) view.clampToArena();
    return view;
  }

  private viewContactBall(world: World, ball: Ball, dt: number): Ball {
    const contact = this.visualBallContact;
    if (!contact) return ball;
    const player = world.findPlayer(contact.playerId);
    if (!player) {
      this.visualBallContact = null;
      return ball;
    }

    contact.age += dt;
    const mix = contactReleaseMix(contact.age);
    if (mix >= 1) {
      this.visualBallContact = null;
      return ball;
    }

    const hand = spriteContactPoint(
      player, contact.kind, contact.airborne, this.sheets,
      spriteStyleFor(player, world.team(player.side).config.colors),
      this.camera.scaleAt(player.pos.x),
      contact.facing,
      contact.backSet,
    );
    const view = Object.assign(Object.create(Object.getPrototypeOf(ball)), ball) as Ball;
    view.pos = {
      x: hand.x + (ball.pos.x - hand.x) * mix,
      y: hand.y + (ball.pos.y - hand.y) * mix,
      z: hand.z + (ball.pos.z - hand.z) * mix,
    };
    return view;
  }

  private viewServeBall(world: World, ball: Ball, visualLead = 0): Ball {
    if (world.phase !== 'serve') { this.serveBallRelease = null; return ball; }
    const p = world.team(world.servingSide).server;
    const service = serveSpriteState(world, p, visualLead)!;
    if (service.holding && Math.hypot(p.vel.x, p.vel.y) < 0.4) {
      const palm = spriteServePalmPoint(p, service, this.sheets,
        spriteStyleFor(p, world.team(p.side).config.colors), this.camera.scaleAt(p.pos.x));
      palm.z += BALL_RADIUS;
      this.serveBallRelease = { playerId: p.id, offset: {
        x: palm.x - ball.pos.x, y: palm.y - ball.pos.y, z: palm.z - ball.pos.z,
      } };
      return Object.assign(Object.create(Object.getPrototypeOf(ball)), ball, { pos: palm }) as Ball;
    }
    if (world.serveTossInFlight && this.serveBallRelease?.playerId === p.id) {
      // Meet the physical trajectory continuously at its apex. A linear
      // time-based blend made a high illustrated release dip down first.
      // Squared upward velocity preserves an ascending arc; physics and its
      // strike window are unchanged. The correction is zero on descent.
      const k = clamp(ball.vel.z / TOSS_SPEED, 0, 1) ** 2;
      const offset = this.serveBallRelease.offset;
      return Object.assign(Object.create(Object.getPrototypeOf(ball)), ball, { pos: {
        x: ball.pos.x + offset.x * k, y: ball.pos.y + offset.y * k, z: ball.pos.z + offset.z * k,
      } }) as Ball;
    }
    this.serveBallRelease = null;
    return ball;
  }

  /** Convert simulation events into visual and audio-visual flourishes. */
  handleEvents(world: World, events: GameEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'skill': {
          this.effects.announce({ x: 0, y: 0, z: 4.8 }, ev.name,
            world.team(ev.side).config.colors[1], 18, 72, 'corner');
          this.effects.shockwave(ev.at, ev.side === 'home' ? 'rgba(110,225,255,' : 'rgba(255,204,111,');
          this.arena.cheer(0.45, ev.side);
          break;
        }
        case 'powerMove': {
          // The screen should tell you, unmistakably, that a gauge was spent.
          // Keep the name above the tape and compact: the old world-scaled
          // 38px label became a 150px banner that hid the hitter, ball and
          // blockers at the exact contact frame.
          this.effects.announce({ x: 0, y: 0, z: 4.8 }, ev.name, POWER_VISUAL_GRAMMAR.headline, 18, 100, 'corner');
          this.effects.burst(ev.at, POWER_VISUAL_GRAMMAR.burst);
          this.effects.shockwave(ev.at, POWER_VISUAL_GRAMMAR.shock);
          this.camera.addShake(18);
          this.hitStop = Math.max(this.hitStop, READABILITY_FREEZE.powerContact);
          this.flash = 0.14;
          this.powerTrail = 0.65;
          this.arena.cheer(1, ev.side);
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
          if (world.isHumanControlled(ev.side)) {
            this.promptTimer = 3;
            this.promptSide = ev.side;
          }
          break;
        }
        case 'contact': {
          // A deflection ends this powered flight; a timer must not carry a
          // previous attack's floor effect onto a subsequent normal touch.
          this.powerBallActive = ev.kind === 'power';
          if (!this.powerBallActive) this.powerTrail = 0;
          cueSpriteContact(ev.playerId, ev.kind, ev.airborne, ev.facing, ev.backSet);
          this.visualBallContact = {
            playerId: ev.playerId,
            kind: ev.kind,
            airborne: ev.airborne,
            facing: ev.facing,
            backSet: ev.backSet,
            age: 0,
          };
          const power = clamp(ev.speed / 3, 1, 12);
          const actor = world.findPlayer(ev.playerId);
          // The ball's short visual release starts at the illustrated hand.
          // Its impact sparks must use the same anchor, not the older physics
          // reach point which can now sit on the redrawn athlete's chest.
          const impactAt = actor ? spriteContactPoint(actor, ev.kind, ev.airborne, this.sheets,
            spriteStyleFor(actor, world.team(actor.side).config.colors), this.camera.scaleAt(actor.pos.x), ev.facing, ev.backSet) : ev.at;
          if (ev.timing === 'perfect') {
            this.effects.announce({ x: 0, y: 0, z: 4.8 }, 'PERFECT!', HOT_TIMING_GRAMMAR.rim, 19, 70, 'corner');
            this.arena.cheer(0.3, ev.side);
          }
          if (ev.kind === 'block' || ev.kind === 'save') this.arena.cheer(0.32, ev.side);
          else if (ev.kind === 'spike' || ev.kind === 'power') this.arena.cheer(0.18, ev.side);
          this.hitStop = Math.max(this.hitStop, contactReadabilityFreeze(ev.kind, ev.speed));
          if (ev.kind === 'power') {
            this.effects.powerImpact(impactAt, 34, this.rand);
          } else if (ev.kind === 'spike') {
            this.effects.impact(impactAt, power * 1.4, this.rand, 'rgba(255,196,90,');
            this.camera.addShake(clamp(ev.speed * 0.28, 2, 12));
            // A swing hit at full stretch deserves to be named.
            if (ev.speed > 26) {
              this.effects.announce(
                { x: 0, y: 0, z: 4.8 },
                SPIKE_CALLS[this.callIndex++ % SPIKE_CALLS.length],
                '#ffd166',
                18, 48, 'corner',
              );
              this.effects.shockwave(impactAt, 'rgba(255,214,120,');
            }
          } else if (ev.kind === 'block') {
            this.effects.impact(impactAt, power, this.rand, 'rgba(150,220,255,');
            this.camera.addShake(6);
            if (ev.speed > 17) {
              this.effects.announce(
                { x: 0, y: 0, z: 4.8 },
                'MONSTER BLOCK',
                '#8fd8ff',
                18, 48, 'corner',
              );
              this.effects.shockwave(impactAt, 'rgba(150,220,255,');
              this.camera.addShake(12);
            }
          } else if (ev.kind === 'save') {
            this.effects.impact(impactAt, power * 0.35, this.rand, 'rgba(230,240,255,', false);
          } else {
            this.effects.impact(impactAt, power * 0.5, this.rand, 'rgba(230,240,255,');
          }
          break;
        }
        case 'bounce': {
          const powered = this.powerBallActive;
          this.powerBallActive = false;
          this.powerTrail = 0;
          // The simulation also emits bounce for an antenna/far-out fault.
          // Those are airborne events, not parquet collisions.
          if (ev.at.z > BALL_RADIUS + 0.01) break;
          if (powered) this.effects.powerFloorImpact(ev.at, ev.speed, this.rand);
          else this.effects.dust(ev.at, 10 + ev.speed, this.rand);
          this.camera.addShake(clamp(ev.speed * 0.14, 0, 7));
          // Only a ball buried hard enough to end the rally marks the floor.
          if (!powered && ev.speed > 21) {
            this.effects.crack(ev.at, clamp(ev.speed / 26, 0.6, 1.6), this.rand);
            this.effects.shockwave(ev.at, 'rgba(255,240,214,');
            this.effects.impact(ev.at, ev.speed * 0.6, this.rand, 'rgba(255,240,214,');
            this.camera.addShake(clamp(ev.speed * 0.34, 8, 20));
            this.hitStop = Math.max(this.hitStop, READABILITY_FREEZE.hardBounce);
          }
          break;
        }
        case 'point': {
          this.powerBallActive = false;
          this.powerTrail = 0;
          const team = world.team(ev.side);
          const label = ev.scored === false ? 'CAMBIO PALLA' : POINT_LABEL[ev.reason] ?? 'POINT';
          // Centre court, well above the net: always legible, never hidden
          // behind whichever bodies happen to be in the way.
          const at: Vec3 = { x: 0, y: 0, z: 3.2 };
          this.effects.announce(at, label, team.config.colors[0], 46);
          this.effects.burst(at, 'rgba(255,220,140,0.55)');
          this.camera.addShake(9);
          this.arena.cheer(ev.scored === false ? 0.35 : 0.85, ev.side);
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
        case 'sideout': {
          // The point call already names the result. The subsequent rotation
          // is the rule the player needs explained, so side-out stays audible
          // and eventful without adding a second headline over the court.
          break;
        }
        case 'rotation': {
          const team = world.team(ev.side);
          this.effects.announce(
            { x: 0, y: ev.side === 'home' ? -4 : 4, z: 3.8 },
            'ROTATE  2 → 1 → 6 → 5 → 4 → 3',
            team.config.colors[0],
            9,
            60,
          );
          break;
        }
        case 'liberoChange': {
          const team = world.team(ev.side);
          this.effects.announce(
            { x: 0, y: ev.side === 'home' ? -4.7 : 4.7, z: 4.25 },
            `${ev.entered ? 'LIBERO IN' : 'LIBERO OUT'}  ${ev.name.toUpperCase()}  Z${ev.slot}`,
            kitFor(world.findPlayer(ev.playerId) ?? team.players[0], team.config.colors)[0],
            12,
            86,
          );
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
   * illustrated sheets and kit remapping as live play. If a sheet is late or
   * missing, the replay waits for raster art instead of switching species to
   * the old capsule/ellipse figure.
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
    this.arena.setTeamColors(world.home.config.colors, world.away.config.colors);
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
          if (this.useSprites && this.spritesReady) {
            drawPlayerShadow(ctx, cam, ghost, ghost.height);
            drawSpritePlayer(ctx, cam, ghost, this.sheets, 0, spriteStyleFor(ghost, colors), undefined, undefined, rp.sprite);
          }
        },
      });
    }
    drawables.push(...this.arena.netDrawables(ctx, cam));
    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    this.officials.drawNear(ctx, cam);

    const ballPos = { x: frame.ball.x, y: frame.ball.y, z: frame.ball.z };
    this.drawBall({ pos: ballPos, vel: { x: 0, y: 0, z: 0 }, roll: frame.ball.roll } as Ball);
    this.arena.drawForeground(ctx, cam);
    this.drawVignette(ctx, cam);
    this.effects.drawReplayTransition(ctx, cam.viewWidth, cam.viewHeight, age, label);
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
    const replayPlayers: Player[] = [];
    const visualLead = this.visualLead(state);
    const rawBallView = this.viewBall(world.ball, visualLead);

    // The sprite clock has to run on the same time base as the simulation.
    // The world advances at GAME_SPEED, but the sheets were being played at
    // wall-clock rate, so the poses ran about a fifth faster than the bodies
    // they belong to: feet cycled quicker than the player travelled, and every
    // action read as hurried. This is the coordination the pace work needs —
    // slowing the game down without it just made the mismatch more obvious.
    // Hit-stop freezes the ball physics, so it must freeze the exact contact
    // drawing too.  Advancing the sheet while the ball was held still made the
    // arm slide through it and was perceived as both a hitch and a late touch.
    const holdingContact = this.hitStop > 0;
    const animDt = holdingContact ? 0 : dt * GAME_SPEED;
    const ballView = this.viewContactBall(world, this.viewServeBall(world, rawBallView, visualLead), holdingContact ? 0 : dt);

    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    if (this.powerTrail > 0) this.powerTrail = Math.max(0, this.powerTrail - dt);
    if (this.promptTimer > 0) this.promptTimer = Math.max(0, this.promptTimer - dt);
    this.markerTime += dt;

    cam.follow(ballView.pos, dt, world.phase === 'serve' ? world.team(world.servingSide).server.pos : undefined);
    this.effects.pushTrail(ballView.pos, Math.hypot(world.ball.vel.x, world.ball.vel.y, world.ball.vel.z));
    this.effects.update(dt);

    ctx.clearRect(0, 0, cam.viewWidth, cam.viewHeight);
    this.arena.update(dt);
    this.arena.setTeamColors(world.home.config.colors, world.away.config.colors);
    this.arena.drawBackground(ctx, cam, state.time);
    if (world.phase === 'serve' && this.lastPhase !== 'serve') {
      this.officials.authoriseServe(world.servingSide);
    }
    this.lastPhase = world.phase;
    this.officials.update(dt);
    this.officials.drawFar(ctx, cam);

    this.effects.drawFloor(ctx, cam);
    this.drawLandingMarker(world);
    this.drawBallShadow(ballView);
    if (this.useSprites && this.spritesReady) {
      for (const p of world.allPlayers()) drawPlayerShadow(ctx, cam, this.viewPlayer(p, visualLead));
    }

    // Depth sort everything that stands up off the floor. Painter's algorithm
    // on the camera depth is exact here because nothing interpenetrates.
    const drawables: { depth: number; draw: () => void }[] = [];

    for (const side of ['away', 'home'] as const) {
      const team = world.team(side);
      const active = world.isHumanControlled(side) ? team.activeId : -1;
      for (const p of team.players) {
        const viewP = this.viewPlayer(p, visualLead);
        replayPlayers.push(viewP);
        const proj = cam.project(viewP.pos.x, viewP.pos.y, viewP.height);
        drawables.push({
          depth: proj.depth,
          draw: () => {
            if (p.id === active) {
              const indicator = side === 'home' ? '#7ef0ff' : '#ffd166';
              drawActiveRing(ctx, cam, viewP, indicator, state.time);
              if (world.humanAwayTeam) this.drawControlLabel(viewP, side, indicator);
            }
            const kit = kitFor(viewP, team.config.colors);
            const spriteStyle = spriteStyleFor(viewP, team.config.colors);
            const service = serveSpriteState(world, p, visualLead);
            if (
              this.useSprites &&
              this.spritesReady &&
              shouldUseRasterSprite(viewP) &&
              drawMatchSpritePlayer(
                ctx,
                cam,
                viewP,
                this.sheets,
                animDt,
                spriteStyle,
                service,
              )
            ) {
              // Drawn body rendered. There is deliberately no vector fallback
              // path here: if raster art is not ready, the diagnostic overlay
              // says so instead of changing the player into an ellipse rig.
            }
            if (viewP.role === 'libero') drawLiberoBadge(ctx, cam, viewP, kit[0]);
          },
        });
      }
    }

    drawables.push(...this.arena.netDrawables(ctx, cam));

    const ballProj = cam.projectVec(ballView.pos);
    const homeCue = world.playCueFor('home'), awayCue = world.playCueFor('away');
    const hot = homeCue?.ready === true || awayCue?.ready === true
      || world.serveStrikeReady && world.isHumanControlled(world.servingSide);
    drawables.push({ depth: ballProj.depth, draw: () => this.drawBall(ballView, hot) });

    drawables.sort((a, b) => b.depth - a.depth);
    for (const d of drawables) d.draw();

    // Near-side officials sit in front of the play, as they do from this angle.
    const painted = new Map(playerSpriteDiagnostics().map(p => [p.playerId, p]));
    this.replayFrame = {
      ball: { ...ballView.pos, roll: ballView.roll },
      players: replayPlayers.flatMap(p => {
        const pose = painted.get(p.id);
        return pose ? [captureReplayPlayer(p, pose)] : [];
      }),
    };
    this.officials.drawNear(ctx, cam);

    this.effects.draw(ctx, cam);
    this.arena.drawForeground(ctx, cam);
    this.drawVignette(ctx, cam);
    const cueSide: Side = awayCue && (!homeCue || awayCue.ready && !homeCue.ready || awayCue.time < homeCue.time)
      ? 'away' : 'home';
    this.drawTimingCue(world, state.time, cueSide, cueSide === 'home' ? homeCue : awayCue);
    for (const side of ['home', 'away'] as const) {
      if (world.isHumanControlled(side)) this.drawPowerCoach(world, state.time,
        side === 'home' ? state.jumpLabel ?? 'SHIFT' : state.awayJumpLabel ?? 'L', side, state.touch === true);
    }
    this.drawSpriteTrouble(cam.viewHeight);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,236,196,${this.flash})`;
      ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);
    }

    const transition = roundTransitionOpacity(world.phase, world.phaseTimer);
    if (transition > 0) {
      ctx.save();
      ctx.globalAlpha = transition;
      ctx.fillStyle = '#070a16';
      ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);
      ctx.restore();
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

    // Do not paint neutral predictions as hard-white court geometry. White
    // floor marks read as duplicate volleyball lines from the side camera; the
    // non-human marker is now a translucent cyan UI cue, while the human target
    // keeps the louder gold arcade signal.
    const color = !inCourt ? '#ff6b5e' : yours ? '#ffe27a' : 'rgba(126,240,255,0.54)';
    const markerAlpha = !inCourt || yours ? 0.9 : 0.58;
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
    ctx.globalAlpha = markerAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(yours ? 2.5 : 1.8, (yours ? 4 : 2.6) * s.scale);
    facetedEllipse(ctx, s.x, s.y, rx, rx * 0.32, 12, Math.PI / 12);
    ctx.stroke();

    const tti = Math.min(pred.time, 2.2);
    const cr = rx * (1 + tti * 1.5);
    ctx.globalAlpha = (0.3 + 0.5 * urgency) * markerAlpha;
    ctx.lineWidth = Math.max(yours ? 2 : 1.4, (yours ? 3 : 2.1) * s.scale);
    facetedEllipse(ctx, s.x, s.y, cr, cr * 0.32, 12, -Math.PI / 12);
    ctx.stroke();

    // Four short corner brackets remain legible over any floor texture.
    ctx.globalAlpha = 0.82 * markerAlpha;
    ctx.lineWidth = Math.max(yours ? 2 : 1.5, (yours ? 3.2 : 2.4) * s.scale);
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
    ctx.strokeStyle = yours ? '#dfe6f5' : 'rgba(126,240,255,0.82)';
    ctx.lineWidth = yours ? 1.8 : 1.25;
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
      this.powerBallActive || this.powerTrail > 0 ? POWER_VISUAL_GRAMMAR.trail : POWER_VISUAL_GRAMMAR.normalTrail,
      this.powerBallActive || this.powerTrail > 0,
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

    if (this.powerBallActive || this.powerTrail > 0) {
      this.effects.drawPowerBall(ctx, r, ball.roll, hot, this.ballStyle);
      ctx.restore();
      return;
    }
    drawVolleyball(ctx, r, ball.roll, { hot, style: this.ballStyle });
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
  private drawControlLabel(player: Player, side: Side, color: string): void {
    const point = this.camera.projectFloor(player.pos.x, player.pos.y);
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 11px "Arial Narrow", system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,12,23,0.92)';
    const label = side === 'home' ? 'P1' : 'P2';
    ctx.strokeText(label, point.x, point.y + 19);
    ctx.fillStyle = color; ctx.fillText(label, point.x, point.y + 19);
    ctx.restore();
  }

  private drawTimingCue(world: World, time: number, side: Side,
    cue: { ready: boolean; time: number } | null): void {
    if (!cue) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.projectVec(world.ball.pos);
    const r = Math.max(11 * (cam.viewWidth / 1280), BALL_RADIUS * s.scale * 42 * 2.2);

    ctx.save();
    if (cue.ready) {
      // Playable right now: red, not white/gold, so it cannot be confused with
      // court lines, ball highlights or the ordinary landing marker.
      const pulse = 1 + Math.sin(time * 30) * 0.12;
      ctx.strokeStyle = HOT_TIMING_GRAMMAR.rim;
      ctx.lineWidth = Math.max(4, 6 * s.scale);
      ctx.globalAlpha = 0.95;
      facetedEllipse(ctx, s.x, s.y, r * 1.5 * pulse, r * 1.5 * pulse, 10, time * 0.8);
      ctx.stroke();

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = HOT_TIMING_GRAMMAR.fill;
      facetedEllipse(ctx, s.x, s.y, r * 1.95 * pulse, r * 1.95 * pulse, 10, -time * 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;

      const p = world.team(side).active;
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
        const label = world.humanAwayTeam ? `${side === 'home' ? 'P1' : 'P2'}  ORA!` : 'ORA!';
        ctx.strokeText(label, 0, 0);
        ctx.fillStyle = HOT_TIMING_GRAMMAR.rim;
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    } else if (cue.time < 1.1) {
      // Closing in: the ring's radius IS the time left.
      const k = clamp(cue.time / 1.1, 0, 1);
      ctx.strokeStyle = side === 'home' ? '#7ef0ff' : '#ffd166';
      ctx.globalAlpha = 0.35 + 0.5 * (1 - k);
      ctx.lineWidth = Math.max(2, 3.5 * s.scale);
      const cueR = r * (1.5 + k * 5);
      facetedEllipse(ctx, s.x, s.y, cueR, cueR, 10, -time * 0.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPowerCoach(world: World, time: number, jumpLabel: string, side: Side, touch: boolean): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const team = world.team(side);

    // Serve coaching: once the toss is up, say when to swing.
    if (team && team.side === world.servingSide && world.phase === 'serve' && world.serveTossInFlight) {
      // The raised hands and ball occupy the space above the server's head.
      // Keep the instruction in the bottom HUD; the red ball marks the timing.
      const s = { x: cam.viewWidth / 2, y: touch ? 151 : cam.viewHeight - 75 };
      ctx.save();
      const label = world.serveStrikeReady ? HOT_TIMING_GRAMMAR.label : 'LOCKING';
      const panelW = world.serveStrikeReady ? 126 : 118;
      cutPanel(ctx, s.x - panelW / 2, s.y - 27, panelW, 34, 8);
      ctx.fillStyle = 'rgba(4,9,20,0.88)';
      ctx.fill();
      ctx.strokeStyle = world.serveStrikeReady ? HOT_TIMING_GRAMMAR.rim : 'rgba(73,220,255,0.58)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = '950 16px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = world.serveStrikeReady ? HOT_TIMING_GRAMMAR.rim : 'rgba(220,235,252,0.76)';
      ctx.fillText(label, s.x, s.y - 5);
      ctx.restore();
    }

    if (team?.powerReady && world.phase === 'rally') {
      const p = team.active;
      if (p.specialArmed) {
        const body = cam.project(p.pos.x, p.pos.y, p.height + 0.9);
        this.effects.drawPowerAura(ctx, body.x, body.y, body.scale, time);
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

    if (this.promptTimer > 0 && this.promptSide === side) {
      const text = `${world.humanAwayTeam ? (side === 'home' ? 'P1  ' : 'P2  ') : ''}ENERGIA PIENA!  SALTA, POI ${jumpLabel} IN VOLO`;
      const x = cam.viewWidth / 2;
      const y = touch ? 199 : cam.viewHeight - 148;
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
export function kitFor(p: Player, colors: [string, string]): [string, string] {
  if (p.role !== 'libero') return colors;
  const candidates = ['#ff315d', '#ffd400', '#13e6d1', '#a86bff', '#ff7a1a'];
  const rgb = (hex: string): [number, number, number] => {
    const value = Number.parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const distance = (a: string, b: string): number => {
    const aa = rgb(a);
    const bb = rgb(b);
    return Math.hypot(aa[0] - bb[0], aa[1] - bb[1], aa[2] - bb[2]);
  };
  const primary = candidates
    .slice()
    .sort(
      (a, b) =>
        Math.min(distance(b, colors[0]), distance(b, colors[1])) -
        Math.min(distance(a, colors[0]), distance(a, colors[1])),
    )[0];
  const [r, g, b] = rgb(primary);
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 145 ? '#10131c' : '#eee6d2';
  return [primary, ink];
}

function drawLiberoBadge(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  color: string,
): void {
  const top = playerSpriteScreenTop(p.id);
  if (top === undefined) return;
  const at = cam.project(p.pos.x, p.pos.y, p.height);
  const r = Math.max(8, at.scale * 10);
  // Follow the current illustrated pose, including crouches and dives, instead
  // of floating at a fixed 2.35m above every libero's feet.
  at.y = top - r - Math.max(3, at.scale * 4);
  ctx.save();
  ctx.fillStyle = 'rgba(4,8,18,0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, at.scale * 2.4);
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.max(10, r * 1.22)}px "Arial Narrow", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('L', at.x, at.y + 0.5);
  ctx.restore();
}

const SKIN_PALETTE = ['#f0c29b', '#e4b184', '#c98b5a', '#a96d42', '#8b572f', '#6d4128'];
const HAIR_PALETTE = ['#1b1514', '#3a2418', '#0d1118', '#5a321d', '#28212a', '#7a5934'];

/**
 * Which entry of a six-colour palette a player gets.
 *
 * The stride has to be coprime with the palette length or the sequence
 * repeats before the roster runs out. Hair was indexed with `id * 3 + 2`, and
 * three shares a factor with six: the six players of a side received hair
 * colours 2, 5, 2, 5, 2, 5 — two tints between them, on the axis that most
 * obviously tells one athlete from another.
 *
 * The strides in use are 5 for skin and 1 for hair. Both are coprime with six
 * so each visits all six entries, and being different from each other the two
 * axes do not move in lockstep: the pairing of tone and hair varies down the
 * roster instead of repeating.
 */
function paletteIndex(id: number, stride: number, offset: number, length: number): number {
  return Math.abs(id * stride + offset) % length;
}

/** Stable visual variation without changing collision or gameplay geometry. */
export function spriteStyleFor(p: Player, colors: [string, string]): SpriteRenderStyle {
  const kit = kitFor(p, colors);
  const signature = characterSignatureFor(p.id);
  // The same reduction characterSignatureId() applies, for the same reason.
  // Replay copies carry the live id plus a thousand, and every identity
  // derived from the raw id therefore changed the moment a replay started: the
  // skin tone, the hair colour and the build jitter all moved, so a player was
  // one person during the rally and a different one watching it back.
  const roster = Math.abs(Math.trunc(p.id)) % 100;
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
  const jitter = (((roster * 37) % 7) - 3) * 0.008;
  return {
    palette: {
      primary: kit[0],
      secondary: kit[1],
      skin: SKIN_PALETTE[paletteIndex(roster, 5, p.side === 'home' ? 1 : 3, SKIN_PALETTE.length)],
      hair: HAIR_PALETTE[paletteIndex(roster, 1, p.side === 'home' ? 2 : 5, HAIR_PALETTE.length)],
      signature: signature.id,
    },
    heightScale: roleHeight[p.role] + jitter + signature.heightDelta,
    widthScale: roleWidth[p.role] - jitter * 0.5 + signature.widthDelta,
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
