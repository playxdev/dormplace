/**
 * The repository layer.
 *
 * `new Repos(env.DB)` is the only object a route needs, and every method on it
 * takes a TenantContext first. Nothing outside this directory writes SQL
 * against a tenant-scoped table (STANDARD §9.3) — CI greps for it.
 */

import { TenantScopedRepo, guardedBatch, type Page, type PageOption, type QueryOption } from '../lib/repo';
import { decryptField, encryptField, hashField, lastFour, maskPhone, normalizePhone } from '../lib/crypto';
import { KeyRepo } from './keys';
import { InvitationRepo } from './invitation';
import { ForbiddenError, GuardFailedError, NotFoundError, type TenantContext } from '../lib/tenant-context';
import { has } from '../lib/perm';
import { ulid } from '../lib/ulid';
import { AuditRepo } from './audit';
import * as spec from './specs';
import type {
  Announcement, Building, Contract, EffectiveInvoiceStatus, Invoice,
  InvoiceItem, Membership, MeterReading, MeterWalk, Party, Payment,
  ResidentProfile, Role, Room, Ticket,
} from './types';

/** An invoice as every list screen wants it. */
export type InvoiceRow = Invoice & {
  room_number: string;
  room_floor: number;
  party_name: string | null;
  building_name: string;
  /** Verified payments only. */
  paid: number;
  effective_status: EffectiveInvoiceStatus;
};

/* ------------------------------------------------------------------ */
/*  Repos with behaviour beyond the 8 core functions                    */
/* ------------------------------------------------------------------ */

/**
 * Secrets the personal-data paths need. Absent, those paths throw rather than
 * writing a national ID or a phone number in the clear.
 */
export interface CryptoSecrets {
  DATA_MASTER_KEY: string;
  PII_PEPPER: string;
}

/** A resident as a screen wants them: the party, its profile, nothing decrypted. */
export type Resident = Party & {
  national_id_last4: string | null;
  registered_address: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  profile_note: string | null;
};

export interface ResidentInput {
  display_name: string;
  phone?: string | null;
  email?: string | null;
  national_id?: string | null;
  registered_address?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  note?: string | null;
}

/**
 * PARTY plus the dorm-specific profile beside it.
 *
 * A resident is not one table, and should not be: PARTY is core and holds what
 * every vertical needs, while a national ID and an emergency contact are ours.
 * Callers see one object; the split stays here.
 *
 * Nothing on the way in is stored in the clear. A phone number becomes three
 * columns — a hash to match on, a mask to display, a ciphertext to reveal with
 * permission — and the national ID becomes ciphertext plus its last four
 * digits, which is what a person at the desk actually needs to confirm.
 */
export class PartyRepo extends TenantScopedRepo<Party> {
  private readonly keys: KeyRepo;

  constructor(d1: D1Database, private readonly audit: AuditRepo, private readonly secrets: CryptoSecrets) {
    super(d1, spec.partySpec);
    this.keys = new KeyRepo(d1, secrets?.DATA_MASTER_KEY ?? '');
  }

  private assertSecrets() {
    if (!this.secrets?.DATA_MASTER_KEY || !this.secrets?.PII_PEPPER) {
      throw new Error('DATA_MASTER_KEY and PII_PEPPER must be set before personal data can be stored');
    }
  }

  /** The list screen: party joined to its profile, plus the room if any. */
  async listResidents(ctx: TenantContext, q?: string): Promise<(Resident & {
    room_number: string | null; building_name: string | null;
  })[]> {
    const like = q ? `%${q}%` : null;
    const res = await this.d1
      .prepare(
        `SELECT p.*, rp.national_id_last4, rp.registered_address, rp.emergency_name,
                rp.emergency_relation, rp.note AS profile_note,
                rm.number AS room_number, b.name AS building_name
           FROM party p
           LEFT JOIN resident_profile rp
                  ON rp.tenant_id = p.tenant_id AND rp.party_id = p.party_id AND rp.deleted_at IS NULL
           LEFT JOIN contract c
                  ON c.tenant_id = p.tenant_id AND c.party_id = p.party_id
                 AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
           LEFT JOIN room rm ON rm.tenant_id = c.tenant_id AND rm.room_id = c.room_id
           LEFT JOIN building b ON b.tenant_id = rm.tenant_id AND b.building_id = rm.building_id
          WHERE p.tenant_id = ? AND p.deleted_at IS NULL
            ${q ? 'AND (p.display_name LIKE ? OR p.phone_masked LIKE ? OR rp.national_id_last4 LIKE ?)' : ''}
          ORDER BY p.display_name`,
      )
      .bind(...(q ? [ctx.tenantId, like, like, like] : [ctx.tenantId]))
      .all<Resident & { room_number: string | null; building_name: string | null }>();
    return res.results ?? [];
  }

  async resident(ctx: TenantContext, partyId: string): Promise<Resident> {
    const party = await this.byId(ctx, partyId);
    const profile = await this.d1
      .prepare(
        `SELECT national_id_last4, registered_address, emergency_name, emergency_relation, note
           FROM resident_profile WHERE tenant_id = ? AND party_id = ? AND deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, partyId)
      .first<Record<string, string | null>>();
    return {
      ...party,
      national_id_last4: profile?.national_id_last4 ?? null,
      registered_address: profile?.registered_address ?? null,
      emergency_name: profile?.emergency_name ?? null,
      emergency_relation: profile?.emergency_relation ?? null,
      profile_note: profile?.note ?? null,
    };
  }

  /**
   * Reveals a national ID. Requires app.resident.pii_view and writes an audit
   * row every single time (STANDARD §12.5) — the audit is not a side effect
   * here, it is half the reason the permission exists.
   */
  async revealNationalId(ctx: TenantContext, partyId: string, reason: string): Promise<string | null> {
    if (!has(ctx, 'app.resident.pii_view')) throw new ForbiddenError('app.resident.pii_view');
    this.assertSecrets();
    const row = await this.d1
      .prepare('SELECT national_id_enc FROM resident_profile WHERE tenant_id = ? AND party_id = ?')
      .bind(ctx.tenantId, partyId)
      .first<{ national_id_enc: string | null }>();

    await this.audit.write(ctx, {
      action: 'resident.pii_viewed', targetType: 'party', targetId: partyId, reason,
    });
    if (!row?.national_id_enc) return null;
    const key = await this.keys.forSubject(partyId);
    return decryptField(key, row.national_id_enc);
  }

  async createResident(ctx: TenantContext, input: ResidentInput): Promise<Party> {
    this.assertSecrets();
    const party = await this.insert(ctx, {
      kind: 'PRIMARY',
      display_name: input.display_name,
      created_by: 'STAFF',
    } as Partial<Party>);
    await this.writePersonalData(ctx, party.party_id, input, true);
    return party;
  }

  async updateResident(ctx: TenantContext, partyId: string, input: ResidentInput): Promise<void> {
    this.assertSecrets();
    await this.update(ctx, partyId, { display_name: input.display_name } as Partial<Party>);
    await this.writePersonalData(ctx, partyId, input, false);
  }

  /**
   * The encrypted half, for both create and update.
   *
   * The data key is fetched once and used for every field, so a shredded
   * subject fails here before anything is written rather than half way through.
   */
  private async writePersonalData(
    ctx: TenantContext,
    partyId: string,
    input: ResidentInput,
    isNew: boolean,
  ): Promise<void> {
    const { PII_PEPPER } = this.secrets;
    const key = await this.keys.forSubject(partyId);
    const now = new Date().toISOString();

    const phone = input.phone?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;
    const nationalId = input.national_id?.replace(/\D/g, '') || null;
    const emergencyPhone = input.emergency_phone?.trim() || null;

    await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE party SET phone_hash = ?, phone_masked = ?, phone_enc = ?,
                            email_hash = ?, email_enc = ?, updated_at = ?, version = version + 1
            WHERE tenant_id = ? AND party_id = ? AND deleted_at IS NULL`,
        )
        .bind(
          phone ? await hashField(PII_PEPPER, normalizePhone(phone) ?? phone) : null,
          phone ? maskPhone(phone) : null,
          phone ? await encryptField(key, phone) : null,
          email ? await hashField(PII_PEPPER, email) : null,
          email ? await encryptField(key, email) : null,
          now, ctx.tenantId, partyId,
        ),
      this.d1
        .prepare(
          `INSERT INTO resident_profile
             (tenant_id, party_id, national_id_enc, national_id_last4, registered_address,
              emergency_name, emergency_phone_enc, emergency_relation, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, party_id) DO UPDATE SET
             national_id_enc = excluded.national_id_enc,
             national_id_last4 = excluded.national_id_last4,
             registered_address = excluded.registered_address,
             emergency_name = excluded.emergency_name,
             emergency_phone_enc = excluded.emergency_phone_enc,
             emergency_relation = excluded.emergency_relation,
             note = excluded.note,
             updated_at = excluded.updated_at`,
        )
        .bind(
          ctx.tenantId, partyId,
          nationalId ? await encryptField(key, nationalId) : null,
          nationalId ? lastFour(nationalId) : null,
          input.registered_address ?? null,
          input.emergency_name ?? null,
          emergencyPhone ? await encryptField(key, emergencyPhone) : null,
          input.emergency_relation ?? null,
          input.note ?? null,
          now, now,
        ),
      this.audit.statement(ctx, {
        action: isNew ? 'resident.created' : 'resident.updated',
        targetType: 'party',
        targetId: partyId,
        // Which fields were set, never their values.
        changes: {
          phone: Boolean(phone), email: Boolean(email), national_id: Boolean(nationalId),
        },
      }),
    ]);
  }

  /** Finds the parties a phone number could belong to, within this tenant only. */
  async byPhone(ctx: TenantContext, phone: string): Promise<Party[]> {
    this.assertSecrets();
    const hash = await hashField(this.secrets.PII_PEPPER, normalizePhone(phone) ?? phone);
    // Scoped like every other read: INV-31 forbids any path that could find a
    // party across tenants, even by hash.
    return this.all(ctx, { where: [['phone_hash', '=', hash]] });
  }
}

