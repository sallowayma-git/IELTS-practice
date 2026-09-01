CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local',
  event_type TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  activity TEXT,
  asset_id TEXT,
  attempt_id TEXT,
  question_id TEXT,
  skill_key TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  consolidation_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (consolidation_state IN ('pending','processed','ignored','quarantined')),
  sensitivity TEXT NOT NULL DEFAULT 'normal'
    CHECK (sensitivity IN ('normal','private','restricted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_events_pending
  ON learning_events(consolidation_state, occurred_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_attempt
  ON learning_events(attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_asset
  ON learning_events(asset_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_skill
  ON learning_events(skill_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_type_time
  ON learning_events(event_type, occurred_at);
