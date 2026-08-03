import { Vec3, v3 } from '../core/math3';
import { Camera } from './camera';

interface Particle {
  pos: Vec3;
  vel: Vec3;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** Particles with gravity fall and bounce; sparks just fade. */
  gravity: number;
  kind: 'dust' | 'spark' | 'ring' | 'burst';
}

/** A star of cracks left in the floor where a hard ball landed. */
interface Crack {
  pos: Vec3;
  /** Endpoint offsets in metres, drawn from the impact point. */
  arms: { dx: number; dy: number }[];
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

/**
 * Particle and flourish system. Everything lives in world space and is
 * projected through the camera, so effects sit correctly in the perspective
 * instead of floating as flat screen overlays.
 */
export class Effects {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  private cracks: Crack[] = [];
  private trail: { pos: Vec3; life: number }[] = [];

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.cracks.length = 0;
    this.trail.length = 0;
  }

  /**
   * Crack the floor. Reserved for a ball buried hard enough to end the rally,
   * because a mark that appears every rally stops meaning anything.
   */
  crack(at: Vec3, power: number, rng: () => number): void {
    const arms: { dx: number; dy: number }[] = [];
    const n = 5 + Math.round(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.6;
      const len = (0.5 + rng() * 0.9) * power;
      arms.push({ dx: Math.cos(a) * len, dy: Math.sin(a) * len * 0.55 });
    }
    this.cracks.push({ pos: v3(at.x, at.y, 0), arms, life: 2.6, maxLife: 2.6 });
    if (this.cracks.length > 6) this.cracks.shift();
  }

