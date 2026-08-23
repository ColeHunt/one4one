import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, setDb } from '../src/db.js';
import { isValidRoomCode, normaliseRoomCode } from '../src/ids.js';
import {
  RoomError,
  addDrink,
  closeRoom,
  createRoom,
  getRoomState,
  getWatchState,
  joinRoom,
  purgeStaleRooms,
  removeDrink,
  renameRoom,
  reopenRoom,
  reportMatch,
  resolveWatchToken,
  retractMatch,
  sanitiseName,
  updateProfile,
} from '../src/rooms.js';

const ALICE = 'a'.repeat(32);
const BOB = 'b'.repeat(32);
const CARA = 'c'.repeat(32);
const DAVE = 'd'.repeat(32);
const STRANGER = 'e'.repeat(32);

beforeEach(() => {
  setDb(openDb(':memory:'));
});

describe('room codes', () => {
  it('generates codes that validate', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(isValidRoomCode(createRoom())).toBe(true);
    }
  });

  it('normalises human input', () => {
    expect(normaliseRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normaliseRoomCode('abcdefghij')).toBe('ABCDEF');
  });

  it('drops look-alike characters the generator never emits', () => {
    expect(normaliseRoomCode('O0I1L')).toBe('');
    expect(isValidRoomCode(normaliseRoomCode('O0I1L'))).toBe(false);
  });
});

describe('joining', () => {
  it('rejects unknown rooms', () => {
    expect(() => joinRoom('ZZZZZZ', ALICE, 'Alice')).toThrow(RoomError);
  });

  it('is idempotent and preserves the profile across rejoins', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    updateProfile(code, ALICE, { weightKg: 70, sex: 'female' });
    const member = joinRoom(code, ALICE, 'Alice');

    expect(getRoomState(code, ALICE).members).toHaveLength(1);
    expect(member.id).toBe(ALICE);
    expect(getRoomState(code, ALICE).members[0]!.weightKg).toBe(70);
  });

  it('renames on rejoin with a new name', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, ALICE, 'Al');
    expect(getRoomState(code, ALICE).members[0]!.name).toBe('Al');
  });

  it('gives members distinct colours', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    const [a, b] = getRoomState(code, ALICE).members;
    expect(a!.color).not.toBe(b!.color);
  });

  it('falls back to a placeholder for blank names', () => {
    expect(sanitiseName('   ')).toBe('Someone');
    expect(sanitiseName(undefined)).toBe('Someone');
    expect(sanitiseName('a'.repeat(100))).toHaveLength(24);
  });

  it('lets the same device belong to more than one room at once', () => {
    const first = createRoom();
    const second = createRoom();
    joinRoom(first, ALICE, 'Alice');
    expect(() => joinRoom(second, ALICE, 'Alice')).not.toThrow();

    expect(getRoomState(first, ALICE).members).toHaveLength(1);
    expect(getRoomState(second, ALICE).members).toHaveLength(1);
  });

  it('renaming on rejoin only touches the room being rejoined', () => {
    const first = createRoom();
    const second = createRoom();
    joinRoom(first, ALICE, 'Alice');
    joinRoom(second, ALICE, 'Alice');

    joinRoom(second, ALICE, 'Ali');

    expect(getRoomState(second, ALICE).members[0]!.name).toBe('Ali');
    expect(getRoomState(first, ALICE).members[0]!.name).toBe('Alice');
  });
});

