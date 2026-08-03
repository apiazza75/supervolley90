import { FIXED_DT } from './core/rules';
import { World } from './core/world';
import { Audio } from './game/audio';
import { InputManager } from './game/input';
import { Menu } from './game/menu';
import { Hud } from './render/hud';
import { Renderer } from './render/renderer';

type Screen = 'menu' | 'match' | 'paused';

/**
 * Application shell: canvas setup, the fixed-timestep loop, and the handful of
 * screens around the match itself.
 *
 * The simulation runs at a fixed 120 Hz regardless of display refresh, and the
 * renderer draws once per animation frame. On a 60 Hz panel that is two steps
 * per frame; on a 120 Hz ProMotion display, one. Either way the physics are
 * identical, which is what keeps the game deterministic and the feel constant.
 */
class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input = new InputManager();
  private readonly audio = new Audio();
  private readonly menu = new Menu();

  private world: World | null = null;
  private screen: Screen = 'menu';
  private accumulator = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private hitStop = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = ctx;
    this.renderer = new Renderer(ctx);
    this.hud = new Hud(ctx);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Audio can only start from a gesture; any key or click will do.
    const unlock = () => this.audio.resume();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
  }

  /**
   * Size the backing store to the device pixel ratio so the court lines stay
   * crisp on a Retina display, while keeping CSS-pixel coordinates in code.
   */
  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.resize(w, h);
  }

  start(): void {
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    // Clamp the delta so a backgrounded tab does not fast-forward the match on
    // return, and so a single slow frame cannot spiral the accumulator.
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.elapsed += dt;

    this.input.poll();
    this.update(dt);
    this.draw(dt);

    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    if (this.input.pausePressed) this.togglePause();

    switch (this.screen) {
      case 'menu': {
        this.menu.update(this.input, dt);
        if (this.menu.ready) {
          this.startMatch();
        }
        break;
      }
      case 'match': {
        const world = this.world;
        if (!world) break;

        // Hit-stop: hold the world still for a few frames after a big impact.
        if (this.hitStop > 0) {
          this.hitStop = Math.max(0, this.hitStop - dt);
          break;
        }

        this.accumulator += dt;
        const command = this.input.command();
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 8) {
          world.step(command);
          this.accumulator -= FIXED_DT;
          steps++;
        }
        // If we fell too far behind, drop the backlog rather than chase it.
        if (steps >= 8) this.accumulator = 0;

        const events = world.drainEvents();
        this.renderer.handleEvents(world, events);
        this.audio.handle(events);
        break;
      }
      default:
        break;
    }
  }

  private draw(dt: number): void {
    const { innerWidth: w, innerHeight: h } = window;

    if (this.screen === 'menu' || !this.world) {
      this.menu.draw(this.ctx, w, h, this.input.hasGamepad);
      return;
    }

    this.hitStop = Math.max(
      this.hitStop,
      this.renderer.draw(
        this.world,
        {
          alpha: 0,
          time: this.elapsed,
          jumpLabel: this.input.hasGamepad ? 'B' : 'SHIFT',
        },
        dt,
      ),
    );
    this.hud.draw(this.world, w, h, { gamepad: this.input.hasGamepad, time: this.elapsed });

    if (this.screen === 'paused') this.drawPauseOverlay(w, h);
  }

  private drawPauseOverlay(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(6,9,20,0.68)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.font = '900 46px "Arial Black", system-ui, sans-serif';
    ctx.fillStyle = '#ffe27a';
    ctx.fillText('PAUSED', w / 2, h / 2 - 6);
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,230,255,0.7)';
    ctx.fillText('ESC to resume', w / 2, h / 2 + 30);
  }

  private startMatch(): void {
    const setup = this.menu.ready;
    if (!setup) return;
    this.world = new World({
      home: setup.home,
      away: setup.away,
      seed: setup.seed,
      difficulty: setup.difficulty,
      humanControlsHome: true,
    });
    this.renderer.effects.clear();
    this.accumulator = 0;
    this.hitStop = 0;
    this.screen = 'match';
    this.menu.reset();
    this.audio.resume();
  }

  private togglePause(): void {
    if (this.screen === 'match') {
      // A finished match returns to the menu instead of pausing.
      if (this.world?.phase === 'matchOver') {
        this.screen = 'menu';
        this.world = null;
        this.menu.reset();
      } else {
        this.screen = 'paused';
      }
    } else if (this.screen === 'paused') {
      this.screen = 'match';
    }
  }
}

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing <canvas id="game"> in the page.');
}
const game = new Game(canvas);
game.start();

// Exposed for the browser-driven control harness (tools/input-e2e.ts), which
// asserts that the arrow keys move the active player the way the screen
// implies. TypeScript's `private` is compile-time only, so the harness can
// reach the world through this handle at runtime.
(window as unknown as Record<string, unknown>).__sv90 = game;
