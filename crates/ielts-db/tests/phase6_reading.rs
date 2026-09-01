//! Phase 6: reading scoring parity, drafts, idempotent submit.

use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    compare_answer, get_open_reading_draft_with_timer, import_asset_payload_file,
    load_pdf_data_url, load_practice_asset_payload, migrate, open_connection, patch_reading_answer,
    save_reading_draft, score_attempt, submit_reading_attempt, DbOpenOptions, MatchMode,
    ReadingDraftCommand, ReadingQuestionProgress, ReadingSubmitCommand, TimerState,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[test]
fn complete_asset_payload_is_loaded_and_verified() {
    let (dir, conn) = open_db();
    let path = dir.path().join("p1-demo.json");
    std::fs::write(&path, serde_json::to_vec(&sample_payload()).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();

    let loaded = load_practice_asset_payload(&conn, "p1-demo").unwrap();
    assert_eq!(loaded.asset.id, "p1-demo");
    assert_eq!(loaded.asset.content_ref.as_deref(), path.to_str());
    assert_eq!(loaded.payload["questionCount"], 4);

    std::fs::write(&path, br#"{"examId":"p1-demo","questionCount":99}"#).unwrap();
    let err = load_practice_asset_payload(&conn, "p1-demo").unwrap_err();
    assert!(err.to_string().contains("fingerprint mismatch"));
}

#[test]
fn complete_asset_payload_rejects_missing_index_entry() {
    let (_dir, conn) = open_db();
    let err = load_practice_asset_payload(&conn, "missing").unwrap_err();
    assert!(err.to_string().contains("asset not found"));
}

#[test]
fn pdf_only_asset_is_served_through_a_native_data_url() {
    let (dir, conn) = open_db();
    let pdf = dir.path().join("p1.pdf");
    std::fs::write(&pdf, b"%PDF-1.4\nminimal fixture").unwrap();
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
         ) VALUES (
            'pdf-p1', 'reading', 'imported', 'pdf-p1', 'PDF P1', 'P1', NULL, NULL,
            ?1, 1, 'pdf-fixture', 1, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
         )",
        [pdf.display().to_string()],
    )
    .unwrap();

    let data_url = load_pdf_data_url(&conn, "pdf-p1").unwrap();
    assert!(data_url.starts_with("data:application/pdf;base64,"));
    assert!(load_pdf_data_url(&conn, "missing").is_err());
}

fn sample_payload() -> serde_json::Value {
    json!({
        "examId": "p1-demo",
        "meta": { "title": "Demo Passage", "category": "P1", "frequency": "high" },
        "questionCount": 4,
        "questionOrder": ["q1", "q2", "q3", "q4"],
        "answerKey": {
            "q1": "TRUE",
            "q2": "A",
            "q3": ["B", "C"],
            "q4": ["A", "D"]
        },
        "interactionModel": {
            "q4": { "control": "checkbox" }
        },
        "questionGroups": [
            { "kind": "tfng", "questionIds": ["q1"] },
            { "kind": "mcq", "questionIds": ["q2", "q3"] },
            { "kind": "multi", "questionIds": ["q4"] }
        ]
    })
}

#[test]
fn scoring_parity_aliases_and_modes() {
    let (ok, _, _, mode) = compare_answer(&json!("YES"), &json!("TRUE"), None);
    assert_eq!(ok, Some(true));
    assert_eq!(mode, MatchMode::Single);

    let (ok, _, _, mode) = compare_answer(&json!("B"), &json!(["A", "B"]), None);
    assert_eq!(ok, Some(true));
    assert_eq!(mode, MatchMode::Alternatives);

    let (ok, _, _, mode) = compare_answer(&json!(["D", "A"]), &json!(["A", "D"]), Some("checkbox"));
    assert_eq!(ok, Some(true));
    assert_eq!(mode, MatchMode::Set);
}

