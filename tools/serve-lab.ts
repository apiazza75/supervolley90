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
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, PLAYER_REACH } from '../src/core/rules';
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
  /** Where the served ball ended up — the only thing that really matters. */
  landing: 'in' | 'out' | 'own half' | 'net' | 'hit a team-mate' | 'unknown';
  /** How far from the end line the server was when they struck. */
  servedFromY: number;
  /** Ball speed just after the strike, and how long it took to cross. */
  launchSpeed: number;
  crossTime: number;
  /** Where the served ball came down, for measuring trajectory variety. */
  landX: number;
  landY: number;
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
      landing: 'unknown',
      servedFromY: 0,
      launchSpeed: 0,
      crossTime: 0,
      landX: 0,
      landY: 0,
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
      const servedFromY = server.pos.y;
      const launchSpeed = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vel.z);
      let crossTime = 0;
      let landX = 0;
      let landY = 0;
      // Follow it. "The serve fired" is not the same as "the serve worked":
      // a ball that drops back into your own court, or into the back of a
      // team-mate, is a serve you could not play, and only watching where it
      // lands can tell the difference.
      // Follow the SERVE, and stop the moment its own flight is decided.
      // Waiting for the rally to end instead measures who won the point, which
      // is a different question entirely — a served ball can be perfect and
      // still come back and land at your feet three touches later.
      // Read the verdict from the game's own events. Watching positions and
      // guessing was wrong twice: once by measuring who won the rally rather
      // than where the serve went, and once by carrying on past the end of the
      // rally and blaming the serve for the next one.
      let landing: Outcome['landing'] = 'unknown';
      let crossed = false;
      for (let k = 0; k < 120 * 8 && landing === 'unknown'; k++) {
        w.step(null, DT);
        if (!crossed) {
          crossTime += DT;
          if (w.ball.pos.y > 0) crossed = true;
        }
        const at = { x: w.ball.pos.x, y: w.ball.pos.y };
        for (const ev of w.drainEvents()) {
          if (ev.type === 'contact' && ev.side === 'away') {
            landing = 'in';
            // Where the receiver met it: the proxy for the serve's trajectory.
            landX = w.ball.pos.x;
            landY = w.ball.pos.y;
          }
          else if (ev.type === 'contact' && ev.side === 'home' && ev.playerId !== server.id)
            landing = 'hit a team-mate';
          else if (ev.type === 'point') {
            if (ev.reason === 'serveFault') {
              const inside =
                Math.abs(at.x) <= COURT_HALF_WIDTH + 0.2 &&
                Math.abs(at.y) <= COURT_HALF_LENGTH + 0.2;
              landing =
                at.y < 0 ? (Math.abs(at.y) < 1.5 ? 'net' : 'own half') : inside ? 'in' : 'out';
            } else {
              landing = 'in';
            }
          }
          if (landing !== 'unknown') break;
        }
      }
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
        landing,
        servedFromY,
        launchSpeed,
        crossTime,
        landX,
        landY,
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
    landing: 'unknown',
    servedFromY: server.pos.y,
    launchSpeed: 0,
    crossTime: 0,
    landX: 0,
    landY: 0,
  };
}

/**
 * The other half of the question: what happens when the COMPUTER serves.
 *
 * A human serve that works is no use if the opponent buries every one of
 * theirs in the net — which is exactly what was happening, unnoticed, because
 * nothing measured it.
 */
function aiServes(): void {
  const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 21, difficulty: 1 });
  let inFlight = false;
  let serving: string | null = null;
  let before = { x: 0, y: 0 };
  const out = new Map<string, number>();
  const waits: number[] = [];
  let phaseWas = w.phase;
  let t = 0;
  let serveStart = -1;

  for (let i = 0; i < 120 * 60 * 6; i++) {
    before = { x: w.ball.pos.x, y: w.ball.pos.y };
    w.step(null, DT);
    t += DT;
    if (w.phase === 'serve' && phaseWas !== 'serve') serveStart = t;
    if (phaseWas === 'serve' && (w.phase as string) === 'rally' && serveStart > 0) {
      waits.push(t - serveStart);
    }
    phaseWas = w.phase;

    for (const ev of w.drainEvents()) {
      if (ev.type === 'contact' && ev.kind === 'serve') {
        serving = ev.side;
        inFlight = true;
      } else if (inFlight && ev.type === 'contact') {
        out.set('received', (out.get('received') ?? 0) + 1);
        inFlight = false;
      } else if (inFlight && ev.type === 'point') {
        const ours = serving === 'home' ? before.y < 0 : before.y > 0;
        const inside =
          Math.abs(before.x) <= COURT_HALF_WIDTH + 0.2 &&
          Math.abs(before.y) <= COURT_HALF_LENGTH + 0.2;
        const k =
          ev.reason !== 'serveFault'
            ? `point:${ev.reason}`
            : ours
              ? Math.abs(before.y) < 1.6
                ? 'into the net'
                : 'own half'
              : inside
                ? 'ace'
                : 'out';
        out.set(k, (out.get(k) ?? 0) + 1);
        inFlight = false;
      }
    }
  }

  const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  console.log(`\ncomputer serves over six minutes of play: ${[...out.values()].reduce((a, b) => a + b, 0)}`);
  for (const [k, v] of out) console.log(`  ${v}x ${k}`);
  console.log(`average time from whistle to serve: ${avg.toFixed(2)} s`);
}

