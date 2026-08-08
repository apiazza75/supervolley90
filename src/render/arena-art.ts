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

export const ARENA_V3_LAYER_NAMES = [
  'backdrop',
  'crowdFar',
  'ledMid',
  'floor',
  'foreground',
] as const;

export type ArenaV3Layer = (typeof ARENA_V3_LAYER_NAMES)[number];

interface LayerHandle {
  img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

/**
 * Five-layer arena art used by Recovery V3.
 *
 * All screen-space layers share a 2560 x 1440 virtual composition.  This keeps
 * the crowd, LED ribbon and foreground locked to the backdrop at every aspect
 * ratio instead of scaling each transparent PNG independently.
 */
export class ArenaArtwork {
  private static readonly SCENE_WIDTH = 2560;
  private static readonly SCENE_HEIGHT = 1440;
  private readonly base: string;
  private readonly layers: Record<ArenaV3Layer, LayerHandle>;

  constructor(base = 'arena/v3') {
    this.base = base.replace(/^\//, '').replace(/\/$/, '');
    this.layers = {
      backdrop: this.createLayer('backdrop.png'),
      crowdFar: this.createLayer('crowd-far.png'),
      ledMid: this.createLayer('led-mid.png'),
      floor: this.createLayer('floor.png'),
      foreground: this.createLayer('foreground.png'),
    };
  }

  private createLayer(file: string): LayerHandle {
    const handle = { img: new Image(), loaded: false, failed: false };
    handle.img.onload = () => {
      handle.loaded = true;
      handle.failed = false;
    };
    handle.img.onerror = () => {
      handle.loaded = false;
      handle.failed = true;
    };
    handle.img.src = `/${this.base}/${file}`;
    return handle;
  }

  private getLayer(name: ArenaV3Layer): HTMLImageElement | null {
    const layer = this.layers[name];
    if (!layer.loaded || !layer.img.complete || layer.img.naturalWidth <= 0) return null;
    return layer.img;
  }

  /** Number of v3 layers currently available for rendering. */
  get loadedCount(): number {
    return ARENA_V3_LAYER_NAMES.reduce(
      (total, name) => total + (this.getLayer(name) ? 1 : 0),
      0,
    );
  }

  get complete(): boolean {
    return this.loadedCount === ARENA_V3_LAYER_NAMES.length;
  }

  get failedLayers(): readonly ArenaV3Layer[] {
    return ARENA_V3_LAYER_NAMES.filter((name) => this.layers[name].failed);
  }

  private sceneCrop(width: number, height: number): SourceRect {
    return coverSourceRect(
      ArenaArtwork.SCENE_WIDTH,
      ArenaArtwork.SCENE_HEIGHT,
      width,
      height,
    );
  }

  /** Draw a transparent layer in the same virtual coordinates as the backdrop. */
  private drawSceneLayer(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    width: number,
    height: number,
    sceneY: number,
  ): void {
    const crop = this.sceneCrop(width, height);
    const scale = width / crop.sw;
    const x = -crop.sx * scale;
    const y = (sceneY - crop.sy) * scale;
    ctx.drawImage(img, x, y, ArenaArtwork.SCENE_WIDTH * scale, img.naturalHeight * scale);
  }

  drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const img = this.getLayer('backdrop');
    if (!img) return false;
    const crop = this.sceneCrop(width, height);
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    return true;
  }

  drawCrowdFar(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const img = this.getLayer('crowdFar');
    if (!img) return false;
    // The stand fills the gap between the fascia and the far edge of the
    // projected floor, which the camera puts at screen y 299 — scene y 598.
    //
    // This was 345, with the sheet's first spectator row 245 pixels down it:
    // the crowd therefore began at scene 590 and the court was drawn over the
    // whole of it. Every spectator was rendered, and none was ever visible.
    this.drawSceneLayer(ctx, img, width, height, 400);
    return true;
  }

  drawLedMid(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const img = this.getLayer('ledMid');
    if (!img) return false;
    // Barrier and ribbon sit at the foot of the stand, so the boards land just
    // above the floor's far edge and the court starts behind them. At the
    // previous 760 the entire strip was behind the court and never appeared.
    this.drawSceneLayer(ctx, img, width, height, 520);
    return true;
  }

  drawForeground(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const img = this.getLayer('foreground');
    if (!img) return false;
    this.drawSceneLayer(ctx, img, width, height, ArenaArtwork.SCENE_HEIGHT - 512);
    return true;
  }

  /**
   * The one knob for dialling the floor texture back.
   *
   * It sits at full strength because the strength is authored into the sheet
   * instead: `floor.png` is built on mid grey, and `soft-light` leaves a pixel
   * untouched wherever the source is exactly 50% grey, so only the deviations
   * drawn into the sheet reach the screen at all. Measured off the committed
   * file, those deviations arrive as a mean shift of about 7 levels out of 255
   * — wear and sheen on the planks, not a repaint of the court.
   *
   * The V3 asset was a painted court instead, and at any strength worth having
   * it brought its own perspective with it.
   */
  private static readonly FLOOR_GRAIN_ALPHA = 1;

  /**
   * Lay the authored floor texture over the drawn parquet as grain and sheen.
   *
   * Composited, not substituted. `Arena.drawGrain()` builds the planks by
   * sampling the camera's own floor projection, so its seams are in
   * perspective by construction; a bitmap can only be in the perspective it
   * was drawn in. The V3 asset was a painted court, drawn over this same
   * quadrilateral in place of the planks, and it laid a lattice across the
   * free zone at an angle the camera never produces. The sheet is a grey
   * texture now, and it arrives as texture and nothing else.
   *
   * Image x follows court length, image y follows far-to-near court width.
   */
  drawFloorGrain(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    halfWidth: number,
    halfLength: number,
  ): boolean {
    const img = this.getLayer('floor');
    if (!img) return false;

    const farLeft = cam.projectFloor(halfWidth, -halfLength);
    const farRight = cam.projectFloor(halfWidth, halfLength);
    const nearLeft = cam.projectFloor(-halfWidth, -halfLength);
    const nearRight = cam.projectFloor(-halfWidth, halfLength);

    const a = (farRight.x - farLeft.x) / img.naturalWidth;
    const b = (farRight.y - farLeft.y) / img.naturalWidth;
    const c = (nearLeft.x - farLeft.x) / img.naturalHeight;
    const d = (nearLeft.y - farLeft.y) / img.naturalHeight;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.lineTo(nearRight.x, nearRight.y);
    ctx.lineTo(nearLeft.x, nearLeft.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = ArenaArtwork.FLOOR_GRAIN_ALPHA;
    ctx.transform(a, b, c, d, farLeft.x, farLeft.y);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    return true;
  }
}
