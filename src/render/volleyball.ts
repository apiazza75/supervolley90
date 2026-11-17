import type { BallStyle } from '../game/teams';

/**
 * One visual grammar for the ball.
 *
 * The normal rally ball and the powered ball must be the same object under
 * different lighting. Keeping the panel geometry in one place prevents the
 * power move from drifting back into a fireball or generic orb while the
 * ordinary ball remains a volleyball.
 */

export const VOLLEYBALL_PANEL_STRIPES = [
  { top: -1.05, bottom: -0.34, normal: '#f1ead6', energized: '#fff1bd' },
  { top: -0.34, bottom: 0.3, normal: '#2a5bd7', energized: '#36a9e1' },
  { top: 0.3, bottom: 1.05, normal: '#ffc531', energized: '#ffbf3f' },
] as const;

const energizedPanel = (index: number): string => VOLLEYBALL_PANEL_STRIPES[index].energized;

/**
 * Shared palette for every powered-ball visual.
 *
 * The super shot is still a volleyball: gold, cyan and cream panels under
 * arcade lighting. Keeping trail, aura, sparks and floor shockwaves tied to
 * the same palette prevents the effect from turning into a generic fireball
 * while the drawn ball remains a three-panel volley ball.
 */
export const POWER_VISUAL_GRAMMAR = {
  cream: energizedPanel(0),
  cyan: energizedPanel(1),
  gold: energizedPanel(2),
  trail: 'rgba(255,191,63,0.95)',
  normalTrail: 'rgba(255,248,220,0.9)',
  chevron: energizedPanel(0),
  auraGold: 'rgba(255,191,63,0.62)',
  auraCyan: 'rgba(54,169,225,0.46)',
  auraHeat: 'rgba(255,120,52,0.36)',
  burst: 'rgba(255,191,63,0.72)',
  spark: 'rgba(255,191,63,',
  shock: 'rgba(54,169,225,',
  floor: 'rgba(255,248,220,',
  headline: '#ffbf3f',
} as const;

export const POWER_FLOOR_SCAR_STYLE = {
  stroke: POWER_VISUAL_GRAMMAR.floor,
  fill: POWER_VISUAL_GRAMMAR.cream,
} as const;

export const HOT_TIMING_GRAMMAR = {
  fill: 'rgba(255,48,72,0.72)',
  core: 'rgba(255,110,92,0.82)',
  rim: '#ff3048',
  halo: 'rgba(255,48,72,0.42)',
  outerHalo: 'rgba(255,48,72,0.26)',
  spoke: 'rgba(255,48,72,0.92)',
  label: 'PERFECT',
  minimumLiveRedPixels: 90,
} as const;

export interface VolleyballOptions {
  energized?: boolean;
  hot?: boolean;
  style?: Pick<BallStyle, 'colors' | 'seamColor'>;
}

export function drawVolleyball(
  ctx: CanvasRenderingContext2D,
  radius: number,
  roll: number,
  options: VolleyballOptions = {},
): void {
  const energized = options.energized === true;
  const palette = options.style;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = palette?.colors[0] ?? (energized ? '#fff1bd' : '#f1ead6');
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.94, 0, Math.PI * 2);
  ctx.clip();
  ctx.rotate(roll * 0.6);

  for (let i = 0; i < VOLLEYBALL_PANEL_STRIPES.length; i++) {
    const stripe = VOLLEYBALL_PANEL_STRIPES[i];
    const top = stripe.top * radius;
    const bottom = stripe.bottom * radius;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.1, top);
    ctx.quadraticCurveTo(0, top - radius * 0.16, radius * 1.1, top);
    ctx.lineTo(radius * 1.1, bottom);
    ctx.quadraticCurveTo(0, bottom - radius * 0.16, -radius * 1.1, bottom);
    ctx.closePath();
    // Power lighting keeps the selected ball's actual panels and seam identity.
    ctx.fillStyle = palette?.colors[i] ?? (energized ? stripe.energized : stripe.normal);
    ctx.fill();
  }

  ctx.strokeStyle = palette?.seamColor ?? (energized ? 'rgba(45,55,78,0.56)' : 'rgba(24,32,52,0.5)');
  ctx.lineWidth = Math.max(0.7, radius * (energized ? 0.06 : 0.05));
  for (const edge of [-0.34, 0.3]) {
    const y = edge * radius;
    ctx.beginPath();
    ctx.moveTo(-radius * 1.1, y);
    ctx.quadraticCurveTo(0, y - radius * 0.16, radius * 1.1, y);
    ctx.stroke();
  }

  if (radius > 7) {
    ctx.lineWidth = Math.max(0.6, radius * 0.04);
    ctx.beginPath();
    ctx.moveTo(radius * 0.12, -radius * 1.05);
    ctx.quadraticCurveTo(radius * 0.3, 0, radius * 0.12, radius * 1.05);
    ctx.stroke();
  }
  ctx.restore();

  const shine = ctx.createRadialGradient(
    -radius * 0.4,
    -radius * 0.45,
    radius * 0.1,
    0,
    0,
    radius * 1.05,
  );
  // Gloss is warm cream, not neutral white. The ball often overlaps a player's
  // torso during digs, and pure white highlights are indistinguishable from
  // the rejected sprite-matte residue in live pixel QC.
  shine.addColorStop(0, energized ? 'rgba(255,235,178,0.74)' : 'rgba(255,232,190,0.58)');
  shine.addColorStop(0.45, 'rgba(255,232,190,0)');
  shine.addColorStop(1, energized ? 'rgba(24,22,42,0.34)' : 'rgba(18,26,48,0.4)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  if (options.hot) {
    ctx.globalCompositeOperation = 'lighter';
    const hotGlow = ctx.createRadialGradient(
      -radius * 0.15,
      -radius * 0.2,
      radius * 0.08,
      0,
      0,
      radius * 1.05,
    );
    hotGlow.addColorStop(0, HOT_TIMING_GRAMMAR.core);
    hotGlow.addColorStop(0.42, HOT_TIMING_GRAMMAR.fill);
    hotGlow.addColorStop(1, HOT_TIMING_GRAMMAR.halo);
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = hotGlow;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.strokeStyle = HOT_TIMING_GRAMMAR.outerHalo;
    ctx.lineWidth = Math.max(5.5, radius * 0.42);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.45, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = HOT_TIMING_GRAMMAR.rim;
    ctx.lineWidth = Math.max(3.2, radius * 0.24);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.2, 0, Math.PI * 2);
    ctx.stroke();

    // Timing-ready has to read even when the ball is small in a full-court
    // view. Short red ticks around the ball survive motion blur and make this
    // cue distinct from the normal cyan/gold landing markers.
    ctx.strokeStyle = HOT_TIMING_GRAMMAR.spoke;
    ctx.lineWidth = Math.max(1.8, radius * 0.1);
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const inner = radius * 1.48;
      const outer = radius * 1.78;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = options.hot
    ? HOT_TIMING_GRAMMAR.rim
    : energized
      ? 'rgba(255,242,190,0.95)'
      : 'rgba(20,26,42,0.8)';
  ctx.lineWidth = Math.max(0.9, radius * (options.hot ? 0.11 : energized ? 0.11 : 0.07));
  ctx.beginPath();
  ctx.arc(0, 0, energized ? radius * 1.02 : radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
