/** Presentation-only, grounded half-turn. Never changes physics or contact facing. */
export const PIVOT_DURATION = .42;
export const PIVOT_INTENT_HOLD = .045;
type Facing = -1 | 1;
interface Heading {
  facing: Facing;
  pendingSeconds: number;
  pendingMoving?: boolean;
  turn?: { from: Facing; to: Facing; elapsed: number; finished: boolean; moving: boolean; ending?: 'run' | 'stop' };
}
export interface FacingSample {
  /** Mirror applied to the art. The authored pivot itself ends facing opposite. */
  facing: Facing;
  /** 0..1 through the independently drawn right -> front -> left strip. */
  turnPhase?: number;
  /** Moving turns have separately drawn steps, not planted pivot feet. */
  movingTurn?: true;
  stoppingTurn?: true;
  /** Successful moving-turn completion only; never emitted on skill interruption. */
  completedMovingTurn?: true;
  completedStoppingTurn?: true;
  /** Planted pivot has returned both feet to its authored ready stance. */
  completedPlantedTurn?: true;
}

export class FacingTransition {
  private readonly headings = new Map<number, Heading>();

  /** The body's committed orientation, not a pending tactical request. */
  facingFor(id: number): Facing | undefined {
    const state = this.headings.get(id);
    return state?.turn?.finished ? state.turn.to : state?.facing;
  }

  reset(id?: number): void {
    if (id === undefined) this.headings.clear();
    else this.headings.delete(id);
  }

  sample(id: number, desired: Facing, dt: number, canPivot: boolean, moving = false): FacingSample {
    let state = this.headings.get(id);
    if (!state) {
      state = { facing: desired, pendingSeconds: 0 };
      this.headings.set(id, state);
    }
    // Serve, contact, dive, attack preparation and flight always win. Do not
    // postpone a skill or draw a standing turn in place of its actual contact.
    if (!canPivot) {
      state.facing = desired; state.pendingSeconds = 0; delete state.pendingMoving; delete state.turn;
      return { facing: desired };
    }
    if (state.turn) {
      const turn = state.turn;
      // The final drawing is still owned by the pivot. A paused repaint must
      // not replace it with a different stance or mirror the sprite sheet.
      if (turn.finished && dt > 0) {
        state.facing = turn.to;
        delete state.turn;
        return { facing: state.facing, ...(turn.ending === 'stop' ? { completedStoppingTurn: true as const }
          : turn.moving ? { completedMovingTurn: true as const } : { completedPlantedTurn: true as const }) };
      }
      turn.elapsed += Math.max(0, dt);
      // The two authored strips share frames 0..11 byte-for-byte. At the
      // first different pose, choose the ending from the actual current gait
      // and latch it: never flicker between two distinct leg drawings.
      if (turn.moving && turn.ending === undefined && turn.elapsed >= PIVOT_DURATION / 2) {
        turn.ending = moving ? 'run' : 'stop';
      }
      turn.finished = turn.elapsed >= PIVOT_DURATION;
      return { facing: turn.from, turnPhase: Math.min(1, turn.elapsed / PIVOT_DURATION),
        ...(turn.moving ? { movingTurn: true as const } : {}),
        ...(turn.ending === 'stop' ? { stoppingTurn: true as const } : {}) };
    }
    if (state.facing === desired) {
      state.pendingSeconds = 0;
      delete state.pendingMoving;
      return { facing: state.facing };
    }
    // Ignore a one-update tactical reversal rather than making an athlete
    // pivot twice around a target. This timer uses real presentation dt, not
    // the shuffle cadence (which is zero when the feet stop).
    state.pendingSeconds += Math.max(0, dt);
    // Remember the incoming gait during the debounce. A decelerating runner
    // must not lose its stepping turn because it slowed before frame zero.
    state.pendingMoving ||= moving;
    if (state.pendingSeconds >= PIVOT_INTENT_HOLD) {
      const movingTurn = !!state.pendingMoving;
      state.turn = { from: state.facing, to: desired, elapsed: 0, finished: false, moving: movingTurn };
      state.pendingSeconds = 0;
      delete state.pendingMoving;
      return { facing: state.facing, turnPhase: 0, ...(movingTurn ? { movingTurn: true as const } : {}) };
    }
    return { facing: state.facing };
  }
}
