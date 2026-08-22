import path from 'node:path';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 8080),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  roomTtlHours: num(process.env.ROOM_TTL_HOURS, 48),
  isProduction: process.env.NODE_ENV === 'production',

  /** Guardrails so one room cannot exhaust the box. */
  maxMembersPerRoom: 20,
  maxDrinksPerRoom: 2000,
  maxMatchesPerRoom: 500,
  maxMessageBytes: 4096,
  /** Client messages allowed per connection per minute. */
  messagesPerMinute: 120,
};
