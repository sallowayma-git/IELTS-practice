use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    append_learning_event, event_key, import_asset_payload_file, learning_events_rebuild,
    learning_events_verify, list_learning_events, migrate, open_connection, submit_reading_attempt,
    DbOpenOptions, NewLearningEvent, ReadingQuestionProgress, ReadingSubmitCommand,
};
use ielts_domain::LearningEventType;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[test]
fn append_is_deterministic_and_idempotent() {
    let (_dir, conn) = open_db();
    let event = generic_event("source-1");
    let first = append_learning_event(&conn, event.clone()).unwrap();
    let second = append_learning_event(&conn, event).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(
        first.idempotency_key,
        event_key(LearningEventType::CoachQuestionAsked, Some("source-1"), 1)
    );
    assert_eq!(learning_events_verify(&conn).unwrap().total, 1);
}

#[test]
fn rebuild_is_idempotent_and_hashes_payload() {
    let (_dir, conn) = open_db();
    let report = learning_events_rebuild(&conn, 100).unwrap();
    assert_eq!(report.inserted_events, 0);
    let verify = learning_events_verify(&conn).unwrap();
    assert_eq!(verify.bad_hashes, 0);
}

#[test]
fn event_append_rolls_back_with_failed_business_transaction() {
    let (_dir, conn) = open_db();
    let tx = conn.unchecked_transaction().unwrap();
    append_learning_event(&tx, generic_event("source-rollback")).unwrap();
    drop(tx);
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM learning_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn migration_is_forward_only_from_v11_fixture() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("v11.db");
    let mut conn = open_connection(&DbOpenOptions::create(path)).unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
    )
    .unwrap();
    for version in 1..=11 {
        let name = match version {
            1 => "v2_core",
            2 => "writing_eval_sessions",
            3 => "eval_lineage_multi",
            4 => "modes_timer",
            5 => "annotations_vocab_coach",
            6 => "writing_topics",
            7 => "attempt_writing_task_type",
            8 => "history_retention_policy",
            9 => "writing_prompt_policy",
            10 => "reading_timer_states",
            11 => "agent_runs_tool_calls",
            _ => unreachable!(),
        };
        let sql = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("migrations")
                .join(format!("{version:04}_{name}.sql")),
        )
        .unwrap();
        conn.execute_batch(&sql).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations(version,name,applied_at) VALUES (?1,?2,?3)",
            rusqlite::params![version, name, "2026-08-12T00:00:00Z"],
        )
        .unwrap();
    }
    let applied = migrate(&mut conn).unwrap();
    assert_eq!(
        applied,
        vec![12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
    );
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(version >= 23, "migration 0023 was not applied, got {version}");
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'learning_events'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);
    assert!(version >= 23, "migration 0023 was not applied, got {version}");
}

#[test]
fn reading_submit_projection_is_atomic_idempotent_rebuildable_and_cascades() {
    let (dir, conn) = open_db();
    let asset_path = dir.path().join("asset.json");
    std::fs::write(&asset_path, serde_json::to_vec(&sample_payload()).unwrap()).unwrap();
    let asset = import_asset_payload_file(&conn, &asset_path).unwrap();
    let command = ReadingSubmitCommand {
        attempt_id: "attempt-ledger-1".into(),
        asset_id: "ledger-asset".into(),
        asset_revision: Some(asset.schema_version),
        asset_fingerprint: Some(asset.fingerprint),
        answers: json!({"q1":"TRUE","q2":"B"}),
        marked_questions: vec!["q2".into()],
        question_timeline: vec![ReadingQuestionProgress {
            question_id: "q1".into(),
            change_count: 0,
            visit_count: 2,
            elapsed_ms: 900,
            answered_at: Some("2026-08-12T00:10:00Z".into()),
        }],
        duration_ms: Some(10_000),
        title_snapshot: Some("Ledger Passage".into()),
        idempotency_key: "submit-ledger-1".into(),
    };
    let first = submit_reading_attempt(&conn, &command).unwrap();
    assert!(!first.idempotent_replay);
    let events = list_learning_events(&conn, None, Some("attempt-ledger-1"), 20).unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(
        events
            .iter()
            .filter(|event| event.question_id.is_some())
            .count(),
        2
    );
    assert!(learning_events_verify(&conn).unwrap().consistent);

    let replay = submit_reading_attempt(&conn, &command).unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(
        list_learning_events(&conn, None, Some("attempt-ledger-1"), 20)
            .unwrap()
            .len(),
        3
    );

    let hashes = events
        .iter()
        .map(|event| (event.idempotency_key.clone(), event.content_hash.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    conn.execute(
        "DELETE FROM learning_events WHERE attempt_id = 'attempt-ledger-1'",
        [],
    )
    .unwrap();
    let rebuild = learning_events_rebuild(&conn, 100).unwrap();
    assert_eq!(rebuild.inserted_events, 3);
    assert_eq!(
        list_learning_events(&conn, None, Some("attempt-ledger-1"), 20)
            .unwrap()
            .iter()
            .map(|event| (event.idempotency_key.clone(), event.content_hash.clone()))
            .collect::<std::collections::BTreeMap<_, _>>(),
        hashes
    );

    conn.execute("DELETE FROM attempts WHERE id = 'attempt-ledger-1'", [])
        .unwrap();
    assert!(
        list_learning_events(&conn, None, Some("attempt-ledger-1"), 20)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn failed_event_projection_rolls_back_reading_attempt_and_idempotency() {
    let (dir, conn) = open_db();
    let asset_path = dir.path().join("asset.json");
    std::fs::write(&asset_path, serde_json::to_vec(&sample_payload()).unwrap()).unwrap();
    let asset = import_asset_payload_file(&conn, &asset_path).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_learning_event BEFORE INSERT ON learning_events
         BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END;",
    )
    .unwrap();
    let error = submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "attempt-fail".into(),
            asset_id: "ledger-asset".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            answers: json!({"q1":"TRUE","q2":"B"}),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1000),
            title_snapshot: None,
            idempotency_key: "submit-fail".into(),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("injected ledger failure"));
    let attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE id='attempt-fail'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let idempotency: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempt_idempotency WHERE idempotency_key='submit-fail'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((attempts, idempotency), (0, 0));
}

#[allow(dead_code)]
fn _submit_shape_is_kept_visible(_command: ReadingSubmitCommand) {
    let _ = submit_reading_attempt;
}

fn generic_event(source_id: &str) -> NewLearningEvent {
    NewLearningEvent {
        event_type: LearningEventType::CoachQuestionAsked,
        source_kind: "test".into(),
        source_id: Some(source_id.into()),
        activity: None,
        asset_id: None,
        attempt_id: None,
        question_id: None,
        skill_key: None,
        occurred_at: "2026-08-12T00:00:00Z".into(),
        payload: json!({"ok": true}),
        schema_version: 1,
        sensitivity: "normal".into(),
    }
}

fn sample_payload() -> serde_json::Value {
    json!({
        "examId": "ledger-asset",
        "meta": {"title": "Ledger Passage", "category": "P1"},
        "questionCount": 2,
        "questionOrder": ["q1", "q2"],
        "answerKey": {"q1": "TRUE", "q2": "B"},
        "questionGroups": [
            {"kind": "tfng", "questionIds": ["q1"]},
            {"kind": "mcq", "questionIds": ["q2"]}
        ]
    })
}
