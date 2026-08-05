/**
 * Placeholder sprite sheets, rendered from the vector figure.
 *
 * The sprite pipeline cannot be trusted until something has actually gone
 * through it, and the drawn art does not exist in this repository yet. So this
 * renders the game's own figure into sheets with EXACTLY the layout the drawn
 * ones use — title bar, 6x4 grid of 24 frames, footer, white paper — which
 * exercises every part of the loader: the keying, the slicing, the foot
 * measurement, the frame timing.
 *
 * The art is placeholder. The pipeline it proves is not.
 */
import { Player, defaultStats } from '../core/player';
import { Camera } from '../render/camera';
import { drawPlayer } from '../render/players';
import { SHEETS, SpriteAction } from '../render/sprites';

const W = 1456;
const H = 1080;

interface Recipe {
  span: number;
  step: (p: Player, dt: number, t: number, span: number) => void;
}

const RECIPES: Record<SpriteAction, Recipe> = {
  idle: { span: 1.6, step: (p, dt) => p.step(dt, 0, 0) },
  approach: { span: 0.75, step: (p, dt) => p.step(dt, 0, 1) },
  spike: {
    span: 1.1,
    step: (p, dt, t) => {
      if (t > 0.18 && !p.airborne && p.height <= 0) p.jump();
      if (p.airborne && p.vertVel < 0 && p.swing <= 0 && p.anim !== 'spike') {
        p.setAnim('spike');
        p.swing = 0.3;
      }
      p.step(dt, 0, 0);
    },
  },
  block: {
    span: 1.0,
    step: (p, dt, t) => {
      if (t > 0.18 && !p.airborne && p.height <= 0) {
        p.jump();
        p.setAnim('block');
      }
      p.step(dt, 0, 0);
    },
  },
  bump: {
    span: 0.85,
    step: (p, dt, t) => {
      if (t > 0.3 && p.anim !== 'bump') {
        p.setAnim('bump');
        p.swing = 0.22;
      }
      p.step(dt, 0, 0);
    },
  },
  set: {
    span: 0.9,
    step: (p, dt, t) => {
      if (t > 0.3 && p.anim !== 'set') {
        p.setAnim('set');
        p.swing = 0.22;
      }
      p.step(dt, 0, 0);
    },
  },
  dive: {
    span: 1.3,
    step: (p, dt, t) => {
      if (t > 0.12 && t < 0.13) p.dive(0, 1);
      p.step(dt, 0, 0);
    },
  },
  serve: {
    span: 1.6,
    step: (p, dt, t) => {
      if (t > 0.5 && p.anim !== 'serve') p.setAnim('serve');
      p.step(dt, 0, 0);
    },
  },
  jumpServe: {
    span: 1.5,
    step: (p, dt, t) => {
      if (t > 0.4 && !p.airborne && p.height <= 0) p.jump();
      if (p.airborne && p.vertVel < 0 && p.swing <= 0 && p.anim !== 'spike') {
        p.setAnim('spike');
        p.swing = 0.3;
      }
      p.step(dt, 0, 0);
    },
  },
  celebrate: {
    span: 1.6,
    step: (p, dt, t) => {
      if (t > 0.15 && p.cheerTime <= 0) p.celebrate(1.3);
      p.step(dt, 0, 0);
    },
  },
};

const SIM_DT = 1 / 240;

export function renderSheet(canvas: HTMLCanvasElement, action: SpriteAction): void {
  const layout = SHEETS[action];
  const recipe = RECIPES[action];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Chrome, matching the drawn sheets so the loader's margins are exercised.
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e9edf5';
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(`VOLLEYBALL ${action.toUpperCase()}`, 18, 50);
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillStyle = '#7fb2ff';
  ctx.fillText('24 FRAME ACTION SEQUENCE — PLACEHOLDER', 420, 48);

  const gx = layout.left * W;
  const gy = layout.top * H;
  const gw = W * (1 - layout.left - layout.right);
  const gh = H * (1 - layout.top - layout.bottom);
  const cw = gw / layout.cols;
  const ch = gh / layout.rows;

  const cam = new Camera();
  const kit: [string, string] = ['#22317a', '#0d1430'];

  // Every frame comes from one continuous run of the action, sampled evenly,
  // so the sheet is a real timeline rather than 24 unrelated poses.
  const p = new Player(7, 'home', 'outside', 'DEV', defaultStats());
  p.facing = 1;
  p.setAnim('idle');
  let t = 0;
  let frame = 0;
  const interval = recipe.span / 24;
  let next = 0;

  const total = Math.ceil(recipe.span / SIM_DT);
  for (let i = 0; i <= total && frame < 24; i++) {
    if (t >= next - 1e-6) {
      const c = frame % layout.cols;
      const r = (frame / layout.cols) | 0;
      const x = gx + c * cw;
      const y = gy + r * ch;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, cw - 4, ch - 4);
      ctx.clip();
      // White paper, exactly as the drawn sheets have, so the keying is tested.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      ctx.fillStyle = '#26428f';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText(String(frame + 1), x + 12, y + 30);

      const floorY = y + ch * layout.baseline;
      cam.resize(cw * 4.2, ch * 1.9);
      cam.panY = p.pos.y;
      const proj = cam.project(0, p.pos.y, 0);
      ctx.translate(x + cw / 2 - proj.x, floorY - proj.y);
      drawPlayer(ctx, cam, { ...p, pos: { ...p.pos, x: 0 } } as unknown as Player, kit, {
        active: false,
        charge: 0,
        time: t,
        dt: interval,
      });
      ctx.restore();

      frame++;
      next += interval;
    }
    recipe.step(p, SIM_DT, t, recipe.span);
    t += SIM_DT;
  }

  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(0, H - layout.bottom * H, W, layout.bottom * H);
  ctx.fillStyle = '#5f7fb5';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText('PLACEHOLDER — replace with the drawn sheet of the same name', 18, H - 18);
}

export const ACTIONS = Object.keys(SHEETS) as SpriteAction[];
