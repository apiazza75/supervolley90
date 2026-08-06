import { TeamConfig } from '../core/team';
import { InputManager } from './input';
import { TEAMS } from './teams';

export interface MatchSetup {
  home: TeamConfig;
  away: TeamConfig;
  difficulty: number;
  seed: number;
}

const DIFFICULTY_NAMES = ['ROOKIE', 'ARCADE', 'PRO'];
const CYAN = '#49dcff';
const GOLD = '#ffd35c';
const CORAL = '#ff5f5a';
const TEXT = '#f4f7ff';
const MUTED = 'rgba(210,225,248,0.58)';

/**
 * Team select and attract screen, rebuilt as a contemporary arcade broadcast.
 * The controls remain cabinet-simple; only the presentation changes.
 */
export class Menu {
  private homeIndex = 0;
  private awayIndex = 3;
  private difficulty = 1;
  /** 0 = your team, 1 = opponent, 2 = difficulty, 3 = start. */
  private row = 0;
  private cooldown = 0;
  private blink = 0;

  /** Set once the player confirms; the app reads and clears it. */
  ready: MatchSetup | null = null;

  update(input: InputManager, dt: number): void {
    this.blink += dt;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }

    const dir = input.direction();

    if (dir.y < -0.5) {
      this.row = (this.row + 1) % 4;
      this.cooldown = 0.16;
    } else if (dir.y > 0.5) {
      this.row = (this.row + 3) % 4;
      this.cooldown = 0.16;
    } else if (dir.x < -0.5) {
      this.adjust(-1);
      this.cooldown = 0.16;
    } else if (dir.x > 0.5) {
      this.adjust(1);
      this.cooldown = 0.16;
    }