describe('drinks', () => {
  it('records a preset drink and bumps the revision', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const before = getRoomState(code, ALICE).rev;
    const drink = addDrink(code, ALICE, { kind: 'beer' });

    const state = getRoomState(code, ALICE);
    expect(state.drinks).toHaveLength(1);
    expect(state.rev).toBeGreaterThan(before);
    expect(drink.standardDrinks).toBeCloseTo(1, 2);
  });

  it('rejects drinks from non-members', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(() => addDrink(code, BOB, { kind: 'beer' })).toThrow(/Join the room/);
  });

  it('rejects unmeasurable drinks', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(() => addDrink(code, ALICE, { kind: 'nonsense' })).toThrow(RoomError);
    expect(() => addDrink(code, ALICE, { kind: 'custom' })).toThrow(RoomError);
  });

  it('clamps a future timestamp to now', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const now = Date.now();
    const drink = addDrink(code, ALICE, { kind: 'beer', consumedAt: now + 60 * 60_000 }, now);
    expect(drink.consumedAt).toBe(now);
  });

  it('clamps backdating to 24 hours', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const now = Date.now();
    const drink = addDrink(code, ALICE, { kind: 'beer', consumedAt: now - 72 * 3_600_000 }, now);
    expect(drink.consumedAt).toBe(now - 24 * 3_600_000);
  });

  it('lets a member undo their own drink', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const drink = addDrink(code, ALICE, { kind: 'beer' });
    removeDrink(code, ALICE, drink.id);
    expect(getRoomState(code, ALICE).drinks).toHaveLength(0);
  });

  it("refuses to undo someone else's drink", () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    const drink = addDrink(code, ALICE, { kind: 'beer' });
    expect(() => removeDrink(code, BOB, drink.id)).toThrow(RoomError);
    expect(getRoomState(code, ALICE).drinks).toHaveLength(1);
  });
});

describe('profiles', () => {
  it('ignores weights outside the range the model can use', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    updateProfile(code, ALICE, { weightKg: 5 });
    expect(getRoomState(code, ALICE).members[0]!.weightKg).toBeNull();
    updateProfile(code, ALICE, { weightKg: 82 });
    expect(getRoomState(code, ALICE).members[0]!.weightKg).toBe(82);
  });

  it('ignores an invalid sex value', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    updateProfile(code, ALICE, { sex: 'banana' as never });
    expect(getRoomState(code, ALICE).members[0]!.sex).toBe('unspecified');
  });

  it('redacts the inputs of a member who opted out of BAC sharing', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    updateProfile(code, ALICE, { weightKg: 70, sex: 'female', shareBac: false });

    const asBob = getRoomState(code, BOB).members.find((m) => m.id === ALICE)!;
    expect(asBob.weightKg).toBeNull();
    expect(asBob.sex).toBe('unspecified');
    expect(asBob.shareBac).toBe(false);

    const asAlice = getRoomState(code, ALICE).members.find((m) => m.id === ALICE)!;
    expect(asAlice.weightKg).toBe(70);
    expect(asAlice.sex).toBe('female');
  });

  it('keeps counts visible even when BAC is private', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    updateProfile(code, ALICE, { shareBac: false });
    addDrink(code, ALICE, { kind: 'beer' });
    expect(getRoomState(code, BOB).drinks).toHaveLength(1);
  });
});

describe('purgeStaleRooms', () => {
  it('removes idle rooms and their contents but keeps active ones', () => {
    const now = Date.now();
    const stale = createRoom(now - 72 * 3_600_000);
    joinRoom(stale, ALICE, 'Alice', now - 72 * 3_600_000);
    addDrink(stale, ALICE, { kind: 'beer' }, now - 72 * 3_600_000);

    const fresh = createRoom(now);
    joinRoom(fresh, BOB, 'Bob', now);

    expect(purgeStaleRooms(48, now)).toBe(1);
    expect(() => getRoomState(stale, ALICE)).toThrow(RoomError);
    expect(getRoomState(fresh, BOB).members).toHaveLength(1);
  });
});

describe('client ids', () => {
  it('echoes the client id back so an optimistic copy can be retired', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    addDrink(code, ALICE, { kind: 'beer', clientId: 'tmp-1' });
    expect(getRoomState(code, ALICE).drinks[0]!.clientId).toBe('tmp-1');
  });

  it('stores nothing for an absurd client id', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    addDrink(code, ALICE, { kind: 'beer', clientId: 'x'.repeat(500) });
    expect(getRoomState(code, ALICE).drinks[0]!.clientId).toBeNull();
  });
});

