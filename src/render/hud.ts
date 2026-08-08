import { MAX_TOUCHES, POWER_MAX, setTarget } from '../core/rules';
import { World } from '../core/world';

const INK = '#070b16';
const PANEL = 'rgba(7,11,24,0.86)';
const PANEL_DEEP = 'rgba(3,6,15,0.94)';
const CYAN = '#49dcff';
const GOLD = '#ffd35c';
const CORAL = '#ff5f5a';
const TEXT = '#f3f7ff';
const MUTED = 'rgba(209,224,246,0.62)';

/**
 * Broadcast HUD for the 2026 visual overhaul.
 *
 * It keeps the instant readability of a 90s cabinet, but replaces generic
 * rounded boxes with a single angular system: cut corners, thin luminous rails,
 * segmented meters and restrained glass. All text stays code-native and sharp
 * on a Retina backing store.
 */
export class Hud {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(
    world: World,
    width: number,
    height: number,
    opts: { gamepad: boolean; time: number },
  ): void {
    const ctx = this.ctx;
    ctx.save();
    this.drawScoreboard(world, width, opts.time);
    this.drawPowerGauges(world, width, height, opts.time);
    this.drawTouchPips(world, width, height, opts.time);
    this.drawHint(world, width, height, opts.gamepad);
    this.drawPhaseBanner(world, width, height, opts.time);
    ctx.restore();
  }

  private drawScoreboard(world: World, width: number, time: number): void {
    const ctx = this.ctx;
    const w = Math.min(720, width * 0.58);
    const h = 86;
    const x = width / 2 - w / 2;
    const y = 14;
    const cut = 16;
    const middle = x + w / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    cutPanel(ctx, x, y, w, h, cut);
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, 'rgba(19,29,52,0.95)');
    bg.addColorStop(0.5, PANEL);
    bg.addColorStop(1, PANEL_DEEP);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Fine broadcast frame and top colour rails.
    ctx.strokeStyle = 'rgba(151,188,232,0.25)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = world.home.config.colors[0];
    ctx.fillRect(x + cut, y, w / 2 - cut - 2, 3);
    ctx.fillStyle = world.away.config.colors[0];
    ctx.fillRect(middle + 2, y, w / 2 - cut - 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(middle - 1, y + 10, 2, h - 20);

    // Small technical header.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 11px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.letterSpacing = '1.3px';
    ctx.fillStyle = MUTED;
    ctx.fillText(`SET ${world.setNumber}   /   FIRST TO ${setTarget(world.setNumber)}`, middle, y + 18);
    ctx.letterSpacing = '0px';

    const teams = [world.home, world.away] as const;
    teams.forEach((team, index) => {
      const left = index === 0;
      const laneX = left ? x + 30 : middle + 30;
      const laneW = w / 2 - 60;
      const nameX = left ? laneX : laneX + laneW;
      const scoreX = left ? middle - 62 : middle + 62;

      // Team identity stripe with secondary-colour notch.
      const stripeX = left ? x + 13 : x + w - 21;
      ctx.fillStyle = team.config.colors[0];
      ctx.fillRect(stripeX, y + 17, 8, h - 34);
      ctx.fillStyle = team.config.colors[1];
      ctx.fillRect(stripeX, y + h - 29, 8, 12);

      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = '900 18px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = TEXT;
      ctx.fillText(team.config.shortName, nameX, y + 37);
      ctx.font = '700 9px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(218,229,248,0.48)';
      ctx.fillText(team.config.name.toUpperCase(), nameX, y + 54);

      // Score: outlined arcade numeral with restrained neon edge.
      const serving = world.servingSide === team.side;
      ctx.textAlign = 'center';
      ctx.font = '950 49px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.strokeText(String(team.points), scoreX, y + 54);
      ctx.shadowColor = serving ? GOLD : team.config.colors[0];
      ctx.shadowBlur = serving ? 14 + Math.sin(time * 8) * 3 : 4;
      ctx.fillStyle = serving ? GOLD : TEXT;
      ctx.fillText(String(team.points), scoreX, y + 54);
      ctx.shadowColor = 'transparent';

      // Set indicators as small slanted cartridges.
      const baseX = left ? nameX : nameX - 44;
      for (let i = 0; i < 3; i++) {
        const px = baseX + i * 15;
        ctx.beginPath();
        ctx.moveTo(px + 3, y + 64);
        ctx.lineTo(px + 12, y + 64);
        ctx.lineTo(px + 9, y + 70);
        ctx.lineTo(px, y + 70);
        ctx.closePath();
        ctx.fillStyle = i < team.setsWon ? GOLD : 'rgba(255,255,255,0.16)';
        ctx.fill();
      }

      if (serving) {
        const sx = left ? scoreX + 34 : scoreX - 34;
        const dir = left ? 1 : -1;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(sx, y + 66);
        ctx.lineTo(sx + dir * 11, y + 61);
        ctx.lineTo(sx + dir * 11, y + 71);
        ctx.closePath();
        ctx.fill();
      }
    });

    // Centre badge bridges both team lanes.
    const badgeW = 78;
    const badgeX = middle - badgeW / 2;
    cutPanel(ctx, badgeX, y + 31, badgeW, 43, 8);
    ctx.fillStyle = 'rgba(4,8,18,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(73,220,255,0.32)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = CYAN;
    ctx.fillText('SV90', middle, y + 45);
    ctx.font = '800 9px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = GOLD;
    ctx.fillText('LIVE', middle, y + 61);
    ctx.restore();
  }

