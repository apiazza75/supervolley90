import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager, LOCAL_AWAY_BINDINGS, LOCAL_HOME_BINDINGS } from '../src/game/input';
import { touchStickDirection } from '../src/game/touch-controls';

afterEach(() => vi.unstubAllGlobals());

function controls() {
  const target = new EventTarget();
  const pads: Array<Gamepad | null> = [];
  vi.stubGlobal('window', target);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const key = (type: 'keydown' | 'keyup', code: string) => {
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }));
  };
  const pad = (index: number) => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const axes = [0, 0, 0, 0];
    const gamepad = { index, id: `test controller ${index}`, connected: true, mapping: 'standard', buttons, axes, timestamp: 0 } as unknown as Gamepad;
    pads[index] = gamepad;
    return { gamepad, buttons, axes };
  };
  return { target, pads, key, pad };
}

describe('independent local 1v1 controllers', () => {
  it('discovers two already-connected pads and prevents either controlling the other player', () => {
    const { target, pad } = controls();
    const first = pad(2), second = pad(4);
    const home = new InputManager(undefined, target, { gamepad: 2, keyboard: false });
    const away = new InputManager(undefined, target, { gamepad: 4, keyboard: false, side: 'away' });
    expect(InputManager.connectedGamepads().map((p) => p.index)).toEqual([2, 4]);
    expect(home.hasGamepad).toBe(true);
    expect(away.activeGamepadIndex).toBe(4);
    first.buttons[0].pressed = true;
    first.axes[0] = 1;
    second.buttons[1].pressed = true;
    second.axes[0] = -1;
    home.poll(); away.poll();
    expect(home.command()).toMatchObject({ moveY: 1, actionPressed: true, jumpPressed: false, aim: { depth: 1 } });
    expect(away.command()).toMatchObject({ moveY: -1, actionPressed: false, jumpPressed: true, aim: { depth: 1 } });
    home.consumeCommandEdges(); away.consumeCommandEdges();
    home.poll(); away.poll();
    expect(home.command().actionPressed).toBe(false);
    expect(away.command().jumpPressed).toBe(false);
  });

  it('supports a keyboard player against one pad without the pad also controlling the keyboard player', () => {
    const { target, pad, key } = controls();
    const controller = pad(0);
    const home = new InputManager(undefined, target, { gamepad: null });
    const away = new InputManager(undefined, target, { gamepad: 0, keyboard: false, side: 'away' });
    key('keydown', 'Space'); key('keydown', 'ArrowRight');
    controller.buttons[1].pressed = true;
    controller.axes[0] = -1;
    home.poll(); away.poll();
    expect(home.command()).toMatchObject({ moveY: 1, actionPressed: true, jumpPressed: false });
    expect(away.command()).toMatchObject({ moveY: -1, actionPressed: false, jumpPressed: true });
    expect(home.hasGamepad).toBe(false);
  });

  it('splits keyboard movement and both action buttons without overlap', () => {
    const { target, key } = controls();
    const home = new InputManager(LOCAL_HOME_BINDINGS, target, { gamepad: null });
    const away = new InputManager(LOCAL_AWAY_BINDINGS, target, { gamepad: null, side: 'away' });
    key('keydown', 'KeyW'); key('keydown', 'KeyF'); key('keydown', 'ArrowLeft'); key('keydown', 'KeyL');
    home.poll(); away.poll();
    expect(home.command()).toMatchObject({ moveX: 1, moveY: 0, actionPressed: true, jumpPressed: false });
    expect(away.command()).toMatchObject({ moveX: 0, moveY: -1, actionPressed: false, jumpPressed: true });
    key('keyup', 'KeyF'); key('keydown', 'KeyK'); key('keydown', 'KeyG');
    home.consumeCommandEdges(); away.consumeCommandEdges(); home.poll(); away.poll();
    expect(home.command()).toMatchObject({ actionPressed: false, jumpPressed: true });
    expect(away.command()).toMatchObject({ actionPressed: true, jumpPressed: false });
  });

  it('reverses depth for away while keeping movement and lateral aiming tied to the screen', () => {
    const { target, key } = controls();
    const away = new InputManager(undefined, target, { side: 'away', gamepad: null });
    key('keydown', 'ArrowRight'); away.poll();
    expect(away.command()).toMatchObject({ moveY: 1, aim: { x: 0, depth: -1 } });
    key('keyup', 'ArrowRight'); key('keydown', 'ArrowUp'); away.poll();
    expect(away.command()).toMatchObject({ moveX: 1, aim: { x: 1, depth: .4 } });
  });
});

