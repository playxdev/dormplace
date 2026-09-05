-- Announcements from the owner to the tenants of one building.
--
-- Scoped to a building, never to a room or a person: this is the notice board
-- by the lift, not a letter. Everyone holding an active contract in the
-- building sees the same text, which is what makes it safe to write once and
-- cheap to deliver.

CREATE TABLE announcements (
  id           TEXT PRIMARY KEY,
  building_id  TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  -- Held above the rest of the list while it matters. The default is a plain
  -- dated notice; pinning is for the one thing that must not scroll away.
  pinned       INTEGER NOT NULL DEFAULT 0,
  -- NULL while a draft. Nothing outside the backoffice may read a row until
  -- this is set, so the owner can write across several sittings and publish
  -- once, rather than a half-written notice appearing in every tenant's app.
  published_at TEXT,
  -- Stops last week's water-outage notice from standing forever without anyone
  -- remembering to delete it. NULL means it stands until removed.
  expires_at   TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The tenant query is always: one building, published only, newest first.
CREATE INDEX idx_announcements_building ON announcements (building_id, published_at DESC);

-- One row the first time a tenant opens an announcement.
--
-- Absence is unread. Nothing is written when an announcement is published, so
-- announcing to a building of 100 rooms costs zero writes and one write per
-- tenant who actually reads — the shape that matters on D1's 100 k writes/day.
CREATE TABLE announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);
