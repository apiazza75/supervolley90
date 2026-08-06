import { clamp } from '../core/math3';
import type { ContactKind } from '../core/contact';
import type { Player, PlayerAnim } from '../core/player';
import type { Camera } from './camera';
import {
  type SpriteAction,
  type SpritePalette,
  type SheetSet,
  drawFrame,
  frameArtLiftPixels,
} from './sprites';

/** A sampled point inside one 24-frame action. */
export interface Playhead {
  action: SpriteAction;
  /** The single authored frame to draw, zero-based. */
  frame: number;
  /** Continuous position in the sheet, for diagnostics and easing. */
  frameFloat: number;
}

/**
 * Per-display-frame render diagnostics.
 *
 * `playerBodyDraws` is the number that matters: the old renderer drew two full
 * bodies per player and blended them with complementary alpha, which is a
 * double exposure, not interpolation. With several players close together that
 * is four, six or more overlapping silhouettes — the ghosting in the rejected
 * screenshot. The visual QA asserts this never exceeds one.
 */
export const renderStats = {
  playerBodyDraws: new Map<number, number>(),
  /** Highest body-draw count seen for any single player, since the last reset. */
  maxBodyDrawsPerPlayer: 0,
};

/** Called once per display frame, before any player is drawn. */
export function beginRenderFrame(): void {
  renderStats.playerBodyDraws.clear();
}

function countBodyDraw(playerId: number): void {
  const n = (renderStats.playerBodyDraws.get(playerId) ?? 0) + 1;
  renderStats.playerBodyDraws.set(playerId, n);
  if (n > renderStats.maxBodyDrawsPerPlayer) renderStats.maxBodyDrawsPerPlayer = n;
}

/** Reset the high-water mark; the QA harness calls this between scenarios. */
export function resetRenderStats(): void {
  renderStats.playerBodyDraws.clear();
  renderStats.maxBodyDrawsPerPlayer = 0;
}

export interface SpriteRenderStyle {
  palette?: SpritePalette | string;
  /** Stable height variation for role and player identity. */
  heightScale?: number;
  /** Stable build variation; 1 is the authored silhouette. */
  widthScale?: number;
  alpha?: number;
}

/**
 * How long each action's 24 frames are meant to take, in simulation seconds.
 *
 * These are consumed on the simulation's clock, not the wall clock, so the
 * time an action actually occupies on screen is this divided by GAME_SPEED.
 * They are chosen so that those on-screen durations land inside the brief's
 * readability budget: roughly 2.4 s for the idle loop, 0.85 s for a shuffle
 * cycle, 1.05 s for a block, and 1.8 s for a full jump serve. The point of the
 * budget is that preparation, contact and recovery are separately legible.
 */
export const DURATION: Record<SpriteAction, number> = {
  idle: 1.95,
  approach: 0.7,
  spike: 0.98,
  block: 0.86,
  bump: 0.72,
  set: 0.76,
  dive: 1.24,
  serve: 1.4,
  jumpServe: 1.48,
  celebrate: 1.48,
};

/**
 * Ground speed, in m/s, at which the locomotion cycle plays at its authored
 * rate. Roughly a committed attack approach; anything slower plays slower.
 */
const LOCOMOTION_REFERENCE_SPEED = 5.2;

/** Actions that hold on their last frame rather than looping. */
const ONESHOT = new Set<SpriteAction>([
  'spike',
  'block',
  'bump',
  'set',
  'dive',
  'serve',
  'jumpServe',
]);

/** Frame on which the simulated contact must appear in the drawing. */
export const CONTACT_FRAME: Partial<Record<SpriteAction, number>> = {
  spike: 19,
  block: 16,
  bump: 12,
  set: 11,
  dive: 13,
  serve: 12,
  jumpServe: 16,
};

interface Head {
  action: SpriteAction;
  t: number;
  /** Keep playing this action through its recovery after a contact. */
  forced: boolean;
  /** The first draw after a contact is the exact authored frame. */
  exactFrame?: number;
}

