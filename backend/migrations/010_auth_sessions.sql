CREATE TABLE IF NOT EXISTS auth_sessions (
    id uuid PRIMARY KEY,
    session_handle_hash text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience text NOT NULL CHECK (audience IN ('business', 'admin', 'auth')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    expires_at timestamptz NOT NULL,
    last_verifier_rotated_at timestamptz,
    totp_verified_at timestamptz,
    user_agent_summary text,
    ip_hash text
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_created_idx
    ON auth_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
    ON auth_sessions (user_id, audience, expires_at)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
    ON auth_sessions (expires_at);
