CREATE TABLE IF NOT EXISTS auth_handoff_tickets (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    audience text NOT NULL CHECK (audience IN ('business', 'admin')),
    return_to text NOT NULL,
    admin_totp_verified_at timestamptz,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_handoff_tickets_user_created_idx
    ON auth_handoff_tickets (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_handoff_tickets_expires_idx
    ON auth_handoff_tickets (expires_at);
