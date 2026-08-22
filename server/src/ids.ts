import { randomBytes, randomInt } from 'node:crypto';

/** Room-code alphabet with 0/O/1/I/L removed so codes survive being read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Room codes are typed by humans, so fold case and drop anything outside the
 * code alphabet (spaces, dashes, and the look-alikes it never generates).
 */
export function normaliseRoomCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return code.length === CODE_LENGTH && code.split('').every((c) => CODE_ALPHABET.includes(c));
}

export function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}
