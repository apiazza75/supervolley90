import { MAX_TOUCHES, POWER_MAX, setTarget } from '../core/rules';
import { World } from '../core/world';

/**
 * Scoreboard and status overlay. Drawn in screen space on top of the arena,
 * in the chunky high-contrast style a 90s cabinet needed to stay readable
 * across a lit room.
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
    this.drawScoreboard(world, width);
    this.drawPowerGauges(world, width, height, opts.time);
    this.drawTouchPips(world, width, height);
    this.drawHint(world, width, height, opts.gamepad);
    this.drawPhaseBanner(world, width, height);
    ctx.restore();
  }

  /**
   * The Lethal Maneuver gauges, one per side, mirrored so each fills towards
   * the middle of the screen — which is where that team's net-side action is.
   * A full gauge pulses hard: it is the cue to go up and hit the B button.
   */
  private drawPowerGauges(world: World, width: number, height: number, time: number): void {
    const ctx = this.ctx;
    const w = 210;
    const h = 16;
    const y = height - 96;

    for (const team of [world.home, world.away]) {
      const left = team.side === 'home';
      const x = left ? 26 : width - 26 - w;
      const fill = Math.min(1, team.power / POWER_MAX);
      const ready = team.powerReady;

      ctx.save();
      ctx.fillStyle = 'rgba(6,9,20,0.72)';
      roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 5);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x, y, w, h);

      // Mirror the away gauge so both grow towards the centre of the screen.
      const fw = w * fill;
      const fx = left ? x : x + w - fw;

      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      if (ready) {
        const pulse = 0.72 + 0.28 * Math.sin(time * 9);
        grad.addColorStop(0, `rgba(255,226,122,${pulse})`);
        grad.addColorStop(0.5, `rgba(255,138,61,${pulse})`);
        grad.addColorStop(1, `rgba(255,90,80,${pulse})`);
      } else {
        grad.addColorStop(0, '#3c7fd6');
        grad.addColorStop(1, '#6fe3ff');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(fx, y, fw, h);

      // Quarter ticks, so partial progress is readable at a glance.
      ctx.strokeStyle = 'rgba(6,9,20,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 4; i++) {
        const tx = x + (w * i) / 4;
        ctx.beginPath();
        ctx.moveTo(tx, y);
        ctx.lineTo(tx, y + h);
        ctx.stroke();
      }

      ctx.textAlign = left ? 'left' : 'right';
      ctx.font = '800 11px system-ui, sans-serif';
      if (ready) {
        ctx.fillStyle = `rgba(255,226,122,${0.65 + 0.35 * Math.sin(time * 9)})`;
        ctx.fillText('LETHAL MANEUVER READY', left ? x : x + w, y - 8);
      } else {
        ctx.fillStyle = 'rgba(200,215,245,0.5)';
        ctx.fillText(`${team.config.shortName} POWER`, left ? x : x + w, y - 8);
      }
      ctx.restore();
    }
  }

  private drawScoreboard(world: World, width: number): void {
    const ctx = this.ctx;
    const w = 460;
    const h = 76;
    const x = width / 2 - w / 2;
    const y = 18;

    ctx.fillStyle = 'rgba(8,11,24,0.82)';
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const teams = [world.home, world.away];
    teams.forEach((team, i) => {
      const left = i === 0;
      const cx = left ? x + 96 : x + w - 96;

      ctx.fillStyle = team.config.colors[0];
      ctx.fillRect(left ? x + 12 : x + w - 24, y + 14, 12, h - 28);

      ctx.font = '700 19px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#e9eefc';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(team.config.shortName, left ? x + 34 : x + w - 34, y + 32);

      ctx.font = '900 40px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = world.servingSide === team.side ? '#ffe27a' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(String(team.points), cx, y + 60);

      // Sets won, as filled pips.
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.arc(cx + (s - 1) * 14, y + 20, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = s < team.setsWon ? '#ffe27a' : 'rgba(255,255,255,0.22)';
        ctx.fill();
      }
    });

    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,230,255,0.65)';
    ctx.fillText(`SET ${world.setNumber} — TO ${setTarget(world.setNumber)}`, x + w / 2, y + 26);

    // Serve indicator arrow.
    const serveX = world.servingSide === 'home' ? x + w / 2 - 46 : x + w / 2 + 46;
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.moveTo(serveX, y + 58);
    ctx.lineTo(serveX + (world.servingSide === 'home' ? -9 : 9), y + 52);
    ctx.lineTo(serveX + (world.servingSide === 'home' ? -9 : 9), y + 64);
    ctx.closePath();
    ctx.fill();
  }

  /** Touch counter for the side currently playing the ball. */
  private drawTouchPips(world: World, width: number, height: number): void {
    if (world.phase !== 'rally' || world.touches === 0) return;
    const ctx = this.ctx;
    const team = world.team(world.possession);
    const y = height - 46;
    const cx = width / 2;

    ctx.textAlign = 'center';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,230,255,0.7)';
    ctx.fillText(`${team.config.shortName} TOUCHES`, cx, y - 14);

    for (let i = 0; i < MAX_TOUCHES; i++) {
      const px = cx + (i - 1) * 24;
      ctx.beginPath();
      ctx.arc(px, y, 7, 0, Math.PI * 2);
      if (i < world.touches) {
        ctx.fillStyle = i === MAX_TOUCHES - 1 ? '#ff6b5e' : team.config.colors[0];
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  private drawHint(world: World, width: number, height: number, gamepad: boolean): void {
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(210,220,245,0.5)';

    const a = gamepad ? 'A' : 'SPACE';
    const b = gamepad ? 'B' : 'SHIFT';
    const ready = world.humanTeam?.powerReady ?? false;
    const lines =
      world.phase === 'serve'
        ? [`HOLD ${a} to charge, release to serve`, 'STICK aims the serve']
        : [
            `${a} play the ball (hold = power)`,
            `${b} jump  ·  ${b} again in mid-air = LETHAL MANEUVER`,
            ready ? 'GAUGE FULL — stick picks the move' : 'STICK moves and aims',
          ];

    lines.forEach((line, i) => ctx.fillText(line, 22, height - 22 - (lines.length - 1 - i) * 16));
    void width;
  }

  private drawPhaseBanner(world: World, width: number, height: number): void {
    if (world.phase !== 'setBreak' && world.phase !== 'matchOver') return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(6,9,20,0.72)';
    ctx.fillRect(0, height / 2 - 90, width, 180);

    ctx.textAlign = 'center';
    if (world.phase === 'matchOver') {
      const winner = world.home.setsWon > world.away.setsWon ? world.home : world.away;
      ctx.font = '900 52px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = winner.config.colors[0];
      ctx.fillText(winner.config.name.toUpperCase(), width / 2, height / 2 - 6);
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillStyle = '#e9eefc';
      ctx.fillText(
        `WINS THE MATCH  ${world.home.setsWon} - ${world.away.setsWon}`,
        width / 2,
        height / 2 + 30,
      );
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(220,230,255,0.65)';
      ctx.fillText('PRESS ESC FOR THE MENU', width / 2, height / 2 + 62);
    } else {
      ctx.font = '900 44px "Arial Black", system-ui, sans-serif';
      ctx.fillStyle = '#ffe27a';
      ctx.fillText(`SET ${world.setNumber} COMPLETE`, width / 2, height / 2 + 4);
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillStyle = '#e9eefc';
      ctx.fillText(
        `${world.home.setScores.join(' · ')}   vs   ${world.away.setScores.join(' · ')}`,
        width / 2,
        height / 2 + 38,
      );
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
