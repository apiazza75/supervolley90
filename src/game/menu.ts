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

/**
 * Attract screen and team select. Deliberately keyboard-first and instant:
 * a coin-op would never make you wait, and neither should this.
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
      // Time-based seed: each match differs, but a given match is replayable.
      seed: (Date.now() & 0x7fffffff) >>> 0,
    };
  }

  reset(): void {
    this.ready = null;
    this.row = 0;
    this.cooldown = 0.3;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, gamepad: boolean): void {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#0a0d1c');
    bg.addColorStop(0.55, '#16203c');
    bg.addColorStop(1, '#0c1124');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.font = '900 68px "Arial Black", system-ui, sans-serif';
    const title = ctx.createLinearGradient(0, height * 0.14, 0, height * 0.26);
    title.addColorStop(0, '#ffe27a');
    title.addColorStop(1, '#ff8a3d');
    ctx.fillStyle = title;
    ctx.fillText('SUPER VOLLEY 90', width / 2, height * 0.22);

    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,215,245,0.6)';
    ctx.fillText('ARCADE VOLLEYBALL — 6 v 6', width / 2, height * 0.27);

    const rows = [
      { label: 'YOUR TEAM', value: TEAMS[this.homeIndex].name, color: TEAMS[this.homeIndex].colors[0] },
      { label: 'OPPONENT', value: TEAMS[this.awayIndex].name, color: TEAMS[this.awayIndex].colors[0] },
      { label: 'DIFFICULTY', value: DIFFICULTY_NAMES[this.difficulty], color: '#8fd8ff' },
      { label: '', value: 'START MATCH', color: '#ffe27a' },
    ];

    const top = height * 0.42;
    rows.forEach((r, i) => {
      const y = top + i * 54;
      const selected = this.row === i;
      if (selected) {
        ctx.fillStyle = 'rgba(255,226,122,0.1)';
        ctx.fillRect(width / 2 - 250, y - 28, 500, 44);
      }

      if (r.label) {
        ctx.textAlign = 'right';
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,215,245,0.55)';
        ctx.fillText(r.label, width / 2 - 30, y);
      }

      ctx.textAlign = r.label ? 'left' : 'center';
      ctx.font = `900 ${r.label ? 26 : 30}px "Arial Black", system-ui, sans-serif`;
      ctx.fillStyle = selected ? r.color : 'rgba(233,238,252,0.75)';
      const blinkOn = !selected || i !== 3 || Math.sin(this.blink * 6) > -0.4;
      if (blinkOn) ctx.fillText(r.value, r.label ? width / 2 - 10 : width / 2, y);

      if (selected && i < 3) {
        ctx.fillStyle = r.color;
        ctx.textAlign = 'center';
        ctx.font = '700 20px system-ui, sans-serif';
        ctx.fillText('◀', width / 2 - 270, y);
        ctx.fillText('▶', width / 2 + 270, y);
      }
    });

    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,215,245,0.45)';
    const confirm = gamepad ? 'A' : 'SPACE';
    ctx.fillText(
      `STICK / ARROWS to choose   ·   ${confirm} to confirm`,
      width / 2,
      height - 46,
    );
  }
}
