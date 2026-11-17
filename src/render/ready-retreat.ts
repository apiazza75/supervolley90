import type {Playhead} from './sprite-figure';

/** Weight transfer before the first backward or lateral support, in the idle atlas unit. */
export const READY_RETREAT_FRAMES = [24,25,26,27] as const;
export const READY_LATERAL_FRAMES = [28,29,30,31] as const;
export const READY_RETREAT_DURATION = .10;
export function isReadyRetreatPose(pose?: {action: Playhead['action']; frame?: number}): boolean {
  return pose?.action === 'idle' && (READY_RETREAT_FRAMES as readonly number[]).includes(pose.frame ?? -1);
}
export function isReadyLateralPose(pose?: {action: Playhead['action']; frame?: number}): boolean {
  return pose?.action === 'idle' && (READY_LATERAL_FRAMES as readonly number[]).includes(pose.frame ?? -1);
}
/** Early loading drawings are still upright. A touch preparation must not
 * suddenly choose the deep-crouch entry before the knees have reached it. */
export function readyFootworkOrigin(pose?: {action: Playhead['action']; frame?: number}): 'standing' | 'retreat' | 'lateral' | undefined {
  if(isReadyRetreatPose(pose))return pose!.frame!>=26?'retreat':'standing';
  if(isReadyLateralPose(pose))return pose!.frame!>=30?'lateral':'standing';
  return undefined;
}
interface State {last: Playhead; age?: number; gait?: 'backpedal' | 'shuffle'}
export class ReadyRetreat {
  private readonly states = new Map<number,State>();
  lastPose(id:number): Playhead | undefined { return this.states.get(id)?.last; }
  reset(id?: number): void { if(id===undefined)this.states.clear();else this.states.delete(id); }
  sample(id:number,pose:Playhead,dt:number,allowed:boolean,fallbackFacing?:1|-1): {pose:Playhead;pinGait?:boolean} {
    const original=pose;
    if(pose.facing===undefined&&fallbackFacing!==undefined)pose={...pose,facing:fallbackFacing};
    let state=this.states.get(id);
    const active=state?.age!==undefined;
    const sameFacing=state?.last.facing===pose.facing;
    const target=pose.action==='backpedal'||pose.action==='shuffle'?pose.action:undefined;
    const gait=active?state!.gait:target;
    const stepping=target!==undefined&&target===gait;
    const canEnter=state?.last.frame===0 && (state.last.action==='idle'||state.last.action==='walk');
    if(!allowed||!sameFacing||(!stepping&&!(active&&pose.action==='idle'))||(!active&&!canEnter)) {
      this.states.set(id,{last:pose});return {pose:original};
    }
    if(active&&dt<=0)return {pose:state!.last,pinGait:true};
    const age=active?state!.age!+Math.max(0,dt)*(stepping?1:-1):0;
    if(age>=READY_RETREAT_DURATION || age<0) {
      const first={...pose,frame:0,frameFloat:0};this.states.set(id,{last:first});
      return {pose:first,pinGait:stepping};
    }
    const frames=gait==='shuffle'?READY_LATERAL_FRAMES:READY_RETREAT_FRAMES;
    const frame=frames[Math.min(3,Math.floor((age+1e-9)/READY_RETREAT_DURATION*4))];
    const entry:Playhead={...pose,action:'idle',frame,frameFloat:frame};
    state={last:entry,age,gait};this.states.set(id,state);return {pose:entry,pinGait:true};
  }
}
