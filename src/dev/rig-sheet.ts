/**
 * Side-by-side: the spike as the game draws it today, and the spike drawn by
 * the skeletal rig.
 *
 * Same action, same timeline, same page, so the difference is a matter of
 * looking rather than of argument.
 */
import { Player, defaultStats } from '../core/player';
import { Camera } from '../render/camera';
import { drawPlayer } from '../render/players';
import { SPIKE, drawRig, sampleRig } from '../render/rig';

const SAMPLE = 0.075;
const SIM_DT = 1 / 120;
const SPAN = 1.15;

function main(): void {
  const canvas = document.getElementById('sheet') as HTMLCanvasElement | null;
  if (!canvas) return;
  const params = new URLSearchParams(location.search);
  const cellW = Number(params.get('cell') ?? 260);
  const cellH = Math.round(cellW * 1.45);
  const cols = Math.ceil(SPAN / SAMPLE);
  const headerH = 38;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = cols * cellW + 20;
  const height = 2 * (cellH + headerH) + 20;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#141a26';
  ctx.fillRect(0, 0, width, height);

  const kit: [string, string] = ['#2f6fe0', '#0f1c3a'];
  const cam = new Camera();

  const cell = (row: number, col: number): { x: number; y: number; floorY: number } => {
    const x = 10 + col * cellW;
    const y = 10 + row * (cellH + headerH) + headerH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW - 2, cellH - 2);
    ctx.clip();
    ctx.fillStyle = col % 2 ? '#1a2231' : '#171e2b';
    ctx.fillRect(x, y, cellW - 2, cellH - 2);
    const floorY = y + cellH * 0.88;
    ctx.strokeStyle = 'rgba(120,200,150,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x + cellW, floorY);
    ctx.stroke();
    return { x, y, floorY };
  };

  const label = (row: number, text: string, note: string): void => {
    const y = 10 + row * (cellH + headerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, 12, y + 20);
    ctx.fillStyle = 'rgba(190,205,230,0.72)';
    ctx.font = '400 12px system-ui, sans-serif';
    ctx.fillText(note, 12 + ctx.measureText(text).width + 40, y + 20);
  };

  // ---- row 0: today's figure, driven exactly as the match drives it
  label(0, 'NOW', '3 poses · 4 joints per limb · no wrist, no ankle, no spine');
  {
    const p = new Player(1, 'home', 'outside', 'DEV', defaultStats());
    p.facing = 1;
    p.setAnim('idle');
    let t = 0;
    let next = 0;
    let col = 0;
    for (let i = 0; i <= Math.ceil(SPAN / SIM_DT); i++) {
      if (t >= next - 1e-6 && col < cols) {
        const c = cell(0, col);
        cam.resize(cellW * 4.4, cellH * 1.9);
        cam.panY = p.pos.y;
        const proj = cam.project(0, p.pos.y, 0);
        ctx.translate(c.x + cellW / 2 - proj.x, c.floorY - proj.y);
        drawPlayer(ctx, cam, { ...p, pos: { ...p.pos, x: 0 } } as unknown as Player, kit, {
          active: false,
          charge: 0,
          time: t,
          dt: SAMPLE,
        });
        ctx.restore();
        ctx.fillStyle = 'rgba(150,170,200,0.8)';
        ctx.font = '500 11px ui-monospace, monospace';
        ctx.fillText(`${col} · ${t.toFixed(2)}s`, c.x + 6, c.y + 15);
        col++;
        next += SAMPLE;
      }
      if (t > 0.2 && !p.airborne && p.height <= 0) p.jump();
      if (p.airborne && p.vertVel < 0 && p.swing <= 0 && p.anim !== 'spike') {
        p.setAnim('spike');
        p.swing = 0.3;
      }
      p.step(SIM_DT, 0, 0);
      t += SIM_DT;
    }
  }

  // ---- row 1: the rig
  label(1, 'RIG', '9 keyframes · 19 joints · wrist, ankle, articulated spine');
  for (let col = 0; col < cols; col++) {
    const t = col * SAMPLE;
    const c = cell(1, col);
    const pose = sampleRig(SPIKE, t);
    drawRig(ctx, c.x + cellW / 2, c.floorY, cellH * 0.52, pose, {
      kit: kit[0],
      trim: kit[1],
      skin: '#e8b184',
      hair: '#2a1f1a',
    });
    ctx.restore();
    ctx.fillStyle = 'rgba(150,170,200,0.8)';
    ctx.font = '500 11px ui-monospace, monospace';
    ctx.fillText(`${col} · ${t.toFixed(2)}s`, c.x + 6, c.y + 15);
  }
}

main();
