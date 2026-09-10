/**
 * INV-25 — no raw SQL outside the repository layer.
 *
 * STANDARD §9.3 requires this as a build-failing static check: a `SELECT` in a
 * route is a `SELECT` nobody scoped to a tenant, and on D1 there is no engine
 * to catch it.
 *
 * The repository layer does not exist everywhere yet, so this runs as a
 * ratchet rather than a wall. LEGACY lists the files still holding pre-XYZ SQL.
 * A file not on that list containing SQL fails the build; a file on it that
 * stops containing SQL is reported so the entry can be deleted. The list only
 * ever shrinks, and the check becomes the wall the standard asks for when it
 * reaches empty.
 *
 *   node test/no-raw-sql.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

/** Where SQL is supposed to live. */
const ALLOWED = [
  'src/lib/repo.ts',      // the generic tenant-scoped statements
  'src/repo/',            // every concrete repository
];

/**
 * Pre-XYZ files still to be moved onto the repository layer.
 *
 * Empty: every route now goes through src/repo/, and `src/lib/db.ts` is gone.
 * The ratchet is the wall the standard asks for (INV-25) — any SQL that appears
 * outside the repository layer from here on fails the build.
 */
const LEGACY = new Set([]);

// Requires a FROM/INTO/SET after the verb, so prose like "SELECT ... ORDER BY"
// in a comment does not register as a query.
const SQL = /\b(SELECT\s+[\s\S]{0,200}?\bFROM\b|INSERT\s+INTO\s+\w|UPDATE\s+\w[\w.]*\s+SET\b|DELETE\s+FROM\s+\w)/i;

/** Comments are not code. Strips // and block comments before matching. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

const found = new Set();
for (const file of walk(SRC)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (ALLOWED.some((a) => rel === a || rel.startsWith(a))) continue;
  if (SQL.test(stripComments(readFileSync(file, 'utf8')))) found.add(rel);
}

const violations = [...found].filter((f) => !LEGACY.has(f)).sort();
const cleared = [...LEGACY].filter((f) => !found.has(f)).sort();

if (cleared.length) {
  console.log(`\n${cleared.length} legacy file(s) no longer contain SQL — remove from LEGACY:`);
  for (const f of cleared) console.log(`  ${f}`);
}

if (violations.length) {
  console.error(`\nINV-25: raw SQL outside the repository layer in ${violations.length} file(s):`);
  for (const f of violations) console.error(`  ${f}`);
  console.error('\nMove the query into src/repo/, or add the file to LEGACY only if it predates the rewrite.\n');
  process.exit(1);
}

console.log(`\nINV-25 ok — ${found.size} legacy file(s) left to migrate, 0 new violations.\n`);
