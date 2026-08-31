-- DormThai core schema. All money stored as INTEGER satang (100 satang = 1 THB).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','staff')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE buildings (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  tax_id         TEXT,
  promptpay_id   TEXT,               -- phone / national id / e-wallet id
  promptpay_name TEXT,
  water_rate     INTEGER NOT NULL DEFAULT 1800,  -- satang per unit
  water_mode     TEXT NOT NULL DEFAULT 'meter' CHECK (water_mode IN ('meter','flat')),
  water_flat     INTEGER NOT NULL DEFAULT 0,
  electric_rate  INTEGER NOT NULL DEFAULT 800,
  electric_mode  TEXT NOT NULL DEFAULT 'meter' CHECK (electric_mode IN ('meter','flat')),
  electric_flat  INTEGER NOT NULL DEFAULT 0,
  common_fee     INTEGER NOT NULL DEFAULT 0,
  late_fee_daily INTEGER NOT NULL DEFAULT 0,
  due_day        INTEGER NOT NULL DEFAULT 5,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor       INTEGER NOT NULL DEFAULT 1,
  number      TEXT NOT NULL,
  room_type   TEXT,
  rent        INTEGER NOT NULL DEFAULT 0,
  deposit     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant','occupied','maintenance')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (building_id, number)
);
CREATE INDEX idx_rooms_building ON rooms(building_id, floor, number);

CREATE TABLE tenants (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  line_id      TEXT,
  id_card_no   TEXT,
  address      TEXT,
  emergency    TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tenants_name ON tenants(name);

CREATE TABLE contracts (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  start_date    TEXT NOT NULL,       -- YYYY-MM-DD
  end_date      TEXT,
  rent          INTEGER NOT NULL,
  deposit       INTEGER NOT NULL DEFAULT 0,
  deposit_paid  INTEGER NOT NULL DEFAULT 0,   -- collected from tenant
  deposit_invoiced INTEGER NOT NULL DEFAULT 0, -- already put on an invoice
  water_start   INTEGER NOT NULL DEFAULT 0,
  electric_start INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  moved_out_at  TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contracts_room ON contracts(room_id, status);
CREATE INDEX idx_contracts_tenant ON contracts(tenant_id);

CREATE TABLE meter_readings (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,          -- YYYY-MM
  kind       TEXT NOT NULL CHECK (kind IN ('water','electric')),
  prev_value INTEGER NOT NULL DEFAULT 0,
  value      INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, period, kind)
);

CREATE TABLE invoices (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  building_id  TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  contract_id  TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,        -- YYYY-MM
  issue_date   TEXT NOT NULL,
  due_date     TEXT NOT NULL,
  subtotal     INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  paid_total   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','partial','paid','void')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (contract_id, period)
);
CREATE INDEX idx_invoices_period ON invoices(period, status);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);

CREATE TABLE invoice_items (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('rent','water','electric','common','deposit','fine','other')),
  label      TEXT NOT NULL,
  detail     TEXT,
  qty        REAL NOT NULL DEFAULT 1,
  unit       TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_invoice ON invoice_items(invoice_id, sort);

CREATE TABLE payments (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  paid_at    TEXT NOT NULL,
  method     TEXT NOT NULL DEFAULT 'promptpay' CHECK (method IN ('promptpay','transfer','cash','card')),
  ref        TEXT,
  slip_key   TEXT,
  verified   INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE tickets (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id  TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  detail     TEXT,
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  photo_key  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT
);
CREATE INDEX idx_tickets_status ON tickets(status, created_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
