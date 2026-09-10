/**
 * Isolation conformance suite — the part that exists today.
 *
 * STANDARD §9.7 and INV-15/INV-27 require this to cover 100% of routes before
 * the vertical ships. It does not yet: the routes have not been moved onto the
 * repository layer. What it covers now is the layer itself, which is where an
 * isolation bug would be systemic rather than local.
 *
 * Every test is written from the position of an attacker holding a valid
 * session at tenant B and a correct id belonging to tenant A. On D1 there is no
 * row-level security to catch a mistake here (STANDARD §9.5), so "the repo
 * refuses" is the entire defence.
 *
 *   node --experimental-sqlite test/isolation.test.mjs
 */

import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { D1Shim } from './d1-shim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const build = join(here, '.build');

/* The repos are TypeScript. esbuild is already a devDependency, so bundling to
 * one ESM file is cheaper than teaching node to strip types. */
mkdirSync(build, { recursive: true });
execFileSync('npx', [
  'esbuild', join(root, 'src/repo/index.ts'),
  '--bundle', '--format=esm', '--platform=neutral', '--target=es2022',
  `--outfile=${join(build, 'repo.mjs')}`,
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

const { Repos, IdentityRepo } = await import(join(build, 'repo.mjs'));

const migrations = ['0001_xyz_core.sql', '0002_dorm_vertical.sql']
  .map((f) => readFileSync(join(root, 'migrations', f), 'utf8'));

/* ---------- fixtures ---------- */

const NOW = '2026-09-07T00:00:00.000Z';
const B64_32 = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function ctx(tenantId, over = {}) {
  return {
    tenantId,
    accountId: `acct_${tenantId}`,
    membershipId: `mem_${tenantId}`,
    kind: 'STAFF',
    permissions: ['*'],
    requestId: 'req_test',
    timezone: 'Asia/Bangkok',
    ...over,
  };
}

function seed() {
  const d1 = new D1Shim(migrations);
  const db = d1.db;
  for (const t of ['A', 'B']) {
    db.prepare(
      `INSERT INTO account (account_id, display_name, locale, status, created_at, updated_at)
       VALUES (?, ?, 'th', 'ACTIVE', ?, ?)`,
    ).run(`acct_${t}`, `owner ${t}`, NOW, NOW);
    db.prepare(
      `INSERT INTO tenant (tenant_id, slug, name, owner_account_id, status, vertical, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', 'DORM', ?, ?)`,
    ).run(t, `dorm-${t.toLowerCase()}`, `Dorm ${t}`, `acct_${t}`, NOW, NOW);
  }
  // Test secrets. Real ones are Workers secrets and are never in the repo.
  const secrets = { DATA_MASTER_KEY: B64_32, PII_PEPPER: B64_32 };
  return { d1, repos: new Repos(d1, secrets) };
}

/** A room, a resident and a live lease — the fixture most tests need. */
async function lease(repos, ctx) {
  const b = await repos.buildings.insert(ctx, { name: 'Sunrise' });
  const r = await repos.rooms.insert(ctx, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(ctx, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(ctx, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  await repos.contracts.activate(ctx, k.contract_id);
  return { buildingId: b.building_id, roomId: r.room_id, partyId: p.party_id, contractId: k.contract_id };
}

/* ---------- runner ---------- */

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push([name, e]);
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

async function throws(fn, code, message) {
  try {
    await fn();
  } catch (e) {
    assert.equal(e.code, code, `${message}: expected code '${code}', got '${e.code}' (${e.message})`);
    return e;
  }
  assert.fail(`${message}: expected a throw, nothing was thrown`);
}

/* ---------- tests ---------- */

console.log('\nisolation conformance — repository layer\n');

const A = ctx('A');
const B = ctx('B');

await test('insert writes tenant_id from the context, not from the payload', async () => {
  const { repos, d1 } = seed();
  // The payload lies about which tenant it belongs to. It must be ignored.
  const room = await repos.buildings.insert(A, { name: 'Sunrise', tenant_id: 'B' });
  const row = d1.db.prepare('SELECT tenant_id FROM building WHERE building_id = ?').get(room.building_id);
  assert.equal(row.tenant_id, 'A', 'a payload tenant_id must never reach the database');
});

await test('byId on another tenant\'s row answers NotFound, not Forbidden', async () => {
  const { repos } = seed();
  const mine = await repos.buildings.insert(A, { name: 'Sunrise' });
  // 403 would confirm the id is real, which is how one tenant maps another.
  await throws(() => repos.buildings.byId(B, mine.building_id), 'not_found',
    'cross-tenant byId');
});

await test('byId on an id that does not exist answers the identical error', async () => {
  const { repos } = seed();
  const a = await throws(() => repos.buildings.byId(B, '00000000000000000000000000'), 'not_found', 'absent id');
  const mine = await repos.buildings.insert(A, { name: 'Sunrise' });
  const b = await throws(() => repos.buildings.byId(B, mine.building_id), 'not_found', 'foreign id');
  assert.equal(a.message, b.message, 'the two cases must be indistinguishable to the caller');
});

await test('all() never returns another tenant\'s rows', async () => {
  const { repos } = seed();
  await repos.buildings.insert(A, { name: 'Sunrise' });
  await repos.buildings.insert(A, { name: 'Moonlight' });
  await repos.buildings.insert(B, { name: 'Riverside' });
  const seenByB = await repos.buildings.all(B);
  assert.equal(seenByB.length, 1);
  assert.equal(seenByB[0].name, 'Riverside');
});

await test('count() and paging() are scoped too', async () => {
  const { repos } = seed();
  await repos.buildings.insert(A, { name: 'Sunrise' });
  await repos.buildings.insert(A, { name: 'Moonlight' });
  await repos.buildings.insert(B, { name: 'Riverside' });
  assert.equal(await repos.buildings.count(B), 1);
  const page = await repos.buildings.paging(B, { perPage: 10 });
  assert.equal(page.total, 1);
  assert.equal(page.rows.length, 1);
});

await test('update() cannot reach across a tenant boundary', async () => {
  const { repos, d1 } = seed();
  const mine = await repos.buildings.insert(A, { name: 'Sunrise' });
  await throws(() => repos.buildings.update(B, mine.building_id, { name: 'Pwned' }), 'not_found',
    'cross-tenant update');
  const row = d1.db.prepare('SELECT name FROM building WHERE building_id = ?').get(mine.building_id);
  assert.equal(row.name, 'Sunrise', 'the row must be untouched');
});

await test('softDelete() cannot reach across a tenant boundary', async () => {
  const { repos, d1 } = seed();
  const mine = await repos.buildings.insert(A, { name: 'Sunrise' });
  await throws(() => repos.buildings.softDelete(B, mine.building_id), 'not_found', 'cross-tenant delete');
  const row = d1.db.prepare('SELECT deleted_at FROM building WHERE building_id = ?').get(mine.building_id);
  assert.equal(row.deleted_at, null);
});

await test('a soft-deleted row disappears from reads but the id stays taken', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  await repos.buildings.softDelete(A, b.building_id);
  assert.equal((await repos.buildings.all(A)).length, 0);
  await throws(() => repos.buildings.byId(A, b.building_id), 'not_found', 'deleted row');
  const withDeleted = await repos.buildings.all(A, { includeDeleted: true });
  assert.equal(withDeleted.length, 1);
});

await test('the partial unique index lets a name be reused after soft delete', async () => {
  const { repos } = seed();
  const first = await repos.buildings.insert(A, { name: 'Sunrise' });
  await repos.buildings.softDelete(A, first.building_id);
  // A plain unique index would reject this, which is why every unique index in
  // the schema is partial on deleted_at.
  await repos.buildings.insert(A, { name: 'Sunrise' });
  assert.equal((await repos.buildings.all(A)).length, 1);
});

await test('two tenants may hold the same invoice number', async () => {
  const { repos, d1 } = seed();
  for (const t of ['A', 'B']) {
    const c = ctx(t);
    const b = await repos.buildings.insert(c, { name: `B-${t}` });
    const r = await repos.rooms.insert(c, { building_id: b.building_id, number: '101', floor: 1 });
    const p = await repos.parties.insert(c, { display_name: `resident ${t}`, kind: 'PRIMARY' });
    const k = await repos.contracts.insert(c, {
      room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
    });
    // The same human-facing number, in both tenants. Under the old global
    // UNIQUE(number) the second insert threw.
    await repos.invoices.insert(c, {
      number: 'INV-2026-09-0001', building_id: b.building_id, room_id: r.room_id,
      contract_id: k.contract_id, party_id: p.party_id, period: '2026-09',
      issue_date: '2026-09-01', due_date: '2026-09-05', subtotal: 500000, total: 500000,
    });
  }
  const n = d1.db.prepare("SELECT COUNT(*) AS n FROM invoice WHERE number = 'INV-2026-09-0001'").get();
  assert.equal(n.n, 2);
});

await test('a balance counts verified payments only', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  const inv = await repos.invoices.insert(A, {
    number: 'INV-1', building_id: b.building_id, room_id: r.room_id, contract_id: k.contract_id,
    party_id: p.party_id, period: '2026-09', issue_date: '2026-09-01', due_date: '2026-09-05',
    subtotal: 500000, total: 500000,
  });

  const pay = await repos.payments.reportOnce(A, {
    invoice_id: inv.invoice_id, amount: 500000, paid_at: '2026-09-03', method: 'PROMPTPAY',
  }, 'idem-1');

  // Reported, not yet accepted: the invoice is still owed in full.
  assert.equal(await repos.invoices.balance(A, inv.invoice_id), 500000);

  await repos.payments.decide(A, pay.payment_id, 'VERIFIED');
  assert.equal(await repos.invoices.balance(A, inv.invoice_id), 0);
});

await test('a retried report is the same payment, not a second one', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  const inv = await repos.invoices.insert(A, {
    number: 'INV-1', building_id: b.building_id, room_id: r.room_id, contract_id: k.contract_id,
    party_id: p.party_id, period: '2026-09', issue_date: '2026-09-01', due_date: '2026-09-05',
    subtotal: 500000, total: 500000,
  });
  const body = { invoice_id: inv.invoice_id, amount: 500000, paid_at: '2026-09-03', method: 'PROMPTPAY' };
  const one = await repos.payments.reportOnce(A, body, 'idem-1');
  const two = await repos.payments.reportOnce(A, body, 'idem-1');
  assert.equal(one.payment_id, two.payment_id);
  assert.equal(await repos.payments.count(A), 1);
});

await test('effective status is a function of the data, not of a cron', async () => {
  const { repos } = seed();
  const invoice = { status: 'UNPAID', total: 500000, due_date: '2026-09-05' };
  assert.equal(repos.invoices.effectiveStatus(invoice, 0, '2026-09-04'), 'UNPAID');
  assert.equal(repos.invoices.effectiveStatus(invoice, 0, '2026-09-06'), 'OVERDUE');
  assert.equal(repos.invoices.effectiveStatus(invoice, 200000, '2026-09-06'), 'PARTIAL');
  assert.equal(repos.invoices.effectiveStatus(invoice, 500000, '2026-09-06'), 'PAID');
});

await test('voiding requires the permission and a reason', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  const inv = await repos.invoices.insert(A, {
    number: 'INV-1', building_id: b.building_id, room_id: r.room_id, contract_id: k.contract_id,
    party_id: p.party_id, period: '2026-09', issue_date: '2026-09-01', due_date: '2026-09-05',
    subtotal: 500000, total: 500000,
  });

  const frontDesk = ctx('A', { permissions: ['app.invoice.read'] });
  await throws(() => repos.invoices.void(frontDesk, inv.invoice_id, 'ตกลงยกเลิก'), 'forbidden',
    'ADMIN must not be able to void');

  await assert.rejects(() => repos.invoices.void(A, inv.invoice_id, '   '), /reason is required/);

  await repos.invoices.void(A, inv.invoice_id, 'ออกบิลซ้ำ');
  assert.equal((await repos.invoices.byId(A, inv.invoice_id)).status, 'VOID');
});

await test('an audited change and its audit row land together', async () => {
  const { repos, d1 } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  await repos.contracts.activate(A, k.contract_id);
  assert.equal((await repos.rooms.byId(A, r.room_id)).status, 'OCCUPIED');

  await repos.contracts.end(A, k.contract_id, 'ย้ายออกตามกำหนด', '2026-09-30');

  const ended = await repos.contracts.byId(A, k.contract_id);
  assert.equal(ended.status, 'ENDED');
  // Seven days from hand-back, as the contract-committee notification requires.
  assert.equal(ended.deposit_return_due_at, '2026-10-07');
  // The room went back to VACANT in the same batch.
  assert.equal((await repos.rooms.byId(A, r.room_id)).status, 'VACANT');

  const audit = d1.db.prepare(
    "SELECT * FROM audit_event WHERE action = 'contract.ended' AND tenant_id = 'A'",
  ).all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, 'ย้ายออกตามกำหนด');
  assert.equal(audit[0].actor_account_id, 'acct_A');
});

