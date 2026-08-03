import { clamp, lerp } from '../core/math3';
import { Player } from '../core/player';
import { Camera } from './camera';

/** A drawable pose in the player's local 2D frame, in "body units". */
interface Pose {
  /** Vertical crouch, 0 = upright, 1 = deep. */
  crouch: number;
  /** Arm angles in radians, measured from straight down. */
  armFront: number;
  armBack: number;
  /** Leg split. */
  legFront: number;
  legBack: number;
  /** Forward lean. */
  lean: number;
}

const POSES: Record<string, Pose> = {
  idle: { crouch: 0.08, armFront: 0.35, armBack: -0.3, legFront: 0.16, legBack: -0.16, lean: 0.02 },
  run: { crouch: 0.16, armFront: 0.95, armBack: -0.95, legFront: 0.72, legBack: -0.72, lean: 0.16 },
  jump: { crouch: 0, armFront: 2.5, armBack: 1.6, legFront: 0.3, legBack: -0.5, lean: -0.05 },
  spike: { crouch: 0, armFront: 3.0, armBack: -1.2, legFront: 0.4, legBack: -0.6, lean: 0.22 },
  block: { crouch: 0, armFront: 3.0, armBack: 3.0, legFront: 0.12, legBack: -0.12, lean: 0.0 },
  set: { crouch: 0.2, armFront: 2.7, armBack: 2.7, legFront: 0.3, legBack: -0.3, lean: -0.06 },
  bump: { crouch: 0.42, armFront: 1.15, armBack: 1.15, legFront: 0.5, legBack: -0.5, lean: 0.2 },
  serve: { crouch: 0.1, armFront: 1.5, armBack: -0.4, legFront: 0.2, legBack: -0.2, lean: 0.04 },
  dive: { crouch: 0.8, armFront: 1.5, armBack: 0.4, legFront: 0.9, legBack: -0.2, lean: 1.15 },
  land: { crouch: 0.45, armFront: 0.6, armBack: -0.6, legFront: 0.35, legBack: -0.35, lean: 0.14 },
  down: { crouch: 0.95, armFront: 0.9, armBack: 0.2, legFront: 0.6, legBack: -0.4, lean: 1.35 },
};

const blendPose = (a: Pose, b: Pose, t: number): Pose => ({
  crouch: lerp(a.crouch, b.crouch, t),
  armFront: lerp(a.armFront, b.armFront, t),
  armBack: lerp(a.armBack, b.armBack, t),
  legFront: lerp(a.legFront, b.legFront, t),
  legBack: lerp(a.legBack, b.legBack, t),
  lean: lerp(a.lean, b.lean, t),
});

/** Cheap skin tones, varied per player id so the six are not clones. */
const SKINS = ['#f0c39a', '#d9a173', '#b87b4f', '#8d5a3b', '#6b4230'];

export interface PlayerDrawOptions {
  /** Highlight ring under the player the human is steering. */
  active: boolean;
  /** Dim players on the far side slightly, for depth separation. */
  far: boolean;
  /** 0..1 charge, drawn as a small meter above the head. */
  charge: number;
  /** Wall-clock seconds, for idle breathing and run cycles. */
  time: number;
}

