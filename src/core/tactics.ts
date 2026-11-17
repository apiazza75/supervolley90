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

/** Three named passers, stable for the rotation; the setter is released. */
export function servePassers(players: readonly Player[]): number[] {
  const dir = attackDir(players[0].side);
  const priority = (p: Player): number => p.role === 'libero' ? 0 : p.role === 'outside' ? 1 : 2;
  return players.filter(p => p.role !== 'setter' && !(p.role === 'middle' && isFrontRow(p.rotationSlot)))
    .sort((a, b) => priority(a) - priority(b) || a.id - b.id).slice(0, 3)
    .sort((a, b) => a.home.x * dir - b.home.x * dir || a.id - b.id).map(p => p.id);
}

/** Assign distinct specialist lanes AFTER the serve, not three copies of a role spot. */
function specialistLanes(players: readonly Player[], front: boolean): Map<number, number> {
  const rank = (p: Player): number => p.role === 'outside' ? 0
    : p.role === 'middle' || p.role === 'libero' ? 1 : 2;
  const row = players.filter(p => isFrontRow(p.rotationSlot) === front)
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  return new Map(row.map((p, i) => [p.id, [LEFT, MIDDLE, RIGHT][i]]));
}

/** Weighted ordered fit: preserve the passers' lanes while respecting rotation. */
function orderedRow(xs: number[], weights: number[]): number[] {
  const gap = 0.65;
  const pools: { from: number; to: number; weight: number; sum: number }[] = [];
  xs.forEach((x, i) => {
    pools.push({ from: i, to: i, weight: weights[i], sum: (x - i * gap) * weights[i] });
    while (pools.length > 1) {
      const right = pools.at(-1)!, left = pools.at(-2)!;
      if (left.sum / left.weight <= right.sum / right.weight) break;
      pools.splice(-2, 2, { from: left.from, to: right.to, weight: left.weight + right.weight, sum: left.sum + right.sum });
    }
  });
  const out = xs.slice();
  for (const pool of pools) for (let i = pool.from; i <= pool.to; i++) {
    out[i] = clamp(pool.sum / pool.weight, -3.9, 3.9 - (xs.length - 1) * gap) + i * gap;
  }
  return out;
}

/** Set up BEFORE the whistle. No penetration or switches until the serve is struck. */
export function serveFormation(players: readonly Player[], serving: boolean): Map<number, Vec3> {
  const side = players[0].side, dir = attackDir(side);
  const passers = servePassers(players);
  const positions = new Map<number, Vec3>();
  for (const p of players) {
    const front = isFrontRow(p.rotationSlot), index = passers.indexOf(p.id);
    const x = frontLane(p.rotationSlot === 5 ? 4 : p.rotationSlot === 6 ? 3 : p.rotationSlot);
    if (serving) positions.set(p.id, spot(side, x, front ? 0.95 : p.rotationSlot === 6 ? 6.8 : 6.1));
    else if (index >= 0) positions.set(p.id, spot(side, [LEFT, MIDDLE, RIGHT][index], index === 1 ? 6.9 : 6.2));
    else positions.set(p.id, spot(side, x, front ? 1.35 : p.role === 'setter' ? 2.1 : 4.8));
  }
  if (!serving) {
    for (const slots of [[4, 3, 2], [5, 6, 1]]) {
      const row = slots.map(slot => players.find(p => p.rotationSlot === slot)!);
      const xs = orderedRow(row.map(p => positions.get(p.id)!.x * dir), row.map(p => passers.includes(p.id) ? 12 : 1));
      row.forEach((p, i) => { positions.get(p.id)!.x = xs[i] * dir; });
    }
    for (const [frontSlot, backSlot] of [[4, 5], [3, 6], [2, 1]]) {
      const front = players.find(p => p.rotationSlot === frontSlot)!;
      const back = players.find(p => p.rotationSlot === backSlot)!;
      const depth = Math.max(Math.abs(positions.get(back.id)!.y), Math.abs(positions.get(front.id)!.y) + 0.85);
      positions.get(back.id)!.y = -dir * Math.min(8.1, depth);
    }
  }
  return positions;
}

export function attackerLane(p: Player): number {
  return p.role === 'middle' ? 0 : p.role === 'opposite' ? HITTER_PIN : -HITTER_PIN;
}

