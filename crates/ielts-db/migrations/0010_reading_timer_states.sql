-- Durable timer ownership for standalone Reading attempts and Endless sessions.
-- Suite timers remain embedded in reading_suites because they are aggregate state.

CREATE TABLE IF NOT EXISTS reading_timer_states (
  scope TEXT NOT NULL CHECK(scope IN ('attempt', 'endless')),
  owner_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_timer_states_updated
  ON reading_timer_states(updated_at DESC);
