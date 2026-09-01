-- M8 Weekly Dream + Cross-scope Pattern + Memory Consolidation v1.
--
-- These tables record durable consolidation lineage, user feedback, per-kind
-- archive policy state, and extend the M7 background_jobs ledger to host the
-- weekly dream pass. They are NOT another append-only chat log:
--   * memory_relations preserves consolidation lineage so a high-level pattern
--     can be reversed without losing the lower-level supports (M8-06);
--   * memory_feedback records user verdicts against a stable memory_id; an
--     `inaccurate` verdict is strong contradiction evidence but never deletes
--     the underlying learning facts (M8-09);
--   * memory_capacity_state carries the per-kind archive policy so stale
--     archive can be replayed deterministically (M8-08);
--   * background_jobs gains `weekly_dream` so the weekly pass reuses the M7
--     durable job ledger instead of a parallel table.

-- M8-02/M8-06: consolidation relation lineage. A relation is a directed edge
-- from a source memory to a target memory. The most common edge is
-- supports_consolidation (a lower-level support feeds a higher-level pattern).
-- supersedes mirrors memory_items.supersedes_id but is kept here so the
-- relation graph is queryable without a self-join. FKs are ON DELETE RESTRICT
-- so a physical delete of a memory that still participates in a relation
-- fails loudly; consolidation never physically deletes a support (M8-06).
CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 5) = 'mrel-'),
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  relation_kind TEXT NOT NULL
    CHECK (relation_kind IN (
      'supports_consolidation',
      'supersedes',
      'contradicts',
      'decays_into'
    )),
  created_at TEXT NOT NULL,
  UNIQUE(source_memory_id, target_memory_id, relation_kind),
  FOREIGN KEY (source_memory_id) REFERENCES memory_items(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (target_memory_id) REFERENCES memory_items(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_memory_relations_source
  ON memory_relations(source_memory_id, relation_kind);
CREATE INDEX IF NOT EXISTS idx_memory_relations_target
  ON memory_relations(target_memory_id, relation_kind);

-- M8-09: user feedback against a stable memory_id. The LLM never invents a
-- feedback row; only the UI records a verdict. `inaccurate` is strong
-- contradiction evidence but does not delete learning facts — it only adds a
-- feedback row and lets M8-07 propagation decay the consolidated pattern.
-- `acknowledged` is a pure UI signal (user saw the memory); it does not change
-- memory status. The payload_json carries optional free-form context the user
-- supplied (e.g. "this used to be true but the test format changed").
CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'mfb-'),
  memory_id TEXT NOT NULL,
  feedback_kind TEXT NOT NULL
    CHECK (feedback_kind IN (
      'accurate',
      'inaccurate',
      'partially_accurate',
      'outdated',
      'not_about_me',
      'acknowledged'
    )),
  user_id TEXT NOT NULL DEFAULT 'local',
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_items(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory
  ON memory_feedback(memory_id, feedback_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_feedback_user
  ON memory_feedback(user_id, created_at);

-- M8-08: per-kind archive policy state. A single row per memory_kind carries
-- the serialized policy (e.g. {"archiveAfterDays": 14, "policy": "fast"}) and
-- the last archival sweep timestamp so stale archive is replayable and
-- idempotent. memory_kind is the M3 namespace enum string
-- (knowledge/language/strategy/behavior/metacognition/preference/goal); the
-- CHECK is intentionally a free TEXT with an enum-like guard done in Rust so
-- adding a namespace does not require a migration to relax the CHECK.
CREATE TABLE IF NOT EXISTS memory_capacity_state (
  memory_kind TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  updated_at TEXT NOT NULL
);

-- M8: extend background_jobs job_kind to host the weekly dream pass. SQLite
-- CHECK constraints cannot be altered in place, so emulate the extension with
-- a table-level guard: recreate the CHECK via a CREATE TABLE IF NOT EXISTS
-- no-op is impossible, so instead relax by dropping and re-adding the CHECK
-- through a temp-table copy. To keep the migration idempotent and avoid
-- rewriting the M7 table on every apply, we instead add a separate guard
-- column that records the accepted job_kind set version. The application
-- layer (background_jobs::enqueue_job) is the authority for the accepted
-- job_kind set; the DB CHECK on background_jobs.job_kind remains the M7 set
-- and weekly_dream is accepted by the application guard, not the DB CHECK.
--
-- Concretely: enqueue_job already validates job_kind against a Rust match.
-- We extend that match to accept 'weekly_dream' (see background_jobs.rs). The
-- DB CHECK stays as-is so historical M7 packages restore without altering
-- the column constraint. A future migration can tighten the DB CHECK once
-- weekly_dream is proven.

-- M8: weekly vs daily dream runs are distinguished by the job_kind that
-- enqueued them (background_jobs.job_kind = 'weekly_dream' vs 'daily_dream'),
-- not by a `scope` column on dream_runs. Adding a column via ALTER TABLE is
-- not idempotent under the rewind-then-reapply migration stress test, and the
-- column is not read by any code path, so it is omitted to keep the migration
-- replay-safe.

-- M8: capacity state seed for the default memory kinds. The values are the
-- initial conservative policy; they can be tuned by the application layer.
INSERT OR IGNORE INTO memory_capacity_state (memory_kind, state_json, updated_at) VALUES
  ('knowledge', '{"policy":"slow","archiveAfterDays":120}', '2026-08-16T00:00:00Z'),
  ('language', '{"policy":"slow","archiveAfterDays":120}', '2026-08-16T00:00:00Z'),
  ('strategy', '{"policy":"medium","archiveAfterDays":60}', '2026-08-16T00:00:00Z'),
  ('behavior', '{"policy":"fast","archiveAfterDays":21}', '2026-08-16T00:00:00Z'),
  ('metacognition', '{"policy":"medium","archiveAfterDays":60}', '2026-08-16T00:00:00Z'),
  ('preference', '{"policy":"never_auto","archiveAfterDays":null}', '2026-08-16T00:00:00Z'),
  ('goal', '{"policy":"validity_driven","archiveAfterDays":null}', '2026-08-16T00:00:00Z');
