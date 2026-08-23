import { config } from './config.js';
import { getDb } from './db.js';
import { generateId, generateRoomCode } from './ids.js';
import { resolveStandardDrinks } from '../../shared/src/drinks.js';
import { getGameType } from '../../shared/src/games.js';
import type {
  Drink,
  Match,
  Member,
  NewDrink,
  NewMatch,
  ProfilePatch,
  RoomState,
  Sex,
  WatchState,
} from '../../shared/src/types.js';

/**
 * Categorical slots assigned in join order. The order is the colourblind-safety
 * mechanism, not decoration: these eight steps clear the adjacent-pair CVD and
 * normal-vision gates against the app's dark surface, so they must not be
 * reordered or extended without re-validating.
 */
export const MEMBER_COLORS = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
];

export class RoomError extends Error {
  constructor(
    readonly code:
      | 'room_not_found'
      | 'room_full'
      | 'not_joined'
      | 'bad_request'
      | 'too_many_drinks'
      | 'too_many_matches'
      | 'room_closed',
    message: string,
  ) {
    super(message);
  }
}

const MAX_NAME_LENGTH = 24;

export function sanitiseName(input: unknown): string {
  const name = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
  return name.slice(0, MAX_NAME_LENGTH) || 'Someone';
}

const MAX_ROOM_NAME_LENGTH = 40;

/** Unlike a member's name, a room name is optional — null clears it back to just the code. */
export function sanitiseRoomName(input: unknown): string | null {
  const name = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
  return name ? name.slice(0, MAX_ROOM_NAME_LENGTH) : null;
}

function touch(code: string, now: number): number {
  const db = getDb();
  db.prepare('UPDATE rooms SET rev = rev + 1, last_active_at = ? WHERE code = ?').run(now, code);
  const row = db.prepare('SELECT rev FROM rooms WHERE code = ?').get(code) as
    | { rev: number }
    | undefined;
  return row?.rev ?? 0;
}

function closedAtFor(code: string): number | null {
  const row = getDb().prepare('SELECT closed_at FROM room_closures WHERE room_code = ?').get(code) as
    | { closed_at: number }
    | undefined;
  return row?.closed_at ?? null;
}

/** Rejects a mutation once the room has been closed — reopen it first. */
function requireOpen(code: string): void {
  if (closedAtFor(code) != null) {
    throw new RoomError('room_closed', 'This room is closed. Reopen it to keep logging.');
  }
}

/**
 * Closes a room, freezing new drinks and game reports. Anyone in the room can
 * close it — there is no "host" concept in this app, the same honor-system
 * trust reportMatch/removeDrink already run on. Idempotent: closing an
 * already-closed room is a no-op rather than an error.
 */
export function closeRoom(code: string, memberId: string, now = Date.now()): void {
  if (!isMember(code, memberId)) throw new RoomError('not_joined', 'Join the room first');
  getDb()
    .prepare(
      `INSERT INTO room_closures (room_code, closed_at, closed_by) VALUES (?, ?, ?)
       ON CONFLICT(room_code) DO NOTHING`,
    )
    .run(code, now, memberId);
  touch(code, now);
}

/** Reopens a closed room. Anyone in the room can — a mis-tap isn't a dead end. */
export function reopenRoom(code: string, memberId: string, now = Date.now()): void {
  if (!isMember(code, memberId)) throw new RoomError('not_joined', 'Join the room first');
  getDb().prepare('DELETE FROM room_closures WHERE room_code = ?').run(code);
  touch(code, now);
}

