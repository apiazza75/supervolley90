import { Side } from '../core/rules';
import { World } from '../core/world';

/**
 * One recorded instant: everything the renderer needs to redraw the court.
 *
 * Deliberately a flat snapshot rather than a reference to the live objects —
 * the simulation keeps mutating those, and a replay that points at them shows
 * the present, not the past.
 */
export interface ReplayFrame {
  ball: { x: number; y: number; z: number; roll: number };
  players: {
    id: number;
    side: Side;
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    height: number;
    vertVel: number;
    anim: string;
    facing: number;
    swing: number;
    charge: number;
    airborne: boolean;
    rotationSlot: number;
  }[];
}

/** Seconds of play kept available, and how fast the replay is played back. */
const WINDOW = 2.0;
const RATE = 40;
const PLAYBACK = 0.7;

/**
 * A rolling two seconds of play, replayed after the points worth seeing again.
 *
 * Recording is cheap: forty small snapshots a second, capped at a fixed
 * window, so memory never grows. Playback drives the renderer directly and any
 * input cuts it short — a replay you cannot skip is a replay you resent.
 */
export class Replay {
  private frames: ReplayFrame[] = [];
  private accum = 0;
  private playhead = 0;
  private playing: ReplayFrame[] | null = null;
  private label = '';

  get isPlaying(): boolean {
    return this.playing !== null;
  }

  get title(): string {
    return this.label;
  }

  clear(): void {
    this.frames.length = 0;
    this.playing = null;
  }

  record(world: World, dt: number): void {
    if (this.playing) return;
    this.accum += dt;
    if (this.accum < 1 / RATE) return;
    this.accum = 0;

    const b = world.ball;
    this.frames.push({
      ball: { x: b.pos.x, y: b.pos.y, z: b.pos.z, roll: b.roll },
      players: world.allPlayers().map((p) => ({
        id: p.id,
        side: p.side,
        pos: { x: p.pos.x, y: p.pos.y, z: 0 },
        vel: { x: p.vel.x, y: p.vel.y, z: 0 },
        height: p.height,
        vertVel: p.vertVel,
        anim: p.anim,
        facing: p.facing,
        swing: p.swing,
        charge: 0,
        airborne: p.airborne,
        rotationSlot: p.rotationSlot,
      })),
    });
    if (this.frames.length > Math.ceil(WINDOW * RATE)) this.frames.shift();
  }

  /** Start replaying everything recorded so far. Ignored if too little exists. */
  start(label: string): boolean {
    if (this.frames.length < RATE * 0.8) return false;
    this.playing = this.frames.slice();
    this.playhead = 0;
    this.label = label;
    return true;
  }

  stop(): void {
    this.playing = null;
    this.frames.length = 0;
  }

  /** Advance playback; returns the frame to draw, or null when it is over. */
  step(dt: number): ReplayFrame | null {
    if (!this.playing) return null;
    this.playhead += dt * RATE * PLAYBACK;
    const i = Math.floor(this.playhead);
    if (i >= this.playing.length) {
      this.stop();
      return null;
    }
    return this.playing[i];
  }
}
