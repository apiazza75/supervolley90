import { Vec3, clamp, smoothDamp } from '../core/math3';
import { COURT_HALF_LENGTH } from '../core/rules';

export interface Projected {
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  /** Distance from the camera along its view axis; used for depth sorting. */
  depth: number;
  /** Perspective scale factor: 1 at the court centre, larger when closer. */
  scale: number;
  /** True when the point is behind the camera and must not be drawn. */
  behind: boolean;
}

/**
 * A fixed pinhole camera looking down the court from behind the home baseline.
 *
 * Power Spikes and its contemporaries used exactly this framing: a shallow
 * three-quarter view where depth is readable enough to aim a spike, but the
 * court still fills the frame. Everything is projected through here, so the
 * renderer never has to think about world units.
 */
export class Camera {
  /** Camera position in world space. */
  x = 0;
  y = -19.4;
  z = 7.1;
  /** Downward tilt in radians. */
  pitch = 0.285;
  /** Focal length in pixels at a 1280 px wide viewport. */
  focal = 1290;

  viewWidth = 1280;
  viewHeight = 720;

  /** Screen-space offset applied after projection, for shake and framing. */
  offsetX = 0;
  offsetY = 0;

  private shake = 0;
  private shakePhase = 0;
  private targetX = 0;
  private targetZoom = 1;
  private zoom = 1;

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  /** Kick the camera; magnitude is in screen pixels. */
  addShake(amount: number): void {
    this.shake = Math.min(26, this.shake + amount);
  }

  /**
   * Follow the action gently. The camera tracks the ball sideways and pushes
   * in a little when play is close to the net, which is where the interesting
   * moments happen.
   */
  follow(ballPos: Vec3, dt: number): void {
    this.targetX = clamp(ballPos.x * 0.28, -1.6, 1.6);
    const nearNet = 1 - clamp(Math.abs(ballPos.y) / COURT_HALF_LENGTH, 0, 1);
    this.targetZoom = 1 + nearNet * 0.06;

    this.x = smoothDamp(this.x, this.targetX, 3.2, dt);
    this.zoom = smoothDamp(this.zoom, this.targetZoom, 2.4, dt);

    if (this.shake > 0.01) {
      this.shakePhase += dt * 46;
      const decay = Math.exp(-7 * dt);
      this.offsetX = Math.sin(this.shakePhase) * this.shake;
      this.offsetY = Math.cos(this.shakePhase * 1.37) * this.shake * 0.55;
      this.shake *= decay;
    } else {
      this.shake = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  /** Project a world point to screen space. */
  project(wx: number, wy: number, wz: number): Projected {
    const cx = wx - this.x;
    const cy = wy - this.y;
    const cz = wz - this.z;

    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);

    // Camera looks along (0, cos p, -sin p); its up axis is (0, sin p, cos p).
    const depth = cy * cp - cz * sp;
    const up = cy * sp + cz * cp;

    if (depth <= 0.05) {
      return { x: 0, y: 0, depth, scale: 0, behind: true };
    }

    const f = (this.focal * (this.viewWidth / 1280)) * this.zoom;
    return {
      x: this.viewWidth / 2 + (f * cx) / depth + this.offsetX,
      y: this.viewHeight * 0.575 - (f * up) / depth + this.offsetY,
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
