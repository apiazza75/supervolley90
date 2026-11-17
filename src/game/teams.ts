import type { TeamConfig } from '../core/team';
import { skillById, type SkillId } from '../core/skills';
import { isUnlocked, type UnlockProgress, type UnlockRequirement } from '../core/unlocks';

export type { UnlockRequirement } from '../core/unlocks';

/**
 * The roster. Fictional teams and players — nothing here is lifted from any
 * existing game or real athlete, only the flavour of a 90s arcade select
 * screen with national sides.
 */
export const TEAMS: TeamConfig[] = [
  {
    name: 'Azzurri Volley',
    shortName: 'ITA',
    colors: ['#2f6fe0', '#0f1c3a'],
    rating: 0.82,
    players: [
      { name: 'Rinaldi', role: 'setter' },
      { name: 'Bertani', role: 'outside' },
      { name: 'Falco', role: 'middle' },
      { name: 'Zani', role: 'opposite', stats: { power: 0.1 } },
      { name: 'Moretti', role: 'outside' },
      { name: 'Curci', role: 'middle' },
    ],
  },
  {
    name: 'Kaiser Blocks',
    shortName: 'GER',
    colors: ['#e8e8ec', '#1b1b22'],
    rating: 0.78,
    players: [
      { name: 'Weiss', role: 'setter' },
      { name: 'Lang', role: 'outside' },
      { name: 'Brandt', role: 'middle', stats: { jump: 0.08 } },
      { name: 'Vogel', role: 'opposite' },
      { name: 'Kuhn', role: 'outside' },
      { name: 'Reiter', role: 'middle' },
    ],
  },
  {
    name: 'Rising Sun',
    shortName: 'JPN',
    colors: ['#e8394a', '#f4f4f6'],
    rating: 0.76,
    players: [
      { name: 'Aoki', role: 'setter', stats: { control: 0.08 } },
      { name: 'Kurata', role: 'outside', stats: { speed: 0.08 } },
      { name: 'Sano', role: 'middle' },
      { name: 'Ishii', role: 'opposite' },
      { name: 'Hara', role: 'outside' },
      { name: 'Tomita', role: 'middle' },
    ],
  },
  {
    name: 'Cariocas',
    shortName: 'BRA',
    colors: ['#f5c518', '#0b7a3b'],
    rating: 0.86,
    players: [
      { name: 'Duarte', role: 'setter' },
      { name: 'Nogueira', role: 'outside', stats: { power: 0.08 } },
      { name: 'Peixoto', role: 'middle' },
      { name: 'Cardoso', role: 'opposite', stats: { power: 0.12, jump: 0.06 } },
      { name: 'Vilela', role: 'outside' },
      { name: 'Braga', role: 'middle' },
    ],
  },
  {
    name: 'Red Machine',
    shortName: 'RUS',
    colors: ['#c0392b', '#2b2b33'],
    rating: 0.84,
    players: [
      { name: 'Orlov', role: 'setter' },
      { name: 'Gusev', role: 'outside' },
      { name: 'Titov', role: 'middle', stats: { jump: 0.1 } },
      { name: 'Marin', role: 'opposite', stats: { power: 0.14 } },
      { name: 'Sokolov', role: 'outside' },
      { name: 'Vlasov', role: 'middle' },
    ],
  },
  {
    name: 'Neon Spikers',
    shortName: 'NEO',
    colors: ['#00e5c8', '#12123a'],
    rating: 0.9,
    players: [
      { name: 'Kade', role: 'setter', stats: { control: 0.1 } },
      { name: 'Roux', role: 'outside', stats: { speed: 0.1 } },
      { name: 'Onyx', role: 'middle', stats: { jump: 0.12 } },
      { name: 'Vega', role: 'opposite', stats: { power: 0.16 } },
      { name: 'Sable', role: 'outside' },
      { name: 'Krieg', role: 'middle' },
    ],
  },
];

