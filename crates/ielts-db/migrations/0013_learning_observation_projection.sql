CREATE TABLE IF NOT EXISTS learner_observations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local',
  observation_type TEXT NOT NULL,
  namespace TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  polarity TEXT,
  value_num REAL,
  value_text TEXT,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  evidence_strength REAL NOT NULL DEFAULT 1.0,
  observed_at TEXT NOT NULL,
  projector_key TEXT NOT NULL,
  projector_version INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(projector_key, projector_version, source_fingerprint)
);

CREATE TABLE IF NOT EXISTS learner_observation_evidence (
  observation_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observation_id, event_id, evidence_role),
  FOREIGN KEY (observation_id) REFERENCES learner_observations(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES learning_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learning_projection_runs (
  id TEXT PRIMARY KEY NOT NULL,
  projector_key TEXT NOT NULL,
  projector_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  input_count INTEGER NOT NULL DEFAULT 0,
  output_count INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT NOT NULL,
  output_hash TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_learner_observations_scope
  ON learner_observations(user_id, namespace, scope_kind, scope_key, observed_at);
CREATE INDEX IF NOT EXISTS idx_learner_observations_type_time
  ON learner_observations(observation_type, observed_at);
CREATE INDEX IF NOT EXISTS idx_learner_observation_evidence_event
  ON learner_observation_evidence(event_id);
CREATE INDEX IF NOT EXISTS idx_learning_projection_runs_lookup
  ON learning_projection_runs(projector_key, projector_version, started_at);

-- An observation is valid only while every evidence row that created it exists.
-- This closes the derived-row orphan hole when learning_events cascades on delete.
CREATE TRIGGER IF NOT EXISTS trg_learning_observation_evidence_delete
AFTER DELETE ON learner_observation_evidence
BEGIN
  DELETE FROM learner_observations WHERE id = OLD.observation_id;
END;
