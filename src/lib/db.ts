import type { Building, Contract, Invoice, InvoiceItem, MeterReading, Payment, Room, Tenant, Ticket, User } from '../types';

/** Thin typed helpers over D1. Every query here is parameterised. */
export class Db {
  constructor(private d1: D1Database) {}

  all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.d1.prepare(sql).bind(...args).all<T>().then((r) => r.results ?? []);
  }
  one<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return this.d1.prepare(sql).bind(...args).first<T>();
  }
  run(sql: string, ...args: unknown[]) {
    return this.d1.prepare(sql).bind(...args).run();
  }
  batch(stmts: D1PreparedStatement[]) {
    return this.d1.batch(stmts);
  }
  prep(sql: string, ...args: unknown[]) {
    return this.d1.prepare(sql).bind(...args);
  }

  /* ---------- users & sessions ---------- */
  userCount() {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM users').then((r) => r?.n ?? 0);
  }
  userByEmail(email: string) {
    return this.one<User>('SELECT * FROM users WHERE email = ?', email.toLowerCase());
  }
  userBySession(sid: string) {
    return this.one<User>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
      sid,
    );
  }

  /* ---------- buildings ---------- */
  buildings() {
    return this.all<Building>('SELECT * FROM buildings ORDER BY name');
  }
  building(id: string) {
    return this.one<Building>('SELECT * FROM buildings WHERE id = ?', id);
  }
  firstBuilding() {
    return this.one<Building>('SELECT * FROM buildings ORDER BY created_at LIMIT 1');
  }

  /* ---------- rooms ---------- */
  rooms(buildingId?: string) {
    return buildingId
      ? this.all<Room>('SELECT * FROM rooms WHERE building_id = ? ORDER BY floor, number', buildingId)
      : this.all<Room>('SELECT * FROM rooms ORDER BY building_id, floor, number');
  }
  room(id: string) {
    return this.one<Room>('SELECT * FROM rooms WHERE id = ?', id);
  }

  /* ---------- tenants ---------- */
  tenants(q?: string) {
    if (q) {
      const like = `%${q}%`;
      return this.all<Tenant>(
        'SELECT * FROM tenants WHERE name LIKE ? OR phone LIKE ? OR id_card_no LIKE ? ORDER BY name',
        like, like, like,
      );
    }
    return this.all<Tenant>('SELECT * FROM tenants ORDER BY name');
  }
  tenant(id: string) {
    return this.one<Tenant>('SELECT * FROM tenants WHERE id = ?', id);
  }

  /* ---------- contracts ---------- */
  contract(id: string) {
    return this.one<Contract>('SELECT * FROM contracts WHERE id = ?', id);
  }
  activeContractForRoom(roomId: string) {
    return this.one<Contract>(
      "SELECT * FROM contracts WHERE room_id = ? AND status = 'active' ORDER BY start_date DESC LIMIT 1",
      roomId,
    );
  }
  /** Contracts joined with room + tenant, ready for list screens. */
  contractRows(status?: 'active' | 'ended') {
    const where = status ? 'WHERE c.status = ?' : '';
    const args = status ? [status] : [];
    return this.all<ContractRow>(
      `SELECT c.*, r.number AS room_number, r.floor AS room_floor, r.building_id,
              b.name AS building_name, t.name AS tenant_name, t.phone AS tenant_phone
         FROM contracts c
         JOIN rooms r ON r.id = c.room_id
         JOIN buildings b ON b.id = r.building_id
         JOIN tenants t ON t.id = c.tenant_id
         ${where}
        ORDER BY b.name, r.floor, r.number`,
      ...args,
    );
  }

  /* ---------- meters ---------- */
  readingsForPeriod(buildingId: string, period: string) {
    return this.all<MeterReading>(
      `SELECT m.* FROM meter_readings m JOIN rooms r ON r.id = m.room_id
       WHERE r.building_id = ? AND m.period = ?`,
      buildingId, period,
    );
  }
  lastReadingBefore(roomId: string, kind: 'water' | 'electric', period: string) {
    return this.one<MeterReading>(
      'SELECT * FROM meter_readings WHERE room_id = ? AND kind = ? AND period < ? ORDER BY period DESC LIMIT 1',
      roomId, kind, period,
    );
  }

  /* ---------- invoices ---------- */
  invoice(id: string) {
    return this.one<Invoice>('SELECT * FROM invoices WHERE id = ?', id);
  }
  invoiceItems(invoiceId: string) {
    return this.all<InvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, rowid', invoiceId);
  }
  payments(invoiceId: string) {
    return this.all<Payment>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at', invoiceId);
  }
  invoiceRows(opts: { period?: string; status?: string; tenantId?: string; limit?: number } = {}) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.period) { where.push('i.period = ?'); args.push(opts.period); }
    if (opts.status) { where.push('i.status = ?'); args.push(opts.status); }
    if (opts.tenantId) { where.push('i.tenant_id = ?'); args.push(opts.tenantId); }
    const limit = opts.limit ?? 500;
    return this.all<InvoiceRow>(
      `SELECT i.*, r.number AS room_number, t.name AS tenant_name, b.name AS building_name
         FROM invoices i
         JOIN rooms r ON r.id = i.room_id
         JOIN tenants t ON t.id = i.tenant_id
         JOIN buildings b ON b.id = i.building_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.period DESC, r.floor, r.number
        LIMIT ${limit}`,
      ...args,
    );
  }

  /* ---------- counters ---------- */
  async nextSeq(key: string): Promise<number> {
    await this.run(
      'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1',
      key,
    );
    const row = await this.one<{ value: number }>('SELECT value FROM counters WHERE key = ?', key);
    return row?.value ?? 1;
  }

  /* ---------- tickets ---------- */
  ticketRows(status?: string) {
    const where = status ? 'WHERE k.status = ?' : '';
    const args = status ? [status] : [];
    return this.all<TicketRow>(
      `SELECT k.*, r.number AS room_number, b.name AS building_name, t.name AS tenant_name
         FROM tickets k
         JOIN rooms r ON r.id = k.room_id
         JOIN buildings b ON b.id = r.building_id
         LEFT JOIN tenants t ON t.id = k.tenant_id
         ${where}
        ORDER BY CASE k.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, k.created_at DESC`,
      ...args,
    );
  }
}

export type ContractRow = Contract & {
  room_number: string; room_floor: number; building_id: string;
  building_name: string; tenant_name: string; tenant_phone: string | null;
};
export type InvoiceRow = Invoice & { room_number: string; tenant_name: string; building_name: string };
export type TicketRow = Ticket & { room_number: string; building_name: string; tenant_name: string | null };
