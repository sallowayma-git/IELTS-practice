-- Version 28: an attempt delete no longer cascades into the learning ledger.
--
-- 0012 declared `learning_events.attempt_id REFERENCES attempts ON DELETE CASCADE`.
-- Any DELETE of an attempt therefore silently erased its ledger rows, and writing
-- events cannot be rebuilt from anywhere. The ledger is not raw truth, but it is
-- also not a disposable projection, so the removal has to be a decision, not a
-- side effect.
--
-- The action becomes RESTRICT. The deliberate path
-- (`history::delete_attempt_graph_in_transaction`) now removes the attempt's
-- ledger rows itself, in the same transaction and before the attempt, and then
-- re-projects the derived observations -- exactly the user-visible behaviour the
-- cascade used to produce. A delete of an attempt that still has ledger rows
-- through any other route now fails loudly instead of eating the ledger.
--
-- Why RESTRICT and not SET NULL: SET NULL would keep ledger facts about attempts
-- that no longer exist. Every reader of the ledger (learning_get_attempt_detail,
-- the weekly pack, learning_events_verify, the observation projector) assumes an
-- event with an attempt id has that attempt; "clear all history" would stop
-- clearing the learner model, and nothing in the UI could ever remove those
-- orphan facts. RESTRICT keeps that invariant and adds no new state.
--
-- SQLite cannot alter a foreign key in place, so the table is rebuilt. Unlike
-- 0024 this table HAS foreign-key children (learner_observation_evidence and
-- learner_skill_observations, both `ON DELETE CASCADE`). DROP TABLE performs an
-- implicit DELETE when foreign keys are enforced, which would cascade into them
-- and (through trg_learning_observation_evidence_delete) empty the observation
-- projection. `PRAGMA foreign_keys` is a no-op inside a transaction, so the
-- migration runner turns it OFF around this migration (`Migration::
-- rebuilds_fk_parent`) and runs `PRAGMA foreign_key_check` before it commits.
-- This is the procedure SQLite documents for this exact change.
--
-- Column names and order are preserved exactly: backup restore compares column
-- lists for equality. The FK children keep referencing the name
-- `learning_events`, which resolves to the rebuilt table after the rename.
--
-- Replay-safe: re-running against an already rebuilt table is a no-op copy.

CREATE TABLE IF NOT EXISTS learning_events_new (
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
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO learning_events_new (
  id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
  asset_id, attempt_id, question_id, skill_key, occurred_at, payload_json,
  content_hash, schema_version, consolidation_state, sensitivity, created_at,
  updated_at
)
SELECT
  id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
  asset_id, attempt_id, question_id, skill_key, occurred_at, payload_json,
  content_hash, schema_version, consolidation_state, sensitivity, created_at,
  updated_at
FROM learning_events;

DROP TABLE learning_events;

ALTER TABLE learning_events_new RENAME TO learning_events;

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
