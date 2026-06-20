ALTER TABLE user_totp_settings
    ADD COLUMN IF NOT EXISTS last_totp_step bigint;

ALTER TABLE user_totp_settings
    DROP CONSTRAINT IF EXISTS user_totp_settings_last_totp_step_nonnegative;

ALTER TABLE user_totp_settings
    ADD CONSTRAINT user_totp_settings_last_totp_step_nonnegative
    CHECK (last_totp_step IS NULL OR last_totp_step >= 0);
