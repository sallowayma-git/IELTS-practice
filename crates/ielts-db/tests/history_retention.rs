//! Regression coverage for the SQLite-owned history retention policy.

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::AttemptRecord;
use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    delete_attempt, get_history_retention_policy, import_asset_payload_file, migrate,
    open_connection, restore_legacy_history_retention_policy, set_history_retention_policy,
    submit_reading_attempt, upsert_attempt, DbOpenOptions, ReadingSubmitCommand,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
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
    let (_dir, mut conn) = open_db();
    // Rewind only v8 on an otherwise genuine v7-shaped database. This proves
    // upgrade behavior without duplicating seven migration fixtures.
    conn.execute_batch(
        "DROP TABLE writing_prompts;
         DROP TABLE history_retention_policy;
         DELETE FROM schema_migrations WHERE version >= 8;
         INSERT INTO settings(namespace, key, value_json, updated_at)
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
        let (_dir, mut conn) = open_db();
        conn.execute_batch(
            "DROP TABLE writing_prompts;
             DROP TABLE history_retention_policy;
             DELETE FROM schema_migrations WHERE version >= 8;",
        )
        .unwrap();
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
            Some(100),
            "legacy payload {raw_limit:?} must not be coerced into a policy"
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
            Some(100),
            "legacy backup payload {raw_limit:?} must not be coerced into a policy"
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
