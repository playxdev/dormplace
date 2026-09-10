/**
 * TenantContext — the only place a tenant_id may come from.
 *
 * STANDARD §9.4. It is built server-side from a resolved membership and is
 * immutable for the life of the request. Nothing in a request body, query
 * string, header or webhook payload may reach this object without having been
 * checked against membership first.
 *
 * D1 has no row-level security (STANDARD §9.5): on PostgreSQL a forgotten
 * `WHERE tenant_id = ?` is caught by the engine, and here it is not caught by
 * anything. That is why the repository layer takes this as its first argument
 * with no default — a caller that has not resolved a tenant cannot reach the
 * data at all, because it has nothing to pass.
 */

export type MembershipKind = 'CLIENT' | 'STAFF' | 'PLATFORM';

export interface TenantContext {
  readonly tenantId: string;
  readonly accountId: string;
  readonly membershipId: string;
  readonly kind: MembershipKind;
  readonly permissions: readonly string[];
  readonly requestId: string;
  /** tenant.timezone. Used at display only — every stored timestamp is UTC. */
  readonly timezone: string;
  /**
   * Set only while a platform admin is impersonating (STANDARD §11.2). Every
   * audit row written under this context records it, so support access is never
   * indistinguishable from the customer's own actions.
   */
  readonly onBehalfOf?: string;
}

/**
 * The error a caller sees for a row that does not exist AND for a row that
 * exists in another tenant. They must be the same error: answering 403 for the
 * second confirms the id is real, which is how an enumeration attack maps one
 * tenant's data from another tenant's session. Cross-tenant is always 404.
 */
export class NotFoundError extends Error {
  readonly code = 'not_found';
  constructor(what = 'resource') {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** Authenticated, resolved to a tenant, but lacking the permission. */
export class ForbiddenError extends Error {
  readonly code = 'forbidden';
  constructor(readonly permission: string) {
    super(`missing permission: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

/** A write lost an optimistic-concurrency race and must be retried on fresh data. */
export class ConflictError extends Error {
  readonly code = 'conflict';
  constructor(what = 'resource') {
    super(`${what} was modified by someone else`);
    this.name = 'ConflictError';
  }
}

/**
 * A guarded batch did not affect the row it guarded.
 *
 * D1 gives no interactive transaction, so a multi-statement write is a batch()
 * whose first statement is the guard. If the guard matches nothing the whole
 * batch has to fail rather than proceed on an assumption that turned out false.
 */
export class GuardFailedError extends Error {
  readonly code = 'guard_failed';
  constructor(what: string) {
    super(`guard failed: ${what}`);
    this.name = 'GuardFailedError';
  }
}

/**
 * A context for work with no human actor: scheduled billing, webhook intake,
 * migrations. It still carries a tenant_id, because there is no such thing as
 * an untenanted write to a tenant-scoped table.
 */
export function systemContext(tenantId: string, requestId: string, timezone = 'Asia/Bangkok'): TenantContext {
  return {
    tenantId,
    accountId: 'SYSTEM',
    membershipId: 'SYSTEM',
    kind: 'PLATFORM',
    permissions: ['*'],
    requestId,
    timezone,
  };
}
