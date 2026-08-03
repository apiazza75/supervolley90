import { Vec3, clamp, smoothDamp } from '../core/math3';
import { COURT_HALF_LENGTH } from '../core/rules';

export interface Projected {
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  /** Distance from the camera along its view axis; used for depth sorting. */
  depth: number;
  /** Perspective scale factor, ~1.35 at the court centre. */
  scale: number;
  /** True when the point is behind the camera and must not be drawn. */
  behind: boolean;
}

/**
 * Side-on camera: the court length runs across the screen, the net stands in
 * the middle, and the two teams occupy the left and right halves.
 *
 * This is the framing the 90s volleyball coin-ops used, and it is the reason
 * their action reads instantly — the height of the ball relative to the net is
 * the single most important thing to judge, and a side view puts that on the
 * screen's vertical axis where it is unmissable.
 *
 * The camera sits a long way out with a correspondingly long focal length, so
 * the projection is nearly orthographic. Court width becomes depth into the
 * screen, giving just enough scale and vertical offset to tell a near player
 * from a far one without turning the picture into a 3D scene.
 */
export class Camera {
  /**
   * Camera position: off the near sideline and raised, looking across and
   * slightly down. Purely level would flatten the court into a single line —
   * this angle keeps the side-on read while still showing the floor, which is
   * what makes the landing marker legible.
   */
  x = -40;
  y = -4.82; // = x * tan(yaw), keeping the court centred
  z = 9.0;
  /** Downward tilt in radians. */
  pitch = 0.25;
  /**
   * Slight rotation off dead-side-on.
   *
   * At exactly 90 degrees to the net every point on it shares one screen
   * column, so the net collapses into a vertical line and reads as a pole.
   * A few degrees of yaw gives it width and turns the court into a readable
   * trapezoid, without losing the side-on framing.
   */
  yaw = 0.12;
  /** Focal length in pixels at a 1280 px wide viewport. */
  focal = 2400;

  viewWidth = 1280;
  viewHeight = 720;

  /** Screen-space offset applied after projection, for shake and framing. */
  offsetX = 0;
  offsetY = 0;

  private shake = 0;
  private shakePhase = 0;
  private zoom = 1;

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  /** Kick the camera; magnitude is in screen pixels. */
  addShake(amount: number): void {
    this.shake = Math.min(30, this.shake + amount);
  }

  /**
   * Track the rally. In a side view the meaningful movement is along the court,
   * so the camera pans with the ball's length-wise position and pushes in a
   * little when play is at the net.
   */
  /**
   * Where the camera must sit along y for the court centre to stay in the
   * middle of the frame, given the yaw.
   */
  private get centredY(): number {
    return this.x * Math.tan(this.yaw);
  }

  follow(ballPos: Vec3, dt: number): void {
    const targetY = this.centredY + clamp(ballPos.y * 0.22, -2.2, 2.2);
    const nearNet = 1 - clamp(Math.abs(ballPos.y) / COURT_HALF_LENGTH, 0, 1);
    const targetZoom = 1 + nearNet * 0.05;

    this.y = smoothDamp(this.y, targetY, 3.0, dt);
    this.zoom = smoothDamp(this.zoom, targetZoom, 2.2, dt);

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

  /**
   * Project a world point to screen space.
   *
   * World axes: x across the court, y along it, z up. The camera looks along
   * +x, so world y becomes the screen's horizontal axis and world x becomes
   * depth — the opposite assignment to a behind-the-baseline view.
   */
  project(wx: number, wy: number, wz: number): Projected {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const above = wz - this.z;

    // Yaw first, in the floor plane, then pitch in the resulting vertical plane.
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const right = -dx * sy + dy * cy;
    const forward = dx * cy + dy * sy;

    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);

    const depth = forward * cp - above * sp;
    const up = forward * sp + above * cp;

    if (depth <= 0.05) {
      return { x: 0, y: 0, depth, scale: 0, behind: true };
    }

    const f = this.focal * (this.viewWidth / 1280) * this.zoom;
    return {
      x: this.viewWidth / 2 + (f * right) / depth + this.offsetX,
      y: this.viewHeight * 0.68 - (f * up) / depth + this.offsetY,
      depth,
      scale: f / depth / 42,
      behind: false,
    };
  }

  projectVec(p: Vec3): Projected {
    return this.project(p.x, p.y, p.z);
  }

  /** Convenience: project a point on the floor. */
  projectFloor(x: number, y: number): Projected {
    return this.project(x, y, 0);
  }
}
