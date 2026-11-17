/** Preserve saturated blue cloth highlights above the normal lightness gate.
 * Near-white HSL saturation alone is unreliable; require a substantial actual
 * blue/red difference. Neutral panels, warm skin and ink do not qualify.
 */
export function isBlueClothHighlight(r: number, g: number, b: number): boolean {
  return b >= 70 && b > r + 45 && b > g + 20 && g > r + 8;
}