await test('the agreed snapshot does not move when the rent is amended', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000, deposit: 500000,
  });
  await repos.contracts.activate(A, k.contract_id);
  await repos.contracts.confirm(A, k.contract_id, { termsVersion: 'v1.2', pdpaVersion: 'v1.0' });

  await repos.contracts.update(A, k.contract_id, { rent: 600000 });

  const after = await repos.contracts.byId(A, k.contract_id);
  assert.equal(after.rent, 600000, 'the live rent changes');
  // What the resident agreed to is the answer to "what rent did I agree to?"
  // eleven months later, and it must not follow the amendment.
  assert.equal(after.agreed_rent, 500000, 'the snapshot does not');
  assert.equal(after.agreed_terms_version, 'v1.2');
});

await test('a lease can be confirmed only once', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  await repos.contracts.activate(A, k.contract_id);
  await repos.contracts.confirm(A, k.contract_id, { termsVersion: 'v1.2', pdpaVersion: 'v1.0' });
  // Scanning the same QR again must not rewrite what was agreed.
  await throws(() => repos.contracts.confirm(A, k.contract_id, { termsVersion: 'v9', pdpaVersion: 'v9' }),
    'guard_failed', 'second confirmation');
  assert.equal((await repos.contracts.byId(A, k.contract_id)).agreed_terms_version, 'v1.2');
});

