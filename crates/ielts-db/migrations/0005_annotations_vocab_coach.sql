-- Phase 8: vocabulary items + dictionary index metadata; coach message sequencing.

CREATE TABLE IF NOT EXISTS vocabulary_items (
  id TEXT PRIMARY KEY NOT NULL,
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  definition TEXT,
  phonetic TEXT,
  part_of_speech TEXT,
  example TEXT,
  source_asset_id TEXT,
  source_attempt_id TEXT,
  tags_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vocab_normalized
  ON vocabulary_items(normalized_term);
CREATE INDEX IF NOT EXISTS idx_vocab_updated
  ON vocabulary_items(updated_at DESC);

CREATE TABLE IF NOT EXISTS vocabulary_review_state (
  item_id TEXT PRIMARY KEY NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  last_reviewed_at TEXT,
  lapses INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (item_id) REFERENCES vocabulary_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
  term TEXT PRIMARY KEY NOT NULL,
  normalized_term TEXT NOT NULL,
  definition TEXT NOT NULL,
  phonetic TEXT,
  part_of_speech TEXT,
  example TEXT,
  source_label TEXT,
  license TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_dictionary_normalized
  ON dictionary_entries(normalized_term);

-- Incremental coach message sequence for stable ordering without rewriting history blobs.
ALTER TABLE coach_messages ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE coach_threads ADD COLUMN last_error_json TEXT;

CREATE INDEX IF NOT EXISTS idx_coach_messages_thread_seq
  ON coach_messages(thread_id, sequence);
