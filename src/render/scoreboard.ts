import { Side } from '../core/rules';
import { World } from '../core/world';
import { Camera } from './camera';

/**
 * The arena scoreboard: the big LED panel slung over the stand.
 *
 * Distinct from the HUD, which is the player's instrument panel drawn flat on
 * the glass. This one belongs to the building — it hangs in the scene, above
 * and behind the crowd, and it is what tells you the game is being played
 * somewhere rather than simulated in the abstract.
 *
 * Digits are drawn on a seven-segment grid rather than as text. A typeface at
 * this size reads as an overlay; segments read as bulbs, and the unlit ones
 * showing faintly is most of why.
 */

/** Which of the seven segments each digit lights. Order: top, tr, br, bottom, bl, tl, middle. */
const SEGMENTS: number[][] = [
  [1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [1, 1, 0, 1, 1, 0, 1],
  [1, 1, 1, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 1, 1],
  [1, 0, 1, 1, 0, 1, 1],
  [1, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1],
];

export class Scoreboard {
  /** Flashes for a beat whenever a number changes. */
  private flash = 0;
  private lastHome = -1;
  private lastAway = -1;

  update(world: World, dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    if (world.home.points !== this.lastHome || world.away.points !== this.lastAway) {
      if (this.lastHome >= 0) this.flash = 1;
      this.lastHome = world.home.points;
      this.lastAway = world.away.points;
    }
  }

  /**
   * Drawn with the background, before anything on the court: the board is part
   * of the building and must never sit in front of the play.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, world: World, time: number): void {
    const w = cam.viewWidth;
    // Hung over one end of the stand, not over the net.
    //
    // Centring it put it directly behind the HUD's own scoreboard, and left it
    // sharing a screen column with the net post and antenna — two readings of
    // the score stacked on top of each other, which is worse than either alone.
    const bw = Math.min(390, w * 0.3);
    const bh = bw * 0.36;
    const x = w * 0.26 - bw / 2;
    const y = cam.viewHeight * 0.2;

    ctx.save();

    // Hanging rig, run up out of frame.
    ctx.strokeStyle = 'rgba(120,134,160,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + bw * 0.2, 0);
    ctx.lineTo(x + bw * 0.2, y);
    ctx.moveTo(x + bw * 0.8, 0);
    ctx.lineTo(x + bw * 0.8, y);
    ctx.stroke();

    // Casing.
    const shell = ctx.createLinearGradient(0, y, 0, y + bh);
    shell.addColorStop(0, '#1b2131');
    shell.addColorStop(1, '#0c1120');
    ctx.fillStyle = shell;
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = 'rgba(150,170,205,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);

    // Panel face, inset.
    const pad = bw * 0.035;
    const fx = x + pad;
    const fy = y + pad;
    const fw = bw - pad * 2;
    const fh = bh - pad * 2;
    ctx.fillStyle = '#05070e';
    ctx.fillRect(fx, fy, fw, fh);

    const home = world.home;
    const away = world.away;
    const colH = fx + fw * 0.06;
    const colA = fx + fw * 0.56;
    const nameY = fy + fh * 0.26;

    ctx.font = `800 ${Math.round(fh * 0.17)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    for (const [col, team, side] of [
      [colH, home, 'home'],
      [colA, away, 'away'],
    ] as [number, typeof home, Side][]) {
      ctx.fillStyle = team.config.colors[0];
      ctx.fillRect(col, fy + fh * 0.1, fw * 0.03, fh * 0.2);
      ctx.fillStyle = 'rgba(226,236,255,0.9)';
      ctx.fillText(team.config.shortName.toUpperCase(), col + fw * 0.06, nameY);

      // The serve indicator: the ball sits beside whoever is about to serve.
      if (world.servingSide === side) {
        ctx.fillStyle = `rgba(255,214,102,${0.55 + 0.45 * Math.sin(time * 5)})`;
        ctx.beginPath();
        ctx.arc(col + fw * 0.27, nameY - fh * 0.05, fh * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sets won, as a row of pips.
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < team.setsWon ? '#ffd166' : 'rgba(255,209,102,0.16)';
        ctx.beginPath();
        ctx.arc(col + fw * 0.33 + i * fh * 0.1, nameY - fh * 0.05, fh * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const digitH = fh * 0.44;
    const digitW = digitH * 0.56;
    const lit = `rgba(255,120,80,${0.85 + this.flash * 0.15})`;
    this.number(ctx, home.points, colH, fy + fh * 0.5, digitW, digitH, lit);
    this.number(ctx, away.points, colA, fy + fh * 0.5, digitW, digitH, lit);

    // Set counter along the bottom.
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(fh * 0.12)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(160,180,215,0.65)';
    const setNo = Math.min(5, home.setsWon + away.setsWon + 1);
    ctx.fillText(`SET ${setNo}`, fx + fw / 2, fy + fh * 0.95);

    // Bloom over the whole face, brightest just after a point lands.
    const bloom = ctx.createRadialGradient(
      fx + fw / 2,
      fy + fh / 2,
      fh * 0.1,
      fx + fw / 2,
      fy + fh / 2,
      fw * 0.6,
    );
    bloom.addColorStop(0, `rgba(255,140,90,${0.05 + this.flash * 0.16})`);
    bloom.addColorStop(1, 'rgba(255,140,90,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(fx, fy, fw, fh);

    ctx.restore();
  }

  /** Two right-aligned seven-segment digits. */
  private number(
    ctx: CanvasRenderingContext2D,
    value: number,
    x: number,
    y: number,
    dw: number,
    dh: number,
    color: string,
  ): void {
    const tens = Math.floor(Math.abs(value) / 10) % 10;
    const ones = Math.abs(value) % 10;
    this.digit(ctx, tens, x, y, dw, dh, color, value >= 10);
    this.digit(ctx, ones, x + dw * 1.3, y, dw, dh, color, true);
  }

  private digit(
    ctx: CanvasRenderingContext2D,
    value: number,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    show: boolean,
  ): void {
    const on = SEGMENTS[value] ?? SEGMENTS[0];
    const t = Math.max(2, h * 0.13);
    const mid = y + h / 2;
    // [x, y, w, h] for each of the seven bars.
    const bars: [number, number, number, number][] = [
      [x + t * 0.5, y, w - t, t],
      [x + w - t, y + t * 0.5, t, h / 2 - t * 0.75],
      [x + w - t, mid + t * 0.25, t, h / 2 - t * 0.75],
      [x + t * 0.5, y + h - t, w - t, t],
      [x, mid + t * 0.25, t, h / 2 - t * 0.75],
      [x, y + t * 0.5, t, h / 2 - t * 0.75],
      [x + t * 0.5, mid - t / 2, w - t, t],
    ];
    for (let i = 0; i < bars.length; i++) {
      const alive = show && on[i] === 1;
      // Unlit segments show, but only just: at any more than this the ghosts
      // fill every digit out into an 8.
      ctx.fillStyle = alive ? color : 'rgba(255,120,80,0.035)';
      const [bx, by, bw, bh] = bars[i];
      ctx.fillRect(bx, by, bw, bh);
    }
  }
}
