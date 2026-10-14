//! M7-03 Daily Journal tests: deterministic facts, same-day rerun versioning,
//! source_hash stability, private memory redaction.

use ielts_db::{
    build_daily_facts, insert_journal, load_latest_journal, migrate, open_connection, DbOpenOptions,
};
use ielts_domain::{
    DailyJournalStatus, MemoryChangeSummary, SkillTrend, WritingEvalSummary, WritingEvaluationV4,
};
use rusqlite::params;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

const DAY: &str = "2026-08-16";

fn seed_attempt(conn: &rusqlite::Connection, id: &str, started_at: &str, duration_ms: i64) {
    conn.execute(
        "INSERT INTO attempts (
           id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
           completed_at, duration_ms, score_value, score_scale, correct_count,
           question_count, title_snapshot, prompt_snapshot, content_text, schema_version,
           created_at, updated_at
         ) VALUES (?1, 'reading', NULL, 'single', NULL, 'completed', ?2, ?2, ?2, ?3,
                   1.0, 'ratio', 1.0, 1, 'Title', NULL, NULL, 2, ?2, ?2)",
        params![id, started_at, duration_ms],
    )
    .unwrap();
}

fn seed_writing_eval(
    conn: &rusqlite::Connection,
    eval_id: &str,
    attempt_id: &str,
    overall_band: f64,
    completed_at: &str,
) {
    conn.execute(
        "INSERT INTO writing_evaluations (
           id, attempt_id, status, stage, provider_id, model, rubric_version,
           prompt_version, result_json, degradation_json, error_json, started_at,
           completed_at, updated_at
         ) VALUES (?1, ?2, 'completed', 'done', 'openai', 'gpt', 'rubric-1', 'prompt-1',
                   ?3, '[]', NULL, ?4, ?4, ?4)",
        params![
            eval_id,
            attempt_id,
            // Real persisted shape: a WritingEvaluationV4 with `score.overall`.
            serde_json::json!({
                "schemaVersion": 4,
                "id": eval_id,
                "status": "completed",
                "stage": "finalizing",
                "score": {
                    "overall": overall_band,
                    "taskResponse": overall_band,
                    "coherence": overall_band,
                    "lexical": overall_band,
                    "grammar": overall_band
                }
            })
            .to_string(),
            completed_at
        ],
    )
    .unwrap();
}

fn seed_coach_feedback(conn: &rusqlite::Connection, message_id: &str, created_at: &str) {
    // coach_feedback requires a coach_message; seed a minimal thread + message.
    conn.execute(
        "INSERT INTO coach_threads (id, attempt_id, asset_id, status, created_at, updated_at, kind, last_error_json)
         VALUES ('thread-1', NULL, NULL, 'active', ?1, ?1, 'chat', NULL)",
        [created_at],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO coach_messages (id, thread_id, role, content, structured_payload, status, created_at, sequence)
         VALUES (?1, 'thread-1', 'assistant', 'body', NULL, 'completed', ?2, 1)",
        params![message_id, created_at],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, payload_json, created_at)
         VALUES ('cfb-1', 'local', ?1, 'thumbs_up', NULL, ?2)",
        params![message_id, created_at],
    )
    .unwrap();
}

#[test]
fn deterministic_facts_exact_for_empty_day() {
    let (_dir, conn) = open_db();
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.journal_date, DAY);
    assert_eq!(facts.attempts_count, 0);
    assert_eq!(facts.writing_eval_summary.completed, 0);
    assert_eq!(facts.writing_eval_summary.degraded, 0);
    assert_eq!(facts.writing_eval_summary.average_band, None);
    assert!(facts.skill_deltas.is_empty());
    assert_eq!(facts.coach_feedback_count, 0);
    assert_eq!(facts.coach_reask_count, 0);
    assert_eq!(facts.time_spent_ms, 0);
    assert!(!facts.source_hash.is_empty());
}

#[test]
fn deterministic_facts_aggregate_attempts_and_time() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, "att-1", "2026-08-16T10:00:00Z", 600_000);
    seed_attempt(&conn, "att-2", "2026-08-16T11:00:00Z", 900_000);
    // An attempt outside the day must not be counted.
    seed_attempt(&conn, "att-3", "2026-08-17T10:00:00Z", 1_200_000);

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.attempts_count, 2);
    assert_eq!(facts.time_spent_ms, 1_500_000);
}

