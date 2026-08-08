import { Vec3, clamp, v3 } from './math3';
import { Player, isFrontRow } from './player';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, Side, attackDir } from './rules';

/**
 * Where a volleyball team actually stands.
 *
 * Everything here is expressed for a side attacking in `attackDir(side)`, so
 * the same numbers serve both halves. `y` runs along the court with the net at
 * 0; `x` runs across it. Zone 4 is the left pin, zone 2 the right pin.
 *
 * Two rules govern every number below, and the second one is the reason an
 * earlier version of this file produced tactically correct formations that
 * still looked like a heap on screen:
 *
 *  1. Six players occupy six distinct zones. Volleyball is organised in
 *     thirds — left, middle, right — across two rows, and a team that is not
 *     visibly in six places is not playing a system.
 *
 *  2. Those zones must stay spread ACROSS the court. The camera is a flat side
 *     elevation, so the court's width is the compressed axis: two players who
 *     differ only slightly in `x` draw almost on top of each other. Formations
 *     that key off the ball — "everyone shifts towards the threat" — quietly
 *     collapse the whole team into one column whenever the ball is central,
 *     which is exactly where it is at every single serve. So the ball SHIFTS a
 *     zone; it never replaces it.
 */

/** The three lanes across the court, in metres from the middle. */
const LEFT = -2.95;
const MIDDLE = 0;
const RIGHT = 2.95;

/** How far the ball is allowed to drag a digger off their lane, in metres. */
const SHIFT = 0.85;

/**
 * Where a hitter takes off, across the court.
 *
 * Pulled in from the lane itself, because a hitter who jumps exactly on the
 * sideline swings a lot of balls past the antenna — and the setter aims here
 * too, so the ball and the approach agree. When they disagreed, the set went
 * to the lane and the hitter arrived short of it, which turned good attacks
 * into balls swiped off the edge of the hand and out.
 */
export const HITTER_PIN = 2.45;

/** Distance from the net at which a hitter leaves the floor. */
export const TAKEOFF_Y = 1.15;
/** Where the setter delivers the ball, and stands waiting for the pass. */
export const SETTER_X = 2.1;
export const SETTER_Y = 1.2;

/** Mirror a home-side tactical spot onto whichever side is playing. */
const spot = (side: Side, x: number, depth: number): Vec3 => {
  const dir = attackDir(side);
  return v3(dir > 0 ? x : -x, -dir * depth, 0);
};

/** Keep a lane inside the sidelines. */
const lane = (x: number): number => clamp(x, -COURT_HALF_WIDTH + 0.5, COURT_HALF_WIDTH - 0.5);

/**
 * The lane a rotation slot belongs to.
 *
 * The zones are numbered anticlockwise from the back right, so zones 2 and 1
 * are the right-hand column, 3 and 6 the middle, 4 and 5 the left. Deriving the
 * lane from the slot rather than from the role is what keeps six players in six
 * places no matter which rotation the team happens to be in.
 */
const frontLane = (slot: number): number => (slot === 4 ? LEFT : slot === 3 ? MIDDLE : RIGHT);

/**
 * Serve reception: the three-passer W.
 *
 * The passers take the left, middle and right thirds with the middle one
 * deepest, the setter releases to the net on the right and faces them, and the
 * front-row hitters stand off their pins clear of the passing lanes so they can
 * approach the moment the ball is up.
 */
export function receptionSpot(p: Player, passers: number[]): Vec3 {
  const side = p.side;
  const front = isFrontRow(p.rotationSlot);

  // The setter always ends up at the net, on the right, ready to set. From the
  // back row that means penetrating — running in as the serve is struck.
  if (p.role === 'setter') return spot(side, SETTER_X, SETTER_Y);

  const passIndex = passers.indexOf(p.id);
  if (passIndex >= 0) {
    const x = [LEFT, MIDDLE, RIGHT][passIndex] ?? MIDDLE;
    // The middle passer sits deepest: the serve that beats a W goes long
    // through the seam.
    return spot(side, x, passIndex === 1 ? 7.4 : 6.4);
  }

  // Not passing: wait where the approach starts, off the pin and clear of the
  // passing lanes behind.
  if (p.role === 'middle') return spot(side, MIDDLE - 0.5, front ? 1.6 : 5.4);
  if (p.role === 'opposite') return spot(side, RIGHT - 0.3, front ? 2.8 : 5.0);
  return spot(side, LEFT + 0.2, front ? 3.2 : 5.6);
}

