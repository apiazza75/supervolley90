/**
 * Headless match runner.
 *
 * Plays a full AI-vs-AI match with no renderer and prints a summary. This is
 * the fastest way to sanity-check balance changes: if rallies collapse to one
 * touch, or every point ends in a serve fault, it shows up here immediately.
 *
 *   npm run sim -- --seed 7 --matches 5
 */
import { FIXED_DT } from '../src/core/rules';
import { World } from '../src/core/world';
import type { GameEvent, PointReason } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

interface Args {
  seed: number;
  matches: number;
  difficulty: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, matches: 1, difficulty: 1, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--matches') out.matches = Number(argv[++i]);
    else if (a === '--difficulty') out.difficulty = Number(argv[++i]);
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}

interface Stats {
  /** Per-side tallies, to catch asymmetries between home and away. */
  bySide: Record<string, Record<string, number>>;
  points: number;
  rallies: number[];
  touches: number[];
  reasons: Record<string, number>;
  contacts: Record<string, number>;
  winner: string;
  score: string;
  simSeconds: number;
}

function runMatch(seed: number, difficulty: number, verbose: boolean): Stats {
  const world = new World({
    home: TEAMS[0],
    away: TEAMS[1],
    seed,
    difficulty,
    humanControlsHome: false,
  });

  const stats: Stats = {
    bySide: { home: {}, away: {} },
    points: 0,
    rallies: [],
    touches: [],
    reasons: {},
    contacts: {},
    winner: '',
    score: '',
    simSeconds: 0,
  };

  let touchesThisRally = 0;
  const maxSteps = 60 * 60 * 120; // one simulated hour, a hard safety stop

  for (let i = 0; i < maxSteps && world.phase !== 'matchOver'; i++) {
    world.step(null);
    stats.simSeconds += FIXED_DT;
    for (const ev of world.drainEvents()) handle(ev);
  }

  function handle(ev: GameEvent): void {
    switch (ev.type) {
      case 'contact': {
        touchesThisRally++;
        stats.contacts[ev.kind] = (stats.contacts[ev.kind] ?? 0) + 1;
        const side = stats.bySide[ev.side];
        side[ev.kind] = (side[ev.kind] ?? 0) + 1;
        break;
      }
      case 'point': {
        stats.points++;
        stats.rallies.push(ev.rallyLength);
        stats.touches.push(touchesThisRally);
        const r: PointReason = ev.reason;
        stats.reasons[r] = (stats.reasons[r] ?? 0) + 1;
        const won = stats.bySide[ev.side];
        won.points = (won.points ?? 0) + 1;
        won[`won:${r}`] = (won[`won:${r}`] ?? 0) + 1;
        touchesThisRally = 0;
        if (verbose) {
          console.log(
            `  point ${String(stats.points).padStart(3)} -> ${ev.side.padEnd(4)} ` +
              `${r.padEnd(12)} rally ${ev.rallyLength.toFixed(1)}s  ${world.scoreLine()}`,
          );
        }
        break;
      }
      case 'setWon':
        if (verbose) console.log(`  --- set ${ev.setNumber} to ${ev.side} ---`);
        break;
      case 'matchWon':
        stats.winner = ev.side;
        break;
      default:
        break;
    }
  }

  stats.score = `${world.home.setsWon}-${world.away.setsWon} (${world.home.setScores.join('/')} vs ${world.away.setScores.join('/')})`;
  return stats;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(`supervolley90 headless sim — ${args.matches} match(es), difficulty ${args.difficulty}\n`);

  const all: Stats[] = [];
  for (let m = 0; m < args.matches; m++) {
    const seed = args.seed + m * 7919;
    console.log(`match ${m + 1} (seed ${seed})`);
    const s = runMatch(seed, args.difficulty, args.verbose);
    all.push(s);
    console.log(
      `  winner=${s.winner || 'none (timeout)'} sets=${s.score} points=${s.points} ` +
        `avg rally=${mean(s.rallies).toFixed(2)}s avg touches=${mean(s.touches).toFixed(2)} ` +
        `sim=${s.simSeconds.toFixed(0)}s`,
    );
    console.log(`  reasons: ${JSON.stringify(s.reasons)}`);
    console.log(`  contacts: ${JSON.stringify(s.contacts)}`);
    console.log(`  home: ${JSON.stringify(s.bySide.home)}`);
    console.log(`  away: ${JSON.stringify(s.bySide.away)}\n`);
  }

  const totalPoints = all.reduce((a, s) => a + s.points, 0);
  console.log(
    `aggregate: ${totalPoints} points, avg rally ${mean(all.flatMap((s) => s.rallies)).toFixed(2)}s, ` +
      `avg touches/rally ${mean(all.flatMap((s) => s.touches)).toFixed(2)}`,
  );
  const timeouts = all.filter((s) => !s.winner).length;
  if (timeouts) console.log(`WARNING: ${timeouts} match(es) never finished`);
}

main();
