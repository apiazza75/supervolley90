import {clamp} from '../core/math3';
import {DIVE_EXTENSION_TIME,DIVE_INITIAL_HEIGHT,DIVE_INITIAL_VELOCITY,GRAVITY} from '../core/rules';
import type {Player} from '../core/player';

/** Draw the grounded push-off instead of exposing the collision trajectory's
 * instantaneous 35cm initial clearance. The physical player is never changed.
 * Ballistic velocity is a continuous clock even when a save resets animTime.
 * By full arm extension the drawing rejoins the original trajectory exactly. */
export function diveRenderHeight(p: Pick<Player,'height'|'vertVel'|'anim'> & {diving?:boolean}): number {
 if(p.height<=0||!(p.diving||p.anim==='dive'||p.anim==='dive_contact'))return p.height;
 const age=Math.max(0,(DIVE_INITIAL_VELOCITY-p.vertVel)/(-GRAVITY*1.15));
 const u=clamp(age/DIVE_EXTENSION_TIME,0,1),ease=u*u*(3-2*u);
 return Math.max(0,p.height-DIVE_INITIAL_HEIGHT*(1-ease));
}
