/**
 * Stable roster identity and art-direction briefs.
 *
 * The renderer varies whole-body build and masked team/skin/hair colours.
 * Sleeve cuts, kit patterns, pads and shoes below are briefs for future
 * DRAWN variants, not runtime overlays. Painting horizontal bands on guessed
 * body regions produced blue patches on moving arms and erased ink details.
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

/** Only differences actually applied by the renderer count here.
 * Costume/hair-shape briefs are not evidence of distinct rendered artwork.
 */
export function characterSignatureFingerprint(signature: CharacterSignature): string {
  return [
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
