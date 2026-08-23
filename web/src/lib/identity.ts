const MEMBER_ID_KEY = 'one4one.memberId';
const NAME_KEY = 'one4one.name';
const RECENT_KEY = 'one4one.recentRooms';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: identity lasts for this tab only.
  }
}

/**
 * The device's member id doubles as its bearer token: whoever holds it is that
 * member. It is generated once and reused so a refresh keeps your drinks.
 */
export function getMemberId(): string {
  const existing = read(MEMBER_ID_KEY);
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
  const fresh = randomId();
  write(MEMBER_ID_KEY, fresh);
  return fresh;
}

export function getStoredName(): string {
  return read(NAME_KEY) ?? '';
}

export function storeName(name: string): void {
  write(NAME_KEY, name);
}

export interface RecentRoom {
  code: string;
  lastSeen: number;
  /** The room's name as of the last time this device saw it — may be stale. */
  name?: string | null;
}

export function getRecentRooms(): RecentRoom[] {
  try {
    const parsed = JSON.parse(read(RECENT_KEY) ?? '[]') as RecentRoom[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => typeof entry?.code === 'string')
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/** `name` is optional so callers that never see a room's name (none currently) can skip it. */
export function rememberRoom(code: string, name?: string | null): void {
  const others = getRecentRooms().filter((entry) => entry.code !== code);
  write(RECENT_KEY, JSON.stringify([{ code, lastSeen: Date.now(), name }, ...others].slice(0, 5)));
}
