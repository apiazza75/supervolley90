/**
 * Stable, structural player identities.
 *
 * The source atlases stay shared. Each already-cached recoloured atlas receives
 * one deterministic identity treatment: uniform construction, sleeves, pads,
 * socks and shoes. This is intentionally visual-only; collision and animation
 * geometry never change.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * An earlier version also painted a hair silhouette and a face onto every
 * frame. It could not work, and the reason is worth writing down so nobody
 * rebuilds it.
 *
 * The shipped atlases are drawn artwork — ten 3072x2048 cut-out sheets, sliced
 * on an exact 6x4 grid. There is no skeleton behind them and therefore no head
 * joint to ask. `src/render/rig.ts` has one, but it is a separate procedural
 * figure that generates none of these sheets. So the head had to be found by
 * scanning pixels, and a found head is a guess.
 *
 * Measured across the ten sheets, the top fifth of the drawing — the band the
 * scan searched — is wider than any plausible head on nine of them, and on
 * dive.png it is 2.39 times the whole body height, because at full stretch the
 * arms are up there too. The scan either declined (drawing nothing) or locked
 * onto a forearm and painted a slab of hair colour across the player's face,
 * frame by frame, unpredictably. That defect is what sank the first delivery.
 *
 * Identity is carried instead by four things that do not need to know where
 * the head is, and so cannot fail one frame in twenty-four:
 *
 *   1. hair colour   — the `hair` channel of the palette, applied by recolour()
 *                      through the authored hair mask;
 *   2. skin tone     — the `skin` channel, likewise;
 *   3. kit pattern   — patternAt() over the primary mask, which is the largest
 *                      and flattest region in every pose;
 *   4. build         — heightScale and widthScale, applied by the renderer.
 *
 * If the six ever need to be more distinct than that, the way to add hair
 * SHAPE is a static table of measured head anchors — ten actions by
 * twenty-four frames, verified by eye on a contact sheet — not another
 * search at runtime.
 */

export type HairStyle = 'crop' | 'fade' | 'part' | 'curls' | 'bun' | 'mohawk' | 'headband';
export type BeardStyle = 'none' | 'stubble' | 'goatee' | 'full';
export type SleeveStyle = 'sleeveless' | 'short' | 'threeQuarter' | 'long';
export type KitPattern = 'centre' | 'diagonal' | 'side' | 'yoke' | 'chevron' | 'pinstripe' | 'libero';

export interface CharacterSignature {
  /** Stable local roster id, 0..6. */
  id: number;
  hair: HairStyle;
  beard: BeardStyle;
  sleeves: SleeveStyle;
  pattern: KitPattern;
  kneePads: 'none' | 'single' | 'double' | 'contrast';
  socks: 'low' | 'mid' | 'high' | 'stripe';
  shoes: 'dark' | 'light' | 'contrast';
  /** Additional visual build only; physics continues to use the authored body. */
  widthDelta: number;
  heightDelta: number;
}

/**
 * The authored roster.
 *
 * `hair` and `beard` are kept as authored data although nothing draws them
 * today: they are the specification a future anchored implementation would
 * follow, and throwing them away would mean inventing them again. They are
 * deliberately absent from the fingerprint below — see the note there.
 *
 * The build deltas carry more of the load than they used to. At the previous
 * spread of two per cent in height the six were separated almost entirely by
 * their role, and both teams field the same roles, so the two sides had the
 * same six silhouettes. Eight per cent from tallest to shortest is a
 * difference you can see across the court without reading a shirt.
 */
export const CHARACTER_SIGNATURES: readonly CharacterSignature[] = [
  { id: 0, hair: 'crop', beard: 'none', sleeves: 'short', pattern: 'centre', kneePads: 'double', socks: 'low', shoes: 'light', widthDelta: -0.015, heightDelta: 0.014 },
  { id: 1, hair: 'fade', beard: 'stubble', sleeves: 'long', pattern: 'side', kneePads: 'double', socks: 'high', shoes: 'dark', widthDelta: 0.045, heightDelta: -0.026 },
  { id: 2, hair: 'part', beard: 'goatee', sleeves: 'short', pattern: 'diagonal', kneePads: 'single', socks: 'stripe', shoes: 'contrast', widthDelta: 0.062, heightDelta: 0.038 },
  { id: 3, hair: 'curls', beard: 'full', sleeves: 'threeQuarter', pattern: 'yoke', kneePads: 'contrast', socks: 'mid', shoes: 'light', widthDelta: -0.008, heightDelta: -0.04 },
  { id: 4, hair: 'bun', beard: 'none', sleeves: 'long', pattern: 'chevron', kneePads: 'none', socks: 'high', shoes: 'dark', widthDelta: -0.048, heightDelta: 0.026 },
  { id: 5, hair: 'mohawk', beard: 'stubble', sleeves: 'sleeveless', pattern: 'pinstripe', kneePads: 'double', socks: 'low', shoes: 'contrast', widthDelta: 0.024, heightDelta: -0.012 },
  // The seventh signature is reserved for the libero.  It remains unique when
  // the libero replaces either middle, and the strongly contrasted kit is still
  // supplied by renderer.ts.
  { id: 6, hair: 'headband', beard: 'goatee', sleeves: 'short', pattern: 'libero', kneePads: 'contrast', socks: 'stripe', shoes: 'light', widthDelta: -0.055, heightDelta: -0.05 },
] as const;

