/**
 * Measure a drawn sheet's geometry instead of guessing it.
 *
 * The margins, the cell grid and the floor line were first written from
 * looking at a picture, which is exactly how a sprite ends up floating an inch
 * above the ground or wearing the frame number on its shoulder. This reports
 * the numbers the loader needs, read off the pixels:
 *
 *   - where the dark chrome ends and the grid of cells begins
 *   - where each cell's border falls
 *   - where the wooden floor strip sits inside a cell, which is the line the
 *     figures actually stand on
 *
 *   CHROMIUM_PATH=... npx tsx tools/measure-sheet.ts [file...]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

interface Report {
  width: number;
  height: number;
  chrome: { top: number; bottom: number; left: number; right: number };
  rowEdges: number[];
  colEdges: number[];
  floorPerRow: number[];
}

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['public/sprites/spike.png'];

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  // tsx compiles with esbuild's keepNames, which emits a `__name` helper into
  // the evaluated body. That helper lives in the Node bundle, not in the page.
  await page.evaluate('globalThis.__name = (f) => f');

  for (const file of FILES) {
    const data = readFileSync(resolve(file)).toString('base64');
    const r: Report = await page.evaluate(async (b64) => {
      const img = new Image();
      await new Promise((res) => {
        img.onload = res;
        img.src = `data:image/png;base64,${b64}`;
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const at = (x: number, y: number): number[] => {
        const i = (y * c.width + x) * 4;
        return [d[i], d[i + 1], d[i + 2]];
      };
      // "Paper" is the near-white the frames are drawn on. The chrome around
      // and between them is dark, so the fraction of paper in a row or column
      // is what separates grid from border.
      const paperInRow = (y: number): number => {
        let n = 0;
        for (let x = 0; x < c.width; x++) {
          const [r0, g0, b0] = at(x, y);
          if (r0 > 200 && g0 > 200 && b0 > 195) n++;
        }
        return n / c.width;
      };
      const paperInCol = (x: number): number => {
        let n = 0;
        for (let y = 0; y < c.height; y++) {
          const [r0, g0, b0] = at(x, y);
          if (r0 > 200 && g0 > 200 && b0 > 195) n++;
        }
        return n / c.height;
      };

      let top = 0;
      while (top < c.height && paperInRow(top) < 0.3) top++;
      let bottom = c.height - 1;
      while (bottom > 0 && paperInRow(bottom) < 0.3) bottom--;
      let left = 0;
      while (left < c.width && paperInCol(left) < 0.3) left++;
      let right = c.width - 1;
      while (right > 0 && paperInCol(right) < 0.3) right--;

      // Interior borders: runs of rows/columns that are mostly NOT paper.
      const edges = (a: number, b: number, f: (i: number) => number): number[] => {
        const out: number[] = [];
        let run = -1;
        for (let i = a; i <= b; i++) {
          const dark = f(i) < 0.3;
          if (dark && run < 0) run = i;
          if (!dark && run >= 0) {
            out.push(Math.round((run + i - 1) / 2));
            run = -1;
          }
        }
        if (run >= 0) out.push(Math.round((run + b) / 2));
        return out;
      };
      const rowEdges = edges(top, bottom, paperInRow);
      const colEdges = edges(left, right, paperInCol);

      // The wooden strip: rows inside a cell band that are strongly warm
      // (orange/tan) across most of the width. Its top edge is the floor.
      const bands = [top, ...rowEdges, bottom];
      const floorPerRow: number[] = [];
      for (let k = 0; k + 1 < bands.length; k++) {
        const y0 = bands[k];
        const y1 = bands[k + 1];
        if (y1 - y0 < 40) continue;
        let floor = -1;
        for (let y = y1; y > y0; y--) {
          let warm = 0;
          for (let x = left; x <= right; x += 3) {
            const [r0, g0, b0] = at(x, y);
            if (r0 > 120 && r0 - b0 > 35 && g0 > b0) warm++;
          }
          const frac = warm / ((right - left) / 3);
          if (frac > 0.5) floor = y;
          else if (floor >= 0) break;
        }
        floorPerRow.push(floor < 0 ? y1 : floor);
      }
      return {
        width: c.width,
        height: c.height,
        chrome: { top, bottom, left, right },
        rowEdges,
        colEdges,
        floorPerRow,
      };
    }, data);

    const { width: W, height: H, chrome } = r;
    const gh = chrome.bottom - chrome.top;
    console.log(`\n=== ${basename(file)}  ${W}x${H}`);
    console.log(
      `chrome  top=${chrome.top} (${(chrome.top / H).toFixed(4)})  ` +
        `bottom=${H - 1 - chrome.bottom} (${((H - 1 - chrome.bottom) / H).toFixed(4)})  ` +
        `left=${chrome.left} (${(chrome.left / W).toFixed(4)})  ` +
        `right=${W - 1 - chrome.right} (${((W - 1 - chrome.right) / W).toFixed(4)})`,
    );
    console.log(`row edges: ${r.rowEdges.join(', ')}`);
    console.log(`col edges: ${r.colEdges.join(', ')}`);
    const ch = gh / 4;
    console.log(
      `floor per row: ${r.floorPerRow.join(', ')}  ->  baseline fractions: ` +
        r.floorPerRow
          .map((f, i) => ((f - (chrome.top + i * ch)) / ch).toFixed(3))
          .join(', '),
    );
  }
  await browser.close();
}

void main();
