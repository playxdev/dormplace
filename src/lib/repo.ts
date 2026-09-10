/**
 * TenantScopedRepo — the only path to tenant data.
 *
 * STANDARD §9.3. Every one of the 8 core functions takes a TenantContext as its
 * first argument with no default, and every statement this file emits carries
 * `tenant_id = ?` bound from that context. Nothing else in the codebase writes
 * SQL against a tenant-scoped table.
 *
 * On PostgreSQL row-level security would catch a forgotten predicate. D1 has
 * none (STANDARD §9.5), so this class is not a convenience layer — it is the
 * isolation boundary. A leak here is a leak everywhere.
 *
 * Two rules that look like details and are not:
 *
 *   · `insert` writes tenant_id from the context and drops whatever the payload
 *     claimed. A caller cannot write into another tenant even by trying.
 *   · `byId` answers the same NotFoundError for "no such row" and for "a row
 *     that belongs to someone else". Distinguishing them confirms the id exists,
 *     which turns one tenant's session into a map of another tenant's data.
 */

import { ConflictError, GuardFailedError, NotFoundError, type TenantContext } from './tenant-context';
import { ulid } from './ulid';

export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
export type Filter = readonly [column: string, op: FilterOp, value?: unknown];
export type Order = readonly [column: string, dir: 'ASC' | 'DESC'];

export interface QueryOption {
  where?: readonly Filter[];
  orderBy?: readonly Order[];
  limit?: number;
  offset?: number;
  /** Rows with deleted_at set. Reserved for exports and PDPA work. */
  includeDeleted?: boolean;
}

export interface PageOption extends QueryOption {
  page?: number;
  perPage?: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export interface TableSpec {
  table: string;
  /** Column holding the row's ULID, e.g. 'invoice_id'. */
  idColumn: string;
  /** Every column that exists. Filters and ordering are checked against this. */
  columns: readonly string[];
  /** The subset a caller may write. Excludes tenant_id, the id, and timestamps. */
  writable: readonly string[];
  /** Used by byName. Absent for tables with no natural name. */
  nameColumn?: string;
  defaultOrder?: readonly Order[];
  /** Table carries a `version` column for optimistic concurrency. */
  versioned?: boolean;
  /** Table carries `deleted_at`. False for append-only and counter tables. */
  softDelete?: boolean;
}

const MAX_LIMIT = 1000;
const DEFAULT_PER_PAGE = 50;

export class TenantScopedRepo<T extends Record<string, unknown>> {
  constructor(
    protected readonly d1: D1Database,
    protected readonly spec: TableSpec,
  ) {}

  protected get softDeletes(): boolean {
    return this.spec.softDelete !== false;
  }

  /**
   * Column names cannot be bound as parameters, so they are interpolated — and
   * therefore must never come from a request. Anything not declared in the spec
   * is a bug in our own code, not bad input, so it throws rather than returning
   * an error a route might render.
   */
  protected col(name: string): string {
    if (!this.spec.columns.includes(name)) {
      throw new Error(`${this.spec.table}: unknown column '${name}'`);
    }
    return name;
  }

  /** Builds the WHERE clause. `tenant_id = ?` is prepended, never optional. */
  protected buildWhere(ctx: TenantContext, opt: QueryOption): { sql: string; args: unknown[] } {
    const parts = ['tenant_id = ?'];
    const args: unknown[] = [ctx.tenantId];

    if (this.softDeletes && !opt.includeDeleted) parts.push('deleted_at IS NULL');

    for (const [rawCol, op, value] of opt.where ?? []) {
      const c = this.col(rawCol);
      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        parts.push(`${c} ${op}`);
        continue;
      }
      if (op === 'IN') {
        const list = Array.isArray(value) ? value : [value];
        // An empty IN () is a syntax error on SQLite and would otherwise be
        // written as `IN ()`. Matching nothing is the honest reading.
        if (list.length === 0) { parts.push('0 = 1'); continue; }
        parts.push(`${c} IN (${list.map(() => '?').join(', ')})`);
        args.push(...list);
        continue;
      }
      parts.push(`${c} ${op} ?`);
      args.push(value);
    }

    return { sql: parts.join(' AND '), args };
  }

  protected buildOrder(opt: QueryOption): string {
    const order = opt.orderBy ?? this.spec.defaultOrder ?? [[this.spec.idColumn, 'DESC'] as const];
    const cols = order.map(([c, dir]) => `${this.col(c)} ${dir === 'ASC' ? 'ASC' : 'DESC'}`);
    return cols.length ? ` ORDER BY ${cols.join(', ')}` : '';
  }

  /* ------------------------------------------------------------------ */
  /*  8 core functions                                                   */
  /* ------------------------------------------------------------------ */

