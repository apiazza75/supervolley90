import { Ball } from './ball';
import { canReach, contactQuality } from './contact';
import { copy } from './math3';
import { Player } from './player';
import { attackDir, FIXED_DT } from './rules';

/** Read a loose incoming ball before a planted defender's tactical job changes.
 * Select one probable passer, not every nearby teammate. This is anticipation
 * only: no action input, reach extension, contact delay or body/ball mutation.
 * Travelling defenders still use their assigned movement/preparation logic;
 * these platform drawings require feet already planted on the floor.
 */
export function looseBallReader(incoming: Ball, defenders: readonly Player[]): number | undefined {
  if (incoming.frozen || incoming.grounded) return;
  const candidates = defenders.filter(p => p.canAct && p.height === 0 && !p.diving
    && p.blockPreparationAge === undefined && !p.approaching
    && Math.hypot(p.vel.x, p.vel.y) < .12
    && incoming.vel.y * attackDir(p.side) < 0
    && (p.presentation.action === 'none' || p.presentation.action === 'bump' && p.presentation.phase === 'prepare'));
  if (!candidates.length) return;
  const ball = new Ball();
  ball.pos = copy(incoming.pos); ball.vel = copy(incoming.vel); ball.spin = copy(incoming.spin);
  ball.touchCooldown = incoming.touchCooldown;
  for (let i = 0; i < 36; i++) {
    ball.step(FIXED_DT);
    if (ball.grounded) return;
    if (ball.touchCooldown > 0) continue;
    let best: Player | undefined, quality = -1;
    for (const p of candidates) {
      if (ball.pos.y * attackDir(p.side) > 0 || !canReach(p, ball)) continue;
      const q = contactQuality(p, ball);
      if (q > quality) { best = p; quality = q; }
    }
    if (best) return best.id;
  }
}
