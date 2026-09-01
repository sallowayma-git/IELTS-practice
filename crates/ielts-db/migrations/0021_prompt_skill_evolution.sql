-- M11 Prompt Registry, Skill Registry, and Eval-driven Evolution.
--
-- Product Prompt/Skill evolution is separated from user Memory evolution.
-- The online Agent never edits its own Soul; product prompts evolve via a
-- controlled engineering pipeline: propose -> offline eval -> holdout ->
-- shadow -> manual approval -> canary -> promote -> rollback. Rust is the
-- release gate; the LLM may only propose candidates, never execute them.
--
-- M11-01: Soul (core_soul module) is a stable Policy Layer. It is never
-- rewritten by Daily/Weekly Dream. The `edit_soul` agent tool is denied.
--
-- Conventions: `IF NOT EXISTS` everywhere, JSON columns validated via
-- `json_valid`, CHECK constraints for enum dimensions. Fresh + previous
-- fixtures are exercised in tests; the backup roundtrip includes these
-- tables.

-- M11-02: prompt module registry. A template owns one module; versions are
-- immutable content rows with a lifecycle status. The `core_soul` module is
-- the stable Policy Layer (M11-01): it is never rewritten by Dream.
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY NOT NULL,
  module_name TEXT NOT NULL CHECK (module_name IN (
    'core_soul',
    'attempt_review',
    'coach_reading',
    'coach_writing',
    'memory_extract',
    'memory_resolve',
    'daily_dream',
    'weekly_dream',
    'strategy_selector',
    'study_planner'
  )),
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_prompt_templates_module
  ON prompt_templates(module_name);

-- M11-05: prompt version lifecycle. Versions are immutable content rows.
-- Status transitions are owned by Rust (the release gate): draft -> eval ->
-- holdout -> shadow -> canary -> active; rollback marks a prior version
-- active and the superseded version `rollback`. Only one version per
-- template may be `active` at a time; this is enforced by Rust at promote
-- time, not by a partial unique index (which SQLite only supports on newer
-- versions). `content_hash` is a sha256 of `content_text`.
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL,
  content_text TEXT NOT NULL,
  prompt_metadata_json TEXT NOT NULL CHECK (json_valid(prompt_metadata_json)),
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'eval',
    'holdout',
    'shadow',
    'canary',
    'active',
    'rollback'
  )),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(template_id, version),
  FOREIGN KEY (template_id)
    REFERENCES prompt_templates(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_template_status
  ON prompt_versions(template_id, status, created_at);

-- M11-03: skill registry. A skill is a reusable process/capability (not a
-- Memory file). Skill versioning is separated from user memory: user
-- memory evolves via the M2/M7/M8 candidate pipeline; skills evolve via
-- the M11 candidate gate.
CREATE TABLE IF NOT EXISTS skill_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  skill_name TEXT NOT NULL CHECK (skill_name IN (
    'read_attempt_evidence',
    'compare_repeated_attempts',
    'explain_tfng_error',
    'build_weekly_reflection'
  )),
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_skill_definitions_name
  ON skill_definitions(skill_name);

-- M11-05: skill version lifecycle. Mirrors prompt version lifecycle.
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY NOT NULL,
  skill_definition_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'eval',
    'holdout',
    'shadow',
    'canary',
    'active',
    'rollback'
  )),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(skill_definition_id, version),
  FOREIGN KEY (skill_definition_id)
    REFERENCES skill_definitions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_definition_status
  ON skill_versions(skill_definition_id, status, created_at);

-- M11-04: eval dataset. Cases are immutable fixtures. `holdout` cases are
-- never exposed to prompt generation context (M11-05): they are the held-out
-- evaluation set, used only to score candidate versions. `case_kind`
-- enumerates the eight evaluation categories.
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY NOT NULL,
  case_kind TEXT NOT NULL CHECK (case_kind IN (
    'memory_extraction_goldens',
    'false_merge_split',
    'consolidation_zero',
    'context_selection',
    'coach_personalization',
    'prompt_injection',
    'repeated_familiarity',
    'strategy_outcome'
  )),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  expected_json TEXT NOT NULL CHECK (json_valid(expected_json)),
  holdout INTEGER NOT NULL CHECK (holdout IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_kind_holdout
  ON eval_cases(case_kind, holdout);

-- M11-05: a candidate promotion record owns the lifecycle of a proposed
-- prompt or skill version. `status` is the lifecycle: proposed ->
-- eval_passed -> holdout -> shadow -> approved -> canary -> promoted (or
-- rolled_back). `target_kind` distinguishes prompt vs skill candidates.
-- `target_version_id` references prompt_versions.id or skill_versions.id
-- depending on `target_kind` (no FK: the target table is conditional).
CREATE TABLE IF NOT EXISTS candidate_promotions (
  id TEXT PRIMARY KEY NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('prompt', 'skill')),
  target_version_id TEXT NOT NULL,
  proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
  status TEXT NOT NULL CHECK (status IN (
    'proposed',
    'eval_passed',
    'holdout',
    'shadow',
    'approved',
    'canary',
    'promoted',
    'rolled_back'
  )),
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_promotions_target
  ON candidate_promotions(target_kind, target_version_id, status);

-- M11-05: an eval run scores a candidate against a set of cases. Each run
-- belongs to a candidate promotion. `status` is queued/running/completed/
-- failed; `metrics_json` carries aggregate metrics (pass rate, score).
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_promotion_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  metrics_json TEXT CHECK (metrics_json IS NULL OR json_valid(metrics_json)),
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_promotion_id)
    REFERENCES candidate_promotions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_candidate
  ON eval_runs(candidate_promotion_id, status);

-- M11-05: a single case result within an eval run. `passed` is the binary
-- gate; `score` is the continuous grade; `grading_json` carries per-dimension
-- grader outputs (M11-08 trace graders).
CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY NOT NULL,
  eval_run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  score REAL NOT NULL,
  grading_json TEXT NOT NULL CHECK (json_valid(grading_json)),
  FOREIGN KEY (eval_run_id)
    REFERENCES eval_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id)
    REFERENCES eval_cases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run
  ON eval_results(eval_run_id, passed);

-- M11-05: shadow run. A candidate version is exercised against real inputs
-- without producing user-visible side effects. `output_diff_json` records
-- the diff vs the active version's output. `no_user_visible_side_effect`
-- must be TRUE: a shadow run that mutates user truth is a contract
-- violation and is rejected by Rust before persistence. The CHECK enforces
-- the invariant at the storage layer; the Rust layer additionally fails
-- closed on any side-effecting tool during a shadow run.
CREATE TABLE IF NOT EXISTS shadow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_promotion_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_diff_json TEXT NOT NULL CHECK (json_valid(output_diff_json)),
  no_user_visible_side_effect INTEGER NOT NULL CHECK (no_user_visible_side_effect = 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_promotion_id)
    REFERENCES candidate_promotions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shadow_runs_candidate
  ON shadow_runs(candidate_promotion_id, created_at);
