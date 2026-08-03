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
   * How far apart the shoulder joints sit, 0..1 of the normal spacing. A
   * bump platform and an overhead set bring the hands together, so the arms
   * have to converge rather than run parallel from two wide sockets.
   */
  armSpread?: number;
  /**
   * Curve of the spine, radians: positive arches the chest open (the drawn
   * bow of a spike), negative hunches forward (a dig). Applied as a bend
   * between the hips and the shoulders, so the torso is no longer a rigid
   * slab — the single change that most separates these figures from
   * clip-art.
   */
  arch?: number;
  /**
   * Where the feet are, as [forward offset, height above the floor] in units
   * of standing height — far foot then near foot.
   *
   * Grounded poses specify FEET, not joint angles, and the knee is solved to
   * match. Driving the legs from fixed angles while the crouch depth moved the
   * hips independently meant nothing held the feet on the floor: a deep ready
   * stance folded the leg into a Z with the shin swinging out behind, which is
   * exactly the "knees bent forwards, unnatural" look. Real stance geometry is
   * the other way round — the floor and the hips are given, and the knee goes
   * wherever it must.
   */
  feet?: [[number, number], [number, number]];
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
  armSpread = 1,
  feet?: [[number, number], [number, number]],
): Pose => ({ crouch, lean, armFar, armNear, legFar, legNear, head, arch, armSpread, feet });

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
  idle: pose(0.58, 0.3, [0.46, -0.52], [0.3, -0.66], [0.16, 0.92], [-0.13, 0.86], -0.12, -0.16, 1, [
    [-0.09, 0],
    [0.1, 0],
  ]),
  // Sprint: high knee lift, elbows pumping at ninety degrees, torso driving.
  run: pose(0.2, 0.3, [1.0, -0.95], [-0.95, -0.95], [0.8, 0.2], [-0.6, 1.2], 0.04, -0.05),
  // Takeoff: both arms swinging up, legs tucking.
  jumpRise: pose(0.0, -0.1, [2.1, -0.45], [1.6, -0.55], [0.45, 0.9], [-0.3, 1.0], -0.12, 0.1),
  // The cocked spike, back arched like a drawn bow: chest open, hitting arm
  // folded behind the head, off arm high for balance, legs trailing behind.
  spikeCock: pose(0.0, -0.42, [3.5, 0.95], [2.1, -0.35], [-0.55, 1.15], [-0.75, 1.0], -0.34, 0.5),
  // The hit itself: the bow releases — torso jackknifes, arm whips through,
  // legs pike forward.
  spikeHit: pose(0.05, 0.34, [2.62, -0.08], [0.55, -0.85], [0.7, 0.45], [0.42, 0.62], 0.06, -0.3),
  // Grounded attack/tip follow-through shares the hit shape.
  spike: pose(0.08, 0.3, [2.3, -0.2], [0.3, -0.8], [0.4, 0.55], [-0.4, 0.5], 0.06, -0.2),
  jump: pose(0.0, -0.1, [2.1, -0.45], [1.6, -0.55], [0.45, 0.9], [-0.3, 1.0], -0.12, 0.1),
  // Penetrating block: both arms rammed straight up, body a plank.
  block: pose(0.0, 0.04, [3.16, -0.04], [2.88, -0.08], [0.12, 0.45], [-0.12, 0.45], -0.16, 0.08, 0.9),
  // Overhead set: hands above the forehead, elbows out, knees loaded.
  set: pose(0.34, 0.02, [2.3, -0.62], [2.68, -0.46], [0.26, 0.5], [-0.26, 0.5], -0.2, 0.12, 0.8, [
    [-0.07, 0],
    [0.08, 0],
  ]),
  // The platform: both arms dead straight, locked together, angled to the
  // ball; deep staggered squat, eyes up.
  bump: pose(0.62, 0.34, [1.0, -0.02], [0.9, -0.02], [0.55, 0.8], [-0.5, 0.75], -0.14, -0.3, 0.5, [
    [-0.13, 0],
    [0.14, 0],
  ]),
  // Holding the ball out front, ready to toss.
  serve: pose(0.3, 0.12, [0.3, -0.7], [1.5, -0.15], [0.3, 0.4], [-0.22, 0.35], -0.06, 0.05, 1, [
    [-0.1, 0],
    [0.09, 0],
  ]),
  // Full-extension dig: body laid out horizontal (the draw code rotates it
  // flat), both arms locked straight past the head, legs trailing.
  dive: pose(0.35, 1.35, [2.66, -0.06], [2.56, -0.1], [-0.35, 0.5], [-0.6, 0.35], -0.42, 0.25, 0.35),
  // Absorbing the landing: deep flex, arms out for balance.
  land: pose(0.66, 0.2, [0.6, -0.7], [0.42, -0.8], [0.34, 0.95], [-0.3, 0.95], 0.06, -0.18, 1, [
    [-0.14, 0],
    [0.15, 0],
  ]),
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
  armSpread: lerp(a.armSpread ?? 1, b.armSpread ?? 1, t),
  feet:
    a.feet && b.feet
      ? [
          [lerp(a.feet[0][0], b.feet[0][0], t), lerp(a.feet[0][1], b.feet[0][1], t)],
          [lerp(a.feet[1][0], b.feet[1][0], t), lerp(a.feet[1][1], b.feet[1][1], t)],
        ]
      : (b.feet ?? a.feet),
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

