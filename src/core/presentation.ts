/**
 * The presentation state model.
 *
 * The old code had a single flat `PlayerAnim` enum that mixed three genuinely
 * independent things together: how the body is travelling across the floor,
 * which volleyball skill is being executed, and how far through that skill the
 * player is. Because they shared one slot, they overwrote each other. The most
 * visible consequence was that *any* movement above a trivial threshold set
 * `approach_run`, so a player nudging half a metre sideways to cover ran the
 * spike-approach cycle — and the court was permanently full of sprinting.
 *
 * Splitting the three axes is the fix. Locomotion is derived from the body's
 * actual speed and is never allowed to invent an attack approach on its own;
 * `approach` is a *licence* the AI has to grant explicitly, for a bounded
 * window, and it expires. Action and phase are driven by the skill call sites.
 */
import type { Side } from './rules';
import { attackDir } from './rules';

/** How the body is travelling across the floor. Independent of any skill. */
export type Locomotion = 'stand' | 'ready' | 'walk' | 'shuffle' | 'run' | 'approach';

/** Finish the grounded set's arm extension and recovery before AI coverage. */
export const SET_GROUND_RECOVERY_TIME = .48;

/** The grounded bagher finishes its weight transfer before AI coverage resumes. */
export const BUMP_GROUND_RECOVERY_TIME = .45;

/** Which volleyball skill is being executed, if any. */
export type VolleyballAction =
  | 'none'
  | 'bump'
  | 'set'
  | 'serve'
  | 'jumpServe'
  | 'spike'
  | 'block'
  | 'dive'
  | 'celebrate';

/** How far through the skill the player is. */
export type ActionPhase =
  | 'prepare'
  | 'step1'
  | 'step2'
  | 'plant'
  | 'rise'
  | 'contact'
  | 'follow'
  | 'land'
  | 'recover';

/** What the AI asked this body to do; the reason an approach was licensed. */
export type PresentationJob =
  | 'idle'
  | 'receive'
  | 'set'
  | 'attack'
  | 'block'
  | 'cover'
  | 'serve';

export interface PresentationState {
  locomotion: Locomotion;
  action: VolleyballAction;
  phase: ActionPhase;
  /** Seconds since the current action began. */
  startedAt: number;
  /** Seconds since the contact phase was entered, if it has been. */
  contactAt?: number;
  /** While set, `Player.facing` is pinned to this and movement cannot turn it. */
  lockedFacing?: -1 | 1;
  sourceJob: PresentationJob;
}

export const initialPresentation = (): PresentationState => ({
  locomotion: 'ready',
  action: 'none',
  phase: 'recover',
  startedAt: 0,
  sourceJob: 'idle',
});

/** Off-ball coverage and attack setup stay open to the net while adjusting.
 * A teammate's pass behind the defender is not an instruction to turn the
 * whole body away, then immediately turn back. A hitter backing off the net
 * before the licensed run-up needs the same net-facing footwork. This is a
 * tactical posture, not a gait threshold: a brief faster lateral correction
 * must not turn the shoulders away and then back when the run latch expires.
 * Ball pursuit, licensed approach and committed gestures own their orientation.
 */
export function keepsNetReadyPosture(pr: PresentationState, direction?: Readonly<{ x: number; y: number }>): boolean {
  // A setter crossing the court does not turn his back for a small backwards
  // component of an otherwise lateral pursuit. A genuine lengthwise chase
  // remains free to turn; its subsequent set still owns its contact facing.
  const lateralSet = pr.sourceJob === 'set' && direction !== undefined
    && Math.abs(direction.x) > Math.abs(direction.y);
  return pr.action === 'none'
    && (pr.sourceJob === 'cover' || pr.sourceJob === 'block' || pr.sourceJob === 'attack' || lateralSet)
    && pr.locomotion !== 'approach';
}

/**
 * Speed below which a body is making a positional correction rather than
 * travelling. Correcting bodies shuffle; they never run and never approach.
 */
export const SHUFFLE_SPEED = 0.8;

/** Speed above which an unlicensed body is genuinely running. */
export const RUN_SPEED_THRESHOLD = 2.35;

/** A speed threshold must not swap two different silhouettes for one tick. */
export const RUN_GAIT_HYSTERESIS = 0.2;
export const RUN_GAIT_CONFIRMATION = 0.04;
export const RUN_GAIT_IMMEDIATE_SPEED = 3.2;

/** Seven grounded compression drawings before an anticipated block takeoff. */
export const BLOCK_PREPARATION_TIME = 0.10;

/** Presentation-only filtering; never alters the body's velocity or target. */
export function groundGait(speed: number, previous: Locomotion, runAge: number,
  dt: number, approaching: boolean): { locomotion: Locomotion; runAge: number } {
  if (approaching && speed > SHUFFLE_SPEED) return { locomotion: 'approach', runAge: 0 };
  if (speed < 0.12) return { locomotion: 'ready', runAge: 0 };
  if (speed < SHUFFLE_SPEED) return { locomotion: 'walk', runAge: 0 };
  if (previous === 'run') {
    return { locomotion: speed >= RUN_SPEED_THRESHOLD - RUN_GAIT_HYSTERESIS ? 'run' : 'shuffle', runAge: 0 };
  }
  // A clear sprint must not keep walking while a debounce timer catches up.
  if (speed >= RUN_GAIT_IMMEDIATE_SPEED) return { locomotion: 'run', runAge: 0 };
  if (speed < RUN_SPEED_THRESHOLD + RUN_GAIT_HYSTERESIS) return { locomotion: 'shuffle', runAge: 0 };
  const confirmed = Math.min(RUN_GAIT_CONFIRMATION, runAge + Math.max(0, dt));
  return { locomotion: confirmed + 1e-9 >= RUN_GAIT_CONFIRMATION ? 'run' : 'shuffle', runAge: confirmed };
}

/**
 * Phases during which the feet are committed and the shoulders are already
 * turned to the target. Turning the body here is what produced contacts made
 * with the player's back to the net.
 */
export const FACING_LOCKED_PHASES: ReadonlySet<ActionPhase> = new Set<ActionPhase>([
  'prepare',
  'step1',
  'step2',
  'plant',
  'rise',
  'contact',
  'follow',
  'land',
]);

/**
 * Actions that are always played facing the direction of attack: you cannot
 * serve, spike or block away from the net.
 */
const NET_FACING_ACTIONS: ReadonlySet<VolleyballAction> = new Set<VolleyballAction>([
  'spike',
  'block',
  'serve',
  'jumpServe',
]);

/** True when the action must be executed facing the opponent's court. */
export function facesNet(action: VolleyballAction): boolean {
  return NET_FACING_ACTIONS.has(action);
}

/** The facing a given action demands of a player on a given side. */
export function requiredFacing(action: VolleyballAction, side: Side): -1 | 1 | null {
  if (!facesNet(action)) return null;
  return attackDir(side) as -1 | 1;
}