await test('a guard that misses fails the whole operation', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const p = await repos.parties.insert(A, { display_name: 'somchai', kind: 'PRIMARY' });
  const k = await repos.contracts.insert(A, {
    room_id: r.room_id, party_id: p.party_id, start_date: '2026-09-01', rent: 500000,
  });
  await repos.contracts.activate(A, k.contract_id);
  await repos.contracts.end(A, k.contract_id, 'ย้ายออก', '2026-09-30');
  // Ending an already-ended lease must not write a second audit row or reset
  // the deposit clock.
  await throws(() => repos.contracts.end(A, k.contract_id, 'ย้ายออกอีกครั้ง', '2026-10-31'),
    'guard_failed', 'double end');
});

await test('an announcement pushes at most once however often it is published', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const a = await repos.announcements.insert(A, { building_id: b.building_id, title: 'น้ำดับ', body: 'พรุ่งนี้' });
  assert.equal((await repos.announcements.publish(A, a.announcement_id)).shouldPush, true);
  assert.equal((await repos.announcements.publish(A, a.announcement_id)).shouldPush, false);
});

await test('re-walking a floor updates a reading rather than duplicating it', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  const r = await repos.rooms.insert(A, { building_id: b.building_id, number: '101', floor: 1 });
  const entry = (value) => [{ roomId: r.room_id, kind: 'WATER', prev: 100, value }];

  await repos.meterReadings.saveMany(A, '2026-09', entry(120));
  await repos.meterReadings.saveMany(A, '2026-09', entry(125));

  const rows = await repos.meterReadings.all(A, {});
  assert.equal(rows.length, 1, 'the upsert targets the partial unique index');
  assert.equal(rows[0].value, 125);
  assert.equal(rows[0].recorded_by, 'acct_A');
});

