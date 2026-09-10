/**
 * The operator's calendar.
 *
 * `today()` and `currentPeriod()` used to be `toISOString().slice(...)`, which
 * is UTC. Thailand is UTC+7, so for the first seven hours of every day both
 * were wrong, and nothing about that is visible: a form defaults to yesterday,
 * a billing screen offers last month, an invoice due today reads as not yet
 * due. The resident's app computes the same thing in Bangkok, so the two
 * services disagreed about one row for exactly that window.
 *
 *   node test/dates.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const build = join(here, '.build');

mkdirSync(build, { recursive: true });
execFileSync('npx', [
  'esbuild', join(root, 'src/lib/util.ts'),
  '--bundle', '--format=esm', '--platform=neutral', '--target=es2022',
  `--outfile=${join(build, 'util.mjs')}`,
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

const { today, currentPeriod, PLATFORM_TZ, addDays, shiftPeriod, periodBounds, daysBetween } =
  await import(join(build, 'util.mjs'));

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push([name, e]);
    console.log(`  FAIL ${name}`);
  }
}

/** What `today()` answers with the clock held at one instant. */
function todayAt(iso) {
  const real = Date;
  const fixed = new Date(iso);
  // eslint-disable-next-line no-global-assign
  Date = class extends real {
    constructor(...args) {
      super(...(args.length ? args : [fixed.getTime()]));
    }
    static now() { return fixed.getTime(); }
  };
  try {
    return { day: today(), period: currentPeriod() };
  } finally {
    Date = real;
  }
}

await test('the zone is the one the operator lives in', () => {
  assert.equal(PLATFORM_TZ, 'Asia/Bangkok');
});

await test('a date is YYYY-MM-DD, the shape every column stores', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(currentPeriod(), /^\d{4}-\d{2}$/);
  assert.equal(currentPeriod(), today().slice(0, 7));
});

await test('the seven hours UTC was behind', () => {
  // 23:00 UTC is already tomorrow in Bangkok. This is the moment a payment
  // recorded "now" used to be dated to yesterday.
  assert.equal(todayAt('2026-09-10T23:00:00.000Z').day, '2026-09-11');
  // 16:59 UTC is still the same day there.
  assert.equal(todayAt('2026-09-10T16:59:00.000Z').day, '2026-09-10');
  // And the boundary itself.
  assert.equal(todayAt('2026-09-10T17:00:00.000Z').day, '2026-09-11');
});

await test('the first of the month is not the last of the previous one', () => {
  // The worse case: at 02:00 on 1 October the billing screen used to offer
  // September's run, which had already been issued — and
  // ux_invoice_contract_period would refuse the second one after the work.
  const at = todayAt('2026-09-30T19:00:00.000Z');
  assert.equal(at.day, '2026-10-01');
  assert.equal(at.period, '2026-10');
});

await test('the year rolls over on the operator\'s calendar too', () => {
  const at = todayAt('2026-12-31T17:30:00.000Z');
  assert.equal(at.day, '2027-01-01');
  assert.equal(at.period, '2027-01');
});

await test('a zone can be named explicitly, for the day one is', () => {
  // tenant.timezone exists and is not read yet. The parameter is what makes
  // reading it a one-line change rather than a hunt.
  assert.equal(today('UTC').length, 10);
  assert.notEqual(today('Pacific/Kiritimati'), today('Pacific/Niue'));
});

await test('calendar arithmetic stays on the calendar', () => {
  // These take a date string and never read the clock, so they were right
  // before and must stay independent of any zone.
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftPeriod('2026-12', 1), '2027-01');
  assert.equal(shiftPeriod('2026-01', -1), '2025-12');
  assert.equal(daysBetween('2026-09-01', '2026-09-30'), 29);
});

await test('a period knows how many days it has', () => {
  assert.deepEqual(periodBounds('2026-02'),
    { start: '2026-02-01', end: '2026-02-28', days: 28 });
  // 2028 is a leap year, and a month billed one day short is a refund.
  assert.deepEqual(periodBounds('2028-02'),
    { start: '2028-02-01', end: '2028-02-29', days: 29 });
  assert.deepEqual(periodBounds('2026-09'),
    { start: '2026-09-01', end: '2026-09-30', days: 30 });
});

rmSync(join(build, 'util.mjs'), { force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, e] of failures) console.error(`FAIL ${name}\n${e.stack}\n`);
  process.exit(1);
}