function main(): void {
  const results: Outcome[] = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    // Sweep the second tap across the whole plausible range, with the seed
    // varying too so this is not one lucky rally repeated.
    const delay = 0.05 + (i / (ATTEMPTS - 1)) * 1.35;
    // Sweep the tap length too: 40 ms to 340 ms covers everything from a
    // flick to a deliberate press.
    const hold = 0.04 + (i % 8) * 0.115;
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

  // The question the whole one-button serve rests on: does jumping for it
  // actually produce a different ball?
  const air = served.filter((r) => r.jump && r.liftAtHit > 0.25);
  const ground = served.filter((r) => !(r.jump && r.liftAtHit > 0.25));
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(
    `jump serve:     ${air.length} at ${mean(air.map((r) => r.launchSpeed)).toFixed(1)} m/s, ` +
      `${mean(air.map((r) => r.crossTime)).toFixed(2)} s to cross the net`,
  );
  console.log(
    `standing serve: ${ground.length} at ${mean(ground.map((r) => r.launchSpeed)).toFixed(1)} m/s, ` +
      `${mean(ground.map((r) => r.crossTime)).toFixed(2)} s to cross the net`,
  );

  // The question the whole one-button serve rests on: does hitting it at full
  // stretch produce a different ball from scooping it at chest height?
  const bucket = (lo: number, hi: number): Outcome[] =>
    served.filter((r) => r.contactZ >= lo && r.contactZ < hi);
  console.log('launch speed by contact height:');
  for (const [lo, hi, label] of [
    [0, 2.0, 'below the tape  '],
    [2.0, 2.9, 'at the tape     '],
    [2.9, 9, 'above the tape  '],
  ] as [number, number, string][]) {
    const b = bucket(lo, hi);
    if (!b.length) continue;
    console.log(
      `  ${label} ${b.length} serves, ${mean(b.map((r) => r.launchSpeed)).toFixed(1)} m/s, ` +
        `${mean(b.map((r) => r.crossTime)).toFixed(2)} s to cross`,
    );
  }

  // Trajectory variety: identical serves are the mark of a canned animation.
  const landed = served.filter((r) => r.landY !== 0);
  const sd = (xs: number[]): number => {
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((v) => (v - m) * (v - m))));
  };
  console.log(
    `landing spread: x ±${sd(landed.map((r) => r.landX)).toFixed(2)} m, ` +
      `y ±${sd(landed.map((r) => r.landY)).toFixed(2)} m, ` +
      `speed ±${sd(served.map((r) => r.launchSpeed)).toFixed(1)} m/s`,
  );

  // The control the player actually operates: how long the button was held
  // before the toss. If this does not move the ball, the charge is a lie.
  console.log('by how long the button was held before the toss:');
  for (const [lo, hi, label] of [
    [0, 0.18, 'flick        '],
    [0.18, 0.36, 'short hold   '],
    [0.36, 0.6, 'medium hold  '],
    [0.6, 9, 'full load    '],
  ] as [number, number, string][]) {
    const b = served.filter((r) => r.hold >= lo && r.hold < hi);
    if (!b.length) continue;
    const air = b.filter((r) => r.jump && r.liftAtHit > 0.25).length;
    console.log(
      `  ${label} ${b.length} serves, ${mean(b.map((r) => r.launchSpeed)).toFixed(1)} m/s, ` +
        `${mean(b.map((r) => r.crossTime)).toFixed(2)} s to cross, ${air} jumped`,
    );
  }

  const underarm = served.filter((r) => r.hold > 0.5);
  console.log(`served underarm (deliberate hold): ${underarm.length}`);
  const byLanding = new Map<string, number>();
  for (const r of served) byLanding.set(r.landing, (byLanding.get(r.landing) ?? 0) + 1);
  console.log('where the ball ended up:');
  for (const [k, v] of byLanding) console.log(`  ${v}x ${k}`);
  const worst = Math.max(...served.map((r) => r.servedFromY));
  console.log(`served from as far forward as y=${worst.toFixed(2)} (end line is -${COURT_HALF_LENGTH})`);
  console.log('\ndelay  hold   result');
  for (const r of results) {
    const tag = r.served
      ? `SERVED ${r.jump ? 'jumping' : 'standing'} z=${r.contactZ.toFixed(2)} lift=${r.liftAtHit.toFixed(2)} -> ${r.landing}`
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
aiServes();
