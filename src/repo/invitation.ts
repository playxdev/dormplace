/**
 * Invitations — the QR an operator hands over with the key.
 *
 * STANDARD §7. Three things about this differ from the pre-XYZ `invites` table
 * and each is deliberate:
 *
 *   · The code is stored as HMAC-SHA256(pepper, normalized), never in the
 *     clear (§7.4). A leaked database is then a list of hashes, not a set of
 *     live keys to other people's rooms.
 *   · Because of that, the plaintext exists once — at issue, in the response
 *     that prints the handover sheet. There is no screen that shows it again.
 *     Losing the sheet means reissuing, which revokes the old code, which is
 *     the behaviour you want anyway: paper that went missing stops working.
 *   · Redemption is a guarded batch. `used_count < max_usage` in the guard is
 *     what makes single-use hold without a transaction D1 cannot give.
 *
 * Lookup by code takes no TenantContext, and cannot: the code is the only
 * credential its holder has, and resolving it is how the tenant is discovered.
 * `ux_invitation_secret` is globally unique for exactly this reason.
 */

import { hashField } from '../lib/crypto';
import { GuardFailedError, NotFoundError, type TenantContext } from '../lib/tenant-context';
import { normalizeCrockford, ulid } from '../lib/ulid';
import type { AuditRepo } from './audit';

/**
 * Crockford Base32 without I, L, O and U (STANDARD §7.2). Those are the
 * characters people get wrong reading a code off a sheet or hearing it over the
 * phone, and normalizeCrockford() maps the mistakes back.
 *
 * 32^8 = 1.1 x 10^12. Single use, 30-day expiry, and a hash in the database.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const VALID_DAYS = 30;

/** The invitation as the backoffice may see it: never the code itself. */
export interface InvitationView {
  invitation_id: string;
  contract_id: string;
  secret_prefix: string | null;
  status: string;
  expires_at: string;
  used_count: number;
  created_at: string;
  expired: boolean;
}

function newCode(): string {
  // Rejection sampling rather than modulo: 256 is not a multiple of 32's
  // alphabet length here only by accident, and an unbiased code costs nothing.
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (b >= 256 - (256 % ALPHABET.length)) continue;
      out.push(ALPHABET[b % ALPHABET.length]);
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out.join('');
}

/** 'A7K9Q2MX' -> 'A7K9-Q2MX'. Dashes are for reading; they are never stored. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export class InvitationRepo {
  constructor(
    private readonly d1: D1Database,
    private readonly audit: AuditRepo,
    private readonly pepper: string,
  ) {}

  private hash(code: string): Promise<string> {
    return hashField(this.pepper, normalizeCrockford(code));
  }

  /**
   * Issues a code for a lease, revoking whatever was outstanding for it.
   *
   * Returns the plaintext once. Nothing stores it and nothing can show it
   * again: a QR already handed out or taped to a door must stop working the
   * moment a replacement is printed, or two codes claim the same room.
   */
  async issue(ctx: TenantContext, contractId: string): Promise<{ code: string; expiresAt: string }> {
    const code = newCode();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + VALID_DAYS * 86400_000).toISOString();
    const invitationId = ulid();

    await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE invitation SET status = 'REVOKED', revoked_by = ?, revoked_at = ?,
                                 revoke_reason = 'reissued'
            WHERE tenant_id = ? AND status = 'ACTIVE'
              AND invitation_id IN (SELECT invitation_id FROM contract_invitation
                                     WHERE tenant_id = ? AND contract_id = ?)`,
        )
        .bind(ctx.accountId, now, ctx.tenantId, ctx.tenantId, contractId),
      this.d1
        .prepare(
          `INSERT INTO invitation
             (tenant_id, invitation_id, purpose, delivery, verification, binding,
              secret_hash, secret_prefix, max_usage, used_count, requires_approval,
              expires_at, status, created_by, created_at)
           VALUES (?, ?, 'CLIENT', 'QR', 'LINE_LOGIN', 'TARGETED',
                   ?, ?, 1, 0, 0, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(ctx.tenantId, invitationId, await this.hash(code), code.slice(0, 4),
              expiresAt, ctx.accountId, now),
      this.d1
        .prepare(
          `INSERT INTO contract_invitation (tenant_id, invitation_id, contract_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(ctx.tenantId, invitationId, contractId, now),
      this.audit.statement(ctx, {
        action: 'invitation.created', targetType: 'contract', targetId: contractId,
      }),
    ]);

    return { code, expiresAt };
  }

  /** The invitation that still matters for a lease: newest, not revoked. */
  async current(ctx: TenantContext, contractId: string): Promise<InvitationView | null> {
    const row = await this.d1
      .prepare(
        `SELECT i.invitation_id, ci.contract_id, i.secret_prefix, i.status,
                i.expires_at, i.used_count, i.created_at
           FROM invitation i
           JOIN contract_invitation ci
             ON ci.tenant_id = i.tenant_id AND ci.invitation_id = i.invitation_id
          WHERE i.tenant_id = ? AND ci.contract_id = ? AND i.status <> 'REVOKED'
          ORDER BY i.created_at DESC LIMIT 1`,
      )
      .bind(ctx.tenantId, contractId)
      .first<Omit<InvitationView, 'expired'>>();
    if (!row) return null;
    return { ...row, expired: row.expires_at <= new Date().toISOString() };
  }

  async revoke(ctx: TenantContext, invitationId: string, reason: string): Promise<string> {
    const link = await this.d1
      .prepare('SELECT contract_id FROM contract_invitation WHERE tenant_id = ? AND invitation_id = ?')
      .bind(ctx.tenantId, invitationId)
      .first<{ contract_id: string }>();
    if (!link) throw new NotFoundError('invitation');

    const [res] = await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE invitation SET status = 'REVOKED', revoked_by = ?, revoked_at = ?, revoke_reason = ?
            WHERE tenant_id = ? AND invitation_id = ? AND status = 'ACTIVE'`,
        )
        .bind(ctx.accountId, new Date().toISOString(), reason, ctx.tenantId, invitationId),
      this.audit.statement(ctx, {
        action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, reason,
      }),
    ]);
    if (!res.meta.changes) throw new GuardFailedError('invitation.revoke');
    return link.contract_id;
  }

  /**
   * Resolves a code to the lease it opens, and to the tenant that owns it.
   *
   * Deliberately without a TenantContext: the holder has no account and no
   * membership yet, so there is nothing to resolve a tenant from except the
   * code. Everything downstream of this uses the tenant_id found here, which is
   * why the check is on status and expiry and not merely on the hash matching.
   */
  async lookup(code: string): Promise<{
    tenantId: string; invitationId: string; contractId: string;
  } | null> {
    const row = await this.d1
      .prepare(
        `SELECT i.tenant_id, i.invitation_id, ci.contract_id
           FROM invitation i
           JOIN contract_invitation ci
             ON ci.tenant_id = i.tenant_id AND ci.invitation_id = i.invitation_id
           JOIN contract c
             ON c.tenant_id = ci.tenant_id AND c.contract_id = ci.contract_id
          WHERE i.secret_hash = ? AND i.status = 'ACTIVE' AND i.expires_at > ?
            AND i.used_count < i.max_usage
            AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL`,
      )
      .bind(await this.hash(code), new Date().toISOString())
      .first<{ tenant_id: string; invitation_id: string; contract_id: string }>();
    if (!row) return null;
    return { tenantId: row.tenant_id, invitationId: row.invitation_id, contractId: row.contract_id };
  }
}