/** New national sides use original player names and preserve the six starter indices. */
const UNLOCKABLE_TEAMS: TeamConfig[] = [
  {
    name: 'USA Rockets', shortName: 'USA', colors: ['#f1f1e8', '#193e83'], rating: 0.82,
    players: [
      { name: 'Hayes', role: 'setter' }, { name: 'Reed', role: 'outside' },
      { name: 'Mason', role: 'middle' }, { name: 'Brooks', role: 'opposite' },
      { name: 'Dawson', role: 'outside' }, { name: 'Ford', role: 'middle' },
    ],
  },
  {
    name: 'Polska Eagles', shortName: 'POL', colors: ['#f1eee5', '#ce253d'], rating: 0.84,
    players: [
      { name: 'Nowak', role: 'setter' }, { name: 'Wrona', role: 'outside' },
      { name: 'Mazur', role: 'middle' }, { name: 'Lis', role: 'opposite' },
      { name: 'Wilk', role: 'outside' }, { name: 'Kruk', role: 'middle' },
    ],
  },
  {
    name: 'Cuba Caribe', shortName: 'CUB', colors: ['#e03939', '#124c9d'], rating: 0.83,
    players: [
      { name: 'Valdés', role: 'setter' }, { name: 'Solano', role: 'outside' },
      { name: 'Roca', role: 'middle' }, { name: 'Mena', role: 'opposite' },
      { name: 'Lago', role: 'outside' }, { name: 'Acosta', role: 'middle' },
    ],
  },
  {
    name: 'France Étoiles', shortName: 'FRA', colors: ['#2352a4', '#ecece8'], rating: 0.82,
    players: [
      { name: 'Aubert', role: 'setter' }, { name: 'Clair', role: 'outside' },
      { name: 'Duval', role: 'middle' }, { name: 'Renard', role: 'opposite' },
      { name: 'Fabre', role: 'outside' }, { name: 'Lenoir', role: 'middle' },
    ],
  },
];

export interface NationalTeamEntry {
  id: string;
  team: TeamConfig;
  unlock: UnlockRequirement;
}

export const NATIONAL_TEAMS: NationalTeamEntry[] = [
  ...TEAMS.map(team => ({ id: team.shortName, team, unlock: {} })),
  ...UNLOCKABLE_TEAMS.map((team, index) => ({
    id: team.shortName, team, unlock: { matches: [1, 2, 3, 5][index] },
  })),
];

export interface TeamKit {
  id: string;
  name: string;
  description: string;
  /** Null means a tribute kit that any selected team can wear. */
  teamIds: string[] | null;
  colors: [string, string];
  unlock: UnlockRequirement;
  inspirationUrl?: string;
}

export interface BallStyle {
  id: string;
  name: string;
  colors: [string, string, string];
  seamColor: string;
  unlock: UnlockRequirement;
}

export interface CourtStyle {
  id: string;
  name: string;
  /** Null preserves the original authored arena. Other tints retain its wood texture. */
  woodTint: string | null;
  surfaceTint: string | null;
  unlock: UnlockRequirement;
}

export const TEAM_KITS: TeamKit[] = [
  ...NATIONAL_TEAMS.map(({ team, unlock }) => ({
    id: `${team.shortName.toLowerCase()}-home`, name: `${team.shortName} · Prima maglia`,
    description: 'I colori della squadra.', teamIds: [team.shortName],
    colors: [...team.colors] as [string, string], unlock: { ...unlock },
  })),
  { id: 'ita-white', name: 'Italia · Bianca', description: 'Seconda maglia bianca con pantaloncini azzurri.', teamIds: ['ITA'], colors: ['#eeeade', '#2467c9'], unlock: {} },
  { id: 'ita-night', name: 'Italia · Notte', description: 'Terza maglia blu notte con dettagli oro.', teamIds: ['ITA'], colors: ['#172b55', '#d6ae51'], unlock: { matches: 2 } },
  { id: 'ger-black', name: 'Germania · Nera', description: 'Seconda maglia antracite e oro.', teamIds: ['GER'], colors: ['#232631', '#dfb63c'], unlock: { matches: 1 } },
  { id: 'jpn-white', name: 'Giappone · Bianca', description: 'Seconda maglia bianca e rossa.', teamIds: ['JPN'], colors: ['#eeeade', '#c92e42'], unlock: { matches: 1 } },
  { id: 'bra-blue', name: 'Brasile · Blu', description: 'Seconda maglia blu e gialla.', teamIds: ['BRA'], colors: ['#2857bb', '#e8c02d'], unlock: { matches: 1 } },
  { id: 'rus-white', name: 'Russia · Bianca', description: 'Seconda maglia bianca e rossa.', teamIds: ['RUS'], colors: ['#e8e5dc', '#ae3234'], unlock: { matches: 1 } },
  { id: 'neo-violet', name: 'Neon · Violetto', description: 'Seconda maglia viola e turchese.', teamIds: ['NEO'], colors: ['#6a3c9d', '#32dcc9'], unlock: { matches: 1 } },
  { id: 'usa-navy', name: 'USA · Navy', description: 'Seconda maglia blu e crema.', teamIds: ['USA'], colors: ['#193e83', '#efe8dc'], unlock: { matches: 2 } },
  { id: 'pol-red', name: 'Polonia · Rossa', description: 'Seconda maglia rossa e bianca.', teamIds: ['POL'], colors: ['#ce253d', '#f1eee5'], unlock: { matches: 3 } },
  { id: 'cub-blue', name: 'Cuba · Blu', description: 'Seconda maglia blu e rossa.', teamIds: ['CUB'], colors: ['#124c9d', '#e03939'], unlock: { matches: 4 } },
  { id: 'fra-white', name: 'Francia · Bianca', description: 'Seconda maglia bianca e blu.', teamIds: ['FRA'], colors: ['#ecece8', '#2352a4'], unlock: { matches: 5 } },
  {
    id: 'modena-97', name: 'Modena ’97 · Omaggio',
    description: 'Omaggio gialloblù al Modena 1996/97, vincitore di campionato, Coppa Italia e Coppa dei Campioni. Divisa originale ispirata ai colori del club.',
    teamIds: null, colors: ['#efc526', '#203f96'], unlock: { matches: 2 },
    inspirationUrl: 'https://www.modenavolley.it/news/sportive/legends-il-sestetto-dei-sogni-fabio-vullo/',
  },
  {
    id: 'treviso-90', name: 'Treviso ’90 · Omaggio',
    description: 'Omaggio oro e granata al Treviso degli anni Novanta. Divisa originale ispirata ai colori del club.',
    teamIds: null, colors: ['#762d44', '#d5ae56'], unlock: { matches: 3 },
    inspirationUrl: 'https://www.volleytreviso.it/societa/anni-90-il-boom-del-volley/',
  },
];

