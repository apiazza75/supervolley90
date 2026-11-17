import { Ball } from './ball';
import { contactRadius, contactWindow } from './contact';
import { approach, copy, distXY } from './math3';
import { Player } from './player';
import { FIXED_DT, PLAYER_FRICTION, attackDir } from './rules';

/** Can the assigned passer brake normally and still meet the incoming ball?
 * Predict the actual friction and ball forces; never pin a body in place,
 * widen its reach, or stop a late receiver who still needs to travel.
 */
export function canPlantForGroundContact(p: Player, incoming: Ball): boolean {
  if (incoming.frozen || incoming.grounded || p.height > 0 || p.diving
    || p.downTime > 0 || p.gettingUp > 0) return false;
  const ball = new Ball();
  ball.pos = copy(incoming.pos); ball.vel = copy(incoming.vel); ball.spin = copy(incoming.spin);
  const position = copy(p.pos), velocity = copy(p.vel), window = contactWindow(p);
  for (let i = 0; i < 36; i++) {
    velocity.x = approach(velocity.x, 0, PLAYER_FRICTION * FIXED_DT);
    velocity.y = approach(velocity.y, 0, PLAYER_FRICTION * FIXED_DT);
    position.x += velocity.x * FIXED_DT; position.y += velocity.y * FIXED_DT;
    ball.step(FIXED_DT);
    if (ball.grounded) return false;
    if (ball.pos.y * attackDir(p.side) > 0.05) continue;
    if (ball.pos.z < window.lo || ball.pos.z > window.hi
      || distXY(position, ball.pos) > contactRadius(p, ball)) continue;
    // An early edge of the reach envelope may arrive before the feet stop.
    // Keep predicting: if a later sample is still reachable after ordinary
    // braking, the setter can safely plant rather than touch on that first
    // moving frame. Emergency balls that leave the envelope still return false.
    if (Math.hypot(velocity.x, velocity.y) < .1) return true;
  }
  return false;
}

// Keep the reception call site explicit while sharing the same physical
// arrival/braking prediction with a setter. Neither action gets extra reach.
export const canPlantForReceive = canPlantForGroundContact;
