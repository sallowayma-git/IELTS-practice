//! Regression coverage for the SQLite-owned history retention policy.

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::AttemptRecord;
use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    clear_history, delete_attempt, delete_history_attempts, get_history_retention_policy,
    import_asset_payload_file, migrate, open_connection, restore_legacy_history_retention_policy,
    set_history_retention_policy, submit_reading_attempt, upsert_attempt, DbOpenOptions,
    ReadingSubmitCommand,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn open_v7() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let conn = open_connection(&DbOpenOptions::create(dir.path().join("v7.db"))).unwrap();
    ielts_db::current_version(&conn).unwrap();
    let migrations = [
        include_str!("../migrations/0001_v2_core.sql"),
        include_str!("../migrations/0002_writing_eval_sessions.sql"),
        include_str!("../migrations/0003_eval_lineage_multi.sql"),
        include_str!("../migrations/0004_modes_timer.sql"),
        include_str!("../migrations/0005_annotations_vocab_coach.sql"),
        include_str!("../migrations/0006_writing_topics.sql"),
        include_str!("../migrations/0007_attempt_writing_task_type.sql"),
    ];
    for (index, sql) in migrations.iter().enumerate() {
        conn.execute_batch(sql).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations VALUES (?1, 'fixture', '2026-01-01T00:00:00Z')",
            [(index + 1) as i64],
        )
        .unwrap();
    }
    (dir, conn)
}

fn terminal_attempt(id: &str) -> AttemptRecord {
    AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: id.into(),
        activity: Activity::Reading,
        asset_id: None,
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: "2025-01-01T00:00:00Z".into(),
        submitted_at: Some("2025-01-01T00:00:00Z".into()),
        completed_at: Some("2025-01-01T00:00:00Z".into()),
        duration_ms: 1,
        score_value: Some(1.0),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(1.0),
        question_count: Some(1),
        title_snapshot: Some(id.into()),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![],
        annotations: vec![],
    }
}

fn open_attempt(id: &str, status: AttemptStatus) -> AttemptRecord {
    let mut attempt = terminal_attempt(id);
    attempt.status = status;
    attempt.submitted_at = None;
    attempt.completed_at = None;
    attempt.score_value = None;
    attempt.score_scale = None;
    attempt.correct_count = None;
    attempt.question_count = None;
    attempt
}

fn terminal_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM attempts
         WHERE mode != 'memorize'
           AND lower(status) IN ('completed', 'cancelled', 'failed', 'interrupted')",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn insert_answerable_asset(dir: &tempfile::TempDir, conn: &rusqlite::Connection) {
    let path = dir.path().join("retention-p1.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&json!({
            "examId": "retention-p1",
            "meta": { "title": "Retention passage", "category": "P1" },
            "questionCount": 1,
            "questionOrder": ["q1"],
            "answerKey": { "q1": "A" }
        }))
        .unwrap(),
    )
    .unwrap();
    import_asset_payload_file(conn, &path).unwrap();
}

fn submit_terminal_reading(conn: &rusqlite::Connection, attempt_id: &str, key: &str) {
    let result = submit_reading_attempt(
        conn,
        &ReadingSubmitCommand {
            attempt_id: attempt_id.into(),
            asset_id: "retention-p1".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1),
            title_snapshot: None,
            idempotency_key: key.into(),
        },
    )
    .unwrap();
    assert!(!result.idempotent_replay);
}

#[test]
fn fifty_limit_prunes_the_fifty_first_terminal_write_but_keeps_open_work() {
    let (dir, conn) = open_db();
    insert_answerable_asset(&dir, &conn);
    for index in 0..50 {
        upsert_attempt(&conn, &terminal_attempt(&format!("seed-{index:03}"))).unwrap();
    }
    upsert_attempt(&conn, &open_attempt("draft-kept", AttemptStatus::Draft)).unwrap();
    upsert_attempt(&conn, &open_attempt("active-kept", AttemptStatus::Active)).unwrap();

    let set = set_history_retention_policy(&conn, Some(50)).unwrap();
    assert_eq!(set.pruned_attempt_count, 0);
    assert_eq!(set.policy.max_terminal_attempts, Some(50));

    submit_terminal_reading(&conn, "reading-51", "retention-submit-51");

    assert_eq!(terminal_count(&conn), 50);
    assert!(attempt_exists(&conn, "reading-51"));
    assert!(!attempt_exists(&conn, "seed-000"));
    assert!(attempt_exists(&conn, "draft-kept"));
    assert!(attempt_exists(&conn, "active-kept"));
}

