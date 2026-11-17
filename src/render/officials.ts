import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, type Side } from '../core/rules';
import { Camera } from './camera';

/** Dedicated illustrated officials. The seated figure and chair are ONE drawing.
 * No athlete sprite, reconstructed lower body or procedural chair is overlaid.
 */
export const OFFICIAL_ATLAS = {
  cols: 4,
  rows: 2,
  source: 'officials/manga-seated.png',
  frames: {
    refereeIdle: 0, refereeServe: 1, refereePointHome: 2, refereePointAway: 3,
    lineJudgeIdle: 4, lineJudgeIn: 5, lineJudgeOut: 6, lineJudgeTouch: 7,
  },
} as const;

/** Apply the requested reduction to the whole cutout, around its chair feet. */
export const REFEREE_SIZE_MULTIPLIER = 0.9;

export const OFFICIAL_LAYOUT = {
  referee: {
    x: COURT_HALF_WIDTH + 0.95, y: 0.7,
    standTop: NET_HEIGHT - 0.86,
    pose: 'seated-on-high-chair',
    chair: 'illustrated-stool-and-ladder',
    chairStyle: 'complete-manga-chair-and-seated-referee',
    chairSilhouette: 'authored-full-cutout',
    chairSupport: 'authored-steel-legs-rungs-and-footrest',
    atlasUse: 'complete-figure-and-chair',
    seatedComposition: 'single-illustration',
    bentLegs: true,
    visualScale: 1.76 * REFEREE_SIZE_MULTIPLIER,
  },
  lineJudges: [
    { x: COURT_HALF_WIDTH + 1.5, y: -COURT_HALF_LENGTH - 1.4 },
    { x: -COURT_HALF_WIDTH - 1.5, y: COURT_HALF_LENGTH + 1.4 },
  ],
  ballKids: 0,
} as const;

export const REFEREE_SEATED_COMPOSITION = {
  spriteCropTop: 0,
  spriteCropBottom: 1,
  lowerBodyPaintOrder: 'included-in-illustration',
} as const;

export type JudgeSignal = 'idle' | 'in' | 'out' | 'touch';
interface LineJudge {
  x: number; y: number; hold: number; signal: JudgeSignal;
}
const SIGNAL_TIME = 2.2;
const JUDGE_FRAME: Record<JudgeSignal, number> = {
  idle: 4, in: 5, out: 6, touch: 7,
};

export class Officials {
  private signal = 0;
  private signalSide: Side | null = null;
  private signalKind: 'idle' | 'serve' | 'point' = 'idle';
  private sheet: HTMLImageElement | null = null;
  private loadFailed = false;
  private refereeDraws = 0;
  private readonly judges: LineJudge[];