#[test]
fn deterministic_facts_aggregate_writing_evals() {
    let (_dir, conn) = open_db();
    // Need attempts for the FK.
    seed_attempt(&conn, "att-w1", "2026-08-16T10:00:00Z", 0);
    seed_attempt(&conn, "att-w2", "2026-08-16T11:00:00Z", 0);
    seed_writing_eval(&conn, "eval-1", "att-w1", 7.0, "2026-08-16T10:30:00Z");
    seed_writing_eval(&conn, "eval-2", "att-w2", 6.5, "2026-08-16T11:30:00Z");

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.writing_eval_summary.completed, 2);
    assert_eq!(facts.writing_eval_summary.degraded, 0);
    assert!((facts.writing_eval_summary.average_band.unwrap() - 6.75).abs() < 0.01);
}

#[test]
fn writing_eval_fixture_matches_persisted_dto() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, "att-w1", "2026-08-16T10:00:00Z", 0);
    seed_writing_eval(&conn, "eval-1", "att-w1", 7.0, "2026-08-16T10:30:00Z");
    let json: String = conn
        .query_row("SELECT result_json FROM writing_evaluations", [], |row| {
            row.get(0)
        })
        .unwrap();
    let parsed: WritingEvaluationV4 = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.score.unwrap().overall, 7.0);
}

#[test]
fn writing_eval_average_is_none_when_no_completed_eval_has_a_score() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, "att-w1", "2026-08-16T10:00:00Z", 0);
    seed_writing_eval(&conn, "eval-1", "att-w1", 7.0, "2026-08-16T10:30:00Z");
    // A completed evaluation without a score must not be averaged in as 0,
    // and alone must not produce a fake 0 average.
    conn.execute(
        r#"UPDATE writing_evaluations SET result_json = '{"schemaVersion":4}'"#,
        [],
    )
    .unwrap();
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.writing_eval_summary.completed, 1);
    assert_eq!(facts.writing_eval_summary.average_band, None);

    seed_attempt(&conn, "att-w2", "2026-08-16T11:00:00Z", 0);
    seed_writing_eval(&conn, "eval-2", "att-w2", 6.0, "2026-08-16T11:30:00Z");
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.writing_eval_summary.completed, 2);
    assert_eq!(facts.writing_eval_summary.average_band, Some(6.0));
}

fn seed_skill_obs(conn: &rusqlite::Connection, id: &str, skill: &str, outcome: f64, at: &str) {
    // Facts only read this projection; skip the event/catalog FKs.
    conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    conn.execute(
        "INSERT INTO learner_skill_observations (
           id, user_id, event_id, skill_key, outcome, mapping_weight, evidence_weight,
           novelty_weight, familiarity_weight, time_weight, error_type, context_json,
           observed_at, asset_id, question_id
         ) VALUES (?1, 'local', ?1, ?2, ?3, 1, 1, 1, 1, 1, NULL, '{}', ?4, 'asset', 'q')",
        params![id, skill, outcome, at],
    )
    .unwrap();
}

