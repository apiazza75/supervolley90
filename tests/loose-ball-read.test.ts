import { describe, expect, it } from 'vitest';
import { World, idleCommand } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { SpriteTimeline } from '../src/render/sprite-figure';
import { FIXED_DT } from '../src/core/rules';
import { looseBallReader } from '../src/core/loose-ball-read';
import { Ball } from '../src/core/ball';
import { Player, defaultStats } from '../src/core/player';
import { v3 } from '../src/core/math3';
import { BUMP_PREPARATION_FRAMES } from '../src/render/bump-preparation';

function looseScene() {
  const p = new Player(4, 'away', 'outside', 'DEFENDER', defaultStats());
  p.pos = v3(0, 1, 0);
  const ball = new Ball(); ball.pos = v3(0, -.8, 3.2); ball.vel = v3(0, 6, -3);
  return { p, ball };
}

describe('grounded defender reads a loose overpass', () => {
  it('predicts a legal own-half arrival without changing the player or ball', () => {
    const { p, ball } = looseScene(), before = JSON.stringify({ p, ball });
    expect(looseBallReader(ball, [p])).toBe(p.id);
    expect(JSON.stringify({ p, ball })).toBe(before);
    expect(p.actionBuffer).toBe(0);
  });

  it('selects only the best positioned defender at the earliest arrival', () => {
    const { p, ball } = looseScene(), mate = new Player(5, 'away', 'outside', 'COVER', defaultStats());
    mate.pos = v3(.8, 1, 0);
    expect(looseBallReader(ball, [mate, p])).toBe(p.id);
  });

  it.each(['frozen', 'grounded', 'outgoing', 'out-of-reach', 'running', 'airborne', 'diving', 'blocking', 'approaching', 'skill', 'down'])('does not invent a reception in %s state', state => {
    const { p, ball } = looseScene();
    if (state === 'frozen') ball.frozen = true;
    if (state === 'grounded') ball.grounded = true;
    if (state === 'outgoing') ball.vel.y = -6;
    if (state === 'out-of-reach') p.pos.x = 4;
    if (state === 'running') p.vel.x = 3;
    if (state === 'airborne') p.height = .2;
    if (state === 'diving') p.diving = true;
    if (state === 'blocking') p.blockPreparationAge = .02;
    if (state === 'approaching') p.licenseApproach('attack', .3);
    if (state === 'skill') p.setAnim('set_ready');
    if (state === 'down') p.downTime = .2;
    expect(looseBallReader(ball, [p])).toBeUndefined();
  });
  it('uses the full drawn preparation before a natural stationary front-row overpass reception', () => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 7, difficulty: 1, humanControlsHome: false });
    const timeline = new SpriteTimeline(), frames:number[]=[];
    let receiver:number|undefined,preparedAt:number|undefined,plant:{x:number;y:number}|undefined;
    // Find the tactical boundary: a grounded blocker anticipates an overpass
    // before any receive reassignment. The rally number and jersey can change.
    for(let i=0;i<12000;i++){
      w.step(idleCommand());const events=w.drainEvents();
      for(const e of events)if(e.type==='contact')timeline.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
      for(const p of w.allPlayers()){
        const before=JSON.stringify({p,ball:w.ball}),pose=timeline.frameFor(p,FIXED_DT);
        expect(JSON.stringify({p,ball:w.ball})).toBe(before);
        if(receiver===undefined&&p.anim==='bump_ready'&&p.presentation.sourceJob==='block'
          &&w.team(p.side).isFrontRow(p)&&Math.hypot(p.vel.x,p.vel.y)===0){
          receiver=p.id;preparedAt=i*FIXED_DT;plant={...p.pos};
        }
        if(p.id!==receiver)continue;
        expect(p.height).toBe(0);expect(p.pos.x).toBeCloseTo(plant!.x,10);expect(p.pos.y).toBeCloseTo(plant!.y,10);
        if(events.some(e=>e.type==='contact'&&e.playerId===p.id&&e.kind==='bump')){
          expect(pose).toMatchObject({action:'bump',frame:9});
          expect(i*FIXED_DT-preparedAt!).toBeGreaterThan(.18);
          expect(frames).toEqual(BUMP_PREPARATION_FRAMES);return;
        }
        expect(p.presentation.action).toBe('bump');expect(p.presentation.phase).toBe('prepare');
        expect(['block','receive']).toContain(p.presentation.sourceJob);expect(pose.action).toBe('bump');
        if(frames.at(-1)!==pose.frame)frames.push(pose.frame);
      }
    }
    throw new Error('Natural stationary front-row overpass reception was not completed');
  });
});
