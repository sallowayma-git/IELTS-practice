-- M10 Teaching Strategy Evolution / Procedural Memory.
--
-- Separates "what did the user like" (satisfaction) from "what teaching form
-- actually improved later learning" (learning outcome). M6 recorded the
-- interaction provenance (coach_strategy_assignments_v0); M10 builds the
-- evolution layer on top: an independent assignment table, two reward
-- channels on separate tables, per-user strategy state aggregation, a
-- rule-priority selection surface, and an offline-eval-gated candidate
-- promotion gate (LLM may propose, never execute directly).
--
-- Conventions: `IF NOT EXISTS` everywhere, JSON columns validated via
-- `json_valid`, CHECK constraints for enum dimensions. Fresh + previous
-- fixtures are exercised in tests; the backup roundtrip includes these tables.

-- M10-01/08: developer-defined strategy catalog. The catalog is seeded by the
-- migration (8 entries: the M6 set of 6 plus error_then_rule_v1 and
-- rule_then_example_v1). The LLM may not invent rows here directly; new
-- strategies enter via `strategy_candidate_batches` and an offline eval +
-- developer-approved prompt_module promotion gate (M10-08).
CREATE TABLE IF NOT EXISTS teaching_strategy_catalog (
  strategy_id TEXT PRIMARY KEY NOT NULL CHECK (strategy_id IN (
    'evidence_first_v1',
    'example_first_v1',
    'step_by_step_v1',
    'contrastive_v1',
    'socratic_prompt_v1',
    'concise_direct_v1',
    'error_then_rule_v1',
    'rule_then_example_v1'
  )),
  applicable_activity TEXT NOT NULL,
  applicable_skill_kind TEXT NOT NULL,
  prompt_module TEXT NOT NULL,
  contraindications_json TEXT NOT NULL CHECK (json_valid(contraindications_json)),
  max_verbosity INTEGER NOT NULL CHECK (max_verbosity >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_catalog_activity_skill
  ON teaching_strategy_catalog(applicable_activity, applicable_skill_kind);

-- M10-02: strategy assignment provenance for an M10 teaching response. This is
-- INDEPENDENT of coach_strategy_assignments_v0 (M6 interaction provenance):
-- M10 may reassign a strategy to a later response message, and the attribution
-- window + state aggregation live here. One assignment per response message.
CREATE TABLE IF NOT EXISTS teaching_strategy_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL CHECK (strategy_id IN (
    'evidence_first_v1',
    'example_first_v1',
    'step_by_step_v1',
    'contrastive_v1',
    'socratic_prompt_v1',
    'concise_direct_v1',
    'error_then_rule_v1',
    'rule_then_example_v1'
  )),
  why_selected_json TEXT NOT NULL CHECK (json_valid(why_selected_json)),
  memory_ids_json TEXT NOT NULL CHECK (json_valid(memory_ids_json)),
  skill_keys_json TEXT NOT NULL CHECK (json_valid(skill_keys_json)),
  context_snapshot_id TEXT,
  response_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (strategy_id)
    REFERENCES teaching_strategy_catalog(strategy_id) ON DELETE RESTRICT,
  FOREIGN KEY (context_snapshot_id)
    REFERENCES agent_context_snapshots(id) ON DELETE SET NULL,
  FOREIGN KEY (response_message_id)
    REFERENCES coach_messages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_teaching_strategy_assignment_response
  ON teaching_strategy_assignments(response_message_id);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_assignments_user
  ON teaching_strategy_assignments(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_assignments_strategy
  ON teaching_strategy_assignments(strategy_id, created_at);

-- M10-03: SATISFACTION reward channel. This is a user-interaction fact
-- (thumbs / reask / explicit correction / abandon). It is intentionally a
-- SEPARATE table from learning outcomes: a thumbs-up is never treated as
-- evidence that the teaching strategy improved learning.
CREATE TABLE IF NOT EXISTS teaching_strategy_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  feedback_kind TEXT NOT NULL CHECK (feedback_kind IN (
    'thumbs_up',
    'thumbs_down',
    'reask',
    'explicit_correction',
    'abandon'
  )),
  assignment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id)
    REFERENCES teaching_strategy_assignments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_feedback_assignment
  ON teaching_strategy_feedback(assignment_id);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_feedback_kind
  ON teaching_strategy_feedback(feedback_kind, created_at);

-- M10-03/04: LEARNING reward channel. Recorded only when a later skill
-- observation falls within the attribution window of the assignment's
-- created_at, preferring a NOVEL asset (a repeated same-asset attempt is
-- discounted). `score_delta` captures the measurable change if computable.
-- Satisfaction feedback on the same assignment is NEVER stored here.
CREATE TABLE IF NOT EXISTS teaching_strategy_outcomes (
  id TEXT PRIMARY KEY NOT NULL,
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN (
    'next_novel_skill_attempt',
    'next_writing_revision',
    'corrected_repeated_behavior',
    'transfer_to_another_asset'
  )),
  assignment_id TEXT NOT NULL,
  observation_id TEXT,
  novel_asset_id TEXT,
  score_delta REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (assignment_id)
    REFERENCES teaching_strategy_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (observation_id)
    REFERENCES learner_observations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_outcomes_assignment
  ON teaching_strategy_outcomes(assignment_id);

CREATE INDEX IF NOT EXISTS idx_teaching_strategy_outcomes_kind
  ON teaching_strategy_outcomes(outcome_kind, created_at);

-- M10-05: per-user strategy state aggregate. Scope is a coarse activity
-- boundary (e.g. "reading", "writing"). No global reinforcement learning: the
-- confidence is a bounded success/(success+failure) formula, clamped. Evidence
-- counts feed the M10-06 selection rule (proven personal strategy) and the
-- exploration slot gate.
CREATE TABLE IF NOT EXISTS user_strategy_state (
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL CHECK (strategy_id IN (
    'evidence_first_v1',
    'example_first_v1',
    'step_by_step_v1',
    'contrastive_v1',
    'socratic_prompt_v1',
    'concise_direct_v1',
    'error_then_rule_v1',
    'rule_then_example_v1'
  )),
  scope TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  satisfaction_count INTEGER NOT NULL DEFAULT 0 CHECK (satisfaction_count >= 0),
  reask_count INTEGER NOT NULL DEFAULT 0 CHECK (reask_count >= 0),
  novel_transfer_success INTEGER NOT NULL DEFAULT 0 CHECK (novel_transfer_success >= 0),
  last_used TEXT,
  confidence REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, strategy_id, scope),
  FOREIGN KEY (strategy_id)
    REFERENCES teaching_strategy_catalog(strategy_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_user_strategy_state_scope
  ON user_strategy_state(user_id, scope, confidence);

-- M10-08: candidate strategy batches. The LLM may PROPOSE new strategy
-- candidates here as pending; promotion requires offline eval + a
-- developer-defined prompt_module and is gated by
-- `promote_strategy_candidate`. A pending/eval/rejected candidate is NEVER
-- directly executable as a teaching strategy.
CREATE TABLE IF NOT EXISTS strategy_candidate_batches (
  id TEXT PRIMARY KEY NOT NULL,
  batch_json TEXT NOT NULL CHECK (json_valid(batch_json)),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'pending',
    'eval',
    'rejected',
    'promoted'
  )),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_candidate_batches_disposition
  ON strategy_candidate_batches(disposition, created_at);

-- M10-01: seed the developer-defined catalog. Two new strategies
-- (error_then_rule_v1, rule_then_example_v1) extend the M6 set of 6. The
-- default for a generic explain activity is evidence_first_v1.
INSERT OR IGNORE INTO teaching_strategy_catalog
  (strategy_id, applicable_activity, applicable_skill_kind, prompt_module, contraindications_json, max_verbosity, version, is_default)
VALUES
  ('evidence_first_v1', 'any', 'any', 'coach.strategies.evidence_first',
   '["high_cognitive_load","short_attention_span"]', 3, 1, 1),
  ('example_first_v1', 'any', 'any', 'coach.strategies.example_first',
   '["no_concrete_examples_available"]', 3, 1, 0),
  ('step_by_step_v1', 'any', 'procedural', 'coach.strategies.step_by_step',
   '["single_concept_question"]', 4, 1, 0),
  ('contrastive_v1', 'any', 'discrimination', 'coach.strategies.contrastive',
   '["no_contrast_pair_available"]', 3, 1, 0),
  ('socratic_prompt_v1', 'any', 'metacognition', 'coach.strategies.socratic_prompt',
   '["novice_frustration_risk","time_pressure"]', 2, 1, 0),
  ('concise_direct_v1', 'any', 'any', 'coach.strategies.concise_direct',
   '["deep_explanation_requested"]', 1, 1, 0),
  ('error_then_rule_v1', 'any', 'rule_application', 'coach.strategies.error_then_rule',
   '["no_prior_error_to_anchor"]', 3, 1, 0),
  ('rule_then_example_v1', 'any', 'rule_application', 'coach.strategies.rule_then_example',
   '["no_rule_formulation_possible"]', 3, 1, 0);
