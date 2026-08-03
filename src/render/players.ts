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
  /**
   * Curve of the spine, radians: positive arches the chest open (the drawn
   * bow of a spike), negative hunches forward (a dig). Applied as a bend
   * between the hips and the shoulders, so the torso is no longer a rigid
   * slab — the single change that most separates these figures from
   * clip-art.
   */
  arch?: number;
}

const pose = (
  crouch: number,
  lean: number,
  armFar: [number, number],
  armNear: [number, number],
  legFar: [number, number],
  legNear: [number, number],
  head = 0,
  arch = 0,
): Pose => ({ crouch, lean, armFar, armNear, legFar, legNear, head, arch });

/**
 * The pose library.
 *
 * Convention check that matters: limb points are (sin a, cos a) with screen y
 * growing downward, so 0 hangs, PI/2 reaches forward-horizontal, PI points
 * straight up, and values past PI go up-and-behind. The elbow/knee bend is
 * SUBTRACTED from the parent angle — so knees (which fold backward) take
 * positive bends, and elbows (which fold forward) take NEGATIVE bends. The
 * first version of this file used positive elbow bends throughout, which is
 * why every figure looked like it was carrying an invisible tray.
 */
const POSES: Record<string, Pose> = {
  // Volleyball ready stance: knees flexed, weight forward, hands ready in
  // front at hip height, feet staggered.
  idle: pose(0.42, 0.22, [0.55, -0.6], [-0.4, -0.65], [0.3, 0.6], [-0.28, 0.55], -0.06, -0.08),
  // Sprint: high knee lift, elbows pumping at ninety degrees, torso driving.
  run: pose(0.2, 0.3, [1.0, -0.95], [-0.95, -0.95], [0.8, 0.2], [-0.6, 1.2], 0.04, -0.05),
  // Takeoff: both arms swinging up, legs tucking.
  jumpRise: pose(0.0, -0.1, [2.1, -0.45], [1.6, -0.55], [0.45, 0.9], [-0.3, 1.0], -0.12, 0.1),
  // The cocked spike, back arched like a drawn bow: chest open, hitting arm
  // folded behind the head, off arm high for balance, legs trailing behind.
  spikeCock: pose(0.0, -0.42, [3.5, 0.95], [2.1, -0.35], [-0.55, 1.15], [-0.75, 1.0], -0.34, 0.5),
  // The hit itself: the bow releases — torso jackknifes, arm whips through,
  // legs pike forward.
  spikeHit: pose(0.05, 0.5, [1.0, -0.1], [-0.7, -0.6], [0.55, 0.5], [0.3, 0.6], 0.2, -0.35),
  // Grounded attack/tip follow-through shares the hit shape.
  spike: pose(0.08, 0.34, [1.05, -0.15], [-0.6, -0.6], [0.4, 0.55], [-0.4, 0.5], 0.1, -0.2),
  jump: pose(0.0, -0.1, [2.1, -0.45], [1.6, -0.55], [0.45, 0.9], [-0.3, 1.0], -0.12, 0.1),
  // Penetrating block: both arms rammed straight up, body a plank.
  block: pose(0.0, 0.04, [3.1, -0.05], [2.98, -0.05], [0.12, 0.45], [-0.12, 0.45], -0.16, 0.08),
  // Overhead set: hands above the forehead, elbows out, knees loaded.
  set: pose(0.3, 0.0, [2.45, -0.55], [2.55, -0.5], [0.26, 0.5], [-0.26, 0.5], -0.2, 0.12),
  // The platform: both arms dead straight, locked together, angled to the
  // ball; deep staggered squat, eyes up.
  bump: pose(0.5, 0.32, [0.98, -0.02], [0.9, -0.02], [0.55, 0.8], [-0.5, 0.75], -0.14, -0.28),
  // Holding the ball out front, ready to toss.
  serve: pose(0.24, 0.1, [0.3, -0.7], [1.5, -0.15], [0.3, 0.4], [-0.22, 0.35], -0.06, 0.05),
  // Full-extension dig: body laid out horizontal (the draw code rotates it
  // flat), both arms locked straight past the head, legs trailing.
  dive: pose(0.35, 1.35, [2.7, -0.06], [2.5, -0.1], [-0.35, 0.5], [-0.6, 0.35], -0.42, 0.25),
  // Absorbing the landing: deep flex, arms out for balance.
  land: pose(0.5, 0.18, [0.72, -0.55], [-0.6, -0.55], [0.34, 0.95], [-0.3, 0.95], 0.06, -0.15),
  // Sprawled on the floor after the dive, pushing up on one arm.
  down: pose(0.8, 1.5, [1.2, -0.55], [0.5, -0.9], [-0.3, 0.7], [-0.55, 0.5], -0.5, -0.1),
};

