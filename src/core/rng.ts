/**
 * Deterministic PRNG (mulberry32).
 *
 * The whole simulation must be reproducible from a seed so that replays,
 * headless tests and (later) netplay all agree frame-by-frame. Never use
 * `Math.random()` inside `src/core`.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Symmetric noise in [-amount, +amount). */
  spread(amount: number): number {
    return this.range(-amount, amount);
  }

  int(lo: number, hiExclusive: number): number {
    return Math.floor(this.range(lo, hiExclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately gaussian (sum of three uniforms), stddev ~= sigma. */
  gauss(sigma = 1): number {
    return ((this.next() + this.next() + this.next()) * 2 - 3) * sigma;
  }

  snapshot(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state >>> 0;
  }
}
