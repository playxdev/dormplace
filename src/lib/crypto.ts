/**
 * Field encryption and matching hashes for personal data.
 *
 * Three different operations on the same value, deliberately kept apart
 * (STANDARD §5.10, §12.5):
 *
 *   hash   — HMAC, for matching a phone number at signup without storing it
 *   masked — '08x-xxx-1234', what every ordinary screen shows
 *   enc    — ciphertext, readable only with a permission and an audit row
 *
 * Encryption is enveloped: a random data key per subject, wrapped under a
 * master key that lives in the Workers secret store and never in the database.
 * Erasing a person is then one DELETE against `data_key` — every field and
 * every R2 object encrypted under it becomes unreadable at once, including the
 * ones nothing can conveniently rewrite.
 *
 * Both secrets are required at runtime:
 *
 *   npx wrangler secret put DATA_MASTER_KEY   # 32 random bytes, base64
 *   npx wrangler secret put PII_PEPPER        # 32 random bytes, base64
 *
 * Rotating DATA_MASTER_KEY means rewrapping every row in `data_key`; rotating
 * PII_PEPPER invalidates every stored hash and breaks phone matching, so it is
 * effectively permanent. Generate both before the first real operator.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

/* ---------- matching hash ---------- */

/**
 * HMAC-SHA256 under a server-held pepper. A bare SHA-256 of a Thai mobile
 * number is not a hash: there are about a hundred million of them, and a
 * leaked database would be reversed by brute force in minutes. The pepper is
 * what makes the stored value useless without the secret store.
 */
export async function hashField(pepper: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', unb64(pepper) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(normalizePhone(value) || value.trim().toLowerCase()));
  return b64(sig);
}

/** Thai mobile numbers to E.164, so the same person hashes the same way. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('66')) return `+${digits}`;
  if (digits.startsWith('0')) return `+66${digits.slice(1)}`;
  return null;
}

/** '0812345678' -> '08x-xxx-5678'. What every screen without pii_view shows. */
export function maskPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `${digits.slice(0, 2)}x-xxx-${digits.slice(-4)}`;
}

/** Last four of a national ID, enough to confirm identity at the desk. */
export function lastFour(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/* ---------- envelope encryption ---------- */

async function masterKey(master: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(master) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * A fresh 256-bit data key, and the same key wrapped under the master key.
 *
 * The caller stores the wrapped half; only it ever touches the database. Key
 * material and SQL stay in different files on purpose — this one has no
 * D1Database in it at all, so there is no query here to forget to scope.
 */
export async function newDataKey(master: string): Promise<{ key: CryptoKey; wrapped: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { key: await importKey(raw), wrapped: await wrap(master, raw) };
}

export async function openDataKey(master: string, wrapped: string): Promise<CryptoKey> {
  return importKey(await unwrap(master, wrapped));
}

function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function wrap(master: string, raw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await masterKey(master), raw as BufferSource);
  return `${b64(iv)}.${b64(ct)}`;
}

async function unwrap(master: string, wrapped: string): Promise<Uint8Array> {
  const [iv, ct] = wrapped.split('.');
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) as BufferSource }, await masterKey(master), unb64(ct) as BufferSource,
  );
  return new Uint8Array(raw);
}

export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptField(key: CryptoKey, stored: string): Promise<string> {
  const [iv, ct] = stored.split('.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource,
  );
  return dec.decode(plain);
}