  constructor() {
    this.judges = OFFICIAL_LAYOUT.lineJudges.map(j => ({ ...j, hold: 0, signal: 'idle' }));
    if (typeof Image !== 'undefined') {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth !== 1536 || image.naturalHeight !== 1024) {
          this.loadFailed = true;
          return;
        }
        this.sheet = image;
      };
      image.onerror = () => { this.loadFailed = true; };
      image.src = OFFICIAL_ATLAS.source;
    }
  }

  get ballKids(): readonly never[] { return []; }

  private get refereeFrame(): number {
    if (this.signalKind === 'serve') return OFFICIAL_ATLAS.frames.refereeServe;
    if (this.signalKind === 'point') {
      return this.signalSide === 'home'
        ? OFFICIAL_ATLAS.frames.refereePointHome
        : OFFICIAL_ATLAS.frames.refereePointAway;
    }
    return OFFICIAL_ATLAS.frames.refereeIdle;
  }

  snapshotForDiagnostics() {
    const [near, far] = this.judges;
    return {
      ballKids: 0,
      officialsUsingPlayerRenderer: false,
      atlas: {
        cols: 4, rows: 2, frameCount: 8, source: OFFICIAL_ATLAS.source,
        loaded: this.sheet !== null, failed: this.loadFailed,
      },
      referee: {
        ...OFFICIAL_LAYOUT.referee,
        ...REFEREE_SEATED_COMPOSITION,
        seated: true, hasStool: true, hasLadder: true,
        offsetFromNetLine: Math.abs(OFFICIAL_LAYOUT.referee.y) > 0.01,
        frame: this.refereeFrame,
        rasterDraws: this.refereeDraws,
        proceduralBodyDraws: 0,
      },
      lineJudges: {
        count: this.judges.length,
        diagonalCorners: Math.sign(near.x) !== Math.sign(far.x)
          && Math.sign(near.y) !== Math.sign(far.y)
          && Math.abs(near.x) > COURT_HALF_WIDTH && Math.abs(far.x) > COURT_HALF_WIDTH
          && Math.abs(near.y) > COURT_HALF_LENGTH && Math.abs(far.y) > COURT_HALF_LENGTH,
        judges: this.judges.map(j => ({
          x: j.x, y: j.y, signal: j.signal, frame: JUDGE_FRAME[j.signal], holdingSignal: j.hold > 0,
        })),
      },
    };
  }

  authoriseServe(side: Side): void {
    this.signal = 1.1; this.signalSide = side; this.signalKind = 'serve';
  }
  callPoint(side: Side): void {
    this.signal = SIGNAL_TIME; this.signalSide = side; this.signalKind = 'point';
  }
  private nearestJudge(x: number, y: number): LineJudge {
    return this.judges.reduce((nearest, judge) =>
      Math.hypot(judge.x - x, judge.y - y) < Math.hypot(nearest.x - x, nearest.y - y)
        ? judge : nearest);
  }
  callLine(x: number, y: number, inside: boolean): void {
    const judge = this.nearestJudge(x, y);
    judge.signal = inside ? 'in' : 'out';
    judge.hold = SIGNAL_TIME;
  }
  callTouch(x: number, y: number): void {
    const judge = this.nearestJudge(x, y);
    judge.signal = 'touch';
    judge.hold = SIGNAL_TIME;
  }
  update(dt: number): void {
    this.signal = Math.max(0, this.signal - dt);
    if (this.signal === 0) this.signalKind = 'idle';
    for (const judge of this.judges) {
      judge.hold = Math.max(0, judge.hold - dt);
      if (judge.hold === 0) judge.signal = 'idle';
    }
  }

  drawFar(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const ref = OFFICIAL_LAYOUT.referee;
    if (this.drawPose(ctx, cam, ref.x, ref.y, this.refereeFrame, 1.9 * ref.visualScale, false)) {
      this.refereeDraws++;
    }
    for (const judge of this.judges) if (judge.y > 0) this.drawJudge(ctx, cam, judge);
  }
  drawNear(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const judge of this.judges) if (judge.y <= 0) this.drawJudge(ctx, cam, judge);
  }
  private drawJudge(ctx: CanvasRenderingContext2D, cam: Camera, judge: LineJudge): void {
    // Source looks left; the left court corner needs its reflected view.
    this.drawPose(ctx, cam, judge.x, judge.y, JUDGE_FRAME[judge.signal], 1.92, judge.y < 0);
  }

  private drawPose(
    ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number,
    frame: number, heightMetres: number, flip: boolean,
  ): boolean {
    if (!this.sheet) return false;
    const floor = cam.projectFloor(x, y);
    // Imported cutouts share the sole/chair-foot line y=486. The reference
    // body is 420 px tall for judges, 460 px for the complete referee/chair.
    // One uniform scale preserves the illustrator's human proportions.
    const nativeHeight = frame < 4 ? 460 : 420;
    const k = heightMetres * floor.scale * 42 / nativeHeight;
    ctx.save();
    ctx.translate(floor.x, floor.y);
    if (flip) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.sheet, (frame % 4) * 384, Math.floor(frame / 4) * 512, 384, 512,
      -192 * k, -486 * k, 384 * k, 512 * k);
    ctx.restore();
    return true;
  }
}

export type OfficialsDiagnostics = ReturnType<Officials['snapshotForDiagnostics']>;
