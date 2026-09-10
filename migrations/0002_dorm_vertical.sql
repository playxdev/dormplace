-- =====================================================================
--  XYZ Vertical `DORM` — dorm.place
--  Spec    : docs/XYZ_VERTICAL_DORM.md
--  Standard: XYZ_MULTI_TENANT_STANDARD.md v2.0.1
--  Dialect : Cloudflare D1 / SQLite
--
--  Every table below:
--    tenant_id NOT NULL  ·  PRIMARY KEY (tenant_id, <x>_id)
--    every FK carries tenant_id  ·  deleted_at  ·  unique indexes partial
--
--  All ids are ULID (26-char Crockford Base32) stored as TEXT.
--  All timestamps are UTC ISO-8601, created at the application layer.
--  All money is INTEGER satang. 100 satang = 1 THB. Never a float.
-- =====================================================================


-- ---------------------------------------------------------------------
--  BUILDING — an operator may run several
-- ---------------------------------------------------------------------

CREATE TABLE building (
    tenant_id       TEXT NOT NULL REFERENCES tenant(tenant_id),
    building_id     TEXT NOT NULL,
    name            TEXT NOT NULL,
    address         TEXT,
    tax_id          TEXT,
    promptpay_id    TEXT,                              -- phone / national id / e-wallet id
    promptpay_name  TEXT,

    -- Utility rates are satang per unit. For an operator letting 5+ units these
    -- may not exceed actual cost (VERTICAL §10) — validated at the app layer,
    -- which is also where the MEA/PEA/MWA reference rate lives.
    water_rate      INTEGER NOT NULL DEFAULT 1800,
    water_mode      TEXT    NOT NULL DEFAULT 'meter' CHECK (water_mode IN ('meter','flat')),
    water_flat      INTEGER NOT NULL DEFAULT 0,
    electric_rate   INTEGER NOT NULL DEFAULT 800,
    electric_mode   TEXT    NOT NULL DEFAULT 'meter' CHECK (electric_mode IN ('meter','flat')),
    electric_flat   INTEGER NOT NULL DEFAULT 0,

    common_fee      INTEGER NOT NULL DEFAULT 0,
    late_fee_daily  INTEGER NOT NULL DEFAULT 0,
    due_day         INTEGER NOT NULL DEFAULT 5,

    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    PRIMARY KEY (tenant_id, building_id)
);
CREATE UNIQUE INDEX ux_building_name
    ON building (tenant_id, name) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
--  ROOM
-- ---------------------------------------------------------------------

CREATE TABLE room (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    room_id      TEXT NOT NULL,
    building_id  TEXT NOT NULL,
    floor        INTEGER NOT NULL DEFAULT 1,
    number       TEXT NOT NULL,
    room_type    TEXT,
    rent         INTEGER NOT NULL DEFAULT 0,
    deposit      INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'VACANT'
                 CHECK (status IN ('VACANT','OCCUPIED','MAINTENANCE')),
    note         TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, room_id),
    FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, building_id)
);
-- Was UNIQUE (building_id, number) — global, and impossible to soft-delete against.
CREATE UNIQUE INDEX ux_room_number
    ON room (tenant_id, building_id, number) WHERE deleted_at IS NULL;
CREATE INDEX ix_room_grid ON room (tenant_id, building_id, floor, number);


-- ---------------------------------------------------------------------
--  RESIDENT_PROFILE — dorm-specific PII, 1:1 on top of core PARTY
--
--  PARTY already holds display_name, phone (hash/masked/enc) and email.
--  This table holds only what the core does not, and holds it encrypted:
--  a Thai national ID is not a field that may sit in plaintext next to a name.
--  Reading national_id_enc requires app.resident.pii_view and is audited on
--  every call (STANDARD §12.5).
-- ---------------------------------------------------------------------

CREATE TABLE resident_profile (
    tenant_id            TEXT NOT NULL REFERENCES tenant(tenant_id),
    party_id             TEXT NOT NULL,
    national_id_enc      TEXT,      -- ciphertext. never the plaintext number
    national_id_last4    TEXT,      -- for confirming identity at the desk without decrypting
    registered_address   TEXT,
    emergency_name       TEXT,
    emergency_phone_enc  TEXT,
    emergency_relation   TEXT,
    note                 TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    PRIMARY KEY (tenant_id, party_id),
    FOREIGN KEY (tenant_id, party_id) REFERENCES party (tenant_id, party_id)
);