/** The sheet that represents a physical contact event. */
export function spriteActionForContact(
  kind: ContactKind,
  airborne: boolean,
): SpriteAction | null {
  switch (kind) {
    case 'serve':
      return airborne ? 'jumpServe' : 'serve';
    case 'save':
      return 'dive';
    case 'block':
      return 'block';
    case 'set':
      return 'set';
    case 'bump':
      return 'bump';
    case 'spike':
    case 'tip':
    case 'power':
      return 'spike';
    default:
      return null;
  }
}

function actionFromPlayerAnim(anim: PlayerAnim): SpriteAction {
  switch (anim) {
    case 'run':
    case 'shuffle':
    case 'approach_run':
      return 'approach';
    case 'jump_rise':
    case 'air_contact_spike':
    case 'follow_through':
    case 'plant':
    case 'spike':
      return 'spike';
    case 'air_contact_block':
      return 'block';
    case 'air_contact_jump_serve':
      return 'jumpServe';
    case 'bump_ready':
    case 'bump_contact':
    case 'bump':
      return 'bump';
    case 'set_ready':
    case 'set_contact':
    case 'set':
      return 'set';
    case 'serve_toss':
    case 'serve_contact':
    case 'serve':
      return 'serve';
    case 'ready':
      return 'idle';
    default:
      return 'idle';
  }
}


function actionFor(p: Player): SpriteAction {
  if (p.diving || p.anim === 'down' || p.anim === 'getUp') return 'dive';
  if (p.anim === 'cheer') return 'celebrate';
  if (p.anim === 'block') return 'block';
  if (p.anim === 'serve') return 'serve';
  if (p.anim === 'set') return 'set';
  if (p.anim === 'bump') return 'bump';
  if (p.anim === 'run' || p.anim === 'approach_run' || p.anim === 'shuffle') return 'approach';

  if (p.anim === 'bump_ready' || p.anim === 'bump_contact') return 'bump';
  if (p.anim === 'set_ready' || p.anim === 'set_contact') return 'set';
  if (p.anim === 'air_contact_spike') return 'spike';
  if (p.anim === 'air_contact_block') return 'block';
  if (p.anim === 'air_contact_jump_serve') return 'jumpServe';
  if (p.anim === 'serve_toss') return 'serve';
  if (p.anim === 'serve_contact') return p.airborne ? 'jumpServe' : 'serve';
  if (p.anim === 'jump_rise' || p.anim === 'follow_through' || p.anim === 'plant' || p.anim === 'jump') return 'spike';
  if (p.anim === 'spike' || (p.airborne && p.swing > 0)) return 'spike';
  if (p.airborne) return 'spike';

  const mapped = actionFromPlayerAnim(p.anim);
  if (mapped !== 'idle') return mapped;
  if (Math.hypot(p.vel.x, p.vel.y) > 0.9) return 'approach';
  return 'idle';
}

/**
 * Pick the one authored frame to draw.
 *
 * Nearest-frame rather than floor: rounding centres each drawing on its own
 * slice of time, which halves the worst-case timing error against the
 * simulation and costs nothing. There is deliberately no blend — a sprite sheet
 * of hand-authored poses has no meaningful in-between, and pretending otherwise
 * by cross-fading two whole bodies is what produced the ghosting.
 */
function sampleAt(action: SpriteAction, t: number): Playhead {
  const span = DURATION[action];
  const u = ONESHOT.has(action) ? clamp(t / span, 0, 0.999999) : ((t / span) % 1 + 1) % 1;
  const frameFloat = u * 24;
  const frame = ONESHOT.has(action)
    ? Math.min(23, Math.round(frameFloat))
    : Math.round(frameFloat) % 24;
  return { action, frame, frameFloat };
}

/** Stateful sprite clock, independent from rendering and therefore testable. */
export class SpriteTimeline {
  private readonly heads = new Map<number, Head>();

  /** Pin the player's next rendered pose to the authored contact. */
  cue(playerId: number, kind: ContactKind, airborne: boolean): void {
    const action = spriteActionForContact(kind, airborne);
    if (!action) return;
    const frame = CONTACT_FRAME[action];
    if (frame === undefined) return;
    this.heads.set(playerId, {
      action,
      t: ((frame + 0.5) / 24) * DURATION[action],
      forced: true,
      exactFrame: frame,
    });
  }

