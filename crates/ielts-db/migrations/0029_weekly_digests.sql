-- Version 29: a proper home for the weekly digest prose.
--
-- The digest of a completed weekly run used to live in `settings` (namespace
-- `weekly_digest`, key = dream run id) because `dream_runs` was a frozen backup
-- shape. That mixed a model-written, money-costing artifact into the bag of
-- webview-writable preferences, where any `upsert_setting` could overwrite it.
--
-- One row per weekly run, keyed by the run it belongs to. RESTRICT: a run that
-- has a digest cannot be deleted from under it by accident.
--
-- This migration only creates the table. Existing `settings` rows are moved by
-- `dream::move_settings_weekly_digests_in_transaction`, which `migrate()` runs
-- after the schema is current and which backup restore runs for packages that
-- predate the table (their digests arrive inside the `settings` snapshot).

CREATE TABLE IF NOT EXISTS weekly_digests (
  run_id TEXT PRIMARY KEY NOT NULL,
  digest_json TEXT NOT NULL CHECK (json_valid(digest_json)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES dream_runs(id) ON DELETE RESTRICT
);
