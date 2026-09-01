-- M5 context materialization + retrieval/invocation trace.
-- Rust owns these rows: they are the authorization/materialization audit.
-- Python's derived retrieval index lives in <AppData>/cognition/retrieval and is
-- disposable; only metadata/status is mirrored here (never vector contents).

CREATE TABLE IF NOT EXISTS agent_context_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  planner_version TEXT NOT NULL,
  scope TEXT NOT NULL,
  query_plan_json TEXT NOT NULL CHECK (json_valid(query_plan_json)),
  token_budget INTEGER NOT NULL CHECK (token_budget >= 0),
  used_tokens INTEGER NOT NULL CHECK (used_tokens >= 0),
  rendered_context TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_context_snapshots_run
  ON agent_context_snapshots(run_id, created_at);

CREATE TABLE IF NOT EXISTS agent_context_items (
  snapshot_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 0),
  score REAL NOT NULL,
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
  inclusion_reason TEXT NOT NULL,
  provenance_json TEXT,
  PRIMARY KEY (snapshot_id, item_type, item_id),
  FOREIGN KEY (snapshot_id) REFERENCES agent_context_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_context_items_snapshot
  ON agent_context_items(snapshot_id, rank);

CREATE TABLE IF NOT EXISTS retrieval_index_registry (
  id TEXT PRIMARY KEY NOT NULL,
  index_kind TEXT NOT NULL CHECK (index_kind IN ('lexical','embedding')),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('building','ready','invalid','failed')),
  source_content_hash TEXT,
  embedding_signature_json TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  index_id TEXT,
  planner_version TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  result_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (index_id) REFERENCES retrieval_index_registry(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_retrieval_runs_run
  ON retrieval_runs(run_id, created_at);

CREATE TABLE IF NOT EXISTS llm_invocations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('completion','embedding')),
  provider TEXT,
  model TEXT,
  request_hash TEXT NOT NULL,
  response_hash TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  provider_request_id TEXT,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_invocations_run
  ON llm_invocations(run_id, created_at);
