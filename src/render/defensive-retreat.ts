import type { Player } from '../core/player';
import { attackDir } from '../core/rules';
import { SHUFFLE_SPEED } from '../core/presentation';

/** A net-facing backwards gait, including backing off before an attack/set. */
export function isDefensiveRetreat(p: Player, bodyFacing = p.facing, retreating = false): boolean {
  const pr = p.presentation;
  if (!pr || pr.action !== 'none' || p.airborne || p.diving || p.height > .01
      || p.downTime > 0 || p.gettingUp > 0 || p.approaching) return false;
  // A tactical assignment is not a new physical gesture. When possession
  // changes, cover -> attack/set can happen while the same backward step is
  // still in progress. The action/approach guards above own actual skills.
  if (pr.sourceJob === 'idle' || pr.sourceJob === 'serve') return false;
  const speed = Math.hypot(p.vel.x, p.vel.y);
  const facing = bodyFacing >= 0 ? 1 : -1;
  // A pending turn may retain an existing backwards step, but must not insert
  // a new backwards pose between a lateral step and the illustrated pivot.
  if (!retreating && facing !== (p.facing >= 0 ? 1 : -1)) return false;
  // Independent axis acceleration briefly points diagonally even when the
  // requested step is lateral. Do not insert a backwards support drawing on
  // that transient velocity alone. A committed retreat keeps following its
  // real momentum; a new retreat still starts immediately when both the
  // steering and the movement are backwards. Recorded bodies may lack intent.
  const intent = p.locomotionIntent;
  const intentLength = intent ? Math.hypot(intent.x, intent.y) : 0;
  if (!retreating && intent && intentLength > .05
      && intent.y * facing >= -intentLength * .45) return false;
  // At walking pace a mostly lateral correction finishes its lateral foot
  // support. The final few centimetres of deceleration must not introduce a
  // single backwards drawing as the velocity angle steepens. A deliberate
  // backwards walk (or an already committed retreat) remains immediate.
  if (!retreating && intent && intentLength * p.runSpeed * .9 < SHUFFLE_SPEED
      && Math.abs(intent.x) > Math.abs(intent.y)) return false;
  // The athlete must be facing the net and actually travelling backwards;
  // lateral coverage and a run facing its destination keep their own art.
  // Separate entry/exit angles keep a shallow lateral acceleration from
  // flashing backpedal frame0, and avoid resetting the feet on angle noise.
  const backwardsFraction = retreating ? .25 : .45;
  return facing === attackDir(p.side) && speed > .12
    && p.vel.y * facing < -Math.max(.12, speed * backwardsFraction);
}
