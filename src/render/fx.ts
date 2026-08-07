import { Vec3, v3 } from '../core/math3';
import { Camera } from './camera';

type ParticleKind = 'dust' | 'spark' | 'shock' | 'burst' | 'confetti';

interface Particle {
  pos: Vec3;
  vel: Vec3;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  kind: ParticleKind;
  angle: number;
  spin: number;
  seed: number;
}

interface CrackArm {
  dx: number;
  dy: number;
  kink: number;
  branch: number;
}

interface Crack {
  pos: Vec3;
  arms: CrackArm[];
  life: number;
  maxLife: number;
}

interface FloatingText {
  pos: Vec3;
  text: string;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface TrailPoint {
  pos: Vec3;
  life: number;
  maxLife: number;
  speed: number;
}

const CONFETTI = ['#ff5a4d', '#ffd166', '#7ef0ff', '#a0ffb4', '#f0a0ff'];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Accept both CSS colours and the historic `rgba(r,g,b,` prefix. */
function withAlpha(color: string, alpha: number): string {
  const a = clamp01(alpha);
  if (/^rgba\([^)]*,\s*$/.test(color)) return `${color}${a})`;
  const rgba = /^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/i.exec(color);
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${a})`;
  const rgb = /^rgb\(([^,]+),([^,]+),([^)]+)\)$/i.exec(color);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})`;
  const hex = /^#([a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.exec(color.trim());
  if (hex) {
    let value = hex[1];
    if (value.length === 3) value = value.split('').map((c) => c + c).join('');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  phase = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  phase = 0,
  yScale = 1,
): void {
  ctx.beginPath();
  for (let i = 0; i <= points * 2; i++) {
    const a = phase + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * yScale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Recovery V3 effects.
 *
 * The old system expressed every major beat as a recoloured circle.  The new
 * language uses tapered ribbons, directional shards, broken polygon waves and
 * faceted floor marks.  Effects remain world-space and deterministic; only the
 * drawing grammar changes.
 */
export class Effects {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  private cracks: Crack[] = [];
  private trail: TrailPoint[] = [];
  private clock = 0;

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.cracks.length = 0;
    this.trail.length = 0;
    this.clock = 0;
  }

  crack(at: Vec3, power: number, rng: () => number): void {
    const arms: CrackArm[] = [];
    const count = 6 + Math.round(rng() * 4);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.45;
      const length = (0.52 + rng() * 0.9) * power;
      arms.push({
        dx: Math.cos(angle) * length,
        dy: Math.sin(angle) * length * 0.58,
        kink: (rng() - 0.5) * 0.5,
        branch: 0.3 + rng() * 0.45,
      });
    }
    this.cracks.push({ pos: v3(at.x, at.y, 0), arms, life: 2.8, maxLife: 2.8 });
    if (this.cracks.length > 6) this.cracks.shift();
  }

  dust(at: Vec3, amount: number, rng: () => number, color = 'rgba(255,240,214,'): void {
    const count = Math.min(54, Math.max(4, Math.round(amount * 1.45)));
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = 0.65 + rng() * 2.9;
      const life = 0.42 + rng() * 0.55;
      this.particles.push({
        pos: v3(at.x, at.y, Math.max(0.03, at.z)),
        vel: v3(Math.cos(angle) * speed, Math.sin(angle) * speed * 0.62, 0.6 + rng() * 2.5),
        life,
        maxLife: life,
        size: 3 + rng() * 7,
        color,
        gravity: -7,
        kind: 'dust',
        angle: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 7,
        seed: rng(),
      });
    }
  }

  shockwave(at: Vec3, color = 'rgba(255,220,150,'): void {
    this.particles.push({
      pos: v3(at.x, at.y, at.z),
      vel: v3(),
      life: 0.48,
      maxLife: 0.48,
      size: 1,
      color,
      gravity: 0,
      kind: 'shock',
      angle: this.clock * 0.7,
      spin: 0,
      seed: 0.37,
    });
  }