  /** Segmented energy cells, filling towards centre court. */
  private drawPowerGauges(world: World, width: number, height: number, time: number): void {
    const ctx = this.ctx;
    const gaugeW = Math.min(278, width * 0.23);
    const segmentCount = 10;
    const segmentGap = 3;
    const segmentW = (gaugeW - segmentGap * (segmentCount - 1)) / segmentCount;
    const y = height - 58;

    for (const team of [world.home, world.away]) {
      const left = team.side === 'home';
      const x = left ? 22 : width - 22 - gaugeW;
      const fill = Math.min(1, team.power / POWER_MAX);
      const ready = team.powerReady;

      ctx.save();
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = ready ? GOLD : 'rgba(219,231,249,0.62)';
      const label = ready ? 'LETHAL READY' : `${team.config.shortName}  OVERDRIVE`;
      ctx.fillText(label, left ? x : x + gaugeW, y - 9);

      // Under-rail.
      ctx.fillStyle = 'rgba(4,8,18,0.78)';
      ctx.fillRect(x - 4, y - 4, gaugeW + 8, 20);
      ctx.fillStyle = team.config.colors[1];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y + 12, gaugeW, 2);
      ctx.globalAlpha = 1;

      const lit = fill * segmentCount;
      for (let i = 0; i < segmentCount; i++) {
        const order = left ? i : segmentCount - 1 - i;
        const sx = x + i * (segmentW + segmentGap);
        const amount = Math.max(0, Math.min(1, lit - order));
        const slant = 4;
        ctx.beginPath();
        ctx.moveTo(sx + slant, y);
        ctx.lineTo(sx + segmentW, y);
        ctx.lineTo(sx + segmentW - slant, y + 12);
        ctx.lineTo(sx, y + 12);
        ctx.closePath();
        if (amount > 0) {
          const pulse = ready ? 0.72 + Math.sin(time * 10 + i) * 0.22 : 1;
          const grad = ctx.createLinearGradient(sx, 0, sx + segmentW, 0);
          grad.addColorStop(0, team.config.colors[0]);
          grad.addColorStop(1, ready ? CORAL : CYAN);
          ctx.globalAlpha = (0.45 + amount * 0.55) * pulse;
          ctx.fillStyle = grad;
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(189,213,239,0.11)';
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  private drawTouchPips(world: World, width: number, height: number, time: number): void {
    if (world.phase !== 'rally' || world.touches === 0) return;
    const ctx = this.ctx;
    const team = world.team(world.possession);
    const cx = width / 2;
    const y = height - 78;
    const w = 146;

    ctx.save();
    cutPanel(ctx, cx - w / 2, y - 22, w, 37, 8);
    ctx.fillStyle = 'rgba(5,9,20,0.82)';
    ctx.fill();
    ctx.strokeStyle = withAlpha(team.config.colors[0], 0.6);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '800 9px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(`${team.config.shortName} TOUCH`, cx, y - 8);

    for (let i = 0; i < MAX_TOUCHES; i++) {
      const px = cx + (i - 1) * 25;
      const used = i < world.touches;
      const r = used && i === world.touches - 1 ? 6 + Math.sin(time * 11) : 5;
      ctx.save();
      ctx.translate(px, y + 5);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = used
        ? i === MAX_TOUCHES - 1
          ? CORAL
          : team.config.colors[0]
        : 'rgba(255,255,255,0.12)';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHint(world: World, width: number, height: number, gamepad: boolean): void {
    const ctx = this.ctx;
    const action = gamepad ? 'A' : 'SPACE';
    const jump = gamepad ? 'B' : 'SHIFT';
    const isServe = world.phase === 'serve';
    const entries = isServe
      ? [
          [action, 'HOLD / RELEASE  TOSS'],
          [action, 'TAP  HIT'],
          ['← → ↑ ↓', 'AIM'],
        ]
      : [
          [action, 'PLAY / JUMP / SPIKE'],
          [jump, 'LETHAL'],
          ['← → ↑ ↓', 'MOVE + AIM'],
        ];

    const totalW = Math.min(520, width * 0.46);
    const x = width / 2 - totalW / 2;
    const y = height - 28;
    const each = totalW / entries.length;

    ctx.save();
    ctx.textBaseline = 'middle';
    entries.forEach(([key, label], i) => {
      const cx = x + each * (i + 0.5);
      ctx.font = '900 9px "Arial Narrow", "Inter", system-ui, sans-serif';
      const keyW = Math.max(32, ctx.measureText(key).width + 14);
      cutPanel(ctx, cx - each * 0.42, y - 10, keyW, 20, 5);
      ctx.fillStyle = 'rgba(10,18,34,0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(73,220,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = CYAN;
      ctx.fillText(key, cx - each * 0.42 + keyW / 2, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(222,233,250,0.58)';
      ctx.font = '800 9px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillText(label, cx - each * 0.42 + keyW + 8, y);
    });
    ctx.restore();
  }

  private drawPhaseBanner(world: World, width: number, height: number, time: number): void {
    if (world.phase !== 'setBreak' && world.phase !== 'matchOver') return;
    const ctx = this.ctx;
    const winner = world.home.setsWon > world.away.setsWon ? world.home : world.away;
    const accent = world.phase === 'matchOver' ? winner.config.colors[0] : GOLD;
    const w = Math.min(760, width * 0.7);
    const h = 176;
    const x = width / 2 - w / 2;
    const y = height / 2 - h / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(2,5,13,0.72)';
    ctx.fillRect(0, 0, width, height);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 28 + Math.sin(time * 5) * 4;
    cutPanel(ctx, x, y, w, h, 28);
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, 'rgba(18,29,52,0.98)');
    grad.addColorStop(1, 'rgba(4,7,17,0.98)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = withAlpha(accent, 0.78);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(x + 34, y, w - 68, 5);
    ctx.fillRect(x + 34, y + h - 5, w - 68, 5);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (world.phase === 'matchOver') {
      ctx.font = '950 52px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.lineWidth = 8;
      ctx.strokeStyle = INK;
      ctx.strokeText(winner.config.name.toUpperCase(), width / 2, y + 62);
      ctx.fillStyle = TEXT;
      ctx.fillText(winner.config.name.toUpperCase(), width / 2, y + 62);
      ctx.font = '900 18px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(`MATCH WINNER  //  ${world.home.setsWon} — ${world.away.setsWon}`, width / 2, y + 108);
      ctx.font = '700 11px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = MUTED;
      ctx.fillText('PRESS ESC TO RETURN TO TEAM SELECT', width / 2, y + 144);
    } else {
      ctx.font = '950 48px "Arial Black", "Inter", system-ui, sans-serif';
      ctx.fillStyle = TEXT;
      ctx.fillText(`SET ${world.setNumber} COMPLETE`, width / 2, y + 66);
      ctx.font = '900 18px "Arial Narrow", "Inter", system-ui, sans-serif';
      ctx.fillStyle = GOLD;
      ctx.fillText(`${world.home.setScores.join(' · ')}   //   ${world.away.setScores.join(' · ')}`, width / 2, y + 116);
    }
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
