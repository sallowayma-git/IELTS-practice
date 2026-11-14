-- Version 37: the four IELTS writing criteria join the skill taxonomy.
--
-- Writing observations are stored per criterion (`writing.evaluation.criterion_score`
-- with `criterion` taskResponse/coherence/lexical/grammar). The writing coach
-- profile joins `learner_skill_state` against `skill_catalog.activity='writing'`;
-- without these rows that join can never report a writing weakness.
INSERT OR IGNORE INTO skill_catalog
  (skill_key, activity, parent_key, label, description, taxonomy_version, mapping_source, active)
VALUES
  ('writing.taskResponse', 'writing', NULL, 'Task response', 'Answer every part of the task and keep a clear position throughout.', 1, 'builtin', 1),
  ('writing.coherence', 'writing', NULL, 'Coherence and cohesion', 'Organise ideas into a clear progression and link them naturally.', 1, 'builtin', 1),
  ('writing.lexical', 'writing', NULL, 'Lexical resource', 'Use a wide enough range of vocabulary precisely and naturally.', 1, 'builtin', 1),
  ('writing.grammar', 'writing', NULL, 'Grammatical range and accuracy', 'Use a range of structures with errors that rarely impede meaning.', 1, 'builtin', 1);
