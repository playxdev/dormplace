-- Identity recovery, versioned terms, and the rental period.
--
-- Four things this adds, all of them cheaper now than later because every one
-- of them is invisible until a row is written without it:
--
--   1. A contract knows its rental period. Nothing reads it yet — the system
--      serves monthly and yearly tenancies — but adding the column once
--      invoices exist would be a migration across everything that computes a
--      billing round, and adding it now is a column.
--   2. A confirmation records which version of the terms and of the privacy
--      notice the tenant was shown. Without it, every confirmation made today
--      is un-versioned forever: there is no way back to "which document did
--      this person actually agree to?".
--   3. An account can carry a verified email, which is the only thing that
--      makes recovery possible. A tenant onboarded without one is locked out
--      permanently the day they lose their LINE account.
--   4. Rebinding an identity leaves an audit trail.
--
-- It also removes tenants.user_id: the same fact was stored twice, and keeping
-- both forced the invite claim to be two writes that D1 cannot make atomic.

-- 1. Rental period ---------------------------------------------------------

ALTER TABLE contracts ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_cycle IN ('daily', 'monthly', 'yearly'));

-- 2. What the tenant agreed to ---------------------------------------------
--
-- The agreed_* columns already snapshot the money. These name the documents.
-- A version is a pointer into version control, which is enough to reproduce
-- exactly what was on screen; a rendered PDF and its hash wait for R2.

ALTER TABLE contracts ADD COLUMN agreed_terms_version TEXT;
ALTER TABLE contracts ADD COLUMN agreed_pdpa_version TEXT;

-- 3. Verified contact ------------------------------------------------------
--
-- users.email already exists and is unique. What was missing is proof that the
-- address belongs to whoever typed it — an unverified address recovers nothing.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- One table for every single-use, short-lived token this system issues. They
-- differ only in purpose and lifetime, and a second table would duplicate the
-- consume-once logic that is the whole point.
--
-- The token itself is never stored. token_hash is SHA-256 of the value handed
-- out, so a leaked database cannot be replayed as a set of live links.
CREATE TABLE auth_tokens (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verify', 'recovery', 'manual_recovery')),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  -- The address the token was sent to, kept so a later change of email cannot
  -- retroactively redirect a link already in flight.
  sent_to     TEXT,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  -- Set for manual_recovery only: the staff account that vouched for the
  -- person in the room, which is the only evidence that check ever happened.
  issued_by   TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens (user_id, purpose);

-- 4. Audit -----------------------------------------------------------------
--
-- Rebinding is the one operation that changes who can sign in as an existing
-- tenant. It is written append-only and never updated.
CREATE TABLE identity_audit_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('line_rebind', 'manual_rebind', 'email_verified')),
  provider    TEXT,
  old_subject TEXT,
  new_subject TEXT,
  -- Who approved it, for manual_rebind. NULL when the tenant did it themselves
  -- through a verified email.
  approved_by TEXT REFERENCES users(id),
  request_id  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_identity_audit_user ON identity_audit_logs (user_id, created_at);

-- 5. One fact, one place ---------------------------------------------------
--
-- tenants.user_id said the same thing as contracts.confirmed_by_user_id, and
-- the invite claim had to write both. D1 accepts parameters only on a single
-- statement, so those two writes could never be one atomic unit: a failure
-- between them left a contract confirmed and its tenant record unlinked.
--
-- Deriving the link through the contract removes the second write, and with it
-- the state that needed recovering.

DROP INDEX IF EXISTS idx_tenants_user;
ALTER TABLE tenants DROP COLUMN user_id;
