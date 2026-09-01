-- Version 2: writing evaluation sessions, checkpoints, events, idempotency.

CREATE TABLE IF NOT EXISTS writing_drafts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  prompt_snapshot TEXT,
  task_type TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_idempotency (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  evaluation_id TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evaluation_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL DEFAULT 0,
  retry_of TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  provider_id TEXT,
  model TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_sessions_attempt
  ON evaluation_sessions(attempt_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS evaluation_checkpoints (
  evaluation_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (evaluation_id, stage, revision)
);

CREATE TABLE IF NOT EXISTS evaluation_events (
  evaluation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  stage TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (evaluation_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_eval_events_eval_seq
  ON evaluation_events(evaluation_id, sequence);

-- lineage / retry support on writing_evaluations via optional columns
-- SQLite lacks IF NOT EXISTS for columns; use separate table for lineage.
CREATE TABLE IF NOT EXISTS evaluation_lineage (
  evaluation_id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  retry_of TEXT,
  root_evaluation_id TEXT,
  created_at TEXT NOT NULL
);
