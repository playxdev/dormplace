export interface Building {
  id: string; name: string; address: string | null; tax_id: string | null;
  promptpay_id: string | null; promptpay_name: string | null;
  water_rate: number; water_mode: 'meter' | 'flat'; water_flat: number;
  electric_rate: number; electric_mode: 'meter' | 'flat'; electric_flat: number;
  common_fee: number; late_fee_daily: number; due_day: number; created_at: string;
}

export interface Room {
  id: string; building_id: string; floor: number; number: string; room_type: string | null;
  rent: number; deposit: number; status: 'vacant' | 'occupied' | 'maintenance';
  note: string | null; created_at: string;
}

export interface Tenant {
  id: string; name: string; phone: string | null; email: string | null; line_id: string | null;
  id_card_no: string | null; address: string | null; emergency: string | null;
  note: string | null; created_at: string;
}

export interface Contract {
  id: string; room_id: string; tenant_id: string; start_date: string; end_date: string | null;
  rent: number; deposit: number; deposit_paid: number; deposit_invoiced: number;
  water_start: number; electric_start: number;
  status: 'active' | 'ended'; moved_out_at: string | null; note: string | null; created_at: string;
}

export interface MeterReading {
  id: string; room_id: string; period: string; kind: 'water' | 'electric';
  prev_value: number; value: number; recorded_at: string;
  /** 'recorded' | 'skipped' — a skipped room is walked past, not billed. */
  status: 'recorded' | 'skipped';
  skip_reason: string | null;
  note: string | null;
  photo_key: string | null;
  recorded_by: string | null;
  /** 1 when the walker confirmed a low or spiking reading on purpose. */
  confirmed: number;
}

export interface MeterWalk {
  id: string; building_id: string; period: string;
  started_by: string | null; started_at: string; finished_at: string | null;
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'void';

export interface Invoice {
  id: string; number: string; building_id: string; room_id: string; contract_id: string; tenant_id: string;
  period: string; issue_date: string; due_date: string;
  subtotal: number; discount: number; total: number; paid_total: number;
  status: InvoiceStatus; note: string | null; created_at: string;
}

export type ItemKind = 'rent' | 'water' | 'electric' | 'common' | 'deposit' | 'fine' | 'other';

export interface InvoiceItem {
  id: string; invoice_id: string; kind: ItemKind; label: string; detail: string | null;
  qty: number; unit: string | null; unit_price: number; amount: number; sort: number;
}

export interface Payment {
  id: string; invoice_id: string; amount: number; paid_at: string;
  method: 'promptpay' | 'transfer' | 'cash' | 'card';
  ref: string | null; slip_key: string | null; verified: number; note: string | null; created_at: string;
  /** Set when the tenant reported the payment from the MINI App; NULL when the owner recorded it. */
  reported_by_user_id: string | null;
  /** Deduplicates a retried submission from the MINI App; NULL for backoffice rows. */
  idempotency_key: string | null;
}

export interface Ticket {
  id: string; room_id: string; tenant_id: string | null; title: string; detail: string | null;
  priority: 'low' | 'normal' | 'urgent'; status: 'open' | 'in_progress' | 'done' | 'cancelled';
  photo_key: string | null; created_at: string; closed_at: string | null;
}

export interface User {
  id: string; email: string; password_hash: string; name: string;
  role: 'owner' | 'staff'; created_at: string;
}

export interface Announcement {
  id: string; building_id: string; title: string; body: string;
  /** 1 keeps it above the rest of the tenant's list. */
  pinned: number;
  /** NULL while a draft — a tenant can only ever see a published row. */
  published_at: string | null;
  /** NULL stands until removed. */
  expires_at: string | null;
  created_by: string | null; created_at: string;
}
