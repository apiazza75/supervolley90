import {describe,it,expect} from 'vitest';
import {Player,defaultStats} from '../src/core/player';
import {Camera} from '../src/render/camera';
import {SHEETS,type Sheet} from '../src/render/sprites';
import {beginRenderFrame,drawSpritePlayer,playerSpriteDiagnostics,playerSpriteScreenTop,resetRenderStats} from '../src/render/sprite-figure';

const sheet:Sheet={canvas:{} as HTMLCanvasElement,
 frames:Array.from({length:24},()=>({sx:0,sy:0,sw:512,sh:512,footX:256,footY:470,boxTop:15,boxBottom:470})),
 nativeBodyHeight:SHEETS.idle.nativeBodyHeight!,layout:SHEETS.idle,kitHue:220,variants:new Map()};
const ctx={save(){},restore(){},translate(){},scale(){},drawImage(){}} as unknown as CanvasRenderingContext2D;
const cam=new Camera();cam.resize(1280,720);
function draw(id:number){const p=new Player(id,'home','outside','TEST',defaultStats());p.pos.y=-3;
 expect(drawSpritePlayer(ctx,cam,p,{idle:sheet},0,{},'idle')).toBe(true);}

describe('current display-frame sprite diagnostics',()=>{
 it('does not count replay ghosts after returning to live play',()=>{
  resetRenderStats();beginRenderFrame();draw(7);
  expect(playerSpriteDiagnostics().map(p=>p.playerId)).toEqual([7]);
  beginRenderFrame();draw(1007);
  expect(playerSpriteDiagnostics().map(p=>p.playerId)).toEqual([1007]);
  beginRenderFrame();draw(7);
  expect(playerSpriteDiagnostics().map(p=>p.playerId)).toEqual([7]);
  expect(playerSpriteScreenTop(7)).toBeTypeOf('number');
  expect(playerSpriteScreenTop(1007)).toBeUndefined();
 });
 it('retires substituted players and exposes a genuinely missing body',()=>{
  resetRenderStats();beginRenderFrame();draw(1);draw(2);
  beginRenderFrame();draw(6);draw(2);
  expect(playerSpriteDiagnostics().map(p=>p.playerId)).toEqual([6,2]);
  beginRenderFrame();draw(2);
  expect(playerSpriteDiagnostics().map(p=>p.playerId)).toEqual([2]);
  expect(playerSpriteScreenTop(6)).toBeUndefined();
 });
 it('keeps a repeated paused redraw observational and starts an empty frame empty',()=>{
  resetRenderStats();beginRenderFrame();draw(7);const first=playerSpriteDiagnostics();
  beginRenderFrame();expect(playerSpriteDiagnostics()).toEqual([]);draw(7);
  expect(playerSpriteDiagnostics()).toEqual(first);
 });
});