/**
 * Two-bone inverse kinematics in the drawing plane.
 *
 * Given a hip and a foot, place the knee. `kneeDir` is +1 when the knee should
 * bow towards the front of the figure, which for a leg it always does. When the
 * target is further away than the leg is long the leg simply straightens
 * towards it rather than tearing free of the foot.
 */
function solveLeg(
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  upper: number,
  lower: number,
  kneeDir: number,
): { jx: number; jy: number; ex: number; ey: number } {
  let dx = fx - hx;
  let dy = fy - hy;
  let d = Math.hypot(dx, dy);
  const max = (upper + lower) * 0.999;
  const min = Math.abs(upper - lower) * 1.001 + 1e-4;
  if (d > max) {
    const k = max / d;
    dx *= k;
    dy *= k;
    d = max;
  } else if (d < min) {
    const k = min / Math.max(d, 1e-4);
    dx *= k;
    dy *= k;
    d = min;
  }
  const ex = hx + dx;
  const ey = hy + dy;
  // Distance along the hip->foot line to the knee's projection.
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const ux = dx / d;
  const uy = dy / d;
  return {
    jx: hx + ux * a + uy * h * kneeDir,
    jy: hy + uy * a - ux * h * kneeDir,
    ex,
    ey,
  };
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
    // A stride is contralateral: the leg that swings forward pairs with the
    // arm on the OTHER side. `phase` drives the far leg; the far arm takes
    // the opposite sign, the near pair mirrors both.
    const phase = Math.sin(st.runPhase);
    // Each foot is planted at the back of its stride and lifts through the
    // front of it, so the run is driven by the floor like the other grounded
    // poses instead of floating on joint angles.
    const stride = 0.26;
    // A foot is planted while it travels BACKWARD under the body and lifts
    // while it swings forward. Lifting it at the front of the stride instead
    // — where it should be reaching for the floor — is what turns a run into
    // a skate. The foot moves forward when cos(phase) is positive.
    const swingPhase = Math.cos(st.runPhase);
    const farLift = Math.max(0, swingPhase) * 0.15;
    const nearLift = Math.max(0, -swingPhase) * 0.15;
    target = {
      ...target,
      // A touch of vertical bob per stride sells the footfalls.
      crouch: target.crouch + Math.abs(Math.cos(st.runPhase)) * 0.06,
      // Elbows fold FORWARD, so their bend is negative. This override kept the
      // positive value the whole pose table was corrected away from, which is
      // why a running player's forearms pointed the wrong way and the arms
      // read as fighting the legs.
      armFar: [-0.9 * phase, -0.95],
      armNear: [0.9 * phase, -0.95],
      feet: [
        [stride * phase, farLift],
        [-stride * phase, nearLift],
      ],
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

  // Proportions are canonical figure-drawing ratios of standing height, not
  // eyeballed numbers. An earlier version gave the figure shoulders a third of
  // its height wide over a waist that pinched to nothing, which is why the
  // torso read as a trapezoid rather than a body.
  //   head height   0.135   (a 7.4-head figure, athletic-heroic)
  //   shoulders     0.236   (about two head-heights across)
  //   waist         0.158   pelvis 0.194 — the body flares BACK OUT at the
  //                         hips, and that reversal is what makes a torso
  //   crotch        0.47    arm 0.185 + 0.15 + hand, so fingertips fall at
  //                         mid-thigh with the arm hanging
  const arch = current.arch ?? 0;
  const hipY = -unit * (0.47 - current.crouch * 0.2);
  // The spine bend shifts the shoulders fore/aft of the hips.
  const shoulderX = -Math.sin(arch) * unit * 0.15;
  const shoulderY = -unit * (0.8 - current.crouch * 0.26) + Math.abs(arch) * unit * 0.02;
  const neckY = shoulderY - unit * 0.028;
  const headW = unit * 0.058;
  const headH = unit * 0.077;
  const headX = shoulderX - Math.sin(arch) * unit * 0.05;
  const headY = neckY - headH * 0.92;

  const chestY = lerp(shoulderY, hipY, 0.24);
  const waistY = lerp(shoulderY, hipY, 0.66);
  // Torso half-DEPTHS, seen from the side. Chest depth is about 0.19 of
  // standing height on an athlete, waist 0.15, hips 0.18 — far narrower than
  // the 0.24 shoulder breadth a front view would show.
  const halfChest = unit * 0.094;
  const halfWaist = unit * 0.072;
  const halfPelvis = unit * 0.089;

  const thigh = unit * 0.245;
  const shin = unit * 0.225;
  const upperArm = unit * 0.185;
  const foreArm = unit * 0.15;
  const outline = Math.max(0.7, unit * 0.018);

  ctx.save();
  // Depth haze follows how far across the court the player is, not which team
  // they are on: in this projection the far half of *both* courts is upstage.
  ctx.globalAlpha = 1 - clamp((p.pos.x + 4.5) / 9, 0, 1) * 0.09;
  ctx.translate(feet.x, feet.y);
  ctx.rotate(st.tilt * facing);
  ctx.scale(facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /**
   * A shoe, drawn as a shoe: heel counter, sole running forward under the
   * arch, toe cap. Aligned with the shin so it follows the leg, but only
   * partly, because a planted foot stays flat on the floor whatever the shin
   * is doing. The previous version was a horizontal ellipse — a blob.
   */
  const drawShoe = (ax: number, ay: number, shinAngle: number, shoeFill: string): void => {
    // Screen angle of the shin; the foot sits roughly perpendicular to it,
    // damped so a bent knee does not swivel the foot off the floor.
    const foot = Math.atan2(Math.sin(shinAngle), Math.cos(shinAngle)) * 0.35;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-foot);
    const s = unit;
    ctx.beginPath();
    ctx.moveTo(-s * 0.028, -s * 0.012);
    ctx.quadraticCurveTo(-s * 0.044, s * 0.016, -s * 0.03, s * 0.036);
    ctx.lineTo(s * 0.07, s * 0.036);
    ctx.quadraticCurveTo(s * 0.096, s * 0.032, s * 0.088, s * 0.014);
    ctx.quadraticCurveTo(s * 0.05, -s * 0.008, s * 0.016, -s * 0.018);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -s * 0.02, 0, s * 0.04);
    g.addColorStop(0, shade(shoeFill, 0.12));
    g.addColorStop(1, shade(shoeFill, -0.22));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Sole.
    ctx.beginPath();
    ctx.moveTo(-s * 0.03, s * 0.03);
    ctx.lineTo(s * 0.072, s * 0.03);
    ctx.quadraticCurveTo(s * 0.096, s * 0.032, s * 0.088, s * 0.014);
    ctx.lineTo(s * 0.09, s * 0.024);
    ctx.quadraticCurveTo(s * 0.09, s * 0.04, s * 0.068, s * 0.039);
    ctx.lineTo(-s * 0.028, s * 0.039);
    ctx.closePath();
    ctx.fillStyle = '#cfd4dd';
    ctx.fill();
    ctx.restore();
  };

  const drawLeg = (
    spec: [number, number],
    foot: [number, number] | null,
    side: number,
    legFill: string,
    shortsFill: string,
    shoeFill: string,
  ): void => {
    // Legs hang from hip joints set apart across the pelvis, not from a single
    // point in the middle of the body.
    const hipX = side * unit * 0.016;
    // A planted foot wins over any joint angle: solve the knee to reach it.
    // `facing` has already been applied to the canvas, so the foot's forward
    // offset is in the figure's own frame and the knee always bows forward.
    const { jx, jy, ex, ey } = foot
      ? solveLeg(hipX, hipY, foot[0] * unit, -foot[1] * unit, thigh, shin, 1)
      : limbPoints(hipX, hipY, spec[0], spec[1], thigh, shin);
    // Legs are bare skin — they are a volleyball player's, not a footballer's.
    // Painting them in the kit colour, as an earlier version did, fused torso,
    // shorts and legs into one solid block with no readable silhouette.
    capsule(ctx, hipX, hipY, jx, jy, unit * 0.098, unit * 0.064, legFill, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.07, unit * 0.038, legFill, outline);
    // The shorts leg, worn over the top of the thigh.
    capsule(
      ctx,
      hipX,
      hipY - unit * 0.01,
      lerp(hipX, jx, 0.34),
      lerp(hipY, jy, 0.34),
      unit * 0.112,
      unit * 0.094,
      shortsFill,
      outline,
    );
    // Knee pad — the volleyball player's badge.
    ctx.beginPath();
    ctx.ellipse(jx, jy, unit * 0.035, unit * 0.03, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#dbd6cb';
    ctx.fill();
    ctx.lineWidth = outline * 0.8;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Sock over the ankle.
    capsule(
      ctx,
      lerp(jx, ex, 0.74),
      lerp(jy, ey, 0.74),
      ex,
      ey,
      unit * 0.048,
      unit * 0.042,
      '#f2f2f0',
      outline * 0.8,
      true,
    );
    drawShoe(ex, ey, Math.atan2(ex - jx, ey - jy), shoeFill);
  };

  /** A hand: a mitt aligned with the forearm, with a thumb — not a ball. */
  const drawHand = (jx: number, jy: number, ex: number, ey: number): void => {
    const a = Math.atan2(ey - jy, ex - jx);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(unit * 0.026, 0, unit * 0.036, unit * 0.024, 0, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.lineWidth = outline;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Thumb, on the palm side.
    ctx.beginPath();
    ctx.ellipse(unit * 0.012, -unit * 0.019, unit * 0.019, unit * 0.011, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = shade(skin, -0.08);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const drawArm = (spec: [number, number], side: number, sleeve: string): void => {
    // Arms hang from the shoulder joints out at the corners of the torso. An
    // earlier version rooted both arms at the body's centre line, which is
    // what made the shoulders read as a flat bar with limbs sprouting from
    // the middle of the chest.
    const ox = shoulderX + side * unit * 0.026 * (current.armSpread ?? 1);
    const oy = shoulderY + unit * 0.012;
    const { jx, jy, ex, ey } = limbPoints(ox, oy, spec[0], spec[1], upperArm, foreArm);
    // Upper arm thicker at the biceps, forearm tapering to a slim wrist.
    capsule(ctx, ox, oy, jx, jy, unit * 0.058, unit * 0.046, skin, outline);
    capsule(ctx, jx, jy, ex, ey, unit * 0.048, unit * 0.032, skin, outline);
    // Deltoid cap and short sleeve over the top of the upper arm.
    capsule(
      ctx,
      ox,
      oy - unit * 0.004,
      lerp(ox, jx, 0.44),
      lerp(oy, jy, 0.44),
      unit * 0.072,
      unit * 0.062,
      sleeve,
      0,
      true,
    );
    drawHand(jx, jy, ex, ey);
  };

  // Far side first, so the body reads with depth.
  drawArm(current.armFar, -1, shade(kit, -0.22));
  drawLeg(current.legFar, current.feet?.[0] ?? null, -1, shade(skin, -0.14), shade(trim, -0.2), '#dfe4ee');

  // ---- torso
  //
  // Four control widths, not two: shoulders, ribcage, waist, pelvis. The
  // silhouette narrows from the ribs to the waist and then FLARES BACK OUT at
  // the hips. Straight lines from a wide shoulder to a pinched waist are what
  // made the earlier figure a trapezoid; a real torso is two stacked masses
  // joined at a narrow middle.
  //
  const spineX = (t: number): number => lerp(0, shoulderX, t);
  // The outline runs THROUGH these widths. Feeding them to bezierCurveTo as
  // control points, as an earlier version did, meant the curve never reached
  // the narrow waist — it bulged outside it, and the torso came out a
  // rounded rectangle no matter what the numbers said. Chaining quadratics
  // between midpoints keeps the silhouette on the anatomy.
  // These are DEPTHS — chest front-to-back — not shoulder breadth. The camera
  // looks along the court from the side, so a torso drawn at its shoulder
  // width is a body turned to face the viewer inside a side-on scene: the
  // single thing that made the figures read as wrong. In profile the front
  // edge bulges at the chest, hollows at the waist and comes forward again at
  // the hip, while the back edge runs the other way and the buttock projects.
  const archF = Math.sin(arch);
  const frontEdge: [number, number][] = [
    [shoulderX + unit * 0.05, shoulderY - unit * 0.004],
    [spineX(0.8) + halfChest + archF * unit * 0.028, chestY],
    [spineX(0.35) + halfWaist * 0.94 - archF * unit * 0.014, waistY],
    [halfPelvis * 0.82, hipY - unit * 0.03],
  ];
  const backEdge: [number, number][] = [
    [-halfPelvis - archF * unit * 0.022, hipY - unit * 0.02],
    [spineX(0.35) - halfWaist * 0.88 + archF * unit * 0.022, waistY],
    [spineX(0.8) - halfChest * 0.95 - archF * unit * 0.012, chestY],
    [shoulderX - unit * 0.062, shoulderY - unit * 0.008],
  ];
  const through = (pts: [number, number][]): void => {
    for (let i = 1; i < pts.length - 1; i++) {
      const [cx, cy] = pts[i];
      const [nx2, ny2] = pts[i + 1];
      ctx.quadraticCurveTo(cx, cy, (cx + nx2) / 2, (cy + ny2) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  };
  const path = (): void => {
    ctx.beginPath();
    // Down the front: chest, abdomen, front of the pelvis.
    ctx.moveTo(frontEdge[0][0], frontEdge[0][1]);
    through(frontEdge);
    // Under the crotch and round to the buttock.
    ctx.quadraticCurveTo(
      halfPelvis * 0.6,
      hipY + unit * 0.028,
      -unit * 0.01,
      hipY + unit * 0.026,
    );
    ctx.quadraticCurveTo(
      -halfPelvis * 0.9,
      hipY + unit * 0.018,
      backEdge[0][0],
      backEdge[0][1],
    );
    // Up the back: lumbar hollow, upper back, back of the shoulder.
    through(backEdge);
    // Trapezius, sloping up to the neck and down to the front of the shoulder.
    ctx.quadraticCurveTo(shoulderX - unit * 0.03, neckY - unit * 0.006, shoulderX, neckY);
    ctx.quadraticCurveTo(
      shoulderX + unit * 0.032,
      shoulderY - unit * 0.024,
      frontEdge[0][0],
      frontEdge[0][1],
    );
    ctx.closePath();
  };
  path();
  const kitGrad = ctx.createLinearGradient(-halfChest, shoulderY, halfChest, hipY);
  kitGrad.addColorStop(0, shade(kit, 0.16));
  kitGrad.addColorStop(0.55, kit);
  kitGrad.addColorStop(1, shade(kit, -0.24));
  ctx.fillStyle = kitGrad;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Kit details, clipped to the torso: shorts covering the pelvis, a trim
  // band across the chest, a collar notch.
  ctx.save();
  path();
  ctx.clip();
  const shortsTop = lerp(waistY, hipY, 0.72);
  const shortsGrad = ctx.createLinearGradient(0, shortsTop, 0, hipY + unit * 0.03);
  shortsGrad.addColorStop(0, shade(trim, 0.12));
  shortsGrad.addColorStop(1, shade(trim, -0.24));
  ctx.fillStyle = shortsGrad;
  ctx.fillRect(-halfPelvis * 1.3, shortsTop, halfPelvis * 2.6, hipY + unit * 0.06 - shortsTop);
  ctx.fillStyle = trim;
  ctx.fillRect(-halfChest * 1.6, chestY - unit * 0.01, halfChest * 3.2, unit * 0.026);
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fillRect(-halfChest * 1.6, chestY + unit * 0.018, halfChest * 3.2, unit * 0.009);
  // Waistband and collar stay INSIDE the clip. Drawn outside it, as they were,
  // their ends projected past the body outline — the stray lines sticking out
  // of the figures.
  ctx.beginPath();
  ctx.moveTo(-halfPelvis * 1.4, shortsTop);
  ctx.lineTo(halfPelvis * 1.4, shortsTop);
  ctx.strokeStyle = shade(trim, -0.4);
  ctx.lineWidth = outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shoulderX - unit * 0.042, shoulderY - unit * 0.012);
  ctx.lineTo(shoulderX, shoulderY + unit * 0.032);
  ctx.lineTo(shoulderX + unit * 0.042, shoulderY - unit * 0.012);
  ctx.strokeStyle = shade(kit, -0.35);
  ctx.lineWidth = outline;
  ctx.stroke();
  ctx.restore();

  // Number on the chest, mirrored back so it never reads reversed.
  if (unit > 46) {
    ctx.save();
    ctx.scale(facing, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `800 ${unit * 0.085}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    // On the hip: in profile there is no chest facing the camera to print a
    // number on, and a number floating on a side-on ribcage is exactly the
    // kind of front-view tell that broke the illusion.
    ctx.fillText(String(p.rotationSlot), facing * -unit * 0.02, lerp(waistY, hipY, 0.95));
    ctx.restore();
  }

  // Near side.
  drawLeg(current.legNear, current.feet?.[1] ?? null, 1, skin, trim, '#f2f5fb');
  drawArm(current.armNear, 1, kit);

  // ---- head
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(current.head);
  // Neck: narrower than the head, running down into the trapezius.
  ctx.beginPath();
  ctx.rect(-unit * 0.024, headH * 0.34, unit * 0.048, unit * 0.05);
  ctx.fillStyle = skinDark;
  ctx.fill();
  // Head IN PROFILE — the body is seen from the side, so the face has to be
  // too. Forehead, brow, the nose breaking the outline, lips, chin, jaw, and
  // the skull rounding away at the back. A front-facing oval on a side-on
  // body was the loudest wrong note in the whole figure.
  ctx.beginPath();
  ctx.moveTo(-headW * 0.55, -headH * 0.86); // back of the crown
  ctx.quadraticCurveTo(headW * 0.45, -headH * 1.06, headW * 0.82, -headH * 0.52); // forehead
  ctx.quadraticCurveTo(headW * 0.98, -headH * 0.34, headW * 0.9, -headH * 0.16); // brow
  ctx.lineTo(headW * 1.22, headH * 0.06); // bridge to the tip of the nose
  ctx.lineTo(headW * 0.86, headH * 0.16); // under the nose
  ctx.quadraticCurveTo(headW * 0.98, headH * 0.34, headW * 0.8, headH * 0.46); // lips
  ctx.quadraticCurveTo(headW * 0.86, headH * 0.72, headW * 0.4, headH * 0.9); // chin
  ctx.quadraticCurveTo(-headW * 0.3, headH * 1.0, -headW * 0.72, headH * 0.4); // jaw
  ctx.quadraticCurveTo(-headW * 1.06, -headH * 0.2, -headW * 0.55, -headH * 0.86); // skull
  ctx.closePath();
  const faceGrad = ctx.createLinearGradient(-headW, -headH, headW, headH);
  faceGrad.addColorStop(0, shade(skin, 0.1));
  faceGrad.addColorStop(1, shade(skin, -0.14));
  ctx.fillStyle = faceGrad;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Ear, set back at the jaw hinge.
  ctx.beginPath();
  ctx.ellipse(-headW * 0.1, headH * 0.08, headW * 0.13, headH * 0.13, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = shade(skin, -0.1);
  ctx.fill();
  ctx.lineWidth = outline * 0.7;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Hair. Four cuts, picked from the player id: a whole team wearing one
  // haircut is the tell that these are copies of a single figure rather than
  // twelve different people.
  const cut = p.id % 4;
  const nape = cut === 0 ? 0.5 : cut === 1 ? 0.16 : cut === 2 ? 0.72 : 0.28;
  const volume = cut === 3 ? 1.3 : cut === 1 ? 1.0 : 1.14;
  const brow = cut === 2 ? 0.3 : 0.44;
  ctx.beginPath();
  ctx.moveTo(headW * 0.84, -headH * brow);
  ctx.quadraticCurveTo(
    headW * 0.42,
    -headH * (0.86 + 0.3 * volume),
    -headW * 0.58,
    -headH * 0.92 * volume,
  );
  ctx.quadraticCurveTo(-headW * 1.16 * volume, -headH * 0.3, -headW * 0.8, headH * nape);
  ctx.quadraticCurveTo(-headW * 0.5, headH * (nape - 0.22), -headW * 0.5, -headH * 0.16);
  ctx.quadraticCurveTo(-headW * 0.3, -headH * 0.68, headW * 0.84, -headH * brow);
  ctx.closePath();
  ctx.fillStyle = hair;
  ctx.fill();
  if (cut === 1) {
    // A headband, for the sweatband generation.
    ctx.beginPath();
    ctx.moveTo(headW * 0.92, -headH * 0.34);
    ctx.lineTo(-headW * 0.9, -headH * 0.46);
    ctx.lineWidth = headH * 0.19;
    ctx.strokeStyle = '#e9eef7';
    ctx.stroke();
  }
  // Face features, in profile.
  //
  // A heavy brow angled down towards the nose reads as a scowl, and every
  // player wearing it made the whole court look furious. The brow is now a
  // light, level accent and the mouth is relaxed.
  if (unit > 40) {
    ctx.strokeStyle = 'rgba(40,36,52,0.75)';
    ctx.lineWidth = Math.max(0.7, headW * 0.085);
    ctx.beginPath();
    ctx.moveTo(headW * 0.48, -headH * 0.24);
    ctx.lineTo(headW * 0.86, -headH * 0.26);
    ctx.stroke();
    // Eye, close to the nose the way a profile puts it.
    ctx.beginPath();
    ctx.ellipse(headW * 0.66, -headH * 0.02, headW * 0.11, headH * 0.095, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#20202c';
    ctx.fill();
    // Mouth: a short relaxed line, with a hint of a smile on some players.
    ctx.beginPath();
    ctx.moveTo(headW * 0.64, headH * 0.36);
    ctx.quadraticCurveTo(
      headW * 0.76,
      headH * (p.id % 3 === 0 ? 0.42 : 0.36),
      headW * 0.86,
      headH * 0.33,
    );
    ctx.strokeStyle = 'rgba(40,36,52,0.7)';
    ctx.lineWidth = Math.max(0.6, headW * 0.075);
    ctx.stroke();
  }
  ctx.restore();

  // Charge glow on the hitting hand — only for the player the human is
  // steering. The AI holds its button constantly while setting up contacts,
  // and drawing its charge wrapped half the court in a permanent blue aura.
  if (opts.active && p.charge > 0.15) {
    const { ex, ey } = limbPoints(
      shoulderX - unit * 0.026,
      shoulderY + unit * 0.012,
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