await test('a counter is per tenant', async () => {
  const { repos } = seed();
  assert.equal(await repos.counters.next(A, 'INV-2026-09'), 1);
  assert.equal(await repos.counters.next(A, 'INV-2026-09'), 2);
  // Operator B starts at 1, not at 3.
  assert.equal(await repos.counters.next(B, 'INV-2026-09'), 1);
});

await test('an unknown column is refused rather than interpolated', async () => {
  const { repos } = seed();
  await assert.rejects(
    () => repos.buildings.all(A, { where: [["name = '' OR 1=1 --", '=', 'x']] }),
    /unknown column/,
  );
});

await test('hardDelete from a non-platform context is refused', async () => {
  const { repos } = seed();
  const b = await repos.buildings.insert(A, { name: 'Sunrise' });
  await assert.rejects(
    () => repos.buildings.hardDelete(A, b.building_id, 'PLATFORM'),
    /hardDelete\('PLATFORM'\) from a STAFF context/,
  );
});

await test('an invitation code is never stored in the clear', async () => {
  const { repos, d1 } = seed();
  const { contractId } = await lease(repos, A);
  const { code } = await repos.invitations.issue(A, contractId);

  const row = d1.db.prepare('SELECT secret_hash, secret_prefix FROM invitation').get();
  assert.notEqual(row.secret_hash, code, 'the hash is not the code');
  assert.ok(!row.secret_hash.includes(code), 'and does not contain it');
  // Only enough to recognise the sheet that was printed.
  assert.equal(row.secret_prefix, code.slice(0, 4));
});

