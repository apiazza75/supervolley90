import { Vec3, v3, clamp, approach } from './math3';
import {
  GRAVITY,
  JUMP_VELOCITY,
  LANDING_LOCK,
  PLAYER_ACCEL,
  PLAYER_FRICTION,
  PLAYER_RUN_SPEED,
  Side,
  COURT_HALF_WIDTH,
  COURT_HALF_LENGTH,
  OUT_MARGIN_X,
  OUT_MARGIN_Y,
} from './rules';

export type PlayerRole = 'setter' | 'outside' | 'opposite' | 'middle' | 'libero';

export type PlayerAnim =
  | 'idle'
  | 'run'
  | 'dive'
  | 'jump'
  | 'spike'
  | 'block'
  | 'set'
  | 'bump'
  | 'serve'
  | 'land'
  | 'cheer'
  | 'down'
  | 'getUp';

/** Per-player attributes, 0..1. The AI and the strike solver both read these. */
export interface PlayerStats {
  speed: number;
  jump: number;
  power: number;
  control: number;
  reaction: number;
}

/** Poses that depict a single action and must relax back to idle afterwards. */
const TRANSIENT_ANIMS: readonly PlayerAnim[] = ['spike', 'bump', 'set', 'block', 'land', 'serve'];

export const defaultStats = (): PlayerStats => ({
  speed: 0.6,
  jump: 0.6,
  power: 0.6,
  control: 0.6,
  reaction: 0.6,
});

export class Player {
  readonly id: number;
  readonly side: Side;
  role: PlayerRole;
  stats: PlayerStats;
  name: string;

  pos: Vec3 = v3();
  vel: Vec3 = v3();
  /** Height above the floor and its vertical rate; kept apart from pos.z so
   *  that ground movement and airtime never fight each other. */
  height = 0;
  vertVel = 0;

  /** Rotation slot 1..6, driving the base formation position. */
  rotationSlot = 1;
  /** Where the AI/formation wants this player to stand. */
  home: Vec3 = v3();

  facing = 1; // -1 or +1 along x, for sprite mirroring
  anim: PlayerAnim = 'idle';
  animTime = 0;
  /** Counts down while the player cannot start a new action. */
  lockout = 0;
  /** Counts down while the player is sprawled after a dive or a knockdown. */
  downTime = 0;
  /** Counts down while the player is celebrating a point, set or match. */
  cheerTime = 0;
  /** Set during a dive; adds reach and forward momentum. */
  diving = false;
  /** Seconds of floor slide remaining after a dive lands. */
  sliding = 0;
  /** Seconds left of pushing back up onto the feet after a sprawl. */
  gettingUp = 0;
  /** Non-zero right after a successful hit, used for the arm-swing pose. */
  swing = 0;
  /** Stamina-free arcade "charge" built up while the action button is held. */
  charge = 0;
  /** Previous step's held state, used to detect the release edge. */
  heldAction = false;
  /** Charge captured on the step the button was released (serve power). */
  releasedCharge = 0;
  /**
   * Seconds left on a buffered action press.
   *
   * Without this, a press only counts on the exact step the ball is inside
   * the contact envelope: press a tenth of a second early — which is what
   * good anticipation actually looks like — and the input is swallowed and
   * the ball drops. The buffer keeps an early press armed until the ball
   * arrives, the standard fix in every action game.
   */
  actionBuffer = 0;
  /**
   * Set when the player calls for a Lethal Maneuver in mid-air. It survives
   * until the next contact or landing, so the input can be made a little early
   * without being swallowed.
   */
  specialArmed = false;

  constructor(id: number, side: Side, role: PlayerRole, name: string, stats: PlayerStats) {
    this.id = id;
    this.side = side;
    this.role = role;
    this.name = name;
    this.stats = stats;
  }

  get airborne(): boolean {
    return this.height > 0.02;
  }

  get canAct(): boolean {
    return this.lockout <= 0 && this.downTime <= 0;
  }

  get runSpeed(): number {
    return PLAYER_RUN_SPEED * (0.82 + 0.32 * this.stats.speed);
  }

  get jumpVelocity(): number {
    return JUMP_VELOCITY * (0.85 + 0.3 * this.stats.jump);
  }

