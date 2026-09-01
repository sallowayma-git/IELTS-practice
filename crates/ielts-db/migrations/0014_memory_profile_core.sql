CREATE TABLE IF NOT EXISTS explicit_user_preferences (
  user_id TEXT NOT NULL DEFAULT 'local',
  preference_key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled','deleted')),
  source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('user','import','product_default')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, preference_key, scope)
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 4) = 'mem-'),
  user_id TEXT NOT NULL DEFAULT 'local',
  namespace TEXT NOT NULL
    CHECK (namespace IN (
      'knowledge','language','strategy','behavior','metacognition','preference','goal'
    )),
  scope TEXT NOT NULL,
  memory_type TEXT NOT NULL
    CHECK (memory_type IN (
      'semantic','episodic','procedural','inferred_profile','goal','constraint'
    )),
  canonical_key TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  subject_key TEXT,
  title TEXT,
  content TEXT NOT NULL,
  structured_json TEXT CHECK (structured_json IS NULL OR json_valid(structured_json)),
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN (
      'candidate','pending_review','active','superseded','archived',
      'rejected','quarantined','deleted'
    )),
  source_class TEXT NOT NULL
    CHECK (source_class IN (
      'user_explicit','observed','inferred','predicted','consolidated','system_policy'
    )),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL DEFAULT 0 CHECK (importance >= 0 AND importance <= 1),
  source_trust REAL NOT NULL DEFAULT 0 CHECK (source_trust >= 0 AND source_trust <= 1),
  sensitivity TEXT NOT NULL DEFAULT 'normal'
    CHECK (sensitivity IN ('normal','private','restricted')),
  improvement_state TEXT NOT NULL DEFAULT 'baseline'
    CHECK (improvement_state IN ('baseline','improved','regressed')),
  valid_from TEXT,
  valid_to TEXT,
  first_observed_at TEXT,
  last_observed_at TEXT,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0 CHECK (recall_count >= 0),
  successful_use_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_use_count >= 0),
  contradicted_count INTEGER NOT NULL DEFAULT 0 CHECK (contradicted_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id TEXT,
  created_by TEXT NOT NULL,
  created_run_id TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supersedes_id) REFERENCES memory_items(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (created_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_active_scope
  ON memory_items(user_id, scope, memory_type, status);
CREATE INDEX IF NOT EXISTS idx_memory_subject
  ON memory_items(subject_key, status);
CREATE INDEX IF NOT EXISTS idx_memory_canonical
  ON memory_items(canonical_key, status);
CREATE INDEX IF NOT EXISTS idx_memory_recency
  ON memory_items(last_observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_active_canonical
  ON memory_items(user_id, scope, canonical_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS memory_candidate_batches (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 6) = 'mcbat-'),
  request_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL DEFAULT 'local',
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  source_class TEXT NOT NULL
    CHECK (source_class IN ('inferred','predicted','consolidated')),
  observation_projector_key TEXT NOT NULL,
  observation_projector_version INTEGER NOT NULL CHECK (observation_projector_version >= 1),
  payload_hash TEXT NOT NULL,
  proposal_count INTEGER NOT NULL CHECK (proposal_count >= 0 AND proposal_count <= 32),
  status TEXT NOT NULL
    CHECK (status IN ('accepted','partially_accepted','rejected','quarantined')),
  run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 6) = 'mcand-'),
  batch_id TEXT NOT NULL,
  proposal_index INTEGER NOT NULL CHECK (proposal_index >= 0),
  action TEXT NOT NULL
    CHECK (action IN (
      'ADD','REINFORCE','REFINE','IMPROVE','REGRESS','CONTRADICT','SUPERSEDE','ARCHIVE','NOOP'
    )),
  target_memory_id TEXT,
  expected_target_version INTEGER CHECK (expected_target_version IS NULL OR expected_target_version >= 1),
  namespace TEXT
    CHECK (namespace IS NULL OR namespace IN (
      'knowledge','language','strategy','behavior','metacognition','preference','goal'
    )),
  canonical_key TEXT,
  normalized_label TEXT,
  scope TEXT,
  proposed_statement TEXT,
  source_class TEXT NOT NULL
    CHECK (source_class IN ('inferred','predicted','consolidated')),
  disposition TEXT NOT NULL
    CHECK (disposition IN ('pending','duplicate','rejected','quarantined','noop','promoted','stale')),
  evidence_observation_ids_json TEXT NOT NULL
    CHECK (json_valid(evidence_observation_ids_json)),
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
  issues_json TEXT NOT NULL CHECK (json_valid(issues_json)),
  proposal_json TEXT CHECK (proposal_json IS NULL OR json_valid(proposal_json)),
  payload_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  resolved_memory_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, proposal_index),
  FOREIGN KEY (batch_id) REFERENCES memory_candidate_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_candidates_pending
  ON memory_candidates(disposition, source_class, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_candidates_target
  ON memory_candidates(target_memory_id, disposition);

-- observation_id is deliberately a logical reference. learner_observations is
-- a rebuildable projection, so a strong FK would make projection rebuilds
-- delete or invalidate durable Memory lineage.
CREATE TABLE IF NOT EXISTS memory_evidence (
  memory_id TEXT NOT NULL,
  observation_id TEXT NOT NULL CHECK (substr(observation_id, 1, 4) = 'obs-'),
  source_fingerprint TEXT NOT NULL,
  projector_key TEXT NOT NULL,
  projector_version INTEGER NOT NULL CHECK (projector_version >= 1),
  evidence_role TEXT NOT NULL DEFAULT 'support'
    CHECK (evidence_role IN (
      'support','contradict','improvement','user_feedback','context','outcome'
    )),
  event_ids_json TEXT NOT NULL CHECK (json_valid(event_ids_json)),
  evidence_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, observation_id, evidence_role),
  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_mutations (
  id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, 5) = 'mmut-'),
  memory_id TEXT,
  candidate_id TEXT,
  operation TEXT NOT NULL
    CHECK (operation IN (
      'propose','create','promote','reinforce','refine','improve','regress','contradict',
      'supersede','archive','reject','quarantine','restore','delete'
    )),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('user','agent','dream','system','developer')),
  actor_id TEXT,
  run_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_items(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_id) REFERENCES memory_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_mutations_memory
  ON memory_mutations(memory_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_mutations_candidate
  ON memory_mutations(candidate_id, created_at);
