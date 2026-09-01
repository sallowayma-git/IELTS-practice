CREATE TABLE IF NOT EXISTS skill_catalog (
  skill_key TEXT PRIMARY KEY NOT NULL,
  activity TEXT NOT NULL,
  parent_key TEXT,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  taxonomy_version INTEGER NOT NULL,
  mapping_source TEXT NOT NULL
    CHECK (mapping_source IN ('builtin','content_pack','manual','model_proposed')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT '2026-08-12T00:00:00Z',
  updated_at TEXT NOT NULL DEFAULT '2026-08-12T00:00:00Z',
  CHECK (active = 0 OR mapping_source <> 'model_proposed'),
  FOREIGN KEY (parent_key) REFERENCES skill_catalog(skill_key)
);

CREATE INDEX IF NOT EXISTS idx_skill_catalog_activity
  ON skill_catalog(activity, active, taxonomy_version);

CREATE TABLE IF NOT EXISTS question_skill_map (
  asset_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
  mapping_source TEXT NOT NULL
    CHECK (mapping_source IN ('builtin','content_pack','manual','model_proposed')),
  mapping_version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT '2026-08-12T00:00:00Z',
  updated_at TEXT NOT NULL DEFAULT '2026-08-12T00:00:00Z',
  PRIMARY KEY (asset_id, question_id, skill_key),
  CHECK (active = 0 OR mapping_source <> 'model_proposed'),
  FOREIGN KEY (skill_key) REFERENCES skill_catalog(skill_key)
);

CREATE INDEX IF NOT EXISTS idx_question_skill_map_lookup
  ON question_skill_map(asset_id, question_id, active, mapping_version);

CREATE TABLE IF NOT EXISTS learner_skill_observations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local',
  event_id TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  outcome REAL NOT NULL CHECK (outcome >= 0 AND outcome <= 1),
  mapping_weight REAL NOT NULL CHECK (mapping_weight >= 0 AND mapping_weight <= 1),
  evidence_weight REAL NOT NULL CHECK (evidence_weight >= 0 AND evidence_weight <= 1),
  novelty_weight REAL NOT NULL CHECK (novelty_weight >= 0 AND novelty_weight <= 1),
  familiarity_weight REAL NOT NULL CHECK (familiarity_weight >= 0 AND familiarity_weight <= 1),
  time_weight REAL NOT NULL CHECK (time_weight >= 0 AND time_weight <= 1),
  error_type TEXT,
  context_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  attempt_id TEXT,
  intervention_id TEXT,
  intervention_type TEXT,
  UNIQUE(event_id, skill_key),
  FOREIGN KEY (event_id) REFERENCES learning_events(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_key) REFERENCES skill_catalog(skill_key)
);

CREATE INDEX IF NOT EXISTS idx_learner_skill_observations_skill_time
  ON learner_skill_observations(user_id, skill_key, observed_at, id);
CREATE INDEX IF NOT EXISTS idx_learner_skill_observations_asset
  ON learner_skill_observations(user_id, skill_key, asset_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_learner_skill_observations_intervention
  ON learner_skill_observations(intervention_id, observed_at);

CREATE TABLE IF NOT EXISTS learner_skill_state (
  user_id TEXT NOT NULL DEFAULT 'local',
  skill_key TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1 CHECK (alpha >= 1),
  beta REAL NOT NULL DEFAULT 1 CHECK (beta >= 1),
  mastery_mean REAL NOT NULL DEFAULT 0.5 CHECK (mastery_mean >= 0 AND mastery_mean <= 1),
  uncertainty REAL NOT NULL DEFAULT 1 CHECK (uncertainty >= 0 AND uncertainty <= 1),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  distinct_asset_count INTEGER NOT NULL DEFAULT 0 CHECK (distinct_asset_count >= 0),
  recent_error_rate REAL CHECK (recent_error_rate IS NULL OR (recent_error_rate >= 0 AND recent_error_rate <= 1)),
  stability_days REAL CHECK (stability_days IS NULL OR stability_days >= 0),
  last_practiced_at TEXT,
  next_review_at TEXT,
  model_version TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_key),
  FOREIGN KEY (skill_key) REFERENCES skill_catalog(skill_key)
);

CREATE INDEX IF NOT EXISTS idx_learner_skill_state_due
  ON learner_skill_state(user_id, next_review_at, skill_key);