#[test]
fn unlimited_policy_disables_automatic_cleanup_and_rejects_invalid_finite_limits() {
    let (dir, conn) = open_db();
    insert_answerable_asset(&dir, &conn);
    for index in 0..50 {
        upsert_attempt(&conn, &terminal_attempt(&format!("seed-{index:03}"))).unwrap();
    }
    set_history_retention_policy(&conn, Some(50)).unwrap();
    submit_terminal_reading(&conn, "reading-limited", "retention-limited");
    assert_eq!(terminal_count(&conn), 50);

    let unlimited = set_history_retention_policy(&conn, None).unwrap();
    assert_eq!(unlimited.policy.max_terminal_attempts, None);
    assert!(serde_json::to_value(&unlimited.policy)
        .unwrap()
        .get("maxTerminalAttempts")
        .is_some_and(serde_json::Value::is_null));
    assert_eq!(
        get_history_retention_policy(&conn)
            .unwrap()
            .max_terminal_attempts,
        None
    );
    submit_terminal_reading(&conn, "reading-unlimited", "retention-unlimited");
    assert_eq!(terminal_count(&conn), 51);
    assert!(attempt_exists(&conn, "reading-unlimited"));

    for invalid in [Some(49), Some(51), Some(501)] {
        assert!(set_history_retention_policy(&conn, invalid).is_err());
    }
}

#[test]
fn v8_migration_moves_the_legacy_history_limit_without_leaving_a_mirror() {
    let (_dir, mut conn) = open_v7();
    // A real historical schema, not the latest database with its version erased.
    conn.execute_batch(
        "INSERT INTO settings(namespace, key, value_json, updated_at)
         VALUES ('app', 'history_limit', '\"150\"', '2026-01-01T00:00:00Z');",
    )
    .unwrap();

    migrate(&mut conn).unwrap();

    assert_eq!(
        get_history_retention_policy(&conn)
            .unwrap()
            .max_terminal_attempts,
        Some(150)
    );
    let legacy_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE namespace = 'app' AND key = 'history_limit'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy_rows, 0);
}

#[test]
fn v8_migration_rejects_lossy_legacy_history_limits() {
    for raw_limit in [r#""150abc""#, r#""150.5""#, r#"" 150 ""#, "150abc", "150.5"] {
        let (_dir, mut conn) = open_v7();
        conn.execute(
            "INSERT INTO settings(namespace, key, value_json, updated_at)
             VALUES ('app', 'history_limit', ?1, '2026-01-01T00:00:00Z')",
            [raw_limit],
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        assert_eq!(
            get_history_retention_policy(&conn)
                .unwrap()
                .max_terminal_attempts,
            None,
            "legacy payload {raw_limit:?} must not be coerced into a policy; the untouched default is unlimited (0027)"
        );
    }
}

#[test]
fn legacy_backup_restore_uses_the_same_strict_history_limit_parser() {
    for raw_limit in [r#""150abc""#, r#""150.5""#, r#"" 150 ""#] {
        let (_dir, conn) = open_db();
        conn.execute(
            "INSERT INTO settings(namespace, key, value_json, updated_at)
             VALUES ('app', 'history_limit', ?1, '2026-01-01T00:00:00Z')",
            [raw_limit],
        )
        .unwrap();

        restore_legacy_history_retention_policy(&conn).unwrap();

        assert_eq!(
            get_history_retention_policy(&conn)
                .unwrap()
                .max_terminal_attempts,
            None,
            "legacy backup payload {raw_limit:?} must not be coerced into a policy; the untouched default is unlimited (0027)"
        );
        let legacy_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE namespace = 'app' AND key = 'history_limit'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_rows, 0);
    }
}

#[test]
fn deleting_an_attempt_only_invalidates_exact_mode_replays() {
    let (_dir, conn) = open_db();
    let attempt_id = "a1";
    upsert_attempt(&conn, &terminal_attempt(attempt_id)).unwrap();

    conn.execute(
        "INSERT INTO mode_idempotency (scope, idempotency_key, entity_id, response_json, created_at)
         VALUES
           ('suite.submit', 'exact-attempt', 'suite-1', ?1, '2026-01-01T00:00:00Z'),
           ('suite.submit', 'unrelated-substring', 'suite-2', ?2, '2026-01-01T00:00:00Z'),
           ('timer.pause', 'unknown-scope-session', 'timer-1', ?3, '2026-01-01T00:00:00Z'),
           ('memorize.create', 'memorize-exact-entity', ?4, '{\"message\":\"unrelated\"}', '2026-01-01T00:00:00Z')",
        [
            json!({
                "suiteSession": {
                    "sequence": [{ "attemptId": attempt_id, "sessionId": attempt_id }]
                },
                "submission": { "attempt": { "id": attempt_id } }
            })
            .to_string(),
            json!({
                "message": "a1 occurs in ordinary text",
                "suiteSession": {
                    "sequence": [{ "attemptId": "a100", "sessionId": "a100" }]
                },
                "submission": { "attempt": { "id": "a100" } }
            })
            .to_string(),
            json!({ "sequence": [{ "sessionId": attempt_id }] }).to_string(),
            attempt_id.to_string(),
        ],
    )
    .unwrap();

    assert!(delete_attempt(&conn, attempt_id).unwrap());
    assert!(!mode_idempotency_exists(
        &conn,
        "suite.submit",
        "exact-attempt"
    ));
    assert!(!mode_idempotency_exists(
        &conn,
        "memorize.create",
        "memorize-exact-entity"
    ));
    assert!(mode_idempotency_exists(
        &conn,
        "suite.submit",
        "unrelated-substring"
    ));
    assert!(mode_idempotency_exists(
        &conn,
        "timer.pause",
        "unknown-scope-session"
    ));
}