/** A room as the floor grid wants it: who is in it, what it owes, what is broken. */
export type RoomGridRow = Room & {
  party_name: string | null;
  contract_id: string | null;
  due: number;
  open_tickets: number;
};

export class RoomRepo extends TenantScopedRepo<Room> {
  constructor(d1: D1Database) {
    super(d1, spec.roomSpec);
  }

  /** Rooms available to put someone in, with the building they are in. */
  async vacant(ctx: TenantContext): Promise<(Room & { building_name: string })[]> {
    const res = await this.d1
      .prepare(
        `SELECT r.*, b.name AS building_name
           FROM room r
           JOIN building b ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
          WHERE r.tenant_id = ? AND r.status = 'VACANT' AND r.deleted_at IS NULL
          ORDER BY b.name, r.floor, r.number`,
      )
      .bind(ctx.tenantId)
      .all<Room & { building_name: string }>();
    return res.results ?? [];
  }

  forBuilding(ctx: TenantContext, buildingId: string): Promise<Room[]> {
    return this.all(ctx, { where: [['building_id', '=', buildingId]], limit: 1000 });
  }

  /**
   * The floor grid in one query.
   *
   * Occupancy, outstanding and open tickets per tile: three correlated
   * subqueries rather than three round trips per room. `due` counts verified
   * payments only, the same rule as everywhere else — a slip nobody has
   * accepted must not make a tile look settled.
   */
  async grid(ctx: TenantContext, buildingId: string): Promise<RoomGridRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT r.*, p.display_name AS party_name, c.contract_id,
                COALESCE((SELECT SUM(i.total) - COALESCE((
                            SELECT SUM(pay.amount) FROM payment pay
                             WHERE pay.tenant_id = i.tenant_id AND pay.invoice_id = i.invoice_id
                               AND pay.status = 'VERIFIED' AND pay.deleted_at IS NULL), 0)
                           FROM invoice i
                          WHERE i.tenant_id = r.tenant_id AND i.room_id = r.room_id
                            AND i.status = 'UNPAID' AND i.deleted_at IS NULL), 0) AS due,
                (SELECT COUNT(*) FROM ticket k
                  WHERE k.tenant_id = r.tenant_id AND k.room_id = r.room_id
                    AND k.status IN ('OPEN', 'IN_PROGRESS') AND k.deleted_at IS NULL) AS open_tickets
           FROM room r
           LEFT JOIN contract c ON c.tenant_id = r.tenant_id AND c.room_id = r.room_id
                               AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
           LEFT JOIN party p    ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
          WHERE r.tenant_id = ? AND r.building_id = ? AND r.deleted_at IS NULL
          ORDER BY r.floor, r.number`,
      )
      .bind(ctx.tenantId, buildingId)
      .all<RoomGridRow>();
    return res.results ?? [];
  }

  /**
   * Bulk create, floors x rooms-per-floor, numbered <floor><nn>.
   *
   * Numbers that already exist are skipped rather than colliding: running it
   * twice, or extending a building by a floor, must be safe. The partial unique
   * index would reject a duplicate anyway, but as a failed batch after the work
   * — this way the operator gets the rooms that were actually new.
   */
  async bulkCreate(
    ctx: TenantContext,
    input: { buildingId: string; fromFloor: number; toFloor: number; perFloor: number;
             rent: number; deposit: number; roomType: string | null },
  ): Promise<number> {
    const existing = new Set((await this.forBuilding(ctx, input.buildingId)).map((r) => r.number));
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];

    for (let floor = input.fromFloor; floor <= input.toFloor; floor++) {
      for (let n = 1; n <= input.perFloor; n++) {
        const number = `${floor}${String(n).padStart(2, '0')}`;
        if (existing.has(number)) continue;
        stmts.push(
          this.d1
            .prepare(
              `INSERT INTO room (tenant_id, room_id, building_id, floor, number, room_type,
                                 rent, deposit, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VACANT', ?, ?)`,
            )
            .bind(ctx.tenantId, ulid(), input.buildingId, floor, number,
                  input.roomType, input.rent, input.deposit, now, now),
        );
      }
    }
    if (stmts.length) await this.d1.batch(stmts);
    return stmts.length;
  }
}

export class MeterWalkRepo extends TenantScopedRepo<MeterWalk> {
  constructor(d1: D1Database) {
    super(d1, spec.meterWalkSpec);
  }

  /**
   * Opens the walk session for a building and period, once.
   *
   * The office view uses it to see that someone is out walking. Starting twice
   * — a second phone, or the same one after a reload — must not create a second
   * session or move the start time.
   */
  async start(ctx: TenantContext, buildingId: string, period: string): Promise<void> {
    const now = new Date().toISOString();
    await this.d1
      .prepare(
        `INSERT INTO meter_walk
           (tenant_id, walk_id, building_id, period, started_by, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, building_id, period) WHERE deleted_at IS NULL DO NOTHING`,
      )
      .bind(ctx.tenantId, ulid(), buildingId, period, ctx.accountId, now, now, now)
      .run();
  }

  /** Closes the session when the walker reaches the end of the building. */
  async finish(ctx: TenantContext, buildingId: string, period: string): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE meter_walk SET finished_at = ?, updated_at = ?
          WHERE tenant_id = ? AND building_id = ? AND period = ? AND deleted_at IS NULL`,
      )
      .bind(new Date().toISOString(), new Date().toISOString(), ctx.tenantId, buildingId, period)
      .run();
  }
}

export class BuildingRepo extends TenantScopedRepo<Building> {
  constructor(d1: D1Database) {
    super(d1, spec.buildingSpec);
  }

  /**
   * The list screen wants a room count per building. One grouped query rather
   * than one count per row: a operator with a dozen buildings would otherwise
   * pay a dozen round trips to D1 to draw a table.
   */
  async withRoomCounts(ctx: TenantContext): Promise<(Building & { rooms: number })[]> {
    const res = await this.d1
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM room r
                       WHERE r.tenant_id = b.tenant_id AND r.building_id = b.building_id
                         AND r.deleted_at IS NULL) AS rooms
           FROM building b
          WHERE b.tenant_id = ? AND b.deleted_at IS NULL
          ORDER BY b.name`,
      )
      .bind(ctx.tenantId)
      .all<Building & { rooms: number }>();
    return res.results ?? [];
  }

  /** The building a screen defaults to when none is named. */
  async first(ctx: TenantContext): Promise<Building | null> {
    const rows = await this.all(ctx, { orderBy: [['created_at', 'ASC']], limit: 1 });
    return rows[0] ?? null;
  }
}

/** One room's meter position for a period: what it read before, and now. */
export interface MeterRow {
  room_id: string;
  number: string;
  floor: number;
  party_name: string | null;
  water_start: number;
  electric_start: number;
  water_prev: number | null;
  water_now: number | null;
  elec_prev: number | null;
  elec_now: number | null;
}

