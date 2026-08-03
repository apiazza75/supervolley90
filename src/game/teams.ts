import type { TeamConfig } from '../core/team';

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

export const teamByShortName = (short: string): TeamConfig =>
  TEAMS.find((t) => t.shortName === short) ?? TEAMS[0];
