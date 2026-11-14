-- Version 40: the IELTS Listening question types join the skill taxonomy.
--
-- These are question-type skills, one per payload kind the Listening scorer
-- can emit. Section numbers (1-4) are not skills: they are a position in the
-- paper, not something the learner can be weak at, so they are not seeded.
--
-- Idempotent: INSERT OR IGNORE keeps a replayed migration from duplicating
-- rows or overwriting a later content-pack label.
INSERT OR IGNORE INTO skill_catalog
  (skill_key, activity, parent_key, label, description, taxonomy_version, mapping_source, active)
VALUES
  ('listening.form_completion', 'listening', NULL, 'Form completion', 'Track spoken detail into a form and keep spelling and the word limit.', 1, 'builtin', 1),
  ('listening.note_completion', 'listening', NULL, 'Note completion', 'Capture the exact detail required by notes while following the talk.', 1, 'builtin', 1),
  ('listening.table_completion', 'listening', NULL, 'Table completion', 'Track detail and grammatical fit inside a table.', 1, 'builtin', 1),
  ('listening.flow_chart_completion', 'listening', NULL, 'Flow-chart completion', 'Follow sequence and causal transitions in the recording.', 1, 'builtin', 1),
  ('listening.summary_completion', 'listening', NULL, 'Summary completion', 'Track paraphrase evidence across a bounded summary.', 1, 'builtin', 1),
  ('listening.sentence_completion', 'listening', NULL, 'Sentence completion', 'Match spoken paraphrase and keep grammatical fit.', 1, 'builtin', 1),
  ('listening.single_choice', 'listening', NULL, 'Single choice', 'Locate evidence and eliminate plausible distractors.', 1, 'builtin', 1),
  ('listening.multi_choice', 'listening', NULL, 'Multiple choice', 'Locate evidence and eliminate plausible distractors across several options.', 1, 'builtin', 1),
  ('listening.matching', 'listening', NULL, 'Matching', 'Match statements to options while the recording moves on.', 1, 'builtin', 1),
  ('listening.map_labelling', 'listening', NULL, 'Map labelling', 'Follow spatial language and orient the map before the answer passes.', 1, 'builtin', 1),
  ('listening.plan_labelling', 'listening', NULL, 'Plan labelling', 'Follow spatial language and label the plan without losing the sequence.', 1, 'builtin', 1),
  ('listening.diagram_labelling', 'listening', NULL, 'Diagram labelling', 'Match local description and label the diagram correctly.', 1, 'builtin', 1),
  ('listening.short_answer', 'listening', NULL, 'Short answer', 'Locate detail and respect the word limit.', 1, 'builtin', 1);