const blend = (a: Pose, b: Pose, t: number): Pose => ({
  crouch: lerp(a.crouch, b.crouch, t),
  lean: lerp(a.lean, b.lean, t),
  armFar: [lerp(a.armFar[0], b.armFar[0], t), lerp(a.armFar[1], b.armFar[1], t)],
  armNear: [lerp(a.armNear[0], b.armNear[0], t), lerp(a.armNear[1], b.armNear[1], t)],
  legFar: [lerp(a.legFar[0], b.legFar[0], t), lerp(a.legFar[1], b.legFar[1], t)],
  legNear: [lerp(a.legNear[0], b.legNear[0], t), lerp(a.legNear[1], b.legNear[1], t)],
  head: lerp(a.head, b.head, t),
  arch: lerp(a.arch ?? 0, b.arch ?? 0, t),
});

const clonePose = (p: Pose): Pose => blend(p, p, 0);

/**
 * Per-player animation state, smoothed towards its target every frame.
 *
 * Snapping straight to a pose reads as stop-motion; easing is what makes a run
 * flow into a jump and a jump into a swing. The run-cycle phase accumulates
 * from the player's actual ground speed, because a fixed-rate cycle stops
 * matching the floor the moment the speed changes — the classic moonwalk.
 */
interface AnimState {
  pose: Pose;
  runPhase: number;
  /** Smoothed whole-body rotation, so a dive lays out instead of snapping. */
  tilt: number;
}
const animState = new Map<number, AnimState>();

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

