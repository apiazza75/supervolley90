/** Pose reference for the illustrator, never a shipped character asset. */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('artifacts/art-direction');
mkdirSync(out, { recursive: true });
type Point = [number, number];
type Leg = [Point, Point, Point];
const steps: { near: Leg; far: Leg; hipY: number; name: string }[] = [
  { near: [[216, 251], [248, 322], [268, 330]], far: [[158, 250], [127, 322], [151, 330]], hipY: 186, name: 'RIGHT heel contact / LEFT toe behind' },
  { near: [[209, 264], [224, 327], [248, 330]], far: [[157, 257], [166, 306], [185, 318]], hipY: 197, name: 'RIGHT supports / LEFT lifts behind' },
  { near: [[186, 254], [183, 327], [209, 330]], far: [[220, 243], [187, 289], [213, 301]], hipY: 183, name: 'LEFT bent knee passes RIGHT support' },
  { near: [[167, 248], [149, 315], [175, 330]], far: [[234, 241], [239, 312], [267, 319]], hipY: 181, name: 'LEFT swings forward / RIGHT toe-off' },
  { near: [[158, 250], [127, 322], [151, 330]], far: [[216, 251], [248, 322], [268, 330]], hipY: 186, name: 'LEFT heel contact / RIGHT toe behind' },
  { near: [[157, 257], [166, 306], [185, 318]], far: [[209, 264], [224, 327], [248, 330]], hipY: 197, name: 'LEFT supports / RIGHT lifts behind' },
  { near: [[220, 243], [187, 289], [213, 301]], far: [[186, 254], [183, 327], [209, 330]], hipY: 183, name: 'RIGHT bent knee passes LEFT support' },
  { near: [[234, 241], [239, 312], [267, 319]], far: [[167, 248], [149, 315], [175, 330]], hipY: 181, name: 'RIGHT swings forward / LEFT toe-off' },
];
const runHalf: typeof steps = [
  { near: [[228, 247], [255, 316], [280, 326]], far: [[152, 235], [116, 282], [137, 292]], hipY: 184, name: 'contact' },
  { near: [[216, 264], [215, 327], [242, 330]], far: [[151, 247], [191, 271], [211, 264]], hipY: 199, name: 'compression' },
  { near: [[164, 244], [137, 307], [161, 325]], far: [[234, 221], [204, 275], [228, 280]], hipY: 184, name: 'passing' },
  { near: [[144, 236], [108, 281], [130, 291]], far: [[245, 226], [267, 293], [292, 305]], hipY: 174, name: 'flight' },
];
const runSteps = [...runHalf, ...runHalf.map(s => ({ ...s, near: s.far, far: s.near }))];

function figure(s: typeof steps[number], i: number): string {
  const x = (i % 6) * 256, y = Math.floor(i / 6) * 256;
  const dy = s.hipY - 186;
  const leg = (j: Leg, colour: string) => `<polyline points="190,${s.hipY} ${j[0]} ${j[1]} ${j[2]}" fill="none" stroke="${colour}" stroke-width="17" stroke-linejoin="round" stroke-linecap="round"/>`;
  const swing = (s.near[1][0] - 190) * -.7;
  return `<g transform="translate(${x} ${y}) scale(.6666667)">
    <text x="12" y="18" font-size="12" fill="#18263c">${i + 1}</text>
    <path d="M40 338H345" stroke="#b8bec8" stroke-width="2"/>
    ${leg(s.far, '#168fa7')}
    <path d="M190 ${111 + dy} L${190 - swing} ${158 + dy} L${184 - swing * 1.3} ${211 + dy}" stroke="#168fa7" stroke-width="13" fill="none" stroke-linecap="round"/>
    <path d="M190 ${111 + dy} L190 ${s.hipY}" stroke="#283a56" stroke-width="34" stroke-linecap="round"/>
    ${leg(s.near, '#e25238')}
    <path d="M190 ${111 + dy} L${190 + swing} ${158 + dy} L${199 + swing * 1.3} ${211 + dy}" stroke="#e25238" stroke-width="13" fill="none" stroke-linecap="round"/>
    <path d="M183 ${93 + dy} L189 ${104 + dy}" stroke="#283a56" stroke-width="14"/>
    <ellipse cx="191" cy="69" rx="22" ry="27" fill="#283a56" transform="translate(0 ${dy})"/>
    <path d="M207 ${62 + dy} L222 ${74 + dy} L208 ${78 + dy}" fill="#283a56"/>
  </g>`;
}
function guide(keyframes: typeof steps): string {
const intermediate = Array.from({ length: 24 }, (_, i) => {
  const a = keyframes[Math.floor(i / 3)], b = keyframes[(Math.floor(i / 3) + 1) % 8], t = (i % 3) / 3;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const leg = (x: Leg, y: Leg): Leg => x.map((p, j) => [lerp(p[0], y[j][0]), lerp(p[1], y[j][1])] as Point) as Leg;
  return { near: leg(a.near, b.near), far: leg(a.far, b.far), hipY: lerp(a.hipY, b.hipY), name: a.name };
});
return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024"><rect width="1536" height="1024" fill="#f4eee5"/>${intermediate.map(figure).join('')}</svg>`;
}
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
  for (const [action, poses] of [['walk', steps], ['run', runSteps]] as const) {
    const svg = guide(poses);
    writeFileSync(resolve(out, `${action}-poses.svg`), svg);
    await page.setContent(svg);
    await page.screenshot({ path: resolve(out, `${action}-poses.png`) });
  }
  const data = readFileSync(resolve('public/sprites/idle.png')).toString('base64');
  await page.setContent(`<canvas width="512" height="512"></canvas><img id="source" src="data:image/png;base64,${data}" hidden>`);
  await page.evaluate(async () => {
    const img = document.querySelector('img')!;
    await img.decode();
    const ctx = document.querySelector('canvas')!.getContext('2d')!;
    ctx.drawImage(img, 0, 0, 512, 512, 0, 0, 512, 512);
  });
  await page.locator('canvas').screenshot({ path: resolve(out, 'player-reference.png'), omitBackground: true });
} finally {
  await browser.close();
}
console.log(out);
