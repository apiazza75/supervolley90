/**
 * Serve laboratory.
 *
 * Plays the serve over and over with the second tap at every plausible moment
 * and reports what actually happens. "The serve does not work" is not
 * something to fix by intuition: this says which timings produce a jump serve,
 * which produce a standing serve, and which produce nothing at all — and why.
 *
 *   npx tsx tools/serve-lab.ts [attempts]
 */
import { PLAYER_REACH } from '../src/core/rules';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

const DT = 1 / 120;
const ATTEMPTS = Number(process.argv[2] ?? 50);

interface Outcome {
  /** Seconds between the toss tap and the strike tap. */
  delay: number;
  /** How long the first tap was held down. */
  hold: number;
  served: boolean;
  jump: boolean;
  /** Height of the ball at contact. */
  contactZ: number;
  /** How high the server was off the floor at contact. */
  liftAtHit: number;
  /** Why a serve never happened. */
  reason: string;
  /** Fraction of the flight during which a press would have worked. */
  windowStart: number;
  windowEnd: number;
}

function attempt(seed: number, delay: number, holdSeconds: number): Outcome {
  const w = new World({
    seed,
    home: TEAMS[0],
    away: TEAMS[1],
    difficulty: 1,
    humanControlsHome: true,
  });
  // Play until this side is the one serving.
  let guard = 0;
  while ((w.phase !== 'serve' || w.servingSide !== 'home') && guard++ < 120 * 400) w.step(null);
  if ((w.phase as string) !== 'serve') {
    return {
      delay,
      hold: holdSeconds,
      served: false,
      jump: false,
      contactZ: 0,
      liftAtHit: 0,
      reason: 'never reached a home serve',
      windowStart: -1,
      windowEnd: -1,
    };
  }

  const server = w.team('home').server;
  let t = 0;
  let tossed = -1;
  let windowStart = -1;
  let windowEnd = -1;
  let contactZ = 0;
  let liftAtHit = 0;
  let jump = false;

  for (let i = 0; i < 120 * 10; i++) {
    const cmd = idleCommand();
    // A tap is a press held for a couple of steps, exactly as a keyboard
    // delivers it, and released — that release is what tosses the ball.
    // A human tap lasts a tenth of a second or two, not one frame. Modelling
    // it as a single step is exactly how a serve that no player could perform
    // passed every automated check.
    if (t < holdSeconds) {
      cmd.actionHeld = true;
      cmd.actionPressed = i === 0;
    }
    if (tossed >= 0 && t >= tossed + delay && t < tossed + delay + 2 * DT) {
      cmd.actionPressed = t < tossed + delay + DT;
      cmd.actionHeld = true;
    }

    const readyBefore = w.serveStrikeReady;
    contactZ = w.ball.pos.z;
    liftAtHit = server.height;
    jump = server.airborne;

    w.step(cmd, DT);
    t += DT;

    if (tossed < 0 && w.serveTossInFlight) tossed = t;
    if (readyBefore) {
      if (windowStart < 0) windowStart = t;
      windowEnd = t;
    }
    if ((w.phase as string) === 'rally') {
      return {
        delay,
        hold: holdSeconds,
        served: true,
        jump,
        contactZ,
        liftAtHit,
        reason: '',
        windowStart: windowStart - tossed,
        windowEnd: windowEnd - tossed,
      };
    }
  }

  const reason =
    tossed < 0
      ? 'the ball never left the hand'
      : windowStart < 0
        ? 'the strike window never opened'
        : `pressed outside the window (open ${(windowStart - tossed).toFixed(2)}..${(
            windowEnd - tossed
          ).toFixed(2)} s after the toss)`;
  return {
    delay,
    hold: holdSeconds,
    served: false,
    jump: false,
    contactZ,
    liftAtHit,
    reason,
    windowStart,
    windowEnd,
  };
}

function main(): void {
  const results: Outcome[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    // Sweep the second tap across the whole plausible range, with the seed
    // varying too so this is not one lucky rally repeated.
    const delay = 0.05 + (i / (ATTEMPTS - 1)) * 1.35;
    // Sweep the tap length too: 40 ms to 340 ms covers everything from a
    // flick to a deliberate press.
    const hold = 0.04 + (i % 7) * 0.05;
    results.push(attempt(11 + i * 7, delay, hold));
  }

  const served = results.filter((r) => r.served);
  const jumped = served.filter((r) => r.jump && r.liftAtHit > 0.25);
  console.log(`attempts: ${results.length}`);
  console.log(`served:   ${served.length} (${Math.round((100 * served.length) / results.length)}%)`);
  console.log(`in the air at contact: ${jumped.length}`);
  console.log(`max reach available: ${(PLAYER_REACH + 1.2).toFixed(2)} m`);

  const windows = results.filter((r) => r.windowStart >= 0);
  if (windows.length) {
    const s = windows.reduce((a, r) => a + r.windowStart, 0) / windows.length;
    const e = windows.reduce((a, r) => a + r.windowEnd, 0) / windows.length;
    console.log(`strike window: ${s.toFixed(2)} .. ${e.toFixed(2)} s after the toss (${(e - s).toFixed(2)} s wide)`);
  }

  const underarm = served.filter((r) => r.hold > 0.5);
  console.log(`served underarm (deliberate hold): ${underarm.length}`);
  console.log('\ndelay  hold   result');
  for (const r of results) {
    const tag = r.served
      ? `SERVED ${r.jump ? 'jumping' : 'standing'} at z=${r.contactZ.toFixed(2)} lift=${r.liftAtHit.toFixed(2)}`
      : `missed — ${r.reason}`;
    console.log(`${r.delay.toFixed(2)}s  ${r.hold.toFixed(2)}s  ${tag}`);
  }

  const failures = results.filter((r) => !r.served);
  if (failures.length) {
    const byReason = new Map<string, number>();
    for (const f of failures) {
      const key = f.reason.split('(')[0].trim();
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    console.log('\nfailures by cause:');
    for (const [k, v] of byReason) console.log(`  ${v}x ${k}`);
  }
}

main();