/**
 * Draw a limb segment as a tapered capsule, shaded across its width — lit on
 * the upper-left edge, falling to shadow on the lower-right — with an outline.
 * The cross-shading is what turns a flat sausage into something with volume.
 */
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
  flat = false,
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

  if (flat) {
    ctx.fillStyle = fill;
  } else {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const w = Math.max(w0, w1) * 0.62;
    const g = ctx.createLinearGradient(mx - nx * w, my - ny * w, mx + nx * w, my + ny * w);
    g.addColorStop(0, shade(fill, 0.22));
    g.addColorStop(0.55, fill);
    g.addColorStop(1, shade(fill, -0.3));
    ctx.fillStyle = g;
  }
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
 * Draw one player as an articulated, shaded athlete: two-part shoes with
 * soles, muscled legs with knee pads, shorts with a side stripe, a curved
 * torso in the team kit with collar and trim, deltoid-capped arms, and a head
 * with a face. Cel-shaded 2D sports art — the aim is the silhouette quality
 * of a 90s arcade sprite, drawn with vectors instead of pixels.
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
  let st = animState.get(p.id);
  if (!st) {
    st = { pose: clonePose(POSES[p.anim] ?? POSES.idle), runPhase: p.id * 1.7, tilt: 0 };
    animState.set(p.id, st);
  }
  const groundSpeed = Math.hypot(p.vel.x, p.vel.y);
  st.runPhase += opts.dt * (5 + groundSpeed * 2.6);

  // Airborne attacks are a sequence, not a pose: rise with the arms swinging
  // up, arch the back at the top with the arm cocked, then whip through on
  // the swing. Driven from the jump physics, so the arch always happens at
  // the apex regardless of jump height.
  let animKey: string = p.anim;
  if (p.airborne && (p.anim === 'jump' || p.anim === 'spike')) {
    if (p.swing > 0) animKey = 'spikeHit';
    else if (p.vertVel > 1.4) animKey = 'jumpRise';
    else animKey = 'spikeCock';
  }

  let target = POSES[animKey] ?? POSES.idle;
  if (p.anim === 'run') {
    const phase = Math.sin(st.runPhase);
    const lift = Math.max(0, -phase);
    target = {
      ...target,
      // A touch of vertical bob per stride sells the footfalls.
      crouch: target.crouch + Math.abs(Math.cos(st.runPhase)) * 0.05,
      legFar: [0.72 * phase, 0.15 + lift * 1.1],
      legNear: [-0.72 * phase, 0.15 + Math.max(0, phase) * 1.1],
      armFar: [0.95 * -phase, 0.85],
      armNear: [-0.95 * -phase, 0.85],
    };
  } else if (p.anim === 'idle') {
    const breathe = Math.sin(opts.time * 2.1 + p.id) * 0.025;
    target = { ...target, crouch: target.crouch + breathe };
  }

  // Fast enough to feel responsive, slow enough to remove the stepping.
  const k = 1 - Math.exp(-26 * Math.max(0.0001, opts.dt));
  st.pose = blend(st.pose, target, k);
  const current = st.pose;

  // How much of the pose's lean becomes whole-body rotation. Standing poses
  // only hint at it; a dive or a floor sprawl commits fully, laying the body
  // out flat, and the airborne spike rotates enough that the arch reads.
  const tiltGain =
    animKey === 'dive' || animKey === 'down'
      ? 0.8
      : animKey === 'spikeCock' || animKey === 'spikeHit'
        ? 0.55
        : 0.3;
  st.tilt = lerp(st.tilt, current.lean * tiltGain, k);

  // ---- geometry
  const facing = p.facing >= 0 ? 1 : -1;
  const [kit, trim] = colors;
  const skin = SKINS[p.id % SKINS.length];
  const hair = HAIRS[(p.id * 3 + 1) % HAIRS.length];
  const skinDark = shade(skin, -0.18);

  const arch = current.arch ?? 0;
  const hipY = -unit * (0.5 - current.crouch * 0.22);
  // The spine bend shifts the shoulders fore/aft of the hips.
  const shoulderX = -Math.sin(arch) * unit * 0.16;
  const shoulderY = -unit * (0.82 - current.crouch * 0.26) + Math.abs(arch) * unit * 0.02;
  const neckY = shoulderY - unit * 0.035;
  const headR = unit * 0.082;
  const headX = shoulderX - Math.sin(arch) * unit * 0.05;
  const headY = neckY - headR * 1.05;

  const thigh = unit * 0.26;
  const shin = unit * 0.24;
  const upperArm = unit * 0.2;
  const foreArm = unit * 0.19;
  const outline = Math.max(0.7, unit * 0.02);

  ctx.save();
  // Depth haze follows how far across the court the player is, not which team
  // they are on: in this projection the far half of *both* courts is upstage.
  ctx.globalAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  ctx.translate(feet.x, feet.y);
  ctx.rotate(st.tilt * facing);
  ctx.scale(facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawLeg = (spec: [number, number], legFill: string, shoeFill: string): void => {
    const { jx, jy, ex, ey } = limbPoints(0, hipY, spec[0], spec[1], thigh, shin);
    // Thigh with a quad bulge, calf tapering to the ankle.
    capsule(ctx, 0, hipY, jx, jy, unit * 0.125, unit * 0.085, legFill, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.082, unit * 0.05, legFill, outline);
    // Knee pad — the volleyball player's badge.
    ctx.beginPath();
    ctx.arc(jx, jy, unit * 0.048, 0, Math.PI * 2);
    ctx.fillStyle = '#e8e4da';
    ctx.fill();
    ctx.lineWidth = outline * 0.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Sock cuff.
    capsule(
      ctx,
      lerp(jx, ex, 0.68),
      lerp(jy, ey, 0.68),
      ex,
      ey,
      unit * 0.06,
      unit * 0.052,
      '#f2f2f0',
      outline * 0.8,
      true,
    );
    // Shoe: body plus a pale sole so it reads as footwear, not a blob.
    ctx.beginPath();
    ctx.ellipse(ex + unit * 0.028, ey + unit * 0.008, unit * 0.066, unit * 0.034, 0, 0, Math.PI * 2);
    ctx.fillStyle = shoeFill;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ex + unit * 0.03, ey + unit * 0.026, unit * 0.062, unit * 0.014, 0, 0, Math.PI);
    ctx.fillStyle = '#c9cdd6';
    ctx.fill();
  };

  const drawArm = (spec: [number, number], sleeve: string): void => {
    const { jx, jy, ex, ey } = limbPoints(shoulderX, shoulderY, spec[0], spec[1], upperArm, foreArm);
    // Upper arm thicker at the biceps, forearm tapering to the wrist.
    capsule(ctx, shoulderX, shoulderY, jx, jy, unit * 0.082, unit * 0.058, skin, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.06, unit * 0.04, skin, outline);
    // Deltoid cap and short sleeve over the top of the upper arm.
    capsule(
      ctx,
      shoulderX,
      shoulderY,
      lerp(shoulderX, jx, 0.45),
      lerp(shoulderY, jy, 0.45),
      unit * 0.1,
      unit * 0.075,
      sleeve,
      outline,
    );
    // Hand.
    ctx.beginPath();
    ctx.arc(ex, ey, unit * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  };

  // Far side first, so the body reads with depth.
  drawArm(current.armFar, shade(kit, -0.22));
  drawLeg(current.legFar, shade(trim, -0.2), '#dfe4ee');

  // ---- torso: shoulders wide, waist narrow, spine curved by the pose
  const halfShoulder = unit * 0.165;
  const halfWaist = unit * 0.1;
  // The chest-side edge bows with the arch: positive arch pushes the chest
  // forward (open bow), negative rounds the back (hunched dig).
  const chestBow = Math.sin(arch) * unit * 0.1;
  ctx.beginPath();
  ctx.moveTo(shoulderX - halfShoulder, shoulderY);
  ctx.quadraticCurveTo(
    -halfShoulder * 1.02 - chestBow,
    lerp(shoulderY, hipY, 0.55),
    -halfWaist,
    hipY,
  );
  ctx.lineTo(halfWaist, hipY);
  ctx.quadraticCurveTo(
    halfShoulder * 1.02 + chestBow,
    lerp(shoulderY, hipY, 0.55),
    shoulderX + halfShoulder,
    shoulderY,
  );
  // Trapezius line up to the neck.
  ctx.quadraticCurveTo(shoulderX, shoulderY - unit * 0.05, shoulderX - halfShoulder, shoulderY);
  ctx.closePath();
  const kitGrad = ctx.createLinearGradient(-halfShoulder, shoulderY, halfShoulder, hipY);
  kitGrad.addColorStop(0, shade(kit, 0.16));
  kitGrad.addColorStop(0.55, kit);
  kitGrad.addColorStop(1, shade(kit, -0.24));
  ctx.fillStyle = kitGrad;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Kit details: a trim band across the chest and a collar notch.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = trim;
  ctx.fillRect(-halfShoulder * 1.3, shoulderY + unit * 0.1, halfShoulder * 2.8, unit * 0.035);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(-halfShoulder * 1.3, shoulderY + unit * 0.14, halfShoulder * 2.8, unit * 0.012);
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(shoulderX - unit * 0.05, shoulderY - unit * 0.005);
  ctx.lineTo(shoulderX, shoulderY + unit * 0.05);
  ctx.lineTo(shoulderX + unit * 0.05, shoulderY - unit * 0.005);
  ctx.strokeStyle = shade(kit, -0.35);
  ctx.lineWidth = outline;
  ctx.stroke();

  // Shorts with a side stripe.
  ctx.beginPath();
  ctx.moveTo(-halfWaist * 1.06, hipY - unit * 0.05);
  ctx.lineTo(halfWaist * 1.06, hipY - unit * 0.05);
  ctx.lineTo(halfWaist * 1.16, hipY + unit * 0.09);
  ctx.lineTo(-halfWaist * 1.16, hipY + unit * 0.09);
  ctx.closePath();
  const shortsGrad = ctx.createLinearGradient(-halfWaist, hipY, halfWaist, hipY + unit * 0.09);
  shortsGrad.addColorStop(0, shade(trim, 0.12));
  shortsGrad.addColorStop(1, shade(trim, -0.22));
  ctx.fillStyle = shortsGrad;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(halfWaist * 0.98, hipY - unit * 0.045);
  ctx.lineTo(halfWaist * 1.08, hipY + unit * 0.085);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, unit * 0.014);
  ctx.stroke();

  // Number on the chest, mirrored back so it never reads reversed.
  if (unit > 46) {
    ctx.save();
    ctx.scale(facing, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `800 ${unit * 0.15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(p.rotationSlot), facing * shoulderX, shoulderY + unit * 0.26);
    ctx.restore();
  }

  // Near side.
  drawLeg(current.legNear, trim, '#f2f5fb');
  drawArm(current.armNear, kit);

  // ---- head
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(current.head);
  // Neck.
  ctx.beginPath();
  ctx.rect(-unit * 0.03, headR * 0.5, unit * 0.06, unit * 0.062);
  ctx.fillStyle = skinDark;
  ctx.fill();
  // Face: a slightly squared jaw, not an egg.
  ctx.beginPath();
  ctx.moveTo(-headR * 0.92, -headR * 0.3);
  ctx.quadraticCurveTo(-headR * 1.0, headR * 0.5, -headR * 0.4, headR * 0.9);
  ctx.quadraticCurveTo(0, headR * 1.08, headR * 0.45, headR * 0.86);
  ctx.quadraticCurveTo(headR * 1.0, headR * 0.45, headR * 0.94, -headR * 0.3);
  ctx.quadraticCurveTo(headR * 0.6, -headR * 1.05, 0, -headR * 1.02);
  ctx.quadraticCurveTo(-headR * 0.65, -headR * 1.02, -headR * 0.92, -headR * 0.3);
  ctx.closePath();
  const faceGrad = ctx.createLinearGradient(-headR, -headR, headR, headR);
  faceGrad.addColorStop(0, shade(skin, 0.12));
  faceGrad.addColorStop(1, shade(skin, -0.12));
  ctx.fillStyle = faceGrad;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Hair: a cap over the crown, longer at the back.
  ctx.beginPath();
  ctx.ellipse(-unit * 0.004, -headR * 0.28, headR * 1.0, headR * 0.84, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(-headR * 0.98, headR * 0.42);
  ctx.quadraticCurveTo(-headR * 1.18, -headR * 0.2, -headR * 0.98, -headR * 0.5);
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  // Fringe over the brow.
  ctx.beginPath();
  ctx.moveTo(headR * 0.7, -headR * 0.5);
  ctx.quadraticCurveTo(headR * 0.35, -headR * 0.28, headR * 0.72, -headR * 0.1);
  ctx.quadraticCurveTo(headR * 0.95, -headR * 0.35, headR * 0.7, -headR * 0.5);
  ctx.fillStyle = hair;
  ctx.fill();
  // Face features, on the facing side.
  if (unit > 40) {
    ctx.strokeStyle = '#20202c';
    ctx.lineWidth = Math.max(0.8, headR * 0.1);
    // Brow.
    ctx.beginPath();
    ctx.moveTo(headR * 0.28, -headR * 0.16);
    ctx.lineTo(headR * 0.62, -headR * 0.2);
    ctx.stroke();
    // Eye.
    ctx.beginPath();
    ctx.ellipse(headR * 0.45, headR * 0.05, headR * 0.09, headR * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#20202c';
    ctx.fill();
    // Mouth.
    ctx.beginPath();
    ctx.moveTo(headR * 0.4, headR * 0.55);
    ctx.quadraticCurveTo(headR * 0.6, headR * 0.62, headR * 0.74, headR * 0.5);
    ctx.lineWidth = Math.max(0.7, headR * 0.08);
    ctx.stroke();
  }
  ctx.restore();

  // Charge glow on the hitting hand — only for the player the human is
  // steering. The AI holds its button constantly while setting up contacts,
  // and drawing its charge wrapped half the court in a permanent blue aura.
  if (opts.active && p.charge > 0.15) {
    const { ex, ey } = limbPoints(
      shoulderX,
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

/** Lighten (positive) or darken (negative) a hex or rgb() colour. */
export function shade(color: string, amount: number): string {
  let r: number, g: number, b: number;
  const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color.trim());
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(color.trim());
  if (hex) {
    r = parseInt(hex[1], 16);
    g = parseInt(hex[2], 16);
    b = parseInt(hex[3], 16);
  } else if (rgb) {
    r = parseInt(rgb[1], 10);
    g = parseInt(rgb[2], 10);
    b = parseInt(rgb[3], 10);
  } else {
    return color;
  }
  const to = (v: number): number =>
    Math.round(clamp(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount), 0, 255));
  return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
}
