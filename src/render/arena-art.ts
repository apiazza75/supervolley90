import type { Camera } from './camera';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH } from '../core/rules';

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

export const FLOOR_MANGA_SOURCE = 'surface-manga.png';
export const GRANDSTAND_MANGA_SOURCE = 'grandstand-manga-v3.png';
export const FLOOR_MATERIAL_REPEAT = { wood: 4, teal: 1 } as const;

/** The atlas has wood above teal, without baked court markings or perspective. */
export function floorMaterialSourceRect(width: number, height: number, material: 'wood' | 'teal'): SourceRect {
  return { sx: 1, sy: material === 'wood' ? 1 : height / 2 + 1, sw: width - 2, sh: height / 2 - 2 };
}

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
  private woodCell?: HTMLCanvasElement;

  constructor(base = 'arena/v3') {
    this.base = base.replace(/^\//, '').replace(/\/$/, '');
    this.layers = {
      backdrop: this.createLayer('backdrop.png'),
      crowdFar: this.createLayer(GRANDSTAND_MANGA_SOURCE),
      ledMid: this.createLayer('led-mid.png'),
      floor: this.createLayer(FLOOR_MANGA_SOURCE),
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
    // Preserve the illustrator's proportions. The lower tiers and the barrier
    // occupy the visible band; the source's roof is cropped, never squashed.
    const crop = this.sceneCrop(width, height);
    const scale = width / crop.sw;
    const standHeight = 580;
    const source = coverSourceRect(img.naturalWidth, img.naturalHeight, 2560, standHeight);
    ctx.drawImage(
      img, source.sx, img.naturalHeight - source.sh, source.sw, source.sh,
      -crop.sx * scale, (40 - crop.sy) * scale, 2560 * scale, standHeight * scale,
    );
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

  /** Project both drawn materials onto real geometry, not a painted court. */
  drawFloorMaterials(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    halfWidth: number,
    halfLength: number,
  ): boolean {
    const img = this.getLayer('floor');
    if (!img) return false;

    this.drawFloorMaterial(ctx, cam, img, 'teal', halfWidth, halfLength);
    this.drawFloorMaterial(ctx, cam, img, 'wood', COURT_HALF_WIDTH, COURT_HALF_LENGTH);
    return true;
  }

  private drawFloorMaterial(ctx: CanvasRenderingContext2D, cam: Camera, img: HTMLImageElement,
    material: 'wood' | 'teal', halfWidth: number, halfLength: number): void {
    const source = floorMaterialSourceRect(img.naturalWidth, img.naturalHeight, material);
    const repeat = FLOOR_MATERIAL_REPEAT[material];
    // The wooden swatch represents 4.5m x 2.25m, not the whole 18m x 9m
    // court: its twelve courses become normal-width boards, not 75cm slabs.
    let pattern: CanvasPattern | null = null;
    if (repeat > 1) {
      if (!this.woodCell) {
        const cell = document.createElement('canvas'); cell.width = source.sw; cell.height = source.sh;
        const paint = cell.getContext('2d');
        if (paint) {
          paint.drawImage(img, source.sx, source.sy, source.sw, source.sh, 0, 0, source.sw, source.sh);
          this.woodCell = cell;
        }
      }
      if (this.woodCell) pattern = ctx.createPattern(this.woodCell, 'repeat');
    }
    const copies = pattern ? repeat : 1;
    const mapWidth = source.sw * copies, mapHeight = source.sh * copies;
    const farLeft = cam.projectFloor(halfWidth, -halfLength);
    const farRight = cam.projectFloor(halfWidth, halfLength);
    const nearLeft = cam.projectFloor(-halfWidth, -halfLength);
    const nearRight = cam.projectFloor(-halfWidth, halfLength);

    const a = (farRight.x - farLeft.x) / mapWidth;
    const b = (farRight.y - farLeft.y) / mapWidth;
    const c = (nearLeft.x - farLeft.x) / mapHeight;
    const d = (nearLeft.y - farLeft.y) / mapHeight;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(farLeft.x, farLeft.y);
    ctx.lineTo(farRight.x, farRight.y);
    ctx.lineTo(nearRight.x, nearRight.y);
    ctx.lineTo(nearLeft.x, nearLeft.y);
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.transform(a, b, c, d, farLeft.x, farLeft.y);
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, mapWidth, mapHeight); }
    else ctx.drawImage(img, source.sx, source.sy, source.sw, source.sh, 0, 0, source.sw, source.sh);
    ctx.restore();
  }
}
