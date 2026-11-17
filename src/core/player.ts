import { Vec3, v3, clamp, approach } from './math3';
import {
  GRAVITY,
  DIVE_INITIAL_HEIGHT,
  DIVE_INITIAL_VELOCITY,
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
  attackDir,
} from './rules';
import {
  type ActionPhase,
  type PresentationJob,
  type PresentationState,
  type VolleyballAction,
  FACING_LOCKED_PHASES,
  SET_GROUND_RECOVERY_TIME,
  BUMP_GROUND_RECOVERY_TIME,
  groundGait,
  initialPresentation,
} from './presentation';

export type PlayerRole = 'setter' | 'outside' | 'opposite' | 'middle' | 'libero';

export type PlayerAnim =
  | 'idle'
  | 'run'
  | 'ready'
  | 'shuffle'
  | 'approach_run'
  | 'plant'
  | 'jump_rise'
  | 'air_contact_spike'
  | 'air_contact_block'
  | 'air_contact_jump_serve'
  | 'follow_through'
  | 'dive'
  | 'dive_contact'
  | 'jump'
  | 'spike'
  | 'block'
  | 'set'
  | 'bump'
  | 'serve'
  | 'land'
  | 'cheer'
  | 'down'
  | 'getUp'
  | 'bump_ready'
  | 'bump_contact'
  | 'set_ready'
  | 'set_contact'
  | 'serve_toss'
  | 'serve_contact';

/** Per-player attributes, 0..1. The AI and the strike solver both read these. */
export interface PlayerStats {
  speed: number;
  jump: number;
  power: number;
  control: number;
  reaction: number;
}

/** Poses that depict a single action and must relax into a ready posture. */
const TRANSIENT_ANIMS: readonly PlayerAnim[] = [
  'spike',
  'block',
  'set',
  'bump',
  'serve',
  'run',
  'land',
  'jump_rise',
  'air_contact_spike',
  'air_contact_block',
  'air_contact_jump_serve',
  'follow_through',
  'bump_ready',
  'bump_contact',
  'set_ready',
  'set_contact',
  'serve_toss',
  'serve_contact',
  'down',
  'getUp',
  'dive_contact',
];

/** Minimum hold time for one-shot / readable action states. */
const TRANSIENT_HOLD: Partial<Record<PlayerAnim, number>> = {
  jump_rise: 0.17,
  serve_toss: 0.22,
  serve_contact: 0.14,
  air_contact_spike: 0.12,
  air_contact_block: 0.14,
  air_contact_jump_serve: 0.14,
  follow_through: 0.22,
  bump_ready: 0.11,
  bump_contact: BUMP_GROUND_RECOVERY_TIME,
  set_ready: 0.1,
  set_contact: SET_GROUND_RECOVERY_TIME,
  land: 0.15,
  down: 0.38,
  getUp: 0.24,
};

/**
 * How each authored pose maps onto the (action, phase) axes.
 *
 * The flat enum stays as the call-site vocabulary — forty sites in the strike
 * solver, the world and the AI already speak it — but it is no longer the
 * authoritative state. Every `setAnim` now also lands the player on an explicit
 * action and phase, which is what the renderer and the invariant tests read.
 */
const ANIM_PRESENTATION: Record<PlayerAnim, { action: VolleyballAction; phase: ActionPhase }> = {
  idle: { action: 'none', phase: 'recover' },
  ready: { action: 'none', phase: 'recover' },
  run: { action: 'none', phase: 'recover' },
  shuffle: { action: 'none', phase: 'recover' },
  approach_run: { action: 'none', phase: 'recover' },
  land: { action: 'none', phase: 'land' },
  plant: { action: 'spike', phase: 'plant' },
  jump_rise: { action: 'spike', phase: 'rise' },
  jump: { action: 'spike', phase: 'rise' },
  spike: { action: 'spike', phase: 'contact' },
  air_contact_spike: { action: 'spike', phase: 'contact' },
  follow_through: { action: 'spike', phase: 'follow' },
  block: { action: 'block', phase: 'rise' },
  air_contact_block: { action: 'block', phase: 'contact' },
  bump_ready: { action: 'bump', phase: 'prepare' },
  bump: { action: 'bump', phase: 'contact' },
  bump_contact: { action: 'bump', phase: 'contact' },
  set_ready: { action: 'set', phase: 'prepare' },
  set: { action: 'set', phase: 'contact' },
  set_contact: { action: 'set', phase: 'contact' },
  serve_toss: { action: 'serve', phase: 'prepare' },
  serve: { action: 'serve', phase: 'contact' },
  serve_contact: { action: 'serve', phase: 'contact' },
  air_contact_jump_serve: { action: 'jumpServe', phase: 'contact' },
  dive: { action: 'dive', phase: 'rise' },
  dive_contact: { action: 'dive', phase: 'contact' },
  down: { action: 'dive', phase: 'land' },
  getUp: { action: 'dive', phase: 'recover' },
  cheer: { action: 'celebrate', phase: 'contact' },
};

