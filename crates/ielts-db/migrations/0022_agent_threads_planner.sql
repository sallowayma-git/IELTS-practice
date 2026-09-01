-- M12 General Agent Thread, Study Planner, and Controlled Action Gate.
--
-- The Agent Workspace upgrades from a debug/explicit dialog entry into a full
-- learning console: see, ask, plan, explain, and act under controlled-action
-- gates. This is the original v1.0 M2 capability, moved back, not deleted.
--
-- Three layers sit on top of the existing M0/M1 run-level audit (0011):
--   * thread-level (multi-run dialog container) — agent_threads/messages/checkpoints
--   * study planner proposal persistence — study_plans/study_plan_items
--   * controlled action approval gate — agent_action_approvals
--
-- Conventions: `IF NOT EXISTS` everywhere, JSON columns validated via
-- `json_valid`, CHECK constraints for enum dimensions. Fresh + previous
-- fixtures are exercised in tests; the backup roundtrip includes these
-- tables. `llm_invocations` already exists from M5; not duplicated here.

-- M12-01: agent thread. A thread is the logical container for a multi-run
-- dialog. `thread_kind` enumerates the workspace surfaces (study plan,
-- coach review, attempt review, etc.); `sequence` is the per-thread message
-- counter; `summary` is the assistant's rolling summary slot; `status`
-- supports active/archive lifecycle. `last_message_at` accelerates list
-- ordering without scanning the messages table.
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  thread_kind TEXT NOT NULL CHECK (thread_kind IN (
    'workspace',
    'study_plan',
    'coach_review',
    'attempt_review',
    'memory_manager'
  )),
  title TEXT NOT NULL,
  summary TEXT,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  last_message_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_threads_user_status
  ON agent_threads(user_id, status, last_message_at DESC);

-- M12-01: agent message. The append-only transcript of a thread. `role`
-- mirrors the agent conversation vocabulary (user/assistant/tool/system).
-- `payload_json` carries tool-call/context references; the canonical body
-- text stays in `content` so a backup never needs to dereference it.
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  content TEXT NOT NULL,
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, sequence),
  FOREIGN KEY (thread_id)
    REFERENCES agent_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_sequence
  ON agent_messages(thread_id, sequence);

-- M12-02: checkpoint. Captures the durable stage of a thread run so that an
-- interrupted run can be recovered after restart. `stage` is the state
-- machine: context_built -> model_response -> tool_before -> tool_after ->
-- waiting_approval -> final. `run_id` references agent_runs.id (no FK: a
-- checkpoint may be written before the run row is committed, and a thread
-- may have checkpoints without an agent run in the legacy workspace path).
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  run_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'context_built',
    'model_response',
    'tool_before',
    'tool_after',
    'waiting_approval',
    'final'
  )),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id)
    REFERENCES agent_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_thread_created
  ON agent_checkpoints(thread_id, created_at DESC);

-- M12-04: study plan. A planner proposal is first-class persisted state so
-- the user can accept, defer, or reject items across sessions. `goal` is the
-- user-stated objective; `available_minutes` and `target_date` are the
-- planner inputs. v1 only stores proposals; execution stays in the
-- application layer.
CREATE TABLE IF NOT EXISTS study_plans (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  available_minutes INTEGER NOT NULL CHECK (available_minutes >= 0),
  target_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_plans_user_created
  ON study_plans(user_id, created_at DESC);

-- M12-04: study plan item. `skill_probe` identifies the skill the item
-- targets (a skill probe, not a repeat of an original question — M12-05).
-- `why_text` is the planner's explanation; `done` is the user-visible
-- completion flag. Items are owned by a plan and cascade on plan delete.
CREATE TABLE IF NOT EXISTS study_plan_items (
  id TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT NOT NULL,
  skill_probe TEXT NOT NULL,
  why_text TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  done INTEGER NOT NULL CHECK (done IN (0, 1)) DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id)
    REFERENCES study_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan
  ON study_plan_items(plan_id, created_at);

-- M12-06: controlled action approval. The three-layer gate:
--   * allow (no approval): create_study_plan_draft, mark_plan_item_done,
--     archive_memory_with_user_confirmation, set_explicit_preference
--   * approval-gate (pending -> approved -> execute): bulk_archive,
--     reset_derived_memory, change_personalization_settings,
--     modify_long_term_plan
--   * forbidden (never offered; rejected by the reverse-RPC dispatcher):
--     direct_sql, arbitrary_filesystem, api_key_read,
--     production_prompt_mutation, schema_migration, silent_delete_history
-- The forbidden set is NOT a CHECK constraint here: those action_kinds are
-- rejected at the Rust authority boundary before persistence. The CHECK
-- enumerates only the allow + approval-gate kinds that may be persisted.
CREATE TABLE IF NOT EXISTS agent_action_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'create_study_plan_draft',
    'mark_plan_item_done',
    'archive_memory_with_user_confirmation',
    'set_explicit_preference',
    'bulk_archive',
    'reset_derived_memory',
    'change_personalization_settings',
    'modify_long_term_plan'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected'))
    DEFAULT 'pending',
  approved_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (thread_id)
    REFERENCES agent_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_action_approvals_status_created
  ON agent_action_approvals(status, created_at DESC);
