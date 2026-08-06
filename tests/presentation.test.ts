import { describe, expect, it } from 'vitest';

import { FIXED_DT, attackDir } from '../src/core/rules';
import { facesNet } from '../src/core/presentation';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';

/**
 * These are gameplay invariants, measured by running the real simulation.
 *
 * The point of doing it this way is that the previous build's evidence was a
 * screenshot tool that assigned `p.height`, `p.anim` and `p.swing` by hand and
 * then photographed the result — which proves the renderer can draw a pose, not
 * that the game ever reaches it. Everything below is observed from a match the
 * AI actually played.
 */

const makeWorld = (seed: number) =>
  new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });

interface Observed {
  backFacingContacts: number;
  contactsByKind: Record<string, number>;
  maxConcurrentApproach: number;
  /** Anyone but the server approaching during the serve phase. */
  serveReadyApproachSamples: number;
  /** The server approaching before the ball has even left their hands. */
  preTossApproachSamples: number;
  coverApproachSamples: number;
  blockAttempts: number;
  blockContacts: number;
  groundedBlockContacts: number;
  spikeAirborneContacts: number;
  spikeGroundedContacts: number;
  longestApproachRun: number;
}

/** Play a match and watch the presentation state, contact by contact. */
function observe(seed: number, steps: number): Observed {
  const w = makeWorld(seed);
  const o: Observed = {
    backFacingContacts: 0,
    contactsByKind: {},
    maxConcurrentApproach: 0,
    serveReadyApproachSamples: 0,
    preTossApproachSamples: 0,
    coverApproachSamples: 0,
    blockAttempts: 0,
    blockContacts: 0,
    groundedBlockContacts: 0,
    spikeAirborneContacts: 0,
    spikeGroundedContacts: 0,
    longestApproachRun: 0,
  };

  // How long each player has been continuously in the approach cycle.
  const approachRun = new Map<number, number>();

  for (let i = 0; i < steps; i++) {
    w.step(FIXED_DT);

    const serverId = w.team(w.servingSide).server.id;
    const players = [...w.home.players, ...w.away.players];
    let approachingNow = 0;
    for (const p of players) {
      const isApproach = p.presentation.locomotion === 'approach';
      if (isApproach) {
        approachingNow++;
        const run = (approachRun.get(p.id) ?? 0) + FIXED_DT;
        approachRun.set(p.id, run);
        if (run > o.longestApproachRun) o.longestApproachRun = run;
        if (w.phase === 'serve') {
          // The jump server's run-up is a real approach and belongs here. Any
          // OTHER body approaching while the court waits to serve is the bug.
          if (p.id !== serverId) o.serveReadyApproachSamples++;
          else if (w.ball.frozen) o.preTossApproachSamples++;
        }
        if (p.presentation.sourceJob === 'cover') o.coverApproachSamples++;
      } else {
        approachRun.set(p.id, 0);
      }
    }
    if (approachingNow > o.maxConcurrentApproach) o.maxConcurrentApproach = approachingNow;

    for (const e of w.drainEvents()) {
      if (e.type === 'blockAttempt') o.blockAttempts++;
      if (e.type === 'blockContact') {
        o.blockContacts++;
        if (!e.airborne) o.groundedBlockContacts++;
      }
      if (e.type !== 'contact') continue;
      o.contactsByKind[e.kind] = (o.contactsByKind[e.kind] ?? 0) + 1;

      // A spike, block or serve is played towards the opponent's court. Meeting
      // the ball turned the other way is the "contact from behind" the brief
      // calls out, and it must never happen.
      if (facesNet(e.kind === 'tip' || e.kind === 'power' ? 'spike' : (e.kind as never))) {
        if (e.facing !== attackDir(e.side)) o.backFacingContacts++;
      }
      if (e.kind === 'spike' || e.kind === 'power') {
        if (e.airborne) o.spikeAirborneContacts++;
        else o.spikeGroundedContacts++;
      }
    }
  }
  return o;
}

describe('presentation invariants, observed from real matches', () => {
  const seeds = [1337, 4242];

  it('never strikes the ball with the player turned away from the net', () => {
    for (const seed of seeds) {
      const o = observe(seed, 9000);
      expect(o.contactsByKind.spike ?? 0).toBeGreaterThan(0);
      expect(o.backFacingContacts).toBe(0);
    }
  });

  it('keeps the attack approach rare and short instead of making everyone run', () => {
    for (const seed of seeds) {
      const o = observe(seed, 9000);
      // The brief's limit: never more than two hitters approaching at once.
      expect(o.maxConcurrentApproach).toBeLessThanOrEqual(2);
      // An approach is a run-up, not a state of being: it cannot last seconds.
      expect(o.longestApproachRun).toBeLessThanOrEqual(1.6);
    }
  });

  it('shows a still, ready formation while waiting to serve', () => {
    for (const seed of seeds) {
      const o = observe(seed, 9000);
      // Nobody but the server moves, and the server only runs after the toss.
      expect(o.serveReadyApproachSamples).toBe(0);
      expect(o.preTossApproachSamples).toBe(0);
    }
  });

  it('never lets a covering player borrow the attack approach', () => {
    for (const seed of seeds) {
      expect(observe(seed, 9000).coverApproachSamples).toBe(0);
    }
  });

  it('produces real blocks from the simulation, always off the floor', () => {
    let attempts = 0;
    let contacts = 0;
    for (const seed of seeds) {
      const o = observe(seed, 9000);
      attempts += o.blockAttempts;
      contacts += o.blockContacts;
      expect(o.groundedBlockContacts).toBe(0);
    }
    expect(attempts).toBeGreaterThan(0);
    expect(contacts).toBeGreaterThan(0);
  });

  it('spikes the ball in the air rather than from a standing start', () => {
    for (const seed of seeds) {
      const o = observe(seed, 9000);
      const airborne = o.spikeAirborneContacts;
      const grounded = o.spikeGroundedContacts;
      expect(airborne).toBeGreaterThan(0);
      // Grounded contacts are the deliberate tip/down-ball fallback, which must
      // stay the exception rather than being the whole offence.
      expect(airborne).toBeGreaterThan(grounded);
    }
  });
});