#[test]
fn skill_deltas_compare_today_with_prior_baseline_and_classify() {
    let (_dir, conn) = open_db();
    // improving: wrong before, right today.
    seed_skill_obs(&conn, "o1", "reading.improve", 0.0, "2026-08-10T10:00:00Z");
    seed_skill_obs(&conn, "o2", "reading.improve", 1.0, "2026-08-16T10:00:00Z");
    // recurring: failed before and fails again today.
    seed_skill_obs(&conn, "o3", "reading.recur", 0.0, "2026-08-10T10:00:00Z");
    seed_skill_obs(&conn, "o4", "reading.recur", 0.0, "2026-08-16T10:00:00Z");
    // recurring without history: failed twice today.
    seed_skill_obs(&conn, "o5", "reading.twice", 0.0, "2026-08-16T10:00:00Z");
    seed_skill_obs(&conn, "o6", "reading.twice", 0.0, "2026-08-16T11:00:00Z");
    // steady: first contact, one correct answer, no baseline.
    seed_skill_obs(&conn, "o7", "reading.new", 1.0, "2026-08-16T10:00:00Z");
    // steady: a single slip on a skill that never failed before.
    seed_skill_obs(&conn, "o8", "reading.slip", 1.0, "2026-08-10T10:00:00Z");
    seed_skill_obs(&conn, "o9", "reading.slip", 0.0, "2026-08-16T10:00:00Z");
    // Not practised today: no entry; tomorrow's observation is ignored.
    seed_skill_obs(&conn, "o10", "reading.old", 0.0, "2026-08-10T10:00:00Z");
    seed_skill_obs(&conn, "o11", "reading.improve", 0.0, "2026-08-17T10:00:00Z");

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    let got: Vec<(&str, f64, u64, SkillTrend)> = facts
        .skill_deltas
        .iter()
        .map(|d| (d.skill_key.as_str(), d.delta, d.evidence_count, d.trend))
        .collect();
    assert_eq!(
        got,
        vec![
            ("reading.improve", 1.0, 1, SkillTrend::Improving),
            ("reading.new", 0.0, 1, SkillTrend::Steady),
            ("reading.recur", 0.0, 1, SkillTrend::Recurring),
            ("reading.slip", -1.0, 1, SkillTrend::Steady),
            ("reading.twice", 0.0, 2, SkillTrend::Recurring),
        ]
    );

    // The trend survives persistence; legacy rows without it read as steady.
    insert_journal(&conn, "local", &facts, None).unwrap();
    let reloaded = load_latest_journal(&conn, "local", DAY).unwrap().unwrap();
    assert_eq!(reloaded.facts.skill_deltas, facts.skill_deltas);
    let legacy: ielts_domain::SkillDelta =
        serde_json::from_str(r#"{"skillKey":"s","delta":0.8,"evidenceCount":2}"#).unwrap();
    assert_eq!(legacy.trend, SkillTrend::Steady);
}

#[test]
fn deterministic_facts_aggregate_coach_feedback() {
    let (_dir, conn) = open_db();
    seed_coach_feedback(&conn, "cmsg-1", "2026-08-16T12:00:00Z");
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.coach_feedback_count, 1);
}

#[test]
fn source_hash_is_stable_for_same_input() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, "att-1", "2026-08-16T10:00:00Z", 600_000);
    let facts1 = build_daily_facts(&conn, "local", DAY).unwrap();
    let facts2 = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts1.source_hash, facts2.source_hash);
}

#[test]
fn source_hash_changes_when_input_changes() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, "att-1", "2026-08-16T10:00:00Z", 600_000);
    let facts1 = build_daily_facts(&conn, "local", DAY).unwrap();
    seed_attempt(&conn, "att-2", "2026-08-16T11:00:00Z", 900_000);
    let facts2 = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_ne!(facts1.source_hash, facts2.source_hash);
}