-- ---------------------------------------------------------------------
--  CONTRACT — the lease
--
--  agreed_* is a snapshot taken when the resident confirmed, not a reference.
--  If the operator later amends the rent, what the resident agreed to must not
--  move with it.
-- ---------------------------------------------------------------------

CREATE TABLE contract (
    tenant_id             TEXT NOT NULL REFERENCES tenant(tenant_id),
    contract_id           TEXT NOT NULL,
    room_id               TEXT NOT NULL,
    party_id              TEXT NOT NULL,          -- FK to PARTY, never MEMBERSHIP
    start_date            TEXT NOT NULL,          -- YYYY-MM-DD
    end_date              TEXT,
    billing_cycle         TEXT NOT NULL DEFAULT 'MONTHLY'
                          CHECK (billing_cycle IN ('DAILY','MONTHLY','YEARLY')),
    rent                  INTEGER NOT NULL,
    deposit               INTEGER NOT NULL DEFAULT 0,
    deposit_paid          INTEGER NOT NULL DEFAULT 0,   -- collected from the resident
    deposit_invoiced      INTEGER NOT NULL DEFAULT 0,   -- already put on an invoice
    deposit_returned      INTEGER NOT NULL DEFAULT 0,
    deposit_return_due_at TEXT,      -- end + 7 days, legally required (VERTICAL §10)
    water_start           INTEGER NOT NULL DEFAULT 0,
    electric_start        INTEGER NOT NULL DEFAULT 0,

    status                TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','ACTIVE','ENDING','ENDED')),
    ending_notice_at      TEXT,
    ending_reason         TEXT,
    ended_at              TEXT,

    -- What the resident saw and accepted, captured at confirmation.
    confirmed_at          TEXT,
    agreed_rent           INTEGER,
    agreed_deposit        INTEGER,
    agreed_start_date     TEXT,
    agreed_terms_version  TEXT,
    agreed_pdpa_version   TEXT,

    note                  TEXT,
    version               INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted_at            TEXT,
    PRIMARY KEY (tenant_id, contract_id),
    FOREIGN KEY (tenant_id, room_id)  REFERENCES room  (tenant_id, room_id),
    FOREIGN KEY (tenant_id, party_id) REFERENCES party (tenant_id, party_id)
);
-- One live lease per room. ENDED and DRAFT do not occupy it.
CREATE UNIQUE INDEX ux_contract_room_live
    ON contract (tenant_id, room_id)
    WHERE status IN ('ACTIVE','ENDING') AND deleted_at IS NULL;
CREATE INDEX ix_contract_party ON contract (tenant_id, party_id, status);
CREATE INDEX ix_contract_room  ON contract (tenant_id, room_id, status);


-- ---------------------------------------------------------------------
--  METER_READING
--
--  status tells "confirmed odd" apart from "nobody has looked yet", which is
--  the difference between a safe billing run and a wrong invoice.
-- ---------------------------------------------------------------------

CREATE TABLE meter_reading (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    reading_id   TEXT NOT NULL,
    room_id      TEXT NOT NULL,
    contract_id  TEXT,                    -- null when the room was vacant that period
    period       TEXT NOT NULL,           -- YYYY-MM
    kind         TEXT NOT NULL CHECK (kind IN ('WATER','ELECTRIC')),
    prev_value   INTEGER NOT NULL DEFAULT 0,
    value        INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'RECORDED'
                 CHECK (status IN ('PENDING','RECORDED','SKIPPED','CONFIRMED')),
    skip_reason  TEXT,                    -- required when status='SKIPPED'
    photo_key    TEXT,                    -- R2: t/{tenant_id}/{yyyy}/{mm}/{ulid}
    note         TEXT,
    recorded_by  TEXT,                    -- account_id
    recorded_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, reading_id),
    FOREIGN KEY (tenant_id, room_id)     REFERENCES room     (tenant_id, room_id),
    FOREIGN KEY (tenant_id, contract_id) REFERENCES contract (tenant_id, contract_id)
);
CREATE UNIQUE INDEX ux_reading_room_period
    ON meter_reading (tenant_id, room_id, period, kind) WHERE deleted_at IS NULL;
CREATE INDEX ix_reading_period ON meter_reading (tenant_id, period, status);


-- ---------------------------------------------------------------------
--  METER_WALK — one field session per building × period, so progress
--  survives closing the phone
-- ---------------------------------------------------------------------

CREATE TABLE meter_walk (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    walk_id      TEXT NOT NULL,
    building_id  TEXT NOT NULL,
    period       TEXT NOT NULL,           -- YYYY-MM
    started_by   TEXT,                    -- account_id
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, walk_id),
    FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, building_id)
);
CREATE UNIQUE INDEX ux_walk_building_period
    ON meter_walk (tenant_id, building_id, period) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
