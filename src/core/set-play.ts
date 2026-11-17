import { Vec3, copy, distXY, v3 } from './math3';
import { Player, isFrontRow } from './player';
import { ATTACK_LINE, NET_HEIGHT, attackDir } from './rules';

/** The delivery changes both the available approach time and the attack lane. */
export type SetPlay = 'high' | 'quick' | 'back' | 'pipe' | 'feint';

export const SET_PLAY_NAMES: Record<SetPlay, string> = {
  high: 'PALLA ALTA',
  quick: 'VELOCE',
  back: 'ALZATA DIETRO',
  pipe: 'SECONDA LINEA',
  feint: 'FINTA E ALZATA DIETRO',
};

export interface SetPlan {
  play: SetPlay;
  target: Vec3;
  attackerId: number;
  /** A legal front-row jump without contact sells the quick before the backset. */
  decoyId?: number;
}

export function setTargetFor(hitter: Player, play: SetPlay): Vec3 {
  const dir = attackDir(hitter.side);
  const backRow = !isFrontRow(hitter.rotationSlot);
  const x = play === 'quick' || play === 'pipe' ? 0
    : play === 'back' || play === 'feint' ? 2.45
      : hitter.role === 'middle' ? 0 : hitter.role === 'opposite' ? 2.45 : -2.45;
  // The pipe is delivered behind the three-metre line. Its hitter can land
  // inside the front zone, but must leave the floor from behind that line.
  const depth = backRow || play === 'pipe' ? ATTACK_LINE + .75 : play === 'quick' ? 1.65 : 2.1;
  return v3(dir * x, -dir * depth, NET_HEIGHT + (play === 'quick' ? .8 : .95));
}

/** Nominal flight time; a long emergency pass never becomes an impossible quick. */
export function setFlightTime(play: SetPlay, from: Vec3, target: Vec3): number {
  const nominal: Record<SetPlay, number> = { high: 1.15, quick: .69, back: .94, pipe: 1.18, feint: 1.02 };
  return Math.max(nominal[play], distXY(from, target) / 8.5);
}

export function copySetPlan(plan: SetPlan): SetPlan {
  return { ...plan, target: copy(plan.target) };
}
