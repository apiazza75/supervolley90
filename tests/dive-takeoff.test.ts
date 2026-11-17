import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {DIVE_EXTENSION_TIME,DIVE_INITIAL_HEIGHT,DIVE_INITIAL_VELOCITY,FIXED_DT,GAME_SPEED,GRAVITY} from '../src/core/rules';
import {diveRenderHeight} from '../src/render/dive-takeoff';
import {Renderer} from '../src/render/renderer';
import {Camera} from '../src/render/camera';
import {drawSpritePlayer,playerSpriteDiagnostics,spriteContactPoint} from '../src/render/sprite-figure';
import {captureReplayPlayer} from '../src/game/replay';
import {SHEETS,type Sheet} from '../src/render/sprites';

const diver=()=>{const p=new Player(7,'home','outside','TEST',defaultStats());p.pos.y=-7;p.dive(.2,1);return p;};
const renderer=Object.create(Renderer.prototype) as Renderer;
const view=(p:Player,lead:number)=>(renderer as any).viewPlayer(p,lead) as Player;

describe('grounded illustrated push-off into a diving save',()=>{
 it('starts at floor level without changing collision clearance or velocity',()=>{
  const p=diver(),before=JSON.stringify(p);
  expect(p.height).toBe(DIVE_INITIAL_HEIGHT);expect(p.vertVel).toBe(DIVE_INITIAL_VELOCITY);
  expect(diveRenderHeight(p)).toBe(0);expect(JSON.stringify(p)).toBe(before);
 });
 it.each([59.94,60,75,90,120,144])('raises the body continuously at %s Hz and rejoins the same physical flight',hz=>{
  const p=diver();let acc=0,previous=0,steps=0,joined=false;
  for(let i=0;i<hz*.3;i++){
   acc+=GAME_SPEED/hz;while(acc>=FIXED_DT){p.step(FIXED_DT,0,0);acc-=FIXED_DT;}
   const shown=view(p,acc),before=JSON.stringify(p),height=diveRenderHeight(shown);
   const age=(DIVE_INITIAL_VELOCITY-shown.vertVel)/(-GRAVITY*1.15);
   if(age<=DIVE_EXTENSION_TIME){expect(height).toBeGreaterThanOrEqual(previous-1e-6);expect(height-previous).toBeLessThan(.075);}
   else {expect(height).toBe(shown.height);joined=true;}
   expect(height).toBeLessThanOrEqual(shown.height);expect(JSON.stringify(p)).toBe(before);
   previous=height;steps++;
  }
  expect(joined).toBe(true);expect(steps).toBeGreaterThan(10);
 });
 it('does not restart the push-off when an early save resets the animation clock',()=>{
  const p=diver();for(let i=0;i<4;i++)p.step(FIXED_DT,0,0);
  const height=diveRenderHeight(p);p.setAnim('dive_contact');
  expect(p.animTime).toBe(0);expect(diveRenderHeight(p)).toBe(height);
  const raw=Object.assign(Object.create(Object.getPrototypeOf(p)),p,{diving:false,anim:'idle'}) as Player;
  const difference=p.height-height;
  expect(spriteContactPoint(raw,'save',true).z-spriteContactPoint(p,'save',true).z).toBeCloseTo(difference,12);
 });
 it('does not alter any ordinary jump, floor slide or completed takeoff',()=>{
  const p=diver();p.diving=false;p.anim='block';expect(diveRenderHeight(p)).toBe(p.height);
  p.anim='down';p.height=0;expect(diveRenderHeight(p)).toBe(0);
  p.anim='dive';p.height=.38;p.vertVel=-.2;expect(diveRenderHeight(p)).toBe(p.height);
 });
 it('records the painted lift and does not apply the easing again in replay',()=>{
  const p=diver();p.step(FIXED_DT,0,0);const shown=view(p,FIXED_DT*.4),height=diveRenderHeight(shown);
  const pose={action:'dive' as const,frame:1,facing:1,renderedHeight:height};
  const saved=captureReplayPlayer(shown,pose);expect(saved.height).toBe(height);expect(shown.height).toBeGreaterThan(height);
  const sheet:Sheet={canvas:{} as HTMLCanvasElement,frames:Array.from({length:40},()=>({sx:0,sy:0,sw:512,sh:512,footX:256,footY:470,boxTop:20,boxBottom:470})),nativeBodyHeight:444,layout:SHEETS.dive,kitHue:220,variants:new Map()};
  const ctx={save(){},restore(){},translate(){},scale(){},drawImage(){}} as unknown as CanvasRenderingContext2D;
  const camera=new Camera();camera.resize(1280,720);
  const replay={...saved,id:1007} as unknown as Player;
  drawSpritePlayer(ctx,camera,replay,{dive:sheet},0,{},undefined,undefined,saved.sprite);
  expect(playerSpriteDiagnostics().find(s=>s.playerId===1007)?.renderedHeight).toBe(height);
 });
});
