/** Focused real-play capture. No position, pose, velocity or action overrides. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';
import { observeLocomotion } from './observe-locomotion';

const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/locomotion-review');
const onlyRun = process.argv.includes('--run-only');
const onlyShuffle = process.argv.includes('--shuffle-only');
if (onlyRun && onlyShuffle) throw new Error('Choose --run-only or --shuffle-only, not both');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  await page.evaluate(() => (window as any).__sv90.startDemoMatch(1337));
  let failures = 0;
  for (const locomotion of (onlyRun ? ['run'] : onlyShuffle ? ['shuffle'] : ['run', 'walk']) as ('run' | 'walk' | 'shuffle')[]) {
    const result = await observeLocomotion(page, locomotion, `Live ${locomotion}`, 45000);
    if (result.dataUrl) {
      writeFileSync(resolve(out, `${locomotion}.png`), Buffer.from(result.dataUrl.split(',')[1], 'base64'));
      delete result.dataUrl;
    }
    writeFileSync(resolve(out, `${locomotion}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ locomotion, completeCycle: result.completeCycle, playerId: result.playerId,
      distinctFrames: result.distinctAnimTicks, duration: result.durationSeconds, distance: result.distance }));
    if (!result.completeCycle) failures++;
  }
  await page.screenshot({ path: resolve(out, 'match.png') });
  if (failures) process.exitCode = 1;
} finally { await browser.close(); }
