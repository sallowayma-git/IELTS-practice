-- Allow multiple evaluations per attempt (retry lineage).
-- SQLite: rebuild writing_evaluations without UNIQUE(attempt_id).

CREATE TABLE IF NOT EXISTS writing_evaluations_v2 (
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

INSERT INTO writing_evaluations_v2 (
  id, attempt_id, status, stage, provider_id, model, rubric_version, prompt_version,
  result_json, degradation_json, error_json, started_at, completed_at, updated_at
)
SELECT
  id, attempt_id, status, stage, provider_id, model, rubric_version, prompt_version,
  result_json, degradation_json, error_json, started_at, completed_at, updated_at
FROM writing_evaluations;

DROP TABLE writing_evaluations;
ALTER TABLE writing_evaluations_v2 RENAME TO writing_evaluations;

CREATE INDEX IF NOT EXISTS idx_writing_evaluations_attempt_updated
  ON writing_evaluations(attempt_id, updated_at DESC);
