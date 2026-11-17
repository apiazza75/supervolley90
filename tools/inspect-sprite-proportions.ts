/** Diagnostic crops of shipped drawings. This does not modify any game asset. */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runCandidate = process.argv.includes('--run-candidate');
const actionArg = process.argv.indexOf('--action');
const onlyAction = actionArg >= 0 ? process.argv[actionArg + 1] : undefined;
const framesArg = process.argv.indexOf('--frames');
const requestedFrames = framesArg >= 0 ? process.argv[framesArg + 1].split(',').map(Number) : undefined;
const outArg = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
const sheetArg = process.argv.find(arg => arg.startsWith('--sheet='))?.slice(8);
if (requestedFrames?.some(n => !Number.isInteger(n) || n < 0 || n > 23)) throw new Error('Frames must be 0..23');
const allActions = ['idle', 'walk', 'shuffle', 'turn', 'runTurn', 'turnStop', 'runBrake', 'backpedal', 'run', 'approach', 'bump', 'set', 'backSet', 'spike', 'spikeFollow', 'block', 'dive', 'serve', 'jumpServe', 'jumpServeFollow', 'celebrate'];
if (onlyAction && !allActions.includes(onlyAction)) throw new Error(`Unknown action: ${onlyAction}`);
const actions = runCandidate ? ['run'] : onlyAction ? [onlyAction] : allActions;
const contactFrames: Record<string, number> = { bump: 9, set: 9, backSet: 9, spike: 18, block: 16, dive: 9, serve: 15, jumpServe: 18 };
if (sheetArg && !onlyAction) throw new Error('--sheet requires --action');
const out = resolve(outArg ?? (runCandidate ? 'artifacts/gait-key-direction/proportions'
  : onlyAction ? `artifacts/attack-key-direction/${onlyAction}-proportions${requestedFrames ? '/selected' : ''}` : 'artifacts/art-direction/proportions'));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const sources = actions.flatMap(action => (requestedFrames ?? [contactFrames[action]]).map(contactFrame => ({ action, contactFrame, src: `data:image/png;base64,${readFileSync(sheetArg ? resolve(sheetArg) : runCandidate ? resolve('artifacts/gait-key-direction/run-candidate.png') : resolve('public/sprites', `${action}.png`)).toString('base64')}` })));
  const result = await page.evaluate(async sources => {
    const sheet = document.createElement('canvas');
    sheet.width = Math.min(sources.length, 4) * 512; sheet.height = Math.ceil(sources.length / 4) * 544;
    const ctx = sheet.getContext('2d')!;
    ctx.fillStyle = '#24363c'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    const heads = document.createElement('canvas'); heads.width = Math.min(sources.length, 3) * 576; heads.height = Math.ceil(sources.length / 3) * 480;
    const h = heads.getContext('2d')!;
    h.fillStyle = '#24363c'; h.fillRect(0, 0, heads.width, heads.height);
    const contacts = document.createElement('canvas'); contacts.width = Math.min(sources.length, 3) * 512; contacts.height = Math.ceil(sources.length / 3) * 544;
    const cc = contacts.getContext('2d')!; cc.fillStyle = '#24363c'; cc.fillRect(0, 0, contacts.width, contacts.height);
    let contactCount = 0;
    const rows: { action: string; frame: number; top: number; collarTop: number; headAndNeck: number; readyHeight: number }[] = [];
    for (const [i, { action, src, contactFrame }] of sources.entries()) {
      const img = new Image(); img.src = src; await img.decode();
      const cell = document.createElement('canvas'); cell.width = cell.height = 512;
      const frame = contactFrame ?? 0;
      const c = cell.getContext('2d')!; c.drawImage(img, frame % 6 * 512, Math.floor(frame / 6) * 512, 512, 512, 0, 0, 512, 512);
      if (contactFrame !== undefined) {
        const cx = contactCount % 3 * 512, cy = Math.floor(contactCount / 3) * 544;
        cc.drawImage(img, contactFrame % 6 * 512, Math.floor(contactFrame / 6) * 512, 512, 512, cx, cy + 32, 512, 512);
        cc.fillStyle = '#ffffff'; cc.font = '18px monospace'; cc.fillText(`${action} contact=${contactFrame}`, cx + 10, cy + 24);
        cc.font = '11px monospace';
        for (let line = 40; line < 512; line += 40) {
          cc.strokeStyle = '#496366'; cc.lineWidth = 1;
          cc.beginPath(); cc.moveTo(cx + 25, cy + 32 + line); cc.lineTo(cx + 507, cy + 32 + line); cc.stroke();
          cc.beginPath(); cc.moveTo(cx + line, cy + 57); cc.lineTo(cx + line, cy + 539); cc.stroke();
          cc.fillStyle = '#e8edf0'; cc.fillText(String(line), cx + 1, cy + 36 + line); cc.fillText(String(line), cx + line - 8, cy + 48);
        }
        contactCount++;
      }
      const rgba = c.getImageData(0, 0, 512, 512).data;
      let top = 512, bottom = 0;
      const blueByRow = new Uint32Array(512);
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const p = (y * 512 + x) * 4, [r, g, b, a] = rgba.slice(p, p + 4);
        if (a < 128) continue;
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        if (b > 55 && b > r + 18 && b > g + 12) blueByRow[y]++;
      }
      // Locate the first sustained shirt band, not a stray blue antialias pixel.
      let collarTop = top;
      for (let y = top; y < bottom; y++) {
        if (blueByRow[y] >= 8 && blueByRow[y + 1] >= 8 && blueByRow[y + 2] >= 8) { collarTop = y; break; }
      }
      rows.push({ action, frame, top, collarTop, headAndNeck: collarTop - top, readyHeight: bottom - top });
      const hx = i % 3 * 576, hy = Math.floor(i / 3) * 480;
      const headCropTop = Math.max(0, top - 20);
      h.drawImage(cell, 128, headCropTop, 288, 240, hx, hy, 576, 480);
      h.font = '18px monospace'; h.fillStyle = '#ffffff'; h.fillText(`${action} frame=${frame}`, hx + 8, hy + 21);
      for (let line = Math.ceil((headCropTop + 20) / 20) * 20; line < headCropTop + 240; line += 20) {
        const lineY = hy + (line - headCropTop) * 2;
        h.strokeStyle = '#527074'; h.lineWidth = 1;
        h.beginPath(); h.moveTo(hx + 40, lineY); h.lineTo(hx + 566, lineY); h.stroke();
        h.fillStyle = '#e8edf0'; h.fillText(String(line), hx + 5, lineY + 6);
      }
      const x = i % 4 * 512, y = Math.floor(i / 4) * 544;
      ctx.drawImage(cell, x, y + 32);
      ctx.font = '18px monospace'; ctx.fillStyle = '#e8edf0';
      ctx.fillText(`${action}  top=${top} collar=${collarTop}`, x + 12, y + 23);
      ctx.strokeStyle = '#68d7c2'; ctx.lineWidth = 1;
      for (const line of [top, collarTop, 470]) {
        ctx.beginPath(); ctx.moveTo(x + 40, y + 32 + line); ctx.lineTo(x + 470, y + 32 + line); ctx.stroke();
      }
    }
    return { rows, png: sheet.toDataURL('image/png'), heads: heads.toDataURL('image/png'), contacts: contacts.toDataURL('image/png') };
  }, sources);
  writeFileSync(resolve(out, requestedFrames ? 'selected-frames.png' : 'frame-zero.png'), Buffer.from(result.png.split(',')[1], 'base64'));
  writeFileSync(resolve(out, 'heads.png'), Buffer.from(result.heads.split(',')[1], 'base64'));
  writeFileSync(resolve(out, 'contacts.png'), Buffer.from(result.contacts.split(',')[1], 'base64'));
  writeFileSync(resolve(out, 'measurements.json'), JSON.stringify(result.rows, null, 2));
  console.log(JSON.stringify(result.rows, null, 2));
} finally { await browser.close(); }
