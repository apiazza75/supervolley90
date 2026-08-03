/**
 * Court dimensions, rule constants and gameplay tuning.
 *
 * Real FIVB measurements are used for the court so the perspective renderer
 * looks right; the *feel* constants (speeds, jump height, spike power) are
 * deliberately arcade-scaled, closer to a 90s coin-op than to a simulation.
 */

/** Half-width of the court: sidelines sit at x = -4.5 and x = +4.5. */
export const COURT_HALF_WIDTH = 4.5;
/** Half-length: baselines at y = -9 (home) and y = +9 (away), net at y = 0. */
export const COURT_HALF_LENGTH = 9;
/** Attack line, 3 m from the net on each side. */
export const ATTACK_LINE = 3;
export const NET_HEIGHT = 2.43;
/**
 * Bottom edge of the net. Below this the space under the net is open: a ball
 * rolling through there is not stopped by the band, it is a plane-crossing
 * fault instead, which the rules layer handles.
 */
export const NET_BOTTOM = 1.0;
/** The net band has thickness; the ball collides against this slab. */
export const NET_BAND_THICKNESS = 0.1;
/** Antennae mark the legal crossing width above the net. */
export const ANTENNA_HEIGHT = 3.23;

/** Free space simulated around the court, where players may chase the ball. */
export const OUT_MARGIN_X = 3.2;
export const OUT_MARGIN_Y = 2.6;

export const GRAVITY = -9.81 * 1.35; // slightly heavy: arcade balls fall fast
export const AIR_DRAG = 0.06; // per second, proportional to velocity
export const MAGNUS = 0.32; // spin -> lateral/vertical curve coefficient
export const SPIN_DECAY = 0.55;
export const BALL_RADIUS = 0.105;
export const FLOOR_RESTITUTION = 0.45;
export const FLOOR_FRICTION = 0.7;
export const NET_RESTITUTION = 0.22;

export const PLAYER_RADIUS = 0.42;
/** Reach of a standing player, measured to the top of the extended arms. */
export const PLAYER_REACH = 2.15;
export const PLAYER_RUN_SPEED = 6.4;
export const PLAYER_ACCEL = 42;
export const PLAYER_FRICTION = 26;
export const JUMP_VELOCITY = 5.6;
/** How long a player stays "landing" and cannot act again. */
export const LANDING_LOCK = 0.16;

export const TEAM_SIZE = 6;
export const MAX_TOUCHES = 3;

export const SET_TARGET = 25;
export const TIEBREAK_TARGET = 15;
export const SETS_TO_WIN = 3;
export const MIN_LEAD = 2;

/** Fixed simulation timestep (120 Hz) — rendering interpolates between steps. */
export const FIXED_DT = 1 / 120;

export type Side = 'home' | 'away';

export const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/** Sign of the y axis a side attacks towards: home attacks +y, away attacks -y. */
export const attackDir = (s: Side): number => (s === 'home' ? 1 : -1);

/** True when the point (x, y) lies inside the court, lines included. */
export const isInsideCourt = (x: number, y: number): boolean =>
  Math.abs(x) <= COURT_HALF_WIDTH && Math.abs(y) <= COURT_HALF_LENGTH;

/** Which half of the court a y coordinate belongs to. */
export const sideOfY = (y: number): Side => (y < 0 ? 'home' : 'away');

/**
 * Decide whether a set is over.
 * The deciding (5th) set is played to `TIEBREAK_TARGET`.
 */
export const setTarget = (setNumber: number): number =>
  setNumber >= SETS_TO_WIN * 2 - 1 ? TIEBREAK_TARGET : SET_TARGET;

export const isSetWon = (mine: number, theirs: number, setNumber: number): boolean =>
  mine >= setTarget(setNumber) && mine - theirs >= MIN_LEAD;
