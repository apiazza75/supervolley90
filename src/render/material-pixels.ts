export type HslTarget = readonly [number, number, number] | null;
/** Read a crop of a full binary material atlas without allocating crop buffers. */
export interface PackedMaterialRegion { offset: number; width: number; stride: number }
const SOURCE_LIGHTNESS = [.31, .7, .55, .16] as const;
const TONE_RANGE = [.9, .62, .7, .5] as const;

function hueChannel(t: number, p: number, q: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

/** Same material colour formula, without arrays/closures allocated per pixel.
 * The source alpha and unselected materials are untouched. Target priority
 * and rounding deliberately match the original renderer, including ties.
 */
export function recolourMaterialPixels(
  pixels: Uint8ClampedArray, mask: Uint8ClampedArray | Uint8Array,
  hair: Uint8ClampedArray | undefined, targets: readonly HslTarget[],
  packedRegion?: PackedMaterialRegion,
): void {
  let maskIndex = packedRegion?.offset ?? 0, column = 0;
  for (let o = 0; o < pixels.length; o += 4) {
    const bits = packedRegion ? mask[maskIndex] : 0;
    if (packedRegion) {
      maskIndex++;
      if (++column === packedRegion.width) {
        column = 0; maskIndex += packedRegion.stride - packedRegion.width;
      }
    }
    if (pixels[o + 3] < 24) continue;
    let channel = -1, weight = 0;
    const primary = packedRegion ? (bits & 1 ? 255 : 0) : mask[o];
    const secondary = packedRegion ? (bits & 2 ? 255 : 0) : mask[o + 1];
    const skin = packedRegion ? (bits & 4 ? 255 : 0) : mask[o + 2];
    const scalp = packedRegion ? (bits & 8 ? 255 : 0) : hair?.[o] ?? 0;
    if (targets[0] && primary > weight) { channel = 0; weight = primary; }
    if (targets[1] && secondary > weight) { channel = 1; weight = secondary; }
    if (targets[2] && skin > weight) { channel = 2; weight = skin; }
    if (targets[3] && scalp > weight) { channel = 3; weight = scalp; }
    if (channel < 0 || weight < 24) continue;
    const target = targets[channel]!;
    const R = pixels[o] / 255, G = pixels[o + 1] / 255, B = pixels[o + 2] / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sourceL = (max + min) / 2, delta = max - min;
    const sourceS = delta < 1e-6 ? 0 : sourceL > .5 ? delta / (2 - max - min) : delta / (max + min);
    const l = Math.max(.025, Math.min(.975, target[2] + (sourceL - SOURCE_LIGHTNESS[channel]) * TONE_RANGE[channel]));
    const s = Math.min(1, Math.max(target[1] * .82, sourceS * .42));
    let r: number, g: number, b: number;
    if (s < 1e-6) r = g = b = Math.round(l * 255);
    else {
      const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, h = target[0] / 360;
      r = Math.round(hueChannel(h + 1 / 3, p, q) * 255);
      g = Math.round(hueChannel(h, p, q) * 255);
      b = Math.round(hueChannel(h - 1 / 3, p, q) * 255);
    }
    const mix = weight / 255;
    pixels[o] = Math.round(pixels[o] * (1 - mix) + r * mix);
    pixels[o + 1] = Math.round(pixels[o + 1] * (1 - mix) + g * mix);
    pixels[o + 2] = Math.round(pixels[o + 2] * (1 - mix) + b * mix);
  }
}
