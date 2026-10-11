-- Version 27: the history retention policy defaults to UNLIMITED.
--
-- Migration 0008 seeded `max_terminal_attempts = 100` for everybody, so every
-- terminal attempt write silently hard-deleted raw learner records beyond the
-- hundredth. Raw practice records are the one thing this application cannot
-- regenerate; deleting them must be something the user asked for.
--
-- A row still carrying 0008's own stamp is an untouched default. 0008 wrote its
-- default with `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, i.e. a UTC `...Z` stamp,
-- while every explicit choice since (`set_history_retention_policy`) is written
-- by `chrono::Utc::now().to_rfc3339()`, i.e. `...+00:00`. A legacy value carried
-- over from the old settings KV keeps that setting's own `updated_at`; only the
-- value 100 is ambiguous there, and the safe reading of an ambiguous 100 is
-- "unlimited": the worst case is that a user who really wanted 100 has to pick
-- it again, never that records disappear.
--
-- `crates/ielts-db/src/history/mod.rs::NORMALIZE_UNTOUCHED_RETENTION_SQL` is the
-- same statement; a test pins the two together. Backup restore applies it too,
-- because a restored pre-0027 backup carries the old default row.
--
-- Replay-safe: a NULL row and every explicit row are left alone.

UPDATE history_retention_policy
   SET max_terminal_attempts = NULL
 WHERE max_terminal_attempts = 100 AND updated_at LIKE '%Z';
