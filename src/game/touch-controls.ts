import { InputManager, type VirtualButton } from './input';
import './touch-controls.css';

export interface TouchControlsOptions {
  /** Show on a desktop for accessibility, or to try the controls before playing. */
  force?: boolean;
  parent?: HTMLElement;
}

/** Screen coordinates in, screen-right/up-positive normalised direction out. */
export function touchStickDirection(dx: number, dy: number, radius: number): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (distance < Math.max(1, radius) * 0.12) return { x: 0, y: 0 };
  const strength = Math.min(1, (distance / Math.max(1, radius) - 0.12) / 0.88);
  return { x: dx / distance * strength, y: -dy / distance * strength };
}

/** A real multi-pointer input surface; it never touches players or simulation state. */
export class TouchControls {
  readonly element: HTMLDivElement;
  private readonly stick: HTMLButtonElement;
  private readonly nub: HTMLSpanElement;
  private readonly buttons = new Map<VirtualButton, HTMLButtonElement>();
  private readonly buttonPointers = new Map<VirtualButton, Set<number>>();
  private readonly keyboardButtons = new Set<VirtualButton>();
  private readonly removeListeners: Array<() => void> = [];
  private stickPointer: number | null = null;
  private enabled = false;
  private force: boolean;
  private touchDetected: boolean;

