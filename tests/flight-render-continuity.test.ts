import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { FIXED_DT, GRAVITY } from '../src/core/rules';
import { Renderer } from '../src/render/renderer';
import { remainingJumpFlight, jumpServeFollowFrame, blockFrameForPlayer } from '../src/render/sprite-figure';
import { BLOCK_AIR_FRAMES } from '../src/render/block-descent';

const renderer = Object.create(Renderer.prototype) as Renderer;
const project = (p: Player, lead: number): Player => (renderer as any).viewPlayer(p, lead);
const player = () => new Player(7, 'home', 'outside', 'TEST', defaultStats());

describe('continuous rendered flight between fixed ticks', () => {
  it.each([5, .1, -4])('advances both height and velocity without mutating a player moving at %s', velocity => {
    const p = player();p.height = 1;p.vertVel = velocity;
    const snapshot = JSON.stringify(p), lead = FIXED_DT * .8, view = project(p, lead);
    expect(view.vertVel).toBeCloseTo(velocity + GRAVITY * 1.15 * lead, 12);
    expect(view.height).toBeCloseTo(1 + (velocity + GRAVITY * 1.15 * FIXED_DT) * lead, 12);
    expect(remainingJumpFlight(view)).toBeLessThan(remainingJumpFlight(p));
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(project(p, 0)).toBe(p);
  });

  it('meets the next physical tick at exactly the same height and velocity', () => {
    const p = player();p.height = .7;p.vertVel = 3;
    const projected = project(p, FIXED_DT);
    p.step(FIXED_DT, 0, 0);
    expect(projected.height).toBeCloseTo(p.height, 12);
    expect(projected.vertVel).toBeCloseTo(p.vertVel, 12);
  });

  it('never rewinds follow-through or block poses as display samples cross physics ticks', () => {
    const p = player();p.height = .6;p.vertVel = 4.5;p.setAnim('air_contact_block');
    const flight = remainingJumpFlight(p);let previousFlight=flight,previousFollow=0,previousBlock=0;
    for(let tick=0;tick<180&&p.height>0;tick++) {
      for(let sub=0;sub<12;sub++) {
        const view=project(p,sub/12*FIXED_DT),remaining=remainingJumpFlight(view);
        const follow=jumpServeFollowFrame(view,flight).frame,block=blockFrameForPlayer(view).frame;
        expect(remaining).toBeLessThanOrEqual(previousFlight+1e-9);
        expect(follow).toBeGreaterThanOrEqual(previousFollow);
        // Landing has its own authored compression; airborne wall frames
        // must not rock back and forth before the floor is reached.
        const blockIndex=BLOCK_AIR_FRAMES.indexOf(block);
        if(view.height>0){expect(blockIndex).toBeGreaterThanOrEqual(previousBlock);previousBlock=blockIndex;}
        previousFlight=remaining;previousFollow=follow;
      }
      p.step(FIXED_DT,0,0);
    }
  });

  it('keeps planted athletes and paused views physically unchanged', () => {
    const p=player(),view=project(p,FIXED_DT*.9);
    expect(view.height).toBe(0);expect(view.vertVel).toBe(0);
    p.height=.01;p.vertVel=-5;
    const landed=project(p,FIXED_DT*.9);
    expect(landed.height).toBe(0);expect(landed.vertVel).toBe(0);
    expect(p.height).toBe(.01);expect(p.vertVel).toBe(-5);
  });
});
