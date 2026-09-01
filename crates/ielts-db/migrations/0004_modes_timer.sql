-- Phase 7: suite/timer/endless mode state machines (extends v2 core suite tables).

ALTER TABLE reading_suites ADD COLUMN frequency_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE reading_suites ADD COLUMN seed TEXT;
ALTER TABLE reading_suites ADD COLUMN aggregate_json TEXT;
ALTER TABLE reading_suites ADD COLUMN completed_at TEXT;
ALTER TABLE reading_suites ADD COLUMN timer_state_json TEXT;

ALTER TABLE reading_suite_items ADD COLUMN title TEXT;
ALTER TABLE reading_suite_items ADD COLUMN category TEXT;
ALTER TABLE reading_suite_items ADD COLUMN submitted_at TEXT;
ALTER TABLE reading_suite_items ADD COLUMN score_json TEXT;

CREATE TABLE IF NOT EXISTS endless_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  pool_policy_json TEXT NOT NULL,
  pool_json TEXT NOT NULL,
  current_asset_id TEXT,
  current_attempt_id TEXT,
  completed_asset_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_endless_sessions_status
  ON endless_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS mode_idempotency (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);
