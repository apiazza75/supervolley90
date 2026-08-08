/**
 * Gameplay measurement, taken from matches the simulation actually plays.
 *
 * This module exists because the previous build's evidence did not survive
 * contact with the question "does the game do this?". Its screenshot tool
 * assigned `p.height`, `p.anim` and `p.swing` by hand and photographed the
 * result, which demonstrates that the renderer can draw a pose — not that the
 * AI, the rules and the input ever produce one. Everything here is observed:
 * the harness plays, watches, and reports what happened.
 *
 * The unit tests, the headless CLI and the visual QA all read these same
 * numbers, so a threshold cannot pass in one place and fail in another.
 */
import { FIXED_DT, attackDir } from '../core/rules';
import { facesNet, type VolleyballAction } from '../core/presentation';
import type { Player } from '../core/player';
import { World } from '../core/world';
import { TEAMS } from '../game/teams';
import { countDistinctCharacterSignatures } from '../render/character-signature';

/**
 * A technical sequence, summarised across every occurrence.
 *
 * The headline figures are medians rather than the best example seen: one
 * flattering spike proves nothing about the other ninety, and a gate that can
 * be satisfied by an outlier is not a gate.
 */
export interface SequenceMetrics {
  /** How many of these the match produced. */
  count: number;
  /** Median ground covered during the run-up, in metres. */
  approachDistance: number;
  /** Median height above the floor at contact, in metres. */
  apexHeight: number;
  /** Best single example, for the report. */
  bestApproachDistance: number;
  bestApexHeight: number;
  /** True only if EVERY one of these contacts was made off the floor. */
  airborneContact: boolean;
  /** The phases the body passed through, in order, for the best example. */
  stateSequence: string[];
}

export interface GameplayMetrics {
  steps: number;
  seeds: number[];
  distinctCharacterSignaturesHome: number;
  distinctCharacterSignaturesAway: number;
  /** Rallies played to a point. */
  points: number;
  backFacingContacts: number;
  contactsByKind: Record<string, number>;
  maxConcurrentApproachPlayers: number;
  /** Longest unbroken time any single body spent in the approach cycle. */
  longestApproachRun: number;
  /** Longest unbroken spell with more than two bodies approaching at once. */
  longestOverTwoApproach: number;
  /** Anyone but the server running an approach while waiting to serve. */
  serveReadyApproachPlayers: number;
  /** The server approaching before the toss has left their hands. */
  preTossApproachSamples: number;
  /** Covering players borrowing the attack approach. */
  coverApproachSamples: number;
  /** Serve phases played. */
  serveFormationPhases: number;
  /**
   * Serve phases in which every player but the server came to a complete stop.
   *
   * The brief asks that serve-ready show twelve still, ready players. A single
   * screenshot cannot establish that — it establishes that it happened once —
   * so it is measured over every serve in the sample instead.
   */
  serveFormationSettled: number;
  jumpServe: SequenceMetrics;
  spike: SequenceMetrics;
  block: {
    attempts: number;
    contacts: number;
    apexHeight: number;
    airborneContacts: number;
    groundedContacts: number;
  };
}

const emptySequence = (): SequenceMetrics => ({
  count: 0,
  approachDistance: 0,
  apexHeight: 0,
  bestApproachDistance: 0,
  bestApexHeight: 0,
  airborneContact: false,
  stateSequence: [],
});

interface Sample {
  approachDistance: number;
  apexHeight: number;
  airborneContact: boolean;
  stateSequence: string[];
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Reduce every observed occurrence to the reported summary. */
function summarise(samples: Sample[]): SequenceMetrics {
  const out = emptySequence();
  out.count = samples.length;
  if (!samples.length) return out;
  out.approachDistance = median(samples.map((s) => s.approachDistance));
  out.apexHeight = median(samples.map((s) => s.apexHeight));
  out.airborneContact = samples.every((s) => s.airborneContact);
  const best = samples.reduce((a, b) => (b.apexHeight > a.apexHeight ? b : a));
  out.bestApproachDistance = best.approachDistance;
  out.bestApexHeight = best.apexHeight;
  out.stateSequence = best.stateSequence;
  return out;
}

const makeWorld = (seed: number): World =>
  new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });

/**
 * Play `steps` simulation steps for each seed and measure what came out.
 *
 * Nothing here writes to the simulation: the harness only reads state and
 * drains events, so the numbers describe the game as shipped.
 */
