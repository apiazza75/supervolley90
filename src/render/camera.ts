import { Vec3, clamp, smoothDamp } from '../core/math3';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH } from '../core/rules';

export interface Projected {
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  /** Sorting key: larger means further from the viewer. */
  depth: number;
  /** Size multiplier for anything drawn at this point. */
  scale: number;
  /** Kept for API compatibility; an orthographic camera has nothing behind it. */
  behind: boolean;
}

/** Pixels per metre along the court and vertically, at a 1280 px viewport. */
const PIXELS_PER_METRE = 55;
/**
 * Court width, projected as a pure vertical offset: each metre further from the
 * viewer moves a point this far up the screen and no distance sideways.
 *
 * This is a flat side elevation. The court is a horizontal band, its lines stay
 * horizontal and vertical, and the net — which runs along the width — collapses
 * to a narrow vertical post in the middle of the screen, which is exactly what
 * the arcade original shows. An earlier version sheared width diagonally to
 * give the net visible area; that read as an angled 3D scene and was wrong.
 *
 * The ratio to PIXELS_PER_METRE matters, and getting it too small was a real
 * mistake. At 15 px/m the court's 9 m of width collapsed into a 135 px band —
 * shorter than a player is tall. Six players in a correct volleyball formation,
 * which spreads across the WIDTH, then all landed within one body-height of
 * each other and simply overlapped: the team looked like a crowd bumping into
 * itself no matter how good the tactics driving it were. At 30 px/m the same
 * formation occupies 270 px and every role is separately visible, while the
 * projection stays exactly as flat: nothing converges, lines stay horizontal,
 * and the net is still a vertical post.
 */
const DEPTH_RISE = 30;
/**
 * How much smaller the far sideline is drawn than the near one. Applied to
 * sprite size only, never to position, so court lines stay exactly parallel.
 */
const DEPTH_SHRINK = 0;

/**
 * Orthographic side-on camera.
 *
 * The previous version divided by depth, and that single operation is what made
 * the picture read as a 3D scene no matter how the angles were tuned: parallel
 * court lines converged, and players changed size as they crossed the court.
 *
 * Here nothing converges. Court length runs across the screen, height runs up
 * it, and court width becomes a fixed vertical offset per metre. A player at
 * the back of the court is drawn higher and very slightly smaller, and that is
 * the entire third dimension. Flat on purpose.
 */
export class Camera {
  viewWidth = 1280;
  viewHeight = 720;

  /** Pan along the court, in metres. */
  panY = 0;
  /** Screen-space offset applied after projection, for shake. */
  offsetX = 0;
  offsetY = 0;

  private shake = 0;
  private shakePhase = 0;
  private zoom = 1;

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  addShake(amount: number): void {
    this.shake = Math.min(30, this.shake + amount);
  }

  /** Metres-to-pixels, including the viewport scale and the zoom. */
  private get unit(): number {
    return PIXELS_PER_METRE * (this.viewWidth / 1280) * this.zoom;
  }

  /** Screen row that the court centre line sits on. */
  private get baseline(): number {
    // Raised from 0.72 once the width axis was drawn at twice the scale: the
    // court is now a much taller band on screen, and at the old baseline its
    // near sideline — and everyone standing behind it — ran off the bottom of
    // the frame into the control hints.
    return this.viewHeight * 0.66;
  }

  follow(ballPos: Vec3, dt: number): void {
    // Gentle pan only. A 2D game of this kind should keep the whole court in
    // frame; the camera is here to add life, not to chase the ball.
    const targetPan = clamp(ballPos.y * 0.1, -1.2, 1.2);
    const nearNet = 1 - clamp(Math.abs(ballPos.y) / COURT_HALF_LENGTH, 0, 1);

    this.panY = smoothDamp(this.panY, targetPan, 2.6, dt);
    this.zoom = smoothDamp(this.zoom, 1 + nearNet * 0.03, 2.0, dt);

    if (this.shake > 0.01) {
      this.shakePhase += dt * 46;
      this.offsetX = Math.sin(this.shakePhase) * this.shake;
      this.offsetY = Math.cos(this.shakePhase * 1.37) * this.shake * 0.55;
      this.shake *= Math.exp(-7 * dt);
    } else {
      this.shake = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  /** Size multiplier for a point at court-width `wx`. */
  scaleAt(wx: number): number {
    return 1 - (wx / (2 * COURT_HALF_WIDTH)) * DEPTH_SHRINK;
  }

  project(wx: number, wy: number, wz: number): Projected {
    const u = this.unit;
    const k = (this.viewWidth / 1280) * this.zoom;

    return {
      x: this.viewWidth / 2 + (wy - this.panY) * u + this.offsetX,
      y: this.baseline - wx * DEPTH_RISE * k - wz * u + this.offsetY,
      // Nearer the viewer means smaller x, and must be drawn last.
      depth: wx,
      scale: (u * this.scaleAt(wx)) / 42,
      behind: false,
    };
  }

  projectVec(p: Vec3): Projected {
    return this.project(p.x, p.y, p.z);
  }

  projectFloor(x: number, y: number): Projected {
    return this.project(x, y, 0);
  }
}