describe('matches', () => {
  function setupRoom() {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    joinRoom(code, CARA, 'Cara');
    joinRoom(code, DAVE, 'Dave');
    return code;
  }

  it('records a 1v1 result and bumps the revision', () => {
    const code = setupRoom();
    const before = getRoomState(code, ALICE).rev;
    const match = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
    });

    const state = getRoomState(code, ALICE);
    expect(state.matches).toHaveLength(1);
    expect(state.rev).toBeGreaterThan(before);
    expect(match.winnerIds).toEqual([ALICE]);
    expect(match.loserIds).toEqual([BOB]);
  });

  it('records a 2v2 team result', () => {
    const code = setupRoom();
    const match = reportMatch(code, ALICE, {
      gameKey: 'flip_cup',
      winnerIds: [ALICE, BOB],
      loserIds: [CARA, DAVE],
    });
    expect(match.winnerIds).toEqual([ALICE, BOB]);
    expect(match.loserIds).toEqual([CARA, DAVE]);
  });

  it('records a free-for-all result with no winner, just a loser', () => {
    const code = setupRoom();
    const match = reportMatch(code, ALICE, {
      gameKey: 'ring_of_fire',
      winnerIds: [],
      loserIds: [DAVE],
    });
    expect(match.winnerIds).toEqual([]);
    expect(match.loserIds).toEqual([DAVE]);
  });

  it('lets a bystander report a match they were not in', () => {
    const code = setupRoom();
    const match = reportMatch(code, DAVE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
    });
    expect(match.reportedBy).toBe(DAVE);
  });

  it('rejects an unknown game key', () => {
    const code = setupRoom();
    expect(() =>
      reportMatch(code, ALICE, { gameKey: 'chess', winnerIds: [ALICE], loserIds: [BOB] }),
    ).toThrow(RoomError);
  });

  it('rejects a winner or loser who is not a room member', () => {
    const code = setupRoom();
    expect(() =>
      reportMatch(code, ALICE, {
        gameKey: 'beer_pong',
        winnerIds: [ALICE],
        loserIds: [STRANGER],
      }),
    ).toThrow(RoomError);
    expect(() =>
      reportMatch(code, ALICE, {
        gameKey: 'beer_pong',
        winnerIds: [STRANGER],
        loserIds: [BOB],
      }),
    ).toThrow(RoomError);
  });

  it('rejects someone appearing on both sides of the same match', () => {
    const code = setupRoom();
    expect(() =>
      reportMatch(code, ALICE, {
        gameKey: 'beer_pong',
        winnerIds: [ALICE, BOB],
        loserIds: [BOB, CARA],
      }),
    ).toThrow(RoomError);
  });

  it('rejects a match with no losers', () => {
    const code = setupRoom();
    expect(() =>
      reportMatch(code, ALICE, { gameKey: 'beer_pong', winnerIds: [ALICE], loserIds: [] }),
    ).toThrow(RoomError);
  });

  it('rejects a report from someone not in the room', () => {
    const code = setupRoom();
    expect(() =>
      reportMatch(code, STRANGER, { gameKey: 'beer_pong', winnerIds: [ALICE], loserIds: [BOB] }),
    ).toThrow(RoomError);
  });

  it('de-duplicates repeated ids within a side', () => {
    const code = setupRoom();
    const match = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE, ALICE],
      loserIds: [BOB],
    });
    expect(match.winnerIds).toEqual([ALICE]);
  });

  it('trims and caps an optional note, storing null when blank', () => {
    const code = setupRoom();
    const withNote = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
      note: '  good game  ',
    });
    expect(withNote.note).toBe('good game');

    const blank = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
      note: '   ',
    });
    expect(blank.note).toBeNull();
  });

  it('lets the reporter retract their own match', () => {
    const code = setupRoom();
    const match = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
    });
    retractMatch(code, ALICE, match.id);
    expect(getRoomState(code, ALICE).matches).toHaveLength(0);
  });

  it("refuses to retract someone else's reported match", () => {
    const code = setupRoom();
    const match = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
    });
    expect(() => retractMatch(code, BOB, match.id)).toThrow(RoomError);
    expect(getRoomState(code, ALICE).matches).toHaveLength(1);
  });

  it('purges matches along with their room', () => {
    const now = Date.now();
    const code = createRoom(now - 72 * 3_600_000);
    joinRoom(code, ALICE, 'Alice', now - 72 * 3_600_000);
    joinRoom(code, BOB, 'Bob', now - 72 * 3_600_000);
    reportMatch(
      code,
      ALICE,
      { gameKey: 'beer_pong', winnerIds: [ALICE], loserIds: [BOB] },
      now - 72 * 3_600_000,
    );

    expect(purgeStaleRooms(48, now)).toBe(1);
    expect(() => getRoomState(code, ALICE)).toThrow(RoomError);
  });
});

