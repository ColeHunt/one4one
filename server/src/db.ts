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
  migrateMemberRoomScoping(instance);

  instance.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      code           TEXT PRIMARY KEY,
      rev            INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    );

    -- id is a device's bearer token, reused across every room it ever joins —
    -- so it is NOT globally unique, only unique per room. See
    -- migrateMemberRoomScoping() below for why this can't just be the column
    -- list on a fresh CREATE TABLE.
    CREATE TABLE IF NOT EXISTS members (
      id         TEXT NOT NULL,
      room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      weight_kg  REAL,
      sex        TEXT NOT NULL DEFAULT 'unspecified',
      share_bac  INTEGER NOT NULL DEFAULT 1,
      joined_at  INTEGER NOT NULL,
      UNIQUE (id, room_code)
    );

    CREATE INDEX IF NOT EXISTS idx_members_room ON members(room_code);

    CREATE TABLE IF NOT EXISTS drinks (
      id          TEXT PRIMARY KEY,
      room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      member_id   TEXT NOT NULL,
      kind        TEXT NOT NULL,
      std_drinks  REAL NOT NULL,
      volume_ml   REAL,
      abv         REAL,
      consumed_at INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      client_id   TEXT,
      FOREIGN KEY (member_id, room_code) REFERENCES members(id, room_code) ON DELETE CASCADE
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
      reported_by TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (reported_by, room_code) REFERENCES members(id, room_code) ON DELETE CASCADE
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

/**
 * One-time upgrade for a database created before members.id became scoped
 * per room instead of global. The original schema made id a bare PRIMARY
 * KEY, so a device that had ever joined one room could not join or create a
 * second one — id already existed — until the first room aged out (up to
 * config.roomTtlHours later). Fixing that means id has to stop being unique
 * on its own, which the members/drinks/matches CREATE TABLE IF NOT EXISTS
 * statements above can't do for a database where those tables already exist
 * in the old shape: IF NOT EXISTS is a no-op there, and SQLite won't let a
 * foreign key reference a column that isn't unique, so drinks/matches need
 * rebuilding right alongside members or every future insert into them would
 * fail with "foreign key mismatch". A brand-new database never has the old
 * shape, so this is a no-op there and the statements above create the
 * corrected tables directly.
 */
function migrateMemberRoomScoping(instance: Db): void {
  const columns = instance.prepare("PRAGMA table_info('members')").all() as { name: string; pk: number }[];
  const idColumn = columns.find((column) => column.name === 'id');
  if (!idColumn || idColumn.pk !== 1) return;

  // A parent table's schema can only be rebuilt with foreign key enforcement
  // off, and SQLite refuses to toggle that pragma inside a transaction.
  instance.pragma('foreign_keys = OFF');
  const upgrade = instance.transaction(() => {
    instance.exec(`
      ALTER TABLE members RENAME TO members_pre_scoping;
      ALTER TABLE drinks RENAME TO drinks_pre_scoping;
      ALTER TABLE matches RENAME TO matches_pre_scoping;

      CREATE TABLE members (
        id         TEXT NOT NULL,
        room_code  TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        color      TEXT NOT NULL,
        weight_kg  REAL,
        sex        TEXT NOT NULL DEFAULT 'unspecified',
        share_bac  INTEGER NOT NULL DEFAULT 1,
        joined_at  INTEGER NOT NULL,
        UNIQUE (id, room_code)
      );

      CREATE TABLE drinks (
        id          TEXT PRIMARY KEY,
        room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        member_id   TEXT NOT NULL,
        kind        TEXT NOT NULL,
        std_drinks  REAL NOT NULL,
        volume_ml   REAL,
        abv         REAL,
        consumed_at INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        client_id   TEXT,
        FOREIGN KEY (member_id, room_code) REFERENCES members(id, room_code) ON DELETE CASCADE
      );

      CREATE TABLE matches (
        id          TEXT PRIMARY KEY,
        room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        game_key    TEXT NOT NULL,
        winner_ids  TEXT NOT NULL,
        loser_ids   TEXT NOT NULL,
        note        TEXT,
        played_at   INTEGER NOT NULL,
        reported_by TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (reported_by, room_code) REFERENCES members(id, room_code) ON DELETE CASCADE
      );

      INSERT INTO members SELECT * FROM members_pre_scoping;
      INSERT INTO drinks SELECT * FROM drinks_pre_scoping;
      INSERT INTO matches SELECT * FROM matches_pre_scoping;

      DROP TABLE members_pre_scoping;
      DROP TABLE drinks_pre_scoping;
      DROP TABLE matches_pre_scoping;
    `);
  });
  upgrade();
  instance.pragma('foreign_keys = ON');
}
