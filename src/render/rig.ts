import { clamp, lerp } from '../core/math3';
import { OUTLINE, capsule, shade } from './players';

/**
 * A skeletal figure.
 *
 * The existing figure has four joints per limb — shoulder and elbow, hip and
 * knee — and one held pose per action. That is the ceiling it keeps hitting:
 * with no wrist the hand is welded to the forearm, with no ankle the foot is
 * welded to the shin, with no articulated spine the torso is a single rigid
 * mass, and with one pose per action there is nothing between the start of a
 * movement and the end of it. No amount of tuning gets a body out of that,
 * because the body is not in there to begin with.
 *
 * So this is a different thing: a named skeleton of sixteen joints with a real
 * parent chain, driven by KEYFRAMES — several posed instants per action with
 * eased interpolation between them — the way character animation has been done
 * since long before 1994. The spike below is eight keys where the old system
 * had three poses, and that is where the difference comes from.
 *
 * Angles are (sin a, cos a) with screen y growing downward, so 0 hangs
 * straight down, PI/2 reaches forward-horizontal and PI points straight up.
 * Each angle is RELATIVE TO ITS PARENT, which is what makes a whip — rotate
 * the shoulder and the elbow, wrist and hand all come with it.
 *
 * ONE sign convention, everywhere: a positive angle swings the limb FORWARD,
 * in the direction the figure faces. So a flexing knee — which folds the shin
 * backwards — is negative, and a flexing elbow — which brings the hand forward
 * — is positive. Getting this wrong in one joint is invisible in the numbers
 * and unmistakable on screen: the first pass had the legs kicked out in front
 * and the arms pointing out the back.
 *
 * Rest angles are chosen so that a pose of all zeroes stands upright with the
 * arms hanging and the legs straight, which makes every keyframe below a
 * readable departure from standing rather than from an arbitrary crouch.
 */

export type Joint =
  | 'pelvis'
  | 'lumbar'
  | 'thorax'
  | 'neck'
  | 'head'
  | 'clavicleFar'
  | 'shoulderFar'
  | 'elbowFar'
  | 'wristFar'
  | 'clavicleNear'
  | 'shoulderNear'
  | 'elbowNear'
  | 'wristNear'
  | 'hipFar'
  | 'kneeFar'
  | 'ankleFar'
  | 'hipNear'
  | 'kneeNear'
  | 'ankleNear';

interface Bone {
  parent: Joint | null;
  /** Length as a fraction of standing height. */
  length: number;
  /** Angle when every joint is zeroed, relative to the parent. */
  rest: number;
}

/**
 * Proportions are canonical figure-drawing ratios of standing height. The
 * chain runs from the pelvis outwards, so a rotation anywhere carries
 * everything below it — which is the entire reason for building it this way.
 */
export const SKELETON: Record<Joint, Bone> = {
  pelvis: { parent: null, length: 0, rest: 0 },
  lumbar: { parent: 'pelvis', length: 0.1, rest: Math.PI },
  thorax: { parent: 'lumbar', length: 0.17, rest: 0 },
  neck: { parent: 'thorax', length: 0.05, rest: 0 },
  head: { parent: 'neck', length: 0.13, rest: 0 },

  clavicleFar: { parent: 'thorax', length: 0.045, rest: -Math.PI * 0.5 },
  shoulderFar: { parent: 'clavicleFar', length: 0.175, rest: -Math.PI * 0.5 },
  elbowFar: { parent: 'shoulderFar', length: 0.145, rest: 0 },
  wristFar: { parent: 'elbowFar', length: 0.055, rest: 0 },

  clavicleNear: { parent: 'thorax', length: 0.045, rest: -Math.PI * 0.5 },
  shoulderNear: { parent: 'clavicleNear', length: 0.175, rest: -Math.PI * 0.5 },
  elbowNear: { parent: 'shoulderNear', length: 0.145, rest: 0 },
  wristNear: { parent: 'elbowNear', length: 0.055, rest: 0 },

  hipFar: { parent: 'pelvis', length: 0.035, rest: Math.PI * 0.5 },
  kneeFar: { parent: 'hipFar', length: 0.245, rest: -Math.PI * 0.5 },
  ankleFar: { parent: 'kneeFar', length: 0.225, rest: 0 },

  hipNear: { parent: 'pelvis', length: 0.035, rest: Math.PI * 0.5 },
  kneeNear: { parent: 'hipNear', length: 0.245, rest: -Math.PI * 0.5 },
  ankleNear: { parent: 'kneeNear', length: 0.225, rest: 0 },
};