#[test]
fn draft_patch_and_idempotent_submit() {
    let (dir, conn) = open_db();
    let payload = sample_payload();
    let path = dir.path().join("p1-demo.json");
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    let asset = import_asset_payload_file(&conn, &path).unwrap();

    save_reading_draft(
        &conn,
        &ReadingDraftCommand {
            attempt_id: "r-1".into(),
            asset_id: "p1-demo".into(),
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec!["q3".into()],
            question_timeline: vec![ReadingQuestionProgress {
                question_id: "q1".into(),
                change_count: 2,
                visit_count: 3,
                elapsed_ms: 900,
                answered_at: Some("2026-07-13T00:00:00Z".into()),
            }],
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint.clone()),
            title_snapshot: Some("Demo Passage".into()),
            timer_snapshot: Some(TimerState {
                source: "local".into(),
                anchor_ms: 1_000,
                effective_start_time_ms: 1_000,
                mode: ielts_db::TimerMode::Elapsed,
                limit_seconds: None,
                paused_offset_ms: 500,
                paused_at_ms: Some(6_000),
                running: false,
            }),
            idempotency_key: "draft-1".into(),
        },
    )
    .unwrap();

    patch_reading_answer(&conn, "r-1", "q3", &json!("B"), true).unwrap();

    let result = submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "r-1".into(),
            asset_id: "p1-demo".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint.clone()),
            answers: json!({
                "q1": "TRUE",
                "q2": "A",
                "q3": "B",
                "q4": ["A", "D"]
            }),
            marked_questions: vec!["q3".into()],
            question_timeline: vec![ReadingQuestionProgress {
                question_id: "q1".into(),
                change_count: 2,
                visit_count: 3,
                elapsed_ms: 900,
                answered_at: Some("2026-07-13T00:00:00Z".into()),
            }],
            duration_ms: Some(90_000),
            title_snapshot: Some("Demo Passage".into()),
            idempotency_key: "submit-1".into(),
        },
    )
    .unwrap();

    assert!(!result.idempotent_replay);
    assert!(result.score.accuracy > 0.9);
    assert_eq!(
        result.attempt.status,
        ielts_domain::AttemptStatus::Completed
    );
    assert!(result.attempt.answers.iter().any(|a| a.marked));

    let replay = submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "r-1".into(),
            asset_id: "p1-demo".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            answers: json!({ "q1": "FALSE" }), // would change score if re-scored
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1),
            title_snapshot: None,
            idempotency_key: "submit-1".into(),
        },
    )
    .unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(replay.score.accuracy, result.score.accuracy);

    // only one history row
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM attempts WHERE id = 'r-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn draft_marks_and_timeline_restore_from_canonical_answers() {
    let (dir, conn) = open_db();
    let path = dir.path().join("p1-demo.json");
    std::fs::write(&path, serde_json::to_vec(&sample_payload()).unwrap()).unwrap();
    let asset = import_asset_payload_file(&conn, &path).unwrap();

    save_reading_draft(
        &conn,
        &ReadingDraftCommand {
            attempt_id: "draft-restore".into(),
            asset_id: asset.id.clone(),
            answers: json!({ "q1": "TRUE" }),
            marked_questions: vec!["q3".into()],
            question_timeline: vec![ReadingQuestionProgress {
                question_id: "q1".into(),
                change_count: 4,
                visit_count: 5,
                elapsed_ms: 1200,
                answered_at: Some("2026-07-13T01:02:03Z".into()),
            }],
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            title_snapshot: None,
            timer_snapshot: Some(TimerState {
                source: "local".into(),
                anchor_ms: 1_000,
                effective_start_time_ms: 1_000,
                mode: ielts_db::TimerMode::Elapsed,
                limit_seconds: None,
                paused_offset_ms: 500,
                paused_at_ms: Some(6_000),
                running: false,
            }),
            idempotency_key: "draft-restore-1".into(),
        },
    )
    .unwrap();

    let restored = ielts_db::get_open_reading_draft(&conn, &asset.id)
        .unwrap()
        .unwrap();
    let q1 = restored
        .answers
        .iter()
        .find(|answer| answer.question_id == "q1")
        .unwrap();
    assert_eq!(q1.change_count, 4);
    assert_eq!(q1.visit_count, 5);
    assert_eq!(q1.elapsed_ms, 1200);
    assert!(restored
        .answers
        .iter()
        .any(|answer| answer.question_id == "q3" && answer.marked));
    let restored_with_timer = get_open_reading_draft_with_timer(&conn, &asset.id, None, None)
        .unwrap()
        .unwrap();
    let timer = restored_with_timer.timer.unwrap();
    assert_eq!(timer.source, "single");
    assert_eq!(timer.anchor_ms, 1_000);
    assert_eq!(timer.paused_offset_ms, 500);
    assert!(!timer.running);
    let legacy_mirrors: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE namespace = 'reading_draft'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy_mirrors, 0);
}

#[test]
fn submit_contract_rejects_client_payload_and_validates_asset_identity() {
    let raw = json!({
        "attemptId": "r-injected",
        "assetId": "p1-demo",
        "payload": { "answerKey": { "q1": "FALSE" } },
        "answers": { "q1": "FALSE" },
        "idempotencyKey": "injected-1"
    });
    assert!(serde_json::from_value::<ReadingSubmitCommand>(raw).is_err());

    let (dir, conn) = open_db();
    let path = dir.path().join("p1-demo.json");
    std::fs::write(&path, serde_json::to_vec(&sample_payload()).unwrap()).unwrap();
    let asset = import_asset_payload_file(&conn, &path).unwrap();
    let err = submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "r-stale".into(),
            asset_id: asset.id,
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some("client-tampered".into()),
            answers: json!({ "q1": "TRUE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: None,
            title_snapshot: None,
            idempotency_key: "stale-1".into(),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("fingerprint mismatch"));
}

#[test]
fn score_attempt_weights_checkbox() {
    let mut key = serde_json::Map::new();
    key.insert("q1".into(), json!("A"));
    key.insert("q2".into(), json!(["A", "B"]));
    let mut user = serde_json::Map::new();
    user.insert("q1".into(), json!("A"));
    user.insert("q2".into(), json!(["A", "B"]));
    let mut controls = serde_json::Map::new();
    controls.insert("q2".into(), json!("checkbox"));
    let (summary, _) = score_attempt(&key, &user, &controls, &serde_json::Map::new());
    assert_eq!(summary.total, 3.0);
    assert_eq!(summary.correct, 3.0);
    assert_eq!(summary.accuracy, 1.0);
}
