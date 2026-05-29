-- IELTS Writing AI 数据库 Schema
-- 版本: 1.0.0

-- 迁移历史表 (用于跟踪已执行的迁移)
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API 配置表
CREATE TABLE IF NOT EXISTS api_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK(provider IN ('openai', 'openrouter', 'deepseek')),
  base_url TEXT NOT NULL,
  api_key_encrypted BLOB NOT NULL,
  default_model TEXT NOT NULL,
  priority INTEGER DEFAULT 100,
  max_retries INTEGER DEFAULT 2,
  cooldown_until DATETIME,
  failure_count INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1 CHECK(is_enabled IN (0, 1)),
  is_default INTEGER DEFAULT 0 CHECK(is_default IN (0, 1)),
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 提示词配置表
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK(task_type IN ('task1', 'task2')),
  system_prompt TEXT NOT NULL,
  scoring_criteria TEXT NOT NULL,
  output_format_example TEXT NOT NULL,
  is_active INTEGER DEFAULT 0 CHECK(is_active IN (0, 1)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 确保每个任务类型只有一个激活提示词
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_active 
  ON prompts(task_type, is_active) WHERE is_active = 1;

-- 应用设置表
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 题目库表 (Phase 04 扩展)
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('task1', 'task2')),
  category TEXT NOT NULL,
  difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5),
  title_json TEXT NOT NULL,
  image_path TEXT,
  is_official INTEGER DEFAULT 0 CHECK(is_official IN (0, 1)),
  usage_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topics_type ON topics(type);
CREATE INDEX IF NOT EXISTS idx_topics_category ON topics(category);
CREATE INDEX IF NOT EXISTS idx_topics_difficulty ON topics(difficulty);

-- 作文记录表 (Phase 04 扩展)
CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER,
  topic_text TEXT,
  task_type TEXT NOT NULL CHECK(task_type IN ('task1', 'task2')),
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  llm_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  total_score REAL CHECK(total_score >= 0 AND total_score <= 9),
  task_achievement REAL CHECK(task_achievement >= 0 AND task_achievement <= 9),
  coherence_cohesion REAL CHECK(coherence_cohesion >= 0 AND coherence_cohesion <= 9),
  lexical_resource REAL CHECK(lexical_resource >= 0 AND lexical_resource <= 9),
  grammatical_range REAL CHECK(grammatical_range >= 0 AND grammatical_range <= 9),
  evaluation_json TEXT NOT NULL,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_essays_submitted_at ON essays(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_essays_task_type ON essays(task_type);
CREATE INDEX IF NOT EXISTS idx_essays_topic_id ON essays(topic_id);
CREATE INDEX IF NOT EXISTS idx_essays_total_score ON essays(total_score);

-- 评测会话追踪
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

-- 统一练习历史记录（Vue Practice Shell）
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

-- 阅读套题会话（Vue Practice Shell）
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

-- 供应商健康状态（可选增强，与 api_configs.failure_count 协同）
CREATE TABLE IF NOT EXISTS provider_health (
  config_id INTEGER PRIMARY KEY,
  consecutive_failures INTEGER DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  last_failure_at DATETIME,
  cooldown_until DATETIME,
  FOREIGN KEY (config_id) REFERENCES api_configs(id) ON DELETE CASCADE
);

-- 提示词审计日志
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

-- 预置默认设置
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('language', '"zh-CN"'),
  ('temperature_mode', '"balanced"'),
  ('temperature_task1', '0.3'),
  ('temperature_task2', '0.5'),
  ('max_tokens', '4096'),
  ('history_limit', '100'),
  ('auto_save_interval', '10000'),
  ('theme', '"light"');
