import { config } from './config.js';
import { getDb } from './db.js';
import { generateId, generateRoomCode } from './ids.js';
import { resolveStandardDrinks } from '../../shared/src/drinks.js';
import type {
  Drink,
  Member,
  NewDrink,
  ProfilePatch,
  RoomState,
  Sex,
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
      | 'too_many_drinks',
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

function touch(code: string, now: number): number {
  const db = getDb();
  db.prepare('UPDATE rooms SET rev = rev + 1, last_active_at = ? WHERE code = ?').run(now, code);
  const row = db.prepare('SELECT rev FROM rooms WHERE code = ?').get(code) as
    | { rev: number }
    | undefined;
  return row?.rev ?? 0;
}

export function createRoom(now = Date.now()): string {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateRoomCode();
    const existing = db.prepare('SELECT code FROM rooms WHERE code = ?').get(code);
    if (existing) continue;
    db.prepare(
      'INSERT INTO rooms (code, rev, created_at, last_active_at) VALUES (?, 0, ?, ?)',
    ).run(code, now, now);
    return code;
  }
  throw new RoomError('bad_request', 'Could not allocate a room code');
}

export function roomExists(code: string): boolean {
  return Boolean(getDb().prepare('SELECT code FROM rooms WHERE code = ?').get(code));
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
      db.prepare('UPDATE members SET name = ? WHERE id = ?').run(cleanName, memberId);
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
  const result = db
    .prepare('DELETE FROM drinks WHERE id = ? AND room_code = ? AND member_id = ?')
    .run(drinkId, code, memberId);
  if (result.changes === 0) throw new RoomError('bad_request', 'That drink is not yours to remove');
  touch(code, now);
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
