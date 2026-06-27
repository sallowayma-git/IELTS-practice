ALTER TABLE auth_handoff_tickets
    ADD COLUMN IF NOT EXISTS verifier_hash text;

CREATE INDEX IF NOT EXISTS auth_handoff_tickets_verifier_idx
    ON auth_handoff_tickets (verifier_hash);