/** A room as the field walk sees it. */
export interface WalkRoom {
  room_id: string;
  number: string;
  floor: number;
  party_id: string | null;
  party_name: string | null;
  moved_in: string | null;
  water_prev: number | null;
  water_now: number | null;
  water_status: string | null;
  elec_prev: number | null;
  elec_now: number | null;
  elec_status: string | null;
  /** Mean monthly usage over prior periods, to flag a spike against. */
  water_avg: number;
  elec_avg: number;
  contract_water_start: number;
  contract_electric_start: number;
}

export class MeterRepo extends TenantScopedRepo<MeterReading> {
  constructor(d1: D1Database) {
    super(d1, spec.meterReadingSpec);
  }

  /**
   * The entry grid for a building and period.
   *
   * The previous value is the last reading from any earlier period; where there
   * is none it falls back to the lease's opening reading, so a resident's first
   * bill charges what they used rather than what the meter has counted since it
   * was installed.
   */
  async gridFor(ctx: TenantContext, buildingId: string, period: string): Promise<MeterRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT r.room_id, r.number, r.floor, p.display_name AS party_name,
                COALESCE(c.water_start, 0)    AS water_start,
                COALESCE(c.electric_start, 0) AS electric_start,
                (SELECT m.value FROM meter_reading m
                  WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id
                    AND m.kind = 'WATER' AND m.period < ?3 AND m.deleted_at IS NULL
                  ORDER BY m.period DESC LIMIT 1) AS water_prev,
                (SELECT m.value FROM meter_reading m
                  WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id
                    AND m.kind = 'WATER' AND m.period = ?3 AND m.deleted_at IS NULL) AS water_now,
                (SELECT m.value FROM meter_reading m
                  WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id
                    AND m.kind = 'ELECTRIC' AND m.period < ?3 AND m.deleted_at IS NULL
                  ORDER BY m.period DESC LIMIT 1) AS elec_prev,
                (SELECT m.value FROM meter_reading m
                  WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id
                    AND m.kind = 'ELECTRIC' AND m.period = ?3 AND m.deleted_at IS NULL) AS elec_now
           FROM room r
           LEFT JOIN contract c ON c.tenant_id = r.tenant_id AND c.room_id = r.room_id
                               AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
           LEFT JOIN party p    ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
          WHERE r.tenant_id = ?1 AND r.building_id = ?2 AND r.deleted_at IS NULL
          ORDER BY r.floor, r.number`,
      )
      .bind(ctx.tenantId, buildingId, period)
      .all<MeterRow>();
    return res.results ?? [];
  }

  /**
   * The field walk: every room of a building for a period, in walking order,
   * with the previous reading resolved and a mean of prior usage to flag a
   * spike against.
   *
   * A SKIPPED reading is excluded from `prev` and from the average: it records
   * that nobody read the meter, so treating it as a measurement would drag the
   * baseline down and make the next real reading look like a leak.
   */
  async walkGrid(ctx: TenantContext, buildingId: string, period: string): Promise<WalkRoom[]> {
    const res = await this.d1
      .prepare(
        `SELECT r.room_id, r.number, r.floor,
                c.party_id, p.display_name AS party_name, c.start_date AS moved_in,
                COALESCE(c.water_start, 0)    AS contract_water_start,
                COALESCE(c.electric_start, 0) AS contract_electric_start,
                (SELECT m.value  FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'WATER'
                     AND m.period < ?3 AND m.status IN ('RECORDED','CONFIRMED') AND m.deleted_at IS NULL
                   ORDER BY m.period DESC LIMIT 1) AS water_prev,
                (SELECT m.value  FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'WATER'
                     AND m.period = ?3 AND m.deleted_at IS NULL) AS water_now,
                (SELECT m.status FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'WATER'
                     AND m.period = ?3 AND m.deleted_at IS NULL) AS water_status,
                (SELECT m.value  FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'ELECTRIC'
                     AND m.period < ?3 AND m.status IN ('RECORDED','CONFIRMED') AND m.deleted_at IS NULL
                   ORDER BY m.period DESC LIMIT 1) AS elec_prev,
                (SELECT m.value  FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'ELECTRIC'
                     AND m.period = ?3 AND m.deleted_at IS NULL) AS elec_now,
                (SELECT m.status FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'ELECTRIC'
                     AND m.period = ?3 AND m.deleted_at IS NULL) AS elec_status,
                COALESCE((SELECT AVG(m.value - m.prev_value) FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'WATER'
                     AND m.period < ?3 AND m.status IN ('RECORDED','CONFIRMED')
                     AND m.value >= m.prev_value AND m.deleted_at IS NULL), 0) AS water_avg,
                COALESCE((SELECT AVG(m.value - m.prev_value) FROM meter_reading m
                   WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id AND m.kind = 'ELECTRIC'
                     AND m.period < ?3 AND m.status IN ('RECORDED','CONFIRMED')
                     AND m.value >= m.prev_value AND m.deleted_at IS NULL), 0) AS elec_avg
           FROM room r
           LEFT JOIN contract c ON c.tenant_id = r.tenant_id AND c.room_id = r.room_id
                               AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
           LEFT JOIN party p    ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
          WHERE r.tenant_id = ?1 AND r.building_id = ?2 AND r.deleted_at IS NULL
          ORDER BY r.floor, r.number`,
      )
      .bind(ctx.tenantId, buildingId, period)
      .all<WalkRoom>();
    return res.results ?? [];
  }

  /** One reading from the field, with its photo, note or skip reason. */
  record(
    ctx: TenantContext,
    input: { roomId: string; period: string; kind: 'WATER' | 'ELECTRIC'; prev: number; value: number;
             status?: 'RECORDED' | 'SKIPPED'; reason?: string | null; note?: string | null;
             photoKey?: string | null },
  ): D1PreparedStatement {
    const now = new Date().toISOString();
    return this.d1
      .prepare(
        `INSERT INTO meter_reading
           (tenant_id, reading_id, room_id, period, kind, prev_value, value,
            status, skip_reason, note, photo_key, recorded_by, recorded_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, room_id, period, kind) WHERE deleted_at IS NULL
         DO UPDATE SET prev_value = excluded.prev_value, value = excluded.value,
                       status = excluded.status, skip_reason = excluded.skip_reason,
                       note = excluded.note,
                       -- A later pass without a photo must not erase the one
                       -- taken on the first.
                       photo_key = COALESCE(excluded.photo_key, meter_reading.photo_key),
                       recorded_by = excluded.recorded_by,
                       recorded_at = excluded.recorded_at, updated_at = excluded.updated_at`,
      )
      .bind(ctx.tenantId, ulid(), input.roomId, input.period, input.kind, input.prev, input.value,
            input.status ?? 'RECORDED', input.reason ?? null, input.note ?? null,
            input.photoKey ?? null, ctx.accountId, now, now, now);
  }

  /** Every reading taken in a building for one period. */
  async forPeriod(ctx: TenantContext, buildingId: string, period: string): Promise<MeterReading[]> {
    const res = await this.d1
      .prepare(
        `SELECT m.* FROM meter_reading m
           JOIN room r ON r.tenant_id = m.tenant_id AND r.room_id = m.room_id
          WHERE m.tenant_id = ? AND r.building_id = ? AND m.period = ?
            AND m.status IN ('RECORDED', 'CONFIRMED') AND m.deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, buildingId, period)
      .all<MeterReading>();
    return res.results ?? [];
  }

  /**
   * Saves a screenful of readings at once.
   *
   * Upsert on (tenant_id, room_id, period, kind): re-walking a floor to correct
   * one room must not create a second reading for the others. A blank entry is
   * skipped entirely rather than written as zero — an unrecorded meter and a
   * meter that read zero bill very differently.
   */
  async saveMany(
    ctx: TenantContext,
    period: string,
    entries: { roomId: string; kind: 'WATER' | 'ELECTRIC'; prev: number; value: number }[],
  ): Promise<number> {
    if (!entries.length) return 0;
    const now = new Date().toISOString();
    await this.d1.batch(entries.map((e) =>
      this.d1
        .prepare(
          `INSERT INTO meter_reading
             (tenant_id, reading_id, room_id, period, kind, prev_value, value,
              status, recorded_by, recorded_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'RECORDED', ?, ?, ?, ?)
           ON CONFLICT(tenant_id, room_id, period, kind) WHERE deleted_at IS NULL
           DO UPDATE SET prev_value = excluded.prev_value, value = excluded.value,
                         status = 'RECORDED', recorded_by = excluded.recorded_by,
                         recorded_at = excluded.recorded_at, updated_at = excluded.updated_at`,
        )
        .bind(ctx.tenantId, ulid(), e.roomId, period, e.kind, e.prev, e.value,
              ctx.accountId, now, now, now),
    ));
    return entries.length;
  }
}

