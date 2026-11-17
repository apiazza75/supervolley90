import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { isDefensiveRetreat } from '../src/render/defensive-retreat';
import { SpriteTimeline, locomotionPlaybackScale, type Playhead } from '../src/render/sprite-figure';
import { READY_LATERAL_FRAMES } from '../src/render/ready-retreat';
import { World } from '../src/core/world';
import { TEAMS } from '../src/game/teams';
import { attackDir, GAME_SPEED, FIXED_DT } from '../src/core/rules';

const defender = () => {
  const p = new Player(7, 'home', 'outside', 'TEST', defaultStats());
  p.presentation.sourceJob = 'receive';
  p.facing = 1;
  p.vel.y = -3;
  return p;
};

/** Select a sustained natural coverage departure by steering/body state.
 * A changed tactical assignment cancels the candidate; rendered failures do
 * not. This keeps the regression independent of a player's id/rally clock. */
function naturalLateralDeparture(seed: number): Playhead[] {
  const w = new World({ home: TEAMS[0], away: TEAMS[1], seed, difficulty: 1, humanControlsHome: false });
  const clock = new SpriteTimeline(), previous = new Map<number, Playhead>();
  let playerId: number | undefined, samples: Playhead[] = [];
  for (let tick = 0; tick < 10000; tick++) {
    w.step(null);
    for (const e of w.drainEvents()) if (e.type === 'contact') clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
    for (const p of w.allPlayers()) {
      const source = previous.get(p.id), net = attackDir(p.side), intent = p.locomotionIntent;
      const lateral = w.phase === 'rally' && p.presentation.sourceJob === 'cover' && p.presentation.action === 'none'
        && !p.airborne && !p.diving && p.downTime <= 0 && p.gettingUp <= 0 && p.facing === net
        && intent !== undefined && Math.abs(intent.x) > Math.abs(intent.y)
        && intent.y * net < -.001 && intent.y * net >= -Math.hypot(intent.x,intent.y) * .45
        && Math.hypot(p.vel.x,p.vel.y) > .12;
      if (playerId === undefined && lateral && source?.action === 'idle' && source.frame === 0
        && (source.facing ?? p.facing) === p.facing) {
        playerId = p.id; samples = [source];
      }
      const physical = JSON.stringify({ p, ball: w.ball }), pose = clock.frameFor(p,FIXED_DT);
      expect(JSON.stringify({ p, ball: w.ball })).toBe(physical); previous.set(p.id,pose);
      if (p.id !== playerId) continue;
      if (!lateral) { playerId = undefined; samples = []; continue; }
      samples.push(pose);
      if (samples.length >= 64) return samples;
    }
  }
  throw new Error('No sustained lateral coverage departure with shallow backward steering occurred');
}

