import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, setDb } from '../src/db.js';
import {
  createRoom as freshCreateRoom,
  getRoomState,
  joinRoom,
  purgeStaleRooms,
} from '../src/rooms.js';

/**
 * Builds a database file in the pre-scoping shape — members.id as a bare
 * PRIMARY KEY, drinks/matches referencing it by that single column — the
 * exact shape every database created before this fix already has on disk.
 * migrateMemberRoomScoping() (in db.ts) only runs against a database that
 * still looks like this, so these tests are the only way to exercise it: a
 * fresh :memory: database (what every other test in this suite uses) always
 * starts in the current shape and never touches that path.
 */
function seedPreScopingDb(file: string): void {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE rooms (
      code           TEXT PRIMARY KEY,
      rev            INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );
    CREATE TABLE members (
      id         TEXT PRIMARY KEY,
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      weight_kg  REAL,
      sex        TEXT NOT NULL DEFAULT 'unspecified',
      share_bac  INTEGER NOT NULL DEFAULT 1,
      joined_at  INTEGER NOT NULL
    );
    CREATE TABLE drinks (
      id          TEXT PRIMARY KEY,
      room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      std_drinks  REAL NOT NULL,
      volume_ml   REAL,
      abv         REAL,
      consumed_at INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      client_id   TEXT
    );
    CREATE TABLE matches (
      id          TEXT PRIMARY KEY,
      room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      game_key    TEXT NOT NULL,
      winner_ids  TEXT NOT NULL,
      loser_ids   TEXT NOT NULL,
      note        TEXT,
      played_at   INTEGER NOT NULL,
      reported_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL
    );
  `);

  const now = Date.now();
  db.prepare('INSERT INTO rooms (code, rev, created_at, last_active_at) VALUES (?, 0, ?, ?)').run(
    'OLDRM1',
    now,
    now,
  );
  db.prepare(
    `INSERT INTO members (id, room_code, name, color, weight_kg, sex, share_bac, joined_at)
     VALUES (?, ?, 'Alice', '#3987e5', 70, 'female', 1, ?)`,
  ).run('a'.repeat(32), 'OLDRM1', now);
  db.prepare(
    `INSERT INTO drinks (id, room_code, member_id, kind, std_drinks, volume_ml, abv, consumed_at, created_at, client_id)
     VALUES (?, 'OLDRM1', ?, 'beer', 1, 355, 0.05, ?, ?, NULL)`,
  ).run('drink1', 'a'.repeat(32), now, now);
  db.prepare(
    `INSERT INTO matches (id, room_code, game_key, winner_ids, loser_ids, note, played_at, reported_by, created_at)
     VALUES (?, 'OLDRM1', 'beer_pong', '["${'a'.repeat(32)}"]', '["b"]', NULL, ?, ?, ?)`,
  ).run('match1', now, 'a'.repeat(32), now);

  db.close();
}

let tmpFile: string | null = null;

afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
  tmpFile = null;
});

describe('upgrading a pre-scoping database', () => {
  it('preserves existing rooms, members, drinks and matches', () => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one4one-migration-')), 'test.sqlite');
    seedPreScopingDb(tmpFile);

    const db = openDb(tmpFile);
    setDb(db);

    const state = getRoomState('OLDRM1', 'a'.repeat(32));
    expect(state.members).toHaveLength(1);
    expect(state.members[0]!.name).toBe('Alice');
    expect(state.members[0]!.weightKg).toBe(70);
    expect(state.drinks).toHaveLength(1);
    expect(state.drinks[0]!.kind).toBe('beer');
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0]!.gameKey).toBe('beer_pong');
  });

  it('is idempotent — migrating an already-upgraded database is a no-op', () => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one4one-migration-')), 'test.sqlite');
    seedPreScopingDb(tmpFile);

    openDb(tmpFile).close();
    const db = openDb(tmpFile);
    setDb(db);

    const state = getRoomState('OLDRM1', 'a'.repeat(32));
    expect(state.members).toHaveLength(1);
    expect(state.drinks).toHaveLength(1);
  });

  it('lets the same device join a second room after the upgrade — the bug this fixes', () => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one4one-migration-')), 'test.sqlite');
    seedPreScopingDb(tmpFile);

    const db = openDb(tmpFile);
    setDb(db);

    const alice = 'a'.repeat(32);
    const secondRoom = freshCreateRoom();
    expect(() => joinRoom(secondRoom, alice, 'Alice')).not.toThrow();
    expect(getRoomState(secondRoom, alice).members).toHaveLength(1);
    // The original room's membership is untouched.
    expect(getRoomState('OLDRM1', alice).members).toHaveLength(1);
  });

  it('renaming on rejoin only affects the room being rejoined, not a sibling', () => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one4one-migration-')), 'test.sqlite');
    seedPreScopingDb(tmpFile);

    const db = openDb(tmpFile);
    setDb(db);

    const alice = 'a'.repeat(32);
    const secondRoom = freshCreateRoom();
    joinRoom(secondRoom, alice, 'Alice');
    joinRoom(secondRoom, alice, 'Ali');

    expect(getRoomState(secondRoom, alice).members[0]!.name).toBe('Ali');
    expect(getRoomState('OLDRM1', alice).members[0]!.name).toBe('Alice');
  });

  it('still enforces drinks/matches cascading when a room is purged after the upgrade', () => {
    tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'one4one-migration-')), 'test.sqlite');
    seedPreScopingDb(tmpFile);

    const db = openDb(tmpFile);
    setDb(db);
    db.prepare('UPDATE rooms SET last_active_at = ? WHERE code = ?').run(Date.now() - 72 * 3_600_000, 'OLDRM1');

    expect(purgeStaleRooms(48)).toBe(1);
    expect(() => getRoomState('OLDRM1', 'a'.repeat(32))).toThrow();
  });
});
