/** Eight large illustrator references per sheet. NEVER loaded by the game. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type P = [number, number];
type Leg = { knee: P; ankle: P; toe: P; heel: P };
type Pose = { hipY: number; near: Leg; far: Leg; swing: number };
const leg = (knee: P, ankle: P, toe: P, heel: P): Leg => ({ knee, ankle, toe, heel });
const shiftLeg = (l: Leg, dx: number, dy: number): Leg => Object.fromEntries(
  Object.entries(l).map(([k, p]) => [k, [p[0] + dx, p[1] + dy]]),
) as Leg;
const gait = process.argv.includes('--approach') ? 'approach' : process.argv.includes('--run') ? 'run' : 'walk';
const walkHalf: Pose[] = [
  { hipY: 259, near: leg([218, 347], [239, 432], [263, 453], [224, 453]), far: leg([172, 346], [153, 432], [180, 453], [150, 446]), swing: -20 },
  { hipY: 267, near: leg([224, 354], [209, 442], [237, 457], [195, 457]), far: leg([173, 353], [172, 423], [195, 449], [163, 431]), swing: -7 },
  { hipY: 255, near: leg([202, 346], [195, 437], [221, 457], [181, 457]), far: leg([231, 339], [204, 412], [234, 439], [204, 423]), swing: 12 },
  { hipY: 254, near: leg([180, 341], [166, 428], [198, 456], [164, 442]), far: leg([228, 341], [250, 425], [281, 448], [241, 448]), swing: 21 },
];
function runPose(nearThigh: number, nearShin: number, farThigh: number, farShin: number, swing: number, flight = 0): Pose {
  const limb = (x: number, thigh: number, shin: number): Leg => {
    const rad = (a: number) => a * Math.PI / 180;
    const knee: P = [x + Math.sin(rad(thigh)) * 106, Math.cos(rad(thigh)) * 106];
    const ankle: P = [knee[0] + Math.sin(rad(shin)) * 100, knee[1] + Math.cos(rad(shin)) * 100];
    return leg(knee, ankle, [ankle[0] + 27, ankle[1] + 14], [ankle[0] - 11, ankle[1] + 9]);
  };
  const near = limb(204, nearThigh, nearShin), far = limb(194, farThigh, farShin);
  const hipY = 458 - flight - Math.max(near.toe[1], far.toe[1]);
  const move = (l: Leg): Leg => Object.fromEntries(Object.entries(l).map(([k, p]) => [k, [p[0], p[1] + hipY]])) as Leg;
  return { hipY, near: move(near), far: move(far), swing };
}
const runHalf: Pose[] = [
  runPose(25, 8, -35, -100, -25),
  runPose(30, -35, -5, -125, -8),
  runPose(-28, -8, 50, -95, 25),
  runPose(-45, -100, 45, 20, 30, 25),
];
const half = gait === 'run' ? runHalf : walkHalf;
const keys = gait === 'approach' ? [
  runPose(-35, -100, 25, 8, 25),
  runPose(-5, -125, 30, -35, 8),
  runPose(45, 20, -45, -100, -24),
  runPose(30, -15, -35, -105, -32),
  runPose(35, -40, 15, -130, -32),
  runPose(35, -35, 28, -28, -24),
  runPose(35, -35, 28, -28, -10),
  runPose(20, -20, 20, -20, 24),
] : [...half, ...half.map(p => ({ ...p,
  near: gait === 'run' ? shiftLeg(p.far, 10, 0) : p.far,
  far: gait === 'run' ? shiftLeg(p.near, -10, 0) : p.near,
  swing: -p.swing,
}))];
const labels = gait === 'approach'
  ? ['LEFT first step / RIGHT trails', 'LEFT supports / RIGHT recovers', 'RIGHT penultimate reaches', 'RIGHT lands / arms back', 'LEFT closes / RIGHT supports', 'TWO feet / knees load', 'PLANT / arms swing down', 'PLANT / arms forward up']
  : gait === 'run'
  ? ['R contact', 'R compresses / L recovers', 'R pushes / L knee forward', 'Flight / L reaches', 'L contact', 'L compresses / R recovers', 'L pushes / R knee forward', 'Flight / R reaches']
  : ['R heel contact', 'R supports / L lifts', 'L passes R', 'L forward / R toe-off', 'L heel contact', 'L supports / R lifts', 'R passes L', 'R forward / L toe-off'];
const out = resolve('artifacts/gait-key-direction'); mkdirSync(out, { recursive: true });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function inBetween(a: Pose, b: Pose, t: number): Pose {
  const point = (p: P, q: P): P => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
  const hipY = lerp(a.hipY, b.hipY, t);
  const limb = (p: Leg, q: Leg, near: boolean): Leg => {
    if (gait === 'walk') return { knee: point(p.knee, q.knee), ankle: point(p.ankle, q.ankle), toe: point(p.toe, q.toe), heel: point(p.heel, q.heel) };
    // Rotate reference bones instead of shrinking them through Cartesian tweening.
    const bone = (v: P, w: P): P => {
      const start = Math.atan2(v[0], v[1]);
      const end = Math.atan2(w[0], w[1]);
      const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
      const length = lerp(Math.hypot(...v), Math.hypot(...w), t);
      return [Math.sin(start + delta * t) * length, Math.cos(start + delta * t) * length];
    };
    const hipX = near ? 204 : 194;
    const thigh = bone([p.knee[0] - hipX, p.knee[1] - a.hipY], [q.knee[0] - hipX, q.knee[1] - b.hipY]);
    const shin = bone([p.ankle[0] - p.knee[0], p.ankle[1] - p.knee[1]], [q.ankle[0] - q.knee[0], q.ankle[1] - q.knee[1]]);
    const knee: P = [hipX + thigh[0], hipY + thigh[1]];
    const ankle: P = [knee[0] + shin[0], knee[1] + shin[1]];
    return leg(knee, ankle, [ankle[0] + 27, ankle[1] + 14], [ankle[0] - 11, ankle[1] + 9]);
  };
  const near = limb(a.near, b.near, true), far = limb(a.far, b.far, false);
  if (gait !== 'walk') {
    const lift = lerp(458 - Math.max(a.near.toe[1], a.far.toe[1]), 458 - Math.max(b.near.toe[1], b.far.toe[1]), t);
    const adjustment = 458 - lift - Math.max(near.toe[1], far.toe[1]);
    return { hipY: hipY + adjustment, near: shiftLeg(near, 0, adjustment), far: shiftLeg(far, 0, adjustment), swing: lerp(a.swing, b.swing, t) };
  }
  return { hipY, near, far, swing: lerp(a.swing, b.swing, t) };
}
function figure(p: Pose, i: number, offset: number): string {
  const dy = p.hipY - 259;
  const running = gait !== 'walk';
  const limb = (l: Leg, colour: string, near: boolean) => `<path d="M${near ? 204 : 194} ${p.hipY} L${l.knee} L${l.ankle}" fill="none" stroke="${colour}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><path d="M${l.heel} L${l.ankle} L${l.toe} Z" fill="${colour}" stroke="${colour}" stroke-width="10" stroke-linejoin="round"/>`;
  const arm = (swing: number, colour: string) => {
    const shoulder: P = [running ? 231 : 207, 146 + dy];
    const angle = swing * (running ? 2 : 1) * Math.PI / 180;
    const elbow: P = [shoulder[0] + Math.sin(angle) * 59, shoulder[1] + Math.cos(angle) * 59];
    const bend = gait === 'approach' && i >= 2 ? .12 : running ? 100 * Math.PI / 180 : .10;
    const hand: P = [elbow[0] + Math.sin(angle + bend) * 57, elbow[1] + Math.cos(angle + bend) * 57];
    return `<path d="M${shoulder} L${elbow} L${hand}" fill="none" stroke="${colour}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  return `<g transform="translate(${i % 4 * 384} ${Math.floor(i / 4) * 512})">
    <text x="12" y="23" font-size="14" fill="#17263d">${i * 3 + offset + 1} · ${labels[i]}</text>
    <path d="M50 460H334" stroke="#aab5c5" stroke-width="2"/>
    ${arm(gait === 'approach' && i >= 2 ? p.swing : -p.swing, '#2586a2')}${limb(p.far, '#2586a2', false)}
    <path d="M${running ? 206 : 182} ${135 + dy} Q${running ? 231 : 207} ${125 + dy} ${running ? 254 : 230} ${145 + dy} L222 ${p.hipY + 5} L180 ${p.hipY + 5}Z" fill="#455576"/>
    <g transform="translate(${running ? 28 : 0} 0)">
      <path d="M209 ${124 + dy}L214 ${142 + dy}" stroke="#455576" stroke-width="19"/>
      <ellipse cx="214" cy="96" rx="25" ry="31" transform="translate(0 ${dy})" fill="#455576"/>
      <path d="M233 ${87 + dy} L245 ${102 + dy} L231 ${108 + dy}" fill="#455576"/>
    </g>
    ${limb(p.near, '#de6040', true)}${arm(p.swing, '#de6040')}
    <text x="20" y="490" font-size="12" fill="#17263d">RED = near RIGHT · BLUE = far LEFT</text>
  </g>`;
}
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  for (const offset of [0, 1, 2]) {
    const poses = keys.map((p, i) => inBetween(p, keys[gait === 'approach' ? Math.min(7, i + 1) : (i + 1) % 8], offset / 3));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#f5ede0"/>${poses.map((p, i) => figure(p, i, offset)).join('')}</svg>`;
    writeFileSync(resolve(out, `${gait}-offset-${offset}.svg`), svg);
    writeFileSync(resolve(out, `${gait}-offset-${offset}.json`), JSON.stringify(poses, null, 2));
    await page.setContent(`<style>body{margin:0}</style>${svg}`);
    await page.screenshot({ path: resolve(out, `${gait}-offset-${offset}.png`) });
  }
} finally { await browser.close(); }
console.log(out);
