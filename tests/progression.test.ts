import { describe, expect, it, vi } from 'vitest';
import {
  awardMatch, createProgression, decodeProgression, isUnlocked, loadProgression,
  PROGRESSION_STORAGE_KEY, saveProgression, unlockLabel,
  type CompletedMatchResult, type ProgressionStorage,
} from '../src/game/progression';
import { availableKits, BALL_STYLES, configureTeam, COURT_STYLES, NATIONAL_TEAMS, TEAM_KITS, TEAMS } from '../src/game/teams';

const result = (changes: Partial<CompletedMatchResult> = {}): CompletedMatchResult => ({
  id: 'match-1', mode: 'solo', completed: true, humanActions: 42,
  won: true, pointsWon: 30, pointsLost: 20, setsPlayed: 2, skillUses: 3,
  ...changes,
});

function memoryStorage(): ProgressionStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('completed-match progression', () => {
  it('awards a real match once without mutating the original profile, including after reload', () => {
    const original = createProgression(), before = structuredClone(original);
    const reward = awardMatch(original, result());
    expect(original).toEqual(before);
    expect(reward.awarded).toBe(true);
    expect(reward.profile.matchesPlayed).toBe(1);
    expect(reward.profile.wins).toBe(1);
    expect(reward.profile.pointsWon).toBe(30);
    expect(reward.profile.skillUses).toBe(3);
    expect(reward.xpGained).toBeGreaterThan(0);
    expect(reward.profile.xp).toBe(reward.xpGained);

    const storage = memoryStorage();
    expect(saveProgression(reward.profile, storage)).toBe(true);
    const restored = loadProgression(storage);
    for (let drawFrame = 0; drawFrame < 120; drawFrame++) {
      const duplicate = awardMatch(restored, result());
      expect(duplicate.awarded).toBe(false);
      expect(duplicate.reason).toBe('duplicate');
      expect(duplicate.profile).toBe(restored);
      expect(duplicate.newUnlocks).toEqual([]);
    }
  });

  it.each([
    [{ mode: 'demo' }, 'demo'],
    [{ completed: false }, 'incomplete'],
    [{ humanActions: 0 }, 'not-played'],
    [{ humanActions: 7 }, 'not-played'],
    [{ pointsWon: 2, pointsLost: 1 }, 'not-played'],
    [{ setsPlayed: 1 }, 'invalid'],
    [{ setsPlayed: 6 }, 'invalid'],
    [{ skillUses: Number.NaN }, 'invalid'],
    [{ pointsWon: -1 }, 'invalid'],
    [{ humanActions: 4.5 }, 'invalid'],
    [{ id: '' }, 'invalid'],
  ] as const)('does not reward a demo, abandonment, idle AI play or malformed result: %j', (changes, reason) => {
    const profile = createProgression();
    const reward = awardMatch(profile, result(changes));
    expect(reward.awarded).toBe(false);
    expect(reward.reason).toBe(reason);
    expect(reward.profile).toBe(profile);
    expect(profile).toEqual(createProgression());
  });

  it('counts a completed local versus loss as participation and keeps win statistics truthful', () => {
    const reward = awardMatch(createProgression(), result({ mode: 'versus', won: false, pointsWon: 17, pointsLost: 30 }));
    expect(reward.awarded).toBe(true);
    expect(reward.profile.matchesPlayed).toBe(1);
    expect(reward.profile.wins).toBe(0);
    expect(reward.profile.pointsWon).toBe(17);
    expect(reward.newUnlocks).toContain('Nazionale: USA Rockets');
  });

  it('makes national teams, kit tributes, balls, courts and sidegrade abilities earnable through normal matches', () => {
    let profile = createProgression();
    const announced = new Set<string>();
    expect(NATIONAL_TEAMS.filter(item => isUnlocked(item.unlock, profile))).toHaveLength(6);
    for (let match = 1; match <= 6; match++) {
      const reward = awardMatch(profile, result({ id: `match-${match}`, won: match % 2 === 0 }));
      expect(reward.awarded).toBe(true);
      for (const unlock of reward.newUnlocks) {
        expect(announced.has(unlock)).toBe(false);
        announced.add(unlock);
      }
      profile = reward.profile;
    }
    expect(NATIONAL_TEAMS.every(item => isUnlocked(item.unlock, profile))).toBe(true);
    expect(TEAM_KITS.every(item => isUnlocked(item.unlock, profile))).toBe(true);
    expect(BALL_STYLES.every(item => isUnlocked(item.unlock, profile))).toBe(true);
    expect(COURT_STYLES.every(item => isUnlocked(item.unlock, profile))).toBe(true);
    expect([...announced]).toEqual(expect.arrayContaining([
      'Maglia: Modena ’97 · Omaggio', 'Maglia: Treviso ’90 · Omaggio',
      'Abilità: Ago', 'Abilità: Cometa', 'Pallone: Vintage avorio', 'Parquet: Notte',
    ]));
  });

  it('evaluates combined milestone requirements with AND semantics and explains them', () => {
    const requirement = { matches: 2, wins: 1, points: 80, skillUses: 3, xp: 150 };
    const met = { ...createProgression(), matchesPlayed: 2, wins: 1, pointsWon: 80, skillUses: 3, xp: 150 };
    expect(isUnlocked(requirement, met)).toBe(true);
    expect(isUnlocked(requirement, { ...met, wins: 0 })).toBe(false);
    expect(isUnlocked(requirement, { ...met, pointsWon: 79 })).toBe(false);
    expect(unlockLabel(requirement)).toContain('2 partite completate');
    expect(unlockLabel({})).toBe('Disponibile');
  });
});

