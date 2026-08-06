import type { Camera } from './camera';

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface DestinationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source crop that fills a destination without distorting the artwork. */
export function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
): SourceRect {
  const sourceAspect = sourceWidth / sourceHeight;
  const destinationAspect = destinationWidth / destinationHeight;
  if (sourceAspect > destinationAspect) {
    const sw = sourceHeight * destinationAspect;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / destinationAspect;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

/** Screen rectangle retained for compatibility with older net tests. */
export function netDestinationRect(
  centreX: number,
  top: number,
  bottom: number,
  worldUnitPixels: number,
): DestinationRect {
  const width = Math.max(22, worldUnitPixels * 0.78);
  return { x: centreX - width / 2, y: top, width, height: Math.max(1, bottom - top) };
}

type ArenaLayer = 'backdrop' | 'floor' | 'net';

interface LayerHandle {
  img: HTMLImageElement;
  loaded: boolean;
}

/**
 * Loads and draws the illustrated arena layers.
 *
 * If any layer is unavailable the procedural draw path in `arena.ts` remains active.
 */
export class ArenaArtwork {
  private readonly base: string;
  private readonly layers: Record<ArenaLayer, LayerHandle>;

  constructor(base = 'arena') {
    this.base = base.replace(/\/$/, '');
    this.layers = {
      backdrop: { img: this.load(`${this.base}/arena-back.png`), loaded: false },
      floor: { img: this.load(`${this.base}/arena-floor.png`), loaded: false },
      net: { img: this.load(`${this.base}/net.png`), loaded: false },
    };
  }

  private load(src: string): HTMLImageElement {
    const img = new Image();
    img.onload = () => {
      for (const key of Object.keys(this.layers) as Array<ArenaLayer>) {
        if (this.layers[key].img === img) this.layers[key].loaded = true;
      }
    };
    img.src = `/${src}`;
    return img;
  }

  private getLayer(name: ArenaLayer): HTMLImageElement | null {
    const layer = this.layers[name];
    if (!layer.loaded || !layer.img.complete) return null;
    return layer.img;
  }

  /** Number of arena layers currently available for rendering. */
  get loadedCount(): number {
    return (Object.keys(this.layers) as ArenaLayer[]).filter((name) => this.layers[name].loaded).length;
  }

  drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const img = this.getLayer('backdrop');
    if (!img) return false;

    const crop = coverSourceRect(img.naturalWidth, img.naturalHeight, width, height);
    ctx.save();
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    ctx.restore();
    return true;
  }

  drawCourtFloor(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    halfWidth: number,
    halfLength: number,
  ): boolean {
    const img = this.getLayer('floor');
    if (!img) return false;

    const points = [
      cam.projectFloor(-halfWidth, -halfLength),
      cam.projectFloor(halfWidth, -halfLength),
      cam.projectFloor(halfWidth, halfLength),
      cam.projectFloor(-halfWidth, halfLength),
    ];
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineTo(points[2].x, points[2].y);
    ctx.lineTo(points[3].x, points[3].y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, minX, minY, width, height);
    ctx.restore();

    return true;
  }

  drawNet(
    ctx: CanvasRenderingContext2D,
    centreX: number,
    top: number,
    bottom: number,
    worldUnitPixels: number,
  ): boolean {
    const img = this.getLayer('net');
    if (!img) return false;

    const width = Math.max(8, worldUnitPixels * 0.78);
    const height = Math.max(1, Math.abs(bottom - top));
    const x = centreX - width / 2;
    const y = Math.min(top, bottom);
    ctx.save();
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, y, width, height);
    ctx.restore();
    return true;
  }
}