export interface PlayerIdentitySource {
  id: number;
}

/**
 * Home ids are 0..6, away ids 100..106, replay copies add 1000.  Reducing the
 * stable roster portion keeps the identity unchanged in live play and replay.
 */
export function characterSignatureId(playerOrId: PlayerIdentitySource | number): number {
  const id = typeof playerOrId === 'number' ? playerOrId : playerOrId.id;
  const rosterId = Math.abs(Math.trunc(id)) % 100;
  return rosterId % CHARACTER_SIGNATURES.length;
}

export function characterSignatureFor(playerOrId: PlayerIdentitySource | number): CharacterSignature {
  return CHARACTER_SIGNATURES[characterSignatureId(playerOrId)];
}

/**
 * What makes two players look different, in the strict sense of differing
 * pixels.
 *
 * `hair` and `beard` are excluded on purpose. Nothing draws them, and counting
 * a field that reaches no pixel is how a gate ends up certifying six identical
 * players as six distinct ones — the precise failure this whole exercise
 * exists to correct. Every field listed here is applied by
 * applyCharacterSignature or by the renderer's build scaling, and the seven of
 * them are still pairwise distinct across the roster, so the acceptance gate
 * reads 6 and 6 on drawn attributes alone.
 *
 * Per-player hair and skin COLOUR do differ, and visibly, but they come from
 * the renderer's palettes rather than from this table, so they are not
 * fingerprinted here.
 */
export function characterSignatureFingerprint(signature: CharacterSignature): string {
  return [
    signature.sleeves,
    signature.pattern,
    signature.kneePads,
    signature.socks,
    signature.shoes,
    signature.widthDelta.toFixed(3),
    signature.heightDelta.toFixed(3),
  ].join('|');
}

/** Count the structures that will actually be drawn, not merely assigned IDs. */
export function countDistinctCharacterSignatures(players: readonly PlayerIdentitySource[]): number {
  return new Set(
    players.map((player) => characterSignatureFingerprint(characterSignatureFor(player))),
  ).size;
}

interface SignatureFrame {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  footX: number;
  footY: number;
  boxTop: number;
  boxBottom: number;
}

interface SignatureSheet {
  canvas: HTMLCanvasElement;
  maskCanvas?: HTMLCanvasElement;
  hairMaskCanvas?: HTMLCanvasElement;
  frames: SignatureFrame[];
  nativeBodyHeight?: number;
}

export interface SignaturePalette {
  primary: string;
  secondary?: string;
  skin?: string;
  hair?: string;
  /** `undefined` keeps legacy behaviour; 0..6 activates a structural variant. */
  signature?: number;
}

type RGB = [number, number, number];

function parseColour(value: string | undefined, fallback: RGB): RGB {
  if (!value) return fallback;
  const v = value.trim();
  const hex6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(v);
  if (hex6) return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
  const hex3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(v);
  if (hex3) return hex3.slice(1).map((x) => parseInt(`${x}${x}`, 16)) as RGB;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(v);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
}

function shade(c: RGB, amount: number): RGB {
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v * amount)))) as RGB;
}

function mixPixel(data: Uint8ClampedArray, offset: number, target: RGB, amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  data[offset] = Math.round(data[offset] * (1 - a) + target[0] * a);
  data[offset + 1] = Math.round(data[offset + 1] * (1 - a) + target[1] * a);
  data[offset + 2] = Math.round(data[offset + 2] * (1 - a) + target[2] * a);
}

function patternAt(pattern: KitPattern, x: number, y: number): boolean {
  // Only the torso/shorts material mask is touched; x and y are normalised to
  // authored body height so crouches and jumps retain the same construction.
  if (y < 0.17 || y > 0.7) return false;
  switch (pattern) {
    case 'centre':
      return Math.abs(x) < 0.075;
    case 'diagonal':
      return Math.abs(x - (y - 0.4) * 0.9) < 0.075;
    case 'side':
      return Math.abs(x) > 0.22 && Math.abs(x) < 0.39;
    case 'yoke':
      return y < 0.31 || (y < 0.39 && Math.abs(x) > 0.23);
    case 'chevron':
      return y > 0.25 && y < 0.52 && Math.abs(y - (0.31 + Math.abs(x) * 0.55)) < 0.045;
    case 'pinstripe':
      return Math.abs(((x + 0.55) * 10) % 1 - 0.5) < 0.11;
    case 'libero':
      return Math.abs(x + (y - 0.42) * 1.15) < 0.14 || (y < 0.28 && Math.abs(x) < 0.34);
  }
}

