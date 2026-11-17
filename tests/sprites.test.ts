import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Player, defaultStats } from '../src/core/player';
import { STANDING_SERVE_FOLLOW_FRAMES } from '../src/render/serve-swing';
import {
  CONTACT_FRAME,
  BUMP_FOLLOW_FRAMES,
  SET_FOLLOW_FRAMES,
  BACK_SET_FOLLOW_FRAMES,
  CELEBRATE_FRAMES,
  blockFrameForPlayer,
  locomotionPlaybackScale,
  RUN_STRIDE_FRAMES,
  SPIKE_PHASE_FRAMES,
  SpriteTimeline,
  WALK_STRIDE_FRAMES,
  shouldUseRasterSprite,
  spikeFrameForDiagnostics,
  spriteActionForContact,
  spriteContactPoint,
  SPRITE_CONTACT_PIXELS,
  drawSpritePlayer,
  playerSpriteScreenTop,
} from '../src/render/sprite-figure';
import { drawFrame, frameArtLiftPixels, SHEETS, SPRITE_HEAD_REFERENCE, type Sheet } from '../src/render/sprites';
import { Camera } from '../src/render/camera';
import { GAME_SPEED, NET_HEIGHT } from '../src/core/rules';
import { gaitPoseForDiagnostics } from '../src/render/players';

const player = (): Player =>
  new Player(7, 'home', 'outside', 'TEST', defaultStats());