function roomNameFor(code: string): string | null {
  const row = getDb().prepare('SELECT name FROM room_names WHERE room_code = ?').get(code) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

function setRoomName(code: string, name: string | null): void {
  const db = getDb();
  if (name == null) {
    db.prepare('DELETE FROM room_names WHERE room_code = ?').run(code);
    return;
  }
  db.prepare(
    `INSERT INTO room_names (room_code, name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(room_code) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  ).run(code, name, Date.now());
}

/**
 * Renames a room, or clears its name back to just the code with a blank
 * input. Anyone in the room can — a label like this is cosmetic, not part of
 * the frozen log, so it works even while the room is closed.
 */
export function renameRoom(code: string, memberId: string, name: string, now = Date.now()): void {
  if (!isMember(code, memberId)) throw new RoomError('not_joined', 'Join the room first');
  setRoomName(code, sanitiseRoomName(name));
  touch(code, now);
}

export function createRoom(now = Date.now(), name?: string): string {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateRoomCode();
    const existing = db.prepare('SELECT code FROM rooms WHERE code = ?').get(code);
    if (existing) continue;
    db.prepare(
      'INSERT INTO rooms (code, rev, created_at, last_active_at) VALUES (?, 0, ?, ?)',
    ).run(code, now, now);
    // One watch token per room, for the lifetime of the room — a spectator link
    // that never resolves to the room code on the client, only on the server.
    db.prepare('INSERT INTO room_watch_tokens (token, room_code, created_at) VALUES (?, ?, ?)').run(
      generateId(),
      code,
      now,
    );
    const cleanName = sanitiseRoomName(name);
    if (cleanName) setRoomName(code, cleanName);
    return code;
  }
  throw new RoomError('bad_request', 'Could not allocate a room code');
}

export function roomExists(code: string): boolean {
  return Boolean(getDb().prepare('SELECT code FROM rooms WHERE code = ?').get(code));
}

/** Looks up the room a watch token belongs to. Null for an unknown or expired token. */
export function resolveWatchToken(token: string): string | null {
  const row = getDb()
    .prepare('SELECT room_code FROM room_watch_tokens WHERE token = ?')
    .get(token) as { room_code: string } | undefined;
  return row?.room_code ?? null;
}

function watchTokenFor(code: string): string {
  const row = getDb()
    .prepare('SELECT token FROM room_watch_tokens WHERE room_code = ?')
    .get(code) as { token: string } | undefined;
  // Every room gets a token at creation, so this should always be found; the
  // fallback only matters for a room created before this feature existed.
  if (row) return row.token;
  const token = generateId();
  getDb()
    .prepare('INSERT INTO room_watch_tokens (token, room_code, created_at) VALUES (?, ?, ?)')
    .run(token, code, Date.now());
  return token;
}

/**
 * Join `code` as `memberId`, creating the member if this device has not been
 * seen before. Returns the member. Re-joining is idempotent and keeps the
 * member's existing profile.
 */
export function joinRoom(
  code: string,
  memberId: string,
  name: string,
  now = Date.now(),
): Member {
  const db = getDb();
  if (!roomExists(code)) throw new RoomError('room_not_found', 'That room code does not exist');

  const existing = db
    .prepare('SELECT * FROM members WHERE id = ? AND room_code = ?')
    .get(memberId, code) as MemberRow | undefined;

  if (existing) {
    const cleanName = sanitiseName(name);
    if (cleanName !== existing.name) {
      // Scoped to this room too — id alone is a device's bearer token, not a
      // unique row, so without room_code this would also rename that device
      // in every other room it has joined.
      db.prepare('UPDATE members SET name = ? WHERE id = ? AND room_code = ?').run(
        cleanName,
        memberId,
        code,
      );
      existing.name = cleanName;
    }
    touch(code, now);
    return toMember(existing);
  }

  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM members WHERE room_code = ?').get(code) as { n: number }
  ).n;
  if (count >= config.maxMembersPerRoom) {
    throw new RoomError('room_full', 'This room is full');
  }

  const color = MEMBER_COLORS[count % MEMBER_COLORS.length]!;
  db.prepare(
    `INSERT INTO members (id, room_code, name, color, weight_kg, sex, share_bac, joined_at)
     VALUES (?, ?, ?, ?, NULL, 'unspecified', 1, ?)`,
  ).run(memberId, code, sanitiseName(name), color, now);
  touch(code, now);

  return {
    id: memberId,
    name: sanitiseName(name),
    color,
    weightKg: null,
    sex: 'unspecified',
    shareBac: true,
    joinedAt: now,
  };
}

export function isMember(code: string, memberId: string): boolean {
  return Boolean(
    getDb().prepare('SELECT id FROM members WHERE id = ? AND room_code = ?').get(memberId, code),
  );
}

export function addDrink(
  code: string,
  memberId: string,
  input: NewDrink,
  now = Date.now(),
): Drink {
  const db = getDb();
  if (!isMember(code, memberId)) throw new RoomError('not_joined', 'Join the room first');
  requireOpen(code);

  const kind = typeof input.kind === 'string' ? input.kind : '';
  const volumeMl = numberOrNull(input.volumeMl);
  const abv = numberOrNull(input.abv);
  const standardDrinks = resolveStandardDrinks(kind, volumeMl, abv);
  if (standardDrinks == null || standardDrinks <= 0 || standardDrinks > 20) {
    throw new RoomError('bad_request', 'That is not a drink we can measure');
  }

  // Backdating is allowed within the last 24h; future timestamps are not.
  const requested = numberOrNull(input.consumedAt) ?? now;
  const consumedAt = Math.min(Math.max(requested, now - 24 * 3_600_000), now);

  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM drinks WHERE room_code = ?').get(code) as { n: number }
  ).n;
  if (total >= config.maxDrinksPerRoom) {
    throw new RoomError('too_many_drinks', 'This room has logged too many drinks');
  }

  const id = generateId();
  const clientId =
    typeof input.clientId === 'string' && input.clientId.length <= 64 ? input.clientId : null;
  db.prepare(
    `INSERT INTO drinks (id, room_code, member_id, kind, std_drinks, volume_ml, abv, consumed_at, created_at, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, code, memberId, kind, standardDrinks, volumeMl, abv, consumedAt, now, clientId);
  touch(code, now);

  return { id, memberId, kind, standardDrinks, volumeMl, abv, consumedAt, clientId };
}

/** Removes a drink. A member may only remove their own. */
export function removeDrink(
  code: string,
  memberId: string,
  drinkId: string,
  now = Date.now(),
): void {
  const db = getDb();
  requireOpen(code);
  const result = db
    .prepare('DELETE FROM drinks WHERE id = ? AND room_code = ? AND member_id = ?')
    .run(drinkId, code, memberId);
  if (result.changes === 0) throw new RoomError('bad_request', 'That drink is not yours to remove');
  touch(code, now);
}

const MAX_NOTE_LENGTH = 140;
/** A match with more people than this on one side is almost certainly a mis-tap. */
const MAX_PARTICIPANTS_PER_SIDE = 8;

/**
 * Records a match result. The reporter only needs to be in the room — not a
 * participant — so a bystander can report a game two other people just
 * played, the same honor-system trust the rest of the app already runs on.
 */
export function reportMatch(
  code: string,
  reporterId: string,
  input: NewMatch,
  now = Date.now(),
): Match {
  const db = getDb();
  if (!isMember(code, reporterId)) throw new RoomError('not_joined', 'Join the room first');
  requireOpen(code);

  const gameKey = typeof input.gameKey === 'string' ? input.gameKey : '';
  if (!getGameType(gameKey)) throw new RoomError('bad_request', "That's not a game we know");

  const winnerIds = uniqueIds(input.winnerIds);
  const loserIds = uniqueIds(input.loserIds);
  if (loserIds.length === 0) {
    throw new RoomError('bad_request', 'A match needs at least one loser');
  }
  if (winnerIds.length > MAX_PARTICIPANTS_PER_SIDE || loserIds.length > MAX_PARTICIPANTS_PER_SIDE) {
    throw new RoomError('bad_request', 'That is too many people for one match');
  }
  if (winnerIds.some((id) => loserIds.includes(id))) {
    throw new RoomError('bad_request', "Someone can't be on both sides of the same match");
  }
  for (const id of [...winnerIds, ...loserIds]) {
    if (!isMember(code, id)) throw new RoomError('bad_request', "That's not someone in this room");
  }

  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM matches WHERE room_code = ?').get(code) as { n: number }
  ).n;
  if (total >= config.maxMatchesPerRoom) {
    throw new RoomError('too_many_matches', 'This room has logged too many games');
  }

  const note =
    typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE_LENGTH) || null : null;

  const id = generateId();
  db.prepare(
    `INSERT INTO matches (id, room_code, game_key, winner_ids, loser_ids, note, played_at, reported_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, code, gameKey, JSON.stringify(winnerIds), JSON.stringify(loserIds), note, now, reporterId, now);
  touch(code, now);

  return { id, gameKey, winnerIds, loserIds, note, playedAt: now, reportedBy: reporterId };
}

/** Retracts a match. Only whoever reported it can — the same rule removeDrink enforces. */
export function retractMatch(
  code: string,
  memberId: string,
  matchId: string,
  now = Date.now(),
): void {
  const db = getDb();
  requireOpen(code);
  const result = db
    .prepare('DELETE FROM matches WHERE id = ? AND room_code = ? AND reported_by = ?')
    .run(matchId, code, memberId);
  if (result.changes === 0) {
    throw new RoomError('bad_request', 'That match is not yours to retract');
  }
  touch(code, now);
}

function uniqueIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const value of input) {
    if (typeof value === 'string') seen.add(value);
  }
  return [...seen];
}

const SEXES: Sex[] = ['male', 'female', 'unspecified'];

export function updateProfile(
  code: string,
  memberId: string,
  patch: ProfilePatch,
  now = Date.now(),
): void {
  const db = getDb();
  if (!isMember(code, memberId)) throw new RoomError('not_joined', 'Join the room first');

  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(sanitiseName(patch.name));
  }
  if (patch.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(String(patch.color))) {
    sets.push('color = ?');
    values.push(String(patch.color));
  }
  if (patch.weightKg !== undefined) {
    const weight = numberOrNull(patch.weightKg);
    // Outside this range the Widmark model is meaningless, so store nothing.
    const valid = weight != null && weight >= 25 && weight <= 400 ? weight : null;
    sets.push('weight_kg = ?');
    values.push(valid);
  }
  if (patch.sex !== undefined && SEXES.includes(patch.sex)) {
    sets.push('sex = ?');
    values.push(patch.sex);
  }
  if (patch.shareBac !== undefined) {
    sets.push('share_bac = ?');
    values.push(patch.shareBac ? 1 : 0);
  }

  if (sets.length === 0) return;
  values.push(memberId, code);
  db.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ? AND room_code = ?`).run(...values);
  touch(code, now);
}

