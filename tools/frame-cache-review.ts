/** Byte-for-byte material/alpha equivalence of lazy frames versus old atlases. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHEETS } from '../src/render/sprites';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:5176/');
  await page.waitForFunction(n => Object.keys((window as any).__sv90?.renderer?.sheets ?? {}).length === n, Object.keys(SHEETS).length, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const modulePath = '/src/render/sprites.ts';
    const { kitCanvas, frameKitTile, frameVariantStats } = await import(modulePath);
    const sheets = (window as any).__sv90.renderer.sheets;
    const results = [];
    const palettes = [
      { primary: '#286adc', secondary: '#e3e5df', skin: '#a96d42', hair: '#1b1514', signature: 2 },
      { primary: '#cf4cb5', secondary: '#252545', signature: 6 },
    ];
    for (const [action, sheet] of Object.entries(sheets) as [string, any][]) {
      let comparedBytes = 0, mismatchedBytes = 0, cacheHits = 0, cachedPixels = 0, fullPixels = 0;
      for (const palette of palettes) {
        const full = kitCanvas(sheet, palette);
        for (let index = 0; index < sheet.frames.length; index++) {
          const f = sheet.frames[index];
          const old = full.getContext('2d')!.getImageData(f.sx, f.sy, f.sw, f.sh).data;
          const tile = frameKitTile(sheet, index, palette);
          const restored = document.createElement('canvas'); restored.width=f.sw; restored.height=f.sh;
          restored.getContext('2d')!.drawImage(tile.canvas,tile.x,tile.y);
          const pixels = restored.getContext('2d')!.getImageData(0, 0, f.sw, f.sh).data;
          cachedPixels += tile.width*tile.height; fullPixels += f.sw*f.sh;
          if (tile.canvas === frameKitTile(sheet, index, palette).canvas) cacheHits++;
          if (old.length !== pixels.length) throw new Error(`${action}/${index}: dimensions changed`);
          for (let i = 0; i < old.length; i++) { comparedBytes++; if (old[i] !== pixels[i]) mismatchedBytes++; }
        }
      }
      results.push({ action, frames: sheet.frames.length, comparedBytes, mismatchedBytes, cacheHits, cachedPixels, fullPixels });
    }
    return { results, cache: { ...frameVariantStats }, bounded: frameVariantStats.bytes <= frameVariantStats.byteLimit };
  });
  const out = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'artifacts/render-performance');
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'frame-cache-equivalence.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.bounded || result.results.some(r => r.mismatchedBytes > 0 || r.cacheHits !== r.frames * 2)) process.exitCode = 1;
} finally { await browser.close(); }