--  INVOICE
--
--  paid_total is NOT stored. A balance is derived as
--      total - SUM(payment.amount WHERE status='VERIFIED')
--  which is what keeps it correct without a transaction D1 cannot give.
--  status likewise: PARTIAL and PAID are computed by effective_status(),
--  never written. Only DRAFT / UNPAID / VOID are set by a human action.
-- ---------------------------------------------------------------------

CREATE TABLE invoice (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    invoice_id   TEXT NOT NULL,
    number       TEXT NOT NULL,
    building_id  TEXT NOT NULL,
    room_id      TEXT NOT NULL,
    contract_id  TEXT NOT NULL,
    party_id     TEXT NOT NULL,
    period       TEXT NOT NULL,           -- YYYY-MM
    issue_date   TEXT NOT NULL,
    due_date     TEXT NOT NULL,
    subtotal     INTEGER NOT NULL DEFAULT 0,
    discount     INTEGER NOT NULL DEFAULT 0,
    total        INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','UNPAID','VOID')),
    void_reason  TEXT,                    -- required when status='VOID'
    voided_by    TEXT,
    voided_at    TEXT,
    note         TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, invoice_id),
    FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, building_id),
    FOREIGN KEY (tenant_id, room_id)     REFERENCES room     (tenant_id, room_id),
    FOREIGN KEY (tenant_id, contract_id) REFERENCES contract (tenant_id, contract_id),
    FOREIGN KEY (tenant_id, party_id)    REFERENCES party    (tenant_id, party_id)
);
-- Was invoice.number TEXT NOT NULL UNIQUE — globally unique, so operator B's
-- numbering would collide with operator A's on the second tenant.
CREATE UNIQUE INDEX ux_invoice_number
    ON invoice (tenant_id, number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_invoice_contract_period
    ON invoice (tenant_id, contract_id, period)
    WHERE status <> 'VOID' AND deleted_at IS NULL;
CREATE INDEX ix_invoice_period ON invoice (tenant_id, period, status);
CREATE INDEX ix_invoice_party  ON invoice (tenant_id, party_id, status);
CREATE INDEX ix_invoice_due    ON invoice (tenant_id, status, due_date);


CREATE TABLE invoice_item (
    tenant_id  TEXT NOT NULL REFERENCES tenant(tenant_id),
    item_id    TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    kind       TEXT NOT NULL
               CHECK (kind IN ('RENT','WATER','ELECTRIC','COMMON','DEPOSIT','FINE','OTHER')),
    label      TEXT NOT NULL,
    detail     TEXT,
    qty        REAL NOT NULL DEFAULT 1,
    unit       TEXT,
    unit_price INTEGER NOT NULL DEFAULT 0,
    amount     INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (tenant_id, item_id),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoice (tenant_id, invoice_id)
);
CREATE INDEX ix_item_invoice ON invoice_item (tenant_id, invoice_id, sort);


-- ---------------------------------------------------------------------
--  PAYMENT
--
--  Money moves PromptPay-direct to the operator's bank. This system never
--  touches it and cannot know a transfer happened, so the resident reports it
--  and the operator verifies it against their statement.
--  Only status='VERIFIED' counts toward a balance.
-- ---------------------------------------------------------------------

CREATE TABLE payment (
    tenant_id           TEXT NOT NULL REFERENCES tenant(tenant_id),
    payment_id          TEXT NOT NULL,
    invoice_id          TEXT NOT NULL,
    amount              INTEGER NOT NULL,
    paid_at             TEXT NOT NULL,
    method              TEXT NOT NULL DEFAULT 'PROMPTPAY'
                        CHECK (method IN ('PROMPTPAY','TRANSFER','CASH','CARD')),
    ref                 TEXT,
    slip_key            TEXT,                  -- R2 key
    status              TEXT NOT NULL DEFAULT 'REPORTED'
                        CHECK (status IN ('REPORTED','VERIFIED','REJECTED')),
    reject_reason       TEXT,                  -- required when status='REJECTED', shown verbatim
    verified_by         TEXT,
    verified_at         TEXT,
    reported_by_account TEXT,                  -- null when staff recorded it directly
    idempotency_key     TEXT,                  -- a resident on a bad network will tap twice
    note                TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    PRIMARY KEY (tenant_id, payment_id),
    FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoice (tenant_id, invoice_id)
);
-- Was a global unique index on idempotency_key alone.
CREATE UNIQUE INDEX ux_payment_idem
    ON payment (tenant_id, idempotency_key)
    WHERE deleted_at IS NULL AND idempotency_key IS NOT NULL;
CREATE INDEX ix_payment_invoice ON payment (tenant_id, invoice_id, status);
CREATE INDEX ix_payment_queue   ON payment (tenant_id, status, created_at);


-- ---------------------------------------------------------------------
--  TICKET — repair request
-- ---------------------------------------------------------------------

CREATE TABLE ticket (
    tenant_id   TEXT NOT NULL REFERENCES tenant(tenant_id),
    ticket_id   TEXT NOT NULL,
    room_id     TEXT NOT NULL,
    party_id    TEXT,                      -- null when staff filed it
    title       TEXT NOT NULL,
    detail      TEXT,
    priority    TEXT NOT NULL DEFAULT 'NORMAL'
                CHECK (priority IN ('LOW','NORMAL','URGENT')),
    status      TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
    photo_key   TEXT,
    assigned_to TEXT,                      -- account_id
    close_note  TEXT,
    closed_at   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    PRIMARY KEY (tenant_id, ticket_id),
    FOREIGN KEY (tenant_id, room_id)  REFERENCES room  (tenant_id, room_id),
    FOREIGN KEY (tenant_id, party_id) REFERENCES party (tenant_id, party_id)
);
CREATE INDEX ix_ticket_status ON ticket (tenant_id, status, created_at);
CREATE INDEX ix_ticket_room   ON ticket (tenant_id, room_id, status);


-- ---------------------------------------------------------------------
--  ANNOUNCEMENT — the notice board by the lift, not a letter.
--  Scoped to a building, never to a room or a person.
-- ---------------------------------------------------------------------

CREATE TABLE announcement (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    announcement_id TEXT NOT NULL,
    building_id  TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,                     -- null while a draft; nothing outside
                                           -- the backoffice may read an unpublished row
    expires_at   TEXT,                     -- null = stands until removed
    pushed_at    TEXT,                     -- one LINE push per announcement, ever
    created_by   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, announcement_id),
    FOREIGN KEY (tenant_id, building_id) REFERENCES building (tenant_id, building_id)
);
CREATE INDEX ix_announcement_building
    ON announcement (tenant_id, building_id, published_at DESC);


