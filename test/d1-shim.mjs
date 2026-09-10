/**
 * A D1Database over node:sqlite, enough of it to run the repository layer.
 *
 * The isolation conformance suite has to run somewhere. Miniflare would bring
 * a test framework and a worker runtime with it; node:sqlite is in the runtime
 * already and D1 is SQLite underneath, so the surface the repos actually use —
 * prepare / bind / all / first / run / batch — is a page of code.
 *
 * What this does NOT model: D1's network latency, its per-query row limits, or
 * batch semantics beyond running statements in order inside one transaction.
 * Anything depending on those needs a real D1.
 */

import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }
  #prepared() {
    return this.db.prepare(this.sql);
  }
  async all() {
    const results = this.#prepared().all(...this.args);
    return { results, success: true, meta: { changes: 0, rows_read: results.length } };
  }
  async first(column) {
    const row = this.#prepared().get(...this.args) ?? null;
    if (row && column !== undefined) return row[column] ?? null;
    return row;
  }
  async run() {
    const r = this.#prepared().run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes) } };
  }
  /** batch() needs both the change count and any rows a SELECT produced. */
  execForBatch() {
    const prepared = this.#prepared();
    // node:sqlite throws if you call all() on a statement returning no columns.
    if (/^\s*select/i.test(this.sql)) {
      const results = prepared.all(...this.args);
      return { results, success: true, meta: { changes: 0, rows_read: results.length } };
    }
    const r = prepared.run(...this.args);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
}

export class D1Shim {
  constructor(schemaSql = []) {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    for (const sql of schemaSql) this.db.exec(sql);
  }
  prepare(sql) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts) {
    // D1 runs a batch as one transaction. Statements that change zero rows are
    // not errors to SQLite, which is exactly why the guard has to be checked by
    // the caller rather than relied on to roll anything back.
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.execForBatch());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}
