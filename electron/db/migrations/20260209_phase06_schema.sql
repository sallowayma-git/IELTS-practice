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
