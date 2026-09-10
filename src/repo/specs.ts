/**
 * Table specs — the column whitelist each repository is allowed to touch.
 *
 * `writable` is deliberately narrower than `columns`. tenant_id, the id and the
 * timestamps are absent from every one of them, so no caller can set them by
 * passing a field: tenant_id comes from the context, the id from ulid(), and
 * the timestamps from the repo. Status columns that must move through a state
 * machine with an actor, a reason and an audit row are also absent — a status
 * change goes through its own method, never through a generic update().
 */

import type { TableSpec } from '../lib/repo';

const STAMPS = ['created_at', 'updated_at', 'deleted_at'] as const;

export const buildingSpec: TableSpec = {
  table: 'building',
  idColumn: 'building_id',
  nameColumn: 'name',
  columns: [
    'tenant_id', 'building_id', 'name', 'address', 'tax_id',
    'promptpay_id', 'promptpay_name',
    'water_rate', 'water_mode', 'water_flat',
    'electric_rate', 'electric_mode', 'electric_flat',
    'common_fee', 'late_fee_daily', 'due_day', ...STAMPS,
  ],
  writable: [
    'name', 'address', 'tax_id', 'promptpay_id', 'promptpay_name',
    'water_rate', 'water_mode', 'water_flat',
    'electric_rate', 'electric_mode', 'electric_flat',
    'common_fee', 'late_fee_daily', 'due_day',
  ],
  defaultOrder: [['name', 'ASC']],
};

export const roomSpec: TableSpec = {
  table: 'room',
  idColumn: 'room_id',
  nameColumn: 'number',
  columns: [
    'tenant_id', 'room_id', 'building_id', 'floor', 'number', 'room_type',
    'rent', 'deposit', 'status', 'note', ...STAMPS,
  ],
  // status is writable here: a room is VACANT / OCCUPIED / MAINTENANCE as a
  // consequence of a lease starting or ending, not as an independent decision
  // needing its own reason.
  writable: ['building_id', 'floor', 'number', 'room_type', 'rent', 'deposit', 'status', 'note'],
  defaultOrder: [['floor', 'ASC'], ['number', 'ASC']],
};

export const partySpec: TableSpec = {
  table: 'party',
  idColumn: 'party_id',
  nameColumn: 'display_name',
  columns: [
    'tenant_id', 'party_id', 'kind', 'display_name',
    'phone_hash', 'phone_masked', 'phone_enc', 'email_hash', 'email_enc',
    'external_ref', 'account_id', 'membership_id', 'linked_at', 'created_by',
    'version', ...STAMPS,
  ],
  // account_id / membership_id / linked_at are absent: linking a party to an
  // account is the redemption flow's job, and it happens inside a guarded
  // batch alongside the membership insert. A plain update() could half-do it.
  writable: [
    'kind', 'display_name', 'phone_hash', 'phone_masked', 'phone_enc',
    'email_hash', 'email_enc', 'external_ref',
  ],
  versioned: true,
  defaultOrder: [['display_name', 'ASC']],
};

export const residentProfileSpec: TableSpec = {
  table: 'resident_profile',
  idColumn: 'party_id',
  columns: [
    'tenant_id', 'party_id', 'national_id_enc', 'national_id_last4',
    'registered_address', 'emergency_name', 'emergency_phone_enc',
    'emergency_relation', 'note', ...STAMPS,
  ],
  writable: [
    'national_id_enc', 'national_id_last4', 'registered_address',
    'emergency_name', 'emergency_phone_enc', 'emergency_relation', 'note',
  ],
};

