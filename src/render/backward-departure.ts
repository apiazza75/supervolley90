import type { Playhead } from './sprite-figure';

// Registered in the spikeFollow anatomical unit, not the differently scaled
// backpedal atlas. They are an entry, never part of the repeating gait.
export const BACKWARD_DEPARTURE_FRAMES = [28, 29, 30, 31] as const;
export const BACKWARD_DEPARTURE_DURATION = .12;
interface State { last: Playhead; facing?: -1 | 1; age?: number }

/** Close the authored gap from the completed spike landing to the first
 * defensive step. Touches, turns and airborne motion retain immediate priority. */
export class BackwardDeparture {
  private readonly states = new Map<number, State>();
  reset(id?: number): void {
    if (id === undefined) this.states.clear(); else this.states.delete(id);
  }
  sample(id: number, pose: Playhead, dt: number, allowed: boolean, fallbackFacing?: -1 | 1): { pose: Playhead; pinGait?: boolean } {
    const facing = pose.facing ?? fallbackFacing;
    const previous = this.states.get(id);
    const canStep = allowed && pose.action === 'backpedal' && previous?.facing === facing;
    if (canStep && previous && (previous.age !== undefined || previous.last.action === 'spikeFollow' && previous.last.frame === 22)) {
      // The first drawing gets a full interval, independent of the previous
      // action's clock. Zero-dt repaints cannot advance or restart the entry.
      const age = previous.age === undefined ? 0 : previous.age + Math.max(0, dt);
      const index = Math.floor((age + 1e-9) / BACKWARD_DEPARTURE_DURATION * BACKWARD_DEPARTURE_FRAMES.length);
      if (index < BACKWARD_DEPARTURE_FRAMES.length) {
        const frame = BACKWARD_DEPARTURE_FRAMES[index];
        const entry: Playhead = { ...pose, action: 'spikeFollow', frame, frameFloat: frame };
        this.states.set(id, { last: entry, facing, age });
        return { pose: entry, pinGait: true };
      }
      const first = { ...pose, frame: 0, frameFloat: 0 };
      this.states.set(id, { last: first, facing });
      return { pose: first, pinGait: true };
    }
    this.states.set(id, { last: pose, facing });
    return { pose };
  }
}
