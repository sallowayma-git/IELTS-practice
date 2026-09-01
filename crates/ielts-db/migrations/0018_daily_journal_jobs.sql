-- M7 Daily Journal + Daily Dream v1: durable background jobs, deterministic
-- journal projection, and dream candidate ledger.
--
-- These tables record derived daily consolidations and bounded dream
-- proposals. They are NOT another append-only chat log: the journal is a
-- versioned canonical projection of canonical truth, and dreams only produce
-- pending candidates that must still go through M3 `promote_memory_candidate`.
--
-- M7-01: durable SQLite job ledger. Process-local task_status is deliberately
-- not replicated; a single process-local worker claims via BEGIN IMMEDIATE +
-- RETURNING (§23.15). Lease timeout reclaims abandoned runs on the next start.

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_kind TEXT NOT NULL CHECK (job_kind IN (
    'daily_journal',
    'daily_dream'
  )),
  user_id TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','interrupted')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  scheduled_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  heartbeat_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  dedupe_key TEXT,
  last_error TEXT,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_claim
  ON background_jobs(status, scheduled_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_background_jobs_lease
  ON background_jobs(status, heartbeat_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_background_jobs_dedupe_queued
  ON background_jobs(job_kind, user_id, dedupe_key)
  WHERE status = 'queued' AND dedupe_key IS NOT NULL;

-- M7-03: deterministic daily journal canonical projection. A row is a derived
-- projection of canonical truth (events/observations/memory/learner), never
-- the source of truth itself. Same-day rerun produces a new version and
-- supersedes the previous row (M7-05). The rendered Markdown is an export view,
-- not the canonical record.
CREATE TABLE IF NOT EXISTS daily_journals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local',
  journal_date TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','superseded')),
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  source_hash TEXT NOT NULL,
  rendered_markdown TEXT,
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, journal_date, version),
  FOREIGN KEY (superseded_by) REFERENCES daily_journals(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_daily_journals_user_date
  ON daily_journals(user_id, journal_date, version DESC);
CREATE INDEX IF NOT EXISTS idx_daily_journals_status
  ON daily_journals(user_id, journal_date, status);

-- M7-03: source range provenance. Each row records a bounded source slice that
-- fed a journal. The range_hash is stable for the same canonical input, so a
-- rerun with no new events produces the same source_hash and the journal can
-- short-circuit. Private memory rows are never copied into facts; only counts
-- and redacted summaries leave the projection.
CREATE TABLE IF NOT EXISTS daily_journal_sources (
  journal_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'event','observation','attempt','coach_feedback','memory_mutation','learner_delta'
  )),
  source_id TEXT NOT NULL,
  range_hash TEXT NOT NULL,
  PRIMARY KEY (journal_id, source_kind, source_id),
  FOREIGN KEY (journal_id) REFERENCES daily_journals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_journal_sources_kind
  ON daily_journal_sources(journal_id, source_kind);

-- M7-07: daily dream run ledger. A dream run is the bounded LLM-side pass that
-- reads today's facts and produces pending candidates. It is fail-closed: a
-- failed dream never blocks the deterministic journal or the practice loop.
CREATE TABLE IF NOT EXISTS dream_runs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local',
  journal_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
  input_hash TEXT,
  output_hash TEXT,
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (journal_id) REFERENCES daily_journals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dream_runs_journal
  ON dream_runs(journal_id);
CREATE INDEX IF NOT EXISTS idx_dream_runs_status
  ON dream_runs(user_id, status);

-- M7-07: dream candidate ledger. A candidate is a pending proposal that must
-- still go through M3 `promote_memory_candidate` before it touches active
-- memory. The LLM may only select from the fixed proposal_kind enum; it cannot
-- invent new kinds. Capacity is bounded by the application layer (M7-08).
CREATE TABLE IF NOT EXISTS dream_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  proposal_kind TEXT NOT NULL CHECK (proposal_kind IN (
    'REINFORCE','REFINE','IMPROVE','REGRESS','CONTRADICT','NOOP'
  )),
  target_memory_id TEXT,
  evidence_observation_ids_json TEXT NOT NULL CHECK (json_valid(evidence_observation_ids_json)),
  disposition TEXT NOT NULL DEFAULT 'pending'
    CHECK (disposition IN ('pending','promoted','rejected')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES dream_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (target_memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dream_candidates_run
  ON dream_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_dream_candidates_disposition
  ON dream_candidates(disposition, created_at);
