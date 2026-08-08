/**
 * Focused probe: watch what the attacking team does on the third touch.
 * Prints the designated hitter's state every step while their side is building
 * an attack, which is the only way to see why a jump does or does not happen.
 */
import { predictLanding } from '../src/core/ball';
import { NET_HEIGHT, FIXED_DT } from '../src/core/rules';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

const world = new World({
  home: TEAMS[0],
  away: TEAMS[1],
  seed: Number(process.argv[2] ?? 3),
  difficulty: 1,
  humanControlsHome: false,
});

const steps = Math.round(30 / FIXED_DT);
let printed = 0;

for (let i = 0; i < steps && printed < 120; i++) {
  world.step(null);
  for (const ev of world.drainEvents()) {
    if (ev.type === 'contact') {
      console.log(
        `t=${(i * FIXED_DT).toFixed(2)} CONTACT ${ev.kind} ${ev.side}#${ev.playerId} z=${ev.at.z.toFixed(2)} speed=${ev.speed.toFixed(1)}`,
      );
    }
    if (ev.type === 'point') console.log(`t=${(i * FIXED_DT).toFixed(2)} POINT ${ev.side} ${ev.reason}`);
  }

  if (world.phase !== 'rally' || world.touches < 2) continue;
  const team = world.team(world.possession);
  const pred = predictLanding(world.ball, NET_HEIGHT + 0.85);
  if (i % 12) continue;

  const rows = team.players
    .filter((p) => Math.abs(p.pos.y) < 5)
    .map(
      (p) =>
        `${p.name}(h=${p.height.toFixed(2)} y=${p.pos.y.toFixed(1)} x=${p.pos.x.toFixed(1)} ${p.anim})`,
    )
    .join(' ');
  console.log(
    `  t=${(i * FIXED_DT).toFixed(2)} poss=${world.possession} touches=${world.touches} ` +
      `ball z=${world.ball.pos.z.toFixed(2)} pred=${pred.valid ? `t${pred.time.toFixed(2)}@(${pred.point.x.toFixed(1)},${pred.point.y.toFixed(1)})` : 'INVALID'}\n     ${rows}`,
  );
  printed++;
}
