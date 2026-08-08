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
/**
 * The spike, read frame by frame off a 24-frame reference sheet.
 *
 * Every earlier attempt at this was me typing angles and then judging the
 * result myself, and my judgement of "does this look like a spiker" was not
 * good enough — five rounds of it produced something worse than what it
 * replaced. These keys are not invented: each one is a numbered frame of an
 * actual drawn sequence, read off and converted into joint angles.
 *
 * What the reference makes obvious, and what nothing I wrote from imagination
 * had, is that a spike is mostly APPROACH. Ten of its twenty-four frames are
 * the run-up; the arms swing UP TOGETHER at the plant rather than one at a
 * time; the body stays tall through it instead of hunching; and the landing is
 * a deep two-footed absorb, not a touchdown.
 */
export const SPIKE: Keyframe[] = [
  // 1-2 — ready stance, waiting for the set.
  {
    t: 0,
    pose: {
      hipHeight: 0.46,
      lumbar: -0.12,
      thorax: -0.1,
      head: -0.08,
      shoulderFar: -0.15,
      elbowFar: 0.35,
      shoulderNear: -0.1,
      elbowNear: 0.3,
      hipFar: 0.12,
      kneeFar: -0.35,
      ankleFar: 0.15,
      hipNear: -0.08,
      kneeNear: -0.3,
      ankleNear: 0.15,
    },
  },
  // 3 — first step, weight tipping forward over the front foot.
  {
    t: 0.13,
    pose: {
      hipHeight: 0.45,
      lumbar: -0.28,
      thorax: -0.22,
      head: -0.14,
      shoulderFar: 0.5,
      elbowFar: 0.8,
      shoulderNear: -0.6,
      elbowNear: 0.7,
      hipFar: 0.45,
      kneeFar: -0.5,
      ankleFar: 0.2,
      hipNear: -0.3,
      kneeNear: -0.25,
      ankleNear: 0.3,
    },
  },
  // 4-5 — running stride, arms driving contralaterally.
  {
    t: 0.26,
    pose: {
      hipHeight: 0.47,
      lumbar: -0.3,
      thorax: -0.2,
      head: -0.12,
      shoulderFar: -0.7,
      elbowFar: 1.1,
      shoulderNear: 0.7,
      elbowNear: 1.0,
      hipFar: 0.7,
      kneeFar: -0.3,
      ankleFar: 0.1,
      hipNear: -0.5,
      kneeNear: -0.9,
      ankleNear: 0.4,
    },
  },
  // 6-7 — the opposite stride.
  {
    t: 0.4,
    pose: {
      hipHeight: 0.47,
      lumbar: -0.3,
      thorax: -0.2,
      head: -0.12,
      shoulderFar: 0.7,
      elbowFar: 1.0,
      shoulderNear: -0.7,
      elbowNear: 1.1,
      hipFar: -0.5,
      kneeFar: -0.9,
      ankleFar: 0.4,
      hipNear: 0.7,
      kneeNear: -0.3,
      ankleNear: 0.1,
    },
  },
  // 8-9 — the long accelerating stride into the plant, body dropping.
  {
    t: 0.54,
    pose: {
      hipHeight: 0.44,
      lumbar: -0.34,
      thorax: -0.24,
      head: -0.16,
      shoulderFar: -0.85,
      elbowFar: 0.95,
      shoulderNear: 0.8,
      elbowNear: 0.9,
      hipFar: 0.85,
      kneeFar: -0.35,
      ankleFar: 0.1,
      hipNear: -0.6,
      kneeNear: -1.0,
      ankleNear: 0.45,
    },
  },
  // 10 — last step down, BOTH arms swung back and low, ready to throw.
  {
    t: 0.66,
    pose: {
      hipHeight: 0.42,
      lumbar: -0.3,
      thorax: -0.2,
      head: -0.12,
      shoulderFar: -1.0,
      elbowFar: 0.3,
      shoulderNear: -1.1,
      elbowNear: 0.25,
      hipFar: 0.6,
      kneeFar: -0.6,
      ankleFar: 0.3,
      hipNear: -0.2,
      kneeNear: -0.6,
      ankleNear: 0.35,
    },
  },
  // 11-12 — the plant. Deepest crouch, both arms swinging up together, which
  // is the double-arm swing that produces the height and the single thing
  // every version written from imagination got wrong.
  {
    t: 0.76,
    pose: {
      hipHeight: 0.34,
      lumbar: -0.2,
      thorax: -0.1,
      head: 0.02,
      shoulderFar: 1.6,
      elbowFar: 0.35,
      shoulderNear: 1.8,
      elbowNear: 0.3,
      hipFar: 0.35,
      kneeFar: -1.15,
      ankleFar: 0.55,
      hipNear: 0.25,
      kneeNear: -1.2,
      ankleNear: 0.55,
    },
  },
  // 13 — extension. Legs drive straight, both arms high, feet leaving.
  {
    t: 0.86,
    pose: {
      hipHeight: 0.56,
      lumbar: 0,
      thorax: 0.05,
      head: 0.08,
      shoulderFar: 2.6,
      elbowFar: 0.25,
      shoulderNear: 2.8,
      elbowNear: 0.2,
      hipFar: -0.05,
      kneeFar: -0.1,
      ankleFar: -0.35,
      hipNear: 0,
      kneeNear: -0.08,
      ankleNear: -0.4,
    },
  },
  // 15-16 — rising, both arms up, legs tucking back under.
  {
    t: 0.98,
    pose: {
      hipHeight: 0.76,
      lumbar: 0.08,
      thorax: 0.1,
      head: 0.1,
      shoulderFar: 2.9,
      elbowFar: 0.2,
      shoulderNear: 3.0,
      elbowNear: 0.15,
      hipFar: -0.35,
      kneeFar: -0.7,
      ankleFar: -0.2,
      hipNear: -0.2,
      kneeNear: -0.85,
      ankleNear: -0.25,
    },
  },
  // 17-18 — the arm separates: hitting elbow drawn high and back, off arm
  // held out in front tracking the ball.
  {
    t: 1.08,
    pose: {
      hipHeight: 0.83,
      lumbar: 0.16,
      thorax: 0.1,
      head: 0.12,
      shoulderFar: 3.3,
      elbowFar: 1.0,
      wristFar: 0.2,
      shoulderNear: 1.9,
      elbowNear: 0.2,
      hipFar: -0.5,
      kneeFar: -0.75,
      ankleFar: -0.15,
      hipNear: -0.3,
      kneeNear: -0.9,
      ankleNear: -0.2,
    },
  },
  // 19 — the bow at its deepest: back arched, elbow above the shoulder.
  {
    t: 1.18,
    pose: {
      hipHeight: 0.84,
      lumbar: 0.28,
      thorax: 0.14,
      head: 0.16,
      shoulderFar: 3.5,
      elbowFar: 1.5,
      wristFar: 0.3,
      shoulderNear: 2.1,
      elbowNear: 0.25,
      hipFar: -0.6,
      kneeFar: -0.85,
      ankleFar: -0.15,
      hipNear: -0.4,
      kneeNear: -0.95,
      ankleNear: -0.2,
    },
  },
  // 20 — contact. Arm snaps straight overhead, wrist rolls over the ball, the
  // torso jackknifes and the off arm is pulled down hard.
  {
    t: 1.26,
    pose: {
      hipHeight: 0.83,
      lumbar: -0.1,
      thorax: -0.12,
      head: -0.02,
      shoulderFar: 2.75,
      elbowFar: 0.05,
      wristFar: -0.4,
      shoulderNear: 0.9,
      elbowNear: 0.9,
      hipFar: 0.3,
      kneeFar: -0.45,
      ankleFar: 0.05,
      hipNear: 0.2,
      kneeNear: -0.55,
      ankleNear: 0.05,
    },
  },
  // 21 — follow-through, the arm carried down and across the body.
  {
    t: 1.36,
    pose: {
      hipHeight: 0.72,
      lumbar: -0.32,
      thorax: -0.3,
      head: -0.16,
      shoulderFar: 1.2,
      elbowFar: 0.5,
      wristFar: -0.2,
      shoulderNear: 0.2,
      elbowNear: 0.8,
      hipFar: 0.6,
      kneeFar: -0.5,
      ankleFar: 0.15,
      hipNear: 0.45,
      kneeNear: -0.6,
      ankleNear: 0.15,
    },
  },
  // 22 — reaching for the floor, torso forward over the knees.
  {
    t: 1.48,
    pose: {
      hipHeight: 0.5,
      lumbar: -0.36,
      thorax: -0.3,
      head: -0.2,
      shoulderFar: 0.2,
      elbowFar: 0.7,
      shoulderNear: -0.1,
      elbowNear: 0.75,
      hipFar: 0.35,
      kneeFar: -0.8,
      ankleFar: 0.3,
      hipNear: 0.25,
      kneeNear: -0.85,
      ankleNear: 0.3,
    },
  },
  // 23 — the absorb: deep, both feet, weight down through the heels.
  {
    t: 1.58,
    pose: {
      hipHeight: 0.33,
      lumbar: -0.34,
      thorax: -0.26,
      head: -0.16,
      shoulderFar: -0.2,
      elbowFar: 0.9,
      shoulderNear: -0.35,
      elbowNear: 0.95,
      hipFar: 0.3,
      kneeFar: -1.2,
      ankleFar: 0.55,
      hipNear: 0.2,
      kneeNear: -1.25,
      ankleNear: 0.55,
    },
  },
  // 24 — back up into the ready stance.
  {
    t: 1.74,
    pose: {
      hipHeight: 0.45,
      lumbar: -0.16,
      thorax: -0.12,
      head: -0.08,
      shoulderFar: -0.18,
      elbowFar: 0.4,
      shoulderNear: -0.12,
      elbowNear: 0.35,
      hipFar: 0.14,
      kneeFar: -0.4,
      ankleFar: 0.18,
      hipNear: -0.06,
      kneeNear: -0.34,
      ankleNear: 0.18,
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
  // Heavier than the old figure's. Drawn animation is defined by its line:
  // a hairline outline reads as a vector illustration, a confident one reads
  // as a cel.
  const out = Math.max(1.1, unit * 0.026);

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
  ): void =>
    capsule(ctx, a.x, a.y, b.x, b.y, w0 * unit, w1 * unit, fill, out, false, belly, swell, true);

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

  // Knee pads. Black, chunky, and sitting proud of the leg — in the reference
  // they are one of the strongest reads in the whole silhouette.
  for (const j of ['kneeFar', 'kneeNear'] as const) {
    const k = P(j);
    ctx.beginPath();
    ctx.ellipse(k.x, k.y, unit * 0.05, unit * 0.043, 0, 0, Math.PI * 2);
    ctx.fillStyle = j === 'kneeFar' ? '#141822' : '#1d2230';
    ctx.fill();
    ctx.lineWidth = out;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

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
  // Spiked hair, drawn as a run of points around the skull rather than a
  // smooth cap. It is the single clearest style marker in the reference and
  // costs one loop.
  ctx.beginPath();
  ctx.moveTo(-hw * 1.02, hh * 0.18);
  const spikes = 7;
  for (let i = 0; i <= spikes; i++) {
    const u = i / spikes;
    const a = Math.PI * (1.02 + u * 0.96);
    const r = 1 + (i % 2 === 0 ? 0.34 : 0.08);
    ctx.lineTo(Math.cos(a) * hw * r - hw * 0.08, Math.sin(a) * hh * r - hh * 0.2);
  }
  ctx.lineTo(hw * 0.92, -hh * 0.05);
  ctx.quadraticCurveTo(hw * 0.2, hh * 0.1, -hw * 1.02, hh * 0.18);
  ctx.closePath();
  ctx.fillStyle = style.hair;
  ctx.fill();
  ctx.lineWidth = out * 0.8;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  if (hw > 6) {
    ctx.beginPath();
    ctx.ellipse(hw * 0.4, hh * 0.02, hw * 0.11, hh * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#20202c';
    ctx.fill();
  }
  ctx.restore();
}
