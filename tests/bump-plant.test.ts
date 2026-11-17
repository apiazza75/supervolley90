import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT } from '../src/core/rules';
import { BUMP_GROUND_RECOVERY_TIME } from '../src/core/presentation';
import { BUMP_FOLLOW_FRAMES, CONTACT_FRAME, DURATION, SpriteTimeline } from '../src/render/sprite-figure';

describe('grounded bagher recovery footwork', () => {
  it('keeps the naturally planted receiver on his feet until every follow-through drawing finishes', () => {
    const w = new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:false});
    const clock = new SpriteTimeline(), frames = new Set<number>();
    let contact: {x:number;y:number;t:number}|undefined, resumed = false;
    for (let i=0;i<1800;i++) {
      w.step(null);
      const p = w.findPlayer(106)!;
      for (const e of w.drainEvents()) if (e.type==='contact' && e.playerId===p.id) {
        clock.cue(p.id,e.kind,e.airborne,e.facing,e.backSet);
        if (!contact && e.kind==='bump' && w.home.points+w.away.points===0) {
          contact = {...p.pos,t:w.rallyTime};
          expect(Math.hypot(p.vel.x,p.vel.y)).toBe(0);
        }
      }
      const pose = clock.frameFor(p,FIXED_DT);
      if (!contact) continue;
      const elapsed = w.rallyTime-contact.t;
      if (elapsed < BUMP_GROUND_RECOVERY_TIME-FIXED_DT/2) {
        expect(p.pos.x).toBeCloseTo(contact.x,10);
        expect(p.pos.y).toBeCloseTo(contact.y,10);
        expect(pose.action).toBe('bump'); frames.add(pose.frame);
      } else if (Math.hypot(p.vel.x,p.vel.y)>.1) resumed=true;
      if (elapsed>.8) break;
    }
    expect(contact).toBeDefined(); expect(resumed).toBe(true);
    expect([...frames]).toEqual(BUMP_FOLLOW_FRAMES);
  });

  it('matches the full remaining illustrated gesture', () => {
    expect(DURATION.bump*(24-CONTACT_FRAME.bump!)/24).toBeCloseTo(BUMP_GROUND_RECOVERY_TIME,12);
  });

  it('does not lock human movement after a bagher', () => {
    const w = new World({home:TEAMS[0],away:TEAMS[1],seed:1337,difficulty:1,humanControlsHome:true});
    const p=w.home.players[0]; w.home.activeId=p.id; w.phase='rally'; w.ball.frozen=true;
    p.pos.x=0;p.pos.y=-4;p.vel.x=0;p.vel.y=0;p.setAnim('bump_contact');
    const cmd=idleCommand();cmd.moveX=1;w.step(cmd);
    expect(p.vel.x).toBeGreaterThan(0);
  });
});