/**
 * Full room snapshot. Rooms are small, so the server broadcasts the whole state
 * on every change rather than patching — it removes a class of divergence bugs.
 *
 * `viewerId` controls BAC privacy: a member who has turned off sharing has their
 * weight and sex redacted for everyone but themselves, so other clients cannot
 * recompute the estimate they chose not to share.
 */
export function getRoomState(code: string, viewerId: string | null): RoomState {
  const db = getDb();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as RoomRow | undefined;
  if (!room) throw new RoomError('room_not_found', 'That room code does not exist');

  const memberRows = db
    .prepare('SELECT * FROM members WHERE room_code = ? ORDER BY joined_at ASC')
    .all(code) as MemberRow[];
  const drinkRows = db
    .prepare('SELECT * FROM drinks WHERE room_code = ? ORDER BY consumed_at ASC')
    .all(code) as DrinkRow[];
  const matchRows = db
    .prepare('SELECT * FROM matches WHERE room_code = ? ORDER BY played_at ASC')
    .all(code) as MatchRow[];

  return {
    code: room.code,
    rev: room.rev,
    createdAt: room.created_at,
    members: memberRows.map((row) => {
      const member = toMember(row);
      if (!member.shareBac && member.id !== viewerId) {
        return { ...member, weightKg: null, sex: 'unspecified' };
      }
      return member;
    }),
    drinks: drinkRows.map(toDrink),
    matches: matchRows.map(toMatch),
    watchToken: watchTokenFor(code),
    closedAt: closedAtFor(code),
    name: roomNameFor(code),
  };
}

