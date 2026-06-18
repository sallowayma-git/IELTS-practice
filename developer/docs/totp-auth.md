# TOTP 2FA notes

- Password remains the first login factor. TOTP is a second factor after a valid username and password.
- Normal users can enable or disable TOTP from the account panel.
- Admin users must enable TOTP before the admin page or admin API can be used.
- Enabling TOTP returns one-time recovery codes. Store them outside the app; they are only displayed once.
- If the admin loses both authenticator access and recovery codes, set `ADMIN_RESET_TOTP=true`, run bootstrap admin, then log in again and bind TOTP.
- TOTP works on localhost and onion access because it does not depend on WebAuthn browser APIs.