-- One row the first time a resident opens an announcement. Absence is unread.
-- Nothing is written on publish, so announcing to 100 rooms costs zero writes
-- and one write per resident who actually reads — the shape that matters
-- against D1's 100k writes/day.
CREATE TABLE announcement_read (
    tenant_id       TEXT NOT NULL REFERENCES tenant(tenant_id),
    announcement_id TEXT NOT NULL,
    account_id      TEXT NOT NULL REFERENCES account(account_id),
    read_at         TEXT NOT NULL,
    PRIMARY KEY (tenant_id, announcement_id, account_id),
    FOREIGN KEY (tenant_id, announcement_id)
        REFERENCES announcement (tenant_id, announcement_id)
);


-- ---------------------------------------------------------------------
--  INVOICE_COUNTER — per-tenant numbering.
--  Was a single global `counters` table, which would have handed operator B
--  operator A's next invoice number.
-- ---------------------------------------------------------------------

CREATE TABLE invoice_counter (
    tenant_id  TEXT NOT NULL REFERENCES tenant(tenant_id),
    key        TEXT NOT NULL,              -- e.g. 'INV-2026-09'
    value      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);


-- =====================================================================
--  GLOBAL infrastructure tables (no tenant_id — register as global in
--  table_registry.yaml, INV-02)
--
--  A session belongs to an ACCOUNT, not to a tenant: one sign-in may reach
--  several memberships. The tenant context is resolved per request from
--  membership, never carried in the session row (STANDARD §9.4).
-- =====================================================================