#[test]
fn same_day_rerun_creates_new_version_and_supersedes() {
    let (_dir, conn) = open_db();
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    let first = insert_journal(&conn, "local", &facts, Some("# V1")).unwrap();
    assert_eq!(first.version, 1);
    assert_eq!(first.status, DailyJournalStatus::Published);

    // Rerun: new facts (add an attempt) → new version, old superseded.
    seed_attempt(&conn, "att-1", "2026-08-16T10:00:00Z", 600_000);
    let facts2 = build_daily_facts(&conn, "local", DAY).unwrap();
    let second = insert_journal(&conn, "local", &facts2, Some("# V2")).unwrap();
    assert_eq!(second.version, 2);

    // The first journal is now superseded.
    let prev = load_latest_journal(&conn, "local", DAY).unwrap();
    // load_latest returns the highest version (the new one).
    assert_eq!(prev.as_ref().unwrap().version, 2);
    assert_eq!(prev.as_ref().unwrap().status, DailyJournalStatus::Published);

    // Verify the old row is superseded.
    let old_status: String = conn
        .query_row(
            "SELECT status FROM daily_journals WHERE id = ?1",
            params![first.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(old_status, "superseded");
    let superseded_by: String = conn
        .query_row(
            "SELECT superseded_by FROM daily_journals WHERE id = ?1",
            params![first.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(superseded_by, second.id);
}

#[test]
fn memory_changes_aggregate_by_operation() {
    let (_dir, conn) = open_db();
    // Seed a memory_item + candidate so the FK is valid.
    conn.execute(
        "INSERT INTO memory_items (
           id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
           content, status, source_class, confidence, importance, source_trust,
           sensitivity, improvement_state, version, created_by, content_hash,
           created_at, updated_at
         ) VALUES (
           'mem-1', 'local', 'strategy', 'activity:reading', 'procedural', 'key-1',
           'label-1', 'content', 'active', 'observed', 0.5, 0.5, 0.5, 'normal',
           'baseline', 1, 'system', 'hash-1', '2026-08-16T00:00:00Z',
           '2026-08-16T00:00:00Z'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_mutations (
           id, memory_id, candidate_id, operation, actor_type, actor_id, run_id,
           before_json, after_json, reason, created_at
         ) VALUES
           ('mmut-1', 'mem-1', NULL, 'promote', 'agent', 'a', NULL, NULL, NULL, 'r', '2026-08-16T01:00:00Z'),
           ('mmut-2', 'mem-1', NULL, 'reinforce', 'agent', 'a', NULL, NULL, NULL, 'r', '2026-08-16T02:00:00Z'),
           ('mmut-3', NULL, NULL, 'propose', 'agent', 'a', NULL, NULL, NULL, 'r', '2026-08-17T01:00:00Z')",
        [],
    )
    .unwrap();

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.memory_changes.promoted, 1);
    assert_eq!(facts.memory_changes.reinforced, 1);
    // mmut-3 is on the 17th, outside the day; propose is not counted.
    assert_eq!(facts.memory_changes.new_candidates, 0);
    // The MemoryChangeSummary default has all zeros; verify the shape.
    let _expected = MemoryChangeSummary::default();
}

#[test]
fn memory_events_carry_identity_and_past_tense_kinds() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO memory_items (
           id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
           content, status, source_class, confidence, importance, source_trust,
           sensitivity, improvement_state, version, created_by, content_hash,
           created_at, updated_at
         ) VALUES (
           'mem-evt-1', 'local', 'strategy', 'activity:reading', 'procedural', 'evt-key-1',
           'label-1', 'content', 'active', 'observed', 0.5, 0.5, 0.5, 'normal',
           'baseline', 1, 'system', 'hash-evt-1', '2026-08-16T00:00:00Z',
           '2026-08-16T00:00:00Z'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_mutations (
           id, memory_id, candidate_id, operation, actor_type, actor_id, run_id,
           before_json, after_json, reason, created_at
         ) VALUES ('mmut-evt-1', 'mem-evt-1', NULL, 'reinforce', 'agent', 'a', NULL,
                   NULL, NULL, 'r', '2026-08-16T01:00:00Z')",
        [],
    )
    .unwrap();

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.memory_events.len(), 1);
    let event = &facts.memory_events[0];
    assert_eq!(event.memory_id, "mem-evt-1");
    assert_eq!(event.namespace, "strategy");
    assert_eq!(event.canonical_key, "evt-key-1");
    // The DB operation is present-tense; the wire change_kind is past-tense.
    assert_eq!(event.change_kind, "reinforced");

    // The persisted facts_json round-trips the identity-bearing fields.
    let journal = insert_journal(&conn, "local", &facts, None).unwrap();
    let reloaded = load_latest_journal(&conn, "local", DAY).unwrap().unwrap();
    assert_eq!(reloaded.id, journal.id);
    assert_eq!(reloaded.facts.memory_events.len(), 1);
    assert_eq!(reloaded.facts.memory_events[0].canonical_key, "evt-key-1");
    assert_eq!(
        reloaded.facts.today_observation_ids,
        facts.today_observation_ids
    );
}

#[test]
fn memory_events_exclude_private_memories() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO memory_items (
           id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
           content, status, source_class, confidence, importance, source_trust,
           sensitivity, improvement_state, version, created_by, content_hash,
           created_at, updated_at
         ) VALUES
           ('mem-pub', 'local', 'strategy', 'activity:reading', 'procedural', 'public-key',
            'label', 'content', 'active', 'observed', 0.5, 0.5, 0.5, 'normal',
            'baseline', 1, 'system', 'hash-a', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z'),
           ('mem-priv-evt', 'local', 'preference', 'global', 'inferred_profile', 'evt-private-key',
            'label', 'content', 'active', 'inferred', 0.9, 0.9, 0.9, 'private',
            'baseline', 1, 'system', 'hash-b', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_mutations (
           id, memory_id, candidate_id, operation, actor_type, actor_id, run_id,
           before_json, after_json, reason, created_at
         ) VALUES
           ('mmut-pub', 'mem-pub', NULL, 'refine', 'agent', 'a', NULL, NULL, NULL, 'r', '2026-08-16T01:00:00Z'),
           ('mmut-priv-evt', 'mem-priv-evt', NULL, 'promote', 'agent', 'a', NULL, NULL, NULL, 'r', '2026-08-16T02:00:00Z')",
        [],
    )
    .unwrap();

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    let ids: Vec<&str> = facts
        .memory_events
        .iter()
        .map(|e| e.memory_id.as_str())
        .collect();
    assert_eq!(ids, vec!["mem-pub"]);
    let json = serde_json::to_string(&facts).unwrap();
    assert!(
        !json.contains("evt-private-key"),
        "private memory canonical_key leaked into memory_events: {json}"
    );
}

#[test]
fn today_observation_ids_scope_and_order() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO learner_observations (
           id, user_id, observation_type, namespace, scope_kind, scope_key, payload_json,
           confidence, evidence_strength, observed_at, projector_key, projector_version,
           source_fingerprint, created_at
         ) VALUES
           ('obs-in-1', 'local', 'outcome', 'strategy', 'activity', 'reading', '{}',
            1.0, 1.0, '2026-08-16T09:00:00Z', 'proj', 1, 'fp-1', '2026-08-16T09:00:00Z'),
           ('obs-in-2', 'local', 'outcome', 'strategy', 'activity', 'reading', '{}',
            1.0, 1.0, '2026-08-16T15:00:00Z', 'proj', 1, 'fp-2', '2026-08-16T15:00:00Z'),
           ('obs-out', 'local', 'outcome', 'strategy', 'activity', 'reading', '{}',
            1.0, 1.0, '2026-08-17T09:00:00Z', 'proj', 1, 'fp-3', '2026-08-17T09:00:00Z')",
        [],
    )
    .unwrap();

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    // Most-recent-first; the next-day observation is excluded.
    assert_eq!(facts.today_observation_ids, vec!["obs-in-2", "obs-in-1"]);
    // Persistence round-trips the list for Dream evidence (M7-06).
    insert_journal(&conn, "local", &facts, None).unwrap();
    let reloaded = load_latest_journal(&conn, "local", DAY).unwrap().unwrap();
    assert_eq!(
        reloaded.facts.today_observation_ids,
        vec!["obs-in-2", "obs-in-1"]
    );
}

