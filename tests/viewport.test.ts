import { describe, expect, it } from 'vitest';
import { fitGameViewport } from '../src/render/viewport';

describe('shared manga composition', () => {
  it.each([[1280, 720], [1920, 1080], [505, 998], [1440, 900], [1920, 600]])(
    'fits %i × %i without enlarging the crowd separately from the court', (width, height) => {
      const fitted = fitGameViewport(width, height);
      expect(fitted.width).toBeLessThanOrEqual(width);
      expect(fitted.height).toBeLessThanOrEqual(height);
      expect(fitted.width / fitted.height).toBeCloseTo(16 / 9);
      expect(fitted.width / 1280).toBeCloseTo(fitted.height / 720);
    });
});