/**
 * Draw one player as a stylised articulated figure.
 *
 * Sprites are generated rather than authored: at this size a small set of
 * blended poses reads better than a low-frame-count sprite sheet, and it keeps
 * animation perfectly smooth at any refresh rate.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  colors: [string, string],
  opts: PlayerDrawOptions,
): void {
  const feet = cam.project(p.pos.x, p.pos.y, p.height);
  if (feet.behind) return;

  // Body height in pixels. 1.92 m tall players at the court centre.
  const unit = 1.92 * feet.scale * 42;
  if (unit < 4) return;

  const base = POSES[p.anim] ?? POSES.idle;
  let pose = base;

  // Blend a run cycle so legs and arms actually swing.
  if (p.anim === 'run') {
    const phase = Math.sin(opts.time * 15 + p.id);
    pose = {
      ...base,
      legFront: base.legFront * phase,
      legBack: -base.legFront * phase,
      armFront: base.armFront * -phase,
      armBack: -base.armBack * -phase * 0.8,
    };
  } else if (p.anim === 'idle') {
    const breathe = Math.sin(opts.time * 2.2 + p.id) * 0.03;
    pose = blendPose(base, { ...base, crouch: base.crouch + breathe }, 1);
  } else if (p.swing > 0 && (p.anim === 'spike' || p.anim === 'serve')) {
    // Snap the hitting arm through the swing.
    const k = clamp(p.swing / 0.3, 0, 1);
    pose = { ...base, armFront: lerp(0.6, base.armFront, k), lean: base.lean + (1 - k) * 0.3 };
  }

  const facing = p.facing >= 0 ? 1 : -1;
  const [kit, trim] = colors;
  const skin = SKINS[p.id % SKINS.length];

  ctx.save();
  // The far team sits ~20 m from the camera; a touch of atmospheric haze keeps
  // the two sides from reading as the same distance.
  ctx.globalAlpha = opts.far ? 0.88 : 1;
  ctx.translate(feet.x, feet.y);
  ctx.rotate(pose.lean * 0.25 * facing);
  ctx.scale(facing, 1);

  const hipY = -unit * (0.52 - pose.crouch * 0.18);
  const shoulderY = -unit * (0.86 - pose.crouch * 0.24);
  const headY = shoulderY - unit * 0.12;
  const limb = unit * 0.072;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /**
   * Limb angles are measured from straight down, growing as the limb swings
   * forward and up: 0 hangs, PI/2 is horizontal, PI points straight overhead.
   */
  const drawLimb = (
    x0: number,
    y0: number,
    angle: number,
    length: number,
    width: number,
    color: string,
  ): { x: number; y: number } => {
    const x1 = x0 + Math.sin(angle) * length;
    const y1 = y0 + Math.cos(angle) * length;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    return { x: x1, y: y1 };
  };

  // Back limbs first so the figure reads with depth.
  const legLen = unit * 0.44;
  drawLimb(0, hipY, pose.legBack, legLen, limb * 1.1, shade(trim, -0.18));
  drawLimb(0, shoulderY, pose.armBack, unit * 0.4, limb * 0.8, shade(skin, -0.22));

  // Torso.
  ctx.fillStyle = kit;
  ctx.beginPath();
  ctx.moveTo(-unit * 0.115, shoulderY);
  ctx.lineTo(unit * 0.115, shoulderY);
  ctx.lineTo(unit * 0.095, hipY);
  ctx.lineTo(-unit * 0.095, hipY);
  ctx.closePath();
  ctx.fill();

  // Jersey stripe and number.
  ctx.fillStyle = trim;
  ctx.fillRect(-unit * 0.115, shoulderY + unit * 0.12, unit * 0.23, unit * 0.045);
  if (unit > 34) {
    ctx.save();
    ctx.scale(facing, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `700 ${unit * 0.16}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(p.rotationSlot), 0, shoulderY + unit * 0.3);
    ctx.restore();
  }

  // Front limbs.
  drawLimb(0, hipY, pose.legFront, legLen, limb * 1.15, trim);
  const hand = drawLimb(0, shoulderY, pose.armFront, unit * 0.42, limb * 0.85, skin);

  // Head.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, headY, unit * 0.115, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(skin, -0.45);
  ctx.beginPath();
  ctx.arc(0, headY - unit * 0.03, unit * 0.115, Math.PI * 1.05, Math.PI * 2.05);
  ctx.fill();

  // Hands glow while a strike is armed — the player's main timing cue.
  if (p.charge > 0.15) {
    ctx.globalAlpha = 0.35 + 0.45 * p.charge;
    ctx.fillStyle = p.charge > 0.75 ? '#ffe27a' : '#8fd8ff';
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, unit * (0.06 + 0.05 * p.charge), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (opts.charge > 0.05) drawChargeMeter(ctx, feet.x, feet.y - unit * 1.15, unit, opts.charge);
}

/** Soft elliptical shadow, darker and tighter the closer the player is to the floor. */
export function drawPlayerShadow(ctx: CanvasRenderingContext2D, cam: Camera, p: Player): void {
  const s = cam.projectFloor(p.pos.x, p.pos.y);
  if (s.behind) return;
  const lift = clamp(p.height / 1.4, 0, 1);
  const rx = 0.46 * s.scale * 42 * (1 + lift * 0.55);
  const ry = rx * 0.34;
  ctx.save();
  ctx.globalAlpha = 0.34 * (1 - lift * 0.55);
  ctx.fillStyle = '#05070f';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Ring under the player the human currently controls. */
export function drawActiveRing(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  color: string,
  time: number,
): void {
  const s = cam.projectFloor(p.pos.x, p.pos.y);
  if (s.behind) return;
  const rx = 0.62 * s.scale * 42;
  const pulse = 0.85 + Math.sin(time * 6) * 0.15;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(1.5, 3 * s.scale);
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx * pulse, rx * 0.34 * pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawChargeMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  charge: number,
): void {
  const w = unit * 0.6;
  const h = Math.max(3, unit * 0.07);
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,18,0.7)';
  ctx.fillRect(x - w / 2, y, w, h);
  const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  grad.addColorStop(0, '#6fe3ff');
  grad.addColorStop(0.6, '#ffe27a');
  grad.addColorStop(1, '#ff6b5e');
  ctx.fillStyle = grad;
  ctx.fillRect(x - w / 2, y, w * charge, h);
  ctx.restore();
}

/** Lighten (positive) or darken (negative) a hex colour. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const to = (v: number): number =>
    Math.round(clamp(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount), 0, 255));
  const r = to(parseInt(m[1], 16));
  const g = to(parseInt(m[2], 16));
  const b = to(parseInt(m[3], 16));
  return `rgb(${r}, ${g}, ${b})`;
}
