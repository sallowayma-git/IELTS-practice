ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
