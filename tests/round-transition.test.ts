import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT, GAME_SPEED, POINT_BREAK_SECONDS, SET_BREAK_SECONDS } from '../src/core/rules';
import { roundTransitionOpacity, ROUND_FADE_SECONDS } from '../src/render/round-transition';

describe('short formation transitions', () => {
  it('keeps every live rally and almost all of each break unobscured', () => {
    for (const t of [0, .03, .2, 1, 2, 20]) expect(roundTransitionOpacity('rally', t)).toBe(0);
    expect(roundTransitionOpacity('dead', POINT_BREAK_SECONDS - ROUND_FADE_SECONDS - .001)).toBe(0);
    expect(roundTransitionOpacity('setBreak', SET_BREAK_SECONDS - ROUND_FADE_SECONDS - .001)).toBe(0);
    expect(roundTransitionOpacity('serve', ROUND_FADE_SECONDS)).toBe(0);
    expect(roundTransitionOpacity('matchOver', 0)).toBe(0);
  });

  it('fully covers both sides of the physical reset without extending its timer', () => {
    for (const offset of [0, FIXED_DT, FIXED_DT * 1.9]) {
      expect(roundTransitionOpacity('dead', POINT_BREAK_SECONDS - offset)).toBeCloseTo(1, 10);
      expect(roundTransitionOpacity('setBreak', SET_BREAK_SECONDS - offset)).toBeCloseTo(1, 10);
      expect(roundTransitionOpacity('serve', offset)).toBeCloseTo(1, 10);
    }
    const w = new World({home:TEAMS[0], away:TEAMS[1], humanControlsHome:false});
    w.phase = 'dead'; w.phaseTimer = POINT_BREAK_SECONDS - FIXED_DT / 2;
    w.step(null);
    expect(w.phase).toBe('serve');
    expect(w.phaseTimer).toBe(0);
  });

  it.each([30, 60, 120])('covers naturally observed formation resets at %s Hz', hz => {
    const w = new World({home:TEAMS[0],away:TEAMS[1],humanControlsHome:false,seed:4242});
    let remainder = 0, resets = 0, jumps = 0;
    let previous = {phase:w.phase, timer:w.phaseTimer, positions:w.allPlayers().map(p=>({id:p.id,x:p.pos.x,y:p.pos.y}))};
    for (let frame=0; frame<hz*100 && resets<3; frame++) {
      remainder += GAME_SPEED / hz;
      while (remainder>=FIXED_DT) {w.step(null);w.drainEvents();remainder-=FIXED_DT;}
      if (previous.phase==='dead' && w.phase==='serve') {
        resets++;
        for (const p of w.allPlayers()) {
          const before=previous.positions.find(item=>item.id===p.id);
          if (!before || Math.hypot(p.pos.x-before.x,p.pos.y-before.y)<.3) continue;
          jumps++;
          // The same physical body is drawn once on each side of the cut.
          // At low display rates the last old position or the first new one
          // can fall a few milliseconds into the dissolve; both remain dark.
          expect(roundTransitionOpacity(previous.phase,previous.timer)).toBeGreaterThan(.85);
          expect(roundTransitionOpacity(w.phase,w.phaseTimer)).toBeGreaterThan(.85);
        }
      }
      previous={phase:w.phase,timer:w.phaseTimer,positions:w.allPlayers().map(p=>({id:p.id,x:p.pos.x,y:p.pos.y}))};
    }
    expect(resets).toBe(3);
    expect(jumps).toBeGreaterThan(6);
  });
});