    if (input.actionPressed) {
      if (this.row === 3) this.confirm();
      else this.row = Math.min(3, this.row + 1);
      this.cooldown = 0.25;
    }
  }

  private adjust(delta: number): void {
    if (this.row === 0) {
      this.homeIndex = (this.homeIndex + delta + TEAMS.length) % TEAMS.length;
      if (this.homeIndex === this.awayIndex) this.adjust(delta);
    } else if (this.row === 1) {
      this.awayIndex = (this.awayIndex + delta + TEAMS.length) % TEAMS.length;
      if (this.homeIndex === this.awayIndex) this.adjust(delta);
    } else if (this.row === 2) {
      this.difficulty = Math.max(0, Math.min(2, this.difficulty + delta));
    }
  }

  private confirm(): void {
    this.ready = {
      home: TEAMS[this.homeIndex],
      away: TEAMS[this.awayIndex],
      difficulty: this.difficulty,
      seed: (Date.now() & 0x7fffffff) >>> 0,
    };
  }

  reset(): void {
    this.ready = null;
    this.row = 0;
    this.cooldown = 0.3;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, gamepad: boolean): void {
    this.drawBackdrop(ctx, width, height);
    this.drawTitle(ctx, width, height);

    const compact = width < 940 || height < 650;
    const gap = compact ? 18 : 34;
    const cardW = Math.min(compact ? 300 : 380, width * 0.38);
    const cardH = compact ? 194 : 226;
    const cardsY = compact ? height * 0.27 : height * 0.31;
    const leftX = width / 2 - gap / 2 - cardW;
    const rightX = width / 2 + gap / 2;

    this.drawTeamCard(
      ctx,
      TEAMS[this.homeIndex],
      leftX,
      cardsY,
      cardW,
      cardH,
      'YOUR TEAM',
      this.row === 0,
      false,
    );
    this.drawTeamCard(
      ctx,
      TEAMS[this.awayIndex],
      rightX,
      cardsY,
      cardW,
      cardH,
      'RIVAL',
      this.row === 1,
      true,
    );

    const controlsY = cardsY + cardH + (compact ? 24 : 34);
    this.drawDifficulty(ctx, width, controlsY, this.row === 2);
    this.drawStart(ctx, width, controlsY + 66, this.row === 3);

    const confirm = gamepad ? 'A' : 'SPACE';
    const move = gamepad ? 'STICK / D-PAD' : 'ARROWS / WASD';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 11px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(`${move}  SELECT     //     ${confirm}  CONFIRM`, width / 2, height - 28);
    ctx.restore();
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#02050d');
    bg.addColorStop(0.48, '#0a1530');
    bg.addColorStop(1, '#030610');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Arena-tunnel vanishing geometry.
    const cx = width / 2;
    const horizon = height * 0.42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = -8; i <= 8; i++) {
      const endX = cx + i * width * 0.12;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(73,220,255,0.085)' : 'rgba(255,95,90,0.055)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(endX, height);
      ctx.stroke();
    }
    for (let y = horizon; y < height; y += Math.max(28, (y - horizon) * 0.17)) {
      ctx.strokeStyle = 'rgba(98,156,224,0.075)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Moving light columns and centre glow.
    for (let i = 0; i < 5; i++) {
      const x = (width * (i + 0.5)) / 5 + Math.sin(this.blink * 0.35 + i) * 12;
      const beam = ctx.createLinearGradient(x - 100, 0, x + 100, 0);
      beam.addColorStop(0, 'rgba(73,220,255,0)');
      beam.addColorStop(0.5, i % 2 ? 'rgba(255,211,92,0.045)' : 'rgba(73,220,255,0.055)');
      beam.addColorStop(1, 'rgba(73,220,255,0)');
      ctx.fillStyle = beam;
      ctx.fillRect(x - 100, 0, 200, height);
    }
    const glow = ctx.createRadialGradient(cx, horizon, 8, cx, horizon, width * 0.42);
    glow.addColorStop(0, 'rgba(58,142,255,0.16)');
    glow.addColorStop(0.5, 'rgba(41,87,164,0.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Fine scanlines keep the coin-op heritage without pixelating the UI.
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
  }

  private drawTitle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const y = Math.max(62, height * 0.12);
    const size = Math.min(72, Math.max(42, width * 0.052));
    ctx.save();
    ctx.translate(width / 2, y);
    ctx.transform(1, 0, -0.12, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `950 ${size}px "Arial Black", "Inter", system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(7, size * 0.13);
    ctx.strokeStyle = '#02050d';
    ctx.strokeText('SUPER VOLLEY 90', 0, 0);
    const grad = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.42, '#ccefff');
    grad.addColorStop(0.46, CYAN);
    grad.addColorStop(0.62, '#2878cf');
    grad.addColorStop(1, '#11264d');
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 18;
    ctx.fillStyle = grad;
    ctx.fillText('SUPER VOLLEY 90', 0, 0);
    ctx.shadowColor = 'transparent';
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 11px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillStyle = GOLD;
    ctx.fillText('ARCADE EVOLVED  //  2026 EDITION', width / 2, y + size * 0.65);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  private drawTeamCard(
    ctx: CanvasRenderingContext2D,
    team: TeamConfig,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    mirrored: boolean,
  ): void {
    const cut = 18;
    ctx.save();
    ctx.shadowColor = selected ? team.colors[0] : 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = selected ? 22 + Math.sin(this.blink * 8) * 4 : 14;
    ctx.shadowOffsetY = 8;
    cutPanel(ctx, x, y, w, h, cut);
    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, 'rgba(18,29,52,0.97)');
    bg.addColorStop(0.58, 'rgba(8,14,31,0.96)');
    bg.addColorStop(1, 'rgba(3,7,17,0.99)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = selected ? team.colors[0] : 'rgba(130,166,215,0.25)';
    ctx.lineWidth = selected ? 2.4 : 1.2;
    ctx.stroke();

    // Team-colour diagonal field.
    ctx.save();
    cutPanel(ctx, x, y, w, h, cut);
    ctx.clip();
    const wash = ctx.createLinearGradient(mirrored ? x + w : x, y, mirrored ? x : x + w, y + h);
    wash.addColorStop(0, withAlpha(team.colors[0], 0.36));
    wash.addColorStop(0.48, withAlpha(team.colors[1], 0.09));
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = team.colors[0];
    for (let i = -2; i < 7; i++) {
      const sx = x + i * 74 + (mirrored ? 18 : 0);
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 32, y + h);
      ctx.lineTo(sx + 138, y);
      ctx.lineTo(sx + 106, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.textBaseline = 'middle';
    ctx.textAlign = mirrored ? 'right' : 'left';
    const tx = mirrored ? x + w - 24 : x + 24;
    ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = selected ? GOLD : MUTED;
    ctx.fillText(`${label}  //  ${selected ? 'SELECTED' : 'STANDBY'}`, tx, y + 22);

    ctx.font = `950 ${Math.min(56, h * 0.25)}px "Arial Black", "Inter", system-ui, sans-serif`;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#050914';
    ctx.strokeText(team.shortName, tx, y + 67);
    ctx.fillStyle = TEXT;
    ctx.fillText(team.shortName, tx, y + 67);
    ctx.font = '900 16px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = team.colors[0];
    ctx.fillText(team.name.toUpperCase(), tx, y + 100);

    // Six-player formation silhouettes, tinted but not flat stick figures.
    const formationX = mirrored ? x + 58 : x + w - 126;
    const formationY = y + 92;
    this.drawFormation(ctx, formationX, formationY, team.colors, mirrored, h > 205 ? 1 : 0.84);

    // Rating rail and roster summary.
    const railX = mirrored ? x + w - 184 : x + 24;
    const railY = y + h - 48;
    const railW = 160;
    ctx.textAlign = mirrored ? 'right' : 'left';
    ctx.font = '800 9px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(`TEAM RATING  ${Math.round(team.rating * 100)}`, mirrored ? railX + railW : railX, railY - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(railX, railY, railW, 8);
    const ratingW = railW * team.rating;
    ctx.fillStyle = team.colors[0];
    ctx.fillRect(mirrored ? railX + railW - ratingW : railX, railY, ratingW, 8);
    ctx.fillStyle = team.colors[1];
    ctx.fillRect(mirrored ? railX : railX + railW - 5, railY, 5, 8);

    const names = (team.players ?? []).slice(0, 3).map((p) => p.name.toUpperCase()).join('  ·  ');
    ctx.textAlign = mirrored ? 'right' : 'left';
    ctx.fillStyle = 'rgba(218,229,248,0.43)';
    ctx.font = '700 8px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillText(names, mirrored ? x + w - 24 : x + 24, y + h - 19);

    if (selected) {
      const arrowY = y + h / 2;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      if (mirrored) {
        ctx.moveTo(x + w + 17, arrowY);
        ctx.lineTo(x + w + 31, arrowY - 11);
        ctx.lineTo(x + w + 31, arrowY + 11);
      } else {
        ctx.moveTo(x - 17, arrowY);
        ctx.lineTo(x - 31, arrowY - 11);
        ctx.lineTo(x - 31, arrowY + 11);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFormation(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colors: [string, string],
    mirrored: boolean,
    scale: number,
  ): void {
    const poses = [
      [-42, 28, 0.88],
      [0, 18, 1],
      [42, 28, 0.9],
      [-31, -22, 0.78],
      [9, -32, 0.86],
      [47, -18, 0.8],
    ] as const;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(mirrored ? -scale : scale, scale);
    poses.forEach(([px, py, k], i) => {
      const primary = i === 2 ? colors[1] : colors[0];
      ctx.globalAlpha = 0.56 + i * 0.045;
      const grad = ctx.createLinearGradient(px - 8, 0, px + 8, 0);
      grad.addColorStop(0, withAlpha(primary, 0.45));
      grad.addColorStop(0.55, primary);
      grad.addColorStop(1, withAlpha(colors[1], 0.7));
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(5,9,19,0.95)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(px, py - 30 * k, 7 * k, 9 * k, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 8 * k, py - 21 * k);
      ctx.lineTo(px + 6 * k, py - 22 * k);
      ctx.lineTo(px + 9 * k, py - 4 * k);
      ctx.lineTo(px - 5 * k, py - 2 * k);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = primary;
      ctx.lineCap = 'round';
      ctx.lineWidth = 5 * k;
      ctx.beginPath();
      ctx.moveTo(px - 2 * k, py - 2 * k);
      ctx.lineTo(px - 7 * k, py + 16 * k);
      ctx.moveTo(px + 5 * k, py - 2 * k);
      ctx.lineTo(px + 10 * k, py + 15 * k);
      ctx.stroke();
    });
    ctx.restore();
  }

  private drawDifficulty(ctx: CanvasRenderingContext2D, width: number, y: number, selected: boolean): void {
    const panelW = 410;
    const x = width / 2 - panelW / 2;
    ctx.save();
    cutPanel(ctx, x, y, panelW, 48, 11);
    ctx.fillStyle = selected ? 'rgba(16,29,51,0.96)' : 'rgba(6,11,24,0.84)';
    ctx.fill();
    ctx.strokeStyle = selected ? CYAN : 'rgba(119,158,209,0.25)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText('DIFFICULTY', x + 20, y + 24);

    const start = x + 130;
    DIFFICULTY_NAMES.forEach((name, i) => {
      const active = i === this.difficulty;
      const bx = start + i * 88;
      cutPanel(ctx, bx, y + 10, 76, 28, 6);
      ctx.fillStyle = active ? (i === 2 ? CORAL : i === 1 ? GOLD : CYAN) : 'rgba(255,255,255,0.06)';
      ctx.globalAlpha = active ? 0.92 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = active ? '#07101c' : 'rgba(223,234,250,0.44)';
      ctx.fillText(name, bx + 38, y + 24);
    });
    ctx.restore();
  }

  private drawStart(ctx: CanvasRenderingContext2D, width: number, y: number, selected: boolean): void {
    const w = 282;
    const h = 48;
    const x = width / 2 - w / 2;
    const pulse = 0.78 + Math.sin(this.blink * 7) * 0.22;
    ctx.save();
    ctx.shadowColor = selected ? GOLD : 'transparent';
    ctx.shadowBlur = selected ? 20 : 0;
    cutPanel(ctx, x, y, w, h, 13);
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, selected ? CYAN : 'rgba(38,73,111,0.5)');
    grad.addColorStop(0.5, selected ? GOLD : 'rgba(69,83,105,0.6)');
    grad.addColorStop(1, selected ? CORAL : 'rgba(38,73,111,0.5)');
    ctx.globalAlpha = selected ? pulse : 0.7;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(155,184,222,0.28)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '950 18px "Arial Black", "Inter", system-ui, sans-serif';
    ctx.fillStyle = selected ? '#06101c' : 'rgba(235,241,252,0.68)';
    ctx.fillText('START MATCH', width / 2, y + h / 2);
    ctx.restore();
  }
}

function cutPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