describe('gamepad release and reconnect safety', () => {
  it('does not use the remaining pad when an explicitly assigned controller disconnects', () => {
    const { target, pads, pad } = controls();
    pad(0); const second = pad(1);
    const home = new InputManager(undefined, target, { gamepad: 0 });
    pads[0] = null; second.buttons[0].pressed = true;
    home.poll();
    expect(home.hasGamepad).toBe(false);
    expect(home.command().actionPressed).toBe(false);
  });

  it('requires a release before accepting held pad buttons after screen reset', () => {
    const { target, pad } = controls();
    const controller = pad(0);
    const input = new InputManager(undefined, target);
    controller.buttons[0].pressed = true; input.poll();
    input.reset(); input.poll();
    expect(input.command().actionPressed).toBe(false);
    expect(input.command().actionHeld).toBe(false);
    controller.buttons[0].pressed = false; input.poll();
    controller.buttons[0].pressed = true; input.poll();
    expect(input.command().actionPressed).toBe(true);
  });

  it('releases motion on blur and swallows held controller state until it is neutral after focus returns', () => {
    const { target, pad } = controls();
    const controller = pad(0);
    const input = new InputManager(undefined, target);
    controller.axes[0] = 1; controller.buttons[0].pressed = true; input.poll();
    target.dispatchEvent(new Event('blur')); input.poll();
    expect(input.command()).toMatchObject({ moveY: 0, actionPressed: false, actionHeld: false });
    target.dispatchEvent(new Event('focus')); input.poll();
    expect(input.command()).toMatchObject({ moveY: 0, actionPressed: false, actionHeld: false });
    controller.axes[0] = 0; controller.buttons[0].pressed = false; input.poll();
    controller.axes[0] = 1; controller.buttons[0].pressed = true; input.poll();
    expect(input.command()).toMatchObject({ moveY: 1, actionPressed: true });
  });

  it('requires neutral after a controller reconnects and does not drop a different connected assignment', () => {
    const { target, pad, pads } = controls();
    const controller = pad(0), other = pad(1);
    const input = new InputManager(undefined, target, { gamepad: 0 });
    other.buttons[0].pressed = true;
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: other.gamepad }));
    controller.buttons[0].pressed = true; input.poll();
    expect(input.command().actionPressed).toBe(true);
    input.consumeCommandEdges();
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: controller.gamepad }));
    pads[0] = null; input.poll();
    pads[0] = controller.gamepad; input.poll();
    expect(input.command()).toMatchObject({ actionPressed: false, actionHeld: false });
    controller.buttons[0].pressed = false; input.poll();
    controller.buttons[0].pressed = true; input.poll();
    expect(input.command().actionPressed).toBe(true);
  });

  it('detects a missed disconnect event through polling and swallows a reconnect hold', () => {
    const { target, pad, pads } = controls();
    const controller = pad(0);
    const input = new InputManager(undefined, target, { gamepad: 0 });
    input.poll(); pads[0] = null; input.poll();
    controller.buttons[0].pressed = true; pads[0] = controller.gamepad; input.poll();
    expect(input.command()).toMatchObject({ actionHeld: false, actionPressed: false });
    controller.buttons[0].pressed = false; input.poll();
    controller.buttons[0].pressed = true; input.poll();
    expect(input.command().actionPressed).toBe(true);
  });

  it('applies a continuous radial dead zone without turning idle stick drift into movement', () => {
    const { target, pad } = controls();
    const controller = pad(0);
    const input = new InputManager(undefined, target);
    controller.axes[0] = .1; controller.axes[1] = .1;
    expect(input.direction()).toEqual({ x: 0, y: 0 });
    controller.axes[0] = .19; controller.axes[1] = 0;
    expect(input.direction().x).toBeGreaterThan(0);
    expect(input.direction().x).toBeLessThan(.02);
    controller.axes[0] = 1; controller.axes[1] = -1;
    const direction = input.direction();
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
    expect(direction.y).toBeGreaterThan(0);
  });

  it('clears previous assignments and old taps when configuring a new match', () => {
    const { target, key, pad } = controls();
    const controller = pad(1);
    const input = new InputManager(undefined, target);
    key('keydown', 'Space'); input.poll();
    input.configure({ bindings: LOCAL_AWAY_BINDINGS, keyboard: false, gamepad: 1, side: 'away' });
    input.poll(); expect(input.command().actionPressed).toBe(false);
    key('keydown', 'KeyK'); input.poll(); expect(input.command().actionPressed).toBe(false);
    controller.axes[0] = -1; controller.buttons[0].pressed = true; input.poll();
    expect(input.command()).toMatchObject({ moveY: -1, actionPressed: true, aim: { depth: 1 } });
  });

  it('keeps the unaffected player moving when hotplug reaffirms the same assignments', () => {
    const { target, key } = controls();
    const input = new InputManager(LOCAL_HOME_BINDINGS, target, { side: 'home', gamepad: null, keyboard: true });
    key('keydown', 'KeyW'); key('keydown', 'KeyF'); input.poll(); input.consumeCommandEdges();
    input.configure({ bindings: LOCAL_HOME_BINDINGS, side: 'home', gamepad: null, keyboard: true });
    input.poll();
    expect(input.command()).toMatchObject({ moveX: 1, actionHeld: true, actionPressed: false });
  });

  it('disposes event handlers instead of leaving an invisible player accepting input', () => {
    const { target, key } = controls();
    const input = new InputManager(undefined, target, { gamepad: null });
    input.dispose(); key('keydown', 'Space'); input.poll();
    expect(input.command().actionPressed).toBe(false);
  });
});