  confetti(rng: () => number, amount = 60): void {
    for (let i = 0; i < amount; i++) {
      const life = 2.4 + rng() * 1.45;
      this.particles.push({
        pos: v3((rng() - 0.5) * 18, (rng() - 0.5) * 20, 6 + rng() * 3),
        vel: v3((rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2, -0.6 - rng() * 1.2),
        life,
        maxLife: life,
        size: 2 + rng() * 3,
        color: CONFETTI[Math.floor(rng() * CONFETTI.length) % CONFETTI.length],
        gravity: -1.2,
        kind: 'confetti',
        angle: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 10,
        seed: rng(),
      });
    }
  }

  impact(at: Vec3, power: number, rng: () => number, color = 'rgba(255,214,120,'): void {
    const count = Math.min(58, Math.round(13 + power * 1.85));
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const elevation = (rng() - 0.5) * 2;
      const speed = 3.2 + rng() * 7.5 + power * 0.25;
      const life = 0.15 + rng() * 0.25;
      this.particles.push({
        pos: v3(at.x, at.y, at.z),
        vel: v3(Math.cos(angle) * speed, Math.sin(angle) * speed * 0.5, elevation * speed * 0.5),
        life,
        maxLife: life,
        size: 2 + rng() * 4,
        color,
        gravity: -2,
        kind: 'spark',
        angle,
        spin: (rng() - 0.5) * 12,
        seed: rng(),
      });
    }
    this.shockwave(at, color);
  }

  burst(at: Vec3, color: string): void {
    this.particles.push({
      pos: v3(at.x, at.y, at.z),
      vel: v3(),
      life: 0.58,
      maxLife: 0.58,
      size: 10,
      color,
      gravity: 0,
      kind: 'burst',
      angle: this.clock,
      spin: 0,
      seed: 0.71,
    });
  }

  announce(at: Vec3, text: string, color: string, size = 34): void {
    this.texts.push({ pos: v3(at.x, at.y, at.z), text, life: 1.5, maxLife: 1.5, color, size });
  }

  pushTrail(pos: Vec3, speed: number): void {
    if (speed < 12) {
      if (this.trail.length) this.trail.shift();
      return;
    }
    this.trail.push({ pos: v3(pos.x, pos.y, pos.z), life: 0.24, maxLife: 0.24, speed });
    if (this.trail.length > 20) this.trail.shift();
  }

