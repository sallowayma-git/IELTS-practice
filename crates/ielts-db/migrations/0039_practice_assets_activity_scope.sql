-- Version 39: practice_assets accepts every practice activity.
--
-- Listening becomes a first-class activity next to reading and writing. The
-- asset identity stays in this one table; only the activity CHECK widens.
-- Every other column keeps its name, position, type, default and CHECK, and the
-- index definitions are recreated verbatim: backup restore compares
-- `PRAGMA table_info` column lists for equality (backup/mod.rs).
--
-- SQLite cannot alter a CHECK in place, so the table is rebuilt. attempts
-- (asset_id ON DELETE SET NULL) and writing_topics (asset_id ON DELETE CASCADE)
-- reference this table. DROP TABLE performs an implicit DELETE while foreign
-- keys are enforced, which would null/cascade those children, so the migration
-- runner switches enforcement off around this migration and runs
-- `PRAGMA foreign_key_check` on practice_assets, attempts and writing_topics
-- before it commits (the procedure documented by 0028).
--
-- The runner owns the transaction: no PRAGMA and no COMMIT in this file.

CREATE TABLE practice_assets_new (
  id TEXT PRIMARY KEY NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('reading','writing','listening','vocabulary')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin', 'imported', 'freeform')),
  source_key TEXT,
  title TEXT NOT NULL,
  category TEXT,
  difficulty TEXT,
  frequency TEXT,
  content_ref TEXT,
  schema_version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  pdf_only INTEGER NOT NULL DEFAULT 0 CHECK (pdf_only IN (0, 1)),
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  question_kinds_json TEXT CHECK(question_kinds_json IS NULL OR json_valid(question_kinds_json))
);

INSERT INTO practice_assets_new (
  id, activity, source_kind, source_key, title, category, difficulty, frequency,
  content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at,
  updated_at, question_kinds_json
)
SELECT
  id, activity, source_kind, source_key, title, category, difficulty, frequency,
  content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at,
  updated_at, question_kinds_json
FROM practice_assets;

DROP TABLE practice_assets;

ALTER TABLE practice_assets_new RENAME TO practice_assets;

CREATE INDEX IF NOT EXISTS idx_practice_assets_activity_category
  ON practice_assets(activity, category);
CREATE INDEX IF NOT EXISTS idx_practice_assets_source_key
  ON practice_assets(source_key);
