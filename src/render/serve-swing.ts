import type { World } from '../core/world';
import { AIR_DRAG, FIXED_DT, GRAVITY, PLAYER_REACH } from '../core/rules';

/** Only the final shoulder extension belongs near the descending-ball window.
 * The athlete may wait with a cocked elbow, not with the strike already out. */
export const STANDING_SERVE_SWING_LEAD = .14;
/** Subdivide only the lowering of the tossing arm (old9 -> old10).
 * The other hand remains cocked; these are not contact or swing poses. */
export const STANDING_SERVE_TOSS_RELEASE_FRAMES = [9,36,37,38,39] as const;
// Source13 precedes new25: reversing those two retracts the elbow after it
// has already begun to unfold, even though their fingertip heights are close.
export const STANDING_SERVE_SWING_FRAMES = [12,24,13,25,26,27,14] as const;
// Authored intermediate shoulder/wrist angles preserve a continuous downward
// arc. The contact hold and total recovery duration remain unchanged.
export const STANDING_SERVE_FOLLOW_FRAMES = [15,28,40,41,29,16,30,42,43,31,17,18,19,20,21,22,23] as const;

/** Read-only, short look-ahead using the actual toss integration. Never queues
 * input or changes the ball/player/cue. Loaded jump serves have their own rise. */
export function standingServeSwingProgress(world: World): number {
  if (!world.serveTossInFlight) return 0;
  const server=world.team(world.servingSide).server;
  if (server.plansJumpServe || server.height > 0) return 0;
  if (world.serveStrikeReady) return 1;
  // A missed window must not rewind the arm while the same toss is falling.
  // The held-ball reset, not this predictor, starts the next preparation.
  if(world.serveTossElapsed>.2 && world.ball.vel.z<0 && world.ball.pos.z<PLAYER_REACH+.35) return 1;
  let {x,y,z}=world.ball.pos;
  let {x:vx,y:vy,z:vz}=world.ball.vel;
  for(let step=1;step*FIXED_DT<=STANDING_SERVE_SWING_LEAD+1e-9;step++){
    vx-=vx*AIR_DRAG*FIXED_DT;vy-=vy*AIR_DRAG*FIXED_DT;
    vz+=(GRAVITY-vz*AIR_DRAG)*FIXED_DT;
    x+=vx*FIXED_DT;y+=vy*FIXED_DT;z+=vz*FIXED_DT;
    const future=step*FIXED_DT;
    if(world.serveTossElapsed+future>.2 && vz<1.6 && z>1.55 && z<PLAYER_REACH+.35
      && Math.hypot(x-server.pos.x,y-server.pos.y)<1.9){
      return Math.max(0,1-future/STANDING_SERVE_SWING_LEAD);
    }
  }
  return 0;
}