/** Joint angles, in radians, relative to the parent. Absent means rest. */
export type RigPose = Partial<Record<Joint, number>> & {
  /** Height of the pelvis above the floor, as a fraction of standing height. */
  hipHeight?: number;
  /** Rotation of the whole figure about the pelvis. */
  root?: number;
};

export interface Solved {
  /** Start and end point of every bone, in units of standing height. */
  at: Record<Joint, { x: number; y: number }>;
  /** Absolute angle of every bone, for anything that has to align to it. */
  angle: Record<Joint, number>;
}

/**
 * Forward kinematics down the chain. Positions come out in units of standing
 * height with the pelvis at the origin and y growing downward.
 */
export function solveRig(pose: RigPose): Solved {
  const at = {} as Solved['at'];
  const angle = {} as Solved['angle'];
  const order: Joint[] = Object.keys(SKELETON) as Joint[];

  for (const j of order) {
    const bone = SKELETON[j];
    const parentAngle = bone.parent ? angle[bone.parent] : (pose.root ?? 0);
    const parentPos = bone.parent ? at[bone.parent] : { x: 0, y: 0 };
    const a = parentAngle + bone.rest + (pose[j] ?? 0);
    angle[j] = a;
    at[j] = {
      x: parentPos.x + Math.sin(a) * bone.length,
      y: parentPos.y + Math.cos(a) * bone.length,
    };
  }
  return { at, angle };
}

export interface Keyframe {
  /** Seconds from the start of the action. */
  t: number;
  pose: RigPose;
}

const EASE = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

/**
 * Sample an animation at a time.
 *
 * Eased between keys rather than linear: a body accelerates out of a pose and
 * decelerates into the next one, and straight-line interpolation is most of
 * what makes cheap animation read as mechanical.
 */
export function sampleRig(keys: Keyframe[], t: number): RigPose {
  if (!keys.length) return {};
  if (t <= keys[0].t) return keys[0].pose;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;

  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = EASE(clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1));

  const out: RigPose = {};
  const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
  for (const name of names) {
    const key = name as keyof RigPose;
    const av = (a.pose[key] as number | undefined) ?? 0;
    const bv = (b.pose[key] as number | undefined) ?? 0;
    (out[key] as number) = lerp(av, bv, u);
  }
  return out;
}

/**
 * The spike, as eight posed instants.
 *
 * This is the whole argument for the rewrite in one place. The old system had
 * three states — rise, cock, hit — and jumped between them; a real swing is a
 * chain of events with an order and a rhythm: plant, load, throw the arms,
 * leave the floor, draw the bow, whip through, follow the arm across the body,
 * absorb the landing. Every one of those has to exist as its own instant or
 * the movement has nothing in the middle.
 */