#[test]
fn private_memory_redaction_no_content_in_facts() {
    let (_dir, conn) = open_db();
    // Insert a private memory item with sensitive content.
    conn.execute(
        "INSERT INTO memory_items (
           id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
           content, status, source_class, confidence, importance, source_trust,
           sensitivity, improvement_state, version, created_by, content_hash,
           created_at, updated_at
         ) VALUES (
           'mem-private-1', 'local', 'preference', 'global', 'inferred_profile',
           'private-key', 'private-label', 'SECRET PRIVATE CONTENT', 'active',
           'inferred', 0.9, 0.9, 0.9, 'private', 'baseline', 1, 'system', 'hash-priv',
           '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z'
         )",
        [],
    )
    .unwrap();
    // A mutation references the private memory.
    conn.execute(
        "INSERT INTO memory_mutations (
           id, memory_id, candidate_id, operation, actor_type, actor_id, run_id,
           before_json, after_json, reason, created_at
         ) VALUES ('mmut-priv', 'mem-private-1', NULL, 'promote', 'agent', 'a', NULL,
                   NULL, NULL, 'r', '2026-08-16T01:00:00Z')",
        [],
    )
    .unwrap();

    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    // The facts only contain counts, never the private content. Serialize and
    // verify the secret string never appears.
    let json = serde_json::to_string(&facts).unwrap();
    assert!(
        !json.contains("SECRET PRIVATE CONTENT"),
        "private memory content leaked into journal facts: {json}"
    );
    assert!(!json.contains("private-key"));
    // The promoted count still reflects the mutation.
    assert_eq!(facts.memory_changes.promoted, 1);
}

#[test]
fn writing_eval_summary_default() {
    let summary = WritingEvalSummary::default();
    assert_eq!(summary.completed, 0);
    assert_eq!(summary.degraded, 0);
    assert_eq!(summary.average_band, None);
}

