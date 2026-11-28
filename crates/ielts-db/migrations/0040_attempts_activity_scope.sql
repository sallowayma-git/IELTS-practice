-- Version 40: attempts accepts every practice activity.
--
-- Same widening as 0039, for the attempt ledger: listening joins reading and
-- writing in the activity CHECK. Column names, positions, defaults and the
-- task_type CHECK are preserved exactly, the asset_id foreign key keeps
-- `ON DELETE SET NULL`, and the indexes plus the delete-gate trigger are
-- recreated verbatim from 0001/0007/0030.
--
-- attempts has foreign-key children (attempt_answers, attempt_annotations,
-- writing_evaluations, writing_drafts, attempt_idempotency, evaluation_sessions
-- and learning_events). DROP TABLE performs an implicit DELETE while foreign
-- keys are enforced, so the runner switches enforcement off around this
-- migration and runs `PRAGMA foreign_key_check` on attempts and each child
-- before committing (see 0028). DROP TABLE fires no delete triggers, so
-- trg_delete_gate_attempts is recreated here rather than being relied on.
--
-- The runner owns the transaction: no PRAGMA and no COMMIT in this file.

CREATE TABLE attempts_new (
  id TEXT PRIMARY KEY NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('reading','writing','listening','vocabulary')),
  asset_id TEXT,
  mode TEXT NOT NULL,
  suite_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  score_value REAL,
  score_scale TEXT,
  correct_count REAL,
  question_count INTEGER,
  title_snapshot TEXT,
  prompt_snapshot TEXT,
  content_text TEXT,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  task_type TEXT CHECK (task_type IN ('task1', 'task2')),
  submitted_asset_fingerprint TEXT,
  FOREIGN KEY (asset_id) REFERENCES practice_assets(id) ON DELETE SET NULL
);

INSERT INTO attempts_new (
  id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
  completed_at, duration_ms, score_value, score_scale, correct_count,
  question_count, title_snapshot, prompt_snapshot, content_text, schema_version,
  created_at, updated_at, task_type, submitted_asset_fingerprint
)
SELECT
  id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
  completed_at, duration_ms, score_value, score_scale, correct_count,
  question_count, title_snapshot, prompt_snapshot, content_text, schema_version,
  created_at, updated_at, task_type, submitted_asset_fingerprint
FROM attempts;

DROP TABLE attempts;

ALTER TABLE attempts_new RENAME TO attempts;

CREATE INDEX IF NOT EXISTS idx_attempts_activity_submitted
  ON attempts(activity, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_suite ON attempts(suite_id);
CREATE INDEX IF NOT EXISTS idx_attempts_writing_task_type_submitted
  ON attempts(task_type, submitted_at DESC)
  WHERE activity = 'writing';

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_attempts
BEFORE DELETE ON attempts
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: attempts may only be deleted through an explicit user path');
END;