fn insert_coach_request(conn: &rusqlite::Connection, attempt_id: &str, suffix: &str) {
    let thread = format!("thread-{suffix}");
    let run = format!("run-{suffix}");
    let snapshot = format!("snapshot-{suffix}");
    let message = format!("message-{suffix}");
    let secret = format!("ANSWER-SECRET-{suffix}");
    conn.execute(
        "INSERT INTO coach_threads (id, attempt_id, status, created_at, updated_at)
         VALUES (?1, ?2, 'active', '2026-01-01', '2026-01-01')",
        rusqlite::params![thread, attempt_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO coach_messages (id, thread_id, role, content, status, created_at)
         VALUES (?1, ?2, 'user', ?3, 'completed', '2026-01-01')",
        rusqlite::params![message, thread, format!("transcript {suffix}")],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, provider_id, model, status, result_json, created_at, updated_at)
         VALUES (?1, 'fixture', 'fixture', 'completed', ?2, '2026-01-01', '2026-01-01')",
        rusqlite::params![run, json!({"runKind":"coach", "threadId":thread}).to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_context_snapshots
         (id, run_id, planner_version, scope, query_plan_json, token_budget,
          used_tokens, rendered_context, content_hash, created_at)
         VALUES (?1, ?2, 'canonical-coach-v1', ?3, ?4, 100, 10, ?5, 'original-hash', '2026-01-01')",
        rusqlite::params![
            snapshot,
            run,
            format!("coach:{thread}"),
            json!({"kind":"canonical_coach", "threadId":thread}).to_string(),
            secret
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_context_items
         (snapshot_id, item_type, item_id, rank, score, estimated_tokens, inclusion_reason, provenance_json)
         VALUES (?1, 'CURRENT_TASK', ?2, 0, 1, 10, ?3, ?4)",
        rusqlite::params![snapshot, message, format!("request {secret}"),
            json!({"sourceId":message, "contentHash":"original-hash", "answer":secret}).to_string()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO llm_invocations (id, run_id, kind, request_hash, created_at)
         VALUES (?1, ?2, 'completion', 'original-hash', '2026-01-01')",
        rusqlite::params![format!("invocation-{suffix}"), run],
    )
    .unwrap();
}

fn assert_coach_request(conn: &rusqlite::Connection, suffix: &str, redacted: bool) {
    let thread = format!("thread-{suffix}");
    let snapshot = format!("snapshot-{suffix}");
    let (attempt_id, transcript): (Option<String>, String) = conn
        .query_row(
            "SELECT t.attempt_id, m.content FROM coach_threads t
             JOIN coach_messages m ON m.thread_id = t.id WHERE t.id = ?1",
            [&thread],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(transcript, format!("transcript {suffix}"));
    assert_eq!(attempt_id.is_none(), redacted);
    let (rendered, hash, plan, reason, provenance, request_hash): (
        String,
        String,
        String,
        String,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT s.rendered_context, s.content_hash, s.query_plan_json,
                    i.inclusion_reason, i.provenance_json, v.request_hash
             FROM agent_context_snapshots s
             JOIN agent_context_items i ON i.snapshot_id = s.id
             JOIN llm_invocations v ON v.run_id = s.run_id
             WHERE s.id = ?1",
            [&snapshot],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    if redacted {
        assert_eq!(rendered, "[redacted: deleted attempt]");
        assert_eq!(hash, "redacted");
        assert_eq!(request_hash, "redacted");
        assert_eq!(reason, "redacted");
        assert_eq!(json!({"redacted":true}).to_string(), provenance);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&plan).unwrap()["redacted"],
            true
        );
    } else {
        assert_eq!(rendered, format!("ANSWER-SECRET-{suffix}"));
        assert_eq!(hash, "original-hash");
        assert_eq!(request_hash, "original-hash");
        assert!(reason.contains(&rendered));
        assert!(provenance.contains(&rendered));
    }
}

#[test]
fn single_delete_redacts_only_its_bound_coach_requests() {
    let (_dir, conn) = open_db();
    for suffix in ["deleted", "kept"] {
        upsert_attempt(&conn, &terminal_attempt(suffix)).unwrap();
        insert_coach_request(&conn, suffix, suffix);
    }
    insert_coach_request(&conn, "deleted", "deleted-second-thread");
    assert!(delete_attempt(&conn, "deleted").unwrap());
    assert_coach_request(&conn, "deleted", true);
    assert_coach_request(&conn, "deleted-second-thread", true);
    assert_coach_request(&conn, "kept", false);
    assert!(attempt_exists(&conn, "kept"));
}

#[test]
fn deleted_run_set_null_snapshot_is_still_redacted_by_thread_scope() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("orphan")).unwrap();
    insert_coach_request(&conn, "orphan", "orphan");
    conn.execute("DELETE FROM agent_runs WHERE id = 'run-orphan'", [])
        .unwrap();
    let run_id: Option<String> = conn
        .query_row(
            "SELECT run_id FROM agent_context_snapshots WHERE id = 'snapshot-orphan'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(run_id, None);
    assert!(delete_attempt(&conn, "orphan").unwrap());
    let (rendered, hash, plan, reason, provenance): (String, String, String, String, String) = conn
        .query_row(
            "SELECT s.rendered_context, s.content_hash, s.query_plan_json,
                    i.inclusion_reason, i.provenance_json
             FROM agent_context_snapshots s
             JOIN agent_context_items i ON i.snapshot_id = s.id
             WHERE s.id = 'snapshot-orphan'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(rendered, "[redacted: deleted attempt]");
    assert_eq!(hash, "redacted");
    assert_eq!(plan, "{\"redacted\":true}");
    assert_eq!(reason, "redacted");
    assert_eq!(provenance, "{\"redacted\":true}");
}

#[test]
fn coach_run_receipt_redacts_snapshot_with_noncanonical_scope() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("receipt")).unwrap();
    insert_coach_request(&conn, "receipt", "receipt");
    conn.execute(
        "INSERT INTO agent_context_snapshots
         (id, run_id, planner_version, scope, query_plan_json, token_budget,
          used_tokens, rendered_context, content_hash, created_at)
         VALUES ('extra-receipt', 'run-receipt', 'fixture', 'other-scope',
                 '{\"secret\":\"ANSWER-SECRET-receipt\"}', 100, 10,
                 'ANSWER-SECRET-receipt', 'original-hash', '2026-01-01')",
        [],
    )
    .unwrap();
    assert!(delete_attempt(&conn, "receipt").unwrap());
    let (rendered, plan): (String, String) = conn
        .query_row(
            "SELECT rendered_context, query_plan_json FROM agent_context_snapshots
             WHERE id = 'extra-receipt'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(rendered, "[redacted: deleted attempt]");
    assert_eq!(plan, "{\"redacted\":true}");
}

#[test]
fn bulk_clear_and_prune_redact_coach_requests() {
    for operation in ["bulk", "clear", "prune"] {
        let (_dir, conn) = open_db();
        upsert_attempt(&conn, &terminal_attempt("old")).unwrap();
        insert_coach_request(&conn, "old", "old");
        match operation {
            "bulk" => assert_eq!(delete_history_attempts(&conn, &["old".into()]).unwrap(), 1),
            "clear" => assert_eq!(clear_history(&conn, None).unwrap(), 1),
            "prune" => {
                for index in 0..50 {
                    let mut attempt = terminal_attempt(&format!("new-{index:02}"));
                    attempt.started_at = "2026-01-01T00:00:00Z".into();
                    attempt.completed_at = Some("2026-01-01T00:00:00Z".into());
                    upsert_attempt(&conn, &attempt).unwrap();
                }
                assert_eq!(
                    set_history_retention_policy(&conn, Some(50))
                        .unwrap()
                        .pruned_attempt_count,
                    1
                );
            }
            _ => unreachable!(),
        }
        assert!(!attempt_exists(&conn, "old"));
        assert_coach_request(&conn, "old", true);
    }
}

#[test]
fn failed_delete_rolls_back_coach_redaction_and_unlink() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("blocked")).unwrap();
    insert_coach_request(&conn, "blocked", "blocked");
    conn.execute_batch(
        "CREATE TRIGGER block_attempt_delete BEFORE DELETE ON attempts
         WHEN OLD.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
    )
    .unwrap();
    assert!(delete_attempt(&conn, "blocked").is_err());
    assert!(attempt_exists(&conn, "blocked"));
    assert_coach_request(&conn, "blocked", false);
}

fn mode_idempotency_exists(conn: &rusqlite::Connection, scope: &str, key: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM mode_idempotency WHERE scope = ?1 AND idempotency_key = ?2
         )",
        [scope, key],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}

fn attempt_exists(conn: &rusqlite::Connection, attempt_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM attempts WHERE id = ?1)",
        [attempt_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        == 1
}
