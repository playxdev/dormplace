/**
 * Identity, sessions and tenant provisioning.
 *
 * These tables are global — an ACCOUNT belongs to a person, not to a business
 * (rule 1: no tenant_id, no role, no phone, no line_user_id on it) — so they do
 * not go through TenantScopedRepo. A session likewise belongs to an account:
 * one sign-in may reach several memberships, and which tenant a request is for
 * is resolved per request, never stored on the session.
 *
 * This is also where a tenant comes into existence, which is the one operation
 * that cannot be tenant-scoped because the tenant is its output.
 */

import { hashPassword, verifyPassword } from '../lib/auth';
import { PRESET_ROLES } from '../lib/perm';
import type { MembershipKind, TenantContext } from '../lib/tenant-context';
import { ulid } from '../lib/ulid';

export interface Account {
  account_id: string;
  display_name: string | null;
  locale: string;
  status: 'ACTIVE' | 'LOCKED' | 'ERASED' | 'MERGED';
  created_at: string;
}

/** One entry per tenant this account can act in. Always returned as an array. */
export interface MembershipSummary {
  membership_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  kind: MembershipKind;
  status: string;
  role_key: string | null;
  /** JSON array as stored; parsed by resolve(). */
  permissions: string | null;
  timezone: string;
}

const SESSION_DAYS = 14;

/**
 * Statuses that make a membership usable right now. LEFT, BANNED and REJECTED
 * are history: the row stays so the audit trail and the business data still
 * point somewhere, but it grants nothing.
 */
const OCCUPYING = "('ACTIVE', 'SUSPENDED')";

export class IdentityRepo {
  constructor(private readonly d1: D1Database) {}

