-- M10-08: durable offline-evaluation evidence for strategy candidate batches.
-- The evaluation record is deliberately M10-owned: M10 batch ids (`tscb-*`)
-- and M11 prompt/skill candidate ids (`cp-*`) are different contracts.
CREATE TABLE IF NOT EXISTS strategy_candidate_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id)
    REFERENCES strategy_candidate_batches(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_strategy_candidate_evaluations_batch
  ON strategy_candidate_evaluations(batch_id, created_at DESC);