describe('defensive backwards gait eligibility', () => {
  it('keeps the current lateral foot phase through a brief shallow retreat request', () => {
    const p=defender(),clock=new SpriteTimeline();p.vel.x=1.8;p.vel.y=0;
    p.setAnim('shuffle');p.presentation.locomotion='shuffle';p.locomotionIntent={x:.3,y:0};
    clock.frameFor(p,0);const before=clock.frameFor(p,.2);
    p.vel.x=1.2;p.vel.y=-.7;p.locomotionIntent={x:.2,y:-.117};
    const body=JSON.stringify(p);
    for(let i=0;i<3;i++){
      const pose=clock.frameFor(p,.008);
      expect(pose.action).toBe('shuffle');expect(pose.frame).toBeGreaterThanOrEqual(before.frame);
    }
    expect(JSON.stringify(p)).toBe(body);
    p.vel.y=0;p.locomotionIntent.y=0;
    expect(clock.frameFor(p,.01).action).toBe('shuffle');
  });

  it.each([1/240,1/120,1/60])('accepts sustained diagonal retreat using presentation time at dt %s', dt => {
    const p=defender(),clock=new SpriteTimeline();p.vel.x=1.8;p.vel.y=0;
    p.setAnim('shuffle');p.presentation.locomotion='shuffle';p.locomotionIntent={x:.3,y:0};clock.frameFor(p,0);
    p.vel.x=1.2;p.vel.y=-.7;p.locomotionIntent={x:.2,y:-.117};
    for(let i=0;i<20;i++)expect(clock.frameFor(p,0).action).toBe('shuffle');
    let elapsed=0,action='shuffle';
    while(elapsed<.1&&action==='shuffle'){action=clock.frameFor(p,dt).action;elapsed+=dt;}
    expect(action).toBe('backpedal');expect(elapsed).toBeGreaterThanOrEqual(.04-1e-9);expect(elapsed).toBeLessThan(.04+dt+1e-9);
    p.setAnim('bump_ready');expect(clock.frameFor(p,dt).action).toBe('bump');
  });

  it('keeps natural lateral footwork separate from the following intentional retreat', () => {
    const w=new World({home:TEAMS[0],away:TEAMS[1],seed:4242,difficulty:1,humanControlsHome:false}),clock=new SpriteTimeline();
    type Segment={kind:'lateral'|'retreat'|'other';poses:Playhead[]};
    const history=new Map<number,Segment[]>();let checked=false;
    for(let tick=0;tick<8000&&!checked;tick++){
      w.step(null);for(const e of w.drainEvents())if(e.type==='contact')clock.cue(e.playerId,e.kind,e.airborne,e.facing,e.backSet);
      for(const p of w.allPlayers()){
        const net=attackDir(p.side),intent=p.locomotionIntent??{x:0,y:0},speed=Math.hypot(p.vel.x,p.vel.y);
        const eligible=w.phase==='rally'&&p.presentation.action==='none'&&p.presentation.sourceJob==='cover'
          &&p.facing===net&&!p.airborne&&!p.diving&&p.downTime<=0&&p.gettingUp<=0&&speed>.12;
        const kind:Segment['kind']=eligible&&Math.abs(intent.x)>.05&&intent.y*net>=-Math.hypot(intent.x,intent.y)*.45?'lateral'
          :eligible&&intent.y*net<-Math.abs(intent.x)&&p.vel.y*net<-speed*.45?'retreat':'other';
        const physical=JSON.stringify({p,ball:w.ball}),pose=clock.frameFor(p,FIXED_DT);
        expect(JSON.stringify({p,ball:w.ball})).toBe(physical);
        const segments=history.get(p.id)??[];
        if(segments.at(-1)?.kind===kind)segments.at(-1)!.poses.push(pose);
        else segments.push({kind,poses:[pose]});
        if(segments.length>3)segments.shift();history.set(p.id,segments);
        const retreat=segments.at(-1),gap=segments.at(-2)?.kind==='other'?segments.at(-2):undefined;
        const lateral=gap?segments.at(-3):segments.at(-2);
        if(retreat?.kind!=='retreat'||retreat.poses.length<23||lateral?.kind!=='lateral'
          ||lateral.poses.length<31||gap&&gap.poses.length>40)continue;
        const supports=lateral.poses.slice(-31);
        expect(supports.length).toBeGreaterThan(25);expect(retreat.poses.length).toBeGreaterThan(20);
        for(const s of supports)expect(s.action).toBe('shuffle');
        for(const s of retreat.poses)expect(s.action).toBe('backpedal');
        checked=true;break;
      }
    }
    expect(checked).toBe(true);
  });

  it.each(['home','away'] as const)('finishes a walking-pace %s lateral stop without inserting a backwards foot', side => {
    const p=new Player(6,side,'outside','TEST',defaultStats()),net=attackDir(side);
    p.facing=net;p.presentation.sourceJob='cover';p.setAnim('shuffle');
    p.vel.x=-.364;p.vel.y=-net*.239;p.locomotionIntent={x:-.0566,y:-net*.037};
    expect(isDefensiveRetreat(p)).toBe(false);
    expect(isDefensiveRetreat(p,net,true)).toBe(true);
    p.locomotionIntent={x:0,y:-net*.065};p.vel.x=0;
    expect(isDefensiveRetreat(p)).toBe(true);
  });

  it('keeps every natural lateral support drawing through shallow backward steering', () => {
    const samples=naturalLateralDeparture(4242),seen:string[]=[];
    for(const pose of samples){const key=pose.action+'/'+pose.frame;if(seen.at(-1)!==key)seen.push(key);}
    expect(samples.length).toBeGreaterThan(30);
    const gait=seen.indexOf('shuffle/0');expect(gait).toBeGreaterThan(0);
    expect(seen.slice(0,gait+1)).toEqual(['idle/0',...READY_LATERAL_FRAMES.map(frame=>'idle/'+frame),'shuffle/0']);
    expect(samples.some(s=>s.action==='backpedal')).toBe(false);
  });

  it.each(['home','away'] as const)('does not mistake %s lateral startup acceleration for a backwards step', side => {
    const p=new Player(103,side,'outside','TEST',defaultStats()),clock=new SpriteTimeline();
    const net=attackDir(side);p.facing=net;p.presentation.sourceJob='cover';
    p.setAnim('shuffle');p.presentation.locomotion='shuffle';clock.frameFor(p,0);
    p.step(1/120,.28,-net*.062);
    const before={pos:{...p.pos},vel:{...p.vel}};
    expect(p.vel.y*net).toBeLessThan(0);
    expect(Math.abs(p.vel.y)/Math.hypot(p.vel.x,p.vel.y)).toBeGreaterThan(.45);
    expect(clock.frameFor(p,1/120).action).toBe('shuffle');
    expect({pos:p.pos,vel:p.vel}).toEqual(before);
  });

  it('starts genuine backwards steering immediately and retains an existing retreat during redirection', () => {
    const p=defender(),clock=new SpriteTimeline();p.vel.y=0;p.setAnim('shuffle');p.presentation.locomotion='shuffle';
    clock.frameFor(p,0);p.step(1/120,0,-.5);p.facing=1; // World's net-facing coverage rule.
    expect(clock.frameFor(p,1/120).action).toBe('backpedal');
    p.locomotionIntent={x:1,y:0};p.vel.y=-1.5;
    expect(isDefensiveRetreat(p,1,true)).toBe(true);
    expect(isDefensiveRetreat(p,1,false)).toBe(false);
    p.setAnim('bump_ready');expect(clock.frameFor(p,.01).action).toBe('bump');
  });

  it('clears steering observation when airborne and preserves legacy recorded-body eligibility', () => {
    const p=defender();p.height=1;p.vertVel=2;p.step(1/120,1,-1);
    expect(p.locomotionIntent).toEqual({x:0,y:0});expect(isDefensiveRetreat(p)).toBe(false);
    const replay=defender();expect(replay.locomotionIntent).toBeUndefined();expect(isDefensiveRetreat(replay)).toBe(true);
  });

  it('has no one-pose backpedal interruption in the natural lateral coverage departure', () => {
    const samples=naturalLateralDeparture(1337),start=samples.findIndex(s=>s.action==='shuffle'&&s.frame===0);
    expect(start).toBeGreaterThan(0);
    const gait=samples.slice(start),frames=new Set<number>();
    for(let i=0;i<gait.length;i++){
      const s=gait[i];expect(s.action).toBe('shuffle');frames.add(s.frame);
      if(i>0)expect([0,1]).toContain((s.frame-gait[i-1].frame+24)%24);
    }
    expect(gait.length).toBeGreaterThan(40);expect(frames.size).toBeGreaterThan(8);
  });

  it('does not insert a backward frame into shallow lateral acceleration', () => {
    const p=new Player(107,'away','outside','TEST',defaultStats()),clock=new SpriteTimeline();
    p.facing=-1;p.presentation.sourceJob='cover';p.setAnim('ready');
    p.vel.y=0;clock.frameFor(p,0);
    p.setAnim('shuffle');p.presentation.locomotion='walk';
    p.vel.x=-.35;p.vel.y=.14604333801289465;
    expect(clock.actionFor(p)).toBe('shuffle');
    expect(clock.frameFor(p,.01)).toMatchObject({action:'idle',frame:0});
    p.vel.x=-.7;p.vel.y=.1661968067291553;
    expect(clock.frameFor(p,.01).action).toBe('idle');
    expect(clock.frameFor(p,.01)).toMatchObject({action:'idle',frame:28});
    for(const frame of [29,30,31])expect(clock.frameFor(p,.025)).toMatchObject({action:'idle',frame});
    expect(clock.frameFor(p,.026)).toMatchObject({action:'shuffle',frame:0});
  });

  it('preserves the backwards playhead across shallow directional noise', () => {
    const p=defender(),clock=new SpriteTimeline();
    p.vel.x=1;p.vel.y=-.7;p.setAnim('shuffle');p.presentation.locomotion='shuffle';
    clock.frameFor(p,0);let previous=clock.frameFor(p,.2).frame;
    for(const vy of [-.38,-.4,-.34,-.39]){
      p.vel.y=vy;
      expect(clock.actionFor(p)).toBe('backpedal');
      const sample=clock.frameFor(p,.01);
      expect(sample.action).toBe('backpedal');expect(sample.frame).toBeGreaterThanOrEqual(previous);
      previous=sample.frame;
    }
    p.vel.y=-.1;expect(clock.frameFor(p,.01).action).toBe('shuffle');
    p.vel.y=-.38;expect(clock.frameFor(p,.01).action).toBe('shuffle');
    p.setAnim('bump_ready');expect(clock.frameFor(p,.01).action).toBe('bump');
  });

  it('keeps the lateral step until a pending turn starts instead of flashing retreat', () => {
    const p=defender(),clock=new SpriteTimeline();
    p.vel.x=1.5;p.vel.y=0;p.setAnim('shuffle');p.presentation.locomotion='shuffle';
    clock.frameFor(p,0);const before=clock.frameFor(p,.15);
    p.facing=-1;p.vel.y=-1.2;
    const pending=clock.frameFor(p,.01);
    expect(pending).toMatchObject({action:'shuffle',facing:1});
    expect(pending.frame).toBeGreaterThanOrEqual(before.frame);
    expect(clock.frameFor(p,.05)).toMatchObject({action:'turn',facing:1});
  });

  it.each(['home', 'away'] as const)('keeps the %s retreat drawing during an uncommitted direction request', side => {
    const p = new Player(7, side, 'outside', 'TEST', defaultStats()), clock = new SpriteTimeline();
    const net = attackDir(side);
    p.presentation.sourceJob = 'cover'; p.facing = net; p.vel.y = -net * 1.5;
    p.setAnim('shuffle'); p.presentation.locomotion = 'shuffle';
    clock.frameFor(p, 0);
    const before = clock.frameFor(p, .2);
    expect(before.action).toBe('backpedal');
    p.facing = -net;
    const pending = clock.frameFor(p, .01);
    expect(pending).toMatchObject({action:'backpedal',facing:net});
    expect(pending.frame).toBeGreaterThanOrEqual(before.frame);
    p.facing = net;
    const cancelled = clock.frameFor(p, .01);
    expect(cancelled.action).toBe('backpedal');
    expect(cancelled.facing ?? p.facing).toBe(net);
    expect(cancelled.frame).toBeGreaterThanOrEqual(pending.frame);
    clock.cue(p.id, 'bump', false, -net);
    expect(clock.frameFor(p, .01)).toMatchObject({action:'bump',frame:9,facing:-net});
  });

  it('does not start a backward gait before the drawn body has turned toward the net', () => {
    const p = defender(), clock = new SpriteTimeline();
    p.vel.y = -1.5; p.facing = -1; p.setAnim('shuffle'); p.presentation.locomotion = 'shuffle';
    clock.frameFor(p, 0);
    const before=clock.frameFor(p,.2);
    p.facing=1;
    const pending=clock.frameFor(p,.01);
    expect(pending).toMatchObject({action:'shuffle',facing:-1});
    expect(pending.frame).toBeGreaterThanOrEqual(before.frame);
  });

  it('requires real backwards travel while watching the net on both sides', () => {
    const home = defender();
    expect(isDefensiveRetreat(home)).toBe(true);
    const away = new Player(107, 'away', 'outside', 'TEST', defaultStats());
    away.presentation.sourceJob = 'receive'; away.facing = -1; away.vel.y = 3;
    expect(isDefensiveRetreat(away)).toBe(true);
    home.vel.y = 0;
    expect(isDefensiveRetreat(home)).toBe(false);
    home.vel.x = 3; home.vel.y = -.2;
    expect(isDefensiveRetreat(home)).toBe(false);
    home.vel.x = 0; home.vel.y = -3; home.facing = -1;
    expect(isDefensiveRetreat(home)).toBe(false);
  });

  it('never replaces a skill, serve, attack approach or floor recovery', () => {
    for (const job of ['serve', 'idle'] as const) {
      const p = defender(); p.presentation.sourceJob = job;
      expect(isDefensiveRetreat(p)).toBe(false);
    }
    for (const action of ['bump_ready', 'set_ready', 'block', 'spike', 'dive', 'getUp'] as const) {
      const p = defender(); p.setAnim(action);
      expect(isDefensiveRetreat(p)).toBe(false);
    }
    const p = defender(); p.licenseApproach('attack');
    expect(isDefensiveRetreat(p)).toBe(false);
  });

  it.each(['attack', 'set'] as const)('keeps backward footwork when coverage changes to %s before any skill starts', job => {
    for (const side of ['home', 'away'] as const) {
      const p=new Player(7,side,'outside','TEST',defaultStats()),clock=new SpriteTimeline();
      const net=attackDir(side);p.facing=net;p.presentation.sourceJob='cover';
      p.setAnim('shuffle');p.presentation.locomotion='shuffle';p.vel.x=1.348;p.vel.y=-net*.713;
      clock.frameFor(p,0);const before=clock.frameFor(p,.12);
      expect(before.action).toBe('backpedal');
      p.presentation.sourceJob=job;p.vel.x=1.16;p.vel.y=-net*1.237;
      expect(clock.actionFor(p)).toBe('backpedal');
      const after=clock.frameFor(p,.01);
      expect(after.action).toBe('backpedal');
      expect(after.facing??p.facing).toBe(net);
      expect(after.frame).toBeGreaterThanOrEqual(before.frame);
      // A newly assigned attacker/setter can also begin a real backward step.
      expect(isDefensiveRetreat(p)).toBe(true);
      if(job==='set'){
        p.setAnim('set_ready');expect(clock.frameFor(p,.01).action).toBe('set');
      }else{
        p.licenseApproach('attack');expect(clock.frameFor(p,.01).action).toBe('approach');
      }
    }
  });

  it('plays all 24 backwards drawings and gives contact priority without mirroring', () => {
    const p = defender(), clock = new SpriteTimeline();
    p.presentation.locomotion = 'run'; p.setAnim('run');
    const frames = new Set<number>();
    const dt = GAME_SPEED / 60;
    for (let i = 0; i < 75; i++) {
      const s = clock.frameFor(p, dt * locomotionPlaybackScale('backpedal', 3), undefined, undefined, dt);
      expect(s.action).toBe('backpedal'); frames.add(s.frame);
    }
    expect(frames.size).toBe(24);
    expect(locomotionPlaybackScale('backpedal', 0)).toBe(0);
    clock.cue(p.id, 'bump', false, 1);
    expect(clock.frameFor(p, dt)).toMatchObject({ action: 'bump', frame: 9, facing: 1 });
  });

  it('retains the illustrated pivot when a lateral step becomes a slow retreat', () => {
    const p = defender(), clock = new SpriteTimeline();
    p.facing = -1; p.vel.y = -.5; p.setAnim('shuffle');
    p.presentation.locomotion = 'shuffle';
    clock.frameFor(p, .01);
    p.facing = 1;
    expect(clock.frameFor(p, .08)).toMatchObject({ action: 'turn', facing: -1 });
  });

  it('keeps a live incoming-ball receiver watching the net during retreat', () => {
    const w = new World({ home: TEAMS[0], away: TEAMS[1], seed: 4242, difficulty: 1, humanControlsHome: false });
    let retreats = 0;
    for (let i = 0; i < 5000; i++) {
      w.step(null);
      for (const p of w.allPlayers()) {
        if (p.presentation.sourceJob !== 'receive' || w.lastToucherSide === p.side
          || p.airborne || p.diving || p.downTime > 0 || p.gettingUp > 0) continue;
        expect(p.facing).toBe(attackDir(p.side));
        if (isDefensiveRetreat(p)) retreats++;
      }
      w.drainEvents();
    }
    expect(retreats).toBeGreaterThan(30);
  });
});
