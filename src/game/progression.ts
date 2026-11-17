import { SKILLS } from '../core/skills';
import { isUnlocked, type UnlockProgress } from '../core/unlocks';
import { BALL_STYLES, COURT_STYLES, NATIONAL_TEAMS, TEAM_KITS } from './teams';

export { isUnlocked, unlockLabel } from '../core/unlocks';
export type { UnlockRequirement } from '../core/unlocks';

export const PROGRESSION_VERSION = 1;
export const PROGRESSION_STORAGE_KEY = 'supervolley90.progression.v1';

export interface ProgressionProfile extends UnlockProgress {
  version: typeof PROGRESSION_VERSION;
  /** Kept for the lifetime of the profile: rendering the result twice cannot award it twice. */
  rewardedMatchIds: string[];
}

export interface CompletedMatchResult {
  /** Generated once at match start, reused for all result/render notifications. */
  id: string;
  mode: 'solo' | 'versus' | 'demo';
  completed: boolean;
  /** Actual human action/jump presses observed during this match, not simulation frames. */
  humanActions: number;
  /** Result for player one, whose local profile owns the save. */
  won: boolean;
  pointsWon: number;
  pointsLost: number;
  setsPlayed: number;
  skillUses: number;
}

export interface MatchReward {
  profile: ProgressionProfile;
  awarded: boolean;
  xpGained: number;
  /** Human-readable names, suitable for the end-of-match unlock announcement. */
  newUnlocks: string[];
  reason?: 'demo' | 'incomplete' | 'not-played' | 'duplicate' | 'invalid';
}

export interface ProgressionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Retain earned play in this tab if the browser rejects a write. Never masquerades as a disk save. */
let unsavedSessionProfile: ProgressionProfile | undefined;

function copyProfile(profile: ProgressionProfile): ProgressionProfile {
  return { ...profile, rewardedMatchIds: [...profile.rewardedMatchIds] };
}

export function createProgression(): ProgressionProfile {
  return { version: PROGRESSION_VERSION, matchesPlayed: 0, wins: 0, pointsWon: 0, skillUses: 0, xp: 0, rewardedMatchIds: [] };
}

function safeCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
}

function isMatchId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
}

/** Missing, partial and corrupt browser saves are data, never reasons to crash the game. */
export function decodeProgression(raw: string | null): ProgressionProfile {
  if (!raw) return createProgression();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return createProgression();
    const record = value as Record<string, unknown>;
    if (record.version !== PROGRESSION_VERSION) return createProgression();
    const matchesPlayed = safeCounter(record.matchesPlayed);
    return {
      version: PROGRESSION_VERSION,
      matchesPlayed,
      wins: Math.min(matchesPlayed, safeCounter(record.wins)),
      pointsWon: safeCounter(record.pointsWon),
      skillUses: safeCounter(record.skillUses),
      xp: safeCounter(record.xp),
      rewardedMatchIds: Array.isArray(record.rewardedMatchIds)
        ? [...new Set(record.rewardedMatchIds.filter(isMatchId))] : [],
    };
  } catch {
    return createProgression();
  }
}

function browserStorage(): ProgressionStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadProgression(storage?: ProgressionStorage): ProgressionProfile {
  const useBrowser = arguments.length === 0;
  // A failed write can leave an older, readable save on disk. Do not roll the
  // menu back to it while this tab still owns newer earned progress.
  if (useBrowser && unsavedSessionProfile) return copyProfile(unsavedSessionProfile);
  const target = useBrowser ? browserStorage() : storage;
  try {
    return decodeProgression(target?.getItem(PROGRESSION_STORAGE_KEY) ?? null);
  } catch {
    return createProgression();
  }
}

/** False lets the UI report that a private/quota-limited browser could not save. */
export function saveProgression(profile: ProgressionProfile, storage?: ProgressionStorage): boolean {
  const useBrowser = arguments.length === 1;
  const target = useBrowser ? browserStorage() : storage;
  let saved = false;
  try {
    const encoded = JSON.stringify(profile);
    target?.setItem(PROGRESSION_STORAGE_KEY, encoded);
    saved = target?.getItem(PROGRESSION_STORAGE_KEY) === encoded;
  } catch {
    saved = false;
  }
  if (useBrowser) unsavedSessionProfile = saved ? undefined : copyProfile(profile);
  return saved;
}

function unlockedNames(profile: ProgressionProfile): Set<string> {
  return new Set([
    ...NATIONAL_TEAMS.filter(item => isUnlocked(item.unlock, profile)).map(item => `Nazionale: ${item.team.name}`),
    ...TEAM_KITS.filter(item => isUnlocked(item.unlock, profile)).map(item => `Maglia: ${item.name}`),
    ...BALL_STYLES.filter(item => isUnlocked(item.unlock, profile)).map(item => `Pallone: ${item.name}`),
    ...COURT_STYLES.filter(item => isUnlocked(item.unlock, profile)).map(item => `Parquet: ${item.name}`),
    ...SKILLS.filter(item => isUnlocked(item.unlock, profile)).map(item => `Abilità: ${item.name}`),
  ]);
}

const isNonnegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const addCounter = (value: number, amount: number): number => Math.min(Number.MAX_SAFE_INTEGER, value + amount);

/**
 * Pure result accounting. Call once from matchWon and keep the returned profile;
 * repeated calls are still harmless, including after a reload. Attract mode,
 * abandoned matches and letting AI play without meaningful input earn nothing.
 */
export function awardMatch(profile: ProgressionProfile, result: CompletedMatchResult): MatchReward {
  const rejected = (reason: NonNullable<MatchReward['reason']>): MatchReward => ({
    profile, awarded: false, xpGained: 0, newUnlocks: [], reason,
  });
  if (result.mode === 'demo') return rejected('demo');
  if (!result.completed) return rejected('incomplete');
  if (!isMatchId(result.id)
    || !['solo', 'versus'].includes(result.mode)
    || typeof result.won !== 'boolean'
    || ![result.humanActions, result.pointsWon, result.pointsLost, result.setsPlayed, result.skillUses].every(isNonnegativeInteger)
    || result.setsPlayed < 2 || result.setsPlayed > 5) return rejected('invalid');
  if (profile.rewardedMatchIds.includes(result.id)) return rejected('duplicate');
  if (result.humanActions < 8 || result.pointsWon + result.pointsLost < 20) return rejected('not-played');

  const xpGained = 80 + Math.min(120, result.pointsWon) + (result.won ? 60 : 0) + Math.min(40, result.skillUses * 4);
  const next: ProgressionProfile = {
    version: PROGRESSION_VERSION,
    matchesPlayed: addCounter(profile.matchesPlayed, 1),
    wins: addCounter(profile.wins, result.won ? 1 : 0),
    pointsWon: addCounter(profile.pointsWon, result.pointsWon),
    skillUses: addCounter(profile.skillUses, result.skillUses),
    xp: addCounter(profile.xp, xpGained),
    rewardedMatchIds: [...profile.rewardedMatchIds, result.id],
  };
  const previousUnlocks = unlockedNames(profile);
  return {
    profile: next, awarded: true, xpGained,
    newUnlocks: [...unlockedNames(next)].filter(name => !previousUnlocks.has(name)),
  };
}
