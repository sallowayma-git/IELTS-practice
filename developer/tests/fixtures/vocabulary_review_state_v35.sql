-- The review table from 0005, without that migration's unrelated ALTER statements.
CREATE TABLE vocabulary_review_state (
  item_id TEXT PRIMARY KEY NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  last_reviewed_at TEXT,
  lapses INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (item_id) REFERENCES vocabulary_items(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_vocabulary_review_state
BEFORE DELETE ON vocabulary_review_state
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: vocabulary_review_state may only be deleted through an explicit user path');
END;
