-- Phase 13: a writing attempt owns its task type.  Do not infer Task 2 for
-- historical rows: only backfill when every explicit legacy source agrees.

ALTER TABLE attempts ADD COLUMN task_type TEXT CHECK (task_type IN ('task1', 'task2'));

CREATE INDEX IF NOT EXISTS idx_attempts_writing_task_type_submitted
  ON attempts(task_type, submitted_at DESC)
  WHERE activity = 'writing';

-- Candidate sources are all explicit facts: a first-class topic, a legacy
-- draft field, an evaluation payload, or structured draft metadata.  A row
-- is classified only if those facts resolve to exactly one value.  Missing or
-- conflicting evidence deliberately stays NULL (shown as "未标注" by the UI).
WITH candidates AS (
  SELECT a.id AS attempt_id, wt.task_type AS task_type
  FROM attempts a
  JOIN writing_topics wt ON wt.asset_id = a.asset_id
  WHERE a.activity = 'writing' AND a.task_type IS NULL

  UNION

  SELECT a.id AS attempt_id,
    CASE lower(trim(d.task_type))
      WHEN 'task1' THEN 'task1'
      WHEN 'task_1' THEN 'task1'
      WHEN 't1' THEN 'task1'
      WHEN 'task2' THEN 'task2'
      WHEN 'task_2' THEN 'task2'
      WHEN 't2' THEN 'task2'
    END AS task_type
  FROM attempts a
  JOIN writing_drafts d ON d.attempt_id = a.id
  WHERE a.activity = 'writing'
    AND a.task_type IS NULL
    AND lower(trim(d.task_type)) IN ('task1', 'task_1', 't1', 'task2', 'task_2', 't2')

  UNION

  SELECT a.id AS attempt_id,
    CASE lower(trim(COALESCE(
      json_extract(e.result_json, '$.taskType'),
      json_extract(e.result_json, '$.task_type')
    )))
      WHEN 'task1' THEN 'task1'
      WHEN 'task_1' THEN 'task1'
      WHEN 't1' THEN 'task1'
      WHEN 'task2' THEN 'task2'
      WHEN 'task_2' THEN 'task2'
      WHEN 't2' THEN 'task2'
    END AS task_type
  FROM attempts a
  JOIN writing_evaluations e ON e.attempt_id = a.id
  WHERE a.activity = 'writing'
    AND a.task_type IS NULL
    AND json_valid(e.result_json)
    AND lower(trim(COALESCE(
      json_extract(e.result_json, '$.taskType'),
      json_extract(e.result_json, '$.task_type')
    ))) IN ('task1', 'task_1', 't1', 'task2', 'task_2', 't2')

  UNION

  SELECT a.id AS attempt_id,
    CASE lower(trim(COALESCE(
      json_extract(a.prompt_snapshot, '$.taskType'),
      json_extract(a.prompt_snapshot, '$.task_type')
    )))
      WHEN 'task1' THEN 'task1'
      WHEN 'task_1' THEN 'task1'
      WHEN 't1' THEN 'task1'
      WHEN 'task2' THEN 'task2'
      WHEN 'task_2' THEN 'task2'
      WHEN 't2' THEN 'task2'
    END AS task_type
  FROM attempts a
  WHERE a.activity = 'writing'
    AND a.task_type IS NULL
    AND json_valid(a.prompt_snapshot)
    AND lower(trim(COALESCE(
      json_extract(a.prompt_snapshot, '$.taskType'),
      json_extract(a.prompt_snapshot, '$.task_type')
    ))) IN ('task1', 'task_1', 't1', 'task2', 'task_2', 't2')
)
UPDATE attempts
SET task_type = (
  SELECT c.task_type
  FROM candidates c
  WHERE c.attempt_id = attempts.id
  GROUP BY c.attempt_id
  HAVING COUNT(DISTINCT c.task_type) = 1
)
WHERE activity = 'writing'
  AND task_type IS NULL
  AND (
    SELECT COUNT(DISTINCT c.task_type)
    FROM candidates c
    WHERE c.attempt_id = attempts.id
  ) = 1;
