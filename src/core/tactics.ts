import { Vec3, clamp, v3 } from './math3';
import { Player, isFrontRow } from './player';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, Side, attackDir } from './rules';

/**
 * Where a volleyball team actually stands.
 *
 * Six players moving to "roughly their rotation spot, plus a nudge towards the
 * ball" is what an arcade game looks like when nobody has told it how the sport
 * is organised. Real teams occupy a small number of well-defined shapes and
 * switch between them on clear cues, and it is those shapes — not faster
 * reactions — that make a side look like it knows what it is doing.
 *
 * Everything here is expressed for a side attacking in `attackDir(side)`, so
 * the same numbers serve both halves. `y` runs along the court with the net at
 * 0; `x` runs across it. Zone 4 is the left pin, zone 2 the right pin.
 */

/** The pin a role attacks from, as a fraction of the court's half-width. */
const PIN = {
  outside: -0.66,
  opposite: 0.68,
  middle: 0,
  setter: 0.5,
  libero: 0,
} as const;

/** Distance from the net at which a hitter leaves the floor. */
export const TAKEOFF_Y = 1.15;
/** Where the setter delivers the ball, and stands waiting for the pass. */
export const SETTER_X = 1.45;
export const SETTER_Y = 1.05;

const across = (fraction: number): number => fraction * (COURT_HALF_WIDTH - 0.55);

/** Mirror a home-side tactical spot onto whichever side is playing. */
const spot = (side: Side, x: number, depth: number): Vec3 => {
  const dir = attackDir(side);
  return v3(dir > 0 ? x : -x, -dir * depth, 0);
};

/**
 * Serve reception: the three-passer W.
 *
 * The passers form a shallow arc across the back, the setter releases to the
 * net on the right and faces them, and the front-row hitters stand clear of
 * the passing lanes so they can approach the moment the ball is up. A team
 * that receives in its base rotation positions instead — which is what this
 * game did — has its setter buried in the back corner and its hitters standing
 * in the way of their own passers.
 */
export function receptionSpot(p: Player, passers: number[]): Vec3 {
  const side = p.side;
  const front = isFrontRow(p.rotationSlot);

  // The setter always ends up at the net, on the right, ready to set. From the
  // back row that means penetrating — running in as the serve is struck.
  if (p.role === 'setter') return spot(side, SETTER_X, SETTER_Y);

  const passIndex = passers.indexOf(p.id);
  if (passIndex >= 0) {
    // Left, middle, right of a three-man reception line, deepest in the middle.
    const lane = [-0.62, 0.02, 0.6][passIndex] ?? 0;
    const depth = passIndex === 1 ? 7.1 : 6.4;
    return spot(side, across(lane), depth);
  }

  // Not passing: stand where the approach starts, clear of the passing lanes.
  if (p.role === 'middle') return spot(side, across(PIN.middle), front ? 1.5 : 5.6);
  if (p.role === 'opposite') return spot(side, across(PIN.opposite), front ? 3.0 : 6.2);
  return spot(side, across(PIN.outside), front ? 3.2 : 6.4);
}

/**
 * Building an attack: approach lanes for the hitters, a tight arc of cover
 * behind them for everyone else.
 *
 * Cover is the part that reads as organisation. A blocked ball comes straight
 * back down, and a team that has three players crouched behind its own hitter
 * digs it up; a team standing where it happened to be watches it land.
 */
export function attackSpot(p: Player, attacker: Player | null, ballX: number): Vec3 {
  const side = p.side;
  const front = isFrontRow(p.rotationSlot);

  if (p.role === 'setter') return spot(side, SETTER_X, SETTER_Y);

  if (attacker && p.id === attacker.id) {
    // The hitter starts the approach well off the net and arrives at the pin.
    const pin = PIN[p.role] ?? 0;
    return spot(side, across(pin), p.role === 'middle' ? 1.5 : 3.1);
  }

  // Everyone else covers: an arc a couple of metres behind the hitter, low and
  // tight, plus one player deep in case the block sends it long.
  const hitX = attacker ? attacker.pos.x * attackDir(side) : ballX * attackDir(side);
  if (front) {
    const sideOfArc = p.role === 'opposite' ? 1 : -1;
    return spot(side, clamp(hitX + sideOfArc * 1.7, -across(1), across(1)), 2.6);
  }
  if (p.role === 'middle' || p.role === 'libero') return spot(side, hitX * 0.4, 5.0);
  return spot(side, clamp(hitX - 1.2, -across(1), across(1)), 4.4);
}

/**
 * Defending an attack: a two-man block on the ball, one player off the net for
 * the tip, and a perimeter behind them.
 *
 * The perimeter rotates with the attacker: the block takes the line, so the
 * diggers sit in the cross-court angle and one stays deep behind the block for
 * the ball that deflects long. Standing on fixed rotation spots leaves the
 * whole cross-court open, which is where most attacks go.
 */
export function defenceSpot(
  p: Player,
  threatX: number,
  blockers: number[],
  strongAttack: boolean,
): Vec3 {
  const side = p.side;
  const dir = attackDir(side);
  const front = isFrontRow(p.rotationSlot);
  // Threat in our own frame of reference.
  const tx = clamp(threatX * dir, -across(1), across(1));

  const blockIndex = blockers.indexOf(p.id);
  if (blockIndex >= 0) {
    // Two blockers, shoulder to shoulder, on the ball.
    const offset = blockIndex === 0 ? 0 : tx > 0 ? -0.85 : 0.85;
    return spot(side, clamp(tx + offset, -across(0.92), across(0.92)), 0.75);
  }

  if (front) {
    // The third front player peels off the net and covers the tip behind the
    // block — the single most common way an attack scores cheaply.
    return spot(side, tx * 0.55, 3.1);
  }

  // Perimeter. The digger opposite the block covers the cross-court angle, the
  // one behind the block takes the line, and the middle-back sits deepest.
  const deep = strongAttack ? 7.6 : 6.8;
  if (p.role === 'libero' || p.rotationSlot === 6) return spot(side, -tx * 0.35, deep + 0.7);
  const angle = tx > 0 ? -1 : 1;
  const isCrossDigger = (p.rotationSlot === 5 && tx > 0) || (p.rotationSlot === 1 && tx <= 0);
  return spot(
    side,
    clamp(isCrossDigger ? angle * across(0.62) : tx * 0.8, -across(0.95), across(0.95)),
    isCrossDigger ? deep - 0.6 : deep,
  );
}

/** Keep a tactical spot inside the court and off the net. */
export function legalSpot(side: Side, at: Vec3): Vec3 {
  const dir = attackDir(side);
  const y = clamp(Math.abs(at.y), 0.6, COURT_HALF_LENGTH + 0.4);
  return v3(clamp(at.x, -COURT_HALF_WIDTH + 0.3, COURT_HALF_WIDTH - 0.3), -dir * y, 0);
}
