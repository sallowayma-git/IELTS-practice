-- Fix a self-contradictory foreign key on coach_outcome_links_v0.
--
-- 0017:105 declares `future_observation_id TEXT NOT NULL` and includes it in the
-- PRIMARY KEY (0017:108), while 0017:112 declares
-- `FOREIGN KEY (future_observation_id) REFERENCES learner_observations(id)
--  ON DELETE SET NULL`. Those cannot both hold: SET NULL on a NOT NULL primary
-- key column can never succeed, so deleting any referenced learner_observations
-- row aborts with "NOT NULL constraint failed" and takes the caller's whole
-- transaction with it.
--
-- That is reachable in normal use, not a corner case. `coach_link_outcome`
-- (registered at src-tauri/src/lib.rs:298) records a link against an existing
-- observation, and learner_observations rows are deleted by the M2 projection
-- rebuild (crates/ielts-db/src/learning_observations.rs:297) which runs from all
-- four history delete paths (crates/ielts-db/src/history/mod.rs:467, :492, :530,
-- :680), from the on-by-default retention prune, and from the
-- learning_observations_rebuild command. They are also deleted by the trigger at
-- 0013:57-61 whenever learner_observation_evidence rows go away, which cascade
-- from learning_events, which cascade from attempts. So once a single coach
-- learning outcome is linked, the user can no longer delete history and the
-- projection can no longer be rebuilt.
--
-- CASCADE is the correct action: the row records "this strategy assignment led
-- to that future observation", which is meaningless once the observation is
-- gone. It also matches the sibling FK on the same table, which already cascades
-- from coach_strategy_assignments_v0 (0017:110).
--
-- A full rebuild is required because SQLite cannot alter a foreign key in place.
-- Plain DROP TABLE is safe HERE specifically because nothing declares an FK
-- referencing coach_outcome_links_v0 -- it is only ever a child. (Do not copy
-- this shape onto a table that has FK children: DROP performs an implicit DELETE
-- that fires their cascade actions and would silently empty them.)
--
-- Column order and set are preserved byte-identically, because
-- crates/ielts-db/src/backup/mod.rs compares column-name lists for equality when
-- restoring; reordering would make every existing backup fail to restore.
--
-- The sequence is replay-safe: crates/ielts-db/tests/history_retention.rs:170
-- and :201 delete schema_migrations rows from version 8 and re-run migrate()
-- against a fully populated database, so this must tolerate re-execution
-- against an already-corrected table. INSERT OR IGNORE plus dropping the
-- temporary table makes a repeat run a no-op copy.

CREATE TABLE IF NOT EXISTS coach_outcome_links_v0_new (
  strategy_assignment_id TEXT NOT NULL,
  future_observation_id TEXT NOT NULL,
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN ('satisfaction', 'learning')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (strategy_assignment_id, future_observation_id, outcome_kind),
  FOREIGN KEY (strategy_assignment_id)
    REFERENCES coach_strategy_assignments_v0(id) ON DELETE CASCADE,
  FOREIGN KEY (future_observation_id)
    REFERENCES learner_observations(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO coach_outcome_links_v0_new
  (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
SELECT strategy_assignment_id, future_observation_id, outcome_kind, created_at
FROM coach_outcome_links_v0;

DROP TABLE coach_outcome_links_v0;

ALTER TABLE coach_outcome_links_v0_new RENAME TO coach_outcome_links_v0;

CREATE INDEX IF NOT EXISTS idx_coach_outcome_links_assignment
  ON coach_outcome_links_v0(strategy_assignment_id);

CREATE INDEX IF NOT EXISTS idx_coach_outcome_links_observation
  ON coach_outcome_links_v0(future_observation_id);
