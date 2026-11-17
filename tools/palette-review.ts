/** Real raster regression: roster identity must not paint costumes over skin. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const action = process.argv[2] ?? 'walk';
const actions = Object.keys(SHEETS);
if (!actions.includes(action)) throw new Error(`Unknown sprite action: ${action}`);
const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/palette-review');
const frames = (process.argv.find(arg => arg.startsWith('--frames='))?.slice(9) ?? '0,6,12,18').split(',').map(Number);
if (!frames.length || frames.some(n => !Number.isInteger(n) || n < 0 || n > 23)) throw new Error('Frames must be 0..23');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, actions.length, { timeout: 60000 });
  const result = await page.evaluate(async ({ action, frames }) => {
    (globalThis as any).__name = (fn: unknown) => fn;
    const modulePath = '/src/render/sprites.ts';
    const { kitCanvas, drawFrame } = await import(modulePath);
    const sheet = (window as any).__sv90.renderer.sheets[action];
    const original = sheet.canvas.getContext('2d').getImageData(0, 0, sheet.canvas.width, sheet.canvas.height).data;
    const mask = sheet.maskCanvas?.getContext('2d').getImageData(0, 0, sheet.canvas.width, sheet.canvas.height).data;
    const weight = (offset: number, channel: number): number => sheet.materialMask
      ? (sheet.materialMask.data[offset / 4] & (1 << channel) ? 255 : 0) : mask?.[offset + channel] ?? 0;
    let checkedSkinPixels = 0, changedSkinPixels = 0, changedAlphaPixels = 0;
    let clearBluePixels = 0, unmaskedClearBluePixels = 0, changedInkPixels = 0;
    const unmaskedBlueExamples: number[][] = [];
    for (let o = 0; o < original.length; o += 4) {
      const [r, g, b, a] = original.slice(o, o + 4);
      // A conservative RGB interior of the source kit's blue palette. This
      // also finds tiny isolated costume details omitted by the old size gate.
      if (a >= 200 && b >= 70 && b > r + 45 && b > g + 20 && g > r + 8) {
        clearBluePixels++;
        if (weight(o, 0) < 200) {
          unmaskedClearBluePixels++;
          if (unmaskedBlueExamples.length < 8) unmaskedBlueExamples.push([r, g, b, a]);
        }
      }
    }
    for (let signature = 0; signature < 7; signature++) {
      // Deliberately NO skin/hair recolour: team colours must leave them alone.
      const variant = kitCanvas(sheet, { primary: '#eb247b', secondary: '#e1e7ec', signature });
      const pixels = variant.getContext('2d').getImageData(0, 0, variant.width, variant.height).data;
      for (let o = 0; o < pixels.length; o += 4) {
        if (pixels[o + 3] !== original[o + 3]) changedAlphaPixels++;
        if (original[o + 3] >= 200 && Math.max(original[o], original[o + 1], original[o + 2]) < 10 &&
          (pixels[o] !== original[o] || pixels[o + 1] !== original[o + 1] || pixels[o + 2] !== original[o + 2])) changedInkPixels++;
        if (original[o + 3] < 200 || weight(o, 2) < 200 || weight(o, 0) > 0 || weight(o, 1) > 0) continue;
        checkedSkinPixels++;
        if (pixels[o] !== original[o] || pixels[o + 1] !== original[o + 1] || pixels[o + 2] !== original[o + 2]) changedSkinPixels++;
      }
    }
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = frames.length * 320 + 60;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#24383e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const variants = [
      { title: 'Disegno originale', palette: undefined },
      { title: 'Italia', palette: { primary: '#286adc', secondary: '#e3e5df', skin: '#a96d42', hair: '#1b1514', signature: 2 } },
      { title: 'Brasile', palette: { primary: '#e9ce32', secondary: '#278552', skin: '#c98b5a', hair: '#3a2418', signature: 3 } },
      { title: 'Libero', palette: { primary: '#cf4cb5', secondary: '#252545', skin: '#e4b184', hair: '#28212a', signature: 6 } },
    ];
    variants.forEach((variant, col) => {
      ctx.font = '20px system-ui'; ctx.fillStyle = '#e9edf1'; ctx.fillText(variant.title, col * 320 + 18, 28);
      frames.forEach((frame, row) => {
        drawFrame(ctx, sheet, frame, col * 320 + 156, row * 320 + 330, 140, 1, variant.palette);
        ctx.font = '13px monospace'; ctx.fillStyle = '#bcd0d5'; ctx.fillText(`frame ${frame + 1}`, col * 320 + 12, row * 320 + 61);
      });
    });
    return { action, checkedSkinPixels, changedSkinPixels, changedAlphaPixels, clearBluePixels, unmaskedClearBluePixels, unmaskedBlueExamples, changedInkPixels, png: canvas.toDataURL('image/png') };
  }, { action, frames });
  writeFileSync(resolve(out, `${action}-palettes.png`), Buffer.from(result.png.split(',')[1], 'base64'));
  const { png, ...metrics } = result;
  writeFileSync(resolve(out, `${action}-metrics.json`), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  if (metrics.checkedSkinPixels === 0 || metrics.changedSkinPixels !== 0 || metrics.changedAlphaPixels !== 0 ||
      metrics.clearBluePixels === 0 || metrics.unmaskedClearBluePixels !== 0 || metrics.changedInkPixels !== 0) process.exitCode = 1;
} finally { await browser.close(); }