export class InvoiceRepo extends TenantScopedRepo<Invoice> {
  constructor(d1: D1Database, private readonly audit: AuditRepo) {
    super(d1, spec.invoiceSpec);
  }

  /**
   * What an invoice has actually been paid, from verified payments only.
   *
   * Not stored. A maintained running total drifts the first time a partial
   * payment is corrected, and D1 cannot give the transaction that would keep
   * one honest. A slip the resident uploaded but the operator has not accepted
   * must not make an invoice look settled, or the two of them are reading
   * different truths off the same screen.
   */
  async paidTotal(ctx: TenantContext, invoiceId: string): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM payment
          WHERE tenant_id = ? AND invoice_id = ? AND status = 'VERIFIED' AND deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, invoiceId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async balance(ctx: TenantContext, invoiceId: string): Promise<number> {
    const invoice = await this.byId(ctx, invoiceId);
    return invoice.total - (await this.paidTotal(ctx, invoiceId));
  }

  /**
   * Status computed at read time, never written by a job.
   *
   * A cron that did not fire must not be able to make an invoice look current.
   * `OVERDUE` is a function of today's date and nothing else, which means it is
   * right on a morning when every scheduled task failed.
   */
  effectiveStatus(invoice: Invoice, paid: number, today: string): EffectiveInvoiceStatus {
    if (invoice.status !== 'UNPAID') return invoice.status;
    if (paid >= invoice.total && invoice.total > 0) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return invoice.due_date < today ? 'OVERDUE' : 'UNPAID';
  }

  /**
   * The list shape every invoice screen wants: the invoice, who and where it is
   * for, what has actually been paid, and the status that follows from those.
   *
   * `paid` is summed in the same query rather than fetched per row — a hundred
   * invoices would otherwise be a hundred round trips — and `effective_status`
   * is computed here so no screen has to remember that PARTIAL and PAID are not
   * stored.
   */
  async rows(
    ctx: TenantContext,
    opt: { period?: string; status?: string; partyId?: string; buildingId?: string;
           roomId?: string; contractId?: string; limit?: number } = {},
  ): Promise<InvoiceRow[]> {
    const where: string[] = ['i.tenant_id = ?', 'i.deleted_at IS NULL'];
    const args: unknown[] = [ctx.tenantId];
    if (opt.period) { where.push('i.period = ?'); args.push(opt.period); }
    if (opt.status) { where.push('i.status = ?'); args.push(opt.status); }
    if (opt.partyId) { where.push('i.party_id = ?'); args.push(opt.partyId); }
    if (opt.buildingId) { where.push('i.building_id = ?'); args.push(opt.buildingId); }
    if (opt.roomId) { where.push('i.room_id = ?'); args.push(opt.roomId); }
    if (opt.contractId) { where.push('i.contract_id = ?'); args.push(opt.contractId); }

    const res = await this.d1
      .prepare(
        `SELECT i.*, r.number AS room_number, r.floor AS room_floor,
                p.display_name AS party_name, b.name AS building_name,
                COALESCE((SELECT SUM(pay.amount) FROM payment pay
                           WHERE pay.tenant_id = i.tenant_id AND pay.invoice_id = i.invoice_id
                             AND pay.status = 'VERIFIED' AND pay.deleted_at IS NULL), 0) AS paid
           FROM invoice i
           JOIN room r     ON r.tenant_id = i.tenant_id AND r.room_id = i.room_id
           JOIN party p    ON p.tenant_id = i.tenant_id AND p.party_id = i.party_id
           JOIN building b ON b.tenant_id = i.tenant_id AND b.building_id = i.building_id
          WHERE ${where.join(' AND ')}
          ORDER BY i.period DESC, r.floor, r.number
          LIMIT ?`,
      )
      .bind(...args, Math.min(opt.limit ?? 500, 1000))
      .all<InvoiceRow>();

    const today = new Date().toISOString().slice(0, 10);
    return (res.results ?? []).map((row) => ({
      ...row,
      effective_status: this.effectiveStatus(row, Number(row.paid), today),
    }));
  }