export function measureGameplay(seeds: number[], steps: number): GameplayMetrics {
  const m: GameplayMetrics = {
    steps,
    seeds: [...seeds],
    distinctCharacterSignaturesHome: 0,
    distinctCharacterSignaturesAway: 0,
    points: 0,
    backFacingContacts: 0,
    contactsByKind: {},
    maxConcurrentApproachPlayers: 0,
    longestApproachRun: 0,
    longestOverTwoApproach: 0,
    serveReadyApproachPlayers: 0,
    preTossApproachSamples: 0,
    coverApproachSamples: 0,
    serveFormationPhases: 0,
    serveFormationSettled: 0,
    jumpServe: emptySequence(),
    spike: emptySequence(),
    block: { attempts: 0, contacts: 0, apexHeight: 0, airborneContacts: 0, groundedContacts: 0 },
  };

  const jumpServeSamples: Sample[] = [];
  const spikeSamples: Sample[] = [];

  for (const seed of seeds) {
    const w = makeWorld(seed);
    m.distinctCharacterSignaturesHome = Math.max(
      m.distinctCharacterSignaturesHome,
      countDistinctCharacterSignatures(w.home.players),
    );
    m.distinctCharacterSignaturesAway = Math.max(
      m.distinctCharacterSignaturesAway,
      countDistinctCharacterSignatures(w.away.players),
    );
    // Per-player run-up bookkeeping, so a contact can report the distance the
    // body actually covered getting there.
    const approachRun = new Map<number, number>();
    const phases = new Map<number, string[]>();
    let overTwo = 0;
    // Serve-formation bookkeeping: did this serve phase ever settle?
    let inServePhase = false;
    let settledThisServe = false;

    const notePhase = (p: Player): void => {
      const key = `${p.presentation.action}:${p.presentation.phase}`;
      const list = phases.get(p.id) ?? [];
      if (list[list.length - 1] !== key) {
        list.push(key);
        if (list.length > 24) list.shift();
        phases.set(p.id, list);
      }
    };

    for (let i = 0; i < steps; i++) {
      w.step(null, FIXED_DT);

      const serverId = w.team(w.servingSide).server.id;
      const players = [...w.home.players, ...w.away.players];
      let approachingNow = 0;

      if (w.phase === 'serve') {
        if (!inServePhase) {
          inServePhase = true;
          settledThisServe = false;
          m.serveFormationPhases++;
        }
        const stillNow = players
          .filter((p) => p.id !== serverId)
          .every((p) => Math.hypot(p.vel.x, p.vel.y) < 0.45);
        if (stillNow && !settledThisServe) {
          settledThisServe = true;
          m.serveFormationSettled++;
        }
      } else {
        inServePhase = false;
      }

      for (const p of players) {
        notePhase(p);
        if (p.presentation.locomotion === 'approach') {
          approachingNow++;
          const run = (approachRun.get(p.id) ?? 0) + FIXED_DT;
          approachRun.set(p.id, run);
          if (run > m.longestApproachRun) m.longestApproachRun = run;
          if (w.phase === 'serve') {
            if (p.id !== serverId) m.serveReadyApproachPlayers++;
            else if (w.ball.frozen) m.preTossApproachSamples++;
          }
          if (p.presentation.sourceJob === 'cover') m.coverApproachSamples++;
        } else {
          approachRun.set(p.id, 0);
        }
      }
      if (approachingNow > m.maxConcurrentApproachPlayers) {
        m.maxConcurrentApproachPlayers = approachingNow;
      }
      // The brief tolerates a momentary third approach but not a sustained
      // one, so what is gated is how long it lasts, not that it ever happens.
      if (approachingNow > 2) {
        overTwo += FIXED_DT;
        if (overTwo > m.longestOverTwoApproach) m.longestOverTwoApproach = overTwo;
      } else {
        overTwo = 0;
      }

      for (const e of w.drainEvents()) {
        if (e.type === 'point') m.points++;
        if (e.type === 'blockAttempt') {
          m.block.attempts++;
          if (e.height > m.block.apexHeight) m.block.apexHeight = e.height;
        }
        if (e.type === 'blockContact') {
          m.block.contacts++;
          if (e.airborne) m.block.airborneContacts++;
          else m.block.groundedContacts++;
          if (e.height > m.block.apexHeight) m.block.apexHeight = e.height;
        }
        if (e.type !== 'contact') continue;

        m.contactsByKind[e.kind] = (m.contactsByKind[e.kind] ?? 0) + 1;

        const asAction: VolleyballAction =
          e.kind === 'tip' || e.kind === 'power'
            ? 'spike'
            : e.kind === 'save'
              ? 'dive'
              : (e.kind as VolleyballAction);
        if (facesNet(asAction) && e.facing !== attackDir(e.side)) m.backFacingContacts++;

        const striker = players.find((p) => p.id === e.playerId);
        if (!striker) continue;
        const sample = {
          approachDistance: striker.lastApproachDistance,
          apexHeight: e.height,
          airborneContact: e.airborne,
          stateSequence: [...(phases.get(e.playerId) ?? [])],
        };
        if (e.kind === 'serve' && striker.plansJumpServe) jumpServeSamples.push(sample);
        if (e.kind === 'spike' || e.kind === 'power') spikeSamples.push(sample);
      }
    }
  }
  m.jumpServe = summarise(jumpServeSamples);
  m.spike = summarise(spikeSamples);
  return m;
}