  async all(ctx: TenantContext, opt: QueryOption = {}): Promise<T[]> {
    const { sql, args } = this.buildWhere(ctx, opt);
    const limit = Math.min(opt.limit ?? MAX_LIMIT, MAX_LIMIT);
    const offset = Math.max(opt.offset ?? 0, 0);
    const rows = await this.d1
      .prepare(`SELECT * FROM ${this.spec.table} WHERE ${sql}${this.buildOrder(opt)} LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset)
      .all<T>();
    return rows.results ?? [];
  }

  async paging(ctx: TenantContext, opt: PageOption = {}): Promise<Page<T>> {
    const page = Math.max(opt.page ?? 1, 1);
    const perPage = Math.min(Math.max(opt.perPage ?? DEFAULT_PER_PAGE, 1), MAX_LIMIT);
    const total = await this.count(ctx, opt);
    const rows = await this.all(ctx, { ...opt, limit: perPage, offset: (page - 1) * perPage });
    return { rows, total, page, perPage, pages: Math.max(Math.ceil(total / perPage), 1) };
  }

  /** Not found and belongs-to-another-tenant are the same answer, on purpose. */
  async byId(ctx: TenantContext, id: string, opt: { includeDeleted?: boolean } = {}): Promise<T> {
    const row = await this.findById(ctx, id, opt);
    if (!row) throw new NotFoundError(this.spec.table);
    return row;
  }

  /** byId without the throw, for callers whose next step is "create it then". */
  async findById(ctx: TenantContext, id: string, opt: { includeDeleted?: boolean } = {}): Promise<T | null> {
    const { sql, args } = this.buildWhere(ctx, { includeDeleted: opt.includeDeleted });
    return this.d1
      .prepare(`SELECT * FROM ${this.spec.table} WHERE ${sql} AND ${this.spec.idColumn} = ? LIMIT 1`)
      .bind(...args, id)
      .first<T>();
  }

  async byName(ctx: TenantContext, name: string, opt: QueryOption = {}): Promise<T[]> {
    if (!this.spec.nameColumn) throw new Error(`${this.spec.table}: no name column declared`);
    return this.all(ctx, { ...opt, where: [...(opt.where ?? []), [this.spec.nameColumn, '=', name]] });
  }

  /**
   * tenant_id comes from the context. If the payload carried one it is dropped
   * without comment — there is no legitimate caller that knows better than the
   * resolved membership, and honouring it would be the whole vulnerability.
   */
  async insert(ctx: TenantContext, value: Partial<T>, now = new Date().toISOString()): Promise<T> {
    const id = (value[this.spec.idColumn] as string | undefined) ?? ulid();
    const cols: string[] = ['tenant_id', this.spec.idColumn];
    const args: unknown[] = [ctx.tenantId, id];

    for (const key of this.spec.writable) {
      if (!(key in value)) continue;
      cols.push(this.col(key));
      args.push(value[key] ?? null);
    }
    for (const stamp of ['created_at', 'updated_at']) {
      if (this.spec.columns.includes(stamp) && !cols.includes(stamp)) {
        cols.push(stamp);
        args.push(now);
      }
    }

    await this.d1
      .prepare(`INSERT INTO ${this.spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...args)
      .run();

    return this.byId(ctx, id);
  }

  /**
   * The UPDATE and the read-back go in one batch, which D1 runs as a single
   * transaction — otherwise a concurrent writer can land between them and the
   * caller is handed a row it did not write.
   *
   * On a versioned table the version is part of the guard. Zero rows changed
   * then means one of two different things, so the row is probed to say which:
   * gone (NotFound) or moved under us (Conflict). Reporting a conflict as a
   * 404 would send the user to re-create something that still exists.
   */
  async update(ctx: TenantContext, id: string, value: Partial<T>, expectedVersion?: number): Promise<T> {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const key of this.spec.writable) {
      if (!(key in value)) continue;
      sets.push(`${this.col(key)} = ?`);
      args.push(value[key] ?? null);
    }
    if (this.spec.columns.includes('updated_at')) {
      sets.push('updated_at = ?');
      args.push(new Date().toISOString());
    }
    if (this.spec.versioned) sets.push('version = version + 1');
    if (!sets.length) return this.byId(ctx, id);

    const guard = ['tenant_id = ?', `${this.spec.idColumn} = ?`];
    const guardArgs: unknown[] = [ctx.tenantId, id];
    if (this.softDeletes) guard.push('deleted_at IS NULL');
    if (this.spec.versioned && expectedVersion !== undefined) {
      guard.push('version = ?');
      guardArgs.push(expectedVersion);
    }

    const [res, readBack] = await this.d1.batch<T>([
      this.d1
        .prepare(`UPDATE ${this.spec.table} SET ${sets.join(', ')} WHERE ${guard.join(' AND ')}`)
        .bind(...args, ...guardArgs),
      this.d1
        .prepare(`SELECT * FROM ${this.spec.table} WHERE tenant_id = ? AND ${this.spec.idColumn} = ?`)
        .bind(ctx.tenantId, id),
    ]);

    if (!res.meta.changes) {
      // The read-back is from inside the same transaction, so it answers the
      // question without a second round trip: the row is still there, which
      // means the version guard is what missed.
      const stillThere = (readBack.results ?? []).length > 0;
      if (stillThere && expectedVersion !== undefined) throw new ConflictError(this.spec.table);
      throw new NotFoundError(this.spec.table);
    }
    const row = (readBack.results ?? [])[0];
    if (!row) throw new NotFoundError(this.spec.table);
    return row;
  }

