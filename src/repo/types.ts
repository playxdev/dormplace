/**
 * Row types for the XYZ schema (migrations.v2).
 *
 * Separate from `src/types.ts`, which still describes the pre-XYZ tables the
 * routes are written against. Both exist during the rewrite; `src/types.ts`
 * goes when the last route moves.
 *
 * Money is INTEGER satang throughout. Timestamps are UTC ISO-8601 strings,
 * created at the application layer — never by the database, because a default
 * of `datetime('now')` produces a different format from `toISOString()` and the
 * two sort differently once mixed.
 */

export interface Row {
  tenant_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  [key: string]: unknown;
}

/* ---------- core (STANDARD §3) ---------- */

export interface Role extends Row {
  role_id: string;
  key: string;
  name: string;
  /** JSON array of permission strings, stored as TEXT on every engine. */
  permissions: string;
  is_system: number;
  rank: number;
}

export type MembershipStatus =
  | 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'RELEASE_PENDING' | 'LEFT' | 'BANNED' | 'REJECTED';

export interface Membership extends Row {
  membership_id: string;
  account_id: string;
  kind: 'CLIENT' | 'STAFF';
  status: MembershipStatus;
  role_id: string | null;
  display_code: string | null;
  invitation_id: string | null;
  joined_at: string | null;
  suspended_at: string | null;
  suspend_expires_at: string | null;
  release_initiated_by: 'TENANT' | 'CLIENT' | 'PLATFORM' | null;
  release_initiator_id: string | null;
  release_reason: string | null;
  release_requested_at: string | null;
  release_effective_at: string | null;
  release_ack_at: string | null;
  release_reject_count: number;
  left_at: string | null;
  banned_reason: string | null;
  version: number;
}

/** A person the operator knows. May never have an account. */
export interface Party extends Row {
  party_id: string;
  kind: 'PRIMARY' | 'OCCUPANT' | 'GUARANTOR' | 'EMERGENCY';
  display_name: string | null;
  phone_hash: string | null;
  phone_masked: string | null;
  phone_enc: string | null;
  email_hash: string | null;
  email_enc: string | null;
  external_ref: string | null;
  account_id: string | null;
  membership_id: string | null;
  linked_at: string | null;
  created_by: 'STAFF' | 'IMPORT' | 'SELF';
  version: number;
}

export interface Invitation {
  tenant_id: string;
  invitation_id: string;
  purpose: 'CLIENT' | 'STAFF';
  role_id: string | null;
  delivery: 'CODE' | 'LINK' | 'QR';
  verification: 'NONE' | 'OTP_PHONE' | 'LINE_LOGIN';
  binding: 'OPEN' | 'TARGETED';
  target_kind: 'PHONE' | 'LINE' | 'EMAIL' | null;
  target_value_hash: string | null;
  target_hint: string | null;
  secret_hash: string;
  secret_prefix: string | null;
  max_usage: number;
  used_count: number;
  requires_approval: number;
  expires_at: string;
  status: 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'REVOKED';
  created_by: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
  [key: string]: unknown;
}

/* ---------- vertical: DORM ---------- */

export interface Building extends Row {
  building_id: string;
  name: string;
  address: string | null;
  tax_id: string | null;
  promptpay_id: string | null;
  promptpay_name: string | null;
  water_rate: number;
  water_mode: 'meter' | 'flat';
  water_flat: number;
  electric_rate: number;
  electric_mode: 'meter' | 'flat';
  electric_flat: number;
  common_fee: number;
  late_fee_daily: number;
  due_day: number;
}

export interface Room extends Row {
  room_id: string;
  building_id: string;
  floor: number;
  number: string;
  room_type: string | null;
  rent: number;
  deposit: number;
  status: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE';
  note: string | null;
}

/** Dorm-specific PII, 1:1 on PARTY. Reading national_id_enc is audited. */
export interface ResidentProfile extends Row {
  party_id: string;
  national_id_enc: string | null;
  national_id_last4: string | null;
  registered_address: string | null;
  emergency_name: string | null;
  emergency_phone_enc: string | null;
  emergency_relation: string | null;
  note: string | null;
}

export type ContractStatus = 'DRAFT' | 'ACTIVE' | 'ENDING' | 'ENDED';

export interface Contract extends Row {
  contract_id: string;
  room_id: string;
  party_id: string;
  start_date: string;
  end_date: string | null;
  billing_cycle: 'DAILY' | 'MONTHLY' | 'YEARLY';
  rent: number;
  deposit: number;
  deposit_paid: number;
  deposit_invoiced: number;
  deposit_returned: number;
  deposit_return_due_at: string | null;
  water_start: number;
  electric_start: number;
  status: ContractStatus;
  ending_notice_at: string | null;
  ending_reason: string | null;
  ended_at: string | null;
  confirmed_at: string | null;
  agreed_rent: number | null;
  agreed_deposit: number | null;
  agreed_start_date: string | null;
  agreed_terms_version: string | null;
  agreed_pdpa_version: string | null;
  note: string | null;
  version: number;
}

export interface MeterReading extends Row {
  reading_id: string;
  room_id: string;
  contract_id: string | null;
  period: string;
  kind: 'WATER' | 'ELECTRIC';
  prev_value: number;
  value: number;
  status: 'PENDING' | 'RECORDED' | 'SKIPPED' | 'CONFIRMED';
  skip_reason: string | null;
  photo_key: string | null;
  note: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export interface MeterWalk extends Row {
  walk_id: string;
  building_id: string;
  period: string;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
}

/**
 * `PARTIAL` and `PAID` are not stored. Only DRAFT, UNPAID and VOID are written
 * by a human action; what an invoice has actually been paid is derived from
 * verified payments at read time (see `effectiveInvoiceStatus`).
 */
export type StoredInvoiceStatus = 'DRAFT' | 'UNPAID' | 'VOID';
export type EffectiveInvoiceStatus = StoredInvoiceStatus | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface Invoice extends Row {
  invoice_id: string;
  number: string;
  building_id: string;
  room_id: string;
  contract_id: string;
  party_id: string;
  period: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  discount: number;
  total: number;
  status: StoredInvoiceStatus;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  note: string | null;
  version: number;
}

export type ItemKind = 'RENT' | 'WATER' | 'ELECTRIC' | 'COMMON' | 'DEPOSIT' | 'FINE' | 'OTHER';

export interface InvoiceItem extends Row {
  item_id: string;
  invoice_id: string;
  kind: ItemKind;
  label: string;
  detail: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  sort: number;
}

export interface Payment extends Row {
  payment_id: string;
  invoice_id: string;
  amount: number;
  paid_at: string;
  method: 'PROMPTPAY' | 'TRANSFER' | 'CASH' | 'CARD';
  ref: string | null;
  slip_key: string | null;
  status: 'REPORTED' | 'VERIFIED' | 'REJECTED';
  reject_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  reported_by_account: string | null;
  idempotency_key: string | null;
  note: string | null;
}

export interface Ticket extends Row {
  ticket_id: string;
  room_id: string;
  party_id: string | null;
  title: string;
  detail: string | null;
  priority: 'LOW' | 'NORMAL' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  photo_key: string | null;
  assigned_to: string | null;
  close_note: string | null;
  closed_at: string | null;
}

export interface Announcement extends Row {
  announcement_id: string;
  building_id: string;
  title: string;
  body: string;
  pinned: number;
  published_at: string | null;
  expires_at: string | null;
  pushed_at: string | null;
  created_by: string | null;
}
