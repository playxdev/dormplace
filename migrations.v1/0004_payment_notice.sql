-- Tenant-submitted payment notices.
--
-- A tenant paying by PromptPay sends money to the owner's bank, not to this
-- system. Nothing here can know it happened, so the tenant reports it and the
-- owner verifies it against their statement. Until verified = 1 the payment
-- does not count towards what an invoice has been paid.

-- Makes a retried submission a no-op rather than a second payment row. Networks
-- are unreliable and a tenant will tap twice. NULL for rows the backoffice
-- creates, and SQLite permits many NULLs in a unique index.
ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_payments_idempotency ON payments (idempotency_key);

-- Who reported it. NULL when the owner recorded the payment directly.
ALTER TABLE payments ADD COLUMN reported_by_user_id TEXT REFERENCES users(id);
