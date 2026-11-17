import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';

describe('serve framing', () => {
  it('never shakes the court or athletes after repeated impact events', () => {
    const camera = new Camera(), control = new Camera();
    for (let tick = 0; tick < 180; tick++) {
      camera.addShake(tick % 3 === 0 ? 30 : 6);
      const ball = { x: 1, y: Math.sin(tick / 30) * 8, z: 2 };
      camera.follow(ball, 1 / 60); control.follow(ball, 1 / 60);
      expect(camera.project(2, -4, 1)).toEqual(control.project(2, -4, 1));
      expect([camera.offsetX, camera.offsetY]).toEqual([0, 0]);
    }
  });
  it.each([640, 1280, 1920])('keeps the whole server on screen at width %i', width => {
    for (const side of [-1, 1]) {
      for (const courtX of [-4.2, 0, 4.2]) {
        const camera = new Camera();
        camera.resize(width, width * 9 / 16);
        // Service has just switched sides; the previous pan is adverse.
        camera.panY = -side * 1.2;
        const server = { x: courtX, y: side * 11.05, z: 0 };
        const ball = { ...server, y: server.y - side * .35, z: 1.35 };
        for (let tick = 0; tick < 180; tick++) {
          camera.follow(ball, 1 / 60, server);
          const position = camera.projectFloor(server.x, server.y);
          expect(position.x).toBeGreaterThanOrEqual(width * .05 - .001);
          expect(position.x).toBeLessThanOrEqual(width * .95 + .001);
        }
      }
    }
  });

  it('keeps the normal rally projection unchanged without a server', () => {
    const camera = new Camera();
    camera.follow({ x: 0, y: 9, z: 1 }, 0);
    expect(camera.projectFloor(0, 0).x).toBe(640);
    expect(camera.projectFloor(0, 9).x).toBe(1135);
  });
});