await test('a code resolves to its own tenant and nothing else', async () => {
  const { repos } = seed();
  const a = await lease(repos, A);
  const b = await lease(repos, B);
  const issuedA = await repos.invitations.issue(A, a.contractId);
  const issuedB = await repos.invitations.issue(B, b.contractId);

  assert.equal((await repos.invitations.lookup(issuedA.code)).tenantId, 'A');
  assert.equal((await repos.invitations.lookup(issuedB.code)).tenantId, 'B');
  assert.equal(await repos.invitations.lookup('ZZZZZZZZ'), null, 'an unknown code opens nothing');
});

await test('a misread code still resolves', async () => {
  const { repos } = seed();
  const { contractId } = await lease(repos, A);
  const { code } = await repos.invitations.issue(A, contractId);
  // Crockford: I and L read as 1, O as 0, U as V, dashes and case are noise.
  const asTyped = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
  assert.equal((await repos.invitations.lookup(asTyped)).contractId, contractId);
});

await test('reissuing kills the sheet already handed out', async () => {
  const { repos } = seed();
  const { contractId } = await lease(repos, A);
  const first = await repos.invitations.issue(A, contractId);
  const second = await repos.invitations.issue(A, contractId);

  assert.equal(await repos.invitations.lookup(first.code), null, 'the old QR stops working');
  assert.equal((await repos.invitations.lookup(second.code)).contractId, contractId);
});

await test('a revoked code opens nothing', async () => {
  const { repos } = seed();
  const { contractId } = await lease(repos, A);
  const { code } = await repos.invitations.issue(A, contractId);
  const view = await repos.invitations.current(A, contractId);
  await repos.invitations.revoke(A, view.invitation_id, 'ทำใบส่งมอบหาย');
  assert.equal(await repos.invitations.lookup(code), null);
});

await test('provisioning an owner creates the whole chain in one batch', async () => {
  const d1 = new D1Shim(migrations);
  const identity = new IdentityRepo(d1);
  assert.equal(await identity.accountCount(), 0, 'first run');

  const { accountId, tenantId } = await identity.provisionOwner({
    email: 'owner@example.com', name: 'สมชาย', password: 'correct-horse', tenantName: 'หอพักสุขสันต์',
  });

  const memberships = await identity.memberships(accountId, 'STAFF');
  assert.equal(memberships.length, 1, 'always an array, even at length 1');
  assert.equal(memberships[0].tenant_id, tenantId);
  assert.equal(memberships[0].role_key, 'OWNER');

  // Three preset roles, and the OWNER one actually carries permissions.
  const roles = d1.db.prepare('SELECT key FROM role WHERE tenant_id = ?').all(tenantId);
  assert.equal(roles.length, 3);
  const ctx = await identity.resolve(accountId, 'req');
  assert.ok(ctx.permissions.includes('app.invoice.void'), 'the owner can do owner things');
  assert.equal(ctx.tenantId, tenantId);
});

await test('sign-in answers the same for a wrong password and no such account', async () => {
  const d1 = new D1Shim(migrations);
  const identity = new IdentityRepo(d1);
  await identity.provisionOwner({
    email: 'owner@example.com', name: 'สมชาย', password: 'correct-horse', tenantName: 'หอพัก',
  });
  assert.equal(await identity.signIn('owner@example.com', 'wrong'), null);
  assert.equal(await identity.signIn('nobody@example.com', 'correct-horse'), null);
  assert.ok(await identity.signIn('OWNER@example.com ', 'correct-horse'), 'case and spacing are noise');
});

await test('a tenant_id in a URL cannot select a tenant the account is not in', async () => {
  const d1 = new D1Shim(migrations);
  const identity = new IdentityRepo(d1);
  const { accountId, tenantId } = await identity.provisionOwner({
    email: 'a@example.com', name: 'A', password: 'correct-horse', tenantName: 'A',
  });
  const other = await identity.provisionOwner({
    email: 'b@example.com', name: 'B', password: 'correct-horse', tenantName: 'B',
  });

  assert.equal((await identity.resolve(accountId, 'req', tenantId)).tenantId, tenantId);
  // The claim is checked against membership, so it selects nothing.
  assert.equal(await identity.resolve(accountId, 'req', other.tenantId), null);
});

/* ---------- report ---------- */

rmSync(build, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, e] of failures) console.error(`FAIL ${name}\n${e.stack}\n`);
  process.exit(1);
}
