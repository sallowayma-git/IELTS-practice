DROP TABLE IF EXISTS user_passkeys;

CREATE TABLE IF NOT EXISTS user_totp_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_encrypted text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    confirmed_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_totp_recovery_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_totp_recovery_codes_user_idx
    ON user_totp_recovery_codes (user_id);

CREATE INDEX IF NOT EXISTS user_totp_recovery_codes_unused_idx
    ON user_totp_recovery_codes (user_id)
    WHERE used_at IS NULL;

DROP TRIGGER IF EXISTS user_totp_settings_set_updated_at ON user_totp_settings;
CREATE TRIGGER user_totp_settings_set_updated_at
BEFORE UPDATE ON user_totp_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