describe('versioned progression storage', () => {
  it.each([null, '', 'not JSON', '{', 'null', '[]', '42', '{"version":999,"matchesPlayed":100}'])('recovers from unreadable or unsupported data: %s', raw => {
    expect(decodeProgression(raw)).toEqual(createProgression());
  });

  it('repairs invalid fields without discarding valid counters or deduplication receipts', () => {
    const loaded = decodeProgression(JSON.stringify({
      version: 1, matchesPlayed: 2.9, wins: 100, pointsWon: -12, skillUses: 'bad', xp: 400,
      rewardedMatchIds: ['match-1', 'match-1', 12, null, '', '<script>', 'match-2'],
    }));
    expect(loaded).toEqual({
      version: 1, matchesPlayed: 2, wins: 2, pointsWon: 0, skillUses: 0, xp: 400,
      rewardedMatchIds: ['match-1', 'match-2'],
    });
    expect(awardMatch(loaded, result()).reason).toBe('duplicate');
  });

  it('handles blocked storage and verifies destination readback instead of assuming a save succeeded', () => {
    const blocked: ProgressionStorage = {
      getItem: () => { throw new Error('Access denied'); },
      setItem: () => { throw new Error('Quota exceeded'); },
    };
    expect(loadProgression(blocked)).toEqual(createProgression());
    expect(saveProgression(createProgression(), blocked)).toBe(false);
    const discarding: ProgressionStorage = { getItem: () => null, setItem: () => undefined };
    expect(saveProgression(createProgression(), discarding)).toBe(false);
    const valid = memoryStorage();
    const profile = awardMatch(createProgression(), result()).profile;
    expect(saveProgression(profile, valid)).toBe(true);
    expect(valid.getItem(PROGRESSION_STORAGE_KEY)).toBeTruthy();
    expect(loadProgression(valid)).toEqual(profile);
  });

  it('keeps newly earned unlocks in the same tab when quota leaves an older disk save readable', () => {
    const disk = memoryStorage();
    vi.stubGlobal('localStorage', disk);
    try {
      expect(saveProgression(createProgression())).toBe(true);
      const earned = awardMatch(loadProgression(), result()).profile;
      const fullDisk: ProgressionStorage = {
        getItem: key => disk.getItem(key),
        setItem: () => { throw new Error('Quota exceeded'); },
      };
      vi.stubGlobal('localStorage', fullDisk);
      expect(saveProgression(earned)).toBe(false);
      expect(loadProgression()).toEqual(earned);
      expect(isUnlocked(NATIONAL_TEAMS.find(item => item.id === 'USA')!.unlock, loadProgression())).toBe(true);
      expect(loadProgression(disk)).toEqual(createProgression());
      const menuCopy = loadProgression();
      menuCopy.rewardedMatchIds.length = 0;
      expect(loadProgression().rewardedMatchIds).toEqual(['match-1']);

      // A second match builds on the same in-session progress; a recovered
      // browser persists the entire profile, then normal disk reads resume.
      const next = awardMatch(loadProgression(), result({ id: 'match-2' })).profile;
      vi.stubGlobal('localStorage', disk);
      expect(saveProgression(next)).toBe(true);
      expect(loadProgression(disk)).toEqual(next);
      expect(loadProgression()).toEqual(next);
    } finally {
      vi.stubGlobal('localStorage', disk);
      saveProgression(createProgression());
      vi.unstubAllGlobals();
    }
  });

  it('retains an in-session fallback when local storage is absent, while injected storage stays isolated', () => {
    const disk = memoryStorage();
    vi.stubGlobal('localStorage', disk);
    try {
      saveProgression(createProgression());
      vi.stubGlobal('localStorage', undefined);
      const earned = awardMatch(loadProgression(), result()).profile;
      expect(saveProgression(earned)).toBe(false);
      expect(loadProgression()).toEqual(earned);
      const isolated = awardMatch(createProgression(), result({ id: 'isolated' })).profile;
      expect(saveProgression(isolated, undefined)).toBe(false);
      expect(loadProgression(undefined)).toEqual(createProgression());
      expect(loadProgression()).toEqual(earned);
    } finally {
      vi.stubGlobal('localStorage', disk);
      saveProgression(createProgression());
      vi.unstubAllGlobals();
    }
  });
});

