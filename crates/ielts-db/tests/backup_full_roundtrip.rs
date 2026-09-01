use ielts_db::{
    create_backup_package, import_backup, list_ai_configs,
    list_ai_configs_with_secret_availability, migrate, open_connection, put_secret_ref,
    reconcile_default_ai_config_with_secret_availability, set_default_ai_config, upsert_ai_config,
    upsert_setting, validate_backup, DbOpenOptions,
};
use ielts_domain::dto::{AiConfigDto, BackupPackage, BackupSqlValue};
use rusqlite::Connection;
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_v2(path: impl Into<std::path::PathBuf>) -> Connection {
    let mut conn = open_connection(&DbOpenOptions::create(path.into())).unwrap();
    migrate(&mut conn).unwrap();
    conn
}

const MEMORY_TABLES: &[&str] = &[
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
];

const COACH_FEEDBACK_TABLES: &[&str] = &[
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
];

const M7_TABLES: &[&str] = &[
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
];

const M8_TABLES: &[&str] = &[
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
];

const M10_TABLES: &[&str] = &[
    "teaching_strategy_catalog",
    "teaching_strategy_assignments",
    "teaching_strategy_feedback",
    "teaching_strategy_outcomes",
    "user_strategy_state",
    "strategy_candidate_batches",
    "strategy_candidate_evaluations",
];

const M11_TABLES: &[&str] = &[
    "prompt_templates",
    "prompt_versions",
    "skill_definitions",
    "skill_versions",
    "eval_cases",
    "candidate_promotions",
    "eval_runs",
    "eval_results",
    "shadow_runs",
];

const M12_TABLES: &[&str] = &[
    "agent_threads",
    "agent_messages",
    "agent_checkpoints",
    "study_plans",
    "study_plan_items",
    "agent_action_approvals",
];

fn is_memory_table(name: &str) -> bool {
    MEMORY_TABLES.contains(&name)
}

fn is_coach_feedback_table(name: &str) -> bool {
    COACH_FEEDBACK_TABLES.contains(&name)
}

fn is_m7_table(name: &str) -> bool {
    M7_TABLES.contains(&name)
}

fn is_m8_table(name: &str) -> bool {
    M8_TABLES.contains(&name)
}

fn is_m10_table(name: &str) -> bool {
    M10_TABLES.contains(&name)
}

fn is_m11_table(name: &str) -> bool {
    M11_TABLES.contains(&name)
}

fn is_m12_table(name: &str) -> bool {
    M12_TABLES.contains(&name)
}

fn is_newer_than_legacy(name: &str) -> bool {
    is_memory_table(name)
        || is_coach_feedback_table(name)
        || is_m7_table(name)
        || is_m8_table(name)
        || is_m10_table(name)
        || is_m11_table(name)
        || is_m12_table(name)
}

