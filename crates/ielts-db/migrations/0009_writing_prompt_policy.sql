-- Writing evaluation prompts are durable policy, not generic settings values.
-- One partial unique index makes the Task 1 / Task 2 active-version invariant
-- true even if two UI windows import or activate concurrently.
CREATE TABLE IF NOT EXISTS writing_prompts (
  id TEXT PRIMARY KEY NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('task1', 'task2')),
  version TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_writing_prompts_task_updated
  ON writing_prompts(task_type, updated_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_writing_prompts_one_active_per_task
  ON writing_prompts(task_type)
  WHERE is_active = 1;
