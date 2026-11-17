import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { World, idleCommand } from '../src/core/world';
import { attackDir } from '../src/core/rules';
import { TEAMS } from '../src/game/teams';

describe('committed skill facing', () => {
  it.each(['block', 'spike', 'air_contact_jump_serve'] as const)('retains %s orientation throughout landing then releases to movement', action => {
    const p=new Player(7,'away','outside','TEST',defaultStats());
    p.setAnim(action);
    expect(p.presentation.lockedFacing).toBe(-1);
    p.setAnim('land');
    expect(p.presentation.phase).toBe('land');
    expect(p.presentation.lockedFacing).toBe(-1);
    expect(p.facing).toBe(-1);
    p.setAnim('ready');
    expect(p.presentation.lockedFacing).toBeUndefined();
  });

  it('does not let world ball tracking override a prepared pass or landing', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false});
    let prepares=0,landings=0;
    for(let step=0;step<5000;step++){
      w.step(idleCommand());
      for(const p of w.allPlayers()){
        const pr=p.presentation;
        if(pr.phase==='prepare'&&(pr.action==='set'||pr.action==='bump')){
          prepares++;expect(p.facing).toBe(pr.lockedFacing);
        }
        if(pr.phase==='land'&&(pr.action==='block'||pr.action==='spike'||pr.action==='jumpServe')){
          landings++;expect(pr.lockedFacing).toBe(attackDir(p.side));
          expect(p.facing).toBe(pr.lockedFacing);
        }
      }
      w.drainEvents();
    }
    expect(prepares).toBeGreaterThan(20);
    expect(landings).toBeGreaterThan(20);
  });
});
