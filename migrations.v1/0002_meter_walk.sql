-- Meter walk (เดินจดมิเตอร์): field-work metadata on top of the existing readings.
-- Purely additive. Every column has a default, so rows written by the desktop
-- meter table and the billing engine keep working unchanged.

ALTER TABLE meter_readings ADD COLUMN status      TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE meter_readings ADD COLUMN skip_reason TEXT;
ALTER TABLE meter_readings ADD COLUMN note        TEXT;
ALTER TABLE meter_readings ADD COLUMN photo_key   TEXT;
ALTER TABLE meter_readings ADD COLUMN recorded_by TEXT;
-- Set when the operator waved through a low-or-spiking reading, so the office
-- view can tell "confirmed odd" apart from "not yet looked at".
ALTER TABLE meter_readings ADD COLUMN confirmed   INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_readings_period ON meter_readings(period, status);

-- One walk session per building+period, so progress survives closing the phone.
CREATE TABLE meter_walks (
  id          TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  started_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  UNIQUE (building_id, period)
);