function nearPrimary(mask: Uint8ClampedArray, index: number, width: number): boolean {
  // A small cross is enough to identify skin attached to a shirt sleeve without
  // painting the face or an isolated hand as fabric.
  const samples = [index - 6, index + 6, index - width * 6, index + width * 6, index - 11, index + 11];
  for (const i of samples) {
    if (i >= 0 && i * 4 < mask.length && mask[i * 4] > 76) return true;
  }
  return false;
}


/**
 * Bake one structural signature into a recoloured atlas.  The caller invokes
 * this once when it creates the already-required per-palette cache canvas.
 */
export function applyCharacterSignature(
  ctx: CanvasRenderingContext2D,
  sheet: SignatureSheet,
  palette: SignaturePalette,
): void {
  if (palette.signature === undefined || !Number.isFinite(palette.signature)) return;
  const signature = CHARACTER_SIGNATURES[Math.abs(Math.trunc(palette.signature)) % CHARACTER_SIGNATURES.length];
  const width = sheet.canvas.width;
  const height = sheet.canvas.height;
  const materialCtx = sheet.maskCanvas?.getContext('2d', { willReadFrequently: true });
  if (!materialCtx) return; // strict v3 sheets always have masks; legacy sheets stay untouched.
  const material = materialCtx.getImageData(0, 0, width, height).data;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  // The hair mask is still built, and still used — by recolour(), one step
  // earlier, to move each player's hair to their own colour. Nothing in this
  // function reads it any more.
  const primary = parseColour(palette.primary, [42, 91, 210]);
  const secondary = parseColour(palette.secondary, [244, 246, 251]);
  const pad = signature.kneePads === 'contrast' ? shade(secondary, 0.72) : [16, 20, 28] as RGB;
  const sock = signature.socks === 'stripe' ? secondary : shade(secondary, signature.socks === 'high' ? 0.88 : 1.02);
  const shoe = signature.shoes === 'dark' ? [12, 17, 25] as RGB : signature.shoes === 'contrast' ? shade(secondary, 0.82) : [235, 239, 246] as RGB;

  for (const frame of sheet.frames) {
    const bodyHeight = Math.max(1, frame.boxBottom - frame.boxTop);
    for (let ly = Math.max(0, Math.floor(frame.boxTop)); ly <= Math.min(frame.sh - 1, Math.ceil(frame.boxBottom)); ly++) {
      const relY = (ly - frame.boxTop) / bodyHeight;
      for (let lx = 0; lx < frame.sw; lx++) {
        const gx = frame.sx + lx;
        const gy = frame.sy + ly;
        if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
        const gi = gy * width + gx;
        const o = gi * 4;
        if (data[o + 3] < 24) continue;
        const primaryWeight = material[o] / 255;
        const skinWeight = material[o + 2] / 255;
        const relX = (lx - frame.footX) / bodyHeight;

        if (primaryWeight > 0.08 && patternAt(signature.pattern, relX, relY)) {
          mixPixel(data, o, secondary, Math.min(0.78, primaryWeight * 0.72));
        }

        if (
          skinWeight > 0.12 &&
          signature.sleeves !== 'sleeveless' &&
          relY > 0.22 &&
          relY < (signature.sleeves === 'long' ? 0.61 : signature.sleeves === 'threeQuarter' ? 0.5 : 0.39) &&
          nearPrimary(material, gi, width)
        ) {
          mixPixel(data, o, primary, skinWeight * (signature.sleeves === 'short' ? 0.52 : 0.86));
        }

        const kneeBand = relY > 0.61 && relY < 0.76;
        const onLeg = Math.abs(relX) > 0.055 && Math.abs(relX) < 0.42;
        const selectedLeg = signature.kneePads !== 'single' || relX < 0;
        if (signature.kneePads !== 'none' && kneeBand && onLeg && selectedLeg && (primaryWeight + skinWeight) > 0.08) {
          mixPixel(data, o, pad, Math.min(0.82, (primaryWeight + skinWeight) * 0.72));
        }

        const sockTop = signature.socks === 'high' ? 0.73 : signature.socks === 'mid' ? 0.8 : 0.86;
        if (relY > sockTop && relY < 0.94 && (skinWeight > 0.08 || primaryWeight > 0.22)) {
          const stripeGap = signature.socks === 'stripe' && Math.floor((relY - sockTop) * 42) % 2 === 0;
          mixPixel(data, o, stripeGap ? primary : sock, Math.max(skinWeight, primaryWeight) * 0.72);
        }
        if (relY >= 0.9) mixPixel(data, o, shoe, 0.58);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
