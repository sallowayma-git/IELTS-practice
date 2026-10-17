-- Version 32: matching sub-types get their own reading skills.
--
-- Payloads type every matching group as the generic kind `matching`; until now
-- all of them fed `reading.matching_headings`, so people/feature and
-- information matching misses were reported as a headings weakness.
-- `reading::assets::load_kinds` now resolves the real sub-type once, when an
-- attempt is scored, and `learner::canonical_reading_skill_key` maps it here.
-- A group whose sub-type cannot be told feeds the neutral `reading.matching`.
INSERT OR IGNORE INTO skill_catalog
  (skill_key, activity, parent_key, label, description, taxonomy_version, mapping_source, active)
VALUES
  ('reading.matching', 'reading', NULL, 'Matching', 'Match statements to options when the matching sub-type is not known.', 1, 'builtin', 1),
  ('reading.matching_information', 'reading', NULL, 'Matching information', 'Locate the paragraph or section that contains a stated detail.', 1, 'builtin', 1),
  ('reading.matching_features', 'reading', NULL, 'Matching features', 'Attribute statements to the right person, place, date or category.', 1, 'builtin', 1),
  ('reading.matching_sentence_endings', 'reading', NULL, 'Matching sentence endings', 'Complete a sentence with the ending the passage supports.', 1, 'builtin', 1);