fn seed_dream_memory(conn: &rusqlite::Connection, id: &str, user: &str) {
    conn.execute(
        "INSERT INTO memory_items (
         id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
         content, status, source_class, created_by, content_hash, created_at, updated_at
         ) VALUES (?1, ?2, 'strategy', 'activity:reading', 'procedural', ?1, 'label',
         'content', 'active', 'observed', 'system', ?1, '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
        params![id, user],
    ).unwrap();
    conn.execute(
        "INSERT INTO memory_mutations (id, memory_id, operation, actor_type, actor_id, reason, created_at)
         VALUES (?1, ?2, 'reinforce', 'agent', 'test', 'test', '2026-08-16T10:00:00Z')",
        params![format!("mmut-{id}"), id],
    ).unwrap();
}

#[test]
fn memory_changes_and_source_hash_are_scoped_to_memory_owner() {
    let (_dir, conn) = open_db();
    let local_before = build_daily_facts(&conn, "local", DAY).unwrap();

    seed_dream_memory(&conn, "mem-other", "other");
    let local_after_other = build_daily_facts(&conn, "local", DAY).unwrap();
    let other_before_local = build_daily_facts(&conn, "other", DAY).unwrap();
    assert_eq!(local_after_other.memory_changes.reinforced, 0);
    assert!(local_after_other.memory_events.is_empty());
    assert_eq!(local_after_other.source_hash, local_before.source_hash);
    assert_eq!(other_before_local.memory_changes.reinforced, 1);
    assert_eq!(other_before_local.memory_events.len(), 1);

    seed_dream_memory(&conn, "mem-local", "local");
    let local_with_own = build_daily_facts(&conn, "local", DAY).unwrap();
    let other_after_local = build_daily_facts(&conn, "other", DAY).unwrap();
    assert_eq!(local_with_own.memory_changes.reinforced, 1);
    assert_eq!(local_with_own.memory_events.len(), 1);
    assert_ne!(local_with_own.source_hash, local_before.source_hash);
    assert_eq!(other_after_local.memory_changes.reinforced, 1);
    assert_eq!(other_after_local.source_hash, other_before_local.source_hash);

    // A mutation with no memory owner cannot be attributed to either user.
    conn.execute(
        "INSERT INTO memory_mutations
         (id, memory_id, operation, actor_type, reason, created_at)
         VALUES ('mmut-unowned', NULL, 'reinforce', 'agent', 'test', '2026-08-16T10:00:00Z')",
        [],
    )
    .unwrap();
    let local_after_unowned = build_daily_facts(&conn, "local", DAY).unwrap();
    let other_after_unowned = build_daily_facts(&conn, "other", DAY).unwrap();
    assert_eq!(local_after_unowned.memory_changes.reinforced, 1);
    assert_eq!(other_after_unowned.memory_changes.reinforced, 1);
    assert_eq!(local_after_unowned.source_hash, local_with_own.source_hash);
    assert_eq!(other_after_unowned.source_hash, other_after_local.source_hash);
}

fn seed_dream_observation(conn: &rusqlite::Connection, id: &str, user: &str, at: &str) {
    conn.execute(
        "INSERT INTO learner_observations (
         id, user_id, observation_type, namespace, scope_kind, scope_key, payload_json,
         observed_at, projector_key, projector_version, source_fingerprint, created_at
         ) VALUES (?1, ?2, 'outcome', 'strategy', 'activity', 'reading', '{}', ?3, 'test', 1, ?1, ?3)",
        params![id, user, at],
    ).unwrap();
    if id == "obs-writing" {
        conn.execute(
            "UPDATE learner_observations SET scope_key = 'writing' WHERE id = ?1",
            [id],
        ).unwrap();
    }
}

fn link_dream_evidence(conn: &rusqlite::Connection, memory: &str, observation: &str) {
    conn.execute(
        "INSERT INTO memory_evidence (memory_id, observation_id, source_fingerprint,
         projector_key, projector_version, event_ids_json, evidence_hash, created_at)
         VALUES (?1, ?2, ?2, 'test', 1, '[]', 'hash', '2026-08-16T10:00:00Z')",
        params![memory, observation],
    )
    .unwrap();
}