  /** Highest point the hands reach right now (floor-relative). */
  reachHeight(baseReach: number): number {
    return this.height + baseReach + (this.diving ? -0.6 : 0);
  }

  jump(): boolean {
    if (!this.canAct || this.airborne) return false;
    this.vertVel = this.jumpVelocity;
    this.height = 0.001;
    this.setAnim('jump');
    return true;
  }

  dive(dirX: number, dirY: number): boolean {
    if (!this.canAct || this.airborne) return false;
    const l = Math.hypot(dirX, dirY) || 1;
    const speed = this.runSpeed * 1.65;
    this.vel.x = (dirX / l) * speed;
    this.vel.y = (dirY / l) * speed;
    this.diving = true;
    this.height = 0.35;
    this.vertVel = 1.1;
    this.downTime = 0.55;
    this.setAnim('dive');
    return true;
  }

  /** Throw the arms up. Purely for show, and it stops the moment play resumes. */
  celebrate(duration: number): void {
    if (this.downTime > 0) return;
    this.cheerTime = Math.max(this.cheerTime, duration);
    this.setAnim('cheer');
  }

  knockDown(duration = 0.85): void {
    this.downTime = Math.max(this.downTime, duration);
    this.diving = false;
    this.sliding = 0.3;
    this.height = 0;
    this.vertVel = 0;
    this.vel.x *= 0.55;
    this.vel.y *= 0.55;
    this.setAnim('down');
  }

  setAnim(a: PlayerAnim): void {
    if (this.anim !== a) {
      this.anim = a;
      this.animTime = 0;
    }
  }