export const SPIKE: Keyframe[] = [
  // Last stride of the approach: leg out in front, arms trailing behind.
  {
    t: 0,
    pose: {
      hipHeight: 0.46,
      lumbar: -0.12,
      thorax: 0.18,
      head: -0.16,
      clavicleFar: -0.15,
      shoulderFar: -0.75,
      elbowFar: 0.5,
      wristFar: -0.15,
      clavicleNear: 0.15,
      shoulderNear: -0.95,
      elbowNear: 0.45,
      hipFar: 0.5,
      kneeFar: -0.5,
      ankleFar: 0.25,
      hipNear: -0.55,
      kneeNear: -0.75,
      ankleNear: -0.2,
    },
  },
  // Plant and load: both feet down, deepest crouch, arms swung fully back.
  {
    t: 0.13,
    pose: {
      hipHeight: 0.33,
      lumbar: -0.3,
      thorax: 0.42,
      head: -0.3,
      clavicleFar: -0.2,
      shoulderFar: -1.35,
      elbowFar: 0.2,
      wristFar: -0.1,
      clavicleNear: 0.2,
      shoulderNear: -1.5,
      elbowNear: 0.15,
      hipFar: 0.42,
      kneeFar: -1.15,
      ankleFar: 0.5,
      hipNear: 0.3,
      kneeNear: -1.25,
      ankleNear: 0.55,
    },
  },
  // Throw the arms and extend: the block-and-drive that produces the height.
  {
    t: 0.24,
    pose: {
      hipHeight: 0.58,
      lumbar: -0.05,
      thorax: 0.05,
      head: -0.05,
      clavicleFar: -0.1,
      shoulderFar: 1.5,
      elbowFar: 0.35,
      wristFar: 0.1,
      clavicleNear: 0.1,
      shoulderNear: 1.7,
      elbowNear: 0.3,
      hipFar: -0.1,
      kneeFar: -0.1,
      ankleFar: -0.35,
      hipNear: -0.05,
      kneeNear: -0.08,
      ankleNear: -0.4,
    },
  },
  // Rising, both arms high, body long.
  {
    t: 0.36,
    pose: {
      hipHeight: 0.86,
      lumbar: 0.06,
      thorax: -0.1,
      head: 0.06,
      clavicleFar: -0.05,
      shoulderFar: 2.5,
      elbowFar: 0.25,
      wristFar: 0.05,
      clavicleNear: 0.05,
      shoulderNear: 2.7,
      elbowNear: 0.2,
      hipFar: -0.2,
      kneeFar: -0.3,
      ankleFar: -0.2,
      hipNear: -0.05,
      kneeNear: -0.45,
      ankleNear: -0.25,
    },
  },
  // The bow. Back arched, hitting elbow high and behind the head, off arm
  // extended at the ball — the shape everyone recognises as a spike.
  {
    t: 0.5,
    pose: {
      hipHeight: 1.0,
      lumbar: 0.34,
      thorax: -0.42,
      head: 0.2,
      clavicleFar: 0.1,
      shoulderFar: 3.35,
      elbowFar: -1.15,
      wristFar: 0.35,
      clavicleNear: -0.05,
      shoulderNear: 2.35,
      elbowNear: 0.2,
      hipFar: -0.55,
      kneeFar: -0.75,
      ankleFar: -0.15,
      hipNear: -0.35,
      kneeNear: -0.95,
      ankleNear: -0.2,
    },
  },
  // Contact. The bow releases: torso jackknifes forward, hitting arm snaps
  // straight, the wrist rolls over the top of the ball, legs pike through.
  {
    t: 0.58,
    pose: {
      hipHeight: 0.98,
      lumbar: -0.24,
      thorax: 0.3,
      head: -0.1,
      clavicleFar: 0.05,
      shoulderFar: 2.72,
      elbowFar: 0.02,
      wristFar: -0.55,
      clavicleNear: -0.1,
      shoulderNear: 1.15,
      elbowNear: 0.85,
      hipFar: 0.55,
      kneeFar: -0.35,
      ankleFar: 0.1,
      hipNear: 0.4,
      kneeNear: -0.5,
      ankleNear: 0.1,
    },
  },
  // Follow-through: the arm carries down and across the body, which is where
  // the energy goes and the single most-missed beat in a cheap swing.
  {
    t: 0.72,
    pose: {
      hipHeight: 0.78,
      lumbar: -0.32,
      thorax: 0.4,
      head: -0.22,
      clavicleFar: 0,
      shoulderFar: 1.05,
      elbowFar: 0.55,
      wristFar: -0.3,
      clavicleNear: -0.05,
      shoulderNear: 0.35,
      elbowNear: 0.7,
      hipFar: 0.75,
      kneeFar: -0.55,
      ankleFar: 0.15,
      hipNear: 0.6,
      kneeNear: -0.7,
      ankleNear: 0.15,
    },
  },
  // Landing, absorbed through the knees.
  {
    t: 0.92,
    pose: {
      hipHeight: 0.34,
      lumbar: -0.22,
      thorax: 0.3,
      head: -0.18,
      clavicleFar: 0,
      shoulderFar: -0.4,
      elbowFar: 0.75,
      wristFar: -0.1,
      clavicleNear: 0,
      shoulderNear: -0.25,
      elbowNear: 0.8,
      hipFar: 0.25,
      kneeFar: -1.1,
      ankleFar: 0.45,
      hipNear: 0.15,
      kneeNear: -1.2,
      ankleNear: 0.5,
    },
  },
  // Recover to the ready stance.
  {
    t: 1.15,
    pose: {
      hipHeight: 0.44,
      lumbar: -0.14,
      thorax: 0.2,
      head: -0.12,
      shoulderFar: -0.35,
      elbowFar: 0.55,
      shoulderNear: -0.2,
      elbowNear: 0.6,
      hipFar: 0.16,
      kneeFar: -0.55,
      ankleFar: 0.22,
      hipNear: -0.1,
      kneeNear: -0.62,
      ankleNear: 0.28,
    },
  },
];

