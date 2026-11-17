import type { Player } from '../core/player';
import type { SpriteAction } from '../render/sprites';

/** The authored drawing actually painted, not a newly inferred animation. */
export interface ReplayPose { action: SpriteAction; frame: number; facing: number; renderedHeight?: number }

export function captureReplayPlayer(p: Player, sprite: ReplayPose) {
  return {
    id: p.id, side: p.side, role: p.role,
    pos: { x: p.pos.x, y: p.pos.y, z: 0 },
    vel: { x: p.vel.x, y: p.vel.y, z: 0 },
    height: sprite.renderedHeight ?? p.height, vertVel: p.vertVel, anim: p.anim,
    facing: sprite.facing, swing: p.swing, charge: 0,
    airborne: p.airborne, rotationSlot: p.rotationSlot,
    sprite: { action: sprite.action, frame: sprite.frame, facing: sprite.facing },
  };
}

/** Detached snapshot of the interpolated live view, captured after painting. */
export interface ReplayFrame {
  ball: { x: number; y: number; z: number; roll: number };
  players: ReturnType<typeof captureReplayPlayer>[];
}

export const INTRO = 0.25;
const WINDOW = 1.6;
const PLAYBACK = 0.8;
type Sample = { time: number; frame: ReplayFrame };
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

/** Interpolate body anchors, never blend two silhouettes or anticipate a pose. */
export function interpolateReplay(a: ReplayFrame, b: ReplayFrame, u: number): ReplayFrame {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const next = new Map(b.players.map(p => [p.id, p]));
  return {
    ball: {
      x: mix(a.ball.x, b.ball.x, u), y: mix(a.ball.y, b.ball.y, u),
      z: mix(a.ball.z, b.ball.z, u), roll: mix(a.ball.roll, b.ball.roll, u),
    },
    players: a.players.map(p => {
      const q = next.get(p.id);
      // Substitutions and point resets are cuts, not journeys across the court.
      if (!q || Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) > 1) return p;
      return { ...p,
        pos: { x: mix(p.pos.x, q.pos.x, u), y: mix(p.pos.y, q.pos.y, u), z: 0 },
        height: mix(p.height, q.height, u), vertVel: mix(p.vertVel, q.vertVel, u),
        vel: { x: mix(p.vel.x, q.vel.x, u), y: mix(p.vel.y, q.vel.y, u), z: 0 },
      };
    }),
  };
}

/** Timestamped display samples: no 40 Hz quantisation or independent pose clock. */
export class Replay {
  private frames: Sample[] = [];
  private clock = 0;
  private cursor = 0;
  private playing: Sample[] | null = null;
  private label = '';
  private elapsed = 0;

  get age() { return this.elapsed; }
  get isPlaying() { return this.playing !== null; }
  get title() { return this.label; }

  clear(): void {
    this.frames = []; this.playing = null;
    this.clock = 0; this.cursor = 0; this.elapsed = 0;
  }

  record(frame: ReplayFrame, dt: number): void {
    if (this.playing || dt <= 0 || !Number.isFinite(dt)) return;
    this.clock += dt;
    // Protect recordings even if a caller reuses its arrays on the next paint.
    this.frames.push({ time: this.clock, frame: {
      ball: { ...frame.ball },
      players: frame.players.map(p => ({ ...p, pos: { ...p.pos }, vel: { ...p.vel }, sprite: { ...p.sprite } })),
    } });
    // Retain one bracketing sample; also bound memory at exotic refresh rates.
    while (this.frames.length > 2 && (this.frames[1].time < this.clock - WINDOW || this.frames.length > 2048)) this.frames.shift();
  }

  start(label: string): boolean {
    if (this.playing || this.frames.length < 2 || this.frames.at(-1)!.time - this.frames[0].time < 0.8) return false;
    this.playing = this.frames.slice();
    this.cursor = 0; this.elapsed = 0; this.label = label;
    return true;
  }

  stop(): void { this.clear(); }

  step(dt: number): ReplayFrame | null {
    if (!this.playing) return null;
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const time = this.playing[0].time + Math.max(0, this.elapsed - INTRO) * PLAYBACK;
    if (time > this.playing.at(-1)!.time) { this.stop(); return null; }
    while (this.cursor + 1 < this.playing.length && this.playing[this.cursor + 1].time <= time) this.cursor++;
    const a = this.playing[this.cursor], b = this.playing[this.cursor + 1];
    return b ? interpolateReplay(a.frame, b.frame, (time - a.time) / (b.time - a.time)) : a.frame;
  }
}
