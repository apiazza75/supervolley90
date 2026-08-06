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

/**
 * The 2026 arena is rendered as three live procedural layers rather than the
 * earlier low-detail PNG backdrop: hall/crowd, court surface and projected net.
 * Keeping this adapter means old callers stay stable while stale raster files
 * can remain in public/ without ever determining the final look.
 */
export class ArenaArtwork {
  constructor(_base = 'arena') {}

  /** Three complete live layers are always available. */
  get loadedCount(): number {
    return 3;
  }

  drawBackdrop(_ctx: CanvasRenderingContext2D, _width: number, _height: number): boolean {
    return false;
  }

  drawCourtFloor(
    _ctx: CanvasRenderingContext2D,
    _cam: Camera,
    _halfWidth: number,
    _halfLength: number,
  ): boolean {
    return false;
  }

  drawNet(
    _ctx: CanvasRenderingContext2D,
    _centreX: number,
    _top: number,
    _bottom: number,
    _worldUnitPixels: number,
  ): boolean {
    return false;
  }
}
