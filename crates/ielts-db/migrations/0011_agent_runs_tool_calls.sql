CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'running', 'completed', 'failed', 'limit_exceeded', 'interrupted'
  )),
  rounds INTEGER NOT NULL DEFAULT 0 CHECK(rounds >= 0),
  tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK(tool_call_count >= 0),
  result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated
  ON agent_runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  round_index INTEGER NOT NULL CHECK(round_index > 0),
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'running', 'succeeded', 'rejected', 'failed', 'interrupted'
  )),
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY(run_id, sequence),
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run_sequence
  ON agent_tool_calls(run_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run_call_id
  ON agent_tool_calls(run_id, call_id);