  /**
   * Writes a billing run: one invoice with its items per lease, in one batch.
   *
   * Numbers are taken before the batch because the counter is its own write —
   * two operators billing the same building at once would otherwise take the
   * same number and the partial unique index would reject the second run after
   * all the work was done.
   *
   * A deposit line also advances `deposit_invoiced` in the same batch, so a
   * re-run cannot bill it twice.
   */
  async generate(
    ctx: TenantContext,
    runs: {
      number: string; buildingId: string; roomId: string; contractId: string; partyId: string;
      period: string; issueDate: string; dueDate: string; total: number;
      items: { kind: string; label: string; detail: string | null; qty: number;
               unit: string | null; unit_price: number; amount: number }[];
      depositAmount: number;
    }[],
  ): Promise<number> {
    if (!runs.length) return 0;
    const now = new Date().toISOString();
    const stmts: D1PreparedStatement[] = [];

    for (const run of runs) {
      const invoiceId = ulid();
      stmts.push(
        this.d1
          .prepare(
            `INSERT INTO invoice
               (tenant_id, invoice_id, number, building_id, room_id, contract_id, party_id,
                period, issue_date, due_date, subtotal, discount, total, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'UNPAID', ?, ?)`,
          )
          .bind(ctx.tenantId, invoiceId, run.number, run.buildingId, run.roomId, run.contractId,
                run.partyId, run.period, run.issueDate, run.dueDate, run.total, run.total, now, now),
      );
      run.items.forEach((item, sort) => {
        stmts.push(
          this.d1
            .prepare(
              `INSERT INTO invoice_item
                 (tenant_id, item_id, invoice_id, kind, label, detail, qty, unit,
                  unit_price, amount, sort, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(ctx.tenantId, ulid(), invoiceId, item.kind, item.label, item.detail,
                  item.qty, item.unit, item.unit_price, item.amount, sort, now, now),
        );
      });
      if (run.depositAmount > 0) {
        stmts.push(
          this.d1
            .prepare(
              `UPDATE contract SET deposit_invoiced = deposit_invoiced + ?, updated_at = ?
                WHERE tenant_id = ? AND contract_id = ?`,
            )
            .bind(run.depositAmount, now, ctx.tenantId, run.contractId),
        );
      }
      stmts.push(this.audit.statement(ctx, {
        action: 'invoice.issued', targetType: 'invoice', targetId: invoiceId,
        changes: { period: run.period, total: run.total },
      }));
    }

    await this.d1.batch(stmts);
    return runs.length;
  }

  /** Periods that have invoices, newest first — the filter dropdown. */
  async periods(ctx: TenantContext, limit = 24): Promise<string[]> {
    const res = await this.d1
      .prepare(
        `SELECT DISTINCT period FROM invoice
          WHERE tenant_id = ? AND deleted_at IS NULL
          ORDER BY period DESC LIMIT ?`,
      )
      .bind(ctx.tenantId, limit)
      .all<{ period: string }>();
    return (res.results ?? []).map((r) => r.period);
  }

  /** An invoice with everything a document or a detail page needs. */
  async full(ctx: TenantContext, invoiceId: string) {
    const invoice = await this.byId(ctx, invoiceId);
    const [items, payments, paid] = await Promise.all([
      this.d1
        .prepare(
          `SELECT * FROM invoice_item
            WHERE tenant_id = ? AND invoice_id = ? AND deleted_at IS NULL ORDER BY sort`,
        )
        .bind(ctx.tenantId, invoiceId)
        .all<InvoiceItem>(),
      this.d1
        .prepare(
          `SELECT * FROM payment
            WHERE tenant_id = ? AND invoice_id = ? AND deleted_at IS NULL ORDER BY paid_at`,
        )
        .bind(ctx.tenantId, invoiceId)
        .all<Payment>(),
      this.paidTotal(ctx, invoiceId),
    ]);
    return {
      invoice,
      items: items.results ?? [],
      payments: payments.results ?? [],
      paid,
      remaining: invoice.total - paid,
    };
  }

  /** Outstanding across a tenant, or one resident's share of it. */
  async outstanding(ctx: TenantContext, partyId?: string): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COALESCE(SUM(i.total), 0) - COALESCE((
             SELECT SUM(p.amount) FROM payment p
              JOIN invoice pi ON pi.tenant_id = p.tenant_id AND pi.invoice_id = p.invoice_id
              WHERE p.tenant_id = ? AND p.status = 'VERIFIED' AND p.deleted_at IS NULL
                AND pi.status = 'UNPAID' AND pi.deleted_at IS NULL
                ${partyId ? 'AND pi.party_id = ?' : ''}
           ), 0) AS n
           FROM invoice i
          WHERE i.tenant_id = ? AND i.status = 'UNPAID' AND i.deleted_at IS NULL
            ${partyId ? 'AND i.party_id = ?' : ''}`,
      )
      .bind(...(partyId
        ? [ctx.tenantId, partyId, ctx.tenantId, partyId]
        : [ctx.tenantId, ctx.tenantId]))
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Voiding is the one action that clears a debt with no money against it, so
   * it is OWNER-only, needs a reason, and the audit row goes in the same batch
   * as the change. The guard is the status test: an invoice already voided, or
   * belonging to another tenant, changes nothing and the batch fails whole.
   */
  async void(ctx: TenantContext, invoiceId: string, reason: string): Promise<void> {
    if (!has(ctx, 'app.invoice.void')) throw new ForbiddenError('app.invoice.void');
    if (!reason.trim()) throw new Error('void: reason is required');
    const now = new Date().toISOString();

    await guardedBatch(this.d1, 'invoice.void',
      this.d1
        .prepare(
          `UPDATE invoice SET status = 'VOID', void_reason = ?, voided_by = ?, voided_at = ?,
                              updated_at = ?, version = version + 1
            WHERE tenant_id = ? AND invoice_id = ? AND status <> 'VOID' AND deleted_at IS NULL`,
        )
        .bind(reason, ctx.accountId, now, now, ctx.tenantId, invoiceId),
      [this.audit.statement(ctx, {
        action: 'invoice.voided', targetType: 'invoice', targetId: invoiceId, reason,
      })],
    );
  }
}

export class PaymentRepo extends TenantScopedRepo<Payment> {
  constructor(d1: D1Database, private readonly audit: AuditRepo) {
    super(d1, spec.paymentSpec);
  }

  /** The queue on the invoice list: slips reported and not yet decided. */
  pending(ctx: TenantContext, opt: QueryOption = {}): Promise<Payment[]> {
    return this.all(ctx, { ...opt, where: [...(opt.where ?? []), ['status', '=', 'REPORTED']] });
  }

  /** The same queue, with enough context for the operator to recognise it. */
  async pendingRows(ctx: TenantContext): Promise<(Payment & {
    number: string; room_number: string; party_name: string | null;
  })[]> {
    const res = await this.d1
      .prepare(
        `SELECT pay.*, i.number, r.number AS room_number, p.display_name AS party_name
           FROM payment pay
           JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.invoice_id = pay.invoice_id
           JOIN room r    ON r.tenant_id = i.tenant_id AND r.room_id = i.room_id
           JOIN party p   ON p.tenant_id = i.tenant_id AND p.party_id = i.party_id
          WHERE pay.tenant_id = ? AND pay.status = 'REPORTED' AND pay.deleted_at IS NULL
          ORDER BY pay.created_at DESC`,
      )
      .bind(ctx.tenantId)
      .all<Payment & { number: string; room_number: string; party_name: string | null }>();
    return res.results ?? [];
  }

  /**
   * Accepting or rejecting a slip is the money decision in this system, so both
   * go through here and neither is reachable from update(): `status` is not in
   * the writable list.
   *
   * A rejection must carry a reason, and that reason is shown to the resident
   * verbatim. "Rejected" with no explanation is how a person who really did pay
   * ends up phoning the office.
   */
  async decide(
    ctx: TenantContext,
    paymentId: string,
    decision: 'VERIFIED' | 'REJECTED',
    reason?: string,
  ): Promise<void> {
    if (!has(ctx, 'app.payment.verify')) throw new ForbiddenError('app.payment.verify');
    if (decision === 'REJECTED' && !reason?.trim()) {
      throw new Error('payment.decide: a rejection requires a reason');
    }
    const now = new Date().toISOString();

    await guardedBatch(this.d1, 'payment.decide',
      this.d1
        .prepare(
          `UPDATE payment SET status = ?, reject_reason = ?, verified_by = ?, verified_at = ?,
                              updated_at = ?
            WHERE tenant_id = ? AND payment_id = ? AND status = 'REPORTED' AND deleted_at IS NULL`,
        )
        .bind(decision, reason ?? null, ctx.accountId, now, now, ctx.tenantId, paymentId),
      [this.audit.statement(ctx, {
        action: decision === 'VERIFIED' ? 'payment.verified' : 'payment.rejected',
        targetType: 'payment',
        targetId: paymentId,
        reason,
      })],
    );
  }

  /**
   * A resident on a bad network taps twice. The second tap must be the same
   * payment, not a second one — so the key is checked before the insert rather
   * than left to the unique index, whose failure would surface as a 500.
   */
  async reportOnce(ctx: TenantContext, value: Partial<Payment>, idempotencyKey: string): Promise<Payment> {
    const existing = await this.all(ctx, { where: [['idempotency_key', '=', idempotencyKey]], limit: 1 });
    if (existing.length) return existing[0];
    return this.insert(ctx, { ...value, idempotency_key: idempotencyKey, status: 'REPORTED' } as Partial<Payment>);
  }
}

export class ContractRepo extends TenantScopedRepo<Contract> {
  constructor(d1: D1Database, private readonly audit: AuditRepo) {
    super(d1, spec.contractSpec);
  }

  /** A resident's leases, newest first, with the room they name. */
  async forParty(ctx: TenantContext, partyId: string): Promise<(Contract & {
    room_number: string; building_name: string;
  })[]> {
    const res = await this.d1
      .prepare(
        `SELECT c.*, r.number AS room_number, b.name AS building_name
           FROM contract c
           JOIN room r     ON r.tenant_id = c.tenant_id AND r.room_id = c.room_id
           JOIN building b ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
          WHERE c.tenant_id = ? AND c.party_id = ? AND c.deleted_at IS NULL
          ORDER BY c.start_date DESC`,
      )
      .bind(ctx.tenantId, partyId)
      .all<Contract & { room_number: string; building_name: string }>();
    return res.results ?? [];
  }

  /** Every lease attached to a building, live or not — the billing run decides. */
  async forBuilding(ctx: TenantContext, buildingId: string): Promise<(Contract & { party_name: string })[]> {
    const res = await this.d1
      .prepare(
        `SELECT c.*, p.display_name AS party_name
           FROM contract c
           JOIN room r  ON r.tenant_id = c.tenant_id AND r.room_id = c.room_id
           JOIN party p ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
          WHERE c.tenant_id = ? AND r.building_id = ? AND c.deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, buildingId)
      .all<Contract & { party_name: string }>();
    return res.results ?? [];
  }

  activeForRoom(ctx: TenantContext, roomId: string): Promise<Contract[]> {
    return this.all(ctx, {
      where: [['room_id', '=', roomId], ['status', 'IN', ['ACTIVE', 'ENDING']]],
      limit: 1,
    });
  }

  /**
   * A lease becomes ACTIVE when it is signed, which happens at the desk on
   * paper, and the room is occupied from that moment.
   *
   * This is deliberately not the resident's confirmation. Tying occupancy to
   * someone opening a LINE app would leave the floor grid showing a vacant room
   * that has a person and a bed in it, for every resident who never installs
   * anything — which is most of them, most of the time.
   */
  async activate(ctx: TenantContext, contractId: string): Promise<void> {
    const now = new Date().toISOString();

    await guardedBatch(this.d1, 'contract.activate',
      this.d1
        .prepare(
          `UPDATE contract SET status = 'ACTIVE', updated_at = ?, version = version + 1
            WHERE tenant_id = ? AND contract_id = ? AND status = 'DRAFT' AND deleted_at IS NULL`,
        )
        .bind(now, ctx.tenantId, contractId),
      [
        this.d1
          .prepare(
            `UPDATE room SET status = 'OCCUPIED', updated_at = ?
              WHERE tenant_id = ? AND deleted_at IS NULL
                AND room_id = (SELECT room_id FROM contract
                                WHERE tenant_id = ? AND contract_id = ?)`,
          )
          .bind(now, ctx.tenantId, ctx.tenantId, contractId),
        this.audit.statement(ctx, {
          action: 'contract.activated', targetType: 'contract', targetId: contractId,
        }),
      ],
    );
  }

  /**
   * The resident reviewed the terms in the app and accepted them.
   *
   * This is where the agreed_* snapshot is taken, and it is copied from the
   * row's own columns inside the statement rather than passed in by the caller
   * — a snapshot assembled in application code is a snapshot of whatever that
   * code last read, not of what was on the resident's screen. If the operator
   * later amends the rent, this record must not move with it.
   *
   * `confirmed_at IS NULL` in the guard makes it once-only: a second scan of
   * the same QR cannot rewrite what was agreed.
   */
  async confirm(
    ctx: TenantContext,
    contractId: string,
    docs: { termsVersion: string; pdpaVersion: string },
  ): Promise<void> {
    const now = new Date().toISOString();

    await guardedBatch(this.d1, 'contract.confirm',
      this.d1
        .prepare(
          `UPDATE contract
              SET confirmed_at = ?,
                  agreed_rent = rent, agreed_deposit = deposit,
                  agreed_start_date = start_date,
                  agreed_terms_version = ?, agreed_pdpa_version = ?,
                  updated_at = ?, version = version + 1
            WHERE tenant_id = ? AND contract_id = ?
              AND status IN ('ACTIVE', 'ENDING') AND confirmed_at IS NULL
              AND deleted_at IS NULL`,
        )
        .bind(now, docs.termsVersion, docs.pdpaVersion, now, ctx.tenantId, contractId),
      [this.audit.statement(ctx, {
        action: 'contract.confirmed',
        targetType: 'contract',
        targetId: contractId,
        changes: { terms: docs.termsVersion, pdpa: docs.pdpaVersion },
      })],
    );
  }

  /** The list screen: leases with the room and the resident they name. */
  async rows(ctx: TenantContext, statuses: readonly string[]): Promise<(Contract & {
    room_number: string; building_name: string; party_name: string | null; phone_masked: string | null;
  })[]> {
    const res = await this.d1
      .prepare(
        `SELECT c.*, r.number AS room_number, b.name AS building_name,
                p.display_name AS party_name, p.phone_masked
           FROM contract c
           JOIN room r     ON r.tenant_id = c.tenant_id AND r.room_id = c.room_id
           JOIN building b ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
           JOIN party p    ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
          WHERE c.tenant_id = ? AND c.deleted_at IS NULL
            AND c.status IN (${statuses.map(() => '?').join(', ')})
          ORDER BY b.name, r.floor, r.number`,
      )
      .bind(ctx.tenantId, ...statuses)
      .all<Contract & {
        room_number: string; building_name: string; party_name: string | null; phone_masked: string | null;
      }>();
    return res.results ?? [];
  }

  /**
   * Ending a lease starts the deposit-return clock. Thai law gives the operator
   * seven days from the room being handed back (VERTICAL §10), and a date the
   * system did not write is a date nobody will remember.
   */
  async end(ctx: TenantContext, contractId: string, reason: string, endedOn: string): Promise<void> {
    if (!has(ctx, 'app.contract.end')) throw new ForbiddenError('app.contract.end');
    if (!reason.trim()) throw new Error('contract.end: reason is required');
    const now = new Date().toISOString();
    const returnDue = new Date(`${endedOn}T00:00:00Z`);
    returnDue.setUTCDate(returnDue.getUTCDate() + 7);

    await guardedBatch(this.d1, 'contract.end',
      this.d1
        .prepare(
          `UPDATE contract
              SET status = 'ENDED', ended_at = ?, ending_reason = ?,
                  end_date = COALESCE(end_date, ?), deposit_return_due_at = ?,
                  updated_at = ?, version = version + 1
            WHERE tenant_id = ? AND contract_id = ?
              AND status IN ('ACTIVE', 'ENDING') AND deleted_at IS NULL`,
        )
        .bind(now, reason, endedOn, returnDue.toISOString().slice(0, 10), now, ctx.tenantId, contractId),
      [
        // The room is freed in the same transaction. A lease that ended while
        // the room stayed OCCUPIED blocks the next tenancy and reads as a bug
        // in the floor grid rather than as a missing write.
        this.d1
          .prepare(
            `UPDATE room SET status = 'VACANT', updated_at = ?
              WHERE tenant_id = ? AND deleted_at IS NULL
                AND room_id = (SELECT room_id FROM contract
                                WHERE tenant_id = ? AND contract_id = ?)`,
          )
          .bind(now, ctx.tenantId, ctx.tenantId, contractId),
        this.audit.statement(ctx, {
          action: 'contract.ended', targetType: 'contract', targetId: contractId, reason,
        }),
      ],
    );
  }
}

/** A ticket as the queue shows it: what, where, and who reported it. */
export type TicketRow = Ticket & {
  room_number: string;
  building_name: string;
  party_name: string | null;
};

export class TicketRepo extends TenantScopedRepo<Ticket> {
  constructor(d1: D1Database) {
    super(d1, spec.ticketSpec);
  }

  /**
   * The repair queue. Urgent first, then oldest — a list sorted by date alone
   * buries the thing that is flooding a room under a week of light bulbs.
   */
  async rows(ctx: TenantContext, status?: string): Promise<TicketRow[]> {
    const res = await this.d1
      .prepare(
        `SELECT k.*, r.number AS room_number, b.name AS building_name, p.display_name AS party_name
           FROM ticket k
           JOIN room r      ON r.tenant_id = k.tenant_id AND r.room_id = k.room_id
           JOIN building b  ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
           LEFT JOIN party p ON p.tenant_id = k.tenant_id AND p.party_id = k.party_id
          WHERE k.tenant_id = ? AND k.deleted_at IS NULL
            ${status ? 'AND k.status = ?' : ''}
          ORDER BY CASE k.priority WHEN 'URGENT' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
                   k.created_at DESC`,
      )
      .bind(...(status ? [ctx.tenantId, status] : [ctx.tenantId]))
      .all<TicketRow>();
    return res.results ?? [];
  }

  async row(ctx: TenantContext, ticketId: string): Promise<TicketRow> {
    const ticket = await this.byId(ctx, ticketId);
    const extra = await this.d1
      .prepare(
        `SELECT r.number AS room_number, b.name AS building_name, p.display_name AS party_name
           FROM room r
           JOIN building b   ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
           LEFT JOIN party p ON p.tenant_id = ? AND p.party_id = ?
          WHERE r.tenant_id = ? AND r.room_id = ?`,
      )
      .bind(ctx.tenantId, ticket.party_id, ctx.tenantId, ticket.room_id)
      .first<{ room_number: string; building_name: string; party_name: string | null }>();
    return { ...ticket, ...(extra ?? { room_number: '', building_name: '', party_name: null }) };
  }
}

export class AnnouncementRepo extends TenantScopedRepo<Announcement> {
  constructor(d1: D1Database, private readonly audit: AuditRepo) {
    super(d1, spec.announcementSpec);
  }

  /** The backoffice list: drafts first, because those are the ones awaiting a decision. */
  async rows(ctx: TenantContext, buildingId?: string): Promise<(Announcement & {
    building_name: string; read_count: number;
  })[]> {
    const res = await this.d1
      .prepare(
        `SELECT a.*, b.name AS building_name,
                (SELECT COUNT(*) FROM announcement_read ar
                  WHERE ar.tenant_id = a.tenant_id AND ar.announcement_id = a.announcement_id) AS read_count
           FROM announcement a
           JOIN building b ON b.tenant_id = a.tenant_id AND b.building_id = a.building_id
          WHERE a.tenant_id = ? AND a.deleted_at IS NULL
            ${buildingId ? 'AND a.building_id = ?' : ''}
          ORDER BY a.published_at IS NULL DESC, a.pinned DESC,
                   COALESCE(a.published_at, a.created_at) DESC`,
      )
      .bind(...(buildingId ? [ctx.tenantId, buildingId] : [ctx.tenantId]))
      .all<Announcement & { building_name: string; read_count: number }>();
    return res.results ?? [];
  }

  async row(ctx: TenantContext, announcementId: string) {
    const rows = await this.rows(ctx);
    const found = rows.find((a) => a.announcement_id === announcementId);
    if (!found) throw new NotFoundError('announcement');
    return found;
  }

  /**
   * How many residents a notice for this building reaches: one per live lease,
   * which is what the operator is really asking before they publish.
   */
  async audience(ctx: TenantContext, buildingId: string): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS n
           FROM contract c
           JOIN room r ON r.tenant_id = c.tenant_id AND r.room_id = c.room_id
          WHERE c.tenant_id = ? AND r.building_id = ?
            AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, buildingId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Back to a draft. The read rows are kept: if it goes out again, who has
   * already seen it is still true — and `pushed_at` is kept too, so a
   * republish cannot become a second notification.
   */
  async unpublish(ctx: TenantContext, announcementId: string): Promise<void> {
    if (!has(ctx, 'app.announcement.publish')) throw new ForbiddenError('app.announcement.publish');
    await this.update(ctx, announcementId, {} as Partial<Announcement>);
    await this.d1
      .prepare(
        `UPDATE announcement SET published_at = NULL, updated_at = ?
          WHERE tenant_id = ? AND announcement_id = ? AND deleted_at IS NULL`,
      )
      .bind(new Date().toISOString(), ctx.tenantId, announcementId)
      .run();
  }

  /**
   * Publishing is separate from editing so that a half-written notice cannot
   * appear in every resident's app, and so the LINE push happens at most once.
   * `pushed_at IS NULL` in the guard is what makes a re-publish or an edit not
   * message a hundred people a second time.
   */
  async publish(ctx: TenantContext, announcementId: string): Promise<{ shouldPush: boolean }> {
    if (!has(ctx, 'app.announcement.publish')) throw new ForbiddenError('app.announcement.publish');
    const now = new Date().toISOString();

    const results = await guardedBatch(this.d1, 'announcement.publish',
      this.d1
        .prepare(
          `UPDATE announcement SET published_at = COALESCE(published_at, ?), updated_at = ?
            WHERE tenant_id = ? AND announcement_id = ? AND deleted_at IS NULL`,
        )
        .bind(now, now, ctx.tenantId, announcementId),
      [
        this.d1
          .prepare(
            `UPDATE announcement SET pushed_at = ?
              WHERE tenant_id = ? AND announcement_id = ? AND pushed_at IS NULL`,
          )
          .bind(now, ctx.tenantId, announcementId),
        this.audit.statement(ctx, {
          action: 'announcement.published', targetType: 'announcement', targetId: announcementId,
        }),
      ],
    );
    return { shouldPush: Boolean(results[1].meta.changes) };
  }
}

export class InvoiceCounterRepo {
  constructor(private readonly d1: D1Database) {}

  /**
   * Per-tenant numbering. The old global `counters` table would have handed
   * operator B operator A's next invoice number.
   *
   * Increment then read, not read then increment: two requests billing the same
   * building at once would otherwise take the same number, and the partial
   * unique index on (tenant_id, number) would reject the second insert after
   * the work was done.
   */
  async next(ctx: TenantContext, key: string): Promise<number> {
    const now = new Date().toISOString();
    const [, read] = await this.d1.batch<{ value: number }>([
      this.d1
        .prepare(
          `INSERT INTO invoice_counter (tenant_id, key, value, updated_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(tenant_id, key) DO UPDATE SET value = value + 1, updated_at = ?`,
        )
        .bind(ctx.tenantId, key, now, now),
      this.d1
        .prepare('SELECT value FROM invoice_counter WHERE tenant_id = ? AND key = ?')
        .bind(ctx.tenantId, key),
    ]);
    return (read.results ?? [])[0]?.value ?? 1;
  }
}

/**
 * The one search box, over the four things an operator actually looks up.
 *
 * Four queries rather than a UNION: each returns a different shape, and the
 * screen renders them as four sections. Every one of them is bound to the
 * tenant, so a search string can never be a way out of the tenant.
 *
 * A resident is searched by name and by the masked phone and last four ID
 * digits — the only forms of those values stored in the clear. Searching the
 * full number is not possible and should not be: it would mean holding it
 * somewhere searchable.
 */
export class SearchRepo {
  constructor(private readonly d1: D1Database) {}

  async all(ctx: TenantContext, q: string) {
    const like = `%${q}%`;
    const [rooms, residents, invoices, tickets] = await this.d1.batch<Record<string, unknown>>([
      this.d1
        .prepare(
          `SELECT r.room_id, r.number, r.floor, r.status, b.name AS building_name,
                  p.display_name AS party_name
             FROM room r
             JOIN building b ON b.tenant_id = r.tenant_id AND b.building_id = r.building_id
             LEFT JOIN contract c ON c.tenant_id = r.tenant_id AND c.room_id = r.room_id
                                 AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
             LEFT JOIN party p    ON p.tenant_id = c.tenant_id AND p.party_id = c.party_id
            WHERE r.tenant_id = ?1 AND r.deleted_at IS NULL
              AND (r.number LIKE ?2 OR b.name LIKE ?2)
            ORDER BY r.floor, r.number LIMIT 12`,
        )
        .bind(ctx.tenantId, like),
      this.d1
        .prepare(
          `SELECT p.party_id, p.display_name, p.phone_masked, r.number AS room_number
             FROM party p
             LEFT JOIN resident_profile rp ON rp.tenant_id = p.tenant_id AND rp.party_id = p.party_id
             LEFT JOIN contract c ON c.tenant_id = p.tenant_id AND c.party_id = p.party_id
                                 AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
             LEFT JOIN room r     ON r.tenant_id = c.tenant_id AND r.room_id = c.room_id
            WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL
              AND (p.display_name LIKE ?2 OR p.phone_masked LIKE ?2 OR rp.national_id_last4 LIKE ?2)
            ORDER BY p.display_name LIMIT 12`,
        )
        .bind(ctx.tenantId, like),
      this.d1
        .prepare(
          `SELECT i.invoice_id, i.number, i.period, i.total, i.status, i.due_date,
                  r.number AS room_number, p.display_name AS party_name,
                  COALESCE((SELECT SUM(pay.amount) FROM payment pay
                             WHERE pay.tenant_id = i.tenant_id AND pay.invoice_id = i.invoice_id
                               AND pay.status = 'VERIFIED' AND pay.deleted_at IS NULL), 0) AS paid
             FROM invoice i
             JOIN room r  ON r.tenant_id = i.tenant_id AND r.room_id = i.room_id
             JOIN party p ON p.tenant_id = i.tenant_id AND p.party_id = i.party_id
            WHERE i.tenant_id = ?1 AND i.deleted_at IS NULL
              AND (i.number LIKE ?2 OR r.number LIKE ?2 OR p.display_name LIKE ?2)
            ORDER BY i.period DESC LIMIT 12`,
        )
        .bind(ctx.tenantId, like),
      this.d1
        .prepare(
          `SELECT k.ticket_id, k.title, k.status, r.number AS room_number
             FROM ticket k
             JOIN room r ON r.tenant_id = k.tenant_id AND r.room_id = k.room_id
            WHERE k.tenant_id = ?1 AND k.deleted_at IS NULL
              AND (k.title LIKE ?2 OR k.detail LIKE ?2 OR r.number LIKE ?2)
            ORDER BY k.created_at DESC LIMIT 8`,
        )
        .bind(ctx.tenantId, like),
    ]);

    return {
      rooms: (rooms.results ?? []) as unknown as (Room & { building_name: string; party_name: string | null })[],
      residents: (residents.results ?? []) as unknown as
        { party_id: string; display_name: string; phone_masked: string | null; room_number: string | null }[],
      invoices: (invoices.results ?? []) as unknown as
        (Invoice & { room_number: string; party_name: string; paid: number })[],
      tickets: (tickets.results ?? []) as unknown as
        { ticket_id: string; title: string; status: string; room_number: string }[],
    };
  }
}

/**
 * Aggregates for the dashboard and the reports.
 *
 * Read-only, and every figure counts VERIFIED payments only. A slip nobody has
 * accepted yet is not revenue, and a dashboard that says otherwise is a
 * dashboard the operator stops trusting the first time it is wrong.
 */
export class StatsRepo {
  constructor(private readonly d1: D1Database) {}

  /** Room counts by status, across every building this operator runs. */
  async occupancy(ctx: TenantContext) {
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(status = 'OCCUPIED')    AS occupied,
                SUM(status = 'VACANT')      AS vacant,
                SUM(status = 'MAINTENANCE') AS maint
           FROM room WHERE tenant_id = ? AND deleted_at IS NULL`,
      )
      .bind(ctx.tenantId)
      .first<{ total: number; occupied: number; vacant: number; maint: number }>();
    return row ?? { total: 0, occupied: 0, vacant: 0, maint: 0 };
  }

  /** Money actually received in a period, or on one day. */
  async collected(ctx: TenantContext, opts: { period?: string; day?: string }): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM payment
          WHERE tenant_id = ? AND status = 'VERIFIED' AND deleted_at IS NULL
            ${opts.day ? 'AND paid_at = ?' : 'AND substr(paid_at, 1, 7) = ?'}`,
      )
      .bind(ctx.tenantId, opts.day ?? opts.period)
      .first<{ s: number }>();
    return row?.s ?? 0;
  }

  async openTickets(ctx: TenantContext): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS n FROM ticket
          WHERE tenant_id = ? AND status IN ('OPEN', 'IN_PROGRESS') AND deleted_at IS NULL`,
      )
      .bind(ctx.tenantId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** Leases running out within `days`, so nobody is surprised by a move-out. */
  async expiringLeases(ctx: TenantContext, days = 45): Promise<number> {
    const limit = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS n FROM contract
          WHERE tenant_id = ? AND status IN ('ACTIVE', 'ENDING')
            AND end_date IS NOT NULL AND end_date <= ? AND deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, limit)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** How much of a building has been read this period — the billing gate. */
  async meterProgress(ctx: TenantContext, buildingId: string, period: string) {
    const row = await this.d1
      .prepare(
        `SELECT COUNT(*) AS due,
                COALESCE(SUM(EXISTS (SELECT 1 FROM meter_reading m
                              WHERE m.tenant_id = r.tenant_id AND m.room_id = r.room_id
                                AND m.period = ?3 AND m.kind = 'ELECTRIC'
                                AND m.deleted_at IS NULL)), 0) AS got
           FROM room r
           JOIN contract c ON c.tenant_id = r.tenant_id AND c.room_id = r.room_id
                          AND c.status IN ('ACTIVE', 'ENDING') AND c.deleted_at IS NULL
          WHERE r.tenant_id = ?1 AND r.building_id = ?2 AND r.deleted_at IS NULL`,
      )
      .bind(ctx.tenantId, buildingId, period)
      .first<{ due: number; got: number }>();
    return row ?? { due: 0, got: 0 };
  }

  /** The last few payments, for the "what happened today" strip. */
  async recentPayments(ctx: TenantContext, limit = 6) {
    const res = await this.d1
      .prepare(
        `SELECT pay.payment_id, pay.amount, pay.paid_at,
                p.display_name AS party_name, r.number AS room_number
           FROM payment pay
           JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.invoice_id = pay.invoice_id
           JOIN party p   ON p.tenant_id = i.tenant_id AND p.party_id = i.party_id
           JOIN room r    ON r.tenant_id = i.tenant_id AND r.room_id = i.room_id
          WHERE pay.tenant_id = ? AND pay.status = 'VERIFIED' AND pay.deleted_at IS NULL
          ORDER BY pay.paid_at DESC, pay.created_at DESC LIMIT ?`,
      )
      .bind(ctx.tenantId, limit)
      .all<{ payment_id: string; amount: number; paid_at: string;
             party_name: string; room_number: string }>();
    return res.results ?? [];
  }

  /** Billed against collected, by month — the revenue chart. */
  async monthly(ctx: TenantContext, fromPeriod: string) {
    const res = await this.d1
      .prepare(
        `SELECT i.period,
                SUM(i.total) AS billed,
                COALESCE(SUM((SELECT SUM(pay.amount) FROM payment pay
                               WHERE pay.tenant_id = i.tenant_id AND pay.invoice_id = i.invoice_id
                                 AND pay.status = 'VERIFIED' AND pay.deleted_at IS NULL)), 0) AS collected,
                COUNT(*) AS count
           FROM invoice i
          WHERE i.tenant_id = ? AND i.status <> 'VOID' AND i.period >= ? AND i.deleted_at IS NULL
          GROUP BY i.period ORDER BY i.period DESC`,
      )
      .bind(ctx.tenantId, fromPeriod)
      .all<{ period: string; billed: number; collected: number; count: number }>();
    return res.results ?? [];
  }

  /** Revenue split by line-item kind: rent, water, electricity, fees. */
  async byKind(ctx: TenantContext, fromPeriod: string) {
    const res = await this.d1
      .prepare(
        `SELECT it.kind, SUM(it.amount) AS amount
           FROM invoice_item it
           JOIN invoice i ON i.tenant_id = it.tenant_id AND i.invoice_id = it.invoice_id
          WHERE it.tenant_id = ? AND i.status <> 'VOID' AND i.period >= ?
            AND it.deleted_at IS NULL AND i.deleted_at IS NULL
          GROUP BY it.kind ORDER BY amount DESC`,
      )
      .bind(ctx.tenantId, fromPeriod)
      .all<{ kind: string; amount: number }>();
    return res.results ?? [];
  }
}

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */

export class Repos {
  readonly audit: AuditRepo;

  readonly buildings: BuildingRepo;
  readonly rooms: RoomRepo;
  readonly parties: PartyRepo;
  readonly residentProfiles: TenantScopedRepo<ResidentProfile>;
  readonly contracts: ContractRepo;
  readonly meterReadings: MeterRepo;
  readonly meterWalks: MeterWalkRepo;
  readonly invoices: InvoiceRepo;
  readonly invoiceItems: TenantScopedRepo<InvoiceItem>;
  readonly payments: PaymentRepo;
  readonly tickets: TicketRepo;
  readonly announcements: AnnouncementRepo;
  readonly roles: TenantScopedRepo<Role>;
  readonly memberships: TenantScopedRepo<Membership>;
  readonly invitations: InvitationRepo;
  readonly counters: InvoiceCounterRepo;
  readonly search: SearchRepo;
  readonly stats: StatsRepo;

  constructor(private readonly d1: D1Database, secrets: CryptoSecrets) {
    this.audit = new AuditRepo(d1);

    this.buildings = new BuildingRepo(d1);
    this.rooms = new RoomRepo(d1);
    this.parties = new PartyRepo(d1, this.audit, secrets);
    this.residentProfiles = new TenantScopedRepo<ResidentProfile>(d1, spec.residentProfileSpec);
    this.contracts = new ContractRepo(d1, this.audit);
    this.meterReadings = new MeterRepo(d1);
    this.meterWalks = new MeterWalkRepo(d1);
    this.invoices = new InvoiceRepo(d1, this.audit);
    this.invoiceItems = new TenantScopedRepo<InvoiceItem>(d1, spec.invoiceItemSpec);
    this.payments = new PaymentRepo(d1, this.audit);
    this.tickets = new TicketRepo(d1);
    this.announcements = new AnnouncementRepo(d1, this.audit);
    this.roles = new TenantScopedRepo<Role>(d1, spec.roleSpec);
    this.memberships = new TenantScopedRepo<Membership>(d1, spec.membershipSpec);
    this.invitations = new InvitationRepo(d1, this.audit, secrets?.PII_PEPPER ?? '');
    this.counters = new InvoiceCounterRepo(d1);
    this.search = new SearchRepo(d1);
    this.stats = new StatsRepo(d1);
  }

  /**
   * Seeds the three preset roles for a newly approved tenant.
   *
   * Runs once, in one batch. A tenant that reached ACTIVE with no OWNER role is
   * a tenant whose owner cannot do anything, and there is no screen from which
   * to fix it.
   */
  async seedPresetRoles(ctx: TenantContext, presets: Record<string, { name: string; rank: number; permissions: string[] }>) {
    const now = new Date().toISOString();
    await this.d1.batch(
      Object.entries(presets).map(([key, preset]) =>
        this.d1
          .prepare(
            `INSERT INTO role (tenant_id, role_id, key, name, permissions, is_system, rank, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          )
          .bind(ctx.tenantId, ulid(), key, preset.name, JSON.stringify(preset.permissions), preset.rank, now, now),
      ),
    );
  }
}

export { AuditRepo, GuardFailedError, NotFoundError, ForbiddenError };
export { IdentityRepo } from './identity';
export { InvitationRepo, formatCode } from './invitation';
export type { Page, PageOption, QueryOption, TenantContext };