/**
 * The longest a single approach may run, in seconds.
 *
 * The brief's readability budget for a whole attack approach plus spike is
 * 1.35–1.65 s, so a run-up that outlives this is no longer a run-up.
 */
const MAX_APPROACH_TIME = 1.45;

/** How long out of the approach before it counts as a new run-up, in seconds. */
const APPROACH_RESET_GAP = 0.3;

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
  /** Last accepted ground steering, for choosing footwork during acceleration.
   * Observational only: never fed back into movement or ball contact.
   */
  locomotionIntent?: { x: number; y: number };
  /** Height above the floor and its vertical rate; kept apart from pos.z so
   *  that ground movement and airtime never fight each other. */
  height = 0;
  vertVel = 0;
  /** Back-row attack eligibility is decided where the feet leave the floor. */
  takeoffY?: number;

  /** Rotation slot 1..6, driving the base formation position. */
  rotationSlot = 1;
  /** Where the AI/formation wants this player to stand. */
  home: Vec3 = v3();

  facing = 1; // -1 or +1 along x, for sprite mirroring
  anim: PlayerAnim = 'idle';
  animTime = 0;

  /**
   * The authoritative animation state, on three independent axes.
   * `anim` remains the call-site vocabulary; this is what gets rendered.
   */
  presentation: PresentationState = initialPresentation();

  /** Grounded anticipation only; never identifies an airborne block or touch. */
  blockPreparationAge?: number;

  /**
   * Seconds of remaining licence to play the attack-approach cycle.
   *
   * An approach is a commitment to hit, not a way of getting somewhere. Nothing
   * in the movement code may set it: only `licenseApproach`, called by the AI or
   * the input layer at the moment the player commits to a spike or jump serve.
   * It expires on its own so a cancelled attack cannot leave a body sprinting.
   */
  approachLicence = 0;
  /**
   * Set by the AI when this server intends a jump serve, so the world can throw
   * the toss out in front of them instead of straight up.
   */
  plansJumpServe = false;
  /** Distance travelled on the floor since the current approach was licensed. */
  approachDistance = 0;
  /** How long the current approach has been running, for the hard cap below. */
  approachAge = 0;
  /** Authored step timing up to the anticipated plant; latched at commitment. */
  approachRunDuration = 0.58;
  /**
   * Ground covered by the run-up that produced the jump currently in progress.
   *
   * Captured at take-off and held: the contact it belongs to happens several
   * tenths of a second later, in the air, by which time the live odometer has
   * already been reset for the next approach.
   */
  lastApproachDistance = 0;
  /** How long this body has been out of the approach cycle, for the reset. */
  private approachIdle = 0;

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
  /** Minimum time an explicit action pose remains readable before fading. */
  animHold = 0;
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
    return this.lockout <= 0 && this.downTime <= 0 && this.gettingUp <= 0;
  }

  /** Feet absorb a jump landing; unlike a dive this is not a floor slide. */
  get landingPlant(): boolean {
    return this.height <= 0 && this.vertVel === 0 && this.anim === 'land';
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
    if (!this.canAct || this.height > 0 || this.vertVel !== 0) return false;
    this.takeoffY = this.pos.y;
    // The run-up ends here; remember how far it actually travelled.
    this.lastApproachDistance = this.approachDistance;
    this.vertVel = this.jumpVelocity;
    this.height = 0.001;
    this.setAnim('jump_rise');
    return true;
  }

  dive(dirX: number, dirY: number): boolean {
    if (!this.canAct || this.height > 0 || this.vertVel !== 0) return false;
    this.takeoffY = undefined;
    const l = Math.hypot(dirX, dirY) || 1;
    const speed = this.runSpeed * 1.65;
    this.vel.x = (dirX / l) * speed;
    this.vel.y = (dirY / l) * speed;
    this.diving = true;
    this.height = DIVE_INITIAL_HEIGHT;
    this.vertVel = DIVE_INITIAL_VELOCITY;
    this.downTime = 0.55;
    // A save may reach towards our own baseline. Do not mirror a backwards
    // dive towards the net while its momentum carries the body the other way.
    if (Math.abs(dirY) > 0.15) this.facing = Math.sign(dirY);
    this.setAnim('dive');
    return true;
  }

  /** Throw the arms up. Purely for show, and it stops the moment play resumes. */
  celebrate(duration: number): void {
    if (this.downTime > 0 || this.gettingUp > 0 || this.diving) return;
    // This strip is a grounded fist-pump. Keep the actual jumping/blocking
    // body until it lands; a point must not put planted-foot art in midair.
    if (this.height > 0) return;
    // A point can be awarded on the same simulation step as a kill. Do not let
    // the celebration erase the hitter's follow-through before a single frame
    // of it has been observable; that is the exact "bare hit pose" complaint.
    if (
      (this.swing > 0 || this.airborne) &&
      (this.anim === 'air_contact_spike' || this.anim === 'follow_through' || this.anim === 'jump_rise')
    ) {
      this.setAnim('follow_through');
      return;
    }
    this.cheerTime = Math.max(this.cheerTime, duration);
    this.setAnim('cheer');
  }

  knockDown(duration = 0.85): void {
    this.downTime = Math.max(this.downTime, duration);
    this.gettingUp = 0;
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
      this.animHold = TRANSIENT_HOLD[a] ?? 0;
    }
    this.syncPresentation(a);
  }

  /**
   * Keep the action/phase axes in step with the pose, and pin the facing while
   * the feet are committed.
   *
   * The court is viewed side-on with the net at y = 0, so "towards the ball"
   * and "towards the net" are the same direction for attacking skills:
   * `attackDir(side)`. A diving save instead preserves its actual direction.
   * Locking there during the committed phases
   * is what stops a player who was backpedalling from meeting the ball with
   * their back to the net.
   */
  private syncPresentation(a: PlayerAnim): void {
    let mapped = ANIM_PRESENTATION[a] ?? { action: 'none' as const, phase: 'recover' as const };
    const pr = this.presentation;
    // Keep the jumping action for the short landing recovery. Otherwise
    // landing changed the action to `none` and discarded the drawn knee bend.
    if (a === 'land' && (pr.action === 'block' || pr.action === 'spike' || pr.action === 'jumpServe')) {
      mapped = { action: pr.action, phase: 'land' };
    }
    // The plant and rise poses are shared artwork, but a server running into a
    // toss is executing a jump serve, not a spike. Keeping that identity here
    // lets the renderer play the correct sequence before the contact event.
    if (pr.sourceJob === 'serve' && (a === 'plant' || a === 'jump_rise' || a === 'jump')) {
      mapped = { action: 'jumpServe', phase: a === 'plant' ? 'plant' : 'rise' };
    }
    if (pr.action !== mapped.action) {
      pr.startedAt = 0;
      pr.contactAt = undefined;
    }
    pr.action = mapped.action;
    pr.phase = mapped.phase;
    if (mapped.phase === 'contact' && pr.contactAt === undefined) pr.contactAt = pr.startedAt;

    if (mapped.action === 'dive') {
      // Keep the whole slide and get-up on the same side of the silhouette.
      pr.lockedFacing = this.facing >= 0 ? 1 : -1;
    } else if (mapped.action !== 'none' && mapped.action !== 'celebrate' && FACING_LOCKED_PHASES.has(mapped.phase)) {
      pr.lockedFacing = attackDir(this.side) as -1 | 1;
      this.facing = pr.lockedFacing;
    } else {
      pr.lockedFacing = undefined;
    }
  }

  /**
   * Commit this player to an attack approach for a bounded window.
   *
   * This is the only way `approach` locomotion can be reached. `duration` is
   * the window in which the run-up must happen; past it the body drops back to
   * ordinary locomotion whether or not the attack came off.
   */
  licenseApproach(job: PresentationJob, duration = 1.1, runDuration?: number): void {
    // Only a *new* run-up resets the odometer. The AI renews the licence every
    // step while the window is open, so zeroing it unconditionally meant the
    // measured approach distance was always the last frame's worth of travel.
    // A spent approach cannot be renewed until the body has stopped running it.
    if (this.approachAge > MAX_APPROACH_TIME) return;
    // Renewing the licence must not restart or retime the visible steps. The
    // first attack read supplies the expected plant deadline, not a new jump.
    if (this.approachAge === 0 && this.approachLicence <= 0) {
      this.approachRunDuration = runDuration !== undefined && Number.isFinite(runDuration)
        ? Math.max(0.18, Math.min(0.58, runDuration)) : 0.58;
    }
    this.approachLicence = Math.max(this.approachLicence, duration);
    this.presentation.sourceJob = job;
  }

  /** Drop an attack approach that is no longer wanted. */
  cancelApproach(): void {
    this.approachLicence = 0;
  }

  /** True while this body is entitled to play the attack-approach cycle. */
  get approaching(): boolean {
    return this.approachLicence > 0;
  }

  /**
   * Derive the locomotion axis from how fast the body is actually moving.
   *
   * This is the rule the old code got wrong. Locomotion is an *observation* of
   * the body, not an instruction: a player crossing the court at speed runs, a
   * player adjusting their feet shuffles, and neither of them may borrow the
   * attack approach. Only a licence granted by the AI unlocks `approach`.
   */
  private runGaitAge = 0;

  private updateLocomotion(dt: number): void {
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const pr = this.presentation;

    const next = groundGait(speed, pr.locomotion, this.runGaitAge, dt, !this.airborne && this.approaching);
    const loco = next.locomotion;
    this.runGaitAge = next.runAge;
    pr.locomotion = loco;

    // A skill in progress owns the body; locomotion must not repaint the pose
    // underneath it, or the run cycle eats the contact.
    if (pr.action !== 'none' && FACING_LOCKED_PHASES.has(pr.phase)) return;
    if (
      this.swing > 0 ||
      this.cheerTime > 0 ||
      this.heldAction ||
      this.anim === 'land' ||
      this.anim === 'getUp' ||
      this.anim === 'dive' ||
      this.anim === 'dive_contact'
    ) {
      return;
    }

    const wanted: PlayerAnim =
      loco === 'approach'
        ? 'approach_run'
        : loco === 'run'
          ? 'run'
          : loco === 'shuffle' || loco === 'walk'
            ? 'shuffle'
            : 'ready';
    if (wanted === 'ready') return; // handled by the settle path, which respects holds
    if (this.anim !== wanted) this.setAnim(wanted);
  }

  private canSettle(): boolean {
    if (!this.canAct) return false;
    // `airborne` has a 2cm tolerance for contact rules, but presentation must
    // wait for actual floor contact. Settling in that last 2cm erased the
    // landing action; jumping there also bypassed the landing lock entirely.
    if (this.height > 0 || this.vertVel !== 0) return false;
    if (this.downTime > 0 || this.gettingUp > 0 || this.diving || this.airborne) return false;
    if (this.animHold > 0) return false;
    return true;
  }

  private shouldGoIdle(): boolean {
    // Match the existing landing lock, not the generic gesture timeout. Keeping
    // land art for .26 s let locomotion restart beneath planted feet at .16 s.
    const duration = this.anim === 'land' ? LANDING_LOCK : 0.26;
    return this.canSettle() && this.animTime >= duration && TRANSIENT_ANIMS.includes(this.anim);
  }

  /**
   * Integrate one step. `moveX`/`moveY` is the desired direction in [-1, 1];
   * it is ignored while airborne, diving, knocked down or getting up.
   */
  step(dt: number, moveX: number, moveY: number): void {
    this.animTime += dt;
    this.presentation.startedAt += dt;
    if (this.animHold > 0) this.animHold = Math.max(0, this.animHold - dt);
    if (this.lockout > 0) this.lockout -= dt;
    if (this.swing > 0) this.swing -= dt;
    // A spike is not over at contact.  The previous state machine had a
    // `follow_through` pose, but an airborne spike contact held until landing
    // and the landing code immediately overwrote it with `land`, so the swing
    // read as a single hit frame followed by feet-on-floor recovery.  Once the
    // authored contact pose has been held, let the arm and torso finish the
    // swing while the body is still descending.
    if (
      this.airborne &&
      this.anim === 'air_contact_spike' &&
      this.animHold <= 0 &&
      this.swing > 0
    ) {
      this.setAnim('follow_through');
    }
    if (this.approachLicence > 0) {
      this.approachLicence = Math.max(0, this.approachLicence - dt);
      this.approachAge += dt;
      this.approachIdle = 0;
      this.approachDistance += Math.hypot(this.vel.x, this.vel.y) * dt;
      // A hard ceiling on the run-up. The AI renews the licence every step
      // while its window is open, so without this a hitter whose set never
      // arrives keeps sprinting indefinitely — the original bug, arrived at by
      // a different road.
      if (this.approachAge > MAX_APPROACH_TIME) this.approachLicence = 0;
    } else {
      // The odometer survives a brief gap in the licence so one run-up is
      // measured as one run-up, but a body that has genuinely stopped
      // approaching starts fresh — and only then may it be licensed again.
      this.approachIdle += dt;
      if (this.approachIdle > APPROACH_RESET_GAP) {
        this.approachAge = 0;
        this.approachDistance = 0;
        this.approachRunDuration = 0.58;
      }
    }

    if (this.cheerTime > 0) {
      this.cheerTime -= dt;
      if (this.cheerTime <= 0 && this.anim === 'cheer') this.setAnim('idle');
      else if (this.anim !== 'cheer') this.cheerTime = 0;
    }

    if (this.gettingUp > 0) {
      this.gettingUp = Math.max(0, this.gettingUp - dt);
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

    // A finished action must not linger and must not force the body into a
    // constant run cycle between touches.
    if (this.shouldGoIdle() && (this.anim === 'land' || this.swing <= 0 && !this.heldAction)) {
      this.setAnim('ready');
    }

    const grounded = this.height <= 0 && this.vertVel === 0;
    const plantedLanding = this.landingPlant;
    const controllable = grounded && !plantedLanding && this.downTime <= 0 && this.gettingUp <= 0 && !this.diving;
    if (plantedLanding) { this.vel.x = 0; this.vel.y = 0; }

    this.locomotionIntent ??= { x: 0, y: 0 };
    this.locomotionIntent.x = controllable ? moveX : 0;
    this.locomotionIntent.y = controllable ? moveY : 0;

    if (controllable) {
      const mag = Math.hypot(moveX, moveY);
      if (mag > 0.05) {
        const nx = moveX / Math.max(1, mag);
        const ny = moveY / Math.max(1, mag);
        // An approach is a run-up to hit the ball; it is also the only time a
        // player is entitled to sprint. Everything else — covering, shading
        // across, resetting into formation — tops out below it.
        const target = this.approaching ? this.runSpeed : this.runSpeed * 0.9;
        this.vel.x = approach(this.vel.x, nx * target, PLAYER_ACCEL * dt);
        this.vel.y = approach(this.vel.y, ny * target, PLAYER_ACCEL * dt);
        // Facing mirrors the figure along the court's dominant axis, but never
        // while the feet are committed to a skill: that is what let a
        // backpedalling player arrive at the ball facing away from the net.
        if (this.presentation.lockedFacing === undefined && Math.abs(ny) > 0.2) {
          this.facing = Math.sign(ny);
        }
        this.updateLocomotion(dt);
      } else {
        this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * dt);
        this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * dt);
        this.updateLocomotion(dt);
        if (
          this.canSettle() &&
          (this.anim === 'approach_run' || this.anim === 'shuffle' || this.anim === 'run') &&
          this.cheerTime <= 0
        ) {
          this.setAnim('ready');
        }
      }
    } else {
      // Airborne, diving or knocked down: the feet are not driving the body, so
      // it is not travelling under its own power. Leaving the last locomotion
      // latched here kept a jumping hitter reading as "approaching" for the
      // whole flight, which is neither true nor harmless — it is what the
      // concurrency and duration limits are measured against.
      this.presentation.locomotion = 'stand';
      this.runGaitAge = 0;

      if (this.diving) {
        this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * 0.55 * dt);
        this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * 0.55 * dt);
      } else if (this.sliding > 0) {
        // Skidding along the floor: friction, but far less than standing on it.
        this.sliding = Math.max(0, this.sliding - dt);
        this.vel.x = approach(this.vel.x, 0, PLAYER_FRICTION * 0.9 * dt);
        this.vel.y = approach(this.vel.y, 0, PLAYER_FRICTION * 0.9 * dt);
      }
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
      if (this.anim === 'jump_rise' && this.swing > 0) this.setAnim('follow_through');
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
          // The airborne follow-through has already followed physical flight.
          // Floor contact starts the drawn knee compression even after a late
          // strike, with momentum absorbed at the actual landing position.
          this.vel.x = 0; this.vel.y = 0;
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
    const near = this.diving || this.downTime > 0 || this.gettingUp > 0 ? 0.85 : this.airborne ? 0.2 : 0.55;
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
