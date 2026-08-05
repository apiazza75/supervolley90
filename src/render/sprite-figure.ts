import { clamp } from '../core/math3';
import type { ContactKind } from '../core/contact';
import type { Player } from '../core/player';
import type { Camera } from './camera';
import { type SpriteAction, type SheetSet, drawFrame } from './sprites';

/** A selected frame from one action sheet. */
export interface Playhead {
  action: SpriteAction;
  /** Zero-based, 0..23. */
  frame: number;
}

/** How long each action's 24 frames are meant to take, in seconds. */
export const DURATION: Record<SpriteAction, number> = {
  idle: 1.6,
  approach: 0.75,
  spike: 1.1,
  block: 1.0,
  bump: 0.85,
  set: 0.9,
  dive: 1.3,
  serve: 1.6,
  jumpServe: 1.5,
  celebrate: 1.6,
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

/**
 * Frame on which the simulated contact must appear in the drawing.
 * Values are zero-based; docs/ART-SPEC.md lists the human-facing
 * one-based numbers.
 */
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

function frameAt(action: SpriteAction, t: number): number {
  const span = DURATION[action];
  const u = ONESHOT.has(action) ? clamp(t / span, 0, 0.999) : (t / span) % 1;
  return Math.floor(u * 24);
}

/**
 * Stateful sprite clock, deliberately independent from rendering.
 * This makes contact alignment testable without a canvas.
 */
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
      // Start in the middle of the contact frame so floating-point
      // rounding cannot send the following draw backwards.
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
      return { action: h.action, frame };
    }

    if (h.forced) {
      h.t += dt;
      const frame = frameAt(h.action, h.t);
      if (h.t >= DURATION[h.action]) h.forced = false;
      return { action: h.action, frame };
    }

    if (h.action !== observed) {
      h.action = observed;
      h.t = 0;
    } else {
      h.t += dt;
    }
    return { action: h.action, frame: frameAt(h.action, h.t) };
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
  kit?: string,
  actionHint?: SpriteAction,
): boolean {
  const head = timeline.frameFor(p, dt, actionHint);
  const sheet = sheets[head.action];
  if (!sheet) return false;

  // The art of a jumping action already contains the lift, so the
  // sprite is planted on the floor and the drawing does the rising.
  const lift = sheet.layout.artHasLift ? 0 : p.height;
  const feet = cam.project(p.pos.x, p.pos.y, lift);
  const bodyPx = 1.9 * feet.scale * 42;
  if (bodyPx < 6) return true;

  ctx.save();
  ctx.globalAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  drawFrame(ctx, sheet, head.frame, feet.x, feet.y, bodyPx, p.facing >= 0 ? 1 : -1, kit);
  ctx.restore();
  return true;
}

/** Where in a sheet's timeline the ball is struck. Zero-based. */
export function contactFrame(action: SpriteAction): number {
  return CONTACT_FRAME[action] ?? 12;
}
