import { clamp } from '../core/math3';
import type { Side } from '../core/rules';
import { coverSourceRect } from './arena-art';

type Gesture = 'clap' | 'flag' | 'scarf';
interface Fan { x: number; y: number; gesture: Gesture; phase: number; side: Side }

/** Hand positions in grandstand-manga-v3.png, checked against its drawn fans.
 * Only hands, scarves and small flags move. Faces, seats and architecture stay
 * fixed, so the illustrated stand never trembles with an artificial camera pan.
 */
const HAND_ANCHORS: readonly (readonly [number, number, Gesture])[] = [
  [56, 437, 'flag'], [170, 439, 'clap'], [319, 449, 'clap'], [445, 438, 'scarf'],
  [680, 438, 'clap'], [769, 439, 'flag'], [907, 447, 'clap'], [1034, 437, 'scarf'],
  [1202, 439, 'clap'], [1307, 437, 'flag'], [1503, 448, 'clap'], [1636, 445, 'scarf'],
  [1798, 439, 'clap'], [1910, 441, 'flag'],
  [126, 552, 'clap'], [267, 549, 'flag'], [414, 553, 'clap'], [617, 547, 'scarf'],
  [760, 550, 'clap'], [899, 552, 'flag'], [1050, 553, 'clap'], [1168, 552, 'scarf'],
  [1336, 552, 'clap'], [1458, 552, 'flag'], [1611, 550, 'clap'], [1762, 551, 'scarf'],
  [1922, 552, 'clap'],
  [157, 680, 'clap'], [361, 681, 'clap'], [532, 675, 'clap'], [584, 681, 'flag'],
  [632, 681, 'clap'], [680, 681, 'clap'], [780, 681, 'scarf'], [907, 680, 'clap'],
  [1125, 680, 'clap'], [1224, 681, 'flag'], [1506, 680, 'clap'], [1690, 681, 'scarf'],
  [1860, 680, 'clap'], [1981, 680, 'flag'],
];

export const CROWD_REACTION_CONTRACT = {
  animatedFans: HAND_ANCHORS.length,
  sourceWidth: 2048,
  sourceHeight: 768,
  gestures: ['clap', 'flag', 'scarf'],
  movesBackground: false,
  imageReadbacksPerFrame: 0,
} as const;

/** Same bottom crop and 2560x1440 scene mapping used by ArenaArtwork. */
export function crowdSourcePlacement(width: number, height: number) {
  const crop = coverSourceRect(2560, 1440, width, height);
  const stand = coverSourceRect(2048, 768, 2560, 580);
  const sceneScale = width / crop.sw;
  const scale = sceneScale * 2560 / stand.sw;
  return { x: -crop.sx * sceneScale - stand.sx * scale,
    y: (40 - crop.sy) * sceneScale - (768 - stand.sh) * scale, scale };
}

/** Continuous bounded motion; a rally/point increases amplitude, not frequency
 * discontinuities. Staggered phases give a travelling stand reaction.
 */
export function crowdGestureMotion(time: number, phase: number, excitement: number) {
  const energy = clamp(excitement, 0, 1);
  const wave = Math.sin(time * 3.1 + phase);
  return { sway: wave * (2.4 + energy * 5.6),
    lift: (0.5 + 0.5 * Math.sin(time * 2.4 + phase * 1.7)) * (2 + energy * 9),
    clap: 1.1 + (0.5 + 0.5 * Math.sin(time * 7.5 + phase)) * (2.2 + energy * 3.6) };
}

export class CrowdReactions {
  private readonly fans: readonly Fan[] = HAND_ANCHORS.map(([x, y, gesture], i) => ({
    x, y, gesture, phase: i * 2.399963, side: i % 2 ? 'away' : 'home',
  }));
  private home: readonly string[] = ['#568ad2', '#e5d2a6'];
  private away: readonly string[] = ['#ae594f', '#dcb35c'];
  private intensity = 0;
  private cheeringSide: Side | null = null;
  private draws = 0;

  setTeamColors(home: readonly string[], away: readonly string[]): void {
    this.home = home; this.away = away;
  }

  cheer(amount: number, side?: Side): void {
    this.intensity = Math.min(1, this.intensity + amount);
    this.cheeringSide = side ?? null;
  }

