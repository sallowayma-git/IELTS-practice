CREATE TABLE IF NOT EXISTS traffic_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    session_id text,
    method text NOT NULL,
    path text NOT NULL,
    route_group text NOT NULL DEFAULT 'other',
    status_code integer NOT NULL,
    duration_ms integer NOT NULL DEFAULT 0,
    ip_hash text,
    user_agent text,
    referrer text
);

CREATE INDEX IF NOT EXISTS traffic_events_occurred_at_idx
    ON traffic_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS traffic_events_route_group_occurred_at_idx
    ON traffic_events (route_group, occurred_at DESC);

CREATE INDEX IF NOT EXISTS traffic_events_user_occurred_at_idx
    ON traffic_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS traffic_events_path_occurred_at_idx
    ON traffic_events (path, occurred_at DESC);
