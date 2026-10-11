-- Version 30: raw learner data cannot be deleted unless a delete gate is open.
--
-- Raw truth (what the learner did and wrote, and the coach/evaluation text that
-- cost money to produce) is the one class of data this application cannot
-- regenerate. Until now nothing at the schema level stopped any statement from
-- deleting it: a retention default, a cascade, a buggy bulk path.
--
-- `delete_gate` is a one-row switch. Every table in RAW_TRUTH_TABLES
-- (`crates/ielts-db/src/safety/gate.rs`, pinned to this list by a test) gets a
-- BEFORE DELETE trigger that aborts while the switch is closed. The switch is
-- opened only by `safety::with_delete_gate`, a savepoint-scoped helper used by
-- the explicit user paths (history delete/clear/prune, annotation and vocabulary
-- delete, whole-set replacement of an attempt's answers, backup restore) and it
-- is restored to its previous value on every exit, including errors.
--
-- Foreign-key cascades run the child tables' delete triggers too, so a delete of
-- `attempts` through the gate is the only way to cascade into their answers,
-- annotations, evaluations and drafts.
--
-- Fail closed: a missing gate row counts as closed.
--
-- Not covered, by SQLite's own rules: DROP TABLE (its implicit DELETE fires no
-- triggers) and INSERT OR REPLACE (replacement deletes fire no triggers unless
-- recursive triggers are on). A migration that rebuilds a raw table must say so
-- and own the copy; see 0028 for the procedure.

CREATE TABLE IF NOT EXISTS delete_gate (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  open INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1))
);

INSERT OR IGNORE INTO delete_gate (singleton, open) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_attempts
BEFORE DELETE ON attempts
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: attempts may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_attempt_answers
BEFORE DELETE ON attempt_answers
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: attempt_answers may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_attempt_annotations
BEFORE DELETE ON attempt_annotations
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: attempt_annotations may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_writing_evaluations
BEFORE DELETE ON writing_evaluations
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: writing_evaluations may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_writing_drafts
BEFORE DELETE ON writing_drafts
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: writing_drafts may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_coach_threads
BEFORE DELETE ON coach_threads
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: coach_threads may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_coach_messages
BEFORE DELETE ON coach_messages
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: coach_messages may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_explicit_user_preferences
BEFORE DELETE ON explicit_user_preferences
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: explicit_user_preferences may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_vocabulary_items
BEFORE DELETE ON vocabulary_items
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: vocabulary_items may only be deleted through an explicit user path');
END;

CREATE TRIGGER IF NOT EXISTS trg_delete_gate_vocabulary_review_state
BEFORE DELETE ON vocabulary_review_state
WHEN COALESCE((SELECT open FROM delete_gate WHERE singleton = 1), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'delete_gate: vocabulary_review_state may only be deleted through an explicit user path');
END;
