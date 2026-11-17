import { describe, expect, it } from 'vitest';
import { Ball } from '../src/core/ball';
import { canPlantForReceive } from '../src/core/receive-plant';
import { Player, defaultStats } from '../src/core/player';
import { v3 } from '../src/core/math3';
import { attackDir } from '../src/core/rules';

const scene = (side: 'home' | 'away') => {
  const dir = attackDir(side), p = new Player(4, side, 'outside', 'PASSER', defaultStats());
  p.pos = v3(0, -dir * 6.4, 0); p.vel = v3(0, -dir * 1.2, 0);
  const ball = new Ball(); ball.pos = v3(0, -dir * 2.8, 2.1); ball.vel = v3(0, -dir * 17, -2);
  return { p, ball };
};

describe('AI reception plant prediction', () => {
  it.each(['home', 'away'] as const)('brakes a reachable %s pass without mutating the athlete or ball', side => {
    const { p, ball } = scene(side), before = JSON.stringify({ p, ball });
    expect(canPlantForReceive(p, ball)).toBe(true);
    expect(JSON.stringify({ p, ball })).toBe(before);
  });

  it('does not stop a receiver who must still cover lateral distance', () => {
    const { p, ball } = scene('home'); p.pos.x = 3.5; p.vel.x = -4;
    expect(canPlantForReceive(p, ball)).toBe(false);
  });

  it('does not claim planted contact when the ball arrives before braking finishes', () => {
    const { p, ball } = scene('home'); ball.pos = v3(0, -6.2, 1.2); p.vel.y = -5;
    expect(canPlantForReceive(p, ball)).toBe(false);
  });

  it.each(['frozen', 'grounded', 'airborne', 'diving', 'down', 'gettingUp'])('does not plant in %s state', state => {
    const { p, ball } = scene('home');
    if (state === 'frozen') ball.frozen = true;
    if (state === 'grounded') ball.grounded = true;
    if (state === 'airborne') p.height = .3;
    if (state === 'diving') p.diving = true;
    if (state === 'down') p.downTime = .3;
    if (state === 'gettingUp') p.gettingUp = .3;
    expect(canPlantForReceive(p, ball)).toBe(false);
  });
});
