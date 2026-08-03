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

// Real gravity, not the heavier arcade variant this started with. The 90s
// coin-ops read as *floaty*: high arcs and long hang time are what give the
// player room to walk under the marker and time the button — which is the
// entire rhythm of the genre.
export const GRAVITY = -9.81;
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

/** Upward speed of the serve toss. High enough that a jumping server meets
 *  the ball near full reach — which is what makes a jump serve possible. */
export const TOSS_SPEED = 6.4;

/**
 * Forward component of the serve toss, m/s. A jump serve is struck moving
 * into the court, so the ball has to be thrown ahead of the server.
 */
export const TOSS_FORWARD = 0.35;

/**
 * Hold the action button longer than this on the serve and it becomes an
 * underarm serve whose power is the charge; a shorter press tosses the ball
 * for the overhand or jump serve.
 */
export const UNDERARM_HOLD = 0.26;

/**
 * Seconds after the toss at which the server's approach jump fires.
 *
 * The approach is the game's job. A jump serve asks the player to time a jump
 * to a toss they did not throw and then land a swing inside a narrow window;
 * asking for both is why the serve could not be executed. Press once to toss,
 * once to hit — the footwork in between happens on its own.
 */
export const SERVE_APPROACH = 0.2;

/**
 * Global pace multiplier. Everything — ball, players, timers — runs this much
 * slower than real time, because at 1.0 the exchanges around the net came and
 * went faster than a player could read them.
 */
export const GAME_SPEED = 0.87;

/** Fixed simulation timestep (120 Hz) — rendering interpolates between steps. */
export const FIXED_DT = 1 / 120;

/**
 * How long an action press stays armed while waiting for the ball, seconds.
 *
 * An arcade game must reward anticipation. Requiring the button on the exact
 * frame the ball enters the contact envelope means a press a tenth of a second
 * early is thrown away and the ball drops — which reads as the game ignoring
 * good timing.
 */
export const ACTION_BUFFER = 0.28;

/**
 * Power gauge, the "Lethal Maneuver" resource.
 *
 * It fills from play rather than from time, so it rewards staying in rallies
 * instead of stalling: digging a hard spike is worth far more than winning a
 * point off an opponent's error.
 */
export const POWER_MAX = 100;
export const POWER_GAIN = {
  /** Keeping a hard-driven ball alive. */
  dig: 22,
  /** Getting hands on an attack at the net. */
  block: 18,
  /** A dive that saves the rally. */
  save: 30,
  /** A clean kill. */
  kill: 10,
  /** Every exchange over the net during a long rally. */
  rally: 4,
  /** Losing a point gives a little back, so a run does not become hopeless. */
  conceded: 8,
} as const;

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
