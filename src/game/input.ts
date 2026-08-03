import { clamp } from '../core/math3';
import { Command } from '../core/world';

/**
 * Keyboard and gamepad input, reduced to the two-button scheme the arcade
 * cabinets used: one button for everything you do with the ball, one for
 * jumping. Everything else is direction plus timing.
 */
export interface Bindings {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  action: string[];
  jump: string[];
  pause: string[];
}

export const DEFAULT_BINDINGS: Bindings = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  action: ['Space', 'KeyJ'],
  jump: ['ShiftLeft', 'ShiftRight', 'KeyK'],
  pause: ['Escape', 'KeyP'],
};

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private gamepadIndex: number | null = null;

  /** Edge and level state for the two action buttons, resolved once per frame. */
  private prevAction = false;
  private prevJump = false;
  private prevPause = false;
  private actionEdge = false;
  private actionActive = false;
  private jumpEdge = false;
  private pauseEdge = false;

  constructor(
    private readonly bindings: Bindings = DEFAULT_BINDINGS,
    target: EventTarget = window,
  ) {
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      this.held.add(ev.code);
      this.pressedThisFrame.add(ev.code);
      if (this.isBound(ev.code)) ev.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const ev = e as KeyboardEvent;
      this.held.delete(ev.code);
      if (this.isBound(ev.code)) ev.preventDefault();
    });
    // Losing focus must release everything, or the player runs into a wall
    // forever after tabbing away.
    window.addEventListener('blur', () => this.held.clear());

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((list) => list.includes(code));
  }

  private anyHeld(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private pad(): Gamepad | null {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] ?? null;
  }

  private anyTapped(codes: string[]): boolean {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  /**
   * Call once per frame, before reading `command()`.
   *
   * A key that goes down and back up between two frames would be invisible to
   * plain level polling, so taps recorded by the keydown handler are folded in
   * here. That matters for genuinely quick inputs — and it is exactly what a
   * tip shot is.
   */
  poll(): void {
    const pad = this.pad();
    const padAction = pad ? pad.buttons[0]?.pressed || pad.buttons[2]?.pressed : false;
    const padJump = pad ? pad.buttons[1]?.pressed || pad.buttons[3]?.pressed : false;
    const padPause = pad ? pad.buttons[9]?.pressed : false;

    const actionTap = this.anyTapped(this.bindings.action);
    const jumpTap = this.anyTapped(this.bindings.jump);
    const pauseTap = this.anyTapped(this.bindings.pause);

    const action = this.anyHeld(this.bindings.action) || !!padAction;
    const jump = this.anyHeld(this.bindings.jump) || !!padJump;
    const pause = this.anyHeld(this.bindings.pause) || !!padPause;

    this.actionEdge = (action && !this.prevAction) || actionTap;
    this.actionActive = action || actionTap;
    this.jumpEdge = (jump && !this.prevJump) || jumpTap;
    this.pauseEdge = (pause && !this.prevPause) || pauseTap;

    this.prevAction = action;
    this.prevJump = jump;
    this.prevPause = pause;
    this.pressedThisFrame.clear();
  }

  /** True on the frame the action button went down, tap-safe. */
  get actionPressed(): boolean {
    return this.actionEdge;
  }

  get pausePressed(): boolean {
    return this.pauseEdge;
  }

  /** Raw input direction in screen axes: x is right-positive, y up-positive. */
  direction(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.anyHeld(this.bindings.left)) x -= 1;
    if (this.anyHeld(this.bindings.right)) x += 1;
    if (this.anyHeld(this.bindings.up)) y += 1;
    if (this.anyHeld(this.bindings.down)) y -= 1;

    const pad = this.pad();
    if (pad) {
      const dead = 0.22;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > dead) x += ax;
      if (Math.abs(ay) > dead) y -= ay;
      if (pad.buttons[14]?.pressed) x -= 1;
      if (pad.buttons[15]?.pressed) x += 1;
      if (pad.buttons[12]?.pressed) y += 1;
      if (pad.buttons[13]?.pressed) y -= 1;
    }

    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    return { x, y };
  }

  /**
   * Build the command for this frame.
   *
   * The screen is a side elevation: left/right runs along the court, up/down
   * steps across it. World axes are the other way round — x is court width,
   * y is court length — so screen x feeds moveY and screen y feeds moveX.
   *
   * This mapping is what silently rotated 90 degrees when the camera changed
   * from behind-the-court to side-on: the simulation stayed correct, the
   * renderer stayed correct, and the controls stopped matching the picture.
   * `tools/input-e2e.ts` now drives the real game and asserts each arrow key
   * moves the player the way the screen implies, so it cannot happen again.
   *
   * The same stick aims: for the left-side team, right is deep into the
   * opponent's court, left is short over the net, and up/down pick the far or
   * near sideline. Where you are pushing when you strike is where the ball
   * goes, in screen terms.
   */
  command(): Command {
    const dir = this.direction();
    const action = this.actionActive;

    return {
      moveX: dir.y,
      moveY: dir.x,
      actionPressed: this.actionEdge || action,
      actionHeld: action,
      jumpPressed: this.jumpEdge,
      aim: {
        // Lateral aim across the court: up is the far sideline.
        x: clamp(dir.y, -1, 1),
        // Depth along the attack. Neutral stick aims at a sensible depth
        // rather than at the net.
        depth: Math.abs(dir.x) < 0.15 ? 0.4 : clamp(dir.x, -1, 1),
      },
    };
  }

  /** True while a gamepad is connected, so the HUD can show the right prompts. */
  get hasGamepad(): boolean {
    return this.pad() !== null;
  }
}