  update(dt: number): void {
    // Exponential release avoids a visible stop at the end of every point.
    this.intensity *= Math.exp(-Math.max(0, dt) * 0.78);
  }

  get diagnostics() { return { ...CROWD_REACTION_CONTRACT, intensity: this.intensity, draws: this.draws }; }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    const placement = crowdSourcePlacement(width, height);
    ctx.save();
    ctx.translate(placement.x, placement.y);
    ctx.scale(placement.scale, placement.scale);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const fan of this.fans) {
      // The opposing bank still reacts to the rally, but the scorer's fans lead.
      const energy = this.intensity * (this.cheeringSide === fan.side ? 1 : 0.55);
      const motion = crowdGestureMotion(time, fan.phase, energy);
      const colors = fan.side === 'home' ? this.home : this.away;
      ctx.save(); ctx.translate(fan.x, fan.y);
      ctx.globalAlpha = 0.68 + energy * 0.2;
      if (fan.gesture === 'clap') this.drawClap(ctx, motion.clap, motion.lift);
      else if (fan.gesture === 'flag') this.drawFlag(ctx, motion.sway, motion.lift, colors, time + fan.phase);
      else this.drawScarf(ctx, motion.sway, motion.lift, colors);
      ctx.restore();
    }
    ctx.restore(); this.draws++;
  }

  private drawClap(ctx: CanvasRenderingContext2D, separation: number, lift: number): void {
    ctx.strokeStyle = '#162438'; ctx.lineWidth = 5.6;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(side * 6, 5);
      ctx.quadraticCurveTo(side * 7, -1, side * separation, -5 - lift * 0.32); ctx.stroke();
    }
    ctx.strokeStyle = '#ad8e76'; ctx.lineWidth = 2.8;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(side * 5, 2);
      ctx.lineTo(side * separation, -5 - lift * 0.32); ctx.stroke();
    }
  }

  private drawFlag(ctx: CanvasRenderingContext2D, sway: number, lift: number,
    colors: readonly string[], phase: number): void {
    const topX = 3 + sway, topY = -28 - lift;
    ctx.strokeStyle = '#112033'; ctx.lineWidth = 3.1;
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(topX, topY - 2); ctx.stroke();
    ctx.strokeStyle = '#b6a385'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(topX, topY - 2); ctx.stroke();
    const flutter = Math.sin(phase * 4.7) * 2.8;
    ctx.beginPath(); ctx.moveTo(topX, topY);
    ctx.bezierCurveTo(topX + 7, topY - 3, topX + 14, topY + 5 + flutter, topX + 23, topY + flutter);
    ctx.lineTo(topX + 22, topY + 13 + flutter);
    ctx.bezierCurveTo(topX + 13, topY + 17 + flutter, topX + 7, topY + 9, topX, topY + 12);
    ctx.closePath(); ctx.fillStyle = colors[0]; ctx.fill();
    ctx.strokeStyle = '#142238'; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.strokeStyle = colors[1]; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(topX + 3, topY + 6);
    ctx.bezierCurveTo(topX + 9, topY + 3, topX + 15, topY + 10 + flutter, topX + 20, topY + 7 + flutter); ctx.stroke();
  }

  private drawScarf(ctx: CanvasRenderingContext2D, sway: number, lift: number, colors: readonly string[]): void {
    const y = -19 - lift;
    ctx.strokeStyle = '#102035'; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(-8, 3); ctx.lineTo(-15 + sway, y + 5);
    ctx.moveTo(8, 3); ctx.lineTo(15 + sway, y + 5); ctx.stroke();
    ctx.strokeStyle = '#a58b77'; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18 + sway, y); ctx.quadraticCurveTo(sway, y + 5, 18 + sway, y);
    ctx.lineTo(17 + sway, y + 7); ctx.quadraticCurveTo(sway, y + 11, -17 + sway, y + 7); ctx.closePath();
    ctx.fillStyle = colors[0]; ctx.fill(); ctx.strokeStyle = '#122034'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = colors[1]; ctx.lineWidth = 2.1;
    ctx.beginPath(); ctx.moveTo(-14 + sway, y + 4); ctx.quadraticCurveTo(sway, y + 7, 14 + sway, y + 4); ctx.stroke();
  }
}