export const contractSpec: TableSpec = {
  table: 'contract',
  idColumn: 'contract_id',
  columns: [
    'tenant_id', 'contract_id', 'room_id', 'party_id',
    'start_date', 'end_date', 'billing_cycle', 'rent', 'deposit',
    'deposit_paid', 'deposit_invoiced', 'deposit_returned', 'deposit_return_due_at',
    'water_start', 'electric_start', 'status',
    'ending_notice_at', 'ending_reason', 'ended_at',
    'confirmed_at', 'agreed_rent', 'agreed_deposit', 'agreed_start_date',
    'agreed_terms_version', 'agreed_pdpa_version', 'note', 'version', ...STAMPS,
  ],
  // status, ending_* and ended_at are not writable. Ending a lease requires a
  // reason and an audit row (VERTICAL §6), and the agreed_* snapshot is written
  // once at confirmation and never again — that is the whole point of it.
  writable: [
    'room_id', 'party_id', 'start_date', 'end_date', 'billing_cycle',
    'rent', 'deposit', 'deposit_paid', 'deposit_invoiced', 'deposit_returned',
    'deposit_return_due_at', 'water_start', 'electric_start', 'note',
  ],
  versioned: true,
  defaultOrder: [['start_date', 'DESC']],
};

export const meterReadingSpec: TableSpec = {
  table: 'meter_reading',
  idColumn: 'reading_id',
  columns: [
    'tenant_id', 'reading_id', 'room_id', 'contract_id', 'period', 'kind',
    'prev_value', 'value', 'status', 'skip_reason', 'photo_key', 'note',
    'recorded_by', 'recorded_at', ...STAMPS,
  ],
  writable: [
    'room_id', 'contract_id', 'period', 'kind', 'prev_value', 'value',
    'status', 'skip_reason', 'photo_key', 'note', 'recorded_by', 'recorded_at',
  ],
  defaultOrder: [['period', 'DESC']],
};

export const meterWalkSpec: TableSpec = {
  table: 'meter_walk',
  idColumn: 'walk_id',
  columns: [
    'tenant_id', 'walk_id', 'building_id', 'period',
    'started_by', 'started_at', 'finished_at', ...STAMPS,
  ],
  writable: ['building_id', 'period', 'started_by', 'started_at', 'finished_at'],
  defaultOrder: [['period', 'DESC']],
};

export const invoiceSpec: TableSpec = {
  table: 'invoice',
  idColumn: 'invoice_id',
  nameColumn: 'number',
  columns: [
    'tenant_id', 'invoice_id', 'number', 'building_id', 'room_id', 'contract_id',
    'party_id', 'period', 'issue_date', 'due_date',
    'subtotal', 'discount', 'total', 'status',
    'void_reason', 'voided_by', 'voided_at', 'note', 'version', ...STAMPS,
  ],
  // status and void_* are absent: voiding is OWNER-only, needs a reason, and
  // writes an audit row. There is no such thing as a routine status update on
  // an invoice.
  writable: [
    'number', 'building_id', 'room_id', 'contract_id', 'party_id',
    'period', 'issue_date', 'due_date', 'subtotal', 'discount', 'total', 'note',
  ],
  versioned: true,
  defaultOrder: [['period', 'DESC'], ['number', 'DESC']],
};

export const invoiceItemSpec: TableSpec = {
  table: 'invoice_item',
  idColumn: 'item_id',
  columns: [
    'tenant_id', 'item_id', 'invoice_id', 'kind', 'label', 'detail',
    'qty', 'unit', 'unit_price', 'amount', 'sort', ...STAMPS,
  ],
  writable: ['invoice_id', 'kind', 'label', 'detail', 'qty', 'unit', 'unit_price', 'amount', 'sort'],
  defaultOrder: [['sort', 'ASC']],
};

export const paymentSpec: TableSpec = {
  table: 'payment',
  idColumn: 'payment_id',
  columns: [
    'tenant_id', 'payment_id', 'invoice_id', 'amount', 'paid_at', 'method',
    'ref', 'slip_key', 'status', 'reject_reason', 'verified_by', 'verified_at',
    'reported_by_account', 'idempotency_key', 'note', ...STAMPS,
  ],
  // status / verified_* / reject_reason move only through verify() — accepting
  // or rejecting a slip is the money decision in this system.
  writable: [
    'invoice_id', 'amount', 'paid_at', 'method', 'ref', 'slip_key',
    'reported_by_account', 'idempotency_key', 'note',
  ],
  defaultOrder: [['paid_at', 'DESC']],
};

