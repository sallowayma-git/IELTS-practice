-- Split generic matching out of the Matching Headings skill. Matching
-- information (paragraph letters, "which paragraph") and matching features
-- (people, dates, countries, word banks) need their own mastery tracking.
-- Additive only: existing learner_skill_observations keep their skill keys.
INSERT OR IGNORE INTO skill_catalog
  (skill_key, activity, parent_key, label, description, taxonomy_version, mapping_source, active)
VALUES
  ('reading.matching_information', 'reading', NULL, 'Matching information', 'Locate the paragraph that carries a specific detail, independent of paragraph order.', 1, 'builtin', 1),
  ('reading.matching_features', 'reading', NULL, 'Matching features', 'Match each statement to the option it describes, such as a person, date, or country.', 1, 'builtin', 1);