  reset(playerId?: number): void {
    if (playerId === undefined) this.heads.clear();
    else this.heads.delete(playerId);
  }

  frameFor(p: Player, dt: number, actionHint?: SpriteAction): Playhead {
    const observed = actionHint ?? actionFor(p);
    let h = this.heads.get(p.id);
    if (!h) {
      h = { action: observed, t: 0, forced: false };
      this.heads.set(p.id, h);
    }

    if (h.exactFrame !== undefined) {
      const frame = h.exactFrame;
      delete h.exactFrame;
      return { action: h.action, frame, frameFloat: frame };
    }

    if (h.forced) {
      h.t += dt;
      const sample = sampleAt(h.action, h.t);
      if (h.t >= DURATION[h.action]) h.forced = false;
      return sample;
    }

    if (h.action !== observed) {
      h.action = observed;
      h.t = 0;
    } else {
      h.t += dt;
    }
    return sampleAt(h.action, h.t);
  }
}

const timeline = new SpriteTimeline();

/** Called by the renderer on the simulation's exact contact event. */
export function cueSpriteContact(
  playerId: number,
  kind: ContactKind,
  airborne: boolean,
): void {
  timeline.cue(playerId, kind, airborne);
}

/**
 * Draw a player from sprites, if a sheet for their current action exists.
 * Returns false when it does not, so the caller can fall back.
 */
export function drawSpritePlayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  sheets: SheetSet,
  dt: number,
  style: SpriteRenderStyle = {},
  actionHint?: SpriteAction,
): boolean {
  // There is one authored locomotion cycle, and it has to serve a shuffle, a
  // run and an attack approach alike. Playing it at a fixed rate is what made
  // a player adjusting their feet look like one sprinting: the legs were
  // always going at the same speed regardless of how fast the body moved.
  // Scaling playback by actual ground speed costs nothing and is most of the
  // difference between the three reading as different things.
  const inLocomotion = p.presentation.action === 'none' && !p.airborne && !p.diving;
  const strideScale = inLocomotion
    ? clamp(Math.hypot(p.vel.x, p.vel.y) / LOCOMOTION_REFERENCE_SPEED, 0.42, 1.3)
    : 1;
  const head = timeline.frameFor(p, dt * strideScale, actionHint);
  const sheet = sheets[head.action];
  if (!sheet) return false;

  const floor = cam.projectFloor(p.pos.x, p.pos.y);
  const heightScale = style.heightScale ?? 1;
  const widthScale = style.widthScale ?? 1;
  const bodyPx = 1.9 * floor.scale * 42 * heightScale;
  if (bodyPx < 6) return true;

  // Authored sheets already lift the feet inside their 512 px cell. The old
  // renderer responded by ignoring the simulation's height entirely for jump
  // actions, which made a real block or spike appear planted on the floor.
  // Add only the physical lift not already present in the drawn frame.
  const authoredLift = frameArtLiftPixels(sheet, head.frame, bodyPx);
  const worldUnitPx = Math.max(1, floor.scale * 42);
  const lift = Math.max(0, p.height - authoredLift / worldUnitPx);
  const anchor = cam.project(p.pos.x, p.pos.y, lift);

  ctx.save();
  const depthAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  const baseAlpha = depthAlpha * (style.alpha ?? 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Exactly one body, always. Position, height and scale are what interpolate
  // between frames; the silhouette itself never does.
  ctx.globalAlpha = baseAlpha;
  drawFrame(
    ctx,
    sheet,
    head.frame,
    anchor.x,
    anchor.y,
    bodyPx,
    p.facing >= 0 ? 1 : -1,
    style.palette,
    widthScale,
  );
  countBodyDraw(p.id);
  ctx.restore();
  return true;
}

/** Where in a sheet's timeline the ball is struck. Zero-based. */
export function contactFrame(action: SpriteAction): number {
  return CONTACT_FRAME[action] ?? 12;
}
