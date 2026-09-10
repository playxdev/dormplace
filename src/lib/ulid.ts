/**
 * ULID — 26 chars, Crockford Base32, time-sortable.
 *
 * Every primary key in the XYZ schema is one of these (STANDARD §13.1). The
 * point is not novelty: 48 bits of millisecond timestamp in the high bits mean
 * rows written near each other in time land near each other in the index, which
 * UUIDv4 cannot do, and a `SELECT ... ORDER BY id` is already newest-last
 * without a second column.
 *
 * An id must not carry tenant_id or any business meaning. An id with meaning
 * lies the moment the thing it describes moves.
 */

// Crockford Base32: no I, L, O or U. I/L/O are confusable with 1/0, and
// dropping U keeps accidental profanity out of a code a human may read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = 0;
let lastRandom: number[] = [];

function encodeTime(now: number): string {
  let out = '';
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ALPHABET[now % 32] + out;
    now = Math.floor(now / 32);
  }
  return out;
}

function randomChars(): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
  // One byte per char wastes 3 bits each, but keeps every char uniform over the
  // alphabet. Modulo 32 of a uniform byte is uniform because 32 divides 256.
  return Array.from(bytes, (b) => b % 32);
}

/**
 * Monotonic within a millisecond: two ulids created in the same tick increment
 * the random field rather than re-rolling it, so a batch inserted in one
 * request still sorts in creation order. Without this, ids from the same
 * millisecond order arbitrarily and a paged list can repeat or skip a row.
 */
function incrementRandom(chars: number[]): number[] {
  const out = chars.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] < 31) { out[i]++; return out; }
    out[i] = 0;
  }
  // Overflowed all 80 bits inside one millisecond. Not reachable in practice;
  // re-rolling is still correct, only no longer strictly monotonic.
  return randomChars();
}

export function ulid(now = Date.now()): string {
  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomChars();
  }
  return encodeTime(now) + lastRandom.map((n) => ALPHABET[n]).join('');
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(s: unknown): s is string {
  return typeof s === 'string' && ULID_RE.test(s);
}

/** Milliseconds since epoch encoded in the first 10 chars. */
export function ulidTime(s: string): number {
  let t = 0;
  for (let i = 0; i < TIME_LEN; i++) t = t * 32 + ALPHABET.indexOf(s[i]);
  return t;
}

/**
 * Normalizes what a human typed or a scanner misread: uppercase, strip dashes
 * and spaces, then map the characters Crockford deliberately excluded onto the
 * ones they are mistaken for. Used for invitation codes (STANDARD §7.2), never
 * for ids arriving from our own database.
 */
export function normalizeCrockford(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}
