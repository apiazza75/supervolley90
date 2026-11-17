import type {Player} from '../core/player';
import type {Playhead} from './sprite-figure';
import {DIVE_EXTENSION_TIME} from '../core/rules';

export const DIVE_TURN_FRAMES = [40,41,42] as const;
/** The fourth generated pose lowered the chest before the existing flight.
 * Preserve it in the atlas, but use the original complete push-off instead. */
export const DIVE_TURN_SEQUENCE = [...DIVE_TURN_FRAMES,0,1,2,3,4,5,6,7,8] as const;
const origins = new Set(['idle','walk','shuffle','backpedal','run','runBrake']);
interface State {last: Playhead; from?: -1 | 1; diving: boolean; startedAt?: number}

/** Authored right -> front -> left push-off, only for a reversal at takeoff.
 * The original flight clock/contact wins; no delayed save or body deformation. */
export class DiveTurn {
  private readonly states = new Map<number,State>();
  reset(id?: number): void {if(id===undefined)this.states.clear();else this.states.delete(id);}
  sample(p: Pick<Player,'id'|'facing'|'diving'|'anim'|'animTime'>, pose: Playhead): Playhead {
    const state=this.states.get(p.id),facing=pose.facing??(p.facing>=0?1:-1);
    const entering=p.diving&&p.anim==='dive'&&pose.action==='dive'&&pose.frame<9;
    let from=state?.from,startedAt=state?.startedAt;
    if(entering&&!state?.diving){
      from=pose.frame<4&&state&&origins.has(state.last.action)&&state.last.facing===-facing
        ? state.last.facing : undefined;
      startedAt=p.animTime;
    }
    if(!entering)from=undefined;
    // A display can first observe takeoff after its first physics step. Begin
    // with the incoming-facing drawing, never a skipped frontal pose. Complete
    // the original push-off after the torsion. An actual contact interrupts it.
    const index=Math.floor((p.animTime-(startedAt??p.animTime)+1e-9)/(DIVE_EXTENSION_TIME/9));
    const frame=DIVE_TURN_SEQUENCE[Math.min(DIVE_TURN_SEQUENCE.length-1,index)];
    const result=entering&&from!==undefined&&index>=0
      ? {...pose,frame,frameFloat:frame,facing:index<DIVE_TURN_FRAMES.length?from:facing}
      : pose;
    this.states.set(p.id,{last:{...result,facing:result.facing??facing},from,diving:entering,startedAt});
    return result;
  }
}
