import { Vec3, copy } from './math3';
import { Player, PlayerRole, PlayerStats, defaultStats, isFrontRow, slotPosition } from './player';
import { Rng } from './rng';
import { POWER_MAX, Side, TEAM_SIZE, attackDir } from './rules';
import { SETTER_X, SETTER_Y } from './tactics';

export interface TeamConfig {
  name: string;
  shortName: string;
  /** Primary and secondary kit colours, used by the renderer. */
  colors: [string, string];
  /** 0..1 overall quality; individual stats are derived from it. */
  rating: number;
  players?: { name: string; role: PlayerRole; stats?: Partial<PlayerStats> }[];
}

const DEFAULT_ROLES: PlayerRole[] = [
  'setter',
  'outside',
  'middle',
  'opposite',
  'outside',
  'middle',
];

/** Role-flavoured stat curves so the six players do not feel interchangeable. */
const ROLE_BIAS: Record<PlayerRole, Partial<PlayerStats>> = {
  setter: { control: 0.28, speed: 0.1, power: -0.18, jump: -0.05 },
  outside: { power: 0.1, control: 0.06 },
  opposite: { power: 0.22, jump: 0.1, control: -0.06 },
  middle: { jump: 0.24, power: 0.12, speed: -0.06, control: -0.1 },
  libero: { reaction: 0.3, control: 0.24, speed: 0.16, power: -0.35, jump: -0.25 },
};

export class Team {
  readonly side: Side;
  readonly config: TeamConfig;
  players: Player[] = [];

  points = 0;
  setsWon = 0;
  /**
   * Lethal Maneuver gauge, 0..POWER_MAX. Full means the next attack can be
   * unleashed as a power move.
   */
  power = 0;
  /** Points won in each completed set, for the scoreboard. */
  setScores: number[] = [];

  /** Rotation offset 0..5; slot = ((index + offset) % 6) + 1. */
  rotationOffset = 0;
  /** Player id currently steered by the human (home) or the AI focus (away). */
  activeId = 0;

  constructor(side: Side, config: TeamConfig, rng: Rng, idBase: number) {
    this.side = side;
    this.config = config;

    for (let i = 0; i < TEAM_SIZE; i++) {
      const spec = config.players?.[i];
      const role = spec?.role ?? DEFAULT_ROLES[i];
      const stats = defaultStats();
      const bias = ROLE_BIAS[role];
      for (const key of Object.keys(stats) as (keyof PlayerStats)[]) {
        const base = 0.32 + config.rating * 0.5;
        stats[key] = Math.max(
          0.12,
          Math.min(0.98, base + (bias[key] ?? 0) + rng.spread(0.06) + (spec?.stats?.[key] ?? 0)),
        );
      }
      const name = spec?.name ?? `${config.shortName}${i + 1}`;
      const p = new Player(idBase + i, side, role, name, stats);
      p.rotationSlot = i + 1;
      this.players.push(p);
    }
    this.applyRotation();
    this.activeId = this.players[0].id;
  }

  /** Add to the gauge, clamped. Returns true if it just became full. */
  addPower(amount: number): boolean {
    const wasFull = this.power >= POWER_MAX;
    this.power = Math.min(POWER_MAX, this.power + amount);
    return !wasFull && this.power >= POWER_MAX;
  }

  get powerReady(): boolean {
    return this.power >= POWER_MAX;
  }

  spendPower(): void {
    this.power = 0;
  }

  get(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  get active(): Player {
    return this.get(this.activeId) ?? this.players[0];
  }

  /** The player in rotation slot 1 — the one who serves. */
  get server(): Player {
    return this.players.find((p) => p.rotationSlot === 1) ?? this.players[0];
  }

  get setter(): Player {
    return this.players.find((p) => p.role === 'setter') ?? this.players[0];
  }

  frontRow(): Player[] {
    return this.players.filter((p) => isFrontRow(p.rotationSlot));
  }

  backRow(): Player[] {
    return this.players.filter((p) => !isFrontRow(p.rotationSlot));
  }

  isFrontRow(p: Player): boolean {
    return isFrontRow(p.rotationSlot);
  }

  rotate(): void {
    this.rotationOffset = (this.rotationOffset + 1) % TEAM_SIZE;
    this.applyRotation();
  }

  /** Recompute slots and formation anchors from the current rotation offset. */
  applyRotation(): void {
    this.players.forEach((p, i) => {
      // Rotating clockwise means each player moves to the previous slot number.
      p.rotationSlot = ((i - this.rotationOffset + TEAM_SIZE * 2) % TEAM_SIZE) + 1;
      p.home = slotPosition(p.rotationSlot, this.side);
    });
  }

  /** Snap every player onto their formation anchor (between rallies). */
  resetPositions(): void {
    this.applyRotation();
    for (const p of this.players) {
      p.pos = copy(p.home);
      p.vel.x = 0;
      p.vel.y = 0;
      p.height = 0;
      p.vertVel = 0;
      p.downTime = 0;
      p.lockout = 0;
      p.diving = false;
      p.charge = 0;
      p.setAnim('idle');
      p.facing = this.side === 'home' ? 1 : -1;
    }
  }

  /** Position the server behind the baseline, ready to toss. */
  placeServer(): Player {
    const s = this.server;
    s.pos.x = this.side === 'home' ? 2.2 : -2.2;
    s.pos.y = this.side === 'home' ? -9.6 : 9.6;
    s.vel.x = 0;
    s.vel.y = 0;
    s.height = 0;
    s.vertVel = 0;
    s.charge = 0;
    s.setAnim('serve');
    return s;
  }

  /** Where the setter wants to receive the first ball. */
  /**
   * Where a pass should be delivered: to the setter's spot at the net, not to
   * a fixed point in the middle of the court. The two have to agree, or every
   * pass arrives where the setter is not.
   */
  setterTarget(): Vec3 {
    const dir = attackDir(this.side);
    return { x: dir > 0 ? SETTER_X : -SETTER_X, y: -dir * (SETTER_Y + 0.7), z: 2.9 };
  }
}
