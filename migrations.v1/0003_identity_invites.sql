-- Identity, membership and tenant onboarding.
--
-- Three things this adds:
--
--   1. A person can sign in through several providers (LINE, Google, Facebook,
--      email) and still be one account.
--   2. Managing a building is a relationship, not a property of a person. An
--      owner may rent a room elsewhere; a tenant may buy a building later.
--   3. A tenant record can exist before that person has an account. The owner
--      writes the contract first; the tenant attaches their LINE identity to it
--      afterwards by scanning a QR code.

-- users is rebuilt rather than altered: SQLite cannot widen a CHECK constraint
-- or drop NOT NULL in place. email and password_hash become nullable because a
-- tenant signing in with LINE has neither.
CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','staff','tenant')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, email, password_hash, name, role, created_at)
SELECT id, email, password_hash, name, role, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- One row per way of signing in. subject is whatever the provider calls the
-- user: LINE's `sub` claim, Google's `sub`, and so on.
CREATE TABLE identities (
  provider   TEXT NOT NULL CHECK (provider IN ('line','google','facebook','email')),
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX idx_identities_user ON identities (user_id);

-- Who may administer which building. Seat-based billing counts these rows.
CREATE TABLE memberships (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','staff')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, building_id)
);

CREATE INDEX idx_memberships_building ON memberships (building_id);

-- Links the tenant record the owner typed to the account that person signs in
-- with. NULL until they claim their invite, which is the normal state for a
-- tenant who has not opened the app.
ALTER TABLE tenants ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX idx_tenants_user ON tenants (user_id);

-- An invite is an opaque code standing for one contract.
--
-- The QR encodes only this code. Encoding the terms themselves would hand them
-- to anyone who photographs it, and could never be revoked.
--
-- Single use is enforced by contracts.confirmed_by_user_id being set on claim,
-- not by marking the invite consumed: D1 permits no parameterised
-- multi-statement write, so the claim has to be one statement.
CREATE TABLE invites (
  code        TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_invites_contract ON invites (contract_id);

-- What the tenant saw and accepted, captured at the moment they confirmed.
--
-- A snapshot, not a reference: if the owner later amends the rent, the tenant's
-- record of what they agreed to must not move with it. That is the answer to
-- "what rent did I agree to?" months afterwards.
ALTER TABLE contracts ADD COLUMN confirmed_by_user_id TEXT REFERENCES users(id);
ALTER TABLE contracts ADD COLUMN confirmed_at TEXT;
ALTER TABLE contracts ADD COLUMN agreed_rent INTEGER;
ALTER TABLE contracts ADD COLUMN agreed_deposit INTEGER;
ALTER TABLE contracts ADD COLUMN agreed_start_date TEXT;