  update(dt: number): void {
    this.clock += dt;
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      this.cracks[i].life -= dt;
      if (this.cracks[i].life <= 0) this.cracks.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= dt;
      particle.angle += particle.spin * dt;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (particle.kind === 'shock' || particle.kind === 'burst') continue;
      particle.vel.z += particle.gravity * dt;
      particle.pos.x += particle.vel.x * dt;
      particle.pos.y += particle.vel.y * dt;
      particle.pos.z += particle.vel.z * dt;
      if (particle.pos.z < 0.02) {
        particle.pos.z = 0.02;
        particle.vel.z *= -0.25;
        particle.vel.x *= 0.7;
        particle.vel.y *= 0.7;
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const text = this.texts[i];
      text.life -= dt;
      text.pos.z += dt * 1.1;
      if (text.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }

  /** Tapered motion ribbons with cut chevrons instead of a recoloured line. */
  drawTrail(ctx: CanvasRenderingContext2D, cam: Camera, color: string, powered = false): void {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'miter';
    for (let i = 1; i < this.trail.length; i++) {
      const older = this.trail[i - 1];
      const newer = this.trail[i];
      const a = cam.projectVec(older.pos);
      const b = cam.projectVec(newer.pos);
      if (a.behind || b.behind) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.3) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const progress = i / Math.max(1, this.trail.length - 1);
      const alpha = clamp01(newer.life / newer.maxLife) * (powered ? 0.72 : 0.38) * progress;
      const tailWidth = (0.8 + progress * (powered ? 7 : 3.8)) * b.scale;
      const headWidth = tailWidth * (powered ? 1.35 : 1.05);

      ctx.fillStyle = withAlpha(color, alpha);
      ctx.beginPath();
      ctx.moveTo(a.x + nx * tailWidth * 0.35, a.y + ny * tailWidth * 0.35);
      ctx.lineTo(b.x + nx * headWidth, b.y + ny * headWidth);
      ctx.lineTo(b.x - nx * headWidth, b.y - ny * headWidth);
      ctx.lineTo(a.x - nx * tailWidth * 0.35, a.y - ny * tailWidth * 0.35);
      ctx.closePath();
      ctx.fill();

      if (powered && i % 3 === 0) {
        const cx = a.x + dx * 0.45;
        const cy = a.y + dy * 0.45;
        const back = Math.min(22 * b.scale, length * 0.42);
        ctx.strokeStyle = withAlpha('#fff5d8', alpha * 0.85);
        ctx.lineWidth = Math.max(1, 1.7 * b.scale);
        ctx.beginPath();
        ctx.moveTo(cx - dx / length * back + nx * headWidth * 1.3, cy - dy / length * back + ny * headWidth * 1.3);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - dx / length * back - nx * headWidth * 1.3, cy - dy / length * back - ny * headWidth * 1.3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Floor scars and broken impact tiles sit below bodies. */
  drawFloor(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (!this.cracks.length) return;
    ctx.save();
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (const crack of this.cracks) {
      const life = crack.life / crack.maxLife;
      const origin = cam.projectFloor(crack.pos.x, crack.pos.y);
      ctx.globalAlpha = Math.min(1, life * 1.6) * 0.88;
      ctx.strokeStyle = 'rgba(20,12,10,0.94)';
      for (const arm of crack.arms) {
        const end = cam.projectFloor(crack.pos.x + arm.dx, crack.pos.y + arm.dy);
        const mx = origin.x + (end.x - origin.x) * 0.56 + (end.y - origin.y) * arm.kink;
        const my = origin.y + (end.y - origin.y) * 0.56 - (end.x - origin.x) * arm.kink;
        ctx.lineWidth = Math.max(1, 2.5 * origin.scale);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(mx, my);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const bx = origin.x + (end.x - origin.x) * arm.branch;
        const by = origin.y + (end.y - origin.y) * arm.branch;
        ctx.lineWidth = Math.max(0.8, 1.35 * origin.scale);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (end.y - origin.y) * 0.18, by - (end.x - origin.x) * 0.18);
        ctx.stroke();
      }
      ctx.globalAlpha = life * 0.22;
      ctx.fillStyle = '#fff0dc';
      polygon(ctx, origin.x, origin.y, 28 * origin.scale, 9 * origin.scale, 7, 0.18);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShock(ctx: CanvasRenderingContext2D, particle: Particle, x: number, y: number, scale: number): void {
    const life = particle.life / particle.maxLife;
    const radius = (1 - life) * 72 * scale + 7;
    ctx.save();
    ctx.strokeStyle = withAlpha(particle.color, life * 0.86);
    ctx.lineWidth = Math.max(1.4, (2 + (1 - life) * 2.5) * scale);
    ctx.lineCap = 'butt';
    for (let band = 0; band < 2; band++) {
      const r = radius * (1 + band * 0.24);
      const phase = particle.angle + band * 0.29;
      for (let i = 0; i < 10; i++) {
        if ((i + band) % 3 === 1) continue;
        const a0 = phase + (i / 10) * Math.PI * 2;
        const a1 = phase + ((i + 0.68) / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r * 0.68);
        ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r * 0.68);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawBurst(ctx: CanvasRenderingContext2D, particle: Particle, x: number, y: number, scale: number): void {
    const life = particle.life / particle.maxLife;
    const radius = (1 - life) * 128 * scale + 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(particle.angle * 0.25);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const inner = radius * 0.18;
      const outer = radius * (0.68 + (i % 3) * 0.12);
      const width = radius * 0.055;
      ctx.fillStyle = withAlpha(particle.color, life * (i % 2 ? 0.45 : 0.72));
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle - 0.045) * outer - Math.sin(angle) * width, Math.sin(angle - 0.045) * outer + Math.cos(angle) * width);
      ctx.lineTo(Math.cos(angle + 0.045) * outer + Math.sin(angle) * width, Math.sin(angle + 0.045) * outer - Math.cos(angle) * width);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = withAlpha('#ffffff', life * 0.68);
    ctx.lineWidth = Math.max(1.2, 2.4 * scale);
    polygon(ctx, 0, 0, radius * 0.42, radius * 0.3, 8, Math.PI / 8);
    ctx.stroke();
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.save();
    for (const particle of this.particles) {
      const screen = cam.projectVec(particle.pos);
      if (screen.behind) continue;
      const life = clamp01(particle.life / particle.maxLife);

      if (particle.kind === 'shock') {
        this.drawShock(ctx, particle, screen.x, screen.y, screen.scale);
        continue;
      }
      if (particle.kind === 'burst') {
        this.drawBurst(ctx, particle, screen.x, screen.y, screen.scale);
        continue;
      }

      const size = particle.size * screen.scale * (particle.kind === 'spark' ? 0.85 + life : 1);
      if (particle.kind === 'spark') {
        const tail = cam.project(
          particle.pos.x - particle.vel.x * 0.04,
          particle.pos.y - particle.vel.y * 0.04,
          particle.pos.z - particle.vel.z * 0.04,
        );
        const dx = screen.x - tail.x;
        const dy = screen.y - tail.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / length;
        const ny = dx / length;
        ctx.fillStyle = withAlpha(particle.color, Math.min(1, life * 1.45));
        ctx.beginPath();
        ctx.moveTo(screen.x + nx * size * 0.75, screen.y + ny * size * 0.75);
        ctx.lineTo(tail.x, tail.y);
        ctx.lineTo(screen.x - nx * size * 0.75, screen.y - ny * size * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = withAlpha('#ffffff', life);
        polygon(ctx, screen.x, screen.y, size * 0.62, size * 0.62, 4, Math.PI / 4);
        ctx.fill();
        continue;
      }

      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(particle.angle + this.clock * (particle.kind === 'confetti' ? 1.4 : 0.25));
      ctx.globalAlpha = Math.min(1, life * 1.6);
      ctx.fillStyle = withAlpha(particle.color, Math.min(1, life * 1.4));
      if (particle.kind === 'confetti') {
        ctx.fillRect(-size * 0.8, -size * 0.28, size * 1.6, size * 0.56);
      } else {
        // Dust reads as lifted floor chips rather than smoke bubbles.
        const skew = 0.55 + particle.seed * 0.8;
        ctx.beginPath();
        ctx.moveTo(-size * 1.1, size * 0.2);
        ctx.lineTo(-size * 0.28, -size * skew);
        ctx.lineTo(size * 1.2, -size * 0.12);
        ctx.lineTo(size * 0.38, size * skew * 0.72);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    for (const text of this.texts) {
      const screen = cam.projectVec(text.pos);
      if (screen.behind) continue;
      const life = text.life / text.maxLife;
      const pop = life > 0.8 ? 1 + (life - 0.8) * 3 : 1;
      const size = text.size * screen.scale * pop;
      ctx.save();
      ctx.globalAlpha = Math.min(1, life * 2.2);
      ctx.translate(screen.x, screen.y);
      ctx.transform(1, 0, -0.12, 1, 0, 0);
      ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'miter';
      ctx.lineWidth = size * 0.28;
      ctx.strokeStyle = 'rgba(4,6,14,0.94)';
      ctx.strokeText(text.text, 0, 0);
      ctx.lineWidth = size * 0.15;
      ctx.strokeStyle = text.color;
      ctx.strokeText(text.text, 0, 0);
      const gradient = ctx.createLinearGradient(0, -size, 0, size * 0.3);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#c9e7ff');
      ctx.fillStyle = gradient;
      ctx.fillText(text.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Angular ignition field around an armed player. */
  drawPowerAura(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    time: number,
  ): void {
    const radius = (47 + Math.sin(time * 12) * 6) * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 3; layer++) {
      const phase = time * (layer % 2 ? -1.4 : 1.1) + layer * 0.41;
      const outer = radius * (0.72 + layer * 0.18);
      ctx.strokeStyle = layer === 0 ? 'rgba(255,244,190,0.86)' : layer === 1 ? 'rgba(255,165,52,0.6)' : 'rgba(255,75,25,0.4)';
      ctx.lineWidth = Math.max(1.2, (3.2 - layer * 0.7) * scale);
      star(ctx, 0, 0, outer, outer * 0.72, 7 + layer, phase, 1.14);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const angle = time * 0.8 + (i / 6) * Math.PI * 2;
      const inner = radius * 0.45;
      const outer = radius * (0.9 + 0.18 * Math.sin(time * 5 + i));
      ctx.fillStyle = i % 2 ? 'rgba(255,90,25,0.3)' : 'rgba(255,205,75,0.35)';
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle - 0.09) * inner, Math.sin(angle - 0.09) * inner * 1.15);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer * 1.15);
      ctx.lineTo(Math.cos(angle + 0.09) * inner, Math.sin(angle + 0.09) * inner * 1.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Faceted lethal-move ball, called after the renderer has translated to it. */
  drawPowerBall(ctx: CanvasRenderingContext2D, radius: number, roll: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,74,24,0.24)';
    star(ctx, 0, 0, radius * 2.9, radius * 1.35, 11, -roll * 0.18, 0.9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,179,48,0.34)';
    star(ctx, 0, 0, radius * 2.1, radius * 1.18, 9, roll * 0.24, 0.94);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const core = ctx.createLinearGradient(-radius, -radius, radius, radius);
    core.addColorStop(0, '#fffdf0');
    core.addColorStop(0.32, '#ffd166');
    core.addColorStop(0.68, '#ff8b2c');
    core.addColorStop(1, '#d93812');
    ctx.fillStyle = core;
    polygon(ctx, 0, 0, radius, radius, 12, roll * 0.17);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,26,5,0.76)';
    ctx.lineWidth = Math.max(0.9, radius * 0.11);
    polygon(ctx, 0, 0, radius, radius, 12, roll * 0.17);
    ctx.stroke();

    ctx.save();
    polygon(ctx, 0, 0, radius * 0.91, radius * 0.91, 12, roll * 0.17);
    ctx.clip();
    ctx.rotate(roll * 0.62);
    ctx.strokeStyle = 'rgba(109,33,7,0.62)';
    ctx.lineWidth = Math.max(0.8, radius * 0.09);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-radius * 1.2, i * radius * 0.43);
      ctx.lineTo(radius * 1.2, i * radius * 0.43 - radius * 0.48);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  /** Broadcast replay wipe: diagonal shutters and a cut technical header. */
  drawReplayTransition(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    age: number,
    label: string,
  ): void {
    const reveal = clamp01(age / 0.38);
    const shutter = 1 - reveal;
    ctx.save();
    if (shutter > 0) {
      ctx.globalAlpha = shutter * 0.94;
      for (let i = -2; i < 9; i++) {
        const bandWidth = width * 0.2;
        const x = i * bandWidth - reveal * width * 0.55;
        ctx.fillStyle = i % 2 ? '#091429' : '#122443';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + bandWidth * 0.74, 0);
        ctx.lineTo(x + bandWidth * 1.24, height);
        ctx.lineTo(x + bandWidth * 0.5, height);
        ctx.closePath();
        ctx.fill();
      }
    }

    const barY = 24;
    const barW = Math.min(width * 0.44, 560);
    ctx.globalAlpha = Math.min(1, reveal * 1.8);
    ctx.fillStyle = 'rgba(4,10,23,0.9)';
    ctx.beginPath();
    ctx.moveTo(22, barY);
    ctx.lineTo(22 + barW, barY);
    ctx.lineTo(22 + barW - 26, barY + 52);
    ctx.lineTo(22, barY + 52);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#49dcff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(22, barY + 52);
    ctx.lineTo(22 + barW - 26, barY + 52);
    ctx.stroke();
    ctx.fillStyle = '#ffd35c';
    ctx.fillRect(22, barY, 12, 52);
    ctx.font = '900 25px "Arial Black", "Inter", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f8ff';
    ctx.fillText(label.toUpperCase(), 52, barY + 35);
    ctx.font = '800 12px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = '#7ef0ff';
    ctx.fillText('INSTANT REPLAY  /  SV90', 54, barY + 49);

    const scan = (age * 520) % (width + 240) - 120;
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#7ef0ff';
    ctx.beginPath();
    ctx.moveTo(scan - 42, 0);
    ctx.lineTo(scan + 6, 0);
    ctx.lineTo(scan + 210, height);
    ctx.lineTo(scan + 162, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
