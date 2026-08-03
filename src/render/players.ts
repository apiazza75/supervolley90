import { clamp, lerp } from '../core/math3';
import { Player } from '../core/player';
import { Camera } from './camera';

/**
 * A pose is a set of joint angles, all measured from straight down and growing
 * as the limb swings forward: 0 hangs, PI/2 is horizontal, PI points overhead.
 * Bends are added to the parent angle, so an elbow of 0 means a straight arm.
 */
interface Pose {
  /** Lowers the pelvis and shoulders, 0..1. */
  crouch: number;
  /** Forward lean of the whole body, radians. */
  lean: number;
  /** [shoulder, elbow bend] for the arm away from and towards the viewer. */
  armFar: [number, number];
  armNear: [number, number];
  /** [hip, knee bend]. */
  legFar: [number, number];
  legNear: [number, number];
  /** Head tilt, radians. */
  head: number;
}

const pose = (
  crouch: number,
  lean: number,
  armFar: [number, number],
  armNear: [number, number],
  legFar: [number, number],
  legNear: [number, number],
  head = 0,
): Pose => ({ crouch, lean, armFar, armNear, legFar, legNear, head });

const POSES: Record<string, Pose> = {
  //          crouch lean  armFar        armNear       legFar        legNear      head
  idle: pose(0.1, 0.02, [0.22, 0.3], [-0.18, 0.34], [0.1, 0.12], [-0.1, 0.12], 0),
  run: pose(0.2, 0.22, [1.0, 0.9], [-0.9, 0.85], [0.7, 0.15], [-0.55, 1.0], 0.05),
  jump: pose(0.0, -0.04, [2.3, 0.35], [1.5, 0.6], [0.28, 0.75], [-0.4, 0.5], -0.1),
  spike: pose(0.0, 0.26, [3.0, 0.1], [-0.9, 0.7], [0.42, 0.8], [-0.55, 0.55], -0.16),
  block: pose(0.0, 0.02, [2.95, 0.06], [2.95, 0.06], [0.1, 0.35], [-0.1, 0.35], -0.14),
  set: pose(0.22, -0.06, [2.55, 0.75], [2.55, 0.75], [0.24, 0.4], [-0.24, 0.4], -0.12),
  bump: pose(0.46, 0.24, [1.15, 0.06], [1.15, 0.06], [0.46, 0.7], [-0.42, 0.66], 0.1),
  serve: pose(0.12, 0.04, [1.45, 0.5], [-0.3, 0.35], [0.16, 0.2], [-0.16, 0.2], -0.06),
  dive: pose(0.85, 1.2, [1.7, 0.2], [1.35, 0.5], [0.95, 0.3], [0.6, 0.5], -0.3),
  land: pose(0.48, 0.16, [0.55, 0.55], [-0.5, 0.55], [0.3, 0.85], [-0.28, 0.85], 0.08),
  down: pose(0.95, 1.35, [0.85, 0.4], [0.25, 0.6], [0.62, 0.9], [-0.35, 0.9], 0.2),
};

const blend = (a: Pose, b: Pose, t: number): Pose => ({
  crouch: lerp(a.crouch, b.crouch, t),
  lean: lerp(a.lean, b.lean, t),
  armFar: [lerp(a.armFar[0], b.armFar[0], t), lerp(a.armFar[1], b.armFar[1], t)],
  armNear: [lerp(a.armNear[0], b.armNear[0], t), lerp(a.armNear[1], b.armNear[1], t)],
  legFar: [lerp(a.legFar[0], b.legFar[0], t), lerp(a.legFar[1], b.legFar[1], t)],
  legNear: [lerp(a.legNear[0], b.legNear[0], t), lerp(a.legNear[1], b.legNear[1], t)],
  head: lerp(a.head, b.head, t),
});

const clonePose = (p: Pose): Pose => blend(p, p, 0);

/**
 * Per-player pose state, smoothed towards the target every frame.
 *
 * Snapping straight to a pose reads as stop-motion. Easing into it is what
 * makes a run cycle flow into a jump and a jump into a swing.
 */
const poseState = new Map<number, Pose>();

const SKINS = ['#f6cca9', '#e8b184', '#c98d5c', '#9a6238', '#6f4527'];
const HAIRS = ['#2a1f1a', '#141013', '#5b3a1e', '#8a5a2b', '#3a2a20', '#1c1c22'];

export interface PlayerDrawOptions {
  active: boolean;
  charge: number;
  time: number;
  /** Frame delta, for pose smoothing. */
  dt: number;
}

const OUTLINE = 'rgba(18,16,28,0.85)';