/**
 * A spectator's view. Deliberately not "getRoomState with a field removed" —
 * there is no `code` anywhere in this function's return value or in WatchState
 * itself, so there is nothing for a future refactor to accidentally leak to
 * someone who only ever held a watch link. `viewerId` is always null: a
 * spectator has no identity in the room, the same as anyone who hasn't opted
 * a member out of BAC sharing would see.
 */
export function getWatchState(code: string): WatchState {
  const db = getDb();
  const room = db.prepare('SELECT rev FROM rooms WHERE code = ?').get(code) as
    | { rev: number }
    | undefined;
  if (!room) throw new RoomError('room_not_found', 'That room code does not exist');

  const memberRows = db
    .prepare('SELECT * FROM members WHERE room_code = ? ORDER BY joined_at ASC')
    .all(code) as MemberRow[];
  const drinkRows = db
    .prepare('SELECT * FROM drinks WHERE room_code = ? ORDER BY consumed_at ASC')
    .all(code) as DrinkRow[];
  const matchRows = db
    .prepare('SELECT * FROM matches WHERE room_code = ? ORDER BY played_at ASC')
    .all(code) as MatchRow[];

  return {
    rev: room.rev,
    members: memberRows.map((row) => {
      const member = toMember(row);
      if (!member.shareBac) return { ...member, weightKg: null, sex: 'unspecified' };
      return member;
    }),
    drinks: drinkRows.map(toDrink),
    matches: matchRows.map(toMatch),
    closedAt: closedAtFor(code),
    name: roomNameFor(code),
  };
}

