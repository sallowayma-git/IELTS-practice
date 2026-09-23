CREATE TABLE IF NOT EXISTS practice_record_tombstones (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_id text NOT NULL,
    deleted_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, record_id)
);

CREATE TABLE IF NOT EXISTS practice_record_sync_state (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cleared_at timestamptz
);

CREATE INDEX IF NOT EXISTS practice_record_tombstones_user_deleted_at_idx
    ON practice_record_tombstones (user_id, deleted_at DESC);