export const ticketSpec: TableSpec = {
  table: 'ticket',
  idColumn: 'ticket_id',
  nameColumn: 'title',
  columns: [
    'tenant_id', 'ticket_id', 'room_id', 'party_id', 'title', 'detail',
    'priority', 'status', 'photo_key', 'assigned_to', 'close_note',
    'closed_at', ...STAMPS,
  ],
  writable: [
    'room_id', 'party_id', 'title', 'detail', 'priority', 'status',
    'photo_key', 'assigned_to', 'close_note', 'closed_at',
  ],
  defaultOrder: [['created_at', 'DESC']],
};

export const announcementSpec: TableSpec = {
  table: 'announcement',
  idColumn: 'announcement_id',
  nameColumn: 'title',
  columns: [
    'tenant_id', 'announcement_id', 'building_id', 'title', 'body', 'pinned',
    'published_at', 'expires_at', 'pushed_at', 'created_by', ...STAMPS,
  ],
  // published_at and pushed_at are absent: publishing is a permission-gated
  // action that also decides whether a LINE push goes out, and a push must
  // happen at most once per announcement no matter how often it is edited.
  writable: ['building_id', 'title', 'body', 'pinned', 'expires_at', 'created_by'],
  defaultOrder: [['published_at', 'DESC']],
};

export const roleSpec: TableSpec = {
  table: 'role',
  idColumn: 'role_id',
  nameColumn: 'name',
  columns: [
    'tenant_id', 'role_id', 'key', 'name', 'permissions',
    'is_system', 'rank', ...STAMPS,
  ],
  // A system preset's permissions are not editable and the role is not
  // deletable; enforced in the role repo, not by leaving the column out, since
  // a custom role legitimately edits both.
  writable: ['key', 'name', 'permissions', 'is_system', 'rank'],
  defaultOrder: [['rank', 'DESC']],
};

export const membershipSpec: TableSpec = {
  table: 'membership',
  idColumn: 'membership_id',
  columns: [
    'tenant_id', 'membership_id', 'account_id', 'kind', 'status', 'role_id',
    'display_code', 'invitation_id', 'joined_at',
    'suspended_at', 'suspend_expires_at',
    'release_initiated_by', 'release_initiator_id', 'release_reason',
    'release_requested_at', 'release_effective_at', 'release_ack_at',
    'release_reject_count', 'left_at', 'banned_reason', 'version', ...STAMPS,
  ],
  // Only role_id and display_code are routinely writable. Every status
  // transition is a state-machine method that also appends a MEMBERSHIP_EVENT
  // (STANDARD §5.2), so the generic update() must not be able to reach it.
  writable: ['role_id', 'display_code'],
  versioned: true,
  defaultOrder: [['created_at', 'DESC']],
};

export const invitationSpec: TableSpec = {
  table: 'invitation',
  idColumn: 'invitation_id',
  columns: [
    'tenant_id', 'invitation_id', 'purpose', 'role_id', 'delivery',
    'verification', 'binding', 'target_kind', 'target_value_hash', 'target_hint',
    'secret_hash', 'secret_prefix', 'max_usage', 'used_count',
    'requires_approval', 'expires_at', 'status',
    'created_by', 'revoked_by', 'revoked_at', 'revoke_reason', 'created_at',
  ],
  // An invitation is issued and then only revoked or redeemed. used_count moves
  // inside the redemption guard, never through update().
  writable: [],
  softDelete: false,
  defaultOrder: [['created_at', 'DESC']],
};

export const invoiceCounterSpec: TableSpec = {
  table: 'invoice_counter',
  idColumn: 'key',
  columns: ['tenant_id', 'key', 'value', 'updated_at'],
  writable: [],
  softDelete: false,
};
