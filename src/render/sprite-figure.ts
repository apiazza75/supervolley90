import { clamp } from '../core/math3';
import { JUMP_SERVE_FIRST_STEP, JUMP_SERVE_TOSS_PALMS, JUMP_SERVE_RISE_FRAMES } from './jump-serve-entry';
import { serveTossPoses, SERVE_CHARGE_RELEASE_PALMS } from './serve-charge-release';
import { BLOCK_LANDING_FRAMES } from './block-landing';
import { blockDescentFrame } from './block-descent';
import { diveRenderHeight } from './dive-takeoff';
import { DiveTurn } from './dive-turn';
import { bumpPreparationFrame, type BumpPreparationOrigin } from './bump-preparation';
import { FacingTransition, PIVOT_DURATION } from './facing-transition';
import { plantedTurnFrame, stoppingTurnFrame, standingTurnPose } from './turn-playback';
import { PreparationRelease } from './preparation-release';
import { ShuffleSettle } from './shuffle-settle';
import { isDefensiveRetreat } from './defensive-retreat';
import { RunBrake, RUN_BRAKE_DURATION } from './run-brake';
import { RUN_STRIDE_FRAMES, runLegacyFrame, runPhaseAtTime, runTimeAtPhase } from './run-stride';
export { RUN_STRIDE_FRAMES } from './run-stride';
import { BackpedalSettle } from './backpedal-settle';
import { WalkRelease } from './walk-release';
import { BackwardDeparture } from './backward-departure';
import { ReadyRetreat, readyFootworkOrigin } from './ready-retreat';
import { APPROACH_RUN_FRAMES, APPROACH_PLANT_FRAMES } from './approach-steps';
import { STANDING_SERVE_SWING_FRAMES, STANDING_SERVE_FOLLOW_FRAMES, STANDING_SERVE_TOSS_RELEASE_FRAMES } from './serve-swing';
import { setPreparationFrame } from './set-gather';
import { COURT_HALF_LENGTH, DIVE_EXTENSION_TIME, GRAVITY, attackDir } from '../core/rules';
import type { ContactKind } from '../core/contact';
import type { ActionPhase, Locomotion } from '../core/presentation';
import { RUN_SPEED_THRESHOLD, RUN_GAIT_HYSTERESIS, BLOCK_PREPARATION_TIME, keepsNetReadyPosture } from '../core/presentation';
import type { Player, PlayerAnim } from '../core/player';
import type { Camera } from './camera';
import {
  type SpriteAction,
  type SpritePalette,
  type SheetSet,
  drawFrame,
  frameArtLiftPixels,
  SHEETS,
} from './sprites';

/** A sampled point inside one 24-frame action. */
export interface Playhead {
  action: SpriteAction;
  /** The single authored frame to draw, zero-based. */
  frame: number;
  /** Continuous position in the sheet, for diagnostics and easing. */
  frameFloat: number;
  /** A contact owns its orientation until the illustrated recovery finishes. */
  facing?: -1 | 1;
}

/** Actual service state, supplied only for the player currently serving. */
export interface ServeSpriteState {
  holding: boolean;
  holdSeconds: number;
  tossElapsed: number;
  jumping: boolean;
  tossGestureProgress?: number;
  runupProgress?: number;
  standingSwingProgress?: number;
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
  /** Number of player bodies drawn through the old vector fallback in the current frame. */
  vectorFallbackDraws: 0,
  /** Highest vector fallback count seen in any frame since the last reset. */
  maxVectorFallbackDrawsPerFrame: 0,
};

export interface SpriteDrawDiagnostics {
  playerId: number;
  locomotion: Locomotion;
  action: SpriteAction;
  frame: number;
  /** Actual orientation used to draw the single raster body. */
  facing: -1 | 1;
  /** Height of the interpolated render body, not the previous physics tick. */
  renderedHeight: number;
  /** Top of the actual drawn silhouette, in canvas logical pixels. */
  screenTop: number;
  /** Legacy phase markers only. NOT measurements of the illustrated feet. */
  farFootSign: -1 | 0 | 1;
  /** Legacy phase markers only. NOT measurements of the illustrated feet. */
  nearFootSign: -1 | 0 | 1;
  /** Legacy nominal gait amplitude, not measured from the raster. */
  stride: number;
}

const spriteDrawDiagnostics = new Map<number, SpriteDrawDiagnostics>();

export function playerSpriteDiagnostics(): SpriteDrawDiagnostics[] {
  return [...spriteDrawDiagnostics.values()];
}

/** Reuse the rendered sample; asking the timeline again would advance it twice. */
export function playerSpriteScreenTop(playerId: number): number | undefined {
  return spriteDrawDiagnostics.get(playerId)?.screenTop;
}

/** Called once per display frame, before any player is drawn. */
export function beginRenderFrame(): void {
  renderStats.playerBodyDraws.clear();
  renderStats.vectorFallbackDraws = 0;
  // Diagnostics describe this display frame, not every player ever seen.
  // Replay uses ids +1000 and substitutions also retire ids; retaining those
  // entries made a normal twelve-player scene look incomplete/duplicated.
  // Badges and replay capture read the new samples after the bodies are drawn.
  spriteDrawDiagnostics.clear();
}

function countBodyDraw(playerId: number): void {
  const n = (renderStats.playerBodyDraws.get(playerId) ?? 0) + 1;
  renderStats.playerBodyDraws.set(playerId, n);
  if (n > renderStats.maxBodyDrawsPerPlayer) renderStats.maxBodyDrawsPerPlayer = n;
}

export function countVectorFallbackDraw(): void {
  renderStats.vectorFallbackDraws++;
  if (renderStats.vectorFallbackDraws > renderStats.maxVectorFallbackDrawsPerFrame) {
    renderStats.maxVectorFallbackDrawsPerFrame = renderStats.vectorFallbackDraws;
  }
}