describe('content loadouts', () => {
  it('preserves the six original starter teams and does not make unlocked nations stronger than every starter', () => {
    expect(TEAMS.map(team => team.shortName)).toEqual(['ITA', 'GER', 'JPN', 'BRA', 'RUS', 'NEO']);
    const starterMax = Math.max(...TEAMS.map(team => team.rating));
    expect(NATIONAL_TEAMS.filter(item => item.unlock.matches).every(item => item.team.rating <= starterMax)).toBe(true);
    for (const catalog of [NATIONAL_TEAMS, TEAM_KITS, BALL_STYLES, COURT_STYLES]) {
      expect(new Set(catalog.map(item => item.id)).size).toBe(catalog.length);
    }
  });

  it('lets both players wear different kits for the same nation without mutating each other or the catalog', () => {
    const before = structuredClone(TEAMS[0]);
    const home = configureTeam(TEAMS[0], { kitId: 'ita-white', skillId: 'meteor' });
    const away = configureTeam(TEAMS[0], { kitId: 'modena-97', skillId: 'guardian' });
    expect(home.colors).not.toEqual(away.colors);
    expect(home.skillId).toBe('meteor');
    expect(away.skillId).toBe('guardian');
    home.colors[0] = '#000000';
    home.players![0].name = 'Edited';
    home.players![3].stats!.power = 0.99;
    expect(TEAMS[0]).toEqual(before);
    expect(away.players).toEqual(before.players);
    expect(TEAM_KITS.find(kit => kit.id === 'ita-white')!.colors[0]).toBe('#eeeade');
  });

  it('rejects a national kit belonging to a different nation and exposes locked compatible choices', () => {
    expect(configureTeam(TEAMS[0], { kitId: 'bra-blue' }).colors).toEqual(TEAMS[0].colors);
    expect(availableKits('ITA').map(kit => kit.id)).toContain('ita-night');
    expect(availableKits('ITA', createProgression()).map(kit => kit.id)).toEqual(['ita-home', 'ita-white']);
    expect(availableKits('BRA').some(kit => kit.id === 'ita-white')).toBe(false);
  });
});