/** 5-1 transition: one setter, one selected hitter, distinct cover lanes. */
export function attackFormation(players: readonly Player[], attackerId: number, attackX: number, _touches: number): Map<number, Vec3> {
  const side = players[0].side, dir = attackDir(side), hitX = clamp(attackX * dir, LEFT, RIGHT);
  const front = specialistLanes(players, true), back = specialistLanes(players, false);
  const backAttack = !front.has(attackerId);
  const positions = new Map<number, Vec3>();
  const frontCover = players.filter(p => front.has(p.id) && p.id !== attackerId && p.role !== 'setter')
    .sort((a, b) => Math.abs(front.get(a.id)! - hitX) - Math.abs(front.get(b.id)! - hitX));
  for (const p of players) {
    if (p.role === 'setter') positions.set(p.id, spot(side, SETTER_X, SETTER_Y));
    else if (p.id === attackerId) positions.set(p.id, spot(side, attackerLane(p), 3.7));
    else if (front.has(p.id)) {
      const coverIndex = frontCover.findIndex(q => q.id === p.id);
      // The named receiver owns the first ball; the other front-row players
      // can clear the planned hitter's route during its flight. Waiting for
      // the pass contact left only a quick set's fraction of a second to move
      // several metres, so those bodies were still under the eventual jump.
      // A pipe has three front-row teammates available. Keep all three in
      // distinct lanes ahead of its route; the former two-cover template sent
      // two to the same destination and pulled the middle through the jump.
      positions.set(p.id, backAttack ? spot(side, front.get(p.id)!, front.get(p.id) === 0 ? 1.0 : 1.45)
        : coverIndex === 0 ? spot(side, hitX * 0.42, 3.05)
          : spot(side, hitX >= 0 ? LEFT + 0.5 : RIGHT - 0.5, 4.25));
    } else {
      const ownLane = back.get(p.id)!;
      positions.set(p.id, spot(side, lane(ownLane + hitX * 0.08), ownLane === 0 ? 6.8 : 5.75));
    }
  }
  return positions;
}

/** Keep a cover destination behind and clear of the planned landing lane.
 * This is a tactical floor position, never a screen-space sprite displacement.
 * Adding (radius - distance) to depth fails when starting IN FRONT of the
 * hitter: it can move a setter even closer to the landing point. Solve the
 * required back depth using the already-assigned lateral lane instead.
 */
export function clearAttackLanding(side: Side, target: Vec3, attack: Vec3, radius = 1.95): Vec3 {
  const cover = legalSpot(side, target), dir = attackDir(side);
  const lateral = Math.abs(cover.x - attack.x);
  if (lateral >= radius) return cover;
  const behind = Math.sqrt(radius * radius - lateral * lateral);
  const depth = Math.max(-dir * cover.y, -dir * attack.y + behind);
  return legalSpot(side, v3(cover.x, -dir * depth, 0));
}

/** Read the set with the block; the back row keeps three distinct responsibilities. */
export function defenceFormation(players: readonly Player[], threatX = 0, blockers: number[] = []): Map<number, Vec3> {
  const side = players[0].side, dir = attackDir(side), tx = clamp(threatX * dir, LEFT, RIGHT);
  const front = specialistLanes(players, true), back = specialistLanes(players, false);
  const tipCover = players.filter(p => front.has(p.id) && !blockers.includes(p.id))
    .sort((a, b) => Math.abs(front.get(a.id)! + tx) - Math.abs(front.get(b.id)! + tx));
  return new Map(players.map(p => {
    const index = blockers.indexOf(p.id);
    let position: Vec3;
    if (index >= 0) position = spot(side, lane(tx + (index === 0 ? 0 : tx > 0 ? -0.9 : 0.9)), 0.8);
    else if (front.has(p.id)) position = !blockers.length ? spot(side, front.get(p.id)!, 0.95)
      : tipCover[0]?.id === p.id ? spot(side, lane(-tx * 0.5), 3.3)
        : spot(side, front.get(p.id)! * 0.8, 4.35);
    else {
      const ownLane = back.get(p.id)!;
      const behindBlock = ownLane !== 0 && (ownLane > 0) === (tx > 0);
      position = spot(side, lane(ownLane + tx * 0.12), ownLane === 0 ? 7.2 : behindBlock ? 6.7 : 5.9);
    }
    return [p.id, position];
  }));
}

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

  // The other front-row player covers the inside shoulder of the hitter, but
  // from a full step deeper. At 2.7 m this body drew almost underneath a real
  // spike in the side-on camera, so the viewer still read the play as "several
  // attackers on the ball" even when only one hitter had the attack job.
  if (front) return spot(side, lane(hitX + (hitX > 0 ? -2.05 : 2.05)), 4.7);
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
