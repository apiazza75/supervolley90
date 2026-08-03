/**
 * Step-by-step trace of a single rally. Prints the ball state and phase every
 * N steps so a stalled or stuck simulation is easy to spot.
 *
 *   npx tsx tools/trace.ts --seed 3 --seconds 20
 */
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT } from '../src/core/rules';

const argv = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : def;
};

const world = new World({
  home: TEAMS[0],
  away: TEAMS[1],
  seed: arg('--seed', 3),
  difficulty: 1,
  humanControlsHome: false,
});

const seconds = arg('--seconds', 20);
const every = Math.max(1, Math.round(arg('--every', 12)));
const steps = Math.round(seconds / FIXED_DT);

for (let i = 0; i < steps; i++) {
  world.step(null);
  for (const ev of world.drainEvents()) {
    if (ev.type === 'contact') {
      console.log(
        `t=${(i * FIXED_DT).toFixed(2)} CONTACT ${ev.kind} by ${ev.side}#${ev.playerId} ` +
          `speed=${ev.speed.toFixed(1)} at (${ev.at.x.toFixed(1)}, ${ev.at.y.toFixed(1)}, ${ev.at.z.toFixed(1)}) ` +
          `touches=${world.touches} poss=${world.possession}`,
      );
    } else if (ev.type === 'point') {
      console.log(`t=${(i * FIXED_DT).toFixed(2)} POINT ${ev.side} (${ev.reason}) — ${world.scoreLine()}`);
    } else if (ev.type === 'bounce') {
      console.log(
        `t=${(i * FIXED_DT).toFixed(2)} BOUNCE at (${ev.at.x.toFixed(1)}, ${ev.at.y.toFixed(1)}, ${ev.at.z.toFixed(2)})`,
      );
    }
  }
  if (i % every === 0) {
    const b = world.ball;
    console.log(
      `  t=${(i * FIXED_DT).toFixed(2)} phase=${world.phase} ` +
        `ball=(${b.pos.x.toFixed(2)}, ${b.pos.y.toFixed(2)}, ${b.pos.z.toFixed(2)}) ` +
        `v=(${b.vel.x.toFixed(1)}, ${b.vel.y.toFixed(1)}, ${b.vel.z.toFixed(1)}) ` +
        `frozen=${b.frozen} grounded=${b.grounded} touches=${world.touches} poss=${world.possession}`,
    );
  }
}
