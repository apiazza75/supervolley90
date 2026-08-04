/**
 * Spacing laboratory.
 *
 * "The players run into each other" is a claim about geometry, so it gets
 * measured as geometry: over a whole match, how often do two team-mates end up
 * closer than a body's width, and how often do they overlap on SCREEN — which,
 * in a flat side elevation, is a different and much harsher question, because
 * the court's whole 9 m of width is compressed into a shallow vertical band.
 *
 * A formation can be tactically perfect and still draw as a heap.
 *
 *   npx tsx tools/spacing.ts [seed]
 */
import { Player } from '../src/core/player';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

const DT = 1 / 120;
const SEED = Number(process.argv[2] ?? 21);

/** Must match src/render/camera.ts. */
const PIXELS_PER_METRE = 55;
const DEPTH_RISE = 30;
/** Roughly how wide a drawn figure is on screen, in pixels. */
const BODY_PX = 46;

const screen = (p: Player): { x: number; y: number } => ({
  x: p.pos.y * PIXELS_PER_METRE,
  y: -p.pos.x * DEPTH_RISE,
});

function main(): void {
  const w = new World({ seed: SEED, home: TEAMS[0], away: TEAMS[1], difficulty: 1 });

  let samples = 0;
  let worldClose = 0;
  let screenOverlap = 0;
  let worstWorld = Infinity;
  let worstScreen = Infinity;
  // How spread out a formation is on screen: the vertical extent a team covers.
  let spreadTotal = 0;

  for (let i = 0; i < 120 * 60 * 8; i++) {
    w.step(null, DT);
    // Sample at 10 Hz; every frame would just be the same instant six times.
    if (i % 12 !== 0) continue;
    if (w.phase !== 'rally' && w.phase !== 'serve') continue;
    samples++;

    for (const side of ['home', 'away'] as const) {
      const team = w.team(side).players;
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of team) {
        const s = screen(p);
        lo = Math.min(lo, s.y);
        hi = Math.max(hi, s.y);
      }
      spreadTotal += hi - lo;

      for (let a = 0; a < team.length; a++) {
        for (let b = a + 1; b < team.length; b++) {
          const pa = team[a];
          const pb = team[b];
          const dWorld = Math.hypot(pa.pos.x - pb.pos.x, pa.pos.y - pb.pos.y);
          const sa = screen(pa);
          const sb = screen(pb);
          const dScreen = Math.hypot(sa.x - sb.x, sa.y - sb.y);
          worstWorld = Math.min(worstWorld, dWorld);
          worstScreen = Math.min(worstScreen, dScreen);
          if (dWorld < 1.1) worldClose++;
          if (dScreen < BODY_PX) screenOverlap++;
        }
      }
    }
  }

  const pairs = samples * 2 * 15;
  console.log(`seed ${SEED} — ${samples} sampled instants, ${pairs} team-mate pairs`);
  console.log(
    `too close on court (<1.1 m):  ${worldClose} (${((100 * worldClose) / pairs).toFixed(1)}%)`,
  );
  console.log(
    `overlapping on screen (<${BODY_PX}px): ${screenOverlap} (${(
      (100 * screenOverlap) / pairs
    ).toFixed(1)}%)`,
  );
  console.log(`closest pair ever: ${worstWorld.toFixed(2)} m, ${worstScreen.toFixed(0)} px`);
  console.log(
    `average vertical spread of a formation: ${(spreadTotal / (samples * 2)).toFixed(0)} px`,
  );
}

main();
