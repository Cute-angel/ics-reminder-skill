CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  url TEXT,
  start_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  rrule TEXT,
  alarm_offset_minutes INTEGER,
  source_text TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_status_start_at
  ON reminders(status, start_at_utc);

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_label TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  rotated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feeds_status
  ON feeds(status);
