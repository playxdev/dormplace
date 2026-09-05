import { id } from './util';

/**
 * Password hashing with PBKDF2-SHA256 via WebCrypto (available in Workers).
 * Stored as `pbkdf2$<iterations>$<saltB64>$<hashB64>`.
 */
// 100 000 is the ceiling, not a preference: the Workers runtime refuses more.
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported (requested 120000).
//
// Local `wrangler dev` does not enforce it, so a higher number passes every
// test on this machine and every sign-in fails once deployed.
const ITERATIONS = 100_000;

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt.buffer as ArrayBuffer)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const bits = await derive(password, unb64(saltB64), Number(iterStr));
  const a = new Uint8Array(bits);
  const b = unb64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const SESSION_COOKIE = 'dorm_session';
export const SESSION_DAYS = 14;

export function newSessionId(): string {
  return id('s_');
}

export function sessionExpiry(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + SESSION_DAYS);
  return d.toISOString();
}