export interface RigStyle {
  kit: string;
  trim: string;
  skin: string;
  hair: string;
}

/**
 * Draw a solved skeleton as a body.
 *
 * Far side first, then torso, then near side, so the figure reads with depth.
 * Every segment carries its own muscle belly, and — the thing the old figure
 * could not do at all — hands and feet hang off real wrist and ankle joints,
 * so they follow the swing instead of being welded to the forearm and shin.
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  pose: RigPose,
  style: RigStyle,
  facing = 1,
): void {
  const s = solveRig(pose);
  const hip = (pose.hipHeight ?? 0.47) * unit;
  const out = Math.max(0.7, unit * 0.017);

  const P = (j: Joint): { x: number; y: number } => ({
    x: originX + s.at[j].x * unit * facing,
    y: originY - hip + s.at[j].y * unit,
  });
  const root = { x: originX, y: originY - hip };

  const limb = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    w0: number,
    w1: number,
    fill: string,
    belly: number,
    swell: number,
  ): void => capsule(ctx, a.x, a.y, b.x, b.y, w0 * unit, w1 * unit, fill, out, false, belly, swell);

  /** A hand or a foot, aligned to the bone it hangs from. */
  const extremity = (
    j: Joint,
    len: number,
    wide: number,
    fill: string,
    forward: number,
  ): void => {
    const p = P(j);
    const a = s.angle[j] * facing;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-a * facing + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(len * unit * forward, 0, len * unit, wide * unit, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = out;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.restore();
  };

  const shorts = shade(style.trim, 0.4);
  const legFar = shade(style.skin, -0.14);

  /** Shorts cover the top of the thigh only, and have no muscle of their own. */
  const shortsLeg = (hipJ: Joint, kneeJ: Joint, fill: string): void => {
    const a = P(hipJ);
    const b = P(kneeJ);
    capsule(
      ctx,
      a.x,
      a.y,
      lerp(a.x, b.x, 0.4),
      lerp(a.y, b.y, 0.4),
      unit * 0.105,
      unit * 0.098,
      fill,
      out,
      false,
      0.5,
      0,
    );
  };

  // ---- far side
  limb(P('hipFar'), P('kneeFar'), 0.094, 0.058, legFar, 0.3, 0.16);
  limb(P('kneeFar'), P('ankleFar'), 0.064, 0.03, legFar, 0.26, 0.22);
  extremity('ankleFar', 0.044, 0.021, '#dfe4ee', 0.5);
  shortsLeg('hipFar', 'kneeFar', shade(shorts, -0.16));

  limb(P('shoulderFar'), P('elbowFar'), 0.052, 0.04, legFar, 0.32, 0.14);
  limb(P('elbowFar'), P('wristFar'), 0.044, 0.026, legFar, 0.24, 0.18);
  extremity('wristFar', 0.03, 0.02, legFar, 0.45);

  // ---- torso, as two stacked masses joined at the waist
  limb(root, P('lumbar'), 0.13, 0.116, shorts, 0.5, 0);
  limb(P('lumbar'), P('thorax'), 0.126, 0.166, style.kit, 0.74, 0.05);

  // ---- near side
  limb(P('hipNear'), P('kneeNear'), 0.094, 0.058, style.skin, 0.3, 0.16);
  limb(P('kneeNear'), P('ankleNear'), 0.064, 0.03, style.skin, 0.26, 0.22);
  extremity('ankleNear', 0.044, 0.021, '#f2f5fb', 0.5);
  shortsLeg('hipNear', 'kneeNear', shorts);

  limb(P('shoulderNear'), P('elbowNear'), 0.052, 0.04, style.skin, 0.32, 0.14);
  limb(P('elbowNear'), P('wristNear'), 0.044, 0.026, style.skin, 0.24, 0.18);
  extremity('wristNear', 0.03, 0.02, style.skin, 0.45);

  // Neck last of the body, so it tucks under the head and over the collar.
  limb(P('thorax'), P('neck'), 0.05, 0.044, shade(style.skin, -0.1), 0.5, 0);

  // Sleeve caps over the shoulders, drawn last so they sit on top of both arms.
  for (const j of ['shoulderFar', 'shoulderNear'] as const) {
    const a = P(j);
    const b = P(j === 'shoulderFar' ? 'elbowFar' : 'elbowNear');
    capsule(
      ctx,
      a.x,
      a.y,
      lerp(a.x, b.x, 0.42),
      lerp(a.y, b.y, 0.42),
      unit * 0.076,
      unit * 0.064,
      j === 'shoulderFar' ? shade(style.kit, -0.22) : style.kit,
      0,
      true,
      0.5,
      0,
    );
  }

  // ---- head, in profile like the rest of the body
  const neck = P('neck');
  const headP = P('head');
  const hw = unit * 0.057;
  const hh = unit * 0.073;
  ctx.save();
  ctx.translate(lerp(neck.x, headP.x, 0.46), lerp(neck.y, headP.y, 0.46));
  ctx.rotate((s.angle.head - Math.PI) * facing * 0.6);
  ctx.scale(facing, 1);
  ctx.beginPath();
  ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
  ctx.fillStyle = style.skin;
  ctx.fill();
  ctx.lineWidth = out;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Nose breaking the profile, and the skull rounding away behind.
  ctx.beginPath();
  ctx.moveTo(hw * 0.72, -hh * 0.1);
  ctx.lineTo(hw * 1.14, hh * 0.08);
  ctx.lineTo(hw * 0.7, hh * 0.24);
  ctx.closePath();
  ctx.fillStyle = style.skin;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-hw * 0.1, -hh * 0.24, hw * 0.98, hh * 0.72, 0, Math.PI * 0.98, Math.PI * 2.02);
  ctx.fillStyle = style.hair;
  ctx.fill();
  if (hw > 6) {
    ctx.beginPath();
    ctx.ellipse(hw * 0.4, hh * 0.02, hw * 0.11, hh * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#20202c';
    ctx.fill();
  }
  ctx.restore();
}