/** Draw a limb segment as a tapered capsule with an outline. */
function capsule(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  fill: string,
  outlineWidth: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const a = Math.atan2(dy, dx);

  ctx.beginPath();
  ctx.arc(x0, y0, w0 / 2, a + Math.PI / 2, a - Math.PI / 2);
  ctx.lineTo(x1 - (nx * w1) / 2, y1 - (ny * w1) / 2);
  ctx.arc(x1, y1, w1 / 2, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  if (outlineWidth > 0.4) {
    ctx.lineWidth = outlineWidth;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
}

/** Forward kinematics for a two-segment limb. Returns joint and end points. */
function limbPoints(
  ox: number,
  oy: number,
  angle: number,
  bend: number,
  upper: number,
  lower: number,
): { jx: number; jy: number; ex: number; ey: number } {
  const jx = ox + Math.sin(angle) * upper;
  const jy = oy + Math.cos(angle) * upper;
  const a2 = angle - bend;
  return { jx, jy, ex: jx + Math.sin(a2) * lower, ey: jy + Math.cos(a2) * lower };
}

/**
 * Draw one player as an articulated vector figure: shoes, legs with knees,
 * shorts, a tapered torso in the team kit, sleeved arms with elbows, and a head
 * with hair. Flat colours and a dark outline — the look of cel-shaded 2D sports
 * art rather than pixels or rendered 3D.
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  colors: [string, string],
  opts: PlayerDrawOptions,
): void {
  const feet = cam.project(p.pos.x, p.pos.y, p.height);
  const unit = 1.9 * feet.scale * 42;
  if (unit < 6) return;

  // ---- pose selection and smoothing
  let target = POSES[p.anim] ?? POSES.idle;
  if (p.anim === 'run') {
    const phase = Math.sin(opts.time * 13 + p.id * 1.7);
    const lift = Math.max(0, -phase);
    target = {
      ...target,
      legFar: [0.72 * phase, 0.15 + lift * 1.1],
      legNear: [-0.72 * phase, 0.15 + Math.max(0, phase) * 1.1],
      armFar: [0.95 * -phase, 0.85],
      armNear: [-0.95 * -phase, 0.85],
    };
  } else if (p.anim === 'idle') {
    const breathe = Math.sin(opts.time * 2.1 + p.id) * 0.025;
    target = { ...target, crouch: target.crouch + breathe };
  }
  if (p.swing > 0 && (p.anim === 'spike' || p.anim === 'serve')) {
    // Snap the hitting arm through its arc as the swing timer runs out.
    const k = clamp(p.swing / 0.32, 0, 1);
    target = {
      ...target,
      armFar: [lerp(0.5, target.armFar[0], k), target.armFar[1]],
      lean: target.lean + (1 - k) * 0.28,
    };
  }

  let current = poseState.get(p.id);
  if (!current) {
    current = clonePose(target);
    poseState.set(p.id, current);
  }
  // Fast enough to feel responsive, slow enough to remove the stepping.
  const k = 1 - Math.exp(-26 * Math.max(0.0001, opts.dt));
  current = blend(current, target, k);
  poseState.set(p.id, current);

  // ---- geometry
  const facing = p.facing >= 0 ? 1 : -1;
  const [kit, trim] = colors;
  const skin = SKINS[p.id % SKINS.length];
  const hair = HAIRS[(p.id * 3 + 1) % HAIRS.length];
  const skinDark = shade(skin, -0.18);
  const kitDark = shade(kit, -0.22);

  const hipY = -unit * (0.47 - current.crouch * 0.15);
  const shoulderY = -unit * (0.8 - current.crouch * 0.19);
  const neckY = shoulderY - unit * 0.035;
  const headR = unit * 0.088;
  const headY = neckY - headR * 1.05;

  const thigh = unit * 0.245;
  const shin = unit * 0.225;
  const upperArm = unit * 0.185;
  const foreArm = unit * 0.175;
  const outline = Math.max(0.6, unit * 0.016);

  ctx.save();
  // Depth haze follows how far across the court the player is, not which team
  // they are on: in this projection the far half of *both* courts is upstage.
  ctx.globalAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  ctx.translate(feet.x, feet.y);
  ctx.rotate(current.lean * 0.3 * facing);
  ctx.scale(facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawLeg = (spec: [number, number], legFill: string, shoeFill: string): void => {
    const { jx, jy, ex, ey } = limbPoints(0, hipY, spec[0], spec[1], thigh, shin);
    capsule(ctx, 0, hipY, jx, jy, unit * 0.105, unit * 0.078, legFill, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.072, unit * 0.05, legFill, outline);
    // Shoe: a small wedge pointing the way the player faces.
    ctx.beginPath();
    ctx.ellipse(ex + unit * 0.022, ey + unit * 0.012, unit * 0.062, unit * 0.032, 0, 0, Math.PI * 2);
    ctx.fillStyle = shoeFill;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  };

  const drawArm = (spec: [number, number], sleeve: string): void => {
    const { jx, jy, ex, ey } = limbPoints(0, shoulderY, spec[0], spec[1], upperArm, foreArm);
    capsule(ctx, 0, shoulderY, jx, jy, unit * 0.072, unit * 0.055, skin, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.053, unit * 0.042, skin, outline);
    // Short sleeve over the top of the upper arm.
    capsule(
      ctx,
      0,
      shoulderY,
      lerp(0, jx, 0.45),
      lerp(shoulderY, jy, 0.45),
      unit * 0.086,
      unit * 0.07,
      sleeve,
      outline,
    );
    // Hand.
    ctx.beginPath();
    ctx.arc(ex, ey, unit * 0.038, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    return;
  };

  // Far side first, so the body reads with depth.
  drawArm(current.armFar, kitDark);
  drawLeg(current.legFar, shade(trim, -0.2), '#dfe4ee');

  // ---- torso: shoulders wide, waist narrow
  const halfShoulder = unit * 0.125;
  const halfWaist = unit * 0.098;
  ctx.beginPath();
  ctx.moveTo(-halfShoulder, shoulderY);
  ctx.quadraticCurveTo(-halfShoulder * 1.05, hipY - unit * 0.14, -halfWaist, hipY);
  ctx.lineTo(halfWaist, hipY);
  ctx.quadraticCurveTo(halfShoulder * 1.05, hipY - unit * 0.14, halfShoulder, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY - unit * 0.035, -halfShoulder, shoulderY);
  ctx.closePath();
  ctx.fillStyle = kit;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Shorts.
  ctx.beginPath();
  ctx.moveTo(-halfWaist * 1.06, hipY - unit * 0.05);
  ctx.lineTo(halfWaist * 1.06, hipY - unit * 0.05);
  ctx.lineTo(halfWaist * 1.12, hipY + unit * 0.085);
  ctx.lineTo(-halfWaist * 1.12, hipY + unit * 0.085);
  ctx.closePath();
  ctx.fillStyle = trim;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Number on the chest, mirrored back so it never reads reversed.
  if (unit > 46) {
    ctx.save();
    ctx.scale(facing, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `800 ${unit * 0.15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(p.rotationSlot), 0, shoulderY + unit * 0.23);
    ctx.restore();
  }

  // Near side.
  drawLeg(current.legNear, trim, '#f2f5fb');
  drawArm(current.armNear, kit);

  // ---- head
  ctx.save();
  ctx.translate(0, headY);
  ctx.rotate(current.head);
  // Neck.
  ctx.beginPath();
  ctx.rect(-unit * 0.028, headR * 0.5, unit * 0.056, unit * 0.06);
  ctx.fillStyle = skinDark;
  ctx.fill();
  // Face.
  ctx.beginPath();
  ctx.ellipse(unit * 0.008, 0, headR * 0.95, headR, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Hair: a cap over the crown, longer at the back.
  ctx.beginPath();
  ctx.ellipse(-unit * 0.004, -headR * 0.24, headR * 0.99, headR * 0.82, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(-headR * 0.95, headR * 0.42);
  ctx.quadraticCurveTo(-headR * 1.15, -headR * 0.2, -headR * 0.95, -headR * 0.5);
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  // Eye, on the facing side.
  if (unit > 40) {
    ctx.beginPath();
    ctx.ellipse(headR * 0.42, headR * 0.02, headR * 0.1, headR * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#20202c';
    ctx.fill();
  }
  ctx.restore();

  // Charge glow on the hitting hand.
  if (p.charge > 0.15) {
    const { ex, ey } = limbPoints(
      0,
      shoulderY,
      current.armFar[0],
      current.armFar[1],
      upperArm,
      foreArm,
    );
    ctx.globalAlpha = 0.3 + 0.5 * p.charge;
    ctx.fillStyle = p.charge > 0.75 ? '#ffe27a' : '#8fd8ff';
    ctx.beginPath();
    ctx.arc(ex, ey, unit * (0.06 + 0.06 * p.charge), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (opts.charge > 0.05) drawChargeMeter(ctx, feet.x, feet.y - unit * 1.16, unit, opts.charge);
}

/** Soft elliptical shadow, tighter and darker the closer the player is to the floor. */
export function drawPlayerShadow(ctx: CanvasRenderingContext2D, cam: Camera, p: Player): void {
  const s = cam.projectFloor(p.pos.x, p.pos.y);
  const lift = clamp(p.height / 1.4, 0, 1);
  const rx = 0.42 * s.scale * 42 * (1 + lift * 0.5);
  ctx.save();
  ctx.globalAlpha = 0.3 * (1 - lift * 0.55);
  ctx.fillStyle = '#0a1408';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawActiveRing(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p: Player,
  color: string,
  time: number,
): void {
  const s = cam.projectFloor(p.pos.x, p.pos.y);
  const rx = 0.6 * s.scale * 42;
  const pulse = 0.86 + Math.sin(time * 6) * 0.14;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(1.5, 3 * s.scale);
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, rx * pulse, rx * 0.3 * pulse, 0, 0, Math.PI * 2);
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
  const w = unit * 0.58;
  const h = Math.max(3, unit * 0.068);
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,18,0.72)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
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
  return `rgb(${to(parseInt(m[1], 16))}, ${to(parseInt(m[2], 16))}, ${to(parseInt(m[3], 16))})`;
}