fn seed_complete_user_state(conn: &Connection) {
    conn.execute_batch(
        r#"
        INSERT INTO practice_assets (
          id, activity, source_kind, source_key, title, category, difficulty, frequency,
          content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
        ) VALUES
          ('asset-reading', 'reading', 'imported', 'reading:1', 'Reading One', 'P1', 'medium', 'high',
           'C:/fixtures/reading.json', 2, 'fp-reading', 0, '{"revision":2}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
          ('asset-writing', 'writing', 'freeform', 'writing:1', 'Writing One', NULL, NULL, NULL,
           NULL, 2, 'fp-writing', 0, '{"taskType":"task2"}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

        INSERT INTO writing_topics (
          asset_id, task_type, title_json, image_path, is_official, created_at, updated_at
        ) VALUES (
          'asset-writing', 'task2', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Writing One"}]}]}',
          NULL, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        );

        INSERT INTO reading_suites (
          id, mode, flow_mode, status, current_index, timer_policy_json, created_at, updated_at,
          frequency_scope, seed, aggregate_json, completed_at, timer_state_json
        ) VALUES (
          'suite-1', 'suite', 'linear', 'active', 0, '{"limitMs":3600000}',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', 'all', 'seed-1',
          '{"correct":1}', NULL, '{"elapsedMs":1234,"running":true}'
        );

        INSERT INTO attempts (
          id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
          duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
          prompt_snapshot, content_text, schema_version, created_at, updated_at
        ) VALUES
          ('r1', 'reading', 'asset-reading', 'suite', 'suite-1', 'completed',
           '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', '2026-01-01T00:10:00Z',
           600000, 1.0, 'ratio', 1.0, 1, 'Reading One', NULL, NULL, 2,
           '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'),
          ('w1', 'writing', 'asset-writing', 'bank', NULL, 'completed',
           '2026-01-02T00:00:00Z', '2026-01-02T00:40:00Z', '2026-01-02T00:41:00Z',
           2400000, 7.0, 'band9', NULL, NULL, 'Writing One', 'Discuss both views', 'Essay body', 2,
           '2026-01-02T00:00:00Z', '2026-01-02T00:41:00Z'),
          ('m1', 'reading', 'asset-reading', 'memorize', NULL, 'active',
           '2026-01-03T00:00:00Z', NULL, NULL, 1200, NULL, NULL, NULL, 1, 'Memorize One', NULL, NULL, 2,
           '2026-01-03T00:00:00Z', '2026-01-03T00:00:01Z');

        INSERT INTO attempt_answers (
          attempt_id, question_id, answer_json, is_correct, weight, question_kind,
          change_count, visit_count, elapsed_ms, marked, answered_at
        ) VALUES ('r1', 'q1', '"A"', 1, 1.0, 'choice', 2, 3, 4567, 1, '2026-01-01T00:09:00Z');

        INSERT INTO attempt_annotations (
          id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text, created_at, updated_at
        ) VALUES (
          'ann-1', 'r1', 'asset-reading', 'question', 'q1', 'note', '{"start":2,"end":4}',
          'why A?', '2026-01-01T00:05:00Z', '2026-01-01T00:06:00Z'
        );

        INSERT INTO writing_evaluations (
          id, attempt_id, status, stage, provider_id, model, rubric_version, prompt_version,
          result_json, degradation_json, error_json, started_at, completed_at, updated_at
        ) VALUES (
          'eval-1', 'w1', 'completed', 'done', 'openai', 'gpt-test', 'rubric-4', 'prompt-2',
          '{"overallBand":7.0,"feedback":"clear"}', '[]', NULL,
          '2026-01-02T00:40:00Z', '2026-01-02T00:41:00Z', '2026-01-02T00:41:00Z'
        );

        INSERT INTO writing_drafts (
          attempt_id, content_text, prompt_snapshot, task_type, word_count, idempotency_key, updated_at
        ) VALUES ('w1', 'Essay body', 'Discuss both views', 'task2', 2, 'draft-key-1', '2026-01-02T00:39:00Z');

        INSERT INTO attempt_idempotency (
          scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at
        ) VALUES (
          'writing.submit', 'submit-key-1', 'w1', 'eval-1', '{"evaluationId":"eval-1"}', '2026-01-02T00:40:00Z'
        );

        INSERT INTO evaluation_sessions (
          id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
          cancel_requested, provider_id, model, started_at, updated_at, completed_at
        ) VALUES (
          'session-1', 'w1', 'eval-1', 'completed', 'done', 1, 2, NULL, 0,
          'openai', 'gpt-test', '2026-01-02T00:40:00Z', '2026-01-02T00:41:00Z', '2026-01-02T00:41:00Z'
        );

        INSERT INTO evaluation_checkpoints (evaluation_id, stage, revision, payload_json, created_at)
        VALUES ('eval-1', 'scored', 1, '{"band":7}', '2026-01-02T00:40:30Z');

        INSERT INTO evaluation_events (
          evaluation_id, sequence, revision, event_type, stage, payload_json, created_at
        ) VALUES ('eval-1', 1, 1, 'progress', 'scored', '{"percent":80}', '2026-01-02T00:40:30Z');

        INSERT INTO evaluation_lineage (
          evaluation_id, attempt_id, retry_of, root_evaluation_id, created_at
        ) VALUES ('eval-1', 'w1', NULL, 'eval-1', '2026-01-02T00:40:00Z');

        INSERT INTO reading_suite_items (
          suite_id, item_index, asset_id, attempt_id, status, title, category, submitted_at, score_json
        ) VALUES (
          'suite-1', 0, 'asset-reading', 'r1', 'completed', 'Reading One', 'P1',
          '2026-01-01T00:10:00Z', '{"correct":1,"total":1}'
        );

        INSERT INTO endless_sessions (
          id, status, pool_policy_json, pool_json, current_asset_id, current_attempt_id,
          completed_asset_ids_json, created_at, updated_at
        ) VALUES (
          'endless-1', 'active', '{"frequency":"all"}', '["asset-reading"]',
          'asset-reading', 'r1', '["asset-reading"]', '2026-01-04T00:00:00Z', '2026-01-04T00:01:00Z'
        );

        INSERT INTO mode_idempotency (scope, idempotency_key, entity_id, response_json, created_at)
        VALUES
          ('memorize_submit', 'memorize-key-1', 'm1', '{"revealed":true}', '2026-01-03T00:01:00Z'),
          ('timer_pause', 'timer-key-1', 'suite-1', '{"elapsedMs":1234}', '2026-01-01T00:01:00Z');

        INSERT INTO coach_threads (
          id, attempt_id, asset_id, status, created_at, updated_at, kind, last_error_json
        ) VALUES (
          'thread-1', 'r1', 'asset-reading', 'active', '2026-01-05T00:00:00Z',
          '2026-01-05T00:01:00Z', 'chat', NULL
        );

        INSERT INTO coach_messages (
          id, thread_id, role, content, structured_payload, status, created_at, sequence
        ) VALUES
          ('message-1', 'thread-1', 'user', 'Why A?', '{"questionId":"q1"}', 'completed', '2026-01-05T00:00:10Z', 1),
          ('message-2', 'thread-1', 'assistant', 'Because the passage says so.', NULL, 'completed', '2026-01-05T00:00:20Z', 2);

        INSERT INTO agent_runs (
          id, provider_id, model, status, rounds, tool_call_count, result_json, error_json,
          created_at, updated_at, completed_at
        ) VALUES (
          'agent-run-1', 'openai-compatible', 'gpt-test', 'completed', 2, 1,
          '{"model":"gpt-test","hasContent":true}', NULL,
          '2026-01-05T01:00:00Z', '2026-01-05T01:00:02Z', '2026-01-05T01:00:02Z'
        );

        INSERT INTO agent_tool_calls (
          run_id, call_id, sequence, round_index, tool_name, status, arguments_json,
          result_json, error_json, started_at, completed_at
        ) VALUES (
          'agent-run-1', 'tool-call-1', 1, 1, 'read_file', 'succeeded',
          '{"path":"notes.txt"}', '{"path":"notes.txt","bytes":5,"sha256":"abc"}', NULL,
           '2026-01-05T01:00:01Z', '2026-01-05T01:00:01Z'
         );

        INSERT INTO explicit_user_preferences (
          user_id, preference_key, scope, value_json, status, source, created_at, updated_at
        ) VALUES (
          'local', 'teaching.show_answer_timing', 'global', '"conclusion_first"',
          'active', 'user', '2026-01-05T02:00:00Z', '2026-01-05T02:00:00Z'
        );

        INSERT INTO memory_items (
          id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
          content, status, source_class, confidence, importance, source_trust,
          sensitivity, improvement_state, first_observed_at, last_observed_at,
          version, created_by, created_run_id, content_hash, created_at, updated_at
        ) VALUES (
          'mem-fixture-1', 'local', 'strategy', 'activity:reading', 'procedural',
          'strategy.reading.local_evidence', 'local evidence',
          'Check local evidence before committing.', 'active', 'observed', 0.8, 0.7, 1.0,
          'normal', 'baseline', '2026-01-05T02:00:00Z', '2026-01-05T02:00:00Z',
          1, 'system', 'agent-run-1', 'memory-hash-1',
          '2026-01-05T02:00:00Z', '2026-01-05T02:00:00Z'
        );

        INSERT INTO memory_candidate_batches (
          id, request_id, user_id, schema_version, source_class,
          observation_projector_key, observation_projector_version, payload_hash,
          proposal_count, status, run_id, created_at, updated_at
        ) VALUES (
          'mcbat-fixture-1', 'request-fixture-1', 'local', 1, 'inferred',
          'learning-observations-v1', 2, 'batch-hash-1', 1, 'accepted',
          'agent-run-1', '2026-01-05T02:00:00Z', '2026-01-05T02:00:00Z'
        );

        INSERT INTO memory_candidates (
          id, batch_id, proposal_index, action, target_memory_id,
          expected_target_version, namespace, canonical_key, normalized_label, scope,
          proposed_statement, source_class, disposition, evidence_observation_ids_json,
          evidence_snapshot_json, issues_json, proposal_json, payload_hash, version,
          resolved_memory_id, created_at, updated_at
        ) VALUES (
          'mcand-fixture-1', 'mcbat-fixture-1', 0, 'ADD', NULL, NULL, 'strategy',
          'strategy.reading.local_evidence', 'local evidence', 'activity:reading',
          'Check local evidence before committing.', 'inferred', 'promoted', '["obs-fixture-1"]',
          '[{"id":"obs-fixture-1","fingerprint":"obs-fingerprint-1"}]', '[]',
          '{"action":"ADD"}', 'candidate-hash-1', 2, 'mem-fixture-1',
          '2026-01-05T02:00:00Z', '2026-01-05T02:01:00Z'
        );

        INSERT INTO memory_evidence (
          memory_id, observation_id, source_fingerprint, projector_key, projector_version,
          evidence_role, event_ids_json, evidence_hash, created_at
        ) VALUES (
          'mem-fixture-1', 'obs-fixture-1', 'obs-fingerprint-1',
          'learning-observations-v1', 2, 'support', '["event-fixture-1"]',
          'evidence-hash-1', '2026-01-05T02:01:00Z'
        );

        INSERT INTO memory_mutations (
          id, memory_id, candidate_id, operation, actor_type, actor_id, run_id,
          before_json, after_json, reason, created_at
        ) VALUES (
          'mmut-fixture-1', 'mem-fixture-1', 'mcand-fixture-1', 'promote',
          'agent', 'memory-resolver', 'agent-run-1', NULL,
          '{"status":"active","version":1}', 'fixture promotion', '2026-01-05T02:01:00Z'
        );

        INSERT INTO background_jobs (
          id, job_kind, user_id, status, priority, scheduled_at, locked_at, locked_by,
          heartbeat_at, attempts, max_attempts, dedupe_key, last_error, checkpoint_json,
          created_at, updated_at
        ) VALUES (
          'job-fixture-1', 'daily_journal', 'local', 'completed', 1,
          '2026-01-05T00:00:00Z', '2026-01-05T00:00:05Z', 'worker-1',
          '2026-01-05T00:00:30Z', 1, 3, 'daily_journal:local:2026-01-05', NULL, NULL,
          '2026-01-05T00:00:00Z', '2026-01-05T00:00:30Z'
        );

        INSERT INTO daily_journals (
          id, user_id, journal_date, version, status, facts_json, source_hash,
          rendered_markdown, superseded_by, created_at, updated_at
        ) VALUES (
          'djnl-fixture-1', 'local', '2026-01-05', 1, 'published',
          '{"attemptsCount":1}', 'source-hash-1', '# Daily Journal', NULL,
          '2026-01-05T00:00:30Z', '2026-01-05T00:00:30Z'
        );

        INSERT INTO daily_journal_sources (
          journal_id, source_kind, source_id, range_hash
        ) VALUES
          ('djnl-fixture-1', 'attempt', 'r1', 'range-hash-1'),
          ('djnl-fixture-1', 'event', 'event-fixture-1', 'range-hash-2');

        INSERT INTO dream_runs (
          id, user_id, journal_id, status, input_hash, output_hash, started_at,
          finished_at, error_json, attempts, created_at, updated_at
        ) VALUES (
          'drmrun-fixture-1', 'local', 'djnl-fixture-1', 'completed',
          'dream-input-1', 'dream-output-1', '2026-01-05T00:00:35Z',
          '2026-01-05T00:01:00Z', NULL, 1, '2026-01-05T00:00:35Z',
          '2026-01-05T00:01:00Z'
        );

        INSERT INTO dream_candidates (
          id, run_id, proposal_json, proposal_kind, target_memory_id,
          evidence_observation_ids_json, disposition, created_at
        ) VALUES (
          'dcand-fixture-1', 'drmrun-fixture-1', '{"kind":"REINFORCE"}', 'REINFORCE',
          'mem-fixture-1', '["obs-fixture-1"]', 'pending', '2026-01-05T00:01:00Z'
        );

        INSERT INTO memory_relations (
          id, source_memory_id, target_memory_id, relation_kind, created_at
        ) VALUES (
          'mrel-fixture-1', 'mem-fixture-1', 'mem-fixture-1', 'supports_consolidation',
          '2026-01-05T00:02:00Z'
        );

        INSERT INTO memory_feedback (
          id, memory_id, feedback_kind, user_id, payload_json, created_at
        ) VALUES (
          'mfb-fixture-1', 'mem-fixture-1', 'acknowledged', 'local', '{"note":"seen"}',
          '2026-01-05T00:03:00Z'
        );

        INSERT INTO memory_capacity_state (memory_kind, state_json, updated_at) VALUES
          ('strategy', '{"policy":"medium","archiveAfterDays":60}', '2026-01-05T00:04:00Z'),
          ('behavior', '{"policy":"fast","archiveAfterDays":21}', '2026-01-05T00:04:00Z')
        ON CONFLICT(memory_kind) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at;

        INSERT INTO prompt_templates (id, module_name, description, created_at)
        VALUES ('pt-fixture-1', 'attempt_review', 'Attempt review prompt', '2026-01-08T00:00:00Z');

        INSERT INTO prompt_versions (
          id, template_id, version, content_hash, content_text,
          prompt_metadata_json, status, created_by, created_at
        ) VALUES (
          'pv-fixture-1', 'pt-fixture-1', 1, 'pv-hash-1', 'Review this attempt.',
          '{"version":"1"}', 'active', 'system', '2026-01-08T00:00:01Z'
        );

        INSERT INTO skill_definitions (id, skill_name, description, created_at)
        VALUES ('sd-fixture-1', 'read_attempt_evidence', 'Read attempt evidence', '2026-01-08T00:00:02Z');

        INSERT INTO skill_versions (
          id, skill_definition_id, version, definition_json, status, created_by, created_at
        ) VALUES (
          'sv-fixture-1', 'sd-fixture-1', 1, '{"steps":["read"]}', 'active', 'system',
          '2026-01-08T00:00:03Z'
        );

        INSERT INTO eval_cases (id, case_kind, input_json, expected_json, holdout)
        VALUES (
          'ec-fixture-1', 'context_selection', '{"query":"test"}', '{"answer":"ok"}', 0
        );

        INSERT INTO candidate_promotions (
          id, target_kind, target_version_id, proposal_json, status,
          proposed_by, approved_by, created_at, updated_at
        ) VALUES (
          'cp-fixture-1', 'prompt', 'pv-fixture-1', '{"reason":"baseline"}', 'promoted',
          'system', 'release-manager', '2026-01-08T00:00:04Z', '2026-01-08T00:00:05Z'
        );

        INSERT INTO eval_runs (
          id, candidate_promotion_id, status, metrics_json, started_at,
          finished_at, error_json, created_at
        ) VALUES (
          'er-fixture-1', 'cp-fixture-1', 'completed', '{"allPassed":true}',
          '2026-01-08T00:00:04Z', '2026-01-08T00:00:05Z', NULL, '2026-01-08T00:00:04Z'
        );

        INSERT INTO eval_results (id, eval_run_id, case_id, passed, score, grading_json)
        VALUES ('erl-fixture-1', 'er-fixture-1', 'ec-fixture-1', 1, 1.0, '{"grade":"ok"}');

        INSERT INTO shadow_runs (
          id, candidate_promotion_id, input_hash, output_diff_json,
          no_user_visible_side_effect, created_at
        ) VALUES (
          'shr-fixture-1', 'cp-fixture-1', 'input-hash-1', '{"diff":"none"}', 1,
          '2026-01-08T00:00:06Z'
        );

        INSERT INTO vocabulary_items (
          id, term, normalized_term, definition, phonetic, part_of_speech, example,
          source_asset_id, source_attempt_id, tags_json, created_at, updated_at
        ) VALUES (
          'vocab-1', 'Atlas', 'atlas', 'a book of maps', '/atlas/', 'noun', 'Open the atlas.',
          'asset-reading', 'r1', '["reading"]', '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z'
        );

        INSERT INTO vocabulary_review_state (
          item_id, ease, interval_days, repetitions, due_at, last_reviewed_at, lapses
        ) VALUES ('vocab-1', 2.6, 3, 2, '2026-01-09T00:00:00Z', '2026-01-06T00:00:00Z', 1);

        INSERT INTO dictionary_entries (
          term, normalized_term, definition, phonetic, part_of_speech, example, source_label, license, payload_json
        ) VALUES ('atlas', 'atlas', 'a book of maps', '/atlas/', 'noun', 'Open the atlas.', 'fixture', 'CC0', '{"rank":1}');

        INSERT INTO settings (namespace, key, value_json, updated_at)
        VALUES
          ('ui', 'theme', '"dark"', '2026-01-07T00:00:00Z'),
          ('ai', 'secretName', '"ai.config.primary"', '2026-01-07T00:00:01Z'),
          ('ai', 'config:primary', '{"id":"primary","hasSecret":false}', '2026-01-07T00:00:02Z');

        INSERT INTO migration_meta (key, value) VALUES ('legacy_import_complete', 'true');

        INSERT INTO agent_threads (
          id, user_id, thread_kind, title, summary, sequence, last_message_at,
          status, created_at, updated_at
        ) VALUES (
          'at-fixture-1', 'local', 'workspace', 'Plan my week', 'rolling summary',
          2, '2026-01-09T00:00:20Z', 'active', '2026-01-09T00:00:00Z', '2026-01-09T00:00:20Z'
        );

        INSERT INTO agent_messages (
          id, thread_id, role, sequence, content, payload_json, created_at
        ) VALUES
          ('am-fixture-1', 'at-fixture-1', 'user', 1, 'What should I practice?', NULL, '2026-01-09T00:00:10Z'),
          ('am-fixture-2', 'at-fixture-1', 'assistant', 2, 'Focus on matching headings.', '{"runId":"agent-run-1"}', '2026-01-09T00:00:20Z');

        INSERT INTO agent_checkpoints (id, thread_id, run_id, stage, payload_json, created_at)
        VALUES ('acp-fixture-1', 'at-fixture-1', 'agent-run-1', 'model_response', '{"ctx":"built"}', '2026-01-09T00:00:15Z');

        INSERT INTO study_plans (id, user_id, goal, available_minutes, target_date, created_at, updated_at)
        VALUES ('sp-fixture-1', 'local', 'improve reading', 30, '2026-02-01', '2026-01-09T00:00:00Z', '2026-01-09T00:00:00Z');

        INSERT INTO study_plan_items (id, plan_id, skill_probe, why_text, estimated_minutes, done, created_at)
        VALUES ('spi-fixture-1', 'sp-fixture-1', 'reading.matching_headings', 'heading weakness', 15, 0, '2026-01-09T00:00:01Z');

        INSERT INTO agent_action_approvals (
          id, thread_id, action_kind, payload_json, status, approved_by, created_at, decided_at
        ) VALUES (
          'aaa-fixture-1', 'at-fixture-1', 'bulk_archive', '{"scope":"reading"}', 'pending',
          NULL, '2026-01-09T00:00:30Z', NULL
        );
        "#,
    )
    .unwrap();
    put_secret_ref(conn, "ai.config.primary", "kv:fixture:primary").unwrap();
}

fn rechecksum(package: &mut BackupPackage) {
    package.manifest.checksum_sha256.clear();
    let bytes = serde_json::to_vec(package).unwrap();
    package.manifest.checksum_sha256 = hex::encode(Sha256::digest(bytes));
}

#[test]
fn full_backup_roundtrip_preserves_every_user_truth_table() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("source.db"));
    seed_complete_user_state(&source);
    source
        .execute(
            "INSERT INTO reading_timer_states(scope, owner_id, state_json, updated_at)
             VALUES ('attempt', 'r1', ?1, '2026-07-17T00:00:00Z')",
            [json!({
                "source": "single",
                "anchorMs": 1_000,
                "effectiveStartTimeMs": 1_000,
                "mode": "elapsed",
                "pausedOffsetMs": 0,
                "pausedAtMs": 6_000,
                "running": false
            })
            .to_string()],
        )
        .unwrap();

    let package = create_backup_package(&source, "roundtrip-test").unwrap();
    assert_eq!(package.manifest.schema_version, 16);
    assert_eq!(
        package.manifest.table_count as usize,
        package.database.len()
    );
    assert_eq!(package.manifest.secret_ref_count, 1);
    assert!(package
        .attempts
        .iter()
        .find(|attempt| attempt.id == "r1")
        .is_some_and(|attempt| attempt.answers.len() == 1 && attempt.annotations.len() == 1));
    let serialized = serde_json::to_string(&package).unwrap();
    assert!(!serialized.contains("sk-plaintext-must-never-appear"));

    let target = open_v2(dir.path().join("target.db"));
    target
        .execute_batch(
            "INSERT INTO settings(namespace,key,value_json,updated_at)
             VALUES ('ui','sentinel','true','2026-01-01T00:00:00Z')",
        )
        .unwrap();
    let before_dry_run = create_backup_package(&target, "before-dry-run")
        .unwrap()
        .database;
    let dry_run = import_backup(&target, &package, true).unwrap();
    assert!(dry_run.ok, "{:?}", dry_run.errors);
    assert_eq!(dry_run.rows_imported, package.manifest.row_count);
    assert_eq!(
        create_backup_package(&target, "after-dry-run")
            .unwrap()
            .database,
        before_dry_run,
        "dry-run must leave the target byte-for-byte equivalent at the logical row level"
    );

    let restored = import_backup(&target, &package, false).unwrap();
    assert!(restored.ok, "{:?}", restored.errors);
    assert_eq!(restored.tables_imported, package.manifest.table_count);
    assert_eq!(restored.rows_imported, package.manifest.row_count);
    assert_eq!(
        target
            .query_row(
                "SELECT COUNT(*) FROM reading_timer_states WHERE scope='attempt' AND owner_id='r1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

    let target_package = create_backup_package(&target, "after-restore").unwrap();
    assert_eq!(target_package.database, package.database);
    assert_eq!(target_package.attempts, package.attempts);
    assert_eq!(target_package.settings, package.settings);
    assert_eq!(target_package.secret_refs, package.secret_refs);

    assert_eq!(
        target
            .query_row(
                "SELECT answer_json FROM attempt_answers WHERE attempt_id='r1' AND question_id='q1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "\"A\""
    );
    assert_eq!(
        target
            .query_row(
                "SELECT note_text FROM attempt_annotations WHERE id='ann-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "why A?"
    );
    let restored_evaluation: serde_json::Value = serde_json::from_str(
        &target
            .query_row(
                "SELECT result_json FROM writing_evaluations WHERE id='eval-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        restored_evaluation,
        json!({"overallBand": 7.0, "feedback": "clear"})
    );
    assert_eq!(
        target
            .query_row(
                "SELECT COUNT(*) FROM mode_idempotency WHERE scope IN ('memorize_submit','timer_pause')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2
    );
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM coach_messages", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        2
    );
    assert_eq!(
        target
            .query_row(
                "SELECT COUNT(*) FROM dream_candidates WHERE run_id='drmrun-fixture-1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    assert_eq!(
        target
            .query_row(
                "SELECT proposal_kind FROM dream_candidates WHERE id='dcand-fixture-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "REINFORCE"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT thread_kind FROM agent_threads WHERE id='at-fixture-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "workspace"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT COUNT(*) FROM agent_messages WHERE thread_id='at-fixture-1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2
    );
    assert_eq!(
        target
            .query_row(
                "SELECT action_kind FROM agent_action_approvals WHERE id='aaa-fixture-1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "bulk_archive"
    );
}

#[test]
fn failed_full_restore_rolls_back_without_polluting_target() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("source.db"));
    seed_complete_user_state(&source);
    let mut package = create_backup_package(&source, "rollback-test").unwrap();

    let attempts = package
        .database
        .iter_mut()
        .find(|table| table.name == "attempts")
        .unwrap();
    let status_index = attempts
        .columns
        .iter()
        .position(|column| column == "status")
        .unwrap();
    attempts.rows[0][status_index] = BackupSqlValue::Null;
    rechecksum(&mut package);

    let target = open_v2(dir.path().join("target.db"));
    target
        .execute_batch(
            "INSERT INTO settings(namespace,key,value_json,updated_at)
             VALUES ('ui','sentinel','\"keep\"','2026-01-01T00:00:00Z')",
        )
        .unwrap();
    let before = create_backup_package(&target, "before").unwrap().database;

    let report = import_backup(&target, &package, false).unwrap();
    assert!(!report.ok);
    assert!(!report.errors.is_empty());
    assert_eq!(
        create_backup_package(&target, "after").unwrap().database,
        before
    );
}

#[test]
fn legacy_v1_package_is_read_explicitly_as_partial_compatibility_import() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("source.db"));
    seed_complete_user_state(&source);
    let current = create_backup_package(&source, "legacy-source").unwrap();
    let mut legacy_attempt = current
        .attempts
        .iter()
        .find(|attempt| attempt.id == "w1")
        .unwrap()
        .clone();
    legacy_attempt.asset_id = None;
    legacy_attempt.annotations.clear();

    let legacy_json = json!({
        "manifest": {
            "schemaVersion": 1,
            "createdAt": "2025-01-01T00:00:00Z",
            "appVersion": "legacy",
            "includesSecrets": false,
            "attemptCount": 1,
            "settingsCount": 1,
            "secretRefCount": 0,
            "checksumSha256": ""
        },
        "attempts": [legacy_attempt],
        "settings": [current.settings[0].clone()],
        "secretRefs": []
    });
    let legacy: BackupPackage = serde_json::from_value(legacy_json).unwrap();
    assert!(legacy.database.is_empty());

    let target = open_v2(dir.path().join("target.db"));
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert!(report
        .warnings
        .iter()
        .any(|warning| warning.contains("incomplete")));
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM attempts WHERE id='w1'", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
}

#[test]
fn legacy_v2_snapshot_without_writing_topics_remains_restorable() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("source.db"));
    seed_complete_user_state(&source);
    let mut legacy = create_backup_package(&source, "v2-source").unwrap();

    legacy.manifest.schema_version = 2;
    legacy.manifest.database_schema_version = 5;
    legacy.database.retain(|table| {
        table.name != "writing_topics"
            && table.name != "writing_prompts"
            && table.name != "history_retention_policy"
            && table.name != "reading_timer_states"
            && table.name != "agent_runs"
            && table.name != "agent_tool_calls"
            && table.name != "learning_events"
            && !is_newer_than_legacy(&table.name)
    });
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    rechecksum(&mut legacy);

    let target = open_v2(dir.path().join("target.db"));
    seed_complete_user_state(&target);
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(report.tables_imported, legacy.manifest.table_count);
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM writing_topics", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0,
        "a v2 backup has no topic projection and must not retain target-only rows"
    );
    assert_eq!(
        target
            .query_row(
                "SELECT COUNT(*) FROM practice_assets WHERE id = 'asset-writing'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
}

#[test]
fn legacy_v4_snapshot_projects_prompt_settings_inside_restore_transaction() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("prompt-v4-source.db"));
    upsert_setting(
        &source,
        "prompts",
        "legacy-task2",
        &json!({
            "id": "legacy-task2",
            "taskType": "task2",
            "version": "legacy-v4",
            "body": "RESTORED PROMPT POLICY",
            "isActive": true,
        }),
    )
    .unwrap();
    let mut legacy = create_backup_package(&source, "v4-prompt-source").unwrap();
    legacy.manifest.schema_version = 4;
    legacy.database.retain(|table| {
        table.name != "writing_prompts"
            && table.name != "reading_timer_states"
            && table.name != "agent_runs"
            && table.name != "agent_tool_calls"
            && table.name != "learning_events"
            && !is_newer_than_legacy(&table.name)
    });
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    rechecksum(&mut legacy);

    let target = open_v2(dir.path().join("prompt-v4-target.db"));
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(
        target
            .query_row(
                "SELECT body FROM writing_prompts WHERE id = 'legacy-task2' AND is_active = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        "RESTORED PROMPT POLICY"
    );
}

#[test]
fn legacy_v5_snapshot_without_reading_timers_remains_restorable() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("timer-v5-source.db"));
    seed_complete_user_state(&source);
    let mut legacy = create_backup_package(&source, "timer-v5-source").unwrap();
    legacy.manifest.schema_version = 5;
    legacy.manifest.database_schema_version = 9;
    legacy.database.retain(|table| {
        table.name != "reading_timer_states"
            && table.name != "agent_runs"
            && table.name != "agent_tool_calls"
            && table.name != "learning_events"
            && !is_newer_than_legacy(&table.name)
    });
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    rechecksum(&mut legacy);

    let target = open_v2(dir.path().join("timer-v5-target.db"));
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM reading_timer_states", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}

#[test]
fn legacy_v6_snapshot_without_agent_tables_remains_restorable() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("agent-v6-source.db"));
    seed_complete_user_state(&source);
    let mut legacy = create_backup_package(&source, "agent-v6-source").unwrap();
    legacy.manifest.schema_version = 6;
    legacy.manifest.database_schema_version = 10;
    legacy.database.retain(|table| {
        table.name != "agent_runs"
            && table.name != "agent_tool_calls"
            && table.name != "learning_events"
            && !is_newer_than_legacy(&table.name)
    });
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    rechecksum(&mut legacy);

    let target = open_v2(dir.path().join("agent-v6-target.db"));
    seed_complete_user_state(&target);
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(
        target
            .query_row("SELECT COUNT(*) FROM agent_runs", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0,
        "a v6 backup has no Agent audit rows and must not retain target-only rows"
    );
}

