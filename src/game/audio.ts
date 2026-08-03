import { GameEvent } from '../core/world';

/**
 * Procedural sound. Every effect is synthesised on the fly, so the game ships
 * with no audio assets and no licensing questions, and the whole soundscape
 * stays tweakable from code.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { gain: GainNode; source: AudioBufferSourceNode } | null = null;
  enabled = true;

  /** Must be called from a user gesture — browsers block audio otherwise. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startCrowd();
    }
    void this.ctx.resume();
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Filtered noise loop standing in for arena ambience. */
  private startCrowd(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Brown-ish noise: much closer to a room full of people than white noise.
      last = (last + Math.random() * 2 - 1) * 0.5;
      data[i] = last * 0.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 780;

    const gain = ctx.createGain();
    gain.gain.value = 0.05;

    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    this.crowd = { gain, source };
  }

  /** Swell the crowd, e.g. after a big point. */
  private cheer(amount: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.crowd) return;
    const g = this.crowd.gain.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.min(0.3, 0.05 + amount), now + 0.12);
    g.linearRampToValueAtTime(0.05, now + 1.8);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    sweepTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), now + duration);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /** Short noise burst: the slap of hand on ball. */
  private thud(volume: number, cutoff: number, duration = 0.09): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }

  handle(events: GameEvent[]): void {
    if (!this.enabled) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'contact':
          switch (ev.kind) {
            case 'spike':
              this.thud(0.65, 2600, 0.12);
              this.tone(180, 0.1, 'square', 0.08, 60);
              break;
            case 'block':
              this.thud(0.5, 1500, 0.1);
              break;
            case 'serve':
              this.thud(0.4, 2000);
              break;
            case 'set':
              this.tone(880, 0.05, 'sine', 0.05, 1200);
              break;
            case 'save':
              this.thud(0.35, 900, 0.16);
              break;
            default:
              this.thud(0.3, 1400);
              break;
          }
          break;
        case 'bounce':
          this.thud(Math.min(0.7, 0.15 + ev.speed * 0.02), 700, 0.14);
          break;
        case 'point':
          this.cheer(0.12);
          break;
        case 'setWon':
          this.cheer(0.25);
          this.tone(660, 0.5, 'triangle', 0.12, 990);
          break;
        case 'matchWon':
          this.cheer(0.3);
          this.tone(523, 0.7, 'triangle', 0.14, 1046);
          break;
        case 'whistle':
          this.tone(2100, 0.16, 'sine', 0.07, 2400);
          break;
        default:
          break;
      }
    }
  }
}
