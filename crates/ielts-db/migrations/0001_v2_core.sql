-- schema_migrations is created by the migrator.
-- Version 1: minimal v2 domain tables.

CREATE TABLE IF NOT EXISTS practice_assets (
  id TEXT PRIMARY KEY NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('reading', 'writing')),
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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_practice_assets_activity_category
  ON practice_assets(activity, category);
CREATE INDEX IF NOT EXISTS idx_practice_assets_source_key
  ON practice_assets(source_key);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY NOT NULL,
  activity TEXT NOT NULL CHECK (activity IN ('reading', 'writing')),
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
  FOREIGN KEY (asset_id) REFERENCES practice_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_activity_submitted
  ON attempts(activity, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_suite ON attempts(suite_id);

CREATE TABLE IF NOT EXISTS attempt_answers (
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  is_correct INTEGER,
  weight REAL NOT NULL DEFAULT 1,
  question_kind TEXT,
  change_count INTEGER NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  marked INTEGER NOT NULL DEFAULT 0 CHECK (marked IN (0, 1)),
  answered_at TEXT,
  PRIMARY KEY (attempt_id, question_id),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_annotations (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT,
  asset_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  question_id TEXT,
  kind TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  note_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_asset ON attempt_annotations(asset_id);

CREATE TABLE IF NOT EXISTS writing_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  provider_id TEXT,
  model TEXT,
  rubric_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  result_json TEXT,
  degradation_json TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_writing_evaluations_attempt_updated
  ON writing_evaluations(attempt_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reading_suites (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL,
  flow_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  timer_policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_suite_items (
  suite_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  attempt_id TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY (suite_id, item_index),
  FOREIGN KEY (suite_id) REFERENCES reading_suites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coach_threads (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT,
  asset_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  structured_payload TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES coach_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_messages_thread_created
  ON coach_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE TABLE IF NOT EXISTS migration_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
