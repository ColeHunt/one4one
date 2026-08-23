import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

export type Db = Database.Database;

let db: Db | null = null;

export function openDb(file?: string): Db {
  const target = file ?? path.join(config.dataDir, 'one4one.sqlite');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });

  const instance = new Database(target);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  migrate(instance);
  return instance;
}

export function getDb(): Db {
  if (!db) db = openDb();
  return db;
}

export function setDb(instance: Db): void {
  db = instance;
}

function migrate(instance: Db): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code           TEXT PRIMARY KEY,
      rev            INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      id         TEXT PRIMARY KEY,
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      weight_kg  REAL,
      sex        TEXT NOT NULL DEFAULT 'unspecified',
      share_bac  INTEGER NOT NULL DEFAULT 1,
      joined_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_code);

    CREATE TABLE IF NOT EXISTS drinks (
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

    CREATE INDEX IF NOT EXISTS idx_drinks_room ON drinks(room_code, consumed_at);

    CREATE TABLE IF NOT EXISTS matches (
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

    CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room_code, played_at);

    CREATE TABLE IF NOT EXISTS room_watch_tokens (
      token      TEXT PRIMARY KEY,
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_watch_tokens_room ON room_watch_tokens(room_code);

    -- Presence of a row means the room is closed. A new table rather than a
    -- column on rooms — migrate() here only ever CREATEs, it cannot ALTER an
    -- existing table, so every schema change since the first release has used
    -- this pattern instead of adding a column.
    CREATE TABLE IF NOT EXISTS room_closures (
      room_code  TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      closed_at  INTEGER NOT NULL,
      closed_by  TEXT
    );

    -- Presence of a row means the room has a custom name; absence falls back
    -- to just the code, same idiom as room_closures.
    CREATE TABLE IF NOT EXISTS room_names (
      room_code  TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