#[test]
fn legacy_v8_snapshot_remains_restorable_and_clears_target_memory() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("memory-v8-source.db"));
    seed_complete_user_state(&source);
    let mut legacy = create_backup_package(&source, "memory-v8-source").unwrap();
    legacy.manifest.schema_version = 8;
    legacy.manifest.database_schema_version = 13;
    legacy.database.retain(|table| !is_newer_than_legacy(&table.name));
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    rechecksum(&mut legacy);

    let target = open_v2(dir.path().join("memory-v8-target.db"));
    seed_complete_user_state(&target);
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    for table in MEMORY_TABLES.iter().chain(M7_TABLES.iter()) {
        let count = target
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        assert_eq!(count, 0, "legacy v8 restore must clear target-only {table}");
    }
}

#[test]
fn backup_rejects_dangling_agent_tool_call_reference() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("agent-reference-source.db"));
    seed_complete_user_state(&source);
    let mut package = create_backup_package(&source, "agent-reference-source").unwrap();
    let calls = package
        .database
        .iter_mut()
        .find(|table| table.name == "agent_tool_calls")
        .unwrap();
    let run_id = calls
        .columns
        .iter()
        .position(|column| column == "run_id")
        .unwrap();
    calls.rows[0][run_id] = BackupSqlValue::Text("missing-run".into());
    rechecksum(&mut package);

    let error = validate_backup(&package).unwrap_err();
    assert!(error
        .to_string()
        .contains("dangling reference agent_tool_calls.run_id=missing-run"));
}

