-- NULL means "not yet classified"; backfilled by Rust after migration since
-- the classifier reads the referenced payload file, which SQL cannot do.
ALTER TABLE practice_assets ADD COLUMN question_kinds_json TEXT;
