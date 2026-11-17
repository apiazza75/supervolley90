import type { UnlockRequirement } from './unlocks';

export type SkillAction = 'attack' | 'block' | 'set' | 'defense';
export type SkillId = 'meteor' | 'ironwall' | 'maestro' | 'guardian' | 'sniper' | 'comet';

export interface SkillEffects {
  powerMultiplier: number;
  errorMultiplier: number;
  reachMultiplier: number;
  setTempoMultiplier: number;
  controlBonus: number;
}

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  action: SkillAction;
  /** Charge is earned through play, never by waiting or entering a menu. */
  cost: number;
  /** Seconds of live simulation before another activation. */
  cooldown: number;
  effects: Readonly<SkillEffects>;
  unlock: UnlockRequirement;
}

export interface SkillState {
  charge: number;
  cooldown: number;
  activations: number;
}

export interface SkillActivation {
  id: SkillId;
  name: string;
  action: SkillAction;
  effects: Readonly<SkillEffects>;
}

export const SKILL_CHARGE_MAX = 100;
export const SKILL_INITIAL_CHARGE = 25;

const effects = (changes: Partial<SkillEffects>): Readonly<SkillEffects> => Object.freeze({
  powerMultiplier: 1,
  errorMultiplier: 1,
  reachMultiplier: 1,
  setTempoMultiplier: 1,
  controlBonus: 0,
  ...changes,
});

/** Every starter has a different tactical purpose; unlocks are alternatives, not upgrades. */
export const SKILLS: readonly SkillDefinition[] = [
  {
    id: 'meteor', name: 'Meteora', action: 'attack', cost: 50, cooldown: 14,
    description: 'La prossima schiacciata ha il 14% di potenza in più. Richiede 50 energia; recupero 14 s.',
    effects: effects({ powerMultiplier: 1.14 }), unlock: {},
  },
  {
    id: 'ironwall', name: 'Muro d’acciaio', action: 'block', cost: 45, cooldown: 12,
    description: 'Il prossimo muro copre il 18% in più e controlla meglio il rimbalzo. 45 energia; recupero 12 s.',
    effects: effects({ reachMultiplier: 1.18, controlBonus: 0.12 }), unlock: {},
  },
  {
    id: 'maestro', name: 'Regista', action: 'set', cost: 40, cooldown: 10,
    description: 'La prossima alzata riduce del 40% la dispersione e migliora il controllo. 40 energia; recupero 10 s.',
    effects: effects({ errorMultiplier: 0.6, controlBonus: 0.12 }), unlock: {},
  },
  {
    id: 'guardian', name: 'Salvataggio', action: 'defense', cost: 45, cooldown: 12,
    description: 'La prossima ricezione ha il 15% di portata in più e il 30% di dispersione in meno. 45 energia; recupero 12 s.',
    effects: effects({ reachMultiplier: 1.15, errorMultiplier: 0.7 }), unlock: {},
  },
  {
    id: 'sniper', name: 'Ago', action: 'attack', cost: 50, cooldown: 14,
    description: 'La prossima schiacciata dimezza la dispersione, senza aumentare la potenza. 50 energia; recupero 14 s.',
    effects: effects({ errorMultiplier: 0.5, controlBonus: 0.08 }), unlock: { matches: 2 },
  },
  {
    id: 'comet', name: 'Cometa', action: 'set', cost: 50, cooldown: 14,
    description: 'La prossima alzata viaggia il 12% più rapida e riduce del 20% la dispersione. 50 energia; recupero 14 s.',
    effects: effects({ setTempoMultiplier: 1.12, errorMultiplier: 0.8 }), unlock: { matches: 4 },
  },
];

export function skillById(id: string | undefined): SkillDefinition | undefined {
  return SKILLS.find(skill => skill.id === id);
}

export function createSkillState(): SkillState {
  return { charge: SKILL_INITIAL_CHARGE, cooldown: 0, activations: 0 };
}

export function tickSkill(state: SkillState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  state.cooldown = Math.max(0, state.cooldown - dt);
}

export function addSkillCharge(state: SkillState, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.charge = Math.min(SKILL_CHARGE_MAX, state.charge + amount);
}

/** A reach/aim preview must never consume energy; only the actual contact commits it. */
export function peekSkill(state: SkillState, id: string | undefined, action: SkillAction): SkillActivation | null {
  const skill = skillById(id);
  if (!skill || skill.action !== action || state.cooldown > 1e-8 || state.charge < skill.cost) return null;
  return { id: skill.id, name: skill.name, action: skill.action, effects: skill.effects };
}

export function useSkill(state: SkillState, id: string | undefined, action: SkillAction): SkillActivation | null {
  const activation = peekSkill(state, id, action);
  if (!activation) return null;
  const skill = skillById(activation.id)!;
  state.charge -= skill.cost;
  state.cooldown = skill.cooldown;
  state.activations += 1;
  return activation;
}