#[test]
fn memory_event_evidence_is_linked_day_user_scoped_and_round_trips() {
    let (_dir, conn) = open_db();
    seed_dream_memory(&conn, "mem-reading", "local");
    seed_dream_memory(&conn, "mem-other", "other");
    for (id, user, at) in [
        ("obs-related", "local", "2026-08-16T09:00:00Z"),
        ("obs-writing", "local", "2026-08-16T15:00:00Z"),
        ("obs-old", "local", "2026-08-15T09:00:00Z"),
        ("obs-other", "other", "2026-08-16T09:00:00Z"),
        ("obs-offset", "local", "2026-08-16T00:30:00+01:00"),
    ] {
        seed_dream_observation(&conn, id, user, at);
    }
    let before = build_daily_facts(&conn, "local", DAY).unwrap();
    for id in ["obs-related", "obs-old", "obs-other", "obs-offset"] {
        link_dream_evidence(&conn, "mem-reading", id);
    }
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(facts.memory_events.len(), 1);
    assert_eq!(
        facts.memory_events[0].evidence_observation_ids,
        ["obs-related"]
    );
    assert_ne!(before.source_hash, facts.source_hash);
    insert_journal(&conn, "local", &facts, None).unwrap();
    assert_eq!(
        load_latest_journal(&conn, "local", DAY)
            .unwrap()
            .unwrap()
            .facts,
        facts
    );
    let mut legacy = serde_json::to_value(&facts).unwrap();
    legacy["memoryEvents"][0]
        .as_object_mut()
        .unwrap()
        .remove("evidenceObservationIds");
    let legacy: ielts_domain::JournalFacts = serde_json::from_value(legacy).unwrap();
    assert!(legacy.memory_events[0].evidence_observation_ids.is_empty());
}

#[test]
fn late_contradiction_cannot_hide_behind_128_event_limit_or_borrow_support() {
    let (_dir, conn) = open_db();
    seed_dream_memory(&conn, "mem-reading", "local");
    seed_dream_observation(&conn, "obs-support", "local", "2026-08-16T09:00:00Z");
    seed_dream_observation(&conn, "obs-counter", "local", "2026-08-16T09:30:00Z");
    link_dream_evidence(&conn, "mem-reading", "obs-support");
    for index in 1..128 {
        let at = format!("2026-08-16T10:{:02}:{:02}Z", index / 60, index % 60);
        conn.execute(
            "INSERT INTO memory_mutations
             (id, memory_id, operation, actor_type, reason, created_at)
             VALUES (?1, 'mem-reading', 'reinforce', 'agent', 'test', ?2)",
            params![format!("mmut-extra-{index:03}"), at],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO memory_mutations
         (id, memory_id, operation, actor_type, reason, created_at)
         VALUES ('mmut-counter', 'mem-reading', 'contradict', 'agent', 'test',
                 '2026-08-16T11:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memory_evidence
         (memory_id, observation_id, source_fingerprint, projector_key,
          projector_version, evidence_role, event_ids_json, evidence_hash, created_at)
         VALUES ('mem-reading', 'obs-counter', 'obs-counter', 'test', 1,
                 'contradict', '[]', 'counter-hash', '2026-08-16T11:00:00Z')",
        [],
    )
    .unwrap();

    let overflow = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(overflow.memory_changes.reinforced, 128);
    assert_eq!(overflow.memory_changes.contradicted, 1);
    assert!(overflow.memory_events.is_empty());
    assert_eq!(
        overflow.source_hash,
        build_daily_facts(&conn, "local", DAY).unwrap().source_hash
    );

    conn.execute(
        "DELETE FROM memory_mutations WHERE id = 'mmut-extra-127'",
        [],
    )
    .unwrap();
    let bounded = build_daily_facts(&conn, "local", DAY).unwrap();
    assert_eq!(bounded.memory_events.len(), 128);
    assert_ne!(overflow.source_hash, bounded.source_hash);
    assert_eq!(
        bounded.source_hash,
        build_daily_facts(&conn, "local", DAY).unwrap().source_hash
    );
    assert_eq!(
        bounded.memory_events[0].evidence_observation_ids,
        ["obs-support"]
    );
    let contradiction = bounded.memory_events.last().unwrap();
    assert_eq!(contradiction.change_kind, "contradicted");
    assert_eq!(contradiction.evidence_observation_ids, ["obs-counter"]);
}

#[test]
fn list_journal_versions_returns_every_version_newest_first() {
    let (_dir, conn) = open_db();
    assert!(ielts_db::list_journal_versions(&conn, "local", DAY).unwrap().is_empty());
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    let first = insert_journal(&conn, "local", &facts, None).unwrap();
    seed_attempt(&conn, "att-1", "2026-08-16T10:00:00Z", 600_000);
    let facts = build_daily_facts(&conn, "local", DAY).unwrap();
    let second = insert_journal(&conn, "local", &facts, None).unwrap();
    // Another day and another user are not part of this day's history.
    let other_day = build_daily_facts(&conn, "local", "2026-08-17").unwrap();
    insert_journal(&conn, "local", &other_day, None).unwrap();
    insert_journal(&conn, "u2", &build_daily_facts(&conn, "u2", DAY).unwrap(), None).unwrap();

    let versions = ielts_db::list_journal_versions(&conn, "local", DAY).unwrap();
    let rows = versions
        .iter()
        .map(|j| (j.id.as_str(), j.version, j.status))
        .collect::<Vec<_>>();
    assert_eq!(
        rows,
        vec![
            (second.id.as_str(), 2, DailyJournalStatus::Published),
            (first.id.as_str(), 1, DailyJournalStatus::Superseded),
        ]
    );
    assert_eq!(versions[1].superseded_by.as_deref(), Some(second.id.as_str()));
}

fn submit_reading(dir: &std::path::Path, conn: &rusqlite::Connection) {
    let path = dir.join("journal-asset.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&serde_json::json!({
            "examId": "journal-asset", "meta": {"title": "Journal", "category": "P1"},
            "questionCount": 2, "questionOrder": ["q1", "q2"],
            "answerKey": {"q1": "TRUE", "q2": "B"},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]},
                               {"kind": "mcq", "questionIds": ["q2"]}]
        }))
        .unwrap(),
    )
    .unwrap();
    let asset = ielts_db::import_asset_payload_file(conn, &path).unwrap();
    ielts_db::submit_reading_attempt(
        conn,
        &ielts_db::ReadingSubmitCommand {
            attempt_id: "journal-attempt-1".into(),
            asset_id: "journal-asset".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            answers: serde_json::json!({"q1": "FALSE", "q2": "B"}),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(900),
            title_snapshot: Some("Journal".into()),
            idempotency_key: "journal-submit-1".into(),
        },
    )
    .unwrap();
}