describe('spectators', () => {
  it('gives every room a watch token that resolves back to it', () => {
    const code = createRoom();
    const token = getRoomState(code, null).watchToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(resolveWatchToken(token)).toBe(code);
  });

  it('returns null for an unknown token', () => {
    expect(resolveWatchToken('f'.repeat(32))).toBeNull();
  });

  it('never includes a code field a spectator could read', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const state = getWatchState(code);
    expect('code' in state).toBe(false);
  });

  it('applies the same shareBac redaction getRoomState does, for everyone', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    updateProfile(code, ALICE, { weightKg: 70, sex: 'female', shareBac: false });

    const watched = getWatchState(code).members.find((m) => m.id === ALICE)!;
    expect(watched.weightKg).toBeNull();
    expect(watched.sex).toBe('unspecified');

    // Unlike getRoomState, there is no viewerId a spectator could match — even
    // the member themselves looks redacted from the spectator's perspective,
    // because a spectator is never that member.
    updateProfile(code, ALICE, { shareBac: true });
    const shared = getWatchState(code).members.find((m) => m.id === ALICE)!;
    expect(shared.weightKg).toBe(70);
  });

  it('includes drinks and matches, same as a member sees', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    addDrink(code, ALICE, { kind: 'beer' });
    reportMatch(code, ALICE, { gameKey: 'beer_pong', winnerIds: [ALICE], loserIds: [BOB] });

    const state = getWatchState(code);
    expect(state.drinks).toHaveLength(1);
    expect(state.matches).toHaveLength(1);
  });

  it('throws for a room that no longer exists', () => {
    expect(() => getWatchState('ZZZZZZ')).toThrow(RoomError);
  });

  it('purges a watch token along with its room', () => {
    const now = Date.now();
    const code = createRoom(now - 72 * 3_600_000);
    const token = getRoomState(code, null).watchToken;

    expect(purgeStaleRooms(48, now)).toBe(1);
    expect(resolveWatchToken(token)).toBeNull();
  });
});

