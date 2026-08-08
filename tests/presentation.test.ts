import { describe, expect, it } from 'vitest';

import { checkGameplayGates, measureGameplay } from '../src/qa/gameplay-metrics';

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

  it('spikes off the floor, after a real run-up', () => {
    expect(metrics.spike.count).toBeGreaterThan(0);
    expect(metrics.spike.airborneContact).toBe(true);
    expect(metrics.spike.approachDistance).toBeGreaterThanOrEqual(1.4);
    expect(metrics.spike.apexHeight).toBeGreaterThanOrEqual(0.65);
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

  it('passes every acceptance gate the CI job enforces', () => {
    expect(checkGameplayGates(metrics)).toEqual([]);
  });
});