/**
 * Building an attack: approach lanes for the hitters, an arc of cover behind
 * them for everyone else.
 *
 * Cover is the part that reads as organisation. A blocked ball comes straight
 * back down, and a team with players crouched behind its own hitter digs it up;
 * a team standing where it happened to be watches it land.
 */
export function attackSpot(p: Player, attacker: Player | null, ballX: number): Vec3 {
  const side = p.side;
  const dir = attackDir(side);
  const front = isFrontRow(p.rotationSlot);

  if (p.role === 'setter') return spot(side, SETTER_X, SETTER_Y);

  if (attacker && p.id === attacker.id) {
    // The hitter arrives at their pin: outside on the left, opposite on the
    // right, middle down the centre and much closer to the net.
    const pin =
      p.role === 'opposite' ? HITTER_PIN : p.role === 'middle' ? MIDDLE : -HITTER_PIN;
    return spot(side, pin, p.role === 'middle' ? 1.4 : 2.9);
  }

  // Where the swing is coming from, in our own frame of reference.
  const hitX = clamp((attacker ? attacker.pos.x : ballX) * dir, LEFT, RIGHT);

  // The other front-row player covers the inside shoulder of the hitter; the
  // back row keeps its three lanes and only leans towards the swing.
  if (front) return spot(side, lane(hitX + (hitX > 0 ? -1.7 : 1.7)), 2.7);
  if (p.role === 'middle' || p.role === 'libero') {
    return spot(side, lane(MIDDLE + hitX * 0.15), 6.6);
  }
  if (p.role === 'opposite') return spot(side, lane(RIGHT + hitX * 0.1), 5.4);
  return spot(side, lane(LEFT + hitX * 0.1), 5.4);
}

/**
 * Defending an attack: a two-man block on the ball, one player off the net for
 * the tip, and three diggers holding their lanes behind them.
 *
 * The block moves to the ball — that is its whole job. Everyone else keeps
 * their zone and leans, so the court stays covered left to right instead of
 * the whole team sliding into one column behind the block.
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
  // The threat in our own frame of reference. Their left pin is our right.
  const tx = clamp(threatX * dir, LEFT, RIGHT);

  const blockIndex = blockers.indexOf(p.id);
  if (blockIndex >= 0) {
    // Two blockers on the ball. The second sets up on the inside — towards the
    // middle of the court, which is where the angle is and therefore what a
    // block is there to take away.
    const offset = blockIndex === 0 ? 0 : tx > 0 ? -0.9 : 0.9;
    return spot(side, lane(tx + offset), 0.8);
  }

  if (front) {
    // Only ONE front player peels off the net for the tip, and only when a
    // block has actually formed. Sending every unassigned front player to the
    // same tip-cover spot is what stacked all three of them on the middle of
    // the court between rallies — three bodies in one place, which is the
    // single most visible way a team can look disorganised.
    if (blockers.length > 0) return spot(side, lane(-tx * 0.5), 3.3);
    return spot(side, lane(frontLane(p.rotationSlot) + tx * 0.2), 2.6);
  }

  // The three diggers hold left, middle and right and lean towards the swing.
  const deep = strongAttack ? 7.4 : 6.6;
  if (p.role === 'libero' || p.rotationSlot === 6) {
    return spot(side, lane(MIDDLE + tx * 0.2), deep + 0.6);
  }
  // The digger on the far side of the court from the block takes the sharp
  // cross-court angle and steps up for it; the one behind the block sits deep,
  // for the ball that comes off the hands and carries.
  const mine = p.rotationSlot === 5 ? LEFT : RIGHT;
  const behindBlock = mine > 0 === tx > 0;
  return spot(
    side,
    lane(mine + (tx / RIGHT) * SHIFT * (behindBlock ? 0.6 : -0.4)),
    behindBlock ? deep : deep - 1.0,
  );
}

/** Keep a tactical spot inside the court and off the net. */
export function legalSpot(side: Side, at: Vec3): Vec3 {
  const dir = attackDir(side);
  const y = clamp(Math.abs(at.y), 0.6, COURT_HALF_LENGTH + 0.4);
  return v3(clamp(at.x, -COURT_HALF_WIDTH + 0.3, COURT_HALF_WIDTH - 0.3), -dir * y, 0);
}
