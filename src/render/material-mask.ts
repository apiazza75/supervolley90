/** Exact binary classification: primary, secondary, skin and hair bits. */
export interface MaterialMask { data: Uint8Array; width: number; height: number }

/** Decline weighted legacy masks rather than quantising away their artwork. */
export function packBinaryMaterialMasks(mask: Uint8ClampedArray, hair: Uint8ClampedArray): Uint8Array | undefined {
  if (mask.length !== hair.length || mask.length % 4 !== 0) return undefined;
  const packed = new Uint8Array(mask.length / 4);
  for (let o = 0, i = 0; o < mask.length; o += 4, i++) {
    const primary = mask[o], secondary = mask[o + 1], skin = mask[o + 2], scalp = hair[o];
    if ((primary !== 0 && primary !== 255) || (secondary !== 0 && secondary !== 255)
      || (skin !== 0 && skin !== 255) || (scalp !== 0 && scalp !== 255)) return undefined;
    packed[i] = (primary ? 1 : 0) | (secondary ? 2 : 0) | (skin ? 4 : 0) | (scalp ? 8 : 0);
  }
  return packed;
}