#[test]
fn fresh_daily_facts_project_a_new_submit_before_summarising() {
    let (dir, conn) = open_db();
    submit_reading(dir.path(), &conn);
    // A submit only appends to the ledger: the derived rows are stale.
    assert!(!ielts_db::learning_observations_verify(&conn).unwrap().consistent);

    // The submit happened "now"; cover both the UTC and the local calendar day
    // so the test does not depend on how day bounds are interpreted.
    let days = [chrono::Utc::now().date_naive(), chrono::Local::now().date_naive()]
        .map(|day| day.format("%Y-%m-%d").to_string());
    let stale = days
        .iter()
        .map(|day| build_daily_facts(&conn, "local", day).unwrap())
        .collect::<Vec<_>>();
    assert!(stale
        .iter()
        .all(|f| f.today_observation_ids.is_empty() && f.skill_deltas.is_empty()));

    let fresh = days
        .iter()
        .map(|day| ielts_db::build_fresh_daily_facts(&conn, "local", day).unwrap())
        .collect::<Vec<_>>();
    assert!(ielts_db::learning_observations_verify(&conn).unwrap().consistent);
    assert!(ielts_db::learner_model_verify(&conn).unwrap().consistent);
    assert!(fresh
        .iter()
        .any(|f| !f.today_observation_ids.is_empty() && !f.skill_deltas.is_empty()));
    for (stale, fresh) in stale.iter().zip(&fresh) {
        if !fresh.today_observation_ids.is_empty() {
            assert_ne!(stale.source_hash, fresh.source_hash);
        }
    }
    // Once fresh, another build is a pure read with the same hash.
    let changes = conn.total_changes();
    let again = ielts_db::build_fresh_daily_facts(&conn, "local", &days[0]).unwrap();
    assert_eq!(again.source_hash, fresh[0].source_hash);
    assert_eq!(conn.total_changes(), changes);
}
