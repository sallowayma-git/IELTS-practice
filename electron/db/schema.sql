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
