import type { Camera } from './camera';

type LoadedImage = ImageBitmap | HTMLImageElement;

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

/** Screen rectangle for the narrow, side-on authored net. */
export function netDestinationRect(
  centreX: number,
  top: number,
  bottom: number,
  worldUnitPixels: number,
): DestinationRect {
  const width = Math.max(22, worldUnitPixels * 0.78);
  return { x: centreX - width / 2, y: top, width, height: Math.max(1, bottom - top) };
}

function fromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not decode ${src}`));
    image.src = src;
  });
}

async function decode(url: string): Promise<LoadedImage> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const blob = await response.blob();
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await fromUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn(`[arena-art] fetch failed for ${url}, loading directly:`, error);
    return fromUrl(url);
  }
}

/**
 * Optional illustrated arena layers. Every method returns false until
 * its asset is ready, so the procedural arena remains a safe fallback.
 */
export class ArenaArtwork {
  private backdrop?: LoadedImage;
  private floor?: LoadedImage;
  private net?: LoadedImage;
  private readonly floorPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

  constructor(base = 'arena') {
    void this.load(base);
  }

  private async load(base: string): Promise<void> {
    const resolve = (name: string): string =>
      new URL(`${base}/${name}`, document.baseURI).href;
    const [backdrop, floor, net] = await Promise.allSettled([
      decode(resolve('arena-back.png')),
      decode(resolve('arena-floor.png')),
      decode(resolve('net.png')),
    ]);
    if (backdrop.status === 'fulfilled') this.backdrop = backdrop.value;
    if (floor.status === 'fulfilled') this.floor = floor.value;
    if (net.status === 'fulfilled') this.net = net.value;
  }

  drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const image = this.backdrop;
    if (!image) return false;
    const source = coverSourceRect(image.width, image.height, width, height);
    ctx.drawImage(
      image,
      source.sx,
      source.sy,
      source.sw,
      source.sh,
      0,
      0,
      width,
      height,
    );
    return true;
  }

  drawCourtFloor(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    halfWidth: number,
    halfLength: number,
  ): boolean {
    const image = this.floor;
    if (!image) return false;
    let pattern = this.floorPatterns.get(ctx);
    if (!pattern) {
      pattern = ctx.createPattern(image, 'repeat') ?? undefined;
      if (!pattern) return false;
      this.floorPatterns.set(ctx, pattern);
    }
    const points = [
      cam.projectFloor(-halfWidth, -halfLength),
      cam.projectFloor(halfWidth, -halfLength),
      cam.projectFloor(halfWidth, halfLength),
      cam.projectFloor(-halfWidth, halfLength),
    ];
    ctx.save();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, cam.viewWidth, cam.viewHeight);
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
    const image = this.net;
    if (!image) return false;
    const target = netDestinationRect(centreX, top, bottom, worldUnitPixels);
    // The authored file has transparent room around a central narrow net.
    ctx.drawImage(image, 205, 5, 102, 493, target.x, target.y, target.width, target.height);
    return true;
  }
}
