/**
 * AUDIT_EVENT — append-only (STANDARD §10).
 *
 * Not a TenantScopedRepo: audit rows are never updated, never deleted, and
 * carry a nullable tenant_id because platform-level actions have no tenant.
 * Everything the class exposes appends.
 *
 * Rule 8 of the standard: every status change records actor, time and reason,
 * and writes one of these. Rule 9: no UPDATE, no DELETE, ever — including
 * during a PDPA erasure, where the audit trail is exactly what has to survive
 * (INV-21).
 */

import type { TenantContext } from '../lib/tenant-context';
import { ulid } from '../lib/ulid';

export type AuditResult = 'SUCCESS' | 'DENIED' | 'ERROR';

export interface AuditInput {
  action: string;              // 'contract.ended', 'payment.verified'
  targetType?: string;
  targetId?: string;
  result?: AuditResult;
  reason?: string;
  /** Already redacted. Never put a national ID or a full phone number here. */
  changes?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Actions that must carry a reason (STANDARD §10.2). Listed rather than
 * inferred, so adding a destructive action forces a decision about it.
 */
const REASON_REQUIRED = new Set([
  'tenant.suspended', 'tenant.terminated',
  'membership.suspended', 'membership.released', 'membership.banned',
  'invitation.revoked',
  'contract.ended', 'contract.amended',
  'invoice.voided',
  'payment.rejected',
  'meter.corrected',
  'resident.pii_viewed',
  'data.erased',
]);

export class AuditRepo {
  constructor(private readonly d1: D1Database) {}

  /**
   * A missing reason on an action that requires one throws rather than writing
   * a weaker row. An audit trail that records "someone voided this invoice" and
   * not why is the trail failing at the one moment it exists for.
   */
  statement(ctx: TenantContext, input: AuditInput): D1PreparedStatement {
    if (REASON_REQUIRED.has(input.action) && !input.reason?.trim()) {
      throw new Error(`audit: action '${input.action}' requires a reason`);
    }
    return this.d1
      .prepare(
        `INSERT INTO audit_event
           (event_id, occurred_at, tenant_id, actor_type, actor_account_id, on_behalf_of,
            action, target_type, target_id, result, reason, changes, ip, user_agent, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ulid(),
        new Date().toISOString(),
        ctx.tenantId,
        ctx.kind,
        ctx.accountId,
        ctx.onBehalfOf ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.result ?? 'SUCCESS',
        input.reason ?? null,
        input.changes === undefined ? null : JSON.stringify(input.changes),
        input.ip ?? null,
        input.userAgent ?? null,
        ctx.requestId,
      );
  }

  /**
   * Writes on its own. Prefer `statement()` inside the same batch as the change
   * being audited — a separate write can succeed while the change fails, or the
   * reverse, and either way the trail stops matching the data.
   */
  async write(ctx: TenantContext, input: AuditInput): Promise<void> {
    await this.statement(ctx, input).run();
  }

  /** Denied attempts are audited too: a permission check that fails is a fact. */
  denied(ctx: TenantContext, action: string, targetId?: string): D1PreparedStatement {
    return this.statement(ctx, { action, targetId, result: 'DENIED' });
  }
}