describe('sprite contact timeline', () => {
  it.each([['walk', 1], ['run', 3.5]] as const)(
    'keeps %s readable at the real slowed game speed without skipping drawings', (action, speed) => {
      const p = player();
      const timeline = new SpriteTimeline();
      const dt = GAME_SPEED / 60 * locomotionPlaybackScale(action, speed);
      const frames = Array.from({ length: 61 }, () => timeline.frameFor(p, dt, action).frame);
      let changes = 0;
      for (let i = 1; i < frames.length; i++) {
        const order: readonly number[] = action === 'run' ? RUN_STRIDE_FRAMES : WALK_STRIDE_FRAMES;
        const advance = (order.indexOf(frames[i]) - order.indexOf(frames[i - 1]) + order.length) % order.length;
        expect(advance).toBeLessThanOrEqual(1);
        if (advance) changes++;
      }
      expect(changes).toBeGreaterThanOrEqual(12);
      expect(changes).toBeLessThanOrEqual(40);
    },
  );
  const cases = [
    ['spike', false, 'spike', 18],
    ['power', true, 'spike', 18],
    ['tip', true, 'spike', 18],
    ['block', true, 'block', 16],
    ['bump', false, 'bump', 9],
    ['set', false, 'set', 9],
    ['save', false, 'dive', 9],
    ['serve', false, 'serve', 15],
    ['serve', true, 'jumpServe', 18],
  ] as const;

  it.each(cases)(
    '%s contact (airborne=%s) selects %s frame %i',
    (kind, airborne, action, frame) => {
      const p = player();
      const timeline = new SpriteTimeline();
      timeline.cue(p.id, kind, airborne);
      expect(timeline.frameFor(p, 0)).toMatchObject({ action, frame });
    },
  );

  it('keeps an authored contact exact even after another action was playing', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.vel.y = 4;
    expect(timeline.frameFor(p, 0.2).action).toBe('run');
    timeline.cue(p.id, 'set', false);
    expect(timeline.frameFor(p, 0)).toMatchObject({ action: 'set', frame: 9 });
  });

  it.each(['bump', 'set'] as const)('keeps %s facing the contact through recovery when the next job turns away', action => {
    const p = player(), clock = new SpriteTimeline();
    p.facing = -1;
    clock.cue(p.id, action, false, -1);
    expect(clock.frameFor(p, 0)).toMatchObject({ action, frame: 9, facing: -1 });
    p.facing = 1; p.vel.y = 3.5; p.setAnim('run');
    const frames: number[] = [];
    for (let i = 0; i < 120; i++) {
      const sample = clock.frameFor(p, GAME_SPEED / 60, 'run');
      if (sample.action !== action) {
        expect(sample.action).toBe('run');
        // Recovery releases to locomotion but must not instantly mirror.
        expect(sample.facing).toBe(-1);
        expect(frames).toContain(23);
        expect(p.facing).toBe(1);
        const turnFrames = new Set<number>();
        for (let j = 0; j < 100; j++) {
          const next = clock.frameFor(p, GAME_SPEED / 60, 'run');
          if (next.action === 'runTurn') {
            expect(next.facing).toBe(-1); turnFrames.add(next.frame);
          } else if (turnFrames.size) {
            expect(next).toMatchObject({ action: 'run', frame: 6, facing: 1 });
            expect([...turnFrames]).toEqual(Array.from({ length: 24 }, (_, n) => n));
            return;
          }
        }
        throw new Error('Post-contact moving turn did not complete');
      }
      frames.push(sample.frame);
      expect(sample.facing).toBe(-1);
      expect(p.facing).toBe(1);
    }
    throw new Error('Recovery never released its orientation');
  });

  it('uses the event orientation even if simulation has already turned before the first draw', () => {
    const p = player(), clock = new SpriteTimeline();
    p.facing = 1;
    clock.cue(p.id, 'set', false, -1);
    expect(clock.frameFor(p, 0)).toMatchObject({ frame: 9, facing: -1 });
    clock.cue(p.id, 'bump', false, 1);
    expect(clock.frameFor(p, 0)).toMatchObject({ action: 'bump', facing: 1 });
    clock.reset(p.id);
    expect(clock.frameFor(p, 0).facing).toBeUndefined();
  });

  it('keeps the blocking wall synchronized with rise, apex, descent and landing', () => {
    const p = player();
    p.jump(); p.setAnim('block');
    expect(blockFrameForPlayer(p).frame).toBe(7);
    p.height = 1.3; p.vertVel = 0;
    expect(blockFrameForPlayer(p).frame).toBeGreaterThanOrEqual(15);
    p.height = 0.65; p.vertVel = -3.8;
    expect(blockFrameForPlayer(p).frame).toBeGreaterThanOrEqual(18);
    expect([18,33,34,35,19,20]).toContain(blockFrameForPlayer(p).frame);
    p.height = 0; p.vertVel = 0; p.setAnim('land');
    expect(p.presentation).toMatchObject({ action: 'block', phase: 'land' });
    expect(blockFrameForPlayer(p).frame).toBe(20);
    p.animTime = 0.14;
    expect(blockFrameForPlayer(p).frame).toBe(23);
  });

  it('plays blocking landing drawings after actual physics lands the player', () => {
    const p = player(), timeline = new SpriteTimeline();
    p.jump(); p.setAnim('block');
    const frames: number[] = [];
    for (let i = 0; i < 150; i++) {
      p.step(GAME_SPEED / 60, 0, 0);
      const sample = timeline.frameFor(p, GAME_SPEED / 60);
      if (sample.action === 'block') frames.push(sample.frame);
    }
    expect(frames[0]).toBe(7);
    for (const frame of [12, 15, 18, 21, 22, 23]) expect(frames).toContain(frame);
    expect(frames.filter((frame, i) => i === 0 || frame !== frames[i - 1]))
      .toEqual([...Array.from({length:11},(_,i)=>i+7),32,18,33,34,35,19,20,28,24,29,25,26,27,26,30,21,31,22,23]);
  });

  it('does not start a landing pose in midair after a block contact cue', () => {
    const p = player(), timeline = new SpriteTimeline();
    p.jump(); p.setAnim('air_contact_block'); p.height = 1.2; p.vertVel = 0;
    timeline.cue(p.id, 'block', true);
    expect(timeline.frameFor(p, 0).frame).toBe(16);
    // A frozen-physics diagnostic: wall-clock advancement must not invent a fall.
    for (let i = 0; i < 60; i++) expect(timeline.frameFor(p, 1 / 60).frame).toBe(16);
    p.height = 0; p.vertVel = 0; p.setAnim('land');
    expect(timeline.frameFor(p, 1 / 60).frame).toBe(20);
    p.setAnim('ready');
    expect(timeline.frameFor(p, 1 / 60).action).toBe('idle');
  });

  it('keeps spike weight-bearing landing poses on the floor after an early contact', () => {
    const p = player(), timeline = new SpriteTimeline();
    p.jump(); p.setAnim('air_contact_spike'); p.height = 1.2; p.vertVel = 1;
    timeline.cue(p.id, 'spike', true);
    expect(timeline.frameFor(p, 0).frame).toBe(18);
    for (let i = 0; i < 60; i++) expect(timeline.frameFor(p, 1 / 60)).toMatchObject({ action: 'spikeFollow', frame: 0 });
    p.height = 0.2; p.vertVel = -4;
    expect(timeline.frameFor(p, 1 / 60)).toMatchObject({ action: 'spikeFollow', frame: 15 });
    p.height = 0; p.vertVel = 0; p.setAnim('land');
    expect(p.presentation).toMatchObject({ action: 'spike', phase: 'land' });
    expect(timeline.frameFor(p, 0.01)).toMatchObject({ action: 'spikeFollow', frame: 17 });
    expect(timeline.frameFor(p, 0.14).frame).toBe(22);
    p.setAnim('ready');
    expect(timeline.frameFor(p, 1 / 60).action).toBe('idle');
  });

  it('fits the drawn plant into the AI actual gather window before takeoff', () => {
    const frames = new Set<number>();
    for (let t = 0; t < 0.1; t += GAME_SPEED / 60) frames.add(spikeFrameForDiagnostics('plant', t).frame);
    expect([...frames]).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it('does not erase the landing or permit a second jump in the last 2cm of descent', () => {
    for (const action of ['block', 'spike'] as const) {
      const p = player();
      p.setAnim(action === 'block' ? 'block' : 'follow_through');
      p.animTime = .8; p.animHold = 0;
      p.height = .01; p.vertVel = -5;
      expect(p.airborne).toBe(false); // intentional contact-rule tolerance
      expect(p.jump()).toBe(false);
      expect(p.dive(1, 0)).toBe(false);
      p.step(1 / 120, 0, 0);
      expect(p.height).toBe(0);
      expect(p.presentation).toMatchObject({ action, phase: 'land' });
      expect(p.lockout).toBeGreaterThan(0);
    }
  });

  it('never asks for a blend between two whole bodies', () => {
    // The rejected build cross-faded `frame` and `nextFrame` at complementary
    // alpha, which is a double exposure. A playhead now names exactly one
    // authored drawing, so there is nothing for the renderer to blend.
    const p = player();
    const timeline = new SpriteTimeline();
    for (let i = 0; i < 120; i++) {
      const head = timeline.frameFor(p, 1 / 60);
      expect(Object.keys(head).sort()).toEqual(['action', 'frame', 'frameFloat']);
      expect(Number.isInteger(head.frame)).toBe(true);
      expect(head.frame).toBeGreaterThanOrEqual(0);
      expect(head.frame).toBeLessThanOrEqual(23);
    }
  });

  it.each([
    'idle',
    'approach',
    'spike',
    'spikeFollow',
    'block',
    'bump',
    'set',
    'backSet',
    'turn',
    'backpedal', 'runTurn', 'turnStop', 'runBrake',
    'dive',
    'serve',
    'jumpServe',
    'jumpServeFollow',
    'celebrate',
  ] as const)('shows every adjacent %s pose without skipping at 60 Hz', (action) => {
    const p = player();
    const timeline = new SpriteTimeline();
    const frames = Array.from({ length: 180 }, () => timeline.frameFor(p, 1 / 60, action).frame);
    const order: readonly number[] = action === 'celebrate' ? CELEBRATE_FRAMES
      : action === 'serve' ? [...Array.from({length:15},(_,i)=>i),...STANDING_SERVE_FOLLOW_FRAMES]
      : action === 'backSet' ? [...Array.from({length:9},(_,i)=>i),...BACK_SET_FOLLOW_FRAMES]
      : action === 'bump' || action === 'set'
      ? [...Array.from({ length: 9 }, (_, i) => i), ...(action === 'set' ? SET_FOLLOW_FRAMES : BUMP_FOLLOW_FRAMES)]
      : Array.from({ length: 24 }, (_, i) => i);
    let chronologicalIndex = order.indexOf(frames[0]);
    for (let i = 1; i < frames.length; i++) {
      expect(order).toContain(frames[i]);
      if (frames[i] === order[chronologicalIndex]) continue;
      chronologicalIndex = (chronologicalIndex + 1) % order.length;
      expect(frames[i], `${action} sample ${i - 1}->${i} skipped an authored pose`).toBe(order[chronologicalIndex]);
    }
  });

  it('uses a dedicated continuous two-foot run sheet for ordinary running', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'run';
    p.presentation.locomotion = 'run';
    p.vel.y = 4.6;
    const seen = new Set<number>();
    for (let i = 0; i < 180; i++) {
      const head = timeline.frameFor(p, 1 / 60);
      expect(head.action).toBe('run');
      seen.add(head.frame);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...RUN_STRIDE_FRAMES].sort((a,b)=>a-b));
  });

  it('never skips an authored run pose at a 60 Hz display cadence', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'run';
    p.presentation.locomotion = 'run';
    p.vel.y = 5.2;

    const frames = Array.from({ length: 180 }, () => timeline.frameFor(p, 1 / 60).frame);
    for (let i = 1; i < frames.length; i++) {
      const order: readonly number[] = RUN_STRIDE_FRAMES;
      const advance = (order.indexOf(frames[i]) - order.indexOf(frames[i-1]) + order.length) % order.length;
      expect(advance, `display sample ${i - 1}->${i} skipped an authored run pose`).toBeLessThanOrEqual(1);
    }
  });

  it('renders a positional shuffle as a short walking stride, not idle or sprint', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'shuffle';
    p.presentation.locomotion = 'walk';
    p.vel.y = 0.6;
    const seen = new Set<number>();
    for (let i = 0; i < 180; i++) {
      const head = timeline.frameFor(p, 1 / 60);
      expect(head.action).toBe('walk');
      seen.add(head.frame);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...WALK_STRIDE_FRAMES]);
  });

  it('never skips an authored walk pose at a 60 Hz display cadence', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'shuffle';
    p.presentation.locomotion = 'walk';
    p.vel.y = 0.8;

    const frames = Array.from({ length: 180 }, () => timeline.frameFor(p, 1 / 60).frame);
    for (let i = 1; i < frames.length; i++) {
      const advance = (frames[i] - frames[i - 1] + 24) % 24;
      expect(advance, `display sample ${i - 1}->${i} skipped an authored walk pose`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the same foot phase when locomotion changes from walk to run', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'shuffle';
    p.presentation.locomotion = 'walk';
    p.vel.y = 0.75;
    const walk = timeline.frameFor(p, 0.41);

    p.anim = 'run';
    p.presentation.locomotion = 'run';
    p.vel.y = 3.5;
    const run = timeline.frameFor(p, 0);

    expect(run.action).toBe('run');
    expect(run.frame).toBe(walk.frame);
  });

  it('keeps ordinary movement on raster sprites instead of falling back to vector bodies', () => {
    const p = player();
    p.presentation.action = 'none';

    p.presentation.locomotion = 'shuffle';
    expect(shouldUseRasterSprite(p)).toBe(true);

    p.presentation.locomotion = 'walk';
    expect(shouldUseRasterSprite(p)).toBe(true);

    p.presentation.locomotion = 'run';
    expect(shouldUseRasterSprite(p)).toBe(true);

    p.presentation.locomotion = 'approach';
    expect(shouldUseRasterSprite(p)).toBe(true);

    p.presentation.action = 'spike';
    expect(shouldUseRasterSprite(p)).toBe(true);
  });

  it('does not draw the old vector player as a gameplay fallback', () => {
    const rendererSource = readFileSync(resolve('src/render/renderer.ts'), 'utf8');
    expect(rendererSource).not.toMatch(/\bdrawPlayer\(/);
    expect(rendererSource).not.toMatch(/drawPlayer,\s*drawPlayerShadow/);
  });

  it('holds the waiting serve drawing indefinitely without playing an automatic toss', () => {
    const p = player(), clock = new SpriteTimeline();
    const service = { holding: true, holdSeconds: 0, tossElapsed: 0, jumping: false };
    for (let i = 0; i < 1200; i++) {
      expect(clock.frameFor(p, 1 / 60, undefined, service)).toMatchObject({ action: 'serve', frame: 0 });
    }
  });

  it('keeps the deprecated sheet generator from overwriting manga sprites', () => {
    const generatorSource = readFileSync(resolve('tools/make-sheets.ts'), 'utf8');
    expect(generatorSource).not.toContain("../src/render/players");
    expect(generatorSource).not.toContain('drawPlayer');
    expect(generatorSource).not.toContain('writeFileSync');
    expect(generatorSource).toMatch(/Refusing to generate procedural vector player sheets/);
  });

  it('keeps every gameplay sheet at a full 24-frame runtime sequence', () => {
    for (const [action, layout] of Object.entries(SHEETS)) {
      expect(layout.skip, `${action} must not drop authored manga frames`).toBeUndefined();
    }
  });

  it('draws a slow walk from the stride atlas even if the simulation anim is still ready', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'ready';
    p.presentation.action = 'none';
    p.presentation.locomotion = 'walk';
    p.vel.y = 0.45;

    const seen = new Set<number>();
    for (let i = 0; i < 180; i++) {
      const head = timeline.frameFor(p, 1 / 60);
      expect(head.action).toBe('walk');
      seen.add(head.frame);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...WALK_STRIDE_FRAMES]);
  });

  it('keeps the legacy gait diagnostic internally consistent (not raster anatomy acceptance)', () => {
    const runForward = gaitPoseForDiagnostics('run', Math.PI / 2, 4.8);
    const runBack = gaitPoseForDiagnostics('run', (Math.PI * 3) / 2, 4.8);
    const walkForward = gaitPoseForDiagnostics('walk', Math.PI / 2, 0.7);
    const walkBack = gaitPoseForDiagnostics('walk', (Math.PI * 3) / 2, 0.7);

    // This checks a diagnostic mathematical model only. Actual PNG anatomy
    // and near/far limb order require inspection of the rendered drawings.
    expect(runForward.feet[0][0]).toBeGreaterThan(0);
    expect(runForward.feet[1][0]).toBeLessThan(0);
    expect(runBack.feet[0][0]).toBeLessThan(0);
    expect(runBack.feet[1][0]).toBeGreaterThan(0);
    expect(walkForward.feet[0][0]).toBeGreaterThan(0);
    expect(walkForward.feet[1][0]).toBeLessThan(0);
    expect(walkBack.feet[0][0]).toBeLessThan(0);
    expect(walkBack.feet[1][0]).toBeGreaterThan(0);

    // The diagnostic walk has lower amplitude than the diagnostic run.
    expect(walkForward.stride).toBeLessThan(runForward.stride * 0.45);
    expect(walkForward.maxLift).toBeLessThan(runForward.maxLift * 0.4);
    expect(walkForward.armPump).toBeLessThan(runForward.armPump * 0.4);
    // Keep a nonzero diagnostic amplitude; this says nothing about PNG poses.
    expect(walkForward.stride).toBeGreaterThan(0.08);
    expect(walkForward.maxLift).toBeGreaterThan(0.025);

    // Arms remain contralateral: when the far foot is forward, the far arm is
    // back, and the near pair mirrors it.
    expect(Math.sign(walkForward.armFar[0])).toBe(-Math.sign(walkForward.feet[0][0]));
    expect(Math.sign(walkForward.armNear[0])).toBe(-Math.sign(walkForward.feet[1][0]));
  });

  it('anchors spike drawing to the physical jump phase instead of restarting at waiting frames', () => {
    const contactFrame = CONTACT_FRAME.spike ?? 19;
    expect(spikeFrameForDiagnostics('plant', 0).frame).toBe(SPIKE_PHASE_FRAMES.plant?.[0]);
    expect(spikeFrameForDiagnostics('plant', 0.17).frame).toBe(SPIKE_PHASE_FRAMES.plant?.at(-1));
    expect(SPIKE_PHASE_FRAMES.plant).not.toContain(0);

    const rise = new Set<number>();
    for (let i = 0; i < 12; i++) rise.add(spikeFrameForDiagnostics('rise', i / 60).frame);
    for (const frame of rise) {
      expect(SPIKE_PHASE_FRAMES.rise).toContain(frame);
      expect(frame).toBeGreaterThanOrEqual(13);
    }

    expect(spikeFrameForDiagnostics('contact', 0.1).frame).toBe(contactFrame);
    expect(spikeFrameForDiagnostics('follow', 0.2).frame).toBeGreaterThan(contactFrame);
  });

  it('uses the full authored spike sheet across approach, plant, rise, contact and recovery', () => {
    const used = new Set<number>();
    for (const phase of ['step1', 'step2', 'plant', 'rise', 'contact', 'follow', 'land'] as const) {
      for (const frame of SPIKE_PHASE_FRAMES[phase] ?? []) used.add(frame);
    }
    expect([...used].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i));

    const plantThroughLanding = new Set<number>();
    for (const phase of ['plant', 'rise', 'contact', 'follow', 'land'] as const) {
      for (const frame of SPIKE_PHASE_FRAMES[phase] ?? []) plantThroughLanding.add(frame);
    }
    expect(plantThroughLanding.size).toBeGreaterThanOrEqual(17);
  });

  it('keeps phase-anchored spike frames inside the live timeline before contact', () => {
    const p = player();
    const timeline = new SpriteTimeline();
    p.anim = 'plant';
    p.presentation.action = 'spike';
    p.presentation.phase = 'plant';
    p.animTime = 0;
    expect(timeline.frameFor(p, 1 / 60)).toMatchObject({ action: 'spike', frame: 7 });

    p.anim = 'jump_rise';
    p.presentation.phase = 'rise';
    p.animTime = 0.22;
    const riseFrames = SPIKE_PHASE_FRAMES.rise ?? [];
    expect(riseFrames).toContain(timeline.frameFor(p, 1 / 60).frame);

    timeline.cue(p.id, 'spike', true);
    expect(timeline.frameFor(p, 1 / 60)).toMatchObject({ action: 'spike', frame: CONTACT_FRAME.spike });
  });

  it('draws a body that has no presentation state', () => {
    // Replay rebuilds bodies from recorded frames: they carry a pose but no
    // presentation. Reading it unconditionally threw inside the render loop and
    // took the canvas down with it, so the screen went black the first time a
    // replay played. The timeline must tolerate the shape replay actually uses.
    const timeline = new SpriteTimeline();
    const ghost = {
      id: 1007,
      anim: 'run',
      vel: { x: 3, y: 0, z: 0 },
      height: 0,
      airborne: false,
      diving: false,
      swing: 0,
      facing: 1,
      pos: { x: 0, y: -3, z: 0 },
    } as unknown as Player;
    expect(() => timeline.frameFor(ghost, 1 / 60)).not.toThrow();
    expect(ghost.presentation).toBeUndefined();
  });

  it('distinguishes standing and jump serves', () => {
    expect(spriteActionForContact('serve', false)).toBe('serve');
    expect(spriteActionForContact('serve', true)).toBe('jumpServe');
    expect(CONTACT_FRAME.serve).toBe(15);
    expect(CONTACT_FRAME.jumpServe).toBe(18);
  });

  it('registers action scale with a stable head unit, not each changing pose outline', () => {
    const reference = 1 / 6;
    for (const [action, head] of Object.entries(SPRITE_HEAD_REFERENCE)) {
      const layout = SHEETS[action as keyof typeof SHEETS];
      expect((head.chin - head.top) / layout.nativeBodyHeight!).toBeCloseTo(reference, 8);
    }
    expect(SHEETS.idle.nativeBodyHeight).toBeCloseTo(6 * 76, 8);
    // Redrawing the idle asset does not change the existing run or walk unit.
    expect(SHEETS.run.nativeBodyHeight).toBeCloseTo(6 * 80, 8);
    expect(SHEETS.walk.nativeBodyHeight).toBeCloseTo(6 * 76, 8);
    expect(SHEETS.spike.nativeBodyHeight).toBeCloseTo(6 * 65, 8);
  });

  it.each([-4, 0, 4])('keeps a neutral athlete below the net at court depth %s', depth => {
    const p = player(); p.pos.x = depth;
    const cam = new Camera(); cam.resize(1280, 720);
    // Measured idle frame-zero sole/crown landmarks in the unpacked artwork.
    const sheet: Sheet = {
      canvas: {} as HTMLCanvasElement,
      frames: Array.from({ length: 24 }, () => ({ sx: 0, sy: 0, sw: 512, sh: 512,
        footX: 256, footY: 470, boxTop: 15, boxBottom: 470 })),
      nativeBodyHeight: SHEETS.idle.nativeBodyHeight!, layout: SHEETS.idle,
      kitHue: 220, variants: new Map(),
    };
    let dest: number[] = [];
    const ctx = { save() {}, restore() {}, translate() {}, scale() {},
      drawImage(...args: unknown[]) { dest = args.slice(5) as number[]; }
    } as unknown as CanvasRenderingContext2D;
    drawSpritePlayer(ctx, cam, p, { idle: sheet }, 0, {}, 'idle');
    const floor = cam.projectFloor(p.pos.x, p.pos.y);
    const crown = floor.y + dest[1] + 15 / 512 * dest[3];
    expect(playerSpriteScreenTop(p.id)).toBeCloseTo(crown, 6);
    expect(crown).toBeGreaterThan(cam.project(p.pos.x, p.pos.y, NET_HEIGHT).y);
    const metres = (floor.y - crown) / (floor.y - cam.project(p.pos.x, p.pos.y, 1).y);
    expect(metres).toBeGreaterThan(1.6);
    expect(metres).toBeLessThan(2.1);
  });

  it.each([[-4, undefined, 1], [4, undefined, 1], [4, .45, .45]] as const)(
    'keeps a solid player at depth %s opaque unless explicitly faded (%s)', (depth, alpha, expected) => {
      const p = player(); p.pos.x = depth; p.pos.y = -3;
      const cam = new Camera(); cam.resize(1280, 720);
      const sheet: Sheet = {
        canvas: {} as HTMLCanvasElement,
        frames: Array.from({ length: 24 }, () => ({ sx: 0, sy: 0, sw: 256, sh: 256,
          footX: 128, footY: 235, boxTop: 10, boxBottom: 235 })),
        nativeBodyHeight: 170, layout: SHEETS.walk, kitHue: 220, variants: new Map(),
      };
      let drawnAlpha = -1;
      const fake = {
        globalAlpha: 1,
        save() {}, restore() {}, translate() {}, scale() {},
        drawImage() { drawnAlpha = this.globalAlpha; },
      };
      expect(drawSpritePlayer(fake as unknown as CanvasRenderingContext2D, cam, p, { walk: sheet }, 1 / 60, { alpha }, 'walk')).toBe(true);
      expect(drawnAlpha).toBe(expected);
    },
  );

  it.each([
    ['bump', false, 'bump'], ['set', false, 'set'], ['spike', true, 'spike'],
    ['block', true, 'block'], ['save', false, 'dive'], ['serve', false, 'serve'],
    ['serve', true, 'jumpServe'],
  ] as const)('projects %s contact through the actual packed raster geometry', (kind, airborne, action) => {
    const p = player();
    p.pos.x = 1.2;
    p.pos.y = -2.4;
    const cam = new Camera();
    cam.resize(1920, 1080);
    const sheet = {
      canvas: {} as HTMLCanvasElement,
      frames: Array.from({ length: 24 }, () => ({ sx: 0, sy: 0, sw: 256, sh: 256,
        footX: 128, footY: 235, boxTop: 10, boxBottom: airborne ? 205 : 235 })),
      nativeBodyHeight: SHEETS[action].nativeBodyHeight! * .5,
      layout: SHEETS[action], kitHue: 220, variants: new Map(),
    } satisfies Sheet;
    const style = { heightScale: 1.075, widthScale: .96 };
    const floor = cam.projectFloor(p.pos.x, p.pos.y);
    const bodyPx = 1.9 * floor.scale * 42 * style.heightScale;
    for (const facing of [-1, 1]) for (const height of [0, .9]) {
      p.facing = facing; p.height = height;
      const contact = cam.projectVec(spriteContactPoint(p, kind, airborne, { [action]: sheet }, style, cam.scaleAt(p.pos.x)));
      const authoredLift = frameArtLiftPixels(sheet, CONTACT_FRAME[action]!, bodyPx);
      const origin = cam.project(p.pos.x, p.pos.y, Math.max(0, height - authoredLift / (floor.scale * 42)));
      let dest: number[] = [];
      const ctx = { save() {}, restore() {}, translate() {}, scale() {}, drawImage(...args: unknown[]) { dest = args.slice(5) as number[]; } } as unknown as CanvasRenderingContext2D;
      drawFrame(ctx, sheet, CONTACT_FRAME[action]!, origin.x, origin.y, bodyPx, facing, undefined, style.widthScale);
      const hand = SPRITE_CONTACT_PIXELS[action]!;
      // Follow the actual drawImage destination rectangle, not a duplicate
      // world-space anchor formula that could stay green while art moves.
      const screenX = origin.x + (dest[0] + hand.x / 512 * dest[2]) * facing * style.widthScale;
      const screenY = origin.y + dest[1] + hand.y / 512 * dest[3];
      expect(contact.x).toBeCloseTo(screenX, 6);
      expect(contact.y).toBeCloseTo(screenY, 6);
    }
  });

  it('preserves drawn run flight while the physical player stays grounded', () => {
    const p = player(); p.pos.x = 1; p.pos.y = -3; p.height = 0;
    p.anim = 'run'; p.presentation.locomotion = 'run'; p.vel.x = 3.7;
    const cam = new Camera(); cam.resize(1280, 720);
    const sheet: Sheet = {
      canvas: {} as HTMLCanvasElement,
      frames: Array.from({ length: 24 }, () => ({ sx: 0, sy: 0, sw: 256, sh: 256,
        footX: 128, footY: 235, boxTop: 10, boxBottom: 222.5 })),
      nativeBodyHeight: 170, layout: SHEETS.run, kitHue: 220, variants: new Map(),
    };
    let originY = 0, dest: number[] = [];
    const ctx = {
      save() {}, restore() {}, scale() {},
      translate(_x: number, y: number) { originY = y; },
      drawImage(...args: unknown[]) { dest = args.slice(5) as number[]; },
    } as unknown as CanvasRenderingContext2D;
    expect(drawSpritePlayer(ctx, cam, p, { run: sheet }, 1 / 60, {}, 'run')).toBe(true);
    const floor = cam.projectFloor(p.pos.x, p.pos.y);
    const bodyPx = 1.9 * floor.scale * 42;
    const soleY = originY + dest[1] + 222.5 / 256 * dest[3];
    expect(soleY).toBeCloseTo(floor.y - frameArtLiftPixels(sheet, 0, bodyPx), 6);
    expect(p.height).toBe(0);
    expect(p.airborne).toBe(false);
  });
});
