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
export type Locomotion = 'stand' | 'ready' | 'shuffle' | 'run' | 'approach';

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

/**
 * Speed below which a body is making a positional correction rather than
 * travelling. Correcting bodies shuffle; they never run and never approach.
 */
export const SHUFFLE_SPEED = 0.8;

/** Speed above which an unlicensed body is genuinely running. */
export const RUN_SPEED_THRESHOLD = 2.35;

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
