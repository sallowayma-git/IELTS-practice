CREATE TABLE IF NOT EXISTS soul_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  preference_key TEXT NOT NULL CHECK(preference_key LIKE 'soul.%'),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  actor TEXT NOT NULL CHECK(actor IN ('model','user','undo')),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  reason TEXT NOT NULL,
  run_id TEXT REFERENCES dream_runs(id),
  reverts_id TEXT REFERENCES soul_revisions(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS soul_revisions_user_time ON soul_revisions(user_id,created_at);