export const BALL_STYLES: BallStyle[] = [
  { id: 'classic', name: 'Classico', colors: ['#f1ead6', '#2a5bd7', '#ffc531'], seamColor: 'rgba(24,32,52,0.5)', unlock: {} },
  { id: 'tricolor', name: 'Tricolore', colors: ['#f1ead6', '#238b62', '#d83843'], seamColor: 'rgba(24,32,52,0.5)', unlock: { matches: 1 } },
  { id: 'beach', name: 'Sunset', colors: ['#ffe9be', '#f07b37', '#27adc4'], seamColor: 'rgba(51,39,34,0.6)', unlock: { points: 80 } },
  { id: 'neon', name: 'Neon', colors: ['#c3b4ec', '#2de1d1', '#e165be'], seamColor: 'rgba(20,27,48,0.7)', unlock: { matches: 4 } },
  { id: 'vintage', name: 'Vintage avorio', colors: ['#f1e4c7', '#deccb0', '#ead8bb'], seamColor: 'rgba(81,60,38,0.6)', unlock: { matches: 6 } },
];

export const COURT_STYLES: CourtStyle[] = [
  { id: 'maple', name: 'Acero', woodTint: null, surfaceTint: null, unlock: {} },
  { id: 'walnut', name: 'Noce', woodTint: '#80583d', surfaceTint: '#80583d', unlock: { matches: 1 } },
  { id: 'honey', name: 'Miele', woodTint: '#dfad53', surfaceTint: '#cf9b42', unlock: { points: 80 } },
  { id: 'arctic', name: 'Artico', woodTint: '#a4bec4', surfaceTint: '#77a5b4', unlock: { matches: 3 } },
  { id: 'midnight', name: 'Notte', woodTint: '#687783', surfaceTint: '#43596c', unlock: { matches: 5 } },
];

export function availableKits(teamId: string, progress?: UnlockProgress): TeamKit[] {
  return TEAM_KITS.filter(kit => (kit.teamIds === null || kit.teamIds.includes(teamId))
    && (!progress || isUnlocked(kit.unlock, progress)));
}

/** Never recolour or change a shared roster when both local players select the same nation. */
export function configureTeam(base: TeamConfig, options: { kitId?: string; skillId?: SkillId } = {}): TeamConfig {
  const kit = availableKits(base.shortName).find(candidate => candidate.id === options.kitId);
  const selectedSkill = skillById(options.skillId ?? base.skillId);
  return {
    ...base,
    colors: [...(kit?.colors ?? base.colors)],
    kitId: kit?.id ?? `${base.shortName.toLowerCase()}-home`,
    skillId: selectedSkill?.id,
    players: base.players?.map(player => ({ ...player, stats: player.stats ? { ...player.stats } : undefined })),
  };
}

export const teamByShortName = (short: string): TeamConfig =>
  NATIONAL_TEAMS.find(({ team }) => team.shortName === short)?.team ?? TEAMS[0];
