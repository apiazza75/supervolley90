import { Camera } from './camera';

interface Bounds { x: number; y: number; width: number; height: number }

/** Overscan includes the outermost plank and the full court during pan/shake. */
export function floorSurfaceBounds(camera: Camera, halfWidth: number, halfLength: number): Bounds {
  const corners = [
    camera.projectFloor(-halfWidth, -halfLength), camera.projectFloor(halfWidth, -halfLength),
    camera.projectFloor(halfWidth, halfLength), camera.projectFloor(-halfWidth, halfLength),
  ];
  const x = Math.floor(Math.min(...corners.map(p => p.x))) - 8;
  const y = Math.floor(Math.min(...corners.map(p => p.y))) - 8;
  return { x, y, width: Math.ceil(Math.max(...corners.map(p => p.x))) - x + 8,
    height: Math.ceil(Math.max(...corners.map(p => p.y))) - y + 8 };
}

/** Exact affine relation of this orthographic camera, including zoom and shake. */
export function floorSurfacePlacement(reference: Camera, current: Camera, bounds: Bounds) {
  const base = reference.projectFloor(0, 0), at = current.projectFloor(0, 0);
  const baseUnit = reference.projectFloor(0, 1).x - base.x;
  const currentUnit = current.projectFloor(0, 1).x - at.x;
  const scale = currentUnit / baseUnit;
  return { x: at.x + (bounds.x - base.x) * scale, y: at.y + (bounds.y - base.y) * scale,
    width: bounds.width * scale, height: bounds.height * scale, scale };
}

/**
 * Cache the drawn floor materials at backing-store density. Court markings,
 * players, shadows and impact effects remain separate live drawing passes.
 * Atlas projection and pattern preparation do not repeat every display frame.
 */
export class FloorSurfaceCache {
  private surface?: { canvas: HTMLCanvasElement; camera: Camera; bounds: Bounds; density: number; key: string };
  readonly diagnostics = { generations: 0, draws: 0 };

  /** Prepare offscreen while the menu is visible; never paint over the menu. */
  prepare(ctx: CanvasRenderingContext2D, camera: Camera, halfWidth: number, halfLength: number,
    artReady: boolean, paint: (ctx: CanvasRenderingContext2D, camera: Camera) => void): boolean {
    if (!artReady) return false;
    const transform = ctx.getTransform();
    // Preserve the actual backing-store density, including Retina and large
    // windows, with headroom for the camera's small (at most 3%) zoom.
    const density = Math.ceil(Math.max(1, Math.hypot(transform.a, transform.b),
      Math.hypot(transform.c, transform.d)) * 1.05 * 2) / 2;
    const key = [camera.viewWidth, camera.viewHeight, halfWidth, halfLength, density].join('/');
    if (this.surface?.key !== key) {
      const reference = new Camera(); reference.resize(camera.viewWidth, camera.viewHeight);
      const bounds = floorSurfaceBounds(reference, halfWidth, halfLength);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(bounds.width * density);
      canvas.height = Math.ceil(bounds.height * density);
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.setTransform(density, 0, 0, density, -bounds.x * density, -bounds.y * density);
      paint(context, reference);
      this.surface = { canvas, camera: reference, bounds, density, key };
      this.diagnostics.generations++;
    }
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, halfWidth: number, halfLength: number,
    artReady: boolean, paint: (ctx: CanvasRenderingContext2D, camera: Camera) => void): boolean {
    if (!this.prepare(ctx, camera, halfWidth, halfLength, artReady, paint)) return false;
    const surface = this.surface!;
    const to = floorSurfacePlacement(surface.camera, camera, surface.bounds);
    // Exclude a possible half-pixel from the ceil-rounded backing-store size.
    ctx.drawImage(surface.canvas, 0, 0, surface.bounds.width * surface.density,
      surface.bounds.height * surface.density, to.x, to.y, to.width, to.height);
    this.diagnostics.draws++;
    return true;
  }
}
