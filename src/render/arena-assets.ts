import { ANTENNA_HEIGHT, COURT_HALF_WIDTH, NET_HEIGHT } from '../core/rules';
import type { Camera } from './camera';

interface ScreenPoint {
  x: number;
  y: number;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * Optional illustrated arena layers.
 *
 * Every method returns false while an asset is absent or still loading, so the
 * existing procedural arena remains a complete fallback in development, tests,
 * partial deliveries and damaged installations.
 */
export class ArenaAssets {
  private back: HTMLImageElement | null = null;
  private floor: HTMLImageElement | null = null;
  private net: HTMLImageElement | null = null;

  constructor(base = 'arena') {
    if (typeof document !== 'undefined') void this.load(base);
  }

  private async load(base: string): Promise<void> {
    const url = (name: string): string => new URL(`${base}/${name}`, document.baseURI).href;
    const [back, floor, net] = await Promise.all([
      loadImage(url('arena-back.png')),
      loadImage(url('arena-floor.png')),
      loadImage(url('net.png')),
    ]);
    this.back = back;
    this.floor = floor;
    this.net = net;
  }

  get hasFloor(): boolean {
    return this.floor !== null;
  }

  drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): boolean {
    const image = this.back;
    if (!image) return false;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    ctx.drawImage(image, (width - dw) / 2, height - dh, dw, dh);
    return true;
  }

  /** Fill one projected court quad with the horizontally tileable floor art. */
  fillFloor(ctx: CanvasRenderingContext2D, points: ScreenPoint[]): boolean {
    const image = this.floor;
    if (!image || points.length < 3) return false;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const height = Math.max(1, bottom - top);
    const tileHeight = Math.max(96, height * 1.12);
    const tileWidth = tileHeight * (image.naturalWidth / image.naturalHeight);

    ctx.save();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.clip();
    for (let x = left - tileWidth; x < right + tileWidth; x += tileWidth) {
      ctx.drawImage(image, x, top, tileWidth, tileHeight);
    }
    ctx.restore();
    return true;
  }

  drawNet(ctx: CanvasRenderingContext2D, cam: Camera): boolean {
    const image = this.net;
    if (!image) return false;
    const widthAxis = COURT_HALF_WIDTH;
    const centre = cam.projectFloor(0, 0);
    const top = Math.min(
      cam.project(widthAxis, 0, ANTENNA_HEIGHT).y,
      cam.project(-widthAxis, 0, ANTENNA_HEIGHT).y,
    );
    const bottom = Math.max(
      cam.project(widthAxis, 0, 0).y,
      cam.project(-widthAxis, 0, 0).y,
    );
    const tapeNear = cam.project(-widthAxis, 0, NET_HEIGHT).y;
    const tapeFar = cam.project(widthAxis, 0, NET_HEIGHT).y;
    const projectedHeight = Math.max(1, bottom - top);
    const drawWidth = Math.max(48, Math.abs(tapeNear - tapeFar) * 0.92);
    ctx.drawImage(image, centre.x - drawWidth / 2, top, drawWidth, projectedHeight);
    return true;
  }
}
