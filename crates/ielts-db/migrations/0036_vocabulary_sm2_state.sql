DROP TRIGGER IF EXISTS trg_delete_gate_vocabulary_review_state;

CREATE TABLE vocabulary_review_state_new (
  item_id TEXT PRIMARY KEY NOT NULL,
  ease_factor REAL,
  interval_days REAL NOT NULL DEFAULT 1,
  repetitions INTEGER NOT NULL DEFAULT 0,
  intra_cycles INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  last_reviewed_at TEXT,
  FOREIGN KEY (item_id) REFERENCES vocabulary_items(id) ON DELETE CASCADE
);

INSERT INTO vocabulary_review_state_new (
  item_id, ease_factor, interval_days, repetitions, intra_cycles,
  correct_count, lapses, due_at, last_reviewed_at
)
SELECT
  item_id,
  CASE WHEN last_reviewed_at IS NULL THEN NULL ELSE ease END,
  interval_days,
  repetitions,
  0,
  0,
  lapses,
  due_at,
  last_reviewed_at
FROM vocabulary_review_state;

DROP TABLE vocabulary_review_state;
ALTER TABLE vocabulary_review_state_new RENAME TO vocabulary_review_state;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_vocabulary_review_state
BEFORE DELETE ON vocabulary_review_state
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: vocabulary_review_state may only be deleted through an explicit user path');
END;
