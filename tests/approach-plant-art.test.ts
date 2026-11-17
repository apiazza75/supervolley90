import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Player, defaultStats } from '../src/core/player';
import { GAME_SPEED } from '../src/core/rules';
import { approachFrameForPlayer, SpriteTimeline } from '../src/render/sprite-figure';
import { APPROACH_PLANT_FRAMES } from '../src/render/approach-steps';

describe('authored grounded arm sweep into attack takeoff', () => {
 it('preserves all original atlas pixels and registers four new whole-body drawings', () => {
  const manifest = JSON.parse(readFileSync('assets/source/manga-2026-09/approach-plant-generation.json','utf8'));
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  expect(hash('public/sprites/approach.png')).toBe(manifest.originalAtlasSha256);
  expect(hash('public/sprites/approach-plant.png')).toBe(manifest.runtimeSha256);
  expect(hash('assets/source/manga-2026-09/'+manifest.source)).toBe(manifest.sourceSha256);
  expect(APPROACH_PLANT_FRAMES).toEqual(manifest.sequence);
  expect(APPROACH_PLANT_FRAMES).not.toContain(21);
  expect(APPROACH_PLANT_FRAMES.filter(f=>f>=60)).toEqual([60,61,62,63]);
 });
 it.each([59.94,60,75,90,120,144])('moves forward through the plant at %s Hz without moving the planted athlete', hz => {
  const p = new Player(7,'home','outside','TEST',defaultStats());
  p.licenseApproach('attack',1,.49); p.anim = 'plant';
  let last = -1;
  const seen = new Set<number>();
  for (let t=0;t<.1;t+=GAME_SPEED/hz) {
   p.animTime=t;
   const state=JSON.stringify(p),s=approachFrameForPlayer(p),at=(APPROACH_PLANT_FRAMES as readonly number[]).indexOf(s.frame);
   expect(at).toBeGreaterThanOrEqual(last);last=at;seen.add(s.frame);
   expect(approachFrameForPlayer(p)).toEqual(s);
   expect(JSON.stringify(p)).toBe(state);
  }
  if (hz>=90) for (const f of [60,61,62,63]) expect(seen.has(f)).toBe(true);
  p.animTime=.1;expect(approachFrameForPlayer(p).frame).toBe(23);
 });
 it('never delays physical takeoff or the exact attack contact to finish the drawings', () => {
  for (let i=0;i<APPROACH_PLANT_FRAMES.length;i++) {
   const p = new Player(7,'home','outside','TEST',defaultStats()),clock=new SpriteTimeline();
   p.licenseApproach('attack',1,.49);p.anim='plant';p.animTime=(i+.1)/APPROACH_PLANT_FRAMES.length*.1;
   expect(clock.frameFor(p,0).frame).toBe(APPROACH_PLANT_FRAMES[i]);
   p.jump();expect(clock.frameFor(p,0).action).toBe('spike');
   clock.cue(p.id,'spike',true,1);expect(clock.frameFor(p,0)).toMatchObject({action:'spike',frame:18});
  }
 });
 it('does not skip drawings at exact physics-tick boundaries because of roundoff', () => {
  const p = new Player(7,'home','outside','TEST',defaultStats());
  p.anim='plant';
  for(let tick=0;tick<=12;tick++) {
   p.animTime=tick/120;
   expect(approachFrameForPlayer(p).frame).toBe(APPROACH_PLANT_FRAMES[Math.min(tick,11)]);
  }
 });
});