describe('touch routes through the command buffer', () => {
  it('keeps movement plus action hold and jump independent during a multi-finger gesture', () => {
    const { target } = controls();
    const input = new InputManager(undefined, target, { gamepad: null });
    input.setVirtualDirection(1, 0);
    input.setVirtualButton('action', true);
    input.setVirtualButton('jump', true);
    input.poll();
    expect(input.command()).toMatchObject({ moveY: 1, actionHeld: true, actionPressed: true, jumpPressed: true });
    input.consumeCommandEdges(); input.setVirtualButton('jump', false); input.poll();
    expect(input.command()).toMatchObject({ moveY: 1, actionHeld: true, actionPressed: false, jumpPressed: false });
    input.setVirtualButton('action', false); input.setVirtualDirection(0, 0); input.poll();
    expect(input.command()).toMatchObject({ moveY: 0, actionHeld: false });
  });

  it('preserves an extremely short action tap until a real simulation step consumes it', () => {
    const { target } = controls();
    const input = new InputManager(undefined, target);
    input.setVirtualButton('action', true); input.setVirtualButton('action', false);
    input.poll(); input.poll();
    expect(input.command().actionPressed).toBe(true);
    expect(input.command().actionHeld).toBe(false);
    input.consumeCommandEdges(); input.poll();
    expect(input.command().actionPressed).toBe(false);
  });

  it('clears cancelled gestures without cancelling keyboard movement', () => {
    const { target, key } = controls();
    const input = new InputManager(undefined, target);
    key('keydown', 'ArrowLeft');
    input.setVirtualDirection(1, 0); input.setVirtualButton('action', true);
    input.clearVirtualControls(); input.poll();
    expect(input.command()).toMatchObject({ moveY: -1, actionPressed: false, actionHeld: false });
  });

  it('emits a pause tap once and clears touch levels across focus loss', () => {
    const { target } = controls();
    const input = new InputManager(undefined, target);
    input.setVirtualButton('pause', true); input.setVirtualButton('pause', false);
    input.poll(); expect(input.pausePressed).toBe(true);
    input.poll(); expect(input.pausePressed).toBe(false);
    input.setVirtualDirection(.3, .8); input.setVirtualButton('action', true);
    target.dispatchEvent(new Event('blur')); target.dispatchEvent(new Event('focus')); input.poll();
    expect(input.command()).toMatchObject({ moveX: 0, moveY: 0, actionPressed: false, actionHeld: false });
  });

  it('preserves the explicit QA boundary for browsers that lose synthetic keys while unfocused', () => {
    const { target, key } = controls();
    const input = new InputManager(undefined, target, { gamepad: null });
    target.dispatchEvent(new Event('blur'));
    key('keydown', 'ArrowRight'); input.poll();
    expect(input.command().moveY).toBe(0);
    input.pressForQa('ArrowRight'); input.pressForQa('Space'); input.poll();
    expect(input.command()).toMatchObject({ moveY: 1, actionPressed: true, actionHeld: true });
    input.releaseForQa('ArrowRight'); input.releaseForQa('Space'); input.consumeCommandEdges(); input.poll();
    expect(input.command()).toMatchObject({ moveY: 0, actionPressed: false, actionHeld: false });
  });

  it('has a quiet centre, continuous radial movement, capped speed, and screen-correct axes', () => {
    expect(touchStickDirection(1, 1, 50)).toEqual({ x: 0, y: 0 });
    expect(touchStickDirection(50, 0, 50)).toEqual({ x: 1, y: -0 });
    expect(touchStickDirection(0, -50, 50)).toEqual({ x: 0, y: 1 });
    const middle = touchStickDirection(28, 0, 50);
    expect(middle.x).toBeCloseTo(.5);
    const diagonal = touchStickDirection(200, 200, 50);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.y).toBeLessThan(0);
  });
});
