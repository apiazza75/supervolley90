import { clamp } from '../core/math3';
import { Player } from '../core/player';
import { Camera } from './camera';
import { SpriteAction, SheetSet, drawFrame } from './sprites';

/**
 * Choosing a frame.
 *
 * The simulation already knows everything needed: which action a player is in,
 * how far through it they are, how high off the floor. This maps that onto the
 * 24 drawn frames of the matching sheet. Nothing here interpolates — drawn
 * animation is played, not blended, and trying to blend between two drawings
 * is how sprite work is ruined.
 */

interface Playhead {
  action: SpriteAction;
  /** 0..23. */
  frame: number;
}

/** How long each action's 24 frames are meant to take, in seconds. */
const DURATION: Record<SpriteAction, number> = {
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
const ONESHOT: SpriteAction[] = ['spike', 'block', 'bump', 'set', 'dive', 'serve', 'jumpServe'];

/**
 * The frame of a sheet at which the ball is actually struck.
 *
 * The simulation decides when a contact happens; the art has its own moment.
 * Lining the two up is what makes a sprite hit look like it caused the ball to
 * move rather than waving at it afterwards, so the playhead is driven BACKWARDS
 * from the contact: at the instant of the strike the sprite is on this frame.
 */
const CONTACT_FRAME: Partial<Record<SpriteAction, number>> = {
  spike: 19,
  block: 16,
  bump: 12,
  set: 11,
  dive: 13,
  serve: 12,
  jumpServe: 16,
};

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

const heads = new Map<number, { action: SpriteAction; t: number }>();

function advance(p: Player, dt: number): Playhead {
  const action = actionFor(p);
  let h = heads.get(p.id);
  if (!h || h.action !== action) {
    h = { action, t: 0 };
    heads.set(p.id, h);
  } else {
    h.t += dt;
  }

  const span = DURATION[action];
  const u = ONESHOT.includes(action)
    ? clamp(h.t / span, 0, 0.999)
    : (h.t / span) % 1;
  return { action, frame: Math.floor(u * 24) };
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
): boolean {
  const head = advance(p, dt);
  const sheet = sheets[head.action];
  if (!sheet) return false;

  // The art of a jumping action already contains the lift, so the sprite is
  // planted on the floor and the drawing does the rising. Everything else is
  // lifted by the simulation.
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

/** Where in a sheet's timeline the ball is struck, for lining art up to play. */
export function contactFrame(action: SpriteAction): number {
  return CONTACT_FRAME[action] ?? 12;
}
