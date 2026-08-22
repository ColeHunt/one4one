import { describe, expect, it } from 'vitest';
import { GAME_TYPES, getGameType, recordFor } from '../src/games.js';
import type { Match } from '../src/types.js';

const NOW = 1_700_000_000_000;

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: Math.random().toString(36).slice(2),
    gameKey: 'beer_pong',
    winnerIds: ['a'],
    loserIds: ['b'],
    note: null,
    playedAt: NOW,
    reportedBy: 'a',
    ...overrides,
  };
}

describe('game catalog', () => {
  it('resolves every listed key', () => {
    for (const type of GAME_TYPES) {
      expect(getGameType(type.key), type.key).toBe(type);
    }
  });

  it('returns undefined for an unknown key', () => {
    expect(getGameType('flip_table')).toBeUndefined();
  });

  /**
   * Keys are persisted on every reported match, so renaming one orphans
   * history the same way a DRINK_TYPES rename would. Changing this list is a
   * deliberate act.
   */
  it('keeps its keys stable', () => {
    expect(GAME_TYPES.map((type) => type.key)).toEqual([
      'beer_pong',
      'beer_ball',
      'boom_cup',
      'flip_cup',
      'ring_of_fire',
    ]);
  });
});

describe('recordFor', () => {
  it('counts a win and a loss', () => {
    const matches = [match({ winnerIds: ['a'], loserIds: ['b'] })];
    expect(recordFor(matches, 'a')).toEqual({ wins: 1, losses: 0 });
    expect(recordFor(matches, 'b')).toEqual({ wins: 0, losses: 1 });
  });

  it('counts every winner and every loser on a team match', () => {
    const matches = [match({ winnerIds: ['a', 'b'], loserIds: ['c', 'd'] })];
    expect(recordFor(matches, 'a').wins).toBe(1);
    expect(recordFor(matches, 'b').wins).toBe(1);
    expect(recordFor(matches, 'c').losses).toBe(1);
    expect(recordFor(matches, 'd').losses).toBe(1);
  });

  it('counts a loss with no winners for a free-for-all match', () => {
    const matches = [match({ winnerIds: [], loserIds: ['x'] })];
    expect(recordFor(matches, 'x')).toEqual({ wins: 0, losses: 1 });
  });

  it('sums across several matches', () => {
    const matches = [
      match({ winnerIds: ['a'], loserIds: ['b'] }),
      match({ winnerIds: ['a'], loserIds: ['c'] }),
      match({ winnerIds: ['b'], loserIds: ['a'] }),
    ];
    expect(recordFor(matches, 'a')).toEqual({ wins: 2, losses: 1 });
  });

  it('filters to one game when asked', () => {
    const matches = [
      match({ gameKey: 'beer_pong', winnerIds: ['a'], loserIds: ['b'] }),
      match({ gameKey: 'flip_cup', winnerIds: ['a'], loserIds: ['b'] }),
    ];
    expect(recordFor(matches, 'a', 'beer_pong')).toEqual({ wins: 1, losses: 0 });
    expect(recordFor(matches, 'a')).toEqual({ wins: 2, losses: 0 });
  });

  it('is zero for someone who has not played', () => {
    expect(recordFor([match()], 'stranger')).toEqual({ wins: 0, losses: 0 });
  });

  it('is zero for an empty match list', () => {
    expect(recordFor([], 'a')).toEqual({ wins: 0, losses: 0 });
  });
});
