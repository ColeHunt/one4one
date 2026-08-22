import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, setDb } from '../src/db.js';
import { isValidRoomCode, normaliseRoomCode } from '../src/ids.js';
import {
  RoomError,
  addDrink,
  createRoom,
  getRoomState,
  joinRoom,
  purgeStaleRooms,
  removeDrink,
  reportMatch,
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
