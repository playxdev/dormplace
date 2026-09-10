-- =====================================================================
--  XYZ Multi-Tenant Platform — Core Schema
--  Standard: XYZ_MULTI_TENANT_STANDARD.md v2.0.0
--  Dialect : SQLite / Cloudflare D1  (see notes at end of file for PG / MSSQL)
--
--  Rule: do not modify the table structure in this file when creating a new vertical.
--      Add the vertical's tables at the end instead.
--
--  All ids are ULID (26-char Crockford Base32) stored as TEXT
--  All timestamps are UTC ISO-8601, created at the application layer, not at the DB
-- =====================================================================


-- ---------------------------------------------------------------------
-- GLOBAL TABLES  (no tenant_id)
-- ---------------------------------------------------------------------

CREATE TABLE account (
    account_id      TEXT PRIMARY KEY,
    display_name    TEXT,
    avatar_url      TEXT,
    locale          TEXT NOT NULL DEFAULT 'th',
    status          TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE|LOCKED|ERASED|MERGED
    merged_into     TEXT REFERENCES account(account_id),
    erased_at       TEXT,
    last_seen_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);
-- Do not add tenant_id / role / phone_number / line_user_id columns to this table


CREATE TABLE account_identity (
    identity_id      TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES account(account_id),
    provider         TEXT NOT NULL,          -- LINE|PHONE|EMAIL|GOOGLE|APPLE
    provider_scope   TEXT NOT NULL DEFAULT '_',   -- LINE provider_id/channel_id
    external_id      TEXT NOT NULL,          -- LINE userId | E.164 | email (normalized)
    verified_at      TEXT,
    last_verified_at TEXT,
    is_primary       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    deleted_at       TEXT
);
CREATE UNIQUE INDEX ux_identity_external
    ON account_identity (provider, provider_scope, external_id)
    WHERE deleted_at IS NULL;
CREATE INDEX ix_identity_account ON account_identity (account_id);


-- Mechanism enforcing the "1 person = 1 tenant" rule — removable without touching membership.
-- Set platform_policy.client_tenancy_mode = 'MULTI' and stop acquiring the lock.
CREATE TABLE account_client_lock (
    account_id     TEXT PRIMARY KEY REFERENCES account(account_id),
    tenant_id      TEXT NOT NULL,
    membership_id  TEXT NOT NULL,
    acquired_at    TEXT NOT NULL
);


CREATE TABLE tenant (
    tenant_id              TEXT PRIMARY KEY,
    slug                   TEXT NOT NULL,
    name                   TEXT NOT NULL,
    owner_account_id       TEXT NOT NULL REFERENCES account(account_id),
    status                 TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        -- PENDING_APPROVAL|ACTIVE|SUSPENDED|REJECTED|TERMINATED|PURGED
    vertical               TEXT NOT NULL,
    locale                 TEXT NOT NULL DEFAULT 'th',
    timezone               TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    currency               TEXT NOT NULL DEFAULT 'THB',
    data_region            TEXT NOT NULL DEFAULT 'auto',
    release_grace_days     INTEGER NOT NULL DEFAULT 7,
    client_leave_sla_days  INTEGER NOT NULL DEFAULT 14,
    suspended_at           TEXT,
    suspend_reason         TEXT,
    terminated_at          TEXT,
    terminate_reason       TEXT,
    retention_until        TEXT,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    deleted_at             TEXT
);
CREATE UNIQUE INDEX ux_tenant_slug ON tenant (slug) WHERE deleted_at IS NULL;


CREATE TABLE tenant_slug_history (
    tenant_id   TEXT NOT NULL REFERENCES tenant(tenant_id),
    old_slug    TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    PRIMARY KEY (old_slug)
);


CREATE TABLE platform_admin (
    admin_id     TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES account(account_id),
    permissions  TEXT NOT NULL,          -- JSON array (stored as TEXT on every engine)
    mfa_enabled  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    deleted_at   TEXT
);
CREATE UNIQUE INDEX ux_platform_admin_account
    ON platform_admin (account_id) WHERE deleted_at IS NULL;
-- platform admin must be a separate entity, not a flag on account
-- must not obtain this privilege by being staff of any tenant


