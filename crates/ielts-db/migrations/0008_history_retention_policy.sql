-- Version 8: a first-class history retention policy. This is deliberately not
-- a settings KV: terminal-attempt writes and policy changes must share SQLite
-- transactional semantics.

CREATE TABLE IF NOT EXISTS history_retention_policy (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  -- NULL means automatic cleanup is disabled (unlimited retained history).
  max_terminal_attempts INTEGER CHECK (
    max_terminal_attempts IS NULL OR (
      max_terminal_attempts >= 50
      AND max_terminal_attempts <= 500
      AND max_terminal_attempts % 50 = 0
    )
  ),
  updated_at TEXT NOT NULL
);

-- Preserve the previously displayed preference when it is a valid historical
-- value, then remove that obsolete KV mirror. SQLite's CAST is deliberately
-- permissive (for example, CAST('150abc' AS INTEGER) is 150), so parse the
-- JSON value first and accept text only when every character is an ASCII digit.
-- Invalid legacy values fall back to the documented default instead of
-- creating an unbounded delete policy.
WITH legacy_history_limit AS (
  SELECT
    updated_at,
    CASE
      -- CASE short-circuits: json_type/json_extract must never see a broken
      -- old settings payload.
      WHEN json_valid(value_json) = 0 THEN NULL
      WHEN json_type(value_json) = 'integer' THEN CAST(json_extract(value_json, '$') AS TEXT)
      WHEN json_type(value_json) = 'text'
        AND length(json_extract(value_json, '$')) > 0
        AND json_extract(value_json, '$') NOT GLOB '*[^0-9]*'
      THEN json_extract(value_json, '$')
      ELSE NULL
    END AS raw_limit
  FROM settings
  WHERE namespace = 'app' AND key = 'history_limit'
)
INSERT OR IGNORE INTO history_retention_policy (
  singleton, max_terminal_attempts, updated_at
)
SELECT
  1,
  CASE
    WHEN raw_limit IS NOT NULL
      AND CAST(raw_limit AS INTEGER) BETWEEN 50 AND 500
      AND CAST(raw_limit AS INTEGER) % 50 = 0
    THEN CAST(raw_limit AS INTEGER)
    ELSE 100
  END,
  updated_at
FROM legacy_history_limit;

INSERT OR IGNORE INTO history_retention_policy (
  singleton, max_terminal_attempts, updated_at
) VALUES (1, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

DELETE FROM settings WHERE namespace = 'app' AND key = 'history_limit';
