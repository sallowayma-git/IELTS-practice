-- Phase 12: first-class writing topic aggregate.
--
-- practice_assets remains the sole generic asset identity used by attempts.
-- writing_topics owns only writing-specific fields, so a topic never has a
-- second competing ID or a frontend settings-KV shadow copy.

CREATE TABLE IF NOT EXISTS writing_topics (
  asset_id TEXT PRIMARY KEY NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('task1', 'task2')),
  title_json TEXT NOT NULL,
  image_path TEXT,
  is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES practice_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_writing_topics_task_type
  ON writing_topics(task_type, updated_at DESC);
