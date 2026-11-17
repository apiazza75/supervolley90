import { clamp } from '../core/math3';
import { idleCommand, type Command } from '../core/world';
import { attackDir, type Side } from '../core/rules';

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

/** Separate layouts let both people share a keyboard without crossing actions. */
export const LOCAL_HOME_BINDINGS: Bindings = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  action: ['KeyF'], jump: ['KeyG'], pause: ['Escape', 'KeyP'],
};

export const LOCAL_AWAY_BINDINGS: Bindings = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  action: ['KeyK'], jump: ['KeyL'], pause: ['Escape'],
};

export type VirtualButton = 'action' | 'jump' | 'pause';
export interface InputOptions {
  side?: Side;
  /** A browser gamepad index is an explicit assignment; auto picks the first connected pad. */
  gamepad?: number | 'auto' | null;
  keyboard?: boolean;
  bindings?: Bindings;
}

const GAMEPAD_DEADZONE = 0.18;

export interface ConnectedGamepad {
  index: number;
  id: string;
}

export class InputManager {
  private readonly held = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private bindings: Bindings;
  private side: Side = 'home';
  private gamepadAssignment: number | 'auto' | null = 'auto';
  private keyboardEnabled = true;
  private suspended = false;
  private padNeedsNeutral = false;
  private lastPadIdentity: string | null = null;
  private hasSeenPad = false;
  private readonly removeListeners: Array<() => void> = [];
  private readonly virtualHeld = new Set<VirtualButton>();
  private readonly virtualTapped = new Set<VirtualButton>();
  private virtualDirection = { x: 0, y: 0 };

  /** Edge and level state for the two action buttons, resolved once per frame. */
  private prevAction = false;
  private prevJump = false;
  private prevPause = false;
  private actionEdge = false;
  private actionActive = false;
  private jumpEdge = false;
  private pauseEdge = false;
  /** Match edges survive display frames until a fixed simulation step consumes them. */
  private pendingActionEdge = false;
  private pendingJumpEdge = false;