/** A failed acceptance threshold, in a form the CI log can print. */
export interface Violation {
  metric: string;
  expected: string;
  actual: string;
}

/**
 * The acceptance gate.
 *
 * Thresholds are the brief's, and they are checked in one place so the CI job,
 * the unit tests and the visual QA cannot drift apart.
 */
export function checkGameplayGates(m: GameplayMetrics): Violation[] {
  const v: Violation[] = [];
  const need = (ok: boolean, metric: string, expected: string, actual: string): void => {
    if (!ok) v.push({ metric, expected, actual });
  };

  need(
    m.distinctCharacterSignaturesHome === 6,
    'distinctCharacterSignaturesHome',
    '6',
    String(m.distinctCharacterSignaturesHome),
  );
  need(
    m.distinctCharacterSignaturesAway === 6,
    'distinctCharacterSignaturesAway',
    '6',
    String(m.distinctCharacterSignaturesAway),
  );
  need(m.backFacingContacts === 0, 'backFacingContacts', '0', String(m.backFacingContacts));
  need(
    m.longestOverTwoApproach <= 0.25,
    'longestOverTwoApproach',
    '<= 0.25 s',
    m.longestOverTwoApproach.toFixed(2),
  );
  need(
    m.serveReadyApproachPlayers === 0,
    'serveReadyApproachPlayers',
    '0',
    String(m.serveReadyApproachPlayers),
  );
  need(m.coverApproachSamples === 0, 'coverApproachSamples', '0', String(m.coverApproachSamples));
  // Twelve still, ready players before the serve — over the whole sample, not
  // in one lucky frame. A little slack for a rally that ends far from base.
  const settledRatio = m.serveFormationPhases
    ? m.serveFormationSettled / m.serveFormationPhases
    : 0;
  need(
    settledRatio >= 0.8,
    'serveFormationSettled',
    '>= 80% of serve phases',
    `${m.serveFormationSettled}/${m.serveFormationPhases}`,
  );
  need(
    m.longestApproachRun <= 1.6,
    'longestApproachRun',
    '<= 1.6 s',
    m.longestApproachRun.toFixed(2),
  );

  need(m.spike.count > 0, 'spike.count', '> 0', String(m.spike.count));
  need(m.spike.airborneContact, 'spike.airborneContact', 'true', String(m.spike.airborneContact));
  need(
    m.spike.apexHeight >= 0.65,
    'spike.apexHeight',
    '>= 0.65 m',
    m.spike.apexHeight.toFixed(2),
  );
  need(
    m.spike.approachDistance >= 1.4,
    'spike.approachDistance',
    '>= 1.4 m',
    m.spike.approachDistance.toFixed(2),
  );

  need(m.jumpServe.count > 0, 'jumpServe.count', '> 0', String(m.jumpServe.count));
  need(
    m.jumpServe.airborneContact,
    'jumpServe.airborneContact',
    'true',
    String(m.jumpServe.airborneContact),
  );
  need(
    m.jumpServe.apexHeight >= 0.55,
    'jumpServe.apexHeight',
    '>= 0.55 m',
    m.jumpServe.apexHeight.toFixed(2),
  );
  need(
    m.jumpServe.approachDistance >= 1.2 && m.jumpServe.approachDistance <= 2.6,
    'jumpServe.approachDistance',
    '1.2 – 2.6 m',
    m.jumpServe.approachDistance.toFixed(2),
  );

  need(m.block.attempts > 0, 'block.attempts', '> 0', String(m.block.attempts));
  need(m.block.contacts > 0, 'block.contacts', '> 0', String(m.block.contacts));
  need(m.block.groundedContacts === 0, 'block.groundedContacts', '0', String(m.block.groundedContacts));
  need(m.block.apexHeight >= 0.45, 'block.apexHeight', '>= 0.45 m', m.block.apexHeight.toFixed(2));

  return v;
}
