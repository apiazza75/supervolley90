/** One shared composition: resize the whole scene, not its layers separately. */
export const GAME_VIEW_WIDTH = 1280;
export const GAME_VIEW_HEIGHT = 720;

export function fitGameViewport(availableWidth: number, availableHeight: number) {
  const scale = Math.min(Math.max(1, availableWidth) / GAME_VIEW_WIDTH,
    Math.max(1, availableHeight) / GAME_VIEW_HEIGHT);
  return { width: GAME_VIEW_WIDTH * scale, height: GAME_VIEW_HEIGHT * scale, scale };
}