  constructor(
    bindings: Bindings = DEFAULT_BINDINGS,
    target: EventTarget = window,
    options: InputOptions = {},
  ) {
    this.bindings = options.bindings ?? bindings;
    this.side = options.side ?? 'home';
    this.gamepadAssignment = options.gamepad === undefined ? 'auto' : options.gamepad;
    this.keyboardEnabled = options.keyboard ?? true;
    this.listen(target, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (!this.keyboardEnabled || this.suspended || this.isEditable(ev.target) || !this.isBound(ev.code)) return;
      ev.preventDefault();
      if (ev.repeat) return;
      this.held.add(ev.code);
      this.pressedThisFrame.add(ev.code);
    });
    this.listen(target, 'keyup', (e) => {
      const ev = e as KeyboardEvent;
      this.held.delete(ev.code);
      if (this.keyboardEnabled && !this.isEditable(ev.target) && this.isBound(ev.code)) ev.preventDefault();
    });
    this.listen(window, 'blur', () => {
      this.suspended = true;
      this.reset();
    });
    this.listen(window, 'focus', () => { this.suspended = false; });
    if (typeof document !== 'undefined') {
      this.listen(document, 'visibilitychange', () => {
        this.suspended = document.hidden;
        if (this.suspended) this.reset();
      });
    }
    this.listen(window, 'gamepaddisconnected', (e) => {
      const index = (e as GamepadEvent).gamepad?.index;
      if (this.gamepadAssignment === 'auto' || index === this.gamepadAssignment) {
        // A reconnect must not repeat the button that was held on disconnect.
        this.padNeedsNeutral = true;
      }
    });
  }

  /** Change player/control assignments at a screen boundary. */
  configure(options: InputOptions): void {
    const changed = (options.bindings !== undefined && options.bindings !== this.bindings) ||
      (options.side !== undefined && options.side !== this.side) ||
      (options.gamepad !== undefined && options.gamepad !== this.gamepadAssignment) ||
      (options.keyboard !== undefined && options.keyboard !== this.keyboardEnabled);
    if (!changed) return;
    if (options.bindings !== undefined) this.bindings = options.bindings;
    if (options.side !== undefined) this.side = options.side;
    if (options.gamepad !== undefined) this.gamepadAssignment = options.gamepad;
    if (options.keyboard !== undefined) this.keyboardEnabled = options.keyboard;
    this.reset();
  }

  /** Includes pads connected before this manager or match was created. */
  static connectedGamepads(): ConnectedGamepad[] {
    return InputManager.gamepads().map(({ index, id }) => ({ index, id }));
  }

  private static gamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    try {
      return Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => !!pad && pad.connected !== false);
    } catch {
      // Browser privacy/permissions can disable gamepads; keyboard and touch remain available.
      return [];
    }
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.removeListeners.push(() => target.removeEventListener(type, listener));
  }

  private isEditable(target: EventTarget | null): boolean {
    return typeof Element !== 'undefined' && target instanceof Element &&
      !!target.closest('input, textarea, select, button, [contenteditable="true"], [role="button"]');
  }

  dispose(): void {
    this.removeListeners.splice(0).forEach((remove) => remove());
    this.reset();
    this.suspended = true;
  }

  /** Touch uses the same command buffer and held levels as physical controls. */
  setVirtualButton(button: VirtualButton, down: boolean): void {
    if (this.suspended) return;
    if (down) {
      if (!this.virtualHeld.has(button)) this.virtualTapped.add(button);
      this.virtualHeld.add(button);
    } else {
      this.virtualHeld.delete(button);
    }
  }

  setVirtualDirection(x: number, y: number): void {
    if (this.suspended) return;
    const magnitude = Math.max(1, Math.hypot(x, y));
    this.virtualDirection = { x: x / magnitude, y: y / magnitude };
  }

  clearVirtualControls(): void {
    this.virtualHeld.clear();
    this.virtualTapped.clear();
    this.virtualDirection = { x: 0, y: 0 };
  }

  /**
   * QA-only input boundary.
   *
   * Playwright on macOS can lose synthetic keyboard events when Chromium is
   * headless or unfocused.  Visual QA still needs to exercise the same input
   * path without writing player/world state, so this feeds exactly the same
   * sets the keydown listener feeds.  `poll()`, `command()` and `World.step()`
   * remain unchanged.
   */
  pressForQa(code: string): void {
    this.held.add(code);
    this.pressedThisFrame.add(code);
  }

  releaseForQa(code: string): void {
    this.held.delete(code);
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((list) => list.includes(code));
  }

  private anyHeld(codes: string[]): boolean {
    return this.keyboardEnabled && codes.some((c) => this.held.has(c));
  }

  private pad(): Gamepad | null {
    if (this.gamepadAssignment === null) return null;
    const pads = InputManager.gamepads();
    return this.gamepadAssignment === 'auto'
      ? pads[0] ?? null
      : pads.find((pad) => pad.index === this.gamepadAssignment) ?? null;
  }

  private activePad(): Gamepad | null {
    const pad = this.pad();
    if (!pad) {
      if (this.lastPadIdentity !== null) this.padNeedsNeutral = true;
      this.lastPadIdentity = null;
      return null;
    }
    const identity = `${pad.index}:${pad.id}`;
    if (this.hasSeenPad && this.lastPadIdentity !== identity) this.padNeedsNeutral = true;
    this.hasSeenPad = true;
    this.lastPadIdentity = identity;
    if (this.suspended) return null;
    if (this.padNeedsNeutral) {
      const active = pad.buttons.some((button) => button.pressed) ||
        pad.axes.slice(0, 2).some((axis) => Math.abs(axis) > GAMEPAD_DEADZONE);
      if (active) return null;
      this.padNeedsNeutral = false;
    }
    return pad;
  }

  private anyTapped(codes: string[]): boolean {
    return this.keyboardEnabled && codes.some((c) => this.pressedThisFrame.has(c));
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
    const pad = this.activePad();
    const padAction = pad ? pad.buttons[0]?.pressed || pad.buttons[2]?.pressed : false;
    const padJump = pad ? pad.buttons[1]?.pressed || pad.buttons[3]?.pressed : false;
    const padPause = pad ? pad.buttons[9]?.pressed : false;

    const actionTap = this.anyTapped(this.bindings.action) || this.virtualTapped.has('action');
    const jumpTap = this.anyTapped(this.bindings.jump) || this.virtualTapped.has('jump');
    const pauseTap = this.anyTapped(this.bindings.pause) || this.virtualTapped.has('pause');

    const action = this.anyHeld(this.bindings.action) || !!padAction || this.virtualHeld.has('action');
    const jump = this.anyHeld(this.bindings.jump) || !!padJump || this.virtualHeld.has('jump');
    const pause = this.anyHeld(this.bindings.pause) || !!padPause || this.virtualHeld.has('pause');

    this.actionEdge = (action && !this.prevAction) || actionTap;
    this.actionActive = action || actionTap;
    this.jumpEdge = (jump && !this.prevJump) || jumpTap;
    this.pauseEdge = (pause && !this.prevPause) || pauseTap;
    this.pendingActionEdge ||= this.actionEdge;
    this.pendingJumpEdge ||= this.jumpEdge;

    this.prevAction = action;
    this.prevJump = jump;
    this.prevPause = pause;
    this.pressedThisFrame.clear();
    this.virtualTapped.clear();
  }

  /** True on the frame the action button went down, tap-safe. */
  get actionPressed(): boolean {
    return this.actionEdge;
  }

  /** True on the frame the jump button went down. */
  get jumpPressed(): boolean {
    return this.jumpEdge;
  }

  get pausePressed(): boolean {
    return this.pauseEdge;
  }

  /** Call after a real World.step, or when intentionally swallowing screen input. */
  consumeCommandEdges(): void {
    this.pendingActionEdge = false;
    this.pendingJumpEdge = false;
  }

  /** Drop held and edge state when changing screens, so a confirm press cannot leak into play. */
  reset(): void {
    this.padNeedsNeutral = true;
    this.clearVirtualControls();
    this.held.clear();
    this.pressedThisFrame.clear();
    this.prevAction = false;
    this.prevJump = false;
    this.prevPause = false;
    this.actionEdge = false;
    this.actionActive = false;
    this.jumpEdge = false;
    this.pauseEdge = false;
    this.consumeCommandEdges();
  }

  /** Raw input direction in screen axes: x is right-positive, y up-positive. */
  direction(): { x: number; y: number } {
    let { x, y } = this.virtualDirection;
    if (this.anyHeld(this.bindings.left)) x -= 1;
    if (this.anyHeld(this.bindings.right)) x += 1;
    if (this.anyHeld(this.bindings.up)) y += 1;
    if (this.anyHeld(this.bindings.down)) y -= 1;

    const pad = this.activePad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const magnitude = Math.hypot(ax, ay);
      if (magnitude > GAMEPAD_DEADZONE) {
        // A radial dead zone avoids snapping from no motion to quarter speed.
        const strength = Math.min(1, (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));
        x += ax / magnitude * strength;
        y -= ay / magnitude * strength;
      }
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
   * opponent's court, left is short over the net (reversed for away), and up/down pick the far or
   * near sideline. Where you are pushing when you strike is where the ball
   * goes, in screen terms.
   */
  command(locked = false): Command {
    // A screen-transition lock means a human doing nothing, not surrendering
    // control to the AI (World.step(null)). In particular the AI must not
    // preselect a jump serve while the menu-confirm key is being swallowed.
    if (locked) return idleCommand();
    const dir = this.direction();
    const action = this.actionActive;

    return {
      moveX: dir.y,
      moveY: dir.x,
      // A press is an EDGE, never "the button happens to be down". Reporting a
      // held button as a fresh press meant the serve struck itself the instant
      // its window opened — you could toss, but never jump and then hit.
      actionPressed: this.pendingActionEdge,
      actionHeld: action,
      jumpPressed: this.pendingJumpEdge,
      aim: {
        // Lateral aim across the court: up is the far sideline.
        x: clamp(dir.y, -1, 1),
        // Depth along the attack. Neutral stick aims at a sensible depth
        // rather than at the net.
        depth: Math.abs(dir.x) < 0.15 ? 0.4 : clamp(dir.x * attackDir(this.side), -1, 1),
      },
    };
  }

  get activeGamepadIndex(): number | null {
    return this.pad()?.index ?? null;
  }

  /** True while this player's assigned gamepad is connected. */
  get hasGamepad(): boolean {
    return this.pad() !== null;
  }
}