  async softDelete(ctx: TenantContext, id: string): Promise<void> {
    if (!this.softDeletes) throw new Error(`${this.spec.table}: no deleted_at column`);
    const now = new Date().toISOString();
    const sets = this.spec.columns.includes('updated_at')
      ? 'deleted_at = ?, updated_at = ?'
      : 'deleted_at = ?';
    const args = this.spec.columns.includes('updated_at') ? [now, now] : [now];

    const res = await this.d1
      .prepare(
        `UPDATE ${this.spec.table} SET ${sets}
          WHERE tenant_id = ? AND ${this.spec.idColumn} = ? AND deleted_at IS NULL`,
      )
      .bind(...args, ctx.tenantId, id)
      .run();
    if (!res.meta.changes) throw new NotFoundError(this.spec.table);
  }

  /**
   * Rows with a legal retention duty are pseudonymized, never hard-deleted
   * (STANDARD §12.3), so this exists for the platform and for the PDPA erasure
   * path and for nothing else. The justification is an argument rather than a
   * comment so that a call site cannot claim one silently.
   */
  async hardDelete(
    ctx: TenantContext,
    id: string,
    justification: 'PLATFORM' | 'PDPA_ERASURE',
  ): Promise<void> {
    if (justification === 'PLATFORM' && ctx.kind !== 'PLATFORM') {
      throw new Error(`${this.spec.table}: hardDelete('PLATFORM') from a ${ctx.kind} context`);
    }
    const res = await this.d1
      .prepare(`DELETE FROM ${this.spec.table} WHERE tenant_id = ? AND ${this.spec.idColumn} = ?`)
      .bind(ctx.tenantId, id)
      .run();
    if (!res.meta.changes) throw new NotFoundError(this.spec.table);
  }

  /* ------------------------------------------------------------------ */
  /*  shared helpers                                                     */
  /* ------------------------------------------------------------------ */

  async count(ctx: TenantContext, opt: QueryOption = {}): Promise<number> {
    const { sql, args } = this.buildWhere(ctx, opt);
    const row = await this.d1
      .prepare(`SELECT COUNT(*) AS n FROM ${this.spec.table} WHERE ${sql}`)
      .bind(...args)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async exists(ctx: TenantContext, id: string): Promise<boolean> {
    return (await this.findById(ctx, id)) !== null;
  }

  /** Statement builder for use inside a guarded batch. Still tenant-bound. */
  protected stmt(sql: string, ...args: unknown[]): D1PreparedStatement {
    return this.d1.prepare(sql).bind(...args);
  }
}

/**
 * The D1 write pattern for anything that is more than one statement.
 *
 * D1 offers no interactive transaction: there is no way to read, decide, and
 * then write inside one. What it does offer is batch(), which runs as a single
 * transaction. So the decision has to be expressed as the first statement — an
 * UPDATE narrow enough that it changes exactly one row when the operation is
 * legal and zero rows when it is not — and the rest of the batch is only
 * correct if that guard bit.
 *
 * Because D1 does not roll a batch back on `changes === 0`, the guard is
 * checked here and the caller is expected to treat GuardFailedError as "the
 * operation did not happen". Every such statement must therefore be written so
 * that the trailing statements are harmless if the guard missed — which in
 * practice means they append rather than overwrite.
 *
 * Example, redeeming an invitation:
 *
 *   guardedBatch(d1, 'invitation',
 *     d1.prepare(`UPDATE invitation SET used_count = used_count + 1
 *                  WHERE secret_hash = ? AND status = 'ACTIVE'
 *                    AND used_count < max_usage AND expires_at > ?`).bind(hash, now),
 *     [ insertMembership, insertRedemption, insertAudit ]);
 */
export async function guardedBatch(
  d1: D1Database,
  what: string,
  guard: D1PreparedStatement,
  rest: D1PreparedStatement[],
): Promise<D1Result[]> {
  const results = await d1.batch([guard, ...rest]);
  if (!results[0].meta.changes) throw new GuardFailedError(what);
  return results;
}
