import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { BALL_RADIUS, FIXED_DT, GAME_SPEED } from '../src/core/rules';
import { TEAMS } from '../src/game/teams';
import { Camera } from '../src/render/camera';
import { Renderer, serveSpriteState, spriteStyleFor } from '../src/render/renderer';
import { serveFrameForPlayer, spriteServePalmPoint } from '../src/render/sprite-figure';
import { serveTossPoses } from '../src/render/serve-charge-release';

describe('charge-to-toss continuity', () => {
  it.each([60,90,120,144].flatMap(hz => [1,10,20,66].map(steps => ({hz,steps}))))(
    'retains the actual held pose and palm through a $steps-step release at $hz Hz', ({hz,steps}) => {
      const w = new World({ home: TEAMS[0], away: TEAMS[1], seed:77, difficulty:1, humanControlsHome:true });
      const p = w.home.server;
      const renderer: Renderer = Object.assign(Object.create(Renderer.prototype), {
        camera: new Camera(), sheets: {}, serveBallRelease: null,
      });
      for (let i=0; i<steps; i++) {
        const cmd = idleCommand(); cmd.actionHeld=true; cmd.actionPressed=i===0; w.step(cmd); w.drainEvents();
      }
      const held = serveFrameForPlayer(p, serveSpriteState(w,p)!);
      w.step(idleCommand()); w.drainEvents();
      expect(serveFrameForPlayer(p, serveSpriteState(w,p)!)).toMatchObject({action:held.action,frame:held.frame});
      const expected = serveTossPoses(p.plansJumpServe, held.frame).map(s => `${s.action}/${s.frame}`);
      let accumulator=0, ticks=0;
      const visited: string[] = [];
      while (!w.serveTossInFlight && ticks<40) {
        const before = JSON.stringify({p,ball:w.ball,ready:w.serveStrikeReady});
        const service = serveSpriteState(w,p,accumulator)!;
        const sample = serveFrameForPlayer(p,service);
        visited.push(`${sample.action}/${sample.frame}`);
        const palm = spriteServePalmPoint(p,service,{},spriteStyleFor(p,w.home.config.colors),renderer.camera.scaleAt(p.pos.x));
        const ball = (renderer as any).viewServeBall(w,w.ball,accumulator);
        expect(ball.pos).toEqual({...palm,z:palm.z+BALL_RADIUS});
        expect(JSON.stringify({p,ball:w.ball,ready:w.serveStrikeReady})).toBe(before);
        expect(w.ball.frozen).toBe(true);
        accumulator += GAME_SPEED/hz;
        while (accumulator>=FIXED_DT && !w.serveTossInFlight) {
          w.step(idleCommand());w.drainEvents();ticks++;accumulator-=FIXED_DT;
        }
      }
      expect([...new Set(visited)]).toEqual(expected);
      expect(ticks).toBe(Math.ceil(.14/FIXED_DT));
      expect(w.serveTossInFlight).toBe(true);
      expect(w.serveTossGestureProgressAt(FIXED_DT)).toBeUndefined();
    });

  it('bounds visual extrapolation without advancing the physical stage', () => {
    const w = new World({home:TEAMS[0],away:TEAMS[1],seed:77,difficulty:1,humanControlsHome:true});
    const cmd=idleCommand();cmd.actionPressed=true;w.step(cmd);
    expect(w.serveTossGestureProgress).toBe(0);
    for (const lead of [-10,NaN,Infinity]) expect(w.serveTossGestureProgressAt(lead)).toBe(0);
    expect(w.serveTossGestureProgressAt(10)).toBe(FIXED_DT/.14);
    expect(w.serveTossGestureProgress).toBe(0);
    expect(w.ball.frozen).toBe(true);
  });
});