#[test]
fn backup_creation_refuses_plaintext_secret_even_if_sql_bypassed_settings_api() {
    let dir = tempdir().unwrap();
    let conn = open_v2(dir.path().join("secret-leak.db"));
    conn.execute(
        "INSERT INTO settings(namespace,key,value_json,updated_at) VALUES ('ai','api_key',?1,?2)",
        rusqlite::params![
            serde_json::to_string("sk-plaintext-must-never-appear").unwrap(),
            "2026-01-01T00:00:00Z"
        ],
    )
    .unwrap();

    let error = create_backup_package(&conn, "secret-policy-test").unwrap_err();
    assert!(error.to_string().contains("secret material"));
}

#[test]
fn cross_device_restore_keeps_ai_reference_unavailable_until_key_is_reentered() {
    let dir = tempdir().unwrap();
    let source = open_v2(dir.path().join("source.db"));
    let config = AiConfigDto {
        id: "portable-openai".into(),
        config_name: "Portable OpenAI".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: false,
    };
    upsert_ai_config(&source, &config).unwrap();
    put_secret_ref(
        &source,
        "ai.config.portable-openai.api_key",
        "keyring:source-device-only",
    )
    .unwrap();
    let configured = list_ai_configs(&source).unwrap().pop().unwrap();
    set_default_ai_config(&source, Some(&configured)).unwrap();
    let package = create_backup_package(&source, "cross-device").unwrap();

    let serialized = serde_json::to_string(&package).unwrap();
    assert!(
        !serialized.contains("sk-"),
        "backups never carry API key bytes"
    );
    assert!(serialized.contains("keyring:source-device-only"));

    let target = open_v2(dir.path().join("target.db"));
    let report = import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);

    // A different device has no matching OS-vault entry. The copied reference
    // remains metadata for same-device recovery, but cannot grant runtime use.
    assert!(
        reconcile_default_ai_config_with_secret_availability(&target, |_| false)
            .unwrap()
            .is_none()
    );
    let configs = list_ai_configs_with_secret_availability(&target, |_| false).unwrap();
    assert_eq!(configs.len(), 1);
    assert!(!configs[0].has_secret);
    assert!(!configs[0].is_default);
}
