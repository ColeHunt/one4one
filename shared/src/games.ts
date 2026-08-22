import type { Match } from './types.js';

export interface GameType {
  key: string;
  label: string;
  emoji: string;
}

/**
 * Fixed catalog of reportable games. A key is persisted on every match, so —
 * same rule as DRINK_TYPES — renaming or removing one orphans stored matches
 * from getGameType, and their history rows fall back to a generic label.
 * Labels and emoji are free to change; keys are not.
 */
export const GAME_TYPES: GameType[] = [
  { key: 'beer_pong', label: 'Beer Pong', emoji: '🏓' },
  { key: 'beer_ball', label: 'Beer Ball', emoji: '🍺' },
  { key: 'boom_cup', label: 'Boom Cup', emoji: '💥' },
  { key: 'flip_cup', label: 'Flip Cup', emoji: '🥤' },
  { key: 'ring_of_fire', label: 'Ring of Fire', emoji: '🔥' },
];

const GAME_TYPES_BY_KEY = new Map(GAME_TYPES.map((t) => [t.key, t]));

export function getGameType(key: string): GameType | undefined {
  return GAME_TYPES_BY_KEY.get(key);
}

export interface MatchRecord {
  wins: number;
  losses: number;
}

/**
 * A member's win/loss record across `matches`, optionally narrowed to one
 * game. Shown as a plain "3-1" rather than a percentage — a handful of games
 * a night doesn't deserve the false precision of a win rate.
 */
export function recordFor(matches: Match[], memberId: string, gameKey?: string): MatchRecord {
  let wins = 0;
  let losses = 0;
  for (const match of matches) {
    if (gameKey != null && match.gameKey !== gameKey) continue;
    if (match.winnerIds.includes(memberId)) wins += 1;
    if (match.loserIds.includes(memberId)) losses += 1;
  }
  return { wins, losses };
}
