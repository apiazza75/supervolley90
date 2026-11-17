import { JUMP_SERVE_TOSS_FRAMES } from './jump-serve-entry';

/** Shared, authored charge-to-release drawings live in the standing atlas. */
export const SERVE_CHARGE_RELEASE_FRAMES = [32, 33, 34, 35] as const;
export const SERVE_CHARGE_RELEASE_PALMS: Readonly<Record<number, { x: number; y: number }>> = {
  32: { x: 395, y: 198 }, 33: { x: 395, y: 154 },
  34: { x: 395, y: 147 }, 35: { x: 393, y: 123 },
};

/** Start at the actual held pose, including a short tap, without a pose jump. */
export function serveTossPoses(jumping: boolean, heldFrame: number) {
  const charge = (jumping ? SERVE_CHARGE_RELEASE_FRAMES : [32, 33])
    .map(frame => ({ action: 'serve' as const, frame }));
  const release = (jumping ? JUMP_SERVE_TOSS_FRAMES : [4, 5, 6])
    .map(frame => ({ action: jumping ? 'jumpServe' as const : 'serve' as const, frame }));
  return [{ action: 'serve' as const, frame: heldFrame }, ...charge, ...release];
}