CREATE TABLE IF NOT EXISTS skill_review_schedule (
  user_id TEXT NOT NULL DEFAULT 'local',
  skill_key TEXT NOT NULL,
  due_at TEXT NOT NULL,
  priority REAL NOT NULL CHECK (priority >= 0 AND priority <= 1),
  priority_band TEXT NOT NULL
    CHECK (priority_band IN ('urgent','high','moderate','watch')),
  preferred_probe TEXT NOT NULL
    CHECK (preferred_probe IN (
      'novel_item',
      'same_item_retention',
      'contrastive_pair',
      'coach_micro_drill',
      'writing_rewrite'
    )),
  avoid_asset_ids_json TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  supporting_observation_ids_json TEXT NOT NULL,
  last_scheduled_at TEXT,
  source_model_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skill_key),
  FOREIGN KEY (skill_key) REFERENCES skill_catalog(skill_key)
);

CREATE INDEX IF NOT EXISTS idx_skill_review_schedule_due
  ON skill_review_schedule(user_id, due_at, priority DESC, skill_key);

INSERT OR IGNORE INTO skill_catalog
  (skill_key, activity, parent_key, label, description, taxonomy_version, mapping_source, active)
VALUES
  ('reading.matching_headings', 'reading', NULL, 'Matching headings', 'Match paragraph purpose without relying on isolated keywords.', 1, 'builtin', 1),
  ('reading.tfng', 'reading', NULL, 'True / False / Not Given', 'Separate proposition boundaries from missing evidence.', 1, 'builtin', 1),
  ('reading.yng', 'reading', NULL, 'Yes / No / Not Given', 'Separate writer claims from missing evidence.', 1, 'builtin', 1),
  ('reading.multi_choice', 'reading', NULL, 'Multiple choice', 'Locate evidence and eliminate plausible distractors.', 1, 'builtin', 1),
  ('reading.single_choice', 'reading', NULL, 'Single choice', 'Locate evidence and eliminate plausible distractors.', 1, 'builtin', 1),
  ('reading.sentence_completion', 'reading', NULL, 'Sentence completion', 'Match paraphrase evidence and keep grammatical fit.', 1, 'builtin', 1),
  ('reading.summary_completion', 'reading', NULL, 'Summary completion', 'Track paraphrase evidence across a bounded summary.', 1, 'builtin', 1),
  ('reading.notes_completion', 'reading', NULL, 'Notes completion', 'Extract the exact bounded detail required by notes.', 1, 'builtin', 1),
  ('reading.table_completion', 'reading', NULL, 'Table completion', 'Track detail and grammatical fit in a table.', 1, 'builtin', 1),
  ('reading.flow_chart_completion', 'reading', NULL, 'Flow-chart completion', 'Track sequence and causal transitions.', 1, 'builtin', 1),
  ('reading.diagram_completion', 'reading', NULL, 'Diagram completion', 'Match local evidence and grammatical fit in a diagram.', 1, 'builtin', 1),
  ('reading.short_answer', 'reading', NULL, 'Short answer', 'Locate detail and respect answer boundaries.', 1, 'builtin', 1),
  ('reading.classification', 'reading', NULL, 'Classification', 'Track entities and map evidence to the correct class.', 1, 'builtin', 1),
  ('reading.matching_headings.global_main_idea', 'reading', 'reading.matching_headings', 'Global main idea', 'Summarise paragraph purpose before selecting an option.', 1, 'builtin', 1),
  ('reading.matching_headings.distractor_keyword_overlap', 'reading', 'reading.matching_headings', 'Distractor keyword overlap', 'Reject headings that match only a local keyword.', 1, 'builtin', 1),
  ('reading.matching_headings.paragraph_scope_control', 'reading', 'reading.matching_headings', 'Paragraph scope control', 'Keep the heading broad enough for the whole paragraph.', 1, 'builtin', 1),
  ('reading.matching_headings.evidence_completeness', 'reading', 'reading.matching_headings', 'Evidence completeness', 'Require the complete paragraph purpose to be supported.', 1, 'builtin', 1),
  ('reading.tfng.proposition_boundary', 'reading', 'reading.tfng', 'Proposition boundary', 'Keep subject, predicate, and scope aligned.', 1, 'builtin', 1),
  ('reading.tfng.false_vs_not_given', 'reading', 'reading.tfng', 'False versus Not Given', 'Distinguish contradiction from missing evidence.', 1, 'builtin', 1),
  ('reading.tfng.subject_scope', 'reading', 'reading.tfng', 'Subject scope', 'Keep the claim subject aligned with the evidence subject.', 1, 'builtin', 1),
  ('reading.tfng.quantifier_check', 'reading', 'reading.tfng', 'Quantifier check', 'Check quantity, frequency, and strength of the claim.', 1, 'builtin', 1),
  ('reading.multi_choice.distractor_elimination', 'reading', 'reading.multi_choice', 'Distractor elimination', 'Reject options that match only a local keyword.', 1, 'builtin', 1),
  ('reading.multi_choice.evidence_completeness', 'reading', 'reading.multi_choice', 'Evidence completeness', 'Require all parts of an option to be supported.', 1, 'builtin', 1);