  /**
   * Integrate one step. `moveX`/`moveY` is the desired direction in [-1, 1];
   * it is ignored while airborne, diving or knocked down.
   */
  step(dt: number, moveX: number, moveY: number): void {
    this.animTime += dt;
    if (this.lockout > 0) this.lockout -= dt;
    if (this.swing > 0) this.swing -= dt;

    if (this.cheerTime > 0) {
      this.cheerTime -= dt;
      if (this.cheerTime <= 0 && this.anim === 'cheer') this.setAnim('idle');
      else if (this.anim !== 'cheer') this.cheerTime = 0;
    }

    if (this.gettingUp > 0) {
      this.gettingUp -= dt;
      if (this.gettingUp <= 0 && this.anim === 'getUp') this.setAnim('idle');
    }

    if (this.downTime > 0) {
      this.downTime -= dt;
      moveX = 0;
      moveY = 0;
      if (this.downTime <= 0) {
        this.diving = false;
        // Push up off the floor rather than teleporting to a ready stance.
        // Snapping straight from prone to idle was a single-frame pop at the
        // end of the best animation in the game.
        this.setAnim('getUp');
        this.gettingUp = 0.26;
      }
    }

    // A finished action must not linger: a player who bumped and then stood
    // still used to hold the bump pose indefinitely, which froze the court
    // into a waxwork between touches. The serve pose is held only while the
    // button is, so a charging server is unaffected.
    if (
      !this.airborne &&
      !this.diving &&
      this.downTime <= 0 &&
      this.swing <= 0 &&
      !this.heldAction &&
      this.gettingUp <= 0 &&
      this.animTime > 0.45 &&
      TRANSIENT_ANIMS.includes(this.anim)
    ) {
      this.setAnim('idle');
    }

    const grounded = !this.airborne;
    const controllable = grounded && this.downTime <= 0 && !this.diving;

    if (controllable) {
      const mag = Math.hypot(moveX, moveY);
      if (mag > 0.05) {
        const nx = moveX / Math.max(1, mag);
        const ny = moveY / Math.max(1, mag);
        const target = this.runSpeed;
        this.vel.x = approach(this.vel.x, nx * target, PLAYER_ACCEL * dt);
        this.vel.y = approach(this.vel.y, ny * target, PLAYER_ACCEL * dt);
        // Facing mirrors the figure along the screen's horizontal axis, which
        // is the court's length — so it follows movement along the court, not
        // across it. Using the cross-court axis here was one of the things
        // that made movement look wrong after the camera changed.
        if (Math.abs(ny) > 0.2) this.facing = Math.sign(ny);
        if (
          this.anim !== 'run' &&
          this.swing <= 0 &&
          this.cheerTime <= 0 &&
          !this.heldAction &&
          (this.anim === 'idle' || TRANSIENT_ANIMS.includes(this.anim))
        ) {
          this.setAnim('run');
        }
      } else {
        this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * dt);
        this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * dt);
        if (this.anim === 'run' && this.cheerTime <= 0) this.setAnim('idle');
      }
    } else if (this.diving) {
      this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * 0.55 * dt);
      this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * 0.55 * dt);
    } else if (this.sliding > 0) {
      // Skidding along the floor: friction, but far less than standing on it.
      this.sliding = Math.max(0, this.sliding - dt);
      this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * 0.9 * dt);
      this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * 0.9 * dt);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Vertical motion. Players fall a little faster than the ball, which keeps
    // spike timing windows tight without making the jump feel floaty.
    if (this.height > 0 || this.vertVel !== 0) {
      this.vertVel += GRAVITY * 1.15 * dt;
      this.height += this.vertVel * dt;
      if (this.height <= 0) {
        this.height = 0;
        this.vertVel = 0;
        this.specialArmed = false;
        if (this.diving) {
          // Landing from a dive is a SLIDE, not a stop. Killing the run the
          // instant the body touched the floor made the most spectacular thing
          // in the sport end in a thud; carrying the momentum and bleeding it
          // off against the floor is what makes it read as a dive at all.
          this.diving = false;
          this.sliding = 0.42;
          this.downTime = Math.max(this.downTime, 0.5);
          this.setAnim('down');
        } else {
          this.lockout = Math.max(this.lockout, LANDING_LOCK);
          this.setAnim('land');
        }
      }
    }

    this.clampToArena();
  }

  /** Keep players inside the playable area, and out of the opponent's half. */
  clampToArena(): void {
    const limitX = COURT_HALF_WIDTH + OUT_MARGIN_X;
    const limitY = COURT_HALF_LENGTH + OUT_MARGIN_Y;
    this.pos.x = clamp(this.pos.x, -limitX, limitX);

    // A diving body is laid out flat and is nearly two metres long, so a
    // dive that stops with its feet legally on our side still puts its head
    // and arms in the opponent's court. Diving players are held further back.
    // Nobody stands in the net.
    //
    // 0.12 m was a rule about the centre line — feet may not cross it — but the
    // net is a physical object with a body's width of clearance either side of
    // it, and a player standing 12 cm from it draws straddling the tape. That
    // happened 5% of the time. An airborne blocker may press right up to it,
    // which is exactly what a block is; everyone on the floor keeps clear.
    const near = this.diving || this.downTime > 0 ? 0.85 : this.airborne ? 0.2 : 0.55;
    if (this.side === 'home') {
      this.pos.y = clamp(this.pos.y, -limitY, -near);
    } else {
      this.pos.y = clamp(this.pos.y, near, limitY);
    }
  }
}

/**
 * Base formation offsets by rotation slot, expressed for the home side in
 * metres from the net. Slots follow volleyball numbering: 1 is back-right
 * (the server), then counter-clockwise.
 */
const SLOT_LAYOUT: Record<number, { x: number; y: number }> = {
  // The along-court distances are deliberately staggered within each row: the
  // side-on view collapses court depth to a few pixels, so players standing
  // at the same distance from the net fuse into a single deformed silhouette
  // on screen. Every slot gets its own distance and the whole team stays
  // readable at a glance.
  1: { x: 2.7, y: -5.6 },
  2: { x: 2.7, y: -1.2 },
  3: { x: 0.0, y: -2.1 },
  4: { x: -2.7, y: -3.0 },
  5: { x: -2.7, y: -7.9 },
  6: { x: 0.0, y: -6.7 },
};

/** Formation anchor for a slot on a given side. */
export function slotPosition(slot: number, side: Side): Vec3 {
  const base = SLOT_LAYOUT[((slot - 1) % 6) + 1];
  return side === 'home' ? v3(base.x, base.y, 0) : v3(-base.x, -base.y, 0);
}

/** True for slots 2, 3 and 4 — the front row, allowed to block and spike high. */
export const isFrontRow = (slot: number): boolean => slot === 2 || slot === 3 || slot === 4;
