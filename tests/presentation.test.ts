import { describe, expect, it } from 'vitest';

import { GAME_SPEED } from '../src/core/rules';
import { checkGameplayGates, measureGameplay } from '../src/qa/gameplay-metrics';
import { READABILITY_FREEZE, contactReadabilityFreeze, contactReleaseMix } from '../src/render/renderer';

/**
 * Gameplay invariants, measured by running the real simulation.
 *
 * The point of doing it this way is that the previous build's evidence was a
 * screenshot tool that assigned `p.height`, `p.anim` and `p.swing` by hand and
 * then photographed the result — which proves the renderer can draw a pose, not
 * that the game ever reaches it. Everything below is observed from matches the
 * AI actually played, through the same module the CI gate and the visual QA
 * use, so a threshold cannot pass here and fail there.
 */

const SEEDS = [1337, 4242, 90210, 7, 11, 2026];
const STEPS = 7000;

// One measurement pass shared by every assertion: it is the expensive part.
const metrics = measureGameplay(SEEDS, STEPS);

describe('presentation invariants, observed from real matches', () => {
  it('plays enough volleyball for the rest of these numbers to mean anything', () => {
    expect(metrics.points).toBeGreaterThan(10);
    expect(metrics.contactsByKind.spike ?? 0).toBeGreaterThan(0);
    expect(metrics.contactsByKind.serve ?? 0).toBeGreaterThan(0);
  });

  it('never strikes the ball with the player turned away from the net', () => {
    expect(metrics.backFacingContacts).toBe(0);
  });

  it('keeps the attack approach rare and short instead of making everyone run', () => {
    // Tactically, one hitter owns the play. The other front-row players cover
    // or hold shape; they must not all become attackers just because the set
    // is live.
    expect(metrics.maxConcurrentAttackJobs).toBeLessThanOrEqual(1);
    // A third body may drift into an approach for an instant; it may not stay.
    expect(metrics.longestOverTwoApproach).toBeLessThanOrEqual(0.25);
    // An approach is a run-up, not a state of being: it cannot last seconds.
    expect(metrics.longestApproachRun).toBeLessThanOrEqual(1.6);
  });

  it('shows a still, ready formation while waiting to serve', () => {
    expect(metrics.serveReadyApproachPlayers).toBe(0);
  });

  it('never lets a covering player borrow the attack approach', () => {
    expect(metrics.coverApproachSamples).toBe(0);
  });

  it('uses a real short walking gait for positional corrections instead of sprinting everywhere', () => {
    expect(metrics.locomotion.walk).toBeGreaterThan(0);
    expect(metrics.locomotion.shuffle).toBeGreaterThan(0);
    expect(metrics.locomotion.run).toBeLessThanOrEqual(metrics.locomotion.shuffle * 0.25);
    expect(metrics.locomotion.shortCorrectionSamples).toBeGreaterThan(0);
    expect(
      metrics.locomotion.shortCorrectionsAsWalk / metrics.locomotion.shortCorrectionSamples,
    ).toBeGreaterThanOrEqual(0.8);
    expect(metrics.locomotion.mediumCorrectionSamples).toBeGreaterThan(0);
    expect(
      metrics.locomotion.mediumCorrectionsAsShuffle / metrics.locomotion.mediumCorrectionSamples,
    ).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps the playable presentation below full-speed chaos', () => {
    expect(GAME_SPEED).toBeLessThanOrEqual(0.6);
  });

  it('never freezes the whole rally to punctuate a contact', () => {
    const softTouch = contactReadabilityFreeze('bump', 8);
    const set = contactReadabilityFreeze('set', 8);
    const serve = contactReadabilityFreeze('serve', 13);
    const spike = contactReadabilityFreeze('spike', 26);
    const block = contactReadabilityFreeze('block', 22);
    const power = contactReadabilityFreeze('power', 32);

    expect([softTouch, set, serve, spike, block, power]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.values(READABILITY_FREEZE).every(value => value === 0)).toBe(true);
  });

  it('holds the drawn ball at the hand, then releases it without a positional snap', () => {
    expect(contactReleaseMix(0)).toBe(0);
    expect(contactReleaseMix(0.0425)).toBeCloseTo(0.5, 5);
    expect(contactReleaseMix(0.085)).toBe(1);
    expect(contactReleaseMix(0.03)).toBeLessThan(contactReleaseMix(0.06));
  });

  it('keeps the ball area readable instead of collapsing the team around it', () => {
    expect(metrics.courtOrder.rallySamples).toBeGreaterThan(0);
    expect(metrics.courtOrder.maxNearBallPlayers).toBeLessThanOrEqual(4);
    expect(metrics.courtOrder.maxSameTeamNearBallPlayers).toBeLessThanOrEqual(4);
    expect(metrics.courtOrder.maxNonPlayingNearBallPlayers).toBeLessThanOrEqual(2);
    expect(metrics.courtOrder.crowdedBallSamples / metrics.courtOrder.rallySamples).toBeLessThanOrEqual(0.002);
    expect(metrics.courtOrder.nonPlayingCrowdSamples).toBe(0);
  });

  it('spikes off the floor, after a real run-up', () => {
    expect(metrics.spike.count).toBeGreaterThan(0);
    expect(metrics.spike.airborneContact).toBe(true);
    expect(metrics.spike.approachDistance).toBeGreaterThanOrEqual(1.4);
    expect(metrics.spike.apexHeight).toBeGreaterThanOrEqual(0.65);
  });

  it('plays a full spike jump sequence instead of a bare hit pose', () => {
    expect(metrics.spike.stateSequence).toEqual(
      expect.arrayContaining(['spike:plant', 'spike:rise', 'spike:contact', 'spike:follow']),
    );
  });

  it('serves in the air, after a run-up of a realistic length', () => {
    expect(metrics.jumpServe.count).toBeGreaterThan(0);
    expect(metrics.jumpServe.airborneContact).toBe(true);
    expect(metrics.jumpServe.approachDistance).toBeGreaterThanOrEqual(1.2);
    expect(metrics.jumpServe.approachDistance).toBeLessThanOrEqual(2.6);
    expect(metrics.jumpServe.apexHeight).toBeGreaterThanOrEqual(0.55);
  });

  it('produces real blocks from the simulation, always off the floor', () => {
    expect(metrics.block.attempts).toBeGreaterThan(0);
    expect(metrics.block.contacts).toBeGreaterThan(0);
    expect(metrics.block.groundedContacts).toBe(0);
    expect(metrics.block.apexHeight).toBeGreaterThanOrEqual(0.45);
  });

  it('forms a visible two-player wall often enough to read as coordinated', () => {
    expect(metrics.block.attacksFaced).toBeGreaterThan(10);
    expect(metrics.block.unopposedAttacks / metrics.block.attacksFaced).toBeLessThanOrEqual(0.35);
    expect(metrics.block.doubleBlockAttacks / metrics.block.attacksFaced).toBeGreaterThanOrEqual(0.3);
  });

  it('passes every acceptance gate the CI job enforces', () => {
    expect(checkGameplayGates(metrics)).toEqual([]);
  });
});
