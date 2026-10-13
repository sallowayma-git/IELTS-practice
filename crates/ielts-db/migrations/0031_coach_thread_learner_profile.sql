-- The learner profile a coach thread was started with, frozen on its first run
-- and replayed verbatim on every later turn so the prompt prefix stays
-- byte-identical. NULL means the thread has not run yet.
ALTER TABLE coach_threads ADD COLUMN learner_profile_json TEXT
  CHECK (learner_profile_json IS NULL OR json_valid(learner_profile_json));
