-- Record publication order, not version creation order. No legacy backfill:
-- an absent head means the historical predecessor is unknown, not empty.
CREATE TABLE prompt_skill_releases (
  id TEXT PRIMARY KEY NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('prompt', 'skill')),
  parent_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  predecessor_version_id TEXT,
  predecessor_release_id TEXT REFERENCES prompt_skill_releases(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES candidate_promotions(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (predecessor_version_id IS NULL OR predecessor_version_id != version_id),
  CHECK (predecessor_release_id IS NULL OR predecessor_version_id IS NOT NULL),
  UNIQUE (target_kind, parent_id, id)
);

CREATE TABLE prompt_skill_release_heads (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('prompt', 'skill')),
  parent_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  PRIMARY KEY (target_kind, parent_id),
  FOREIGN KEY (target_kind, parent_id, release_id)
    REFERENCES prompt_skill_releases(target_kind, parent_id, id) ON DELETE RESTRICT
);