  constructor(private readonly input: InputManager, options: TouchControlsOptions = {}) {
    this.force = options.force ?? false;
    this.touchDetected = (navigator.maxTouchPoints ?? 0) > 0 ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches);
    this.element = document.createElement('div');
    this.element.className = 'touch-controls';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'Comandi touch di gioco');
    this.element.dataset.testid = 'touch-controls';
    this.element.hidden = true;

    this.stick = document.createElement('button');
    this.stick.type = 'button';
    this.stick.className = 'touch-stick';
    this.stick.setAttribute('aria-label', 'Muovi e mira: trascina in una direzione');
    this.stick.setAttribute('aria-describedby', 'touch-move-hint');
    this.stick.dataset.testid = 'touch-stick';
    this.nub = document.createElement('span');
    this.nub.className = 'touch-stick-nub';
    this.nub.setAttribute('aria-hidden', 'true');
    const cross = document.createElement('span');
    cross.className = 'touch-stick-cross';
    cross.setAttribute('aria-hidden', 'true');
    cross.textContent = '✥';
    this.stick.append(cross, this.nub);
    const movement = document.createElement('div');
    movement.className = 'touch-movement';
    const moveLabel = document.createElement('span');
    moveLabel.id = 'touch-move-hint';
    moveLabel.className = 'touch-label';
    moveLabel.textContent = 'MUOVI · MIRA';
    movement.append(this.stick, moveLabel);
    this.element.append(movement);

    const actions = document.createElement('div');
    actions.className = 'touch-actions';
    actions.append(
      this.makeButton('jump', 'SALTO', 'Salta: attacco o muro'),
      this.makeButton('action', 'COLPO', 'Colpisci la palla; tieni premuto per caricare'),
    );
    const actionLabel = document.createElement('span');
    actionLabel.className = 'touch-action-hint';
    actionLabel.textContent = 'TIENI PER CARICARE';
    actions.append(actionLabel);
    this.element.append(actions, this.makeButton('pause', 'Ⅱ', 'Pausa o riprendi la partita'));
    (options.parent ?? document.body).append(this.element);

    this.listen(this.stick, 'pointerdown', (event) => this.startStick(event as PointerEvent));
    this.listen(this.stick, 'pointermove', (event) => this.moveStick(event as PointerEvent));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(this.stick, type, (event) => this.stopStick(event as PointerEvent));
    }
    this.listen(this.stick, 'keydown', (event) => this.stickKey(event as KeyboardEvent, true));
    this.listen(this.stick, 'keyup', (event) => this.stickKey(event as KeyboardEvent, false));
    this.listen(this.stick, 'blur', () => this.release());
    this.listen(window, 'pointerdown', (event) => {
      if ((event as PointerEvent).pointerType === 'touch' && !this.touchDetected) {
        this.touchDetected = true;
        this.updateVisibility();
      }
    });
    this.listen(window, 'blur', () => this.release());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.release(); });
  }

  private listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.removeListeners.push(() => target.removeEventListener(type, listener));
  }

  private makeButton(kind: VirtualButton, label: string, accessibleLabel: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `touch-button touch-${kind}`;
    button.textContent = label;
    button.setAttribute('aria-label', accessibleLabel);
    button.dataset.testid = `touch-${kind}`;
    this.buttons.set(kind, button);
    const pointers = new Set<number>();
    this.buttonPointers.set(kind, pointers);
    this.listen(button, 'pointerdown', (event) => {
      const pointer = event as PointerEvent;
      if (!this.visible || (pointer.pointerType === 'mouse' && pointer.button !== 0)) return;
      event.preventDefault();
      pointers.add(pointer.pointerId);
      this.capture(button, pointer.pointerId);
      this.setButton(kind, true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.listen(button, type, (event) => {
        const pointer = event as PointerEvent;
        if (!pointers.delete(pointer.pointerId)) return;
        event.preventDefault();
        this.setButton(kind, pointers.size > 0 || this.keyboardButtons.has(kind));
      });
    }
    this.listen(button, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (!this.visible || !['Space', 'Enter'].includes(key.code)) return;
      event.preventDefault();
      if (key.repeat) return;
      this.keyboardButtons.add(kind);
      this.setButton(kind, true);
    });
    this.listen(button, 'keyup', (event) => {
      const key = event as KeyboardEvent;
      if (!['Space', 'Enter'].includes(key.code)) return;
      event.preventDefault();
      this.keyboardButtons.delete(kind);
      this.setButton(kind, pointers.size > 0);
    });
    // Assistive activation may arrive as click without a preceding pointer/key.
    this.listen(button, 'click', (event) => {
      if (!this.visible || (event as MouseEvent).detail !== 0 || this.keyboardButtons.has(kind)) return;
      this.input.setVirtualButton(kind, true);
      this.input.setVirtualButton(kind, false);
    });
    this.listen(button, 'blur', () => {
      this.keyboardButtons.delete(kind);
      this.setButton(kind, pointers.size > 0);
    });
    return button;
  }

  private setButton(kind: VirtualButton, down: boolean): void {
    this.buttons.get(kind)?.classList.toggle('is-held', down);
    this.input.setVirtualButton(kind, down);
  }

  private capture(element: HTMLElement, pointerId: number): void {
    try { element.setPointerCapture(pointerId); } catch { /* Synthetic/accessibility pointers have no capture. */ }
  }

  private startStick(event: PointerEvent): void {
    if (!this.visible || this.stickPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.stickPointer = event.pointerId;
    this.stick.classList.add('is-held');
    this.capture(this.stick, event.pointerId);
    this.moveStick(event);
  }

  private moveStick(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.34;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const direction = touchStickDirection(dx, dy, radius);
    this.input.setVirtualDirection(direction.x, direction.y);
    this.nub.style.transform = `translate(${direction.x * radius}px, ${-direction.y * radius}px)`;
  }

  private stopStick(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    event.preventDefault();
    this.stickPointer = null;
    this.stick.classList.remove('is-held');
    this.nub.style.transform = '';
    this.input.setVirtualDirection(0, 0);
  }

  private readonly stickKeys = new Set<string>();

  private stickKey(event: KeyboardEvent, down: boolean): void {
    if (!this.visible || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
    event.preventDefault();
    if (down) this.stickKeys.add(event.code);
    else this.stickKeys.delete(event.code);
    const x = Number(this.stickKeys.has('ArrowRight')) - Number(this.stickKeys.has('ArrowLeft'));
    const y = Number(this.stickKeys.has('ArrowUp')) - Number(this.stickKeys.has('ArrowDown'));
    this.input.setVirtualDirection(x, y);
  }

  /** Set every screen transition; hidden menu controls cannot move the match. */
  setVisible(visible: boolean): void {
    if (this.enabled === visible) return;
    this.enabled = visible;
    this.updateVisibility();
  }

  setForce(force: boolean): void {
    this.force = force;
    this.updateVisibility();
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  private updateVisibility(): void {
    this.element.hidden = !(this.enabled && (this.force || this.touchDetected));
    if (this.element.hidden) this.release();
  }

  /** Cancel all fingers after a pause, focus change, or interrupted gesture. */
  release(): void {
    this.stickPointer = null;
    this.stickKeys.clear();
    this.stick.classList.remove('is-held');
    this.nub.style.transform = '';
    this.keyboardButtons.clear();
    this.buttonPointers.forEach((pointers) => pointers.clear());
    this.buttons.forEach((button) => button.classList.remove('is-held'));
    this.input.clearVirtualControls();
  }

  dispose(): void {
    this.release();
    this.removeListeners.splice(0).forEach((remove) => remove());
    this.element.remove();
  }
}
