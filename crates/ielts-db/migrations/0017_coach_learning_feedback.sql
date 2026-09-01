-- M6 coach closed loop: canonical feedback, re-ask linkage, strategy
-- assignment provenance, and outcome links.
--
-- These tables record user-interaction facts and teaching-strategy provenance.
-- They are NOT long-term preferences on their own: M6-07 only promotes repeated
-- patterns to memory candidates after later outcomes confirm a stable
-- preference. The strategy catalog is a fixed M6 enum (M6-09): the LLM may
-- only select from the set; it cannot invent new strategy ids.

-- M6-05: canonical coach feedback (user interaction fact).
CREATE TABLE IF NOT EXISTS coach_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  coach_message_id TEXT NOT NULL,
  feedback_kind TEXT NOT NULL CHECK (feedback_kind IN (
    'thumbs_up',
    'thumbs_down',
    'too_long',
    'too_short',
    'too_abstract',
    'need_example',
    'need_step_by_step',
    'incorrect',
    'not_relevant',
    'reask_same_question',
    'style_correction'
  )),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (coach_message_id) REFERENCES coach_messages(id) ON DELETE CASCADE
);

-- Idempotent: the same coach_message_id + feedback_kind retried does not
-- create a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_coach_feedback_message_kind
  ON coach_feedback(coach_message_id, feedback_kind);

CREATE INDEX IF NOT EXISTS idx_coach_feedback_user
  ON coach_feedback(user_id, created_at);

-- M6-06: re-ask linkage. The UI/service explicitly records that a new user
-- message is a re-ask of a prior assistant message. Asking a new question
-- never creates a row here; only an explicit re-ask does.
CREATE TABLE IF NOT EXISTS coach_reask_links (
  parent_assistant_message_id TEXT NOT NULL,
  new_user_message_id TEXT NOT NULL,
  feedback_kind TEXT NOT NULL CHECK (feedback_kind = 'reask_same_question'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_assistant_message_id, new_user_message_id),
  FOREIGN KEY (parent_assistant_message_id) REFERENCES coach_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (new_user_message_id) REFERENCES coach_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_reask_links_parent
  ON coach_reask_links(parent_assistant_message_id);

-- M6-04/09: strategy assignment provenance for a coach response. The body
-- text remains natural language; this row records what teaching form was used
-- and which context/memory fed the response. M6 only selects and records;
-- it does not learn strategy weights (that is M10).
CREATE TABLE IF NOT EXISTS coach_strategy_assignments_v0 (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  coach_message_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL CHECK (strategy_id IN (
    'evidence_first_v1',
    'example_first_v1',
    'step_by_step_v1',
    'contrastive_v1',
    'socratic_prompt_v1',
    'concise_direct_v1'
  )),
  skills_addressed_json TEXT NOT NULL CHECK (json_valid(skills_addressed_json)),
  memory_ids_used_json TEXT NOT NULL CHECK (json_valid(memory_ids_used_json)),
  context_snapshot_id TEXT,
  followup_type TEXT NOT NULL CHECK (followup_type IN (
    'explain',
    'example',
    'step_by_step',
    'contrast',
    'socratic_prompt',
    'concise_direct',
    'none'
  )),
  created_at TEXT NOT NULL,
  FOREIGN KEY (coach_message_id) REFERENCES coach_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (context_snapshot_id) REFERENCES agent_context_snapshots(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_coach_strategy_assignment_message
  ON coach_strategy_assignments_v0(coach_message_id);

CREATE INDEX IF NOT EXISTS idx_coach_strategy_assignments_user
  ON coach_strategy_assignments_v0(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_coach_strategy_assignments_strategy
  ON coach_strategy_assignments_v0(strategy_id, created_at);

-- M6-10: outcome link. A strategy assignment is linked to a future
-- observation. Satisfaction (user feedback) and learning (later skill
-- observation) outcomes are recorded on SEPARATE rows; a thumbs-up is never
-- treated as a learning outcome.
CREATE TABLE IF NOT EXISTS coach_outcome_links_v0 (
  strategy_assignment_id TEXT NOT NULL,
  future_observation_id TEXT NOT NULL,
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN ('satisfaction', 'learning')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (strategy_assignment_id, future_observation_id, outcome_kind),
  FOREIGN KEY (strategy_assignment_id)
    REFERENCES coach_strategy_assignments_v0(id) ON DELETE CASCADE,
  FOREIGN KEY (future_observation_id)
    REFERENCES learner_observations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_coach_outcome_links_assignment
  ON coach_outcome_links_v0(strategy_assignment_id);

CREATE INDEX IF NOT EXISTS idx_coach_outcome_links_observation
  ON coach_outcome_links_v0(future_observation_id);