  /** Floor dust, thrown up by a landing, a dive or a ball hitting the boards. */
  dust(at: Vec3, amount: number, rng: () => number, color = 'rgba(255,240,214,'): void {
    const n = Math.min(34, Math.round(amount));
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const speed = 0.7 + rng() * 2.6;
      this.particles.push({
        pos: v3(at.x, at.y, Math.max(0.02, at.z)),
        vel: v3(Math.cos(a) * speed, Math.sin(a) * speed * 0.6, 0.7 + rng() * 2.4),
        life: 0.45 + rng() * 0.5,
        maxLife: 0.95,
        size: 3 + rng() * 6,
        color,
        gravity: -7,
        kind: 'dust',
      });
    }
  }

  /** Sharp radial sparks for a hard contact. */
  impact(at: Vec3, power: number, rng: () => number, color = 'rgba(255,214,120,'): void {
    const n = Math.min(26, Math.round(6 + power));
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const b = (rng() - 0.5) * 2;
      const speed = 3 + rng() * 7 + power * 0.25;
      this.particles.push({
        pos: v3(at.x, at.y, at.z),
        vel: v3(Math.cos(a) * speed, Math.sin(a) * speed * 0.5, b * speed * 0.5),
        life: 0.16 + rng() * 0.22,
        maxLife: 0.38,
        size: 2 + rng() * 3.5,
        color,
        gravity: -2,
        kind: 'spark',
      });
    }
    this.particles.push({
      pos: v3(at.x, at.y, at.z),
      vel: v3(),
      life: 0.26,
      maxLife: 0.26,
      size: 8,
      color,
      gravity: 0,
      kind: 'ring',
    });
  }

  /** Expanding shock ring for a kill or a stuff block. */
  burst(at: Vec3, color: string): void {
    this.particles.push({
      pos: v3(at.x, at.y, at.z),
      vel: v3(),
      life: 0.55,
      maxLife: 0.55,
      size: 10,
      color,
      gravity: 0,
      kind: 'burst',
    });
  }

  announce(at: Vec3, text: string, color: string, size = 34): void {
    this.texts.push({ pos: v3(at.x, at.y, at.z), text, life: 1.5, maxLife: 1.5, color, size });
  }

  /** Record a ball position for the motion trail. */
  pushTrail(pos: Vec3, speed: number): void {
    if (speed < 12) {
      if (this.trail.length) this.trail.shift();
      return;
    }
    this.trail.push({ pos: v3(pos.x, pos.y, pos.z), life: 0.22 });
    if (this.trail.length > 18) this.trail.shift();
  }

  update(dt: number): void {
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      this.cracks[i].life -= dt;
      if (this.cracks[i].life <= 0) this.cracks.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'ring' || p.kind === 'burst') continue;
      p.vel.z += p.gravity * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      if (p.pos.z < 0.02) {
        p.pos.z = 0.02;
        p.vel.z *= -0.25;
        p.vel.x *= 0.7;
        p.vel.y *= 0.7;
      }
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.pos.z += dt * 1.1;
      if (t.life <= 0) this.texts.splice(i, 1);
    }

    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }

  drawTrail(ctx: CanvasRenderingContext2D, cam: Camera, color: string): void {
    if (this.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = cam.projectVec(this.trail[i - 1].pos);
      const b = cam.projectVec(this.trail[i].pos);
      if (a.behind || b.behind) continue;
      const t = i / this.trail.length;
      ctx.globalAlpha = t * 0.4 * (this.trail[i].life / 0.22);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 + t * 7 * b.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Floor cracks are drawn under everything, so bodies stand on top of them. */
  drawFloor(ctx: CanvasRenderingContext2D, cam: Camera): void {
    if (!this.cracks.length) return;
    ctx.save();
    for (const c of this.cracks) {
      const t = c.life / c.maxLife;
      const o = cam.projectFloor(c.pos.x, c.pos.y);
      ctx.globalAlpha = Math.min(1, t * 1.6) * 0.85;
      ctx.strokeStyle = 'rgba(24,14,10,0.9)';
      ctx.lineCap = 'round';
      for (const arm of c.arms) {
        const e = cam.projectFloor(c.pos.x + arm.dx, c.pos.y + arm.dy);
        const mx = (o.x + e.x) / 2 + (e.y - o.y) * 0.18;
        const my = (o.y + e.y) / 2 + (o.x - e.x) * 0.18;
        ctx.lineWidth = Math.max(1, 2.6 * o.scale);
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.quadraticCurveTo(mx, my, e.x, e.y);
        ctx.stroke();
      }
      // A pale dust halo, as if the boards had been scuffed.
      ctx.globalAlpha = t * 0.28;
      ctx.fillStyle = 'rgba(255,240,220,1)';
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, 26 * o.scale, 9 * o.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.save();
    for (const p of this.particles) {
      const s = cam.projectVec(p.pos);
      if (s.behind) continue;
      const t = p.life / p.maxLife;

      if (p.kind === 'ring') {
        ctx.globalAlpha = t * 0.7;
        ctx.strokeStyle = `${p.color}1)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (1 - t) * 46 * s.scale + 4, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      if (p.kind === 'burst') {
        const r = (1 - t) * 110 * s.scale + 6;
        const grad = ctx.createRadialGradient(s.x, s.y, r * 0.55, s.x, s.y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.7, p.color);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = t;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.fillStyle = `${p.color}${Math.min(1, t * 1.4)})`;
      const size = p.size * s.scale * (p.kind === 'spark' ? 0.8 + t : 1);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.6, size), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const t of this.texts) {
      const s = cam.projectVec(t.pos);
      if (s.behind) continue;
      const k = t.life / t.maxLife;
      const pop = k > 0.8 ? 1 + (k - 0.8) * 3 : 1;
      ctx.globalAlpha = Math.min(1, k * 2.2);
      const size = t.size * s.scale * pop;
      ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';

      // Dark outline, then a thick team-coloured one, then a white core. Three
      // passes, but it is the only way this stays readable over the crowd.
      ctx.lineWidth = size * 0.28;
      ctx.strokeStyle = 'rgba(4,6,14,0.92)';
      ctx.strokeText(t.text, s.x, s.y);
      ctx.lineWidth = size * 0.16;
      ctx.strokeStyle = t.color;
      ctx.strokeText(t.text, s.x, s.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.text, s.x, s.y);
    }
    ctx.restore();
  }
}