CREATE TABLE session (
    session_id  TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES account(account_id),
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX ix_session_account ON session (account_id, expires_at);


-- The password for an EMAIL identity.
--
-- ACCOUNT_IDENTITY records *that* an account signs in with an email address;
-- it has no column for a secret, and the core schema is not ours to change. A
-- separate table is the right shape anyway: LINE, Google and Apple identities
-- have no password at all, and a table that is empty for most rows is a column
-- that lies about what an identity is.
--
-- Stored as `pbkdf2$<iterations>$<salt>$<hash>`. Iterations must stay at or
-- below 100 000 — the Workers runtime refuses more, and the count lives inside
-- the string, so raising it also breaks every hash already written.
CREATE TABLE password_credential (
    account_id   TEXT PRIMARY KEY REFERENCES account(account_id),
    hash         TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);


-- One table for every single-use, short-lived token. They differ only in
-- purpose and lifetime, and a second table would duplicate the consume-once
-- logic that is the whole point.
--
-- The token itself is never stored. token_hash is SHA-256 of the value handed
-- out, so a leaked database cannot be replayed as a set of live links.
CREATE TABLE auth_token (
    token_id    TEXT PRIMARY KEY,
    purpose     TEXT NOT NULL
                CHECK (purpose IN ('EMAIL_VERIFY','RECOVERY','MANUAL_RECOVERY')),
    account_id  TEXT NOT NULL REFERENCES account(account_id),
    token_hash  TEXT NOT NULL UNIQUE,
    sent_to     TEXT,      -- kept so a later change of email cannot redirect a
                           -- link already in flight
    expires_at  TEXT NOT NULL,
    consumed_at TEXT,
    issued_by   TEXT,      -- MANUAL_RECOVERY only: the staff account that
                           -- vouched for the person standing in the room
    created_at  TEXT NOT NULL
);
CREATE INDEX ix_auth_token_account ON auth_token (account_id, purpose);


-- ---------------------------------------------------------------------
--  CONTRACT_INVITATION — which lease an invitation is for
--
--  Core INVITATION has no contract_id and must not gain one: it is shared by
--  every vertical, and a debt-collection tenant has no leases. The link is a
--  vertical table instead.
--
--  One row per invitation. Several invitations may point at the same lease
--  over its life — reissuing after a lost handover sheet — and only the newest
--  un-revoked one is current.
-- ---------------------------------------------------------------------

CREATE TABLE contract_invitation (
    tenant_id      TEXT NOT NULL REFERENCES tenant(tenant_id),
    invitation_id  TEXT NOT NULL,
    contract_id    TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (tenant_id, invitation_id),
    FOREIGN KEY (tenant_id, invitation_id) REFERENCES invitation (tenant_id, invitation_id),
    FOREIGN KEY (tenant_id, contract_id)   REFERENCES contract (tenant_id, contract_id)
);
CREATE INDEX ix_contract_invitation ON contract_invitation (tenant_id, contract_id);


-- ---------------------------------------------------------------------
--  DATA_KEY — one wrapped encryption key per subject, for crypto-shredding
--
--  VERTICAL §12 promises that erasing a resident's national ID means deleting
--  a key, not rewriting rows. That only works if the key lives apart from the
--  ciphertext: an envelope stored inline would make "shred the key" identical
--  to "overwrite the value", which is useless for anything already written to
--  R2 and expensive for anything spread across tables.
--
--  So: a random data key per subject, encrypted under a master key held in the
--  Workers secret store and never in this database. Deleting one row here makes
--  every field and every file encrypted under that key permanently unreadable,
--  in one write, without touching them.
--
--  Global rather than tenant-scoped: a key belongs to the person, and the same
--  person may be a party at two operators.
-- ---------------------------------------------------------------------

CREATE TABLE data_key (
    subject_id   TEXT PRIMARY KEY,   -- party_id or account_id
    wrapped_key  TEXT NOT NULL,      -- AES-GCM(master, data_key), base64
    created_at   TEXT NOT NULL,
    shredded_at  TEXT                -- set when the row is emptied for erasure
);


-- =====================================================================
--  Two tables here carry no deleted_at, deliberately
--
--  Rule 7 puts deleted_at on every table. `announcement_read` and
--  `invoice_counter` are the same exception the core schema already makes for
--  membership_event, invitation_redemption, consent_record, audit_event,
--  webhook_event_seen and platform_policy: neither is an entity. One is an
--  append-only read receipt whose uniqueness is its whole primary key; the
--  other is a counter. "Soft-deleted receipt" and "soft-deleted counter" are
--  not states that mean anything, and a partial index has nothing to be
--  partial on. Recorded here rather than deviated from silently.
--
--  Notes carried forward from the pre-XYZ schema
--
--  · PBKDF2 iterations MUST stay <= 100 000. The Workers runtime refuses
--    above it, and the count lives inside the stored hash, so old hashes
--    throw as well.
--  · Every multi-statement write is a batch() whose FIRST statement is the
--    guard, and the batch fails whole unless that statement affects 1 row.
--  · PRAGMA foreign_keys = ON on every connection.
--  · No cron may decide correctness. effective_status() is computed at read
--    time: an invoice is overdue because due_date < today, not because a job
--    ran.
-- =====================================================================
