import { clamp } from '../core/math3';
import type { ContactKind } from '../core/contact';
import type { Player } from '../core/player';
import type { Camera } from './camera';
import {
  type SpriteAction,
  type SpritePalette,
  type SheetSet,
  drawFrame,
  frameArtLiftPixels,
} from './sprites';

/** A smoothly sampled point inside one 24-frame action. */
export interface Playhead {
  action: SpriteAction;
  /** Current authored frame, zero-based. */
  frame: number;
  /** Following frame, or the same frame at the end of a one-shot. */
  nextFrame: number;
  /** Eased blend from frame to nextFrame. */
  mix: number;
}

export interface SpriteRenderStyle {
  palette?: SpritePalette | string;
  /** Stable height variation for role and player identity. */
  heightScale?: number;
  /** Stable build variation; 1 is the authored silhouette. */
  widthScale?: number;
  alpha?: number;
}

/** How long each action's 24 frames are meant to take, in seconds. */
export const DURATION: Record<SpriteAction, number> = {
  idle: 1.9,
  approach: 0.86,
  spike: 1.12,
  block: 1.02,
  bump: 0.9,
  set: 0.94,
  dive: 1.34,
  serve: 1.62,
  jumpServe: 1.55,
  celebrate: 1.7,
};

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

function actionFor(p: Player): SpriteAction {
  if (p.diving || p.anim === 'down' || p.anim === 'getUp') return 'dive';
  if (p.anim === 'cheer') return 'celebrate';
  if (p.anim === 'block') return 'block';
  if (p.anim === 'serve') return 'serve';
  if (p.anim === 'set') return 'set';
  if (p.anim === 'bump') return 'bump';
  if (p.anim === 'spike' || (p.airborne && p.swing > 0)) return 'spike';
  if (p.airborne) return 'spike';
  if (Math.hypot(p.vel.x, p.vel.y) > 0.9) return 'approach';
  return 'idle';
}

const smoothstep = (v: number): number => v * v * (3 - 2 * v);

function sampleAt(action: SpriteAction, t: number): Playhead {
  const span = DURATION[action];
  const u = ONESHOT.has(action) ? clamp(t / span, 0, 0.999999) : ((t / span) % 1 + 1) % 1;
  const raw = u * 24;
  const frame = Math.min(23, Math.floor(raw));
  const nextFrame = ONESHOT.has(action) ? Math.min(23, frame + 1) : (frame + 1) % 24;
  const fraction = raw - frame;
  // Hold the authored drawing for the first third, then dissolve into the next.
  // This removes the hard 15–24 fps step without turning every body into two
  // equally visible ghosts for the whole interval.
  const mix = nextFrame === frame ? 0 : smoothstep(clamp((fraction - 0.32) / 0.68, 0, 1));
  return { action, frame, nextFrame, mix };
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
      return { action: h.action, frame, nextFrame: frame, mix: 0 };
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
  const head = timeline.frameFor(p, dt, actionHint);
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
  // Add only the physical lift not already present in the two blended frames.
  const authoredLift =
    frameArtLiftPixels(sheet, head.frame, bodyPx) * (1 - head.mix) +
    frameArtLiftPixels(sheet, head.nextFrame, bodyPx) * head.mix;
  const worldUnitPx = Math.max(1, floor.scale * 42);
  const lift = Math.max(0, p.height - authoredLift / worldUnitPx);
  const anchor = cam.project(p.pos.x, p.pos.y, lift);

  ctx.save();
  const depthAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  const baseAlpha = depthAlpha * (style.alpha ?? 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (head.mix <= 0.001 || head.nextFrame === head.frame) {
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
  } else {
    ctx.globalAlpha = baseAlpha * (1 - head.mix);
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
    ctx.globalAlpha = baseAlpha * head.mix;
    drawFrame(
      ctx,
      sheet,
      head.nextFrame,
      anchor.x,
      anchor.y,
      bodyPx,
      p.facing >= 0 ? 1 : -1,
      style.palette,
      widthScale,
    );
  }
  ctx.restore();
  return true;
}

/** Where in a sheet's timeline the ball is struck. Zero-based. */
export function contactFrame(action: SpriteAction): number {
  return CONTACT_FRAME[action] ?? 12;
}