/** Reset the high-water mark; the QA harness calls this between scenarios. */
export function resetRenderStats(): void {
  renderStats.playerBodyDraws.clear();
  renderStats.maxBodyDrawsPerPlayer = 0;
  renderStats.vectorFallbackDraws = 0;
  renderStats.maxVectorFallbackDrawsPerFrame = 0;
  spriteDrawDiagnostics.clear();
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
 * Locomotion also uses its own speed reference below. For example, at
 * GAME_SPEED=.58 a normal walk completes a two-step cycle in about 1.24 s.
 * Preparation, contact and recovery must remain separately legible.
 */
export const DURATION: Record<SpriteAction, number> = {
  idle: 2.2,
  walk: 0.72,
  shuffle: 0.54,
  backpedal: 0.64,
  // 24 authored poses need at least 24 display opportunities.  The previous
  // 0.22 s run override advanced at ~109 atlas fps, so a 60 Hz display skipped
  // almost half the drawings and made the gait look like missing frames.
  run: 0.64,
  approach: 0.70,
  spike: 0.98,
  spikeFollow: 0.8,
  block: 1.05,
  bump: 0.72,
  set: 0.76,
  backSet: 0.76,
  turn: PIVOT_DURATION,
  runTurn: PIVOT_DURATION,
  turnStop: PIVOT_DURATION,
  runBrake: RUN_BRAKE_DURATION * 2,
  dive: 1.24,
  serve: 1.4,
  jumpServe: 1.72,
  jumpServeFollow: 0.8,
  celebrate: 1.20,
};

/**
 * Ground speed, in m/s, at which each locomotion cycle plays at its authored
 * rate. Walking must not use the much faster attack-approach reference.
 */
export function locomotionPlaybackScale(action: SpriteAction, speed: number): number {
  // One low step-together covers about .59 m. Unlike the walk's cadence
  // floor, this must stop advancing when a defender's actual feet stop.
  // Even the maximum stays below 60 drawn poses/s at GAME_SPEED=.58.
  if (action === 'shuffle') return clamp(speed / 1.1, 0, 2.2);
  if (action === 'backpedal') return clamp(speed / 2.4, 0, 1.5);
  // A full two-step walk travels about .90 m; a run cycle about 2.37 m.
  // Using the 5.2 m/s approach reference for walks reduced their drawings to
  // 4.5 fps at GAME_SPEED=.58, even on a perfectly smooth 60 Hz display.
  const reference = action === 'walk' ? 1.25 : action === 'run' ? 3.7 : 5.2;
  return clamp(speed / reference, 0.65, 1.5);
}

/** Actions that hold on their last frame rather than looping. */
const ONESHOT = new Set<SpriteAction>([
  'approach',
  'spike',
  'spikeFollow',
  'block',
  'bump',
  'set',
  'backSet',
  'turn',
  'runTurn',
  'turnStop',
  'runBrake',
  'dive',
  'serve',
  'jumpServe',
  'jumpServeFollow',
  'celebrate',
]);

function locomotionAction(locomotion: Locomotion | undefined, p?: Player, bodyFacing?: number, retreating = false): SpriteAction | null {
  if (p && isDefensiveRetreat(p, bodyFacing, retreating)) return 'backpedal';
  switch (locomotion) {
    case 'walk':
    case 'shuffle':
      // The sideline does not change a live ready step into an upright walk.
      // Keep that posture through pin coverage outside the court as well.
      // Returning from the service zone still uses the upright walk.
      if (p && (Math.abs(p.pos.y) <= COURT_HALF_LENGTH
          || p.presentation?.sourceJob === 'receive' || p.presentation?.sourceJob === 'set')
          && p.presentation?.sourceJob !== undefined
          && p.presentation.sourceJob !== 'idle' && p.presentation.sourceJob !== 'serve') return 'shuffle';
      return 'walk';
    case 'run':
      // Crossing a coverage lane is still lateral footwork, even when a
      // separation correction briefly crosses the scalar running threshold.
      // A forward-run silhouette here inserts a knee lift between two ready
      // steps. Pursuit and genuinely forward travel keep the running art.
      if (p?.locomotionIntent && keepsNetReadyPosture(p.presentation)
          && (bodyFacing ?? p.facing) === attackDir(p.side)) {
        // Older recorded bodies have no command observation: honour their
        // authored gait rather than guessing intent from residual velocity.
        const direction = p.locomotionIntent;
        if (Math.abs(direction.x) > Math.abs(direction.y)) return 'shuffle';
      }
      return 'run';
    case 'approach':
      return 'approach';
    default:
      return null;
  }
}

/** Frame on which the simulated contact must appear in the drawing. */
export const CONTACT_FRAME: Partial<Record<SpriteAction, number>> = {
  // These are the authored HAND-ON-BALL drawings, not the first recovery
  // drawing after them.  The previous indices were one frame late for the
  // three overhand swings, so the ball changed direction beside an arm that
  // was already coming down.
  spike: 18,
  block: 16,
  bump: 9,
  set: 9,
  backSet: 9,
  dive: 9,
  serve: 15,
  jumpServe: 18,
};

/**
 * Hand/platform landmarks in the original 512px contact cell. Re-reviewed
 * with tools/inspect-sprite-proportions.ts after the set/bump redraw. Convert
 * through the SAME whole-figure scale, identity and depth as the raster; the
 * old world-space constants drifted whenever the art was replaced/resized.
 */
export const SPRITE_CONTACT_PIXELS: Partial<Record<SpriteAction, { x: number; y: number }>> = {
  bump: { x: 365, y: 240 },
  set: { x: 350, y: 58 },
  backSet: { x: 345, y: 64 },
  spike: { x: 400, y: 22 },
  block: { x: 348, y: 55 },
  dive: { x: 425, y: 385 },
  serve: { x: 340, y: 35 },
  jumpServe: { x: 365, y: 116 },
};

/** Reviewed left-palm centres in the new preparation/toss drawings. */
export const SERVE_PALM_PIXELS = {
  serve: [{ x: 366, y: 213 }, { x: 369, y: 244 }, { x: 373, y: 244 },
    { x: 386, y: 234 }, { x: 404, y: 135 }, { x: 380, y: 83 }, { x: 395, y: 64 }],
  jumpServe: [{ x: 372, y: 189 }, { x: 396, y: 92 }, { x: 382, y: 37 }, { x: 395, y: 31 }],
} as const;

export function spriteServePalmPoint(p: Player, state: ServeSpriteState, sheets?: SheetSet,
  style: SpriteRenderStyle = {}, depthScale = 1): { x: number; y: number; z: number } {
  const sample = serveFrameForPlayer(p, state);
  const action = sample.action as 'serve' | 'jumpServe';
  const anchor = (action === 'jumpServe' ? JUMP_SERVE_TOSS_PALMS[sample.frame] : SERVE_CHARGE_RELEASE_PALMS[sample.frame])
    ?? SERVE_PALM_PIXELS[action][sample.frame];
  return spritePointForFrame(p, action, sample.frame, anchor, sheets, style, depthScale);
}

export function spriteContactPoint(
  p: Player,
  kind: ContactKind,
  airborne: boolean,
  sheets?: SheetSet,
  style: SpriteRenderStyle = {},
  depthScale = 1,
  facing = p.facing,
  backSet = false,
): { x: number; y: number; z: number } {
  const action = spriteActionForContact(kind, airborne, backSet);
  const anchor = action ? SPRITE_CONTACT_PIXELS[action] : undefined;
  if (!action || !anchor) return { x: p.pos.x, y: p.pos.y, z: p.height + 1.2 };
  return spritePointForFrame(p, action, CONTACT_FRAME[action] ?? 0, anchor, sheets, style, depthScale, facing);
}

function spritePointForFrame(p: Player, action: SpriteAction, index: number,
  anchor: { x: number; y: number } | undefined, sheets: SheetSet | undefined,
  style: SpriteRenderStyle, depthScale: number, orientation = p.facing): { x: number; y: number; z: number } {
  if (!anchor) return { x: p.pos.x, y: p.pos.y, z: p.height + 1.2 };
  const sheet = sheets?.[action];
  const frame = sheet?.frames[index];
  const sourceHeight = SHEETS[action].nativeBodyHeight!;
  const packedScale = sheet?.nativeBodyHeight ? sheet.nativeBodyHeight / sourceHeight : 1;
  const bodyHeight = sheet?.nativeBodyHeight ?? sourceHeight;
  const rootX = frame?.footX ?? 256;
  const rootY = frame?.footY ?? 470;
  const units = 1.9 * (style.heightScale ?? 1) / bodyHeight;
  const forward = (anchor.x * packedScale - rootX) * units * (style.widthScale ?? 1) * depthScale;
  const handHeight = (rootY - anchor.y * packedScale) * units * depthScale;
  const authoredLift = frame ? Math.max(0, frame.footY - frame.boxBottom) * units : 0;
  const physicalLift = Math.max(0, (action === 'dive' ? diveRenderHeight(p) : p.height) - authoredLift);
  const facing = orientation >= 0 ? 1 : -1;
  return {
    x: p.pos.x,
    y: p.pos.y + facing * forward,
    z: Math.max(0.25, handHeight + physicalLift),
  };
}

interface Head {
  action: SpriteAction;
  t: number;
  /** Keep playing this action through its recovery after a contact. */
  forced: boolean;
  /** The first draw after a contact is the exact authored frame. */
  exactFrame?: number;
  landingTime?: number;
  /** Physical flight remaining at contact, not a second jump clock. */
  followFlightDuration?: number;
  contactFacing?: -1 | 1;
  /** Confirm only a slow start from planted feet, never an ongoing stride. */
  stepStartAge?: number;
  setRestAge?: number;
  /** Only a shallow lateral-to-backwards request needs directional confirmation. */
  retreatEntryAge?: number;
  /** Pose inputs at the terminal contact paint, for an unchanged pause redraw. */
  completedContactState?: string;
}

function contactCompletionState(p: Player, observed: SpriteAction): string {
  return [observed, p.anim, p.animTime, p.facing, p.pos.x, p.pos.y, p.height,
    p.vel.x, p.vel.y, p.vertVel, p.airborne, p.diving, p.downTime, p.gettingUp,
    p.presentation?.action, p.presentation?.phase, p.presentation?.locomotion,
    p.presentation?.sourceJob].join('/');
}

/** The sheet that represents a physical contact event. */
export function spriteActionForContact(
  kind: ContactKind,
  airborne: boolean,
  backSet = false,
): SpriteAction | null {
  switch (kind) {
    case 'serve':
      return airborne ? 'jumpServe' : 'serve';
    case 'save':
      return 'dive';
    case 'block':
      return 'block';
    case 'set':
      return backSet ? 'backSet' : 'set';
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
      return 'run';
    case 'approach_run':
      return 'approach';
    case 'shuffle':
      return 'walk';
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


function actionFor(p: Player, bodyFacing?: number, retreating = false): SpriteAction {
  const presentationAction = p.presentation?.action;
  const locomotion = p.presentation?.locomotion;
  if (preparingBlock(p)) return 'block';
  if (presentationAction === 'jumpServe') return 'jumpServe';
  if (
    presentationAction === 'none' &&
    !p.airborne &&
    !p.diving &&
    (locomotion === 'walk' || locomotion === 'shuffle' || locomotion === 'run' || locomotion === 'approach')
  ) {
    return locomotionAction(locomotion, p, bodyFacing, retreating) ?? 'idle';
  }

  if (p.diving || p.anim === 'down' || p.anim === 'getUp') return 'dive';
  if (p.anim === 'cheer') return 'celebrate';
  // The physical animation can retain `shuffle` for one settling tick after
  // locomotion is already ready. Do not insert a lateral pose into that stop.
  if (presentationAction === 'none' && locomotion === 'ready' && !p.airborne
      && p.height <= 0 && (p.anim === 'shuffle' || p.anim === 'run')) return 'idle';
  if (p.anim === 'block') return 'block';
  if (p.anim === 'land' && presentationAction === 'block') return 'block';
  if (p.anim === 'land' && presentationAction === 'spike') return 'spike';
  if (p.anim === 'serve') return 'serve';
  if (p.anim === 'set') return 'set';
  if (p.anim === 'bump') return 'bump';
  if (p.anim === 'run') return locomotionAction(locomotion, p, bodyFacing, retreating) ?? 'run';
  if (p.anim === 'approach_run') return 'approach';
  if (p.anim === 'shuffle') return locomotionAction('shuffle', p, bodyFacing, retreating) ?? 'walk';

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
  if (Math.hypot(p.vel.x, p.vel.y) > 0.9) return 'run';
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
  if (action === 'bump' && t >= CONTACT_FRAME.bump! / 24 * DURATION.bump) return bumpFollowFrame(t);
  if (action === 'set' && t >= CONTACT_FRAME.set! / 24 * DURATION.set) return setFollowFrame(t);
  if (action === 'backSet' && t >= CONTACT_FRAME.backSet! / 24 * DURATION.backSet) return backSetFollowFrame(t);
  if (action === 'serve' && t >= CONTACT_FRAME.serve! / 24 * DURATION.serve) return standingServeFollowFrame(t);
  if (action === 'celebrate') return sampleFrameWindow(action, CELEBRATE_FRAMES, t, DURATION[action]);
  const span = DURATION[action];
  const u = ONESHOT.has(action) ? clamp(t / span, 0, 0.999999) : ((t / span) % 1 + 1) % 1;
  const frameFloat = u * 24;
  const frame = ONESHOT.has(action)
    ? Math.min(23, Math.round(frameFloat))
    : Math.round(frameFloat) % 24;
  return { action, frame, frameFloat };
}

/**
 * Walking keeps its original 24-pose cycle. Running adds two passing drawings
 * through run-stride; no lower-body stretching is applied to either atlas.
 */
export const WALK_STRIDE_FRAMES = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
] as const;
// Keep the fastest possible playback below one atlas frame per 60 Hz display
// frame, even at the maximum locomotion speed multiplier (1.5). This makes
// every authored pose observable instead of merely present in the PNG.
const RUN_STRIDE_CYCLE = DURATION.run;
const WALK_STRIDE_CYCLE = DURATION.walk;

/**
 * The spike sheet is a complete volleyball sequence, not a generic looping
 * action. Its useful reads are phase-specific: late approach, two-foot plant,
 * rise/cock, contact and follow-through. Starting the sheet from frame 0 each
 * time the simulation entered `plant` made the takeoff look thin and late,
 * because the player was visually back at the waiting frames while the physics
 * had already committed to the jump.
 */
export const SPIKE_PHASE_FRAMES: Partial<Record<ActionPhase, readonly number[]>> = {
  step1: [0, 1, 2, 3, 4, 5],
  step2: [6, 7, 8, 9],
  plant: [7, 8, 9, 10, 11, 12],
  rise: [13, 24, 25, 14, 28, 29, 30, 15, 31, 16, 26, 27, 17],
  contact: [18],
  follow: [19, 20, 21, 22],
  land: [23],
};

function sampleRunStride(t: number): Playhead {
  const cycle = RUN_STRIDE_CYCLE;
  const u = ((t / cycle) % 1 + 1) % 1;
  const at = Math.floor(u * RUN_STRIDE_FRAMES.length) % RUN_STRIDE_FRAMES.length;
  const frame = RUN_STRIDE_FRAMES[at];
  return { action: 'run', frame, frameFloat: at };
}

function sampleWalkStride(t: number): Playhead {
  const cycle = WALK_STRIDE_CYCLE;
  const u = ((t / cycle) % 1 + 1) % 1;
  const at = Math.floor(u * WALK_STRIDE_FRAMES.length) % WALK_STRIDE_FRAMES.length;
  const frame = WALK_STRIDE_FRAMES[at];
  return { action: 'walk', frame, frameFloat: at };
}

function initialTimelineTime(_p: Player, _action: SpriteAction): number {
  // A newly started movement begins at its support pose. Player-id-based
  // offsets made a stopped athlete instantly appear halfway through a stride.
  // Existing continuous walk/run transitions preserve their phase separately.
  return 0;
}

function isLocomotionSheet(action: SpriteAction): boolean {
  return action === 'walk' || action === 'run' || action === 'shuffle' || action === 'backpedal';
}

function locomotionPhase(action: SpriteAction, t: number): number {
  const cycle = action === 'run' ? RUN_STRIDE_CYCLE : action === 'walk' ? WALK_STRIDE_CYCLE : DURATION[action];
  return action === 'run' ? runPhaseAtTime(t / cycle) : ((t / cycle) % 1 + 1) % 1;
}

function strideSignsForFrame(
  locomotion: Locomotion | undefined,
  frame: number,
): Pick<SpriteDrawDiagnostics, 'farFootSign' | 'nearFootSign' | 'stride'> {
  const frames =
    locomotion === 'walk' || locomotion === 'shuffle'
      ? WALK_STRIDE_FRAMES
      : locomotion === 'run' || locomotion === 'approach'
        ? RUN_STRIDE_FRAMES
        : null;
  if (!frames) return { farFootSign: 0, nearFootSign: 0, stride: 0 };
  const index = (frames as readonly number[]).indexOf(frame);
  if (index < 0) return { farFootSign: 0, nearFootSign: 0, stride: 0 };
  const phase = (index / frames.length) * Math.PI * 2;
  const sign = Math.sin(phase) >= 0 ? 1 : -1;
  return {
    farFootSign: sign,
    nearFootSign: -sign as -1 | 1,
    stride: locomotion === 'walk' ? 0.095 : locomotion === 'shuffle' ? 0.11 : 0.29,
  };
}

function sampleFrameWindow(action: SpriteAction, frames: readonly number[], t: number, span: number): Playhead {
  const u = clamp(t / Math.max(1e-4, span), 0, 0.999999);
  const at = Math.min(frames.length - 1, Math.floor(u * frames.length));
  const frame = frames[at];
  return { action, frame, frameFloat: frame + u };
}

/** Four new drawn knee-extension poses; original contact/recovery cells stay
 * unchanged. The last inbetween belongs between 12 and 13 after registration.
 */
export const BUMP_FOLLOW_FRAMES = [9, 24, 25, 10, 11, 26, 12, 27, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;
const BUMP_AFTER_CONTACT = BUMP_FOLLOW_FRAMES.slice(1);

// Authored arm-return drawings join the original contact and recovery poses.
export const BACK_SET_FOLLOW_FRAMES = [9,10,11,12,13,14,15,16,24,25,26,27,17,18,19,20,21,22,23] as const;
const BACK_SET_AFTER_CONTACT = BACK_SET_FOLLOW_FRAMES.slice(1);
export function backSetFollowFrame(time: number): Playhead {
  // Retain the original contact hold and recovery deadline. The new artwork
  // brings the hands over the crown instead of jumping from behind to in front.
  const start = (CONTACT_FRAME.backSet! + .5) / 24 * DURATION.backSet;
  if (time < start) return { action: 'backSet', frame: 9, frameFloat: 9 };
  return sampleFrameWindow('backSet', BACK_SET_AFTER_CONTACT, time - start, DURATION.backSet - start);
}

// Do not replay the upward push backwards: relaxed wrists and bending elbows
// follow a different arc. New 30/31 belong after original16, not before it.
export const SET_FOLLOW_FRAMES = [9,10,11,12,13,14,15,28,29,16,30,31,17,18,19,20,21,22,23] as const;
const SET_AFTER_CONTACT = SET_FOLLOW_FRAMES.slice(1);
export const CELEBRATE_FRAMES = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,24,14,25,26,15,27,16,17,18,19,20,21,22,23] as const;

function setFollowFrame(time: number): Playhead {
  const start = (CONTACT_FRAME.set! + .5) / 24 * DURATION.set;
  if (time < start) return {action:'set',frame:9,frameFloat:9};
  return sampleFrameWindow('set', SET_AFTER_CONTACT, time-start, DURATION.set-start);
}

function bumpFollowFrame(time: number): Playhead {
  // Keep the existing exact-contact hold and total action duration. More
  // drawings subdivide recovery, never postpone ball contact or add a freeze.
  const recoveryStart = (CONTACT_FRAME.bump! + .5) / 24 * DURATION.bump;
  if (time < recoveryStart) return { action: 'bump', frame: 9, frameFloat: 9 };
  return sampleFrameWindow('bump', BUMP_AFTER_CONTACT, time - recoveryStart, DURATION.bump - recoveryStart);
}

const STANDING_SERVE_AFTER_CONTACT = STANDING_SERVE_FOLLOW_FRAMES.slice(1);
export function standingServeFollowFrame(time: number): Playhead {
  const start=(CONTACT_FRAME.serve!+.5)/24*DURATION.serve;
  if(time<start)return {action:'serve',frame:15,frameFloat:15};
  return sampleFrameWindow('serve',STANDING_SERVE_AFTER_CONTACT,time-start,DURATION.serve-start);
}

export function spikeFrameForDiagnostics(phase: ActionPhase, t: number): Playhead {
  const frames = SPIKE_PHASE_FRAMES[phase];
  if (!frames) return sampleAt('spike', t);
  const span =
    phase === 'plant'
      ? 0.1
      : phase === 'rise'
        ? 0.28
        : phase === 'follow' || phase === 'land'
          ? 0.28
          : 0.2;
  return sampleFrameWindow('spike', frames, t, span);
}

/** Time to floor on the same gravity used by Player.step; read-only. */
export function remainingJumpFlight(p: Player): number {
  if (!p.airborne && p.height <= 0) return 0;
  const gravity = -GRAVITY * 1.15;
  return Math.max(0, (p.vertVel + Math.sqrt(p.vertVel * p.vertVel + 2 * gravity * Math.max(0, p.height))) / gravity);
}

// Original landing row alternated shallow/deep knee flexion. Play one
// compression followed by recovery, not three little vertical rebounds.
export const SPIKE_FOLLOW_LANDING_FRAMES = [17,19,18,20,23,21,22] as const;
// Generated24 was rejected after real-play comparison: its calves kick back
// beyond either adjacent key pose. Preserve that source but never play it.
export const SPIKE_DESCENT_FRAMES = [10,11,25,26,27,12,13] as const;
export const SPIKE_FOLLOW_AIR_FRAMES = [0,1,2,3,4,5,6,7,8,9,...SPIKE_DESCENT_FRAMES,14,15,16] as const;

/** Physics-driven airborne drawings, followed by floor-only absorption. */
export function jumpServeFollowFrame(p: Player, flightAtContact: number, landingAge = 0): Playhead {
  return airAttackFollowFrame(p, 'jumpServeFollow', flightAtContact, landingAge);
}

export function airAttackFollowFrame(p: Player, action: 'spikeFollow' | 'jumpServeFollow', flightAtContact: number, landingAge = 0): Playhead {
  if (!p.airborne && p.height <= 0.001) {
    return sampleFrameWindow(action, action === 'spikeFollow' ? SPIKE_FOLLOW_LANDING_FRAMES : [17, 18, 19, 20, 21, 22, 23], landingAge, 0.15);
  }
  const progress = clamp(1 - remainingJumpFlight(p) / Math.max(1e-4, flightAtContact), 0, 1);
  const frameFloat = Math.min(16, progress * 17);
  if (action === 'spikeFollow' && frameFloat >= 10 && frameFloat < 14) {
    // Subdivide only the leg-recall window. Do not retime the arm swing,
    // contact pose, final descent or physical floor contact to fit extra art.
    return sampleFrameWindow(action, SPIKE_DESCENT_FRAMES, frameFloat - 10, 4);
  }
  return { action, frame: Math.floor(frameFloat), frameFloat };
}

/** The new serve drawings follow input/physics, never a free-running clock. */
export function serveFrameForPlayer(p: Player, state: ServeSpriteState): Playhead {
  const action = state.jumping ? 'jumpServe' : 'serve';
  if (state.tossGestureProgress !== undefined) {
    const held = sampleFrameWindow('serve', [0, 1, 2, 3], state.holdSeconds, 0.3);
    const poses = serveTossPoses(state.jumping, held.frame);
    const index = Math.min(poses.length - 1, Math.floor(clamp(state.tossGestureProgress, 0, 1) * poses.length));
    return { ...poses[index], frameFloat: poses[index].frame };
  }
  if (state.holding) {
    // No press means the first drawing forever. A held press may prepare the
    // toss, but cannot play release, run-up or strike while the ball is frozen.
    return sampleFrameWindow('serve', [0, 1, 2, 3], state.holdSeconds, 0.3);
  }
  if (!state.jumping) {
    if (state.standingSwingProgress === undefined) return sampleFrameWindow('serve', [7,8,9,10,11,12,13,14], state.tossElapsed, .42);
    if (state.standingSwingProgress <= 0) {
      // Preserve the original key times. Only the 0.14..0.21 s interval gains
      // in-betweens; the loaded elbow still waits for the descending ball.
      const key = state.tossElapsed / .42 * 6;
      if (key >= 2 && key < 3) return sampleFrameWindow('serve', STANDING_SERVE_TOSS_RELEASE_FRAMES, key - 2, 1);
      return sampleFrameWindow('serve', [7,8,9,10,11,12], state.tossElapsed, .42);
    }
    return sampleFrameWindow('serve', STANDING_SERVE_SWING_FRAMES, state.standingSwingProgress, 1);
  }
  if (p.presentation.phase === 'land') return sampleFrameWindow(action, [22, 23], p.animTime, 0.15);
  if (p.height > 0) return sampleFrameWindow(action, JUMP_SERVE_RISE_FRAMES, p.animTime, 0.18);
  if (p.presentation.phase === 'plant') return sampleFrameWindow(action, [10, 11, 12], p.animTime, 0.12);
  // A fast player reaches the plant before 0.42 s. A fixed animation clock
  // skipped the final two steps; distance/time-to-plant now spans all 7 poses.
  const progress = state.runupProgress ?? state.tossElapsed / 0.42;
  // Subdivide only the first two old cells. The remaining stride and plant
  // retain their distance-based timing; no extra step is invented at takeoff.
  if (progress < 2 / 7) return sampleFrameWindow(action, JUMP_SERVE_FIRST_STEP, progress, 2 / 7);
  return sampleFrameWindow(action, [3, 4, 5, 6, 7, 8, 9], progress, 1);
}

/**
 * Block artwork follows the physical jump, not a second independent clock.
 * The jump is already under way when `block` is selected: replaying frames
 * 0..6 then showed a squatting player floating towards the top of the net.
 * The ballistic velocity/height pair also accounts for player jump attributes
 * and the AI's small launch multiplier without changing any physics.
 */
export function blockFrameForPlayer(p: Player): Playhead {
  if (preparingBlock(p)) {
    return sampleFrameWindow('block', [0, 1, 2, 3, 4, 5, 6], p.blockPreparationAge!, BLOCK_PREPARATION_TIME);
  }
  if (p.presentation.phase === 'land' || (p.height <= 0 && p.vertVel <= 0 && p.presentation.action === 'block')) {
    // The displayed body can reach the floor one interpolation sample before
    // Player.step changes `rise` to `land`. A zero launch speed otherwise
    // selected takeoff frame 7 for that sample: 20 -> 7 -> 21.
    return sampleFrameWindow('block', BLOCK_LANDING_FRAMES, p.presentation.phase === 'land' ? p.animTime : 0, 0.15);
  }
  const gravity = -GRAVITY * 1.15;
  const launchSpeed = Math.sqrt(p.vertVel * p.vertVel + 2 * gravity * Math.max(0, p.height));
  const flight = launchSpeed > 0 ? clamp((1 - p.vertVel / launchSpeed) / 2, 0, 1) : 0;
  // Compression opens immediately after takeoff; the wall is fully extended
  // around the apex and stays up during descent, before lowering for landing.
  const at = flight < 0.2 ? 7 + flight / 0.2 * 5
    : flight < 0.54 ? 12 + (flight - 0.2) / 0.34 * 4
      : flight < 0.9 ? 16 + (flight - 0.54) / 0.36 * 3
        : 19 + (flight - 0.9) / 0.1;
  const frame = at >= 16.5 ? blockDescentFrame(at)
    : Math.max(p.presentation.phase === 'contact' ? CONTACT_FRAME.block! : 7, Math.round(at));
  return { action: 'block', frame, frameFloat: at };
}

function preparingBlock(p: Player): boolean {
  return p.blockPreparationAge !== undefined && p.presentation?.action === 'none'
    && p.presentation.sourceJob === 'block' && p.height === 0 && p.vertVel === 0
    && !p.diving && p.downTime <= 0 && p.gettingUp <= 0;
}

function diveOwnsBody(p: Player): boolean {
  return p.diving || p.downTime > 0 || p.gettingUp > 0;
}

/** Appended drawings preserve the original atlas indexes and body scale. */
// Original 12 pulled the palms backwards and raised the chest again between
// the new compression poses. Keep that source cell, but do not play its hitch.
export const DIVE_IMPACT_FRAMES = [36, 37, 38, 39, 13, 14] as const;
const DIVE_FLOOR_PUSH = [15, 28, 29, 16, 30, 31, 17] as const;
export const DIVE_FLOOR_FRAMES = [...DIVE_IMPACT_FRAMES, ...DIVE_FLOOR_PUSH] as const;
export const DIVE_RECOVERY_FRAMES = [18, 19, 20, 21, 24, 22, 23, 32, 33, 25, 34, 35, 26, 27] as const;

/** Drawings follow flight, floor contact and the actual recovery clock. */
export function diveFrameForPlayer(p: Player): Playhead {
  if (p.gettingUp > 0) return sampleFrameWindow('dive', DIVE_RECOVERY_FRAMES, p.animTime, 0.26);
  if (!p.diving && p.height === 0) {
    // Preserve the initial floor compression/slide. Added push-up drawings
    // belong to the second half, not to a faster replay of the impact.
    return p.animTime < .25
      ? sampleFrameWindow('dive', DIVE_IMPACT_FRAMES, p.animTime, .25)
      : sampleFrameWindow('dive', DIVE_FLOOR_PUSH, p.animTime - .25, .25);
  }
  if (p.anim === 'dive_contact') {
    // Only the actual save opens the joined-forearm contact pose. An attempt
    // without a hit continues reaching and then opens its palms for landing.
    return sampleFrameWindow('dive', [9, 10, 11], p.animTime, 0.12);
  }
  if (p.vertVel < 0 && p.height < 0.12) {
    return sampleFrameWindow('dive', [10, 11], (0.12 - p.height) / 0.12, 1);
  }
  // The low dive reaches its apex after about .09 s. Forearms must already
  // be extended then: using .24 s left the body in its first lunge when an
  // early save cue jumped directly to frame 9. Nine drawings in .09 sim
  // seconds still fit a 60 Hz display at GAME_SPEED=.58.
  return sampleFrameWindow('dive', [0, 1, 2, 3, 4, 5, 6, 7, 8], p.animTime, DIVE_EXTENSION_TIME);
}

function approachOwnsBody(p: Player): boolean {
  return p.height <= 0 && !p.landingPlant && p.presentation?.sourceJob === 'attack' &&
    (p.approaching || p.anim === 'plant');
}

/** Run steps lead into the actual planted feet, never a wall-clock fake jump. */
export function approachFrameForPlayer(p: Player): Playhead {
  const pose = p.anim === 'plant'
    // Twelve cells align with 120 Hz simulation ticks. Roundoff at an exact
    // cell boundary otherwise repeats one pose and skips the next (6.999...).
    ? sampleFrameWindow('approach', APPROACH_PLANT_FRAMES, p.animTime + 1e-10, 0.1)
    : sampleFrameWindow('approach', APPROACH_RUN_FRAMES, p.approachAge, p.approachRunDuration);
  // A licensed hitter keeps the shoulders open to the net throughout the
  // approach, not to a transient backwards component of the target correction.
  // Mirroring on that component flipped the entire athlete for one drawing,
  // then flipped it back at the plant. Contact and physics remain untouched.
  return { ...pose, facing: attackDir(p.side) as -1 | 1 };
}

function sampleForPlayer(p: Player, action: SpriteAction, t: number): Playhead {
  // Waiting is a planted ready stance, not a loop of independently drawn
  // silhouettes. Actual travel and skills still own their full sequences.
  if (action === 'idle') return { action, frame: 0, frameFloat: 0 };
  if ((action === 'bump' || action === 'set') && p.presentation?.action === action
    && p.presentation.phase === 'prepare') {
    // Preparation ends just BEFORE the authored touch. Only cue() may open
    // contact; a slow ball must not produce a phantom hit or loop the arms.
    if (action === 'bump') {
      const frame = bumpPreparationFrame(p.animTime);
      return {action,frame,frameFloat:frame};
    }
    const frames = Array.from({ length: CONTACT_FRAME[action]! }, (_, i) => i);
    return sampleFrameWindow(action, frames, p.animTime, .18);
  }
  if (action === 'shuffle' || action === 'backpedal') {
    const phase = ((t / DURATION[action]) % 1 + 1) % 1;
    const frame = Math.floor(phase * 24);
    return { action, frame, frameFloat: phase * 24 };
  }
  if (action === 'walk') {
    return sampleWalkStride(t);
  }
  if (action === 'run') return sampleRunStride(t);
  if (action === 'approach' && approachOwnsBody(p)) return approachFrameForPlayer(p);
  if (action === 'celebrate' && p.anim === 'cheer') return sampleAt(action, p.animTime);
  if (action === 'dive' && diveOwnsBody(p)) return diveFrameForPlayer(p);
  if (action === 'spike' && p.presentation?.action === 'spike') {
    if (p.presentation.phase === 'follow' || p.presentation.phase === 'land') {
      return airAttackFollowFrame(p, 'spikeFollow', p.animTime + remainingJumpFlight(p), p.animTime);
    }
    return spikeFrameForDiagnostics(p.presentation.phase, p.animTime ?? t);
  }
  if (action === 'block' && (p.presentation?.action === 'block' || preparingBlock(p))) return blockFrameForPlayer(p);
  if (action === 'jumpServe' && p.presentation?.action === 'jumpServe') {
    if (p.presentation.phase === 'follow' || p.presentation.phase === 'land') {
      return jumpServeFollowFrame(p, p.animTime + remainingJumpFlight(p), p.animTime);
    }
    return serveFrameForPlayer(p, { holding: false, holdSeconds: 0, tossElapsed: t, jumping: true });
  }
  return sampleAt(action, t);
}

/** Stateful sprite clock, independent from rendering and therefore testable. */
export class SpriteTimeline {
  private readonly heads = new Map<number, Head>();
  private readonly facingTransition = new FacingTransition();
  private readonly runBrake = new RunBrake();
  private readonly preparationRelease = new PreparationRelease();
  private readonly movingSetEntries = new Map<number, boolean>();
  private readonly bumpEntryOrigins = new Map<number, BumpPreparationOrigin>();
  private readonly shuffleSettle = new ShuffleSettle();
  private readonly backpedalSettle = new BackpedalSettle();
  private readonly backwardDeparture = new BackwardDeparture();
  private readonly readyRetreat = new ReadyRetreat();
  private readonly walkRelease = new WalkRelease();
  private readonly plantedBlockEntry = new Map<number, boolean>();
  private readonly standingTurnEntries = new Map<number, boolean>();
  private readonly diveTurn = new DiveTurn();

  /** Select art and cadence from the same visible body orientation. Otherwise
   * a one-tick facing request changes backpedal to shuffle and resets its feet
   * even though the turn clock correctly keeps the body facing the old way. */
  actionFor(p: Player, actionHint?: SpriteAction): SpriteAction {
    // Buffered input describes a possible NEXT touch, not the airborne body.
    // When possession changed under a blocker, a pending set hint flashed a
    // standing set pose at the apex. Actual contacts still enter through cue().
    const airAction = p.presentation?.action;
    const committedFlight = (p.height > 0 || p.airborne || p.presentation?.phase === 'rise'
      || p.presentation?.phase === 'contact' || p.presentation?.phase === 'follow' || p.presentation?.phase === 'land')
      && (airAction === 'block' || airAction === 'spike' || airAction === 'jumpServe');
    if (committedFlight) return actionFor(p, this.facingTransition.facingFor(p.id));
    const head = this.heads.get(p.id);
    // The clock may be idle while a completed defensive foot support still
    // owns the visible body. Use that actual posture for turn entry too.
    const previous = head?.action === 'idle' ? this.walkRelease.lastPose(p.id)?.action ?? head.action : head?.action;
    const bodyFacing = this.facingTransition.facingFor(p.id);
    const observed = actionHint ?? actionFor(p, bodyFacing, previous === 'backpedal');
    // A dead-ball role change can request upright walking on the same tick
    // that it asks the athlete to face the other way. Continue the incoming
    // defensive step through the existing direction-confirmation interval:
    // otherwise walk0/1 flashes before turn0. Keep its cadence too (actionFor
    // is shared by the renderer and timeline). No extra delay or physics lock.
    if (!actionHint && !head?.forced && observed === 'walk'
      && (previous === 'shuffle' || previous === 'backpedal')
      && bodyFacing !== undefined && bodyFacing !== (p.facing >= 0 ? 1 : -1)
      && p.presentation?.action === 'none' && !p.airborne && p.height <= 0
      && !p.diving && p.downTime <= 0 && p.gettingUp <= 0) return previous;
    // Scalar gait can already be latched to run during fast lateral coverage,
    // while the visible body correctly keeps shuffling. As the athlete slows,
    // a diagonal intent crossing must not START a run below its entry speed:
    // that used to flash one running pose then invent a full braking gesture.
    // An established visible run retains its lower exit threshold; genuine
    // pursuit, explicit action hints and contacts are not filtered here.
    if (!actionHint && observed === 'run' && previous === 'shuffle'
      && keepsNetReadyPosture(p.presentation, p.locomotionIntent)
      && Math.hypot(p.vel.x, p.vel.y) < RUN_SPEED_THRESHOLD + RUN_GAIT_HYSTERESIS) return 'shuffle';
    return observed;
  }

  /** Pin the player's next rendered pose to the authored contact. */
  cue(playerId: number, kind: ContactKind, airborne: boolean, facing?: number, backSet = false): void {
    const action = spriteActionForContact(kind, airborne, backSet);
    if (!action) return;
    const frame = CONTACT_FRAME[action];
    if (frame === undefined) return;
    this.heads.set(playerId, {
      action,
      // sampleAt rounds to the nearest drawing. The centre of contact is
      // therefore `frame`, not `frame + .5` (the NEXT drawing's boundary).
      // Starting on that boundary made a paused redraw skip the contact and
      // gave it only one display opportunity during normal play. Air attacks
      // use a separate physics-driven follow strip, not sampleAt recovery;
      // preserve that handoff so no airborne drawing is skipped by a new hold.
      t: ((frame + (action === 'spike' || action === 'jumpServe' ? .5 : 0)) / 24) * DURATION[action],
      forced: true,
      exactFrame: frame,
      contactFacing: facing === undefined ? undefined : facing >= 0 ? 1 : -1,
    });
  }

  reset(playerId?: number): void {
    if (playerId === undefined) this.standingTurnEntries.clear(); else this.standingTurnEntries.delete(playerId);
    if (playerId === undefined) this.movingSetEntries.clear(); else this.movingSetEntries.delete(playerId);
    if (playerId === undefined) this.bumpEntryOrigins.clear(); else this.bumpEntryOrigins.delete(playerId);
    this.backpedalSettle.reset(playerId);
    this.backwardDeparture.reset(playerId);
    this.readyRetreat.reset(playerId);
    this.walkRelease.reset(playerId);
    if (playerId === undefined) this.plantedBlockEntry.clear();
    else this.plantedBlockEntry.delete(playerId);
    this.shuffleSettle.reset(playerId);
    this.preparationRelease.reset(playerId);
    this.facingTransition.reset(playerId);
    this.diveTurn.reset(playerId);
    this.runBrake.reset(playerId);
    if (playerId === undefined) this.heads.clear();
    else this.heads.delete(playerId);
  }

  frameFor(p: Player, dt: number, actionHint?: SpriteAction, service?: ServeSpriteState, presentationDt = dt): Playhead {
    const preparingBump = !service && p.presentation?.action === 'bump' && p.presentation.phase === 'prepare';
    if (!preparingBump) this.bumpEntryOrigins.delete(p.id);
    else if (!this.bumpEntryOrigins.has(p.id)) {
      // Latch the previously visible posture, including a completed foot
      // support whose hidden head is idle. Deceleration must not flip entry.
      const last = this.readyRetreat.lastPose(p.id) ?? this.walkRelease.lastPose(p.id);
      this.bumpEntryOrigins.set(p.id, readyFootworkOrigin(last)
        ?? (last?.action === 'backpedal' ? 'retreat' : last?.action === 'shuffle' ? 'lateral'
          // Running/braking already leans the torso into the next support.
          // Upright bump 0..5 inserted a stand-up before lowering it again.
          // Reuse the authored moving gather; latch before speed reaches zero.
          : last?.action === 'run' || last?.action === 'runBrake' ? 'running' : 'standing'));
    }
    const preparingSet = !service && p.presentation?.action === 'set' && p.presentation.phase === 'prepare';
    if (!preparingSet) this.movingSetEntries.delete(p.id);
    else if (!this.movingSetEntries.has(p.id)) {
      // A settled defensive support is still visibly low even when the
      // underlying playback head has become idle. Enter from what was drawn.
      const previous = this.readyRetreat.lastPose(p.id) ?? this.walkRelease.lastPose(p.id) ?? this.heads.get(p.id);
      const entryOrigin = readyFootworkOrigin(previous);
      this.movingSetEntries.set(p.id, !!previous && (isLocomotionSheet(previous.action) || previous.action === 'runBrake' || entryOrigin === 'retreat' || entryOrigin === 'lateral'));
    }
    const blockPreparation = !service && preparingBlock(p);
    if (!blockPreparation) this.plantedBlockEntry.delete(p.id);
    else if (!this.plantedBlockEntry.has(p.id)) {
      // Choose once on entry, not again as braking crosses the speed threshold.
      // A blocker already planted must not lift a trailing foot to close a step
      // which never happened. Frames 2..6 keep both feet down and load the knees.
      this.plantedBlockEntry.set(p.id, Math.hypot(p.vel.x, p.vel.y) <= .15);
    }
    const pose = this.presentFrameFor(p, dt, actionHint, service, presentationDt);
    const head = this.heads.get(p.id);
    if (blockPreparation && this.plantedBlockEntry.get(p.id) && !head?.forced && pose.action === 'block') {
      this.diveTurn.reset(p.id);
      this.shuffleSettle.reset(p.id);
      this.backpedalSettle.reset(p.id);
      this.backwardDeparture.reset(p.id);
      this.readyRetreat.reset(p.id);
      this.walkRelease.reset(p.id);
      return { ...sampleFrameWindow('block', [2, 3, 4, 5, 6], p.blockPreparationAge!, BLOCK_PREPARATION_TIME), facing: pose.facing };
    }
    const allowed = !service && !head?.forced && p.presentation?.action === 'none'
      && !p.airborne && p.height <= 0 && !p.diving && p.downTime <= 0 && p.gettingUp <= 0;
    const settled = this.shuffleSettle.sample(p.id, pose, presentationDt, allowed, p.facing >= 0 ? 1 : -1);
    if (settled.resumeFrame !== undefined && head?.action === 'shuffle') {
      // Stay just inside the selected cell: modulo rounding at an exact
      // boundary otherwise rewound frames 16/19/22 on a zero-dt repaint.
      head.t = (settled.resumeFrame + 1e-7) / 24 * DURATION.shuffle;
    }
    const retreat = this.backpedalSettle.sample(p.id, settled.pose, presentationDt, allowed, p.facing >= 0 ? 1 : -1);
    if (retreat.resumeFrame !== undefined && head?.action === 'backpedal') {
      head.t = (retreat.resumeFrame + 1e-7) / 24 * DURATION.backpedal;
    }
    const departure = this.backwardDeparture.sample(p.id, retreat.pose, presentationDt, allowed, p.facing >= 0 ? 1 : -1);
    // Do not run the regular gait invisibly while entry drawings own the body.
    if (departure.pinGait && head?.action === 'backpedal') head.t = 0;
    const walking = this.walkRelease.sample(p.id, departure.pose, presentationDt, allowed && !actionHint, p.facing >= 0 ? 1 : -1);
    if (walking.pinGait && head?.action === 'walk') head.t = 0;
    // Weight transfer owns the final visible posture: an unfinished walking
    // release must not cover it with an upright frame until the gait starts.
    const readyDeparture = this.readyRetreat.sample(p.id, walking.pose, presentationDt, allowed && !actionHint, p.facing >= 0 ? 1 : -1);
    if (readyDeparture.pinGait && (head?.action === 'backpedal' || head?.action === 'shuffle')) head.t = 0;
    return this.diveTurn.sample(p, readyDeparture.pose);
  }

  private presentFrameFor(p: Player, dt: number, actionHint?: SpriteAction, service?: ServeSpriteState, presentationDt = dt): Playhead {
    let observedSample = this.sampleFrameFor(p, dt, actionHint, service, presentationDt);
    const h = this.heads.get(p.id);
    if (!h?.forced && observedSample.action === 'bump' && p.presentation?.phase === 'prepare'
      && this.bumpEntryOrigins.get(p.id) !== 'standing') {
      const frame = bumpPreparationFrame(p.animTime, this.bumpEntryOrigins.get(p.id));
      observedSample = { ...observedSample, frame, frameFloat: frame };
    }
    if (!h?.forced && observedSample.action === 'set' && p.presentation?.phase === 'prepare'
      && this.movingSetEntries.get(p.id)) {
      const frame = setPreparationFrame(p.animTime, true);
      observedSample = { ...observedSample, frame, frameFloat: frame };
    }
    const releasingToMovement = !service && !h?.forced && !p.airborne && !p.diving && p.height <= 0
      && (observedSample.action === 'idle' || isLocomotionSheet(observedSample.action));
    const preparing = !service && !h?.forced && p.presentation?.phase === 'prepare'
      && p.presentation.action === observedSample.action;
    const preparationSample = preparing ? { ...observedSample,
      facing: this.facingTransition.facingFor(p.id) ?? (p.facing >= 0 ? 1 as const : -1 as const) } : observedSample;
    const sample = this.preparationRelease.sample(p.id, preparationSample, preparing,
      releasingToMovement, presentationDt, Math.hypot(p.vel.x, p.vel.y));
    if (sample !== observedSample && releasingToMovement && h) {
      // Do not accumulate an invisible stride while the arms are returning.
      h.t = 0;
    }
    const ownsContact = h?.action === sample.action || h?.action === 'jumpServe' && sample.action === 'jumpServeFollow'
      || h?.action === 'spike' && sample.action === 'spikeFollow';
    const contactSample = ownsContact && h?.contactFacing !== undefined
      ? { ...sample, facing: h.contactFacing } : sample;
    const desired = contactSample.facing ?? (p.facing >= 0 ? 1 : -1);
    const canPivot = !service && !p.airborne && !p.diving && p.height < .01
      && (sample.action === 'idle' || isLocomotionSheet(sample.action));
    const heading = this.facingTransition.sample(p.id, desired, presentationDt, canPivot,
      Math.hypot(p.vel.x, p.vel.y) > RUN_SPEED_THRESHOLD + RUN_GAIT_HYSTERESIS);
    if (heading.turnPhase !== undefined) {
      this.runBrake.reset(p.id);
      if (!this.standingTurnEntries.has(p.id)) {
        const previous = this.readyRetreat.lastPose(p.id) ?? this.walkRelease.lastPose(p.id);
        this.standingTurnEntries.set(p.id, !heading.movingTurn && Math.hypot(p.vel.x, p.vel.y) < .15
          && previous?.frame === 0 && (previous.action === 'idle' || previous.action === 'walk'));
      }
      if (this.standingTurnEntries.get(p.id)) {
        const pose = standingTurnPose(heading.turnPhase);
        return { ...pose, frameFloat: pose.frame, facing: heading.facing };
      }
      const frameFloat = Math.min(23, heading.turnPhase * 24);
      if (heading.stoppingTurn) {
        const frame = stoppingTurnFrame(heading.turnPhase);
        return { action: 'turnStop', frame, frameFloat: frame, facing: heading.facing };
      }
      return { action: heading.movingTurn ? 'runTurn' : 'turn',
        frame: heading.movingTurn ? Math.floor(frameFloat) : plantedTurnFrame(frameFloat), frameFloat, facing: heading.facing };
    }
    this.standingTurnEntries.delete(p.id);
    if ((heading.completedStoppingTurn || heading.completedPlantedTurn) && h && !h.forced && canPivot) {
      // The braking strip ends with two planted feet and relaxed ready arms.
      // The planted pivot does too. Its hidden locomotion clock must not
      // resume on an arbitrary lifted-foot pose accumulated during the turn.
      h.t = 0;
      return { ...sampleForPlayer(p, sample.action, h.t), facing: heading.facing };
    }
    if (heading.completedMovingTurn && sample.action === 'run' && h && !h.forced) {
      // The drawn exit has the near leg trailing and far knee advancing,
      // matching run pose 6. Resume that leg phase, not the hidden clock's
      // arbitrary pose. Contacts/airborne skills never enter this branch.
      h.t = (runTimeAtPhase(6 / 24) + 1e-9) * DURATION.run;
      return { ...sampleRunStride(h.t), facing: heading.facing };
    }
    const presented = { ...contactSample, facing: heading.facing };
    const braking = this.runBrake.sample(p.id, presented, presentationDt,
      canPivot && !h?.forced && !heading.completedStoppingTurn && !heading.completedMovingTurn && !heading.completedPlantedTurn,
      Math.hypot(p.vel.x, p.vel.y));
    if (braking.completed && h) {
      // Resume inside the selected drawing's interval. On its exact boundary,
      // floating-point modulo could rewind one pose on a zero-dt pause draw.
      const frameTime = braking.pose.frameFloat === 0 ? 0 : braking.pose.frameFloat + .5;
      h.t = frameTime / 24 * DURATION[braking.pose.action];
    }
    const original = heading.facing !== desired ? { ...contactSample, facing: heading.facing } : contactSample;
    return braking.pose.action === 'runBrake' ? braking.pose
      : braking.completed ? braking.pose : original;
  }

  private sampleFrameFor(p: Player, dt: number, actionHint?: SpriteAction, service?: ServeSpriteState, presentationDt = dt): Playhead {
    if (service?.holding && Math.hypot(p.vel.x, p.vel.y) < 0.4) {
      // Also discard a previous rally's forced swing when a fresh serve waits.
      this.heads.delete(p.id);
      return serveFrameForPlayer(p, service);
    }
    // A buffered reception or an old contact must not replace an airborne
    // dive with a standing bump/set drawing. The body owns this whole sequence.
    const diving = diveOwnsBody(p);
    let observed = diving ? 'dive' : p.anim === 'cheer' ? 'celebrate'
      : !service && approachOwnsBody(p) ? 'approach' : this.actionFor(p, actionHint);
    let h = this.heads.get(p.id);
    if (diving && h && h.action !== 'dive') {
      this.heads.delete(p.id);
      h = undefined;
    }
    if (!h) {
      h = { action: observed, t: initialTimelineTime(p, observed), forced: false };
      this.heads.set(p.id, h);
    }

    if (h.exactFrame !== undefined) {
      h.contactFacing ??= p.facing >= 0 ? 1 : -1;
      if (h.action === 'jumpServe' || h.action === 'spike') h.followFlightDuration = remainingJumpFlight(p);
      const frame = h.exactFrame;
      delete h.exactFrame;
      return { action: h.action, frame, frameFloat: frame };
    }

    if (h.forced && h.action === 'dive') {
      if (diving) return diveFrameForPlayer(p);
      // End with the real get-up, not a stale timer from the contact event.
      h.forced = false;
    }

    if (h.forced && h.action === 'block') {
      if (p.presentation?.action === 'block') {
        const sample = blockFrameForPlayer(p);
        // A real early contact must not make the arms rewind below the wall.
        return { ...sample, frame: Math.max(CONTACT_FRAME.block!, sample.frame) };
      }
      h.forced = false;
    }

    if (h.forced && (h.action === 'spike' || h.action === 'jumpServe')) {
      if (p.presentation?.action === h.action || p.airborne) {
        h.t += presentationDt;
        const contactFrame = CONTACT_FRAME[h.action]!;
        if (h.t <= ((contactFrame + 0.5) / 24) * DURATION[h.action]) {
          return { action: h.action, frame: contactFrame, frameFloat: contactFrame };
        }
        h.followFlightDuration ??= remainingJumpFlight(p);
        if (!p.airborne && p.height <= 0.001) {
          h.landingTime = h.landingTime === undefined ? 0 : h.landingTime + presentationDt;
        }
        return airAttackFollowFrame(p, h.action === 'spike' ? 'spikeFollow' : 'jumpServeFollow', h.followFlightDuration, h.landingTime);
      }
      h.forced = false;
    }

    if (h.forced) {
      // The terminal contact drawing still owns this painted frame. Releasing
      // it before returning made an immediate zero-dt pause redraw switch to
      // a fresh gait even though neither the player nor time had changed.
      // Hand off on the next advancing frame, after the recovery was visible.
      if (h.t >= DURATION[h.action] && (presentationDt > 0
        || h.completedContactState !== contactCompletionState(p, observed))) h.forced = false;
      else {
        h.t += Math.max(0, presentationDt);
        if (h.t >= DURATION[h.action]) h.completedContactState = contactCompletionState(p, observed);
        return sampleAt(h.action, h.t);
      }
    }

    if (service && !service.holding) {
      const sample = serveFrameForPlayer(p, service);
      h.action = sample.action;
      return sample;
    }

    // Decelerating lateral feet can cross the backwards angle for just one
    // drawing. Finish that lateral step until a shallow diagonal request is
    // sustained for 40 simulation ms. Clear backwards intent remains instant;
    // this changes neither steering nor an already committed retreat/skill.
    const intent = p.locomotionIntent;
    const shallowRetreat = !service && h.action === 'shuffle' && observed === 'backpedal'
      && intent !== undefined && Math.abs(intent.x) > Math.abs(intent.y);
    if (shallowRetreat) {
      h.retreatEntryAge = (h.retreatEntryAge ?? 0) + Math.max(0, presentationDt);
      if (h.retreatEntryAge + 1e-9 < .04) observed = 'shuffle';
    } else delete h.retreatEntryAge;

    // The render clock can finish between two fixed simulation ticks. A
    // backwards set still physically recovering must keep its final drawing,
    // not restart forward-set frame zero from the generic `set_contact` anim.
    // A new preparation/contact or actual movement releases this immediately.
    if (h.action === 'backSet' && h.t >= DURATION.backSet && observed === 'set'
      && p.presentation?.action === 'set' && p.presentation.phase === 'contact') {
      return { action: 'backSet', frame: 23, frameFloat: 23 };
    }

    // The physical recovery can end one tick before coverage starts. Keep
    // its final planted drawing during that brief gap instead of flashing
    // a taller idle body between two actions. Skills and real movement win
    // immediately; a genuinely resting player enters idle after 80 ms.
    if (!service && observed === 'idle' && (h.action === 'set' || h.action === 'backSet')
      && h.t >= DURATION[h.action] && !p.airborne && p.height <= 0) {
      h.setRestAge = (h.setRestAge ?? 0) + Math.max(0, presentationDt);
      if (h.setRestAge < .08) return { action: h.action, frame: 23, frameFloat: 23 };
    } else delete h.setRestAge;

    // Millimetre corrections around the movement dead zone can last a single
    // physics tick. Previously these flashed idle -> backpedal -> shuffle ->
    // idle although no visible step had occurred. Confirm a slow departure
    // for 25 simulation ms (43 display ms), only from a planted ready pose.
    // A clear movement, a skill, service, or an already moving body bypasses
    // this gate. Zero-dt pause draws cannot accumulate confirmation time.
    const slowDeparture = !service && h.action === 'idle' && isLocomotionSheet(observed)
      && p.presentation?.action === 'none' && !p.airborne && p.height <= 0
      && Math.hypot(p.vel.x, p.vel.y) < .8;
    if (slowDeparture) {
      h.stepStartAge = (h.stepStartAge ?? 0) + Math.max(0, presentationDt);
      if (h.stepStartAge + 1e-9 < .025) return sampleForPlayer(p, 'idle', 0);
    }
    delete h.stepStartAge;

    if (h.action !== observed) {
      const previousAction = h.action;
      const previousTime = h.t;
      h.action = observed;
      delete h.contactFacing;
      // Changing speed must not change which foot is in front. Resetting the
      // clock on walk/run boundaries produced the visible hitch
      // even though both atlases were individually smooth.
      if (isLocomotionSheet(previousAction) && isLocomotionSheet(observed)
          && previousAction !== 'shuffle' && observed !== 'shuffle') {
        const phase = locomotionPhase(previousAction, previousTime);
        h.t = (observed === 'run' ? runTimeAtPhase(phase) : phase) * DURATION[observed];
      } else {
        h.t = initialTimelineTime(p, observed);
      }
    } else {
      h.t += dt;
    }
    return sampleForPlayer(p, h.action, h.t);
  }
}

const timeline = new SpriteTimeline();

export function resetSpriteTimeline(): void { timeline.reset(); }

/** Called by the renderer on the simulation's exact contact event. */
export function cueSpriteContact(
  playerId: number,
  kind: ContactKind,
  airborne: boolean,
  facing?: number,
  backSet = false,
): void {
  timeline.cue(playerId, kind, airborne, facing, backSet);
}

/**
 * Use drawn raster art for the player whenever a sheet can represent the
 * current state. Falling back to the old capsule/ellipse body during ordinary
 * movement is visually worse than a reused locomotion strip: players visibly
 * change species between frames. Walk, shuffle, run and attack approach
 * therefore all stay on authored raster sprite sheets.
 */
export function shouldUseRasterSprite(_p: Player): boolean {
  return true;
}

/** Live play follows the physical gesture and exact contact events. A queued
 * button is an intention, never permission to play an entire skill atlas:
 * doing that replaced running legs with a planted pass and even showed fake
 * contact/follow-through frames. Explicit atlas hints remain available to
 * art-inspection tools through drawSpritePlayer, not to the live-match path.
 */
export function drawMatchSpritePlayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  sheets: SheetSet,
  dt: number,
  style: SpriteRenderStyle = {},
  service?: ServeSpriteState,
): boolean {
  return drawSpritePlayer(ctx,cam,p,sheets,dt,style,undefined,service);
}

/**
 * Draw a player from sprites, if a sheet for their current action exists.
 * Returns false when no raster sheet exists; the caller reports missing art.
 */
export function drawSpritePlayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  sheets: SheetSet,
  dt: number,
  style: SpriteRenderStyle = {},
  actionHint?: SpriteAction,
  service?: ServeSpriteState,
  recordedPose?: { action: SpriteAction; frame: number; facing: number },
): boolean {
  // Read defensively: replay draws bodies rebuilt from recorded frames, which
  // carry a pose but no presentation state. Dereferencing it unconditionally
  // threw inside the render loop and took the whole canvas down with it — the
  // game went black the first time a replay played.
  const action = p.presentation?.action;
  const inLocomotion = (action === undefined || action === 'none') && !p.airborne && !p.diving;
  const requestedAction = recordedPose?.action ?? timeline.actionFor(p, actionHint);
  const strideScale = inLocomotion && isLocomotionSheet(requestedAction)
    ? locomotionPlaybackScale(requestedAction, Math.hypot(p.vel.x, p.vel.y))
    : 1;
  const head = recordedPose ?? timeline.frameFor(p, dt * strideScale, actionHint, service, dt);
  const drawnAction =
    sheets[head.action] !== undefined
      ? head.action
      : sheets.run !== undefined
        ? 'run'
        : sheets.approach !== undefined
          ? 'approach'
        : sheets.idle !== undefined
            ? 'idle'
            : (Object.keys(sheets)[0] as SpriteAction | undefined);
  const sheet = drawnAction ? sheets[drawnAction] : undefined;
  if (!drawnAction || !sheet) return false;
  const drawnFrame = sheet.frames.length ? head.frame % sheet.frames.length : head.frame;
  const drawnFacing = (head.facing ?? p.facing) >= 0 ? 1 : -1;
  const locomotion = p.presentation?.locomotion;
  const gait =
    (locomotion === 'walk' || locomotion === 'shuffle' || locomotion === 'run' || locomotion === 'approach') &&
    (drawnAction === 'walk' || drawnAction === 'run' || drawnAction === 'approach')
      ? strideSignsForFrame(locomotion, drawnAction === 'run' ? runLegacyFrame(head.frame) : head.frame)
      : { farFootSign: 0 as const, nearFootSign: 0 as const, stride: 0 };
  const floor = cam.projectFloor(p.pos.x, p.pos.y);
  const heightScale = style.heightScale ?? 1;
  const widthScale = style.widthScale ?? 1;
  const bodyPx = 1.9 * floor.scale * 42 * heightScale;
  if (bodyPx < 6) return true;

  // Authored sheets already lift the feet inside their 512 px cell. The old
  // renderer responded by ignoring the simulation's height entirely for jump
  // actions, which made a real block or spike appear planted on the floor.
  // Add only the physical lift not already present in the drawn frame.
  const authoredLift = frameArtLiftPixels(sheet, drawnFrame, bodyPx);
  const worldUnitPx = Math.max(1, floor.scale * 42);
  // Replay heights already contain the actual painted lift; never ease twice.
  const renderedHeight = drawnAction === 'dive' && !recordedPose ? diveRenderHeight(p) : p.height;
  const lift = Math.max(0, renderedHeight - authoredLift / worldUnitPx);
  const anchor = cam.project(p.pos.x, p.pos.y, lift);
  const frame = sheet.frames[drawnFrame];
  const nativeHeight = sheet.nativeBodyHeight ?? Math.max(1, frame.footY - frame.boxTop);
  spriteDrawDiagnostics.set(p.id, {
    playerId: p.id,
    locomotion: locomotion ?? 'ready',
    action: drawnAction,
    frame: drawnFrame,
    facing: drawnFacing,
    renderedHeight,
    screenTop: anchor.y - (frame.footY - frame.boxTop) * bodyPx / nativeHeight,
    ...gait,
  });

  ctx.save();
  // Distance changes projected size, not the opacity of a solid athlete.
  // Fading by depth made court lines show through skin and uniforms.
  const baseAlpha = style.alpha ?? 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Exactly one body, always. Position, height and scale are what interpolate
  // between frames; the silhouette itself never does.
  ctx.globalAlpha = baseAlpha;
  drawFrame(
    ctx,
    sheet,
    drawnFrame,
    anchor.x,
    anchor.y,
    bodyPx,
    drawnFacing,
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
