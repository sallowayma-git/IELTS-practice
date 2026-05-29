-- Phase 06 schema upgrade
-- Note: priority, max_retries, cooldown_until, failure_count columns are already in schema.sql
-- evaluation_sessions, provider_health, prompt_audit_logs tables are also in schema.sql
--本迁移文件用于从旧版本数据库升级，新数据库已包含所有表结构

CREATE TABLE IF NOT EXISTS evaluation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  topic_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
  provider_path_json TEXT,
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_sessions_status ON evaluation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_eval_sessions_created_at ON evaluation_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS practice_history_records (
  id TEXT PRIMARY KEY,
  activity TEXT NOT NULL CHECK(activity IN ('reading', 'writing')),
  session_id TEXT NOT NULL UNIQUE,
  asset_id TEXT,
  exam_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_answers REAL NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  submission_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_practice_history_activity_submitted_at
  ON practice_history_records(activity, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_history_session
  ON practice_history_records(session_id);
CREATE INDEX IF NOT EXISTS idx_practice_history_exam
  ON practice_history_records(exam_id);

CREATE TABLE IF NOT EXISTS practice_reading_suite_sessions (
  session_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'cancelled')),
  flow_mode TEXT NOT NULL,
  frequency_scope TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  total_passages INTEGER NOT NULL DEFAULT 3,
  session_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_practice_suite_status_updated_at
  ON practice_reading_suite_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_health (
  config_id INTEGER PRIMARY KEY,
  consecutive_failures INTEGER DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  last_failure_at DATETIME,
  cooldown_until DATETIME,
  FOREIGN KEY (config_id) REFERENCES api_configs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prompt_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  prompt_id INTEGER,
  task_type TEXT,
  version TEXT,
  checksum TEXT,
  detail_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
);
