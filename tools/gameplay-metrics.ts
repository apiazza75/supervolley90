/**
 * Measure the gameplay acceptance metrics from real simulated matches.
 *
 *   npx tsx tools/gameplay-metrics.ts [--steps 12000] [--seeds 1337,4242]
 *
 * Writes artifacts/visual-qa-v3/gameplay-metrics.json and exits non-zero if any
 * threshold in the brief is missed, so CI fails on the game rather than on the
 * build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkGameplayGates, measureGameplay } from '../src/qa/gameplay-metrics';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const steps = Number(arg('steps', '12000'));
const seeds = arg('seeds', '1337,4242,90210,7,11,2026').split(',').map(Number);

console.log(`measuring ${seeds.length} matches x ${steps} steps...`);
const metrics = measureGameplay(seeds, steps);
const violations = checkGameplayGates(metrics);

const outDir = resolve('artifacts/visual-qa-v3');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, 'gameplay-metrics.json'),
  `${JSON.stringify({ ...metrics, violations }, null, 2)}\n`,
);

console.log(`points played:            ${metrics.points}`);
console.log(`contacts:                 ${JSON.stringify(metrics.contactsByKind)}`);
console.log(`back-facing contacts:     ${metrics.backFacingContacts}`);
console.log(`max concurrent approach:  ${metrics.maxConcurrentApproachPlayers}`);
console.log(`longest spell above two:  ${metrics.longestOverTwoApproach.toFixed(2)} s`);
console.log(`longest approach run:     ${metrics.longestApproachRun.toFixed(2)} s`);
console.log(`serve-ready approaches:   ${metrics.serveReadyApproachPlayers}`);
console.log(
  `serve formation settled:  ${metrics.serveFormationSettled}/${metrics.serveFormationPhases}`,
);
console.log(
  `spike:      n=${metrics.spike.count} approach=${metrics.spike.approachDistance.toFixed(2)} m ` +
    `apex=${metrics.spike.apexHeight.toFixed(2)} m allAirborne=${metrics.spike.airborneContact} ` +
    `(best ${metrics.spike.bestApproachDistance.toFixed(2)} m / ${metrics.spike.bestApexHeight.toFixed(2)} m)`,
);
console.log(
  `jump serve: n=${metrics.jumpServe.count} approach=${metrics.jumpServe.approachDistance.toFixed(2)} m ` +
    `apex=${metrics.jumpServe.apexHeight.toFixed(2)} m allAirborne=${metrics.jumpServe.airborneContact} ` +
    `(best ${metrics.jumpServe.bestApproachDistance.toFixed(2)} m / ${metrics.jumpServe.bestApexHeight.toFixed(2)} m)`,
);
console.log(
  `block:      attempts=${metrics.block.attempts} contacts=${metrics.block.contacts} ` +
    `apex=${metrics.block.apexHeight.toFixed(2)} m grounded=${metrics.block.groundedContacts}`,
);
console.log(`spike phases:      ${metrics.spike.stateSequence.join(' -> ') || '(none)'}`);
console.log(`jump serve phases: ${metrics.jumpServe.stateSequence.join(' -> ') || '(none)'}`);

if (violations.length) {
  console.error(`\n${violations.length} acceptance threshold(s) missed:`);
  for (const x of violations) {
    console.error(`  ${x.metric}: expected ${x.expected}, got ${x.actual}`);
  }
  process.exit(1);
}
console.log('\nall gameplay acceptance thresholds met');
