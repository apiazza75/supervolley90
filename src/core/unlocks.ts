/** Shared, declarative milestones. Empty requirements mean available from the start. */
export interface UnlockRequirement {
  matches?: number;
  wins?: number;
  points?: number;
  skillUses?: number;
  xp?: number;
}

export interface UnlockProgress {
  matchesPlayed: number;
  wins: number;
  pointsWon: number;
  skillUses: number;
  xp: number;
}

export function isUnlocked(requirement: UnlockRequirement, progress: UnlockProgress): boolean {
  return progress.matchesPlayed >= (requirement.matches ?? 0)
    && progress.wins >= (requirement.wins ?? 0)
    && progress.pointsWon >= (requirement.points ?? 0)
    && progress.skillUses >= (requirement.skillUses ?? 0)
    && progress.xp >= (requirement.xp ?? 0);
}

export function unlockLabel(requirement: UnlockRequirement): string {
  const parts: string[] = [];
  if (requirement.matches) parts.push(`${requirement.matches} ${requirement.matches === 1 ? 'partita completata' : 'partite completate'}`);
  if (requirement.wins) parts.push(`${requirement.wins} ${requirement.wins === 1 ? 'vittoria' : 'vittorie'}`);
  if (requirement.points) parts.push(`${requirement.points} punti segnati`);
  if (requirement.skillUses) parts.push(`${requirement.skillUses} abilità attivate`);
  if (requirement.xp) parts.push(`${requirement.xp} XP`);
  return parts.join(' · ') || 'Disponibile';
}