  /** Zero means first run: there is nobody to sign in as yet. */
  async accountCount(): Promise<number> {
    const row = await this.d1
      .prepare("SELECT COUNT(*) AS n FROM account WHERE status = 'ACTIVE' AND deleted_at IS NULL")
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Email sign-in. The lookup and the password check are separate so that a
   * missing account and a wrong password cost the same work — returning early
   * on "no such email" is a timing oracle for which addresses are registered.
   */
  async signIn(email: string, password: string): Promise<Account | null> {
    const row = await this.d1
      .prepare(
        `SELECT a.account_id, a.display_name, a.locale, a.status, a.created_at, p.hash
           FROM account_identity i
           JOIN account a ON a.account_id = i.account_id
           LEFT JOIN password_credential p ON p.account_id = a.account_id
          WHERE i.provider = 'EMAIL' AND i.external_id = ?
            AND i.deleted_at IS NULL AND a.deleted_at IS NULL`,
      )
      .bind(email.trim().toLowerCase())
      .first<Account & { hash: string | null }>();

    // A dummy hash of the right shape, so the comparison runs either way.
    const stored = row?.hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const ok = await verifyPassword(password, stored);
    if (!row || !ok || row.status !== 'ACTIVE') return null;

    const { hash, ...account } = row;
    return account;
  }

  async startSession(accountId: string): Promise<string> {
    const sessionId = ulid();
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + SESSION_DAYS);
    await this.d1
      .prepare('INSERT INTO session (session_id, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(sessionId, accountId, expires.toISOString(), new Date().toISOString())
      .run();
    return sessionId;
  }

  async endSession(sessionId: string): Promise<void> {
    await this.d1.prepare('DELETE FROM session WHERE session_id = ?').bind(sessionId).run();
  }

  async accountBySession(sessionId: string): Promise<Account | null> {
    return this.d1
      .prepare(
        `SELECT a.account_id, a.display_name, a.locale, a.status, a.created_at
           FROM session s JOIN account a ON a.account_id = s.account_id
          WHERE s.session_id = ? AND s.expires_at > ?
            AND a.status = 'ACTIVE' AND a.deleted_at IS NULL`,
      )
      .bind(sessionId, new Date().toISOString())
      .first<Account>();
  }

  /**
   * Always an array, even while a staff account can only have one (STANDARD
   * §9.4). A frontend written against a single object has to be rewritten the
   * day someone manages two buildings for two different businesses; one written
   * against an array of length 1 does not.
   */
  async memberships(accountId: string, kind?: MembershipKind): Promise<MembershipSummary[]> {
    const res = await this.d1
      .prepare(
        `SELECT m.membership_id, m.tenant_id, m.kind, m.status,
                t.name AS tenant_name, t.slug AS tenant_slug, t.timezone,
                r.key AS role_key, r.permissions
           FROM membership m
           JOIN tenant t ON t.tenant_id = m.tenant_id
           LEFT JOIN role r ON r.tenant_id = m.tenant_id AND r.role_id = m.role_id
          WHERE m.account_id = ? AND m.status IN ${OCCUPYING}
            AND m.deleted_at IS NULL AND t.status = 'ACTIVE' AND t.deleted_at IS NULL
            ${kind ? 'AND m.kind = ?' : ''}
          ORDER BY t.name`,
      )
      .bind(...(kind ? [accountId, kind] : [accountId]))
      .all<MembershipSummary>();
    return res.results ?? [];
  }

  /**
   * Builds the TenantContext for a request. The only place one is created.
   *
   * `wantedTenantId` may come from a URL, so it is treated as a claim to be
   * checked rather than as an answer: it selects among the memberships this
   * account actually holds, and matches nothing if the account is not a member.
   * A tenant_id that reached here from a request body would be the entire
   * vulnerability (STANDARD §9.4).
   */
  async resolve(
    accountId: string,
    requestId: string,
    wantedTenantId?: string,
  ): Promise<TenantContext | null> {
    const rows = await this.memberships(accountId, 'STAFF');
    if (!rows.length) return null;

    const chosen = wantedTenantId
      ? rows.find((m) => m.tenant_id === wantedTenantId)
      : rows[0];
    if (!chosen) return null;

    // A suspended membership can still sign in — it must be able to see why —
    // but it carries no permissions, so every write is refused with the normal
    // 403 rather than with a special case scattered through the routes.
    const permissions: string[] =
      chosen.status === 'SUSPENDED' ? [] : JSON.parse(chosen.permissions ?? '[]');

    return {
      tenantId: chosen.tenant_id,
      accountId,
      membershipId: chosen.membership_id,
      kind: chosen.kind,
      permissions,
      requestId,
      timezone: chosen.timezone,
    };
  }

  /**
   * First run: an account, its email identity, a tenant, the three preset roles
   * and an OWNER membership — in one batch, because a partial result has no
   * screen that can repair it. A tenant whose owner has no membership is a
   * business nobody can administer, and a membership whose role does not exist
   * is an owner who can do nothing.
   *
   * The ids are all generated here rather than by the database so that the
   * membership can reference the OWNER role in the same batch that creates it.
   */
  async provisionOwner(input: {
    email: string;
    name: string;
    password: string;
    tenantName: string;
  }): Promise<{ accountId: string; tenantId: string }> {
    const now = new Date().toISOString();
    const accountId = ulid();
    const tenantId = ulid();
    const hash = await hashPassword(input.password);
    const email = input.email.trim().toLowerCase();

    const roleIds: Record<string, string> = {};
    for (const key of Object.keys(PRESET_ROLES)) roleIds[key] = ulid();

    const statements: D1PreparedStatement[] = [
      this.d1
        .prepare(
          `INSERT INTO account (account_id, display_name, locale, status, created_at, updated_at)
           VALUES (?, ?, 'th', 'ACTIVE', ?, ?)`,
        )
        .bind(accountId, input.name, now, now),
      this.d1
        .prepare(
          `INSERT INTO account_identity
             (identity_id, account_id, provider, provider_scope, external_id, verified_at, is_primary, created_at)
           VALUES (?, ?, 'EMAIL', '_', ?, NULL, 1, ?)`,
        )
        .bind(ulid(), accountId, email, now),
      this.d1
        .prepare('INSERT INTO password_credential (account_id, hash, updated_at) VALUES (?, ?, ?)')
        .bind(accountId, hash, now),
      this.d1
        .prepare(
          `INSERT INTO tenant (tenant_id, slug, name, owner_account_id, status, vertical,
                               locale, timezone, currency, data_region, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', 'DORM', 'th', 'Asia/Bangkok', 'THB', 'auto', ?, ?)`,
        )
        .bind(tenantId, slugify(input.tenantName, tenantId), input.tenantName, accountId, now, now),
    ];

    for (const [key, preset] of Object.entries(PRESET_ROLES)) {
      statements.push(
        this.d1
          .prepare(
            `INSERT INTO role (tenant_id, role_id, key, name, permissions, is_system, rank, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .bind(tenantId, roleIds[key], key, preset.name, JSON.stringify(preset.permissions), preset.rank, now, now),
      );
    }

    statements.push(
      this.d1
        .prepare(
          `INSERT INTO membership
             (tenant_id, membership_id, account_id, kind, status, role_id, joined_at, created_at, updated_at)
           VALUES (?, ?, ?, 'STAFF', 'ACTIVE', ?, ?, ?, ?)`,
        )
        .bind(tenantId, ulid(), accountId, roleIds.OWNER, now, now, now),
      this.d1
        .prepare(
          `INSERT INTO audit_event
             (event_id, occurred_at, tenant_id, actor_type, actor_account_id, action,
              target_type, target_id, result, request_id)
           VALUES (?, ?, ?, 'STAFF', ?, 'tenant.provisioned', 'tenant', ?, 'SUCCESS', 'setup')`,
        )
        .bind(ulid(), now, tenantId, accountId, tenantId),
    );

    await this.d1.batch(statements);
    return { accountId, tenantId };
  }
}

/**
 * A readable slug for the tenant's URL, with the tail of its id appended so two
 * businesses of the same name cannot collide. The slug is a label, never a key
 * (STANDARD §13.2) — nothing joins on it.
 */
function slugify(name: string, tenantId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'dorm'}-${tenantId.slice(-6).toLowerCase()}`;
}
