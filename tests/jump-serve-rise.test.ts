import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { FIXED_DT, GAME_SPEED } from '../src/core/rules';
import { Renderer } from '../src/render/renderer';
import { serveFrameForPlayer, SpriteTimeline } from '../src/render/sprite-figure';
import { JUMP_SERVE_RISE_FRAMES } from '../src/render/jump-serve-entry';

const service = { holding: false, holdSeconds: 0, tossElapsed: 1, jumping: true };
const player = () => {
 const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
 p.presentation.sourceJob = 'serve'; p.plansJumpServe = true; p.jump(); return p;
};

describe('illustrated jump-serve shoulder loading', () => {
 it.each([59.94,60,75,90,120,144])('plays all nine rising poses in order at %s Hz when the contact window allows it', hz => {
  const p = player(), frames: number[] = [];
  for (let t = 0; t < .18; t += GAME_SPEED / hz) {
   p.animTime = t; const before = JSON.stringify(p), s = serveFrameForPlayer(p, service);
   if (frames.at(-1) !== s.frame) frames.push(s.frame);
   expect(JSON.stringify(p)).toBe(before);
  }
  expect(frames).toEqual(JUMP_SERVE_RISE_FRAMES);
  p.animTime=.18; expect(serveFrameForPlayer(p, service).frame).toBe(17);
 });

 it('never delays an early real serve contact to finish the new arm poses', () => {
  for (let i = 0; i < JUMP_SERVE_RISE_FRAMES.length; i++) {
   const p = player(), clock = new SpriteTimeline(); p.animTime=(i+.1)/9*.18;
   expect(clock.frameFor(p, 0, undefined, service).frame).toBe(JUMP_SERVE_RISE_FRAMES[i]);
   clock.cue(p.id, 'serve', true, 1);
   expect(clock.frameFor(p, 0, undefined, service)).toMatchObject({ action: 'jumpServe', frame: 18 });
  }
 });

 it('uses fractional display time without changing the physical rise or contact', () => {
  const p=player(); p.animTime=.07;
  const renderer=Object.create(Renderer.prototype) as any, snapshot=JSON.stringify(p);
  const shown=renderer.viewPlayer(p,FIXED_DT*.8);
  expect(shown.animTime).toBeCloseTo(.07+FIXED_DT*.8,12);
  expect(JSON.stringify(p)).toBe(snapshot);
  expect(renderer.viewPlayer(p,0)).toBe(p);
 });
});