CREATE TABLE platform_policy (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
-- seed: ('client_tenancy_mode', 'SINGLE')


-- ---------------------------------------------------------------------
-- TENANT-SCOPED TABLES  (tenant_id NOT NULL, composite PK)
-- ---------------------------------------------------------------------

CREATE TABLE role (
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    role_id      TEXT NOT NULL,
    key          TEXT NOT NULL,          -- OWNER|MANAGER|ADMIN|custom
    name         TEXT NOT NULL,
    permissions  TEXT NOT NULL,          -- JSON array of "resource.action"
    is_system    INTEGER NOT NULL DEFAULT 0,
    rank         INTEGER NOT NULL,       -- OWNER=100 MANAGER=50 ADMIN=10
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    PRIMARY KEY (tenant_id, role_id)
);
CREATE UNIQUE INDEX ux_role_key
    ON role (tenant_id, key) WHERE deleted_at IS NULL;


CREATE TABLE membership (
    tenant_id             TEXT NOT NULL REFERENCES tenant(tenant_id),
    membership_id         TEXT NOT NULL,
    account_id            TEXT NOT NULL REFERENCES account(account_id),
    kind                  TEXT NOT NULL,          -- CLIENT|STAFF
    status                TEXT NOT NULL,
        -- INVITED|ACTIVE|SUSPENDED|RELEASE_PENDING|LEFT|BANNED|REJECTED
    role_id               TEXT,                   -- NOT NULL when kind='STAFF'
    display_code          TEXT,
    invitation_id         TEXT,
    joined_at             TEXT,
    suspended_at          TEXT,
    suspend_expires_at    TEXT,                   -- required when status='SUSPENDED'
    release_initiated_by  TEXT,                   -- TENANT|CLIENT|PLATFORM
    release_initiator_id  TEXT,
    release_reason        TEXT,
    release_requested_at  TEXT,
    release_effective_at  TEXT,
    release_ack_at        TEXT,
    release_reject_count  INTEGER NOT NULL DEFAULT 0,
    left_at               TEXT,
    banned_reason         TEXT,
    version               INTEGER NOT NULL DEFAULT 1,   -- optimistic concurrency
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted_at            TEXT,
    PRIMARY KEY (tenant_id, membership_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, role_id)
);

-- occupancy: prevents duplicate signup in the same tenant (LEFT/BANNED/REJECTED are not occupying)
CREATE UNIQUE INDEX ux_membership_occupancy
    ON membership (tenant_id, account_id, kind)
    WHERE status IN ('INVITED','ACTIVE','SUSPENDED','RELEASE_PENDING')
      AND deleted_at IS NULL;

CREATE UNIQUE INDEX ux_membership_display_code
    ON membership (tenant_id, display_code)
    WHERE deleted_at IS NULL AND display_code IS NOT NULL;

CREATE INDEX ix_membership_account ON membership (account_id, kind, status);


CREATE TABLE membership_event (          -- append-only
    tenant_id         TEXT NOT NULL,
    membership_id     TEXT NOT NULL,
    event_id          TEXT NOT NULL,
    from_status       TEXT,
    to_status         TEXT NOT NULL,
    actor_type        TEXT NOT NULL,     -- STAFF|CLIENT|PLATFORM|SYSTEM
    actor_account_id  TEXT,
    reason            TEXT,
    occurred_at       TEXT NOT NULL,
    PRIMARY KEY (tenant_id, event_id),
    FOREIGN KEY (tenant_id, membership_id)
        REFERENCES membership (tenant_id, membership_id)
);
CREATE INDEX ix_membership_event_m ON membership_event (tenant_id, membership_id);


CREATE TABLE invitation (
    tenant_id          TEXT NOT NULL REFERENCES tenant(tenant_id),
    invitation_id      TEXT NOT NULL,
    purpose            TEXT NOT NULL,          -- CLIENT|STAFF
    role_id            TEXT,                   -- NOT NULL when purpose='STAFF'
    delivery           TEXT NOT NULL,          -- CODE|LINK|QR
    verification       TEXT NOT NULL DEFAULT 'NONE',  -- NONE|OTP_PHONE|LINE_LOGIN
    binding            TEXT NOT NULL DEFAULT 'TARGETED', -- OPEN|TARGETED
    target_kind        TEXT,                   -- PHONE|LINE|EMAIL
    target_value_hash  TEXT,                   -- HMAC of the target value
    target_hint        TEXT,                   -- '08x-xxx-1234' for display
    secret_hash        TEXT NOT NULL,          -- HMAC-SHA256(pepper, normalized_code)
    secret_prefix      TEXT,                   -- first 4 chars, shown in backoffice
    max_usage          INTEGER NOT NULL DEFAULT 1,
    used_count         INTEGER NOT NULL DEFAULT 0,
    requires_approval  INTEGER NOT NULL DEFAULT 0,
    expires_at         TEXT NOT NULL,          -- must not be NULL
    status             TEXT NOT NULL DEFAULT 'ACTIVE',
        -- ACTIVE|EXHAUSTED|EXPIRED|REVOKED
    created_by         TEXT NOT NULL REFERENCES account(account_id),
    revoked_by         TEXT,
    revoked_at         TEXT,
    revoke_reason      TEXT,
    created_at         TEXT NOT NULL,
    PRIMARY KEY (tenant_id, invitation_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES role (tenant_id, role_id)
);
CREATE UNIQUE INDEX ux_invitation_secret ON invitation (secret_hash);  -- global
CREATE INDEX ix_invitation_status ON invitation (tenant_id, status, expires_at);


CREATE TABLE invitation_redemption (     -- append-only
    tenant_id      TEXT NOT NULL,
    invitation_id  TEXT NOT NULL,
    redemption_id  TEXT NOT NULL,
    account_id     TEXT,
    membership_id  TEXT,
    result         TEXT NOT NULL,
        -- SUCCESS|ALREADY_MEMBER|POLICY_BLOCKED|EXPIRED|REVOKED
        -- |EXHAUSTED|TARGET_MISMATCH
    ip             TEXT,
    user_agent     TEXT,
    redeemed_at    TEXT NOT NULL,
    PRIMARY KEY (tenant_id, redemption_id),
    FOREIGN KEY (tenant_id, invitation_id)
        REFERENCES invitation (tenant_id, invitation_id)
);
CREATE UNIQUE INDEX ux_redemption_once
    ON invitation_redemption (invitation_id, account_id)
    WHERE result = 'SUCCESS';


CREATE TABLE notification (
    tenant_id      TEXT,                 -- NULL = message from platform
    notification_id TEXT NOT NULL,
    account_id     TEXT NOT NULL REFERENCES account(account_id),
    channel        TEXT NOT NULL,        -- LINE|IN_APP|EMAIL|SMS
    template_key   TEXT NOT NULL,
    payload        TEXT,                 -- JSON as TEXT
    status         TEXT NOT NULL DEFAULT 'QUEUED',
        -- QUEUED|SENT|FAILED|SUPPRESSED
    suppress_reason TEXT,
    scheduled_at   TEXT,
    sent_at        TEXT,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (notification_id)
);
CREATE INDEX ix_notification_tenant ON notification (tenant_id, status, scheduled_at);


-- ---------------------------------------------------------------------
-- COMPLIANCE  (append-only)
-- ---------------------------------------------------------------------

CREATE TABLE consent_record (            -- append-only
    consent_id    TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES account(account_id),
    tenant_id     TEXT,                  -- NULL = platform-level agreement
    doc_type      TEXT NOT NULL,
        -- PLATFORM_TOS|PLATFORM_PRIVACY|TENANT_TERMS|RELEASE_TERMS
        -- |MARKETING|DPA
    doc_version   TEXT NOT NULL,
    doc_hash      TEXT NOT NULL,         -- SHA-256 of the document the user actually saw
    action        TEXT NOT NULL,         -- ACCEPT|WITHDRAW
    locale        TEXT,
    ip            TEXT,
    user_agent    TEXT,
    occurred_at   TEXT NOT NULL
);
CREATE INDEX ix_consent_lookup
    ON consent_record (account_id, doc_type, occurred_at);


CREATE TABLE audit_event (               -- append-only
    event_id          TEXT PRIMARY KEY,  -- ULID = time-sortable
    occurred_at       TEXT NOT NULL,
    tenant_id         TEXT,              -- NULL = platform-level
    actor_type        TEXT NOT NULL,     -- PLATFORM|STAFF|CLIENT|SYSTEM|ANONYMOUS
    actor_account_id  TEXT,
    on_behalf_of      TEXT,              -- impersonation
    action            TEXT NOT NULL,     -- 'membership.released'
    target_type       TEXT,
    target_id         TEXT,
    result            TEXT NOT NULL,     -- SUCCESS|DENIED|ERROR
    reason            TEXT,              -- required for actions listed in STANDARD §10.2
    changes           TEXT,              -- JSON as TEXT, already redacted
    ip                TEXT,
    user_agent        TEXT,
    request_id        TEXT,
    prev_hash         TEXT,
    hash              TEXT
);
CREATE INDEX ix_audit_tenant  ON audit_event (tenant_id, occurred_at);
CREATE INDEX ix_audit_actor   ON audit_event (actor_account_id, occurred_at);
CREATE INDEX ix_audit_target  ON audit_event (target_type, target_id);


CREATE TABLE dsr_request (
    dsr_id        TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES account(account_id),
    tenant_id     TEXT,
    type          TEXT NOT NULL,   -- ACCESS|RECTIFY|ERASE|PORT|OBJECT|RESTRICT
    status        TEXT NOT NULL DEFAULT 'RECEIVED',
        -- RECEIVED|IN_PROGRESS|COMPLETED|REJECTED
    reject_reason TEXT,
    due_at        TEXT NOT NULL,   -- received_at + 30 days (PDPA)
    handled_by    TEXT,
    received_at   TEXT NOT NULL,
    completed_at  TEXT
);
CREATE INDEX ix_dsr_due ON dsr_request (status, due_at);


CREATE TABLE webhook_event_seen (        -- LINE webhook idempotency
    provider        TEXT NOT NULL,
    event_id        TEXT NOT NULL,
    processed_at    TEXT NOT NULL,
    PRIMARY KEY (provider, event_id)
);


-- ---------------------------------------------------------------------
-- SEED — preset roles per tenant (created when the tenant is approved)
-- ---------------------------------------------------------------------
-- OWNER   rank 100  is_system=1
-- MANAGER rank  50  is_system=1
-- ADMIN   rank  10  is_system=1
-- permission array, see the STANDARD §8.3 table
-- is_system=1 -> permissions cannot be edited, cannot be deleted


-- =====================================================================
--  ENGINE-specific notes
-- =====================================================================
--
--  PostgreSQL
--    - May use TIMESTAMPTZ instead of TEXT, but still create the time at the app layer
--    - INTEGER 0/1 -> BOOLEAN
--    - permissions/changes/payload -> JSONB
--    - Enable RLS as an additional defense layer:
--        ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
--        CREATE POLICY p_tenant ON membership
--          USING (tenant_id = current_setting('app.tenant_id'));
--      *** RLS is a safety net, must not be a condition of correctness ***
--
--  Microsoft SQL Server
--    - filtered index does not support IN in some versions, must expand to OR:
--        CREATE UNIQUE INDEX ux_membership_occupancy
--          ON membership (tenant_id, account_id, kind)
--          WHERE (status='INVITED' OR status='ACTIVE'
--              OR status='SUSPENDED' OR status='RELEASE_PENDING')
--            AND deleted_at IS NULL;
--    - TEXT -> NVARCHAR(n), id -> CHAR(26)
--
--  Cloudflare D1 / SQLite
--    - No RLS  -> schema + repository + test layers are 100% mandatory
--    - No interactive transaction -> use batch() with a guard statement
--      always first, e.g. when redeeming an invitation:
--        UPDATE invitation SET used_count = used_count + 1
--         WHERE secret_hash = ? AND status='ACTIVE'
--           AND used_count < max_usage AND expires_at > ?;
--        -- rows_affected must = 1, otherwise the whole batch must fail
--    - Enable foreign keys on every connection:  PRAGMA foreign_keys = ON;
-- =====================================================================


-- =====================================================================
--  PARTY  (STANDARD §5.10) — a person the tenant knows, but may not yet have an account.
--  Vertical business tables must FK to party, not membership.
-- =====================================================================

CREATE TABLE party (
    tenant_id      TEXT NOT NULL REFERENCES tenant(tenant_id),
    party_id       TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'PRIMARY',  -- vertical defines allowed values
    display_name   TEXT,
    phone_hash     TEXT,          -- HMAC(pepper, E.164)  used for matching at signup
    phone_masked   TEXT,          -- '08x-xxx-1234'       normal display
    phone_enc      TEXT,          -- ciphertext           full view requires permission + audit
    email_hash     TEXT,
    email_enc      TEXT,
    external_ref   TEXT,          -- reference from the source system
    account_id     TEXT REFERENCES account(account_id),   -- linked when identity is confirmed
    membership_id  TEXT,
    linked_at      TEXT,
    created_by     TEXT NOT NULL DEFAULT 'STAFF',   -- STAFF|IMPORT|SELF
    version        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted_at     TEXT,
    PRIMARY KEY (tenant_id, party_id),
    FOREIGN KEY (tenant_id, membership_id)
        REFERENCES membership (tenant_id, membership_id)
);
CREATE INDEX ix_party_phone    ON party (tenant_id, phone_hash);
CREATE INDEX ix_party_account  ON party (tenant_id, account_id);
CREATE UNIQUE INDEX ux_party_external
    ON party (tenant_id, external_ref)
    WHERE deleted_at IS NULL AND external_ref IS NOT NULL;

-- Do not create an index that can search phone_hash across tenants (INV-31)
-- Do not store phone/email as plaintext in generally-readable columns


-- =====================================================================
--  CONVERSATION_CONTEXT  (STANDARD §4.3.1)
--  ใช้ตีความข้อความ "ขาเข้า" เมื่อ client มี membership หลาย tenant
--  ห้ามใช้กำหนดปลายทางของข้อความขาออก
-- =====================================================================

CREATE TABLE conversation_context (
    account_id   TEXT NOT NULL REFERENCES account(account_id),
    channel      TEXT NOT NULL DEFAULT 'LINE',
    tenant_id    TEXT NOT NULL REFERENCES tenant(tenant_id),
    expires_at   TEXT NOT NULL,          -- sliding 30 นาที
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (account_id, channel)
);
-- MUST: ล้างแถวนี้ทันทีเมื่อ membership ของ (account_id, tenant_id) -> LEFT/BANNED
