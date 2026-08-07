/**
 * Stable, structural player identities.
 *
 * The source atlases stay shared.  Each already-cached recoloured atlas receives
 * one deterministic identity treatment: a different hair silhouette and face,
 * uniform construction, sleeves, pads, socks and shoes.  This is intentionally
 * visual-only; collision and animation geometry never change.
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

export const CHARACTER_SIGNATURES: readonly CharacterSignature[] = [
  { id: 0, hair: 'crop', beard: 'none', sleeves: 'short', pattern: 'centre', kneePads: 'double', socks: 'low', shoes: 'light', widthDelta: -0.015, heightDelta: 0.0 },
  { id: 1, hair: 'fade', beard: 'stubble', sleeves: 'long', pattern: 'side', kneePads: 'double', socks: 'high', shoes: 'dark', widthDelta: 0.035, heightDelta: 0.006 },
  { id: 2, hair: 'part', beard: 'goatee', sleeves: 'short', pattern: 'diagonal', kneePads: 'single', socks: 'stripe', shoes: 'contrast', widthDelta: 0.055, heightDelta: -0.004 },
  { id: 3, hair: 'curls', beard: 'full', sleeves: 'threeQuarter', pattern: 'yoke', kneePads: 'contrast', socks: 'mid', shoes: 'light', widthDelta: 0.0, heightDelta: 0.008 },
  { id: 4, hair: 'bun', beard: 'none', sleeves: 'long', pattern: 'chevron', kneePads: 'none', socks: 'high', shoes: 'dark', widthDelta: -0.035, heightDelta: 0.002 },
  { id: 5, hair: 'mohawk', beard: 'stubble', sleeves: 'sleeveless', pattern: 'pinstripe', kneePads: 'double', socks: 'low', shoes: 'contrast', widthDelta: 0.02, heightDelta: 0.012 },
  // The seventh signature is reserved for the libero.  It remains unique when
  // the libero replaces either middle, and the strongly contrasted kit is still
  // supplied by renderer.ts.
  { id: 6, hair: 'headband', beard: 'goatee', sleeves: 'short', pattern: 'libero', kneePads: 'contrast', socks: 'stripe', shoes: 'light', widthDelta: -0.045, heightDelta: -0.008 },
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

export function characterSignatureFingerprint(signature: CharacterSignature): string {
  return [
    signature.hair,
    signature.beard,
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

function css(c: RGB, alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
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

interface HairBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

function hairBounds(
  frame: SignatureFrame,
  hairMask: Uint8ClampedArray | undefined,
  materialMask: Uint8ClampedArray | undefined,
  sheetWidth: number,
): HairBounds | null {
  const bodyHeight = Math.max(1, frame.boxBottom - frame.boxTop);

  // How much of the body, from the crown down, may contain the head.
  //
  // This was 0.42, which on any pose with the arms up — spike, block, serve,
  // most of the sheet — reaches well past the shoulders. The skin fallback then
  // matched forearms and hands, the bounds grew as wide as the player's
  // wingspan, and the hair shapes were drawn at that size: a black slab over
  // half the figure. The head occupies roughly the top eighth.
  const yLimit = Math.min(frame.sh - 1, frame.boxTop + bodyHeight * 0.2);

  // A head is also bounded in *width*. Anything wider is an arm, and taking it
  // for a head is precisely the mistake that has to be impossible here.
  const maxHeadWidth = bodyHeight * 0.34;

  const scanChannel = (channel: 'hair' | 'skin'): HairBounds => {
    const b: HairBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, count: 0 };
    for (let ly = Math.max(0, Math.floor(frame.boxTop)); ly <= Math.ceil(yLimit); ly++) {
      for (let lx = 0; lx < frame.sw; lx++) {
        const gi = (frame.sy + ly) * sheetWidth + frame.sx + lx;
        const weight = channel === 'hair' ? hairMask?.[gi * 4] ?? 0 : materialMask?.[gi * 4 + 2] ?? 0;
        if (weight < 80) continue;
        b.minX = Math.min(b.minX, lx);
        b.maxX = Math.max(b.maxX, lx);
        b.minY = Math.min(b.minY, ly);
        b.maxY = Math.max(b.maxY, ly);
        b.count++;
      }
    }
    return b;
  };

  const plausible = (b: HairBounds): boolean =>
    b.count >= 8 && b.maxX - b.minX + 1 <= maxHeadWidth;

  // Each channel is scanned into its own bounds. The previous version let the
  // fallback accumulate on top of a partial hair result, so one stray pixel of
  // hair plus a forearm produced a box spanning both.
  const fromHair = scanChannel('hair');
  if (plausible(fromHair)) return fromHair;
  const fromSkin = scanChannel('skin');
  if (plausible(fromSkin)) return fromSkin;

  // No head could be located with confidence. Draw nothing: the figure keeps
  // its authored appearance, which is always better than a slab of colour.
  return null;
}

function drawHairAndFace(
  ctx: CanvasRenderingContext2D,
  frame: SignatureFrame,
  signature: CharacterSignature,
  bounds: HairBounds,
  hair: RGB,
  skin: RGB,
): void {
  const cx = frame.sx + (bounds.minX + bounds.maxX) * 0.5;
  const top = frame.sy + bounds.minY;
  const bottom = frame.sy + bounds.maxY;
  const hw = Math.max(5, (bounds.maxX - bounds.minX + 1) * 0.52);
  const hh = Math.max(5, bounds.maxY - bounds.minY + 1);
  const faceY = bottom + hh * 0.58;
  const outline = shade(hair, 0.42);

  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.sx, frame.sy, frame.sw, frame.sh);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(outline, 0.92);
  ctx.fillStyle = css(hair, 0.98);
  ctx.lineWidth = Math.max(1.2, hw * 0.13);

  switch (signature.hair) {
    case 'crop':
      ctx.beginPath();
      ctx.ellipse(cx, top + hh * 0.42, hw * 0.9, hh * 0.48, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      break;
    case 'fade':
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.92, bottom - hh * 0.08);
      ctx.lineTo(cx - hw * 0.72, top - hh * 0.22);
      ctx.lineTo(cx + hw * 0.58, top - hh * 0.3);
      ctx.lineTo(cx + hw * 0.92, bottom - hh * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'part':
      ctx.beginPath();
      ctx.moveTo(cx - hw, bottom);
      ctx.quadraticCurveTo(cx - hw * 0.35, top - hh * 0.35, cx + hw * 1.08, top + hh * 0.18);
      ctx.lineTo(cx + hw * 0.86, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = css(shade(hair, 1.45), 0.58);
      ctx.beginPath();
      ctx.moveTo(cx + hw * 0.05, top - hh * 0.13);
      ctx.lineTo(cx + hw * 0.18, bottom - hh * 0.2);
      ctx.stroke();
      break;
    case 'curls':
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        const x = cx + Math.cos(a) * hw * 0.86;
        const y = bottom + Math.sin(a) * hh * 0.82;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2.5, hw * 0.34), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'bun':
      ctx.beginPath();
      ctx.ellipse(cx, top + hh * 0.43, hw * 0.92, hh * 0.55, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - hw * 0.72, top - hh * 0.03, Math.max(3.2, hw * 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'mohawk':
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.78, top + hh * 0.12);
      for (let i = 0; i < 5; i++) {
        const x = cx - hw * 0.7 + (i / 4) * hw * 1.4;
        ctx.lineTo(x, top - hh * (0.28 + (i % 2) * 0.22));
        ctx.lineTo(x + hw * 0.18, top + hh * 0.16);
      }
      ctx.lineTo(cx + hw * 0.82, bottom);
      ctx.lineTo(cx - hw * 0.82, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'headband':
      ctx.beginPath();
      ctx.ellipse(cx, top + hh * 0.42, hw * 0.9, hh * 0.48, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(246,249,255,0.96)';
      ctx.lineWidth = Math.max(2, hh * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.9, bottom - hh * 0.15);
      ctx.lineTo(cx + hw * 0.92, bottom - hh * 0.15);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,95,90,0.9)';
      ctx.lineWidth = Math.max(1, hh * 0.08);
      ctx.stroke();
      break;
  }

  // Face variants are deliberately small but structural in profile.  They use
  // the hair colour, never a kit colour, so the face cannot become team-coloured.
  ctx.fillStyle = css(hair, signature.beard === 'stubble' ? 0.45 : 0.9);
  ctx.strokeStyle = css(outline, 0.8);
  if (signature.beard === 'stubble') {
    ctx.lineWidth = Math.max(1, hw * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.5, faceY);
    ctx.quadraticCurveTo(cx, faceY + hh * 0.42, cx + hw * 0.52, faceY);
    ctx.stroke();
  } else if (signature.beard === 'goatee') {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.24, faceY - hh * 0.04);
    ctx.lineTo(cx + hw * 0.24, faceY - hh * 0.04);
    ctx.lineTo(cx + hw * 0.12, faceY + hh * 0.5);
    ctx.lineTo(cx - hw * 0.1, faceY + hh * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (signature.beard === 'full') {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.62, faceY - hh * 0.16);
    ctx.quadraticCurveTo(cx - hw * 0.5, faceY + hh * 0.5, cx, faceY + hh * 0.66);
    ctx.quadraticCurveTo(cx + hw * 0.52, faceY + hh * 0.5, cx + hw * 0.62, faceY - hh * 0.16);
    ctx.quadraticCurveTo(cx, faceY + hh * 0.06, cx - hw * 0.62, faceY - hh * 0.16);
    ctx.fill();
    ctx.stroke();
  }

  // A tiny skin highlight keeps large hair additions from reading as a helmet.
  ctx.fillStyle = css(skin, 0.48);
  ctx.beginPath();
  ctx.ellipse(cx + hw * 0.2, faceY - hh * 0.08, Math.max(1, hw * 0.08), Math.max(1, hh * 0.06), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  const hairCtx = sheet.hairMaskCanvas?.getContext('2d', { willReadFrequently: true });
  const material = materialCtx.getImageData(0, 0, width, height).data;
  const hairMask = hairCtx?.getImageData(0, 0, width, height).data;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  const primary = parseColour(palette.primary, [42, 91, 210]);
  const secondary = parseColour(palette.secondary, [244, 246, 251]);
  const skin = parseColour(palette.skin, [222, 166, 120]);
  const hair = parseColour(palette.hair, [28, 22, 21]);
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

  for (const frame of sheet.frames) {
    const bounds = hairBounds(frame, hairMask, material, width);
    if (bounds) drawHairAndFace(ctx, frame, signature, bounds, hair, skin);
  }
}