/** Deletes rooms that have seen no activity for `ttlHours`. Returns the count. */
export function purgeStaleRooms(ttlHours = config.roomTtlHours, now = Date.now()): number {
  const cutoff = now - ttlHours * 3_600_000;
  const db = getDb();
  // Children are removed explicitly: SQLite only cascades when the pragma is on
  // for the connection doing the delete, and this also runs from the cron path.
  db.prepare('DELETE FROM drinks WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  db.prepare('DELETE FROM matches WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  db.prepare('DELETE FROM room_watch_tokens WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  db.prepare('DELETE FROM room_closures WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  db.prepare('DELETE FROM room_names WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  db.prepare('DELETE FROM members WHERE room_code IN (SELECT code FROM rooms WHERE last_active_at < ?)')
    .run(cutoff);
  return db.prepare('DELETE FROM rooms WHERE last_active_at < ?').run(cutoff).changes;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RoomRow {
  code: string;
  rev: number;
  created_at: number;
  last_active_at: number;
}

interface MemberRow {
  id: string;
  room_code: string;
  name: string;
  color: string;
  weight_kg: number | null;
  sex: string;
  share_bac: number;
  joined_at: number;
}

interface DrinkRow {
  id: string;
  member_id: string;
  kind: string;
  std_drinks: number;
  volume_ml: number | null;
  abv: number | null;
  consumed_at: number;
  client_id: string | null;
}

interface MatchRow {
  id: string;
  game_key: string;
  winner_ids: string;
  loser_ids: string;
  note: string | null;
  played_at: number;
  reported_by: string;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    weightKg: row.weight_kg,
    sex: (SEXES.includes(row.sex as Sex) ? row.sex : 'unspecified') as Sex,
    shareBac: row.share_bac === 1,
    joinedAt: row.joined_at,
  };
}

function toDrink(row: DrinkRow): Drink {
  return {
    id: row.id,
    memberId: row.member_id,
    kind: row.kind,
    standardDrinks: row.std_drinks,
    volumeMl: row.volume_ml,
    abv: row.abv,
    consumedAt: row.consumed_at,
    clientId: row.client_id,
  };
}

function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    gameKey: row.game_key,
    winnerIds: JSON.parse(row.winner_ids) as string[],
    loserIds: JSON.parse(row.loser_ids) as string[],
    note: row.note,
    playedAt: row.played_at,
    reportedBy: row.reported_by,
  };
}