describe('closing', () => {
  it('starts open', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(getRoomState(code, ALICE).closedAt).toBeNull();
    expect(getWatchState(code).closedAt).toBeNull();
  });

  it('lets anyone in the room close it, and stamps who and when', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    const now = Date.now();
    closeRoom(code, BOB, now);

    expect(getRoomState(code, ALICE).closedAt).toBe(now);
    expect(getWatchState(code).closedAt).toBe(now);
  });

  it('rejects closing from someone not in the room', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(() => closeRoom(code, STRANGER)).toThrow(RoomError);
    expect(getRoomState(code, ALICE).closedAt).toBeNull();
  });

  it('is idempotent — closing an already-closed room keeps the original timestamp', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    const first = Date.now();
    closeRoom(code, ALICE, first);
    closeRoom(code, ALICE, first + 60_000);
    expect(getRoomState(code, ALICE).closedAt).toBe(first);
  });

  it('freezes drinks, undo, game reports and retractions while closed', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    const drink = addDrink(code, ALICE, { kind: 'beer' });
    const match = reportMatch(code, ALICE, {
      gameKey: 'beer_pong',
      winnerIds: [ALICE],
      loserIds: [BOB],
    });
    closeRoom(code, ALICE);

    expect(() => addDrink(code, ALICE, { kind: 'beer' })).toThrow(/closed/);
    expect(() => removeDrink(code, ALICE, drink.id)).toThrow(/closed/);
    expect(() =>
      reportMatch(code, ALICE, { gameKey: 'beer_pong', winnerIds: [ALICE], loserIds: [BOB] }),
    ).toThrow(/closed/);
    expect(() => retractMatch(code, ALICE, match.id)).toThrow(/closed/);

    // Nothing was actually removed by the rejected calls.
    const state = getRoomState(code, ALICE);
    expect(state.drinks).toHaveLength(1);
    expect(state.matches).toHaveLength(1);
  });

  it('lets anyone reopen a closed room, unfreezing it', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    closeRoom(code, ALICE);

    reopenRoom(code, BOB);
    expect(getRoomState(code, ALICE).closedAt).toBeNull();
    expect(() => addDrink(code, ALICE, { kind: 'beer' })).not.toThrow();
  });

  it('rejects reopening from someone not in the room', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    closeRoom(code, ALICE);
    expect(() => reopenRoom(code, STRANGER)).toThrow(RoomError);
    expect(getRoomState(code, ALICE).closedAt).not.toBeNull();
  });

  it('is a no-op to reopen a room that is already open', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(() => reopenRoom(code, ALICE)).not.toThrow();
    expect(getRoomState(code, ALICE).closedAt).toBeNull();
  });

  it('purges a closure along with its room', () => {
    const now = Date.now();
    const code = createRoom(now - 72 * 3_600_000);
    joinRoom(code, ALICE, 'Alice', now - 72 * 3_600_000);
    closeRoom(code, ALICE, now - 72 * 3_600_000);

    expect(purgeStaleRooms(48, now)).toBe(1);
    expect(() => getRoomState(code, ALICE)).toThrow(RoomError);
  });
});

describe('naming', () => {
  it('starts with no name', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(getRoomState(code, ALICE).name).toBeNull();
    expect(getWatchState(code).name).toBeNull();
  });

  it('can be named at creation, trimmed and capped', () => {
    const code = createRoom(Date.now(), `  Jake's ${'birthday '.repeat(10)} `);
    joinRoom(code, ALICE, 'Alice');
    const name = getRoomState(code, ALICE).name!;
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.startsWith("Jake's")).toBe(true);
    expect(name.endsWith(' ')).toBe(false);
  });

  it('ignores a blank name at creation', () => {
    const code = createRoom(Date.now(), '   ');
    joinRoom(code, ALICE, 'Alice');
    expect(getRoomState(code, ALICE).name).toBeNull();
  });

  it('lets anyone in the room rename it, and the change shows to everyone', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    joinRoom(code, BOB, 'Bob');
    renameRoom(code, BOB, 'Game night');

    expect(getRoomState(code, ALICE).name).toBe('Game night');
    expect(getWatchState(code).name).toBe('Game night');
  });

  it('rejects renaming from someone not in the room', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    expect(() => renameRoom(code, STRANGER, 'Nope')).toThrow(RoomError);
    expect(getRoomState(code, ALICE).name).toBeNull();
  });

  it('clears the name back to null with a blank rename', () => {
    const code = createRoom(Date.now(), 'Game night');
    joinRoom(code, ALICE, 'Alice');
    renameRoom(code, ALICE, '   ');
    expect(getRoomState(code, ALICE).name).toBeNull();
  });

  it('works even while the room is closed — a label is not part of the frozen log', () => {
    const code = createRoom();
    joinRoom(code, ALICE, 'Alice');
    closeRoom(code, ALICE);
    expect(() => renameRoom(code, ALICE, 'Game night')).not.toThrow();
    expect(getRoomState(code, ALICE).name).toBe('Game night');
  });

  it('purges a name along with its room', () => {
    const now = Date.now();
    const code = createRoom(now - 72 * 3_600_000, 'Game night');
    joinRoom(code, ALICE, 'Alice', now - 72 * 3_600_000);

    expect(purgeStaleRooms(48, now)).toBe(1);
    expect(() => getRoomState(code, ALICE)).toThrow(RoomError);
  });
});
