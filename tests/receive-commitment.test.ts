import { expect, it } from 'vitest';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { FIXED_DT, attackDir, otherSide } from '../src/core/rules';
import { SpriteTimeline } from '../src/render/sprite-figure';

it.each(['home', 'away'] as const)('preserves only the legal assigned %s dig through base-defence reassignment', side => {
  for (const state of ['incoming', 'unassigned', 'outgoing', 'teammate-touch', 'serve', 'unreachable', 'airborne', 'diving', 'down'] as const) {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false });
    const p = w.team(side).frontRow()[0], dir = attackDir(side);
    const brain = (w as any).brains[side];
    w.phase = 'rally'; w.lastToucherSide = otherSide(side);
    w.ball.frozen = false; w.ball.grounded = false;
    p.pos = { x: 0, y: -dir, z: 0 }; p.vel = { x: 0, y: 0, z: 0 }; p.setAnim('bump_ready');
    w.ball.pos = { x: 0, y: dir * .8, z: 3.2 }; w.ball.vel = { x: 0, y: -dir * 6, z: -3 };
    brain.designatedReceiver = p.id;
    if (state === 'unassigned') brain.designatedReceiver = -1;
    if (state === 'outgoing') w.ball.vel.y *= -1;
    if (state === 'teammate-touch') w.lastToucherSide = side;
    if (state === 'serve') w.phase = 'serve';
    if (state === 'unreachable') w.ball.pos.x = 4;
    if (state === 'airborne') p.height = .3;
    if (state === 'diving') p.diving = true;
    if (state === 'down') p.downTime = .3;
    const ballBefore = JSON.stringify(w.ball), positionBefore = JSON.stringify(p.pos);
    brain.assignBaseDefense();
    expect(brain.stateOf(p).job, state).toBe(state === 'incoming' ? 'receive' : 'block');
    expect(JSON.stringify(w.ball)).toBe(ballBefore);
    expect(JSON.stringify(p.pos)).toBe(positionBefore);
    expect(w.team(side).players.filter(m => brain.stateOf(m).job === 'receive')).toHaveLength(state === 'incoming' ? 1 : 0);
  }
});

it('does not recall a natural prepared front-row receiver before the incoming spike arrives', () => {
  const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false });
  const timeline = new SpriteTimeline();
  let receiver: number | undefined, previousFrame = -1, planted: { x: number; y: number } | undefined;
  for (let i = 0; i < 9000; i++) {
    w.step(null);const events = w.drainEvents();
    for (const e of events) if (e.type === 'contact') timeline.cue(e.playerId, e.kind, e.airborne, e.facing, e.backSet);
    for(const p of w.allPlayers()) {
      const before=JSON.stringify({p,ball:w.ball}),pose=timeline.frameFor(p,FIXED_DT);
      expect(JSON.stringify({p,ball:w.ball})).toBe(before);
      if(receiver===undefined&&w.team(p.side).isFrontRow(p)&&p.anim==='bump_ready'&&p.presentation.sourceJob==='receive')receiver=p.id;
      if(p.id!==receiver)continue;
      const hit=events.some(e=>e.type==='contact'&&e.playerId===p.id&&e.kind==='bump');
      if(hit){
        expect(previousFrame).toBe(8);expect(pose).toMatchObject({action:'bump',frame:9});
        expect(p.height).toBe(0);expect(planted).toBeDefined();return;
      }
      expect(p.presentation.sourceJob).toBe('receive');expect(p.anim).toBe('bump_ready');
      expect(pose.action).toBe('bump');expect(p.height).toBe(0);
      if(Math.hypot(p.vel.x,p.vel.y)<.01)planted??={...p.pos};
      if(planted){expect(p.pos.x).toBeCloseTo(planted.x,10);expect(p.pos.y).toBeCloseTo(planted.y,10);}
      previousFrame=pose.frame;
    }
  }
  throw new Error('Natural prepared front-row reception was not completed');
});
