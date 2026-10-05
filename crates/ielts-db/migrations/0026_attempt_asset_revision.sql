-- NULL is intentional: historical submissions have no trustworthy revision.
ALTER TABLE attempts ADD COLUMN submitted_asset_fingerprint TEXT;
