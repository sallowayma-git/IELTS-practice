use ielts_db::{
    create_backup_package, ensure_asset_stub, export_reading_archive, import_reading_archive_value,
    migrate, open_connection, upsert_attempt, DbOpenOptions, READING_ARCHIVE_SCHEMA_VERSION,
};
use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptAnnotationDto, AttemptAnswer, AttemptRecord};
use serde_json::{json, Value};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn reading_attempt(id: &str, asset_id: &str) -> AttemptRecord {
    AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: id.into(),
        activity: Activity::Reading,
        asset_id: Some(asset_id.into()),
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: "2026-07-15T09:00:00Z".into(),
        submitted_at: Some("2026-07-15T09:14:00Z".into()),
        completed_at: Some("2026-07-15T09:14:00Z".into()),
        duration_ms: 840_000,
        score_value: Some(0.8),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(8.0),
        question_count: Some(10),
        title_snapshot: Some(format!("Passage {id}")),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![AttemptAnswer {
            question_id: "q1".into(),
            answer: json!("TRUE"),
            is_correct: Some(true),
            weight: 1.0,
            question_kind: Some("tfng".into()),
            change_count: 2,
            visit_count: 3,
            elapsed_ms: 20_000,
            marked: true,
            answered_at: Some("2026-07-15T09:02:00Z".into()),
        }],
        annotations: vec![AttemptAnnotationDto {
            id: format!("{id}-annotation"),
            attempt_id: Some(id.into()),
            asset_id: asset_id.into(),
            scope: "passage".into(),
            question_id: None,
            kind: "highlight".into(),
            anchor: json!({ "quote": "archive anchor", "startOffset": 4 }),
            note_text: Some("keep this note".into()),
        }],
    }
}

fn seed_attempt(conn: &rusqlite::Connection, attempt: &AttemptRecord) {
    let asset_id = attempt.asset_id.as_deref().unwrap();
    ensure_asset_stub(
        conn,
        asset_id,
        Activity::Reading,
        attempt.title_snapshot.as_deref().unwrap(),
        Some(asset_id),
    )
    .unwrap();
    upsert_attempt(conn, attempt).unwrap();
}

fn canonical_archive(submissions: Vec<Value>) -> Value {
    json!({
        "activity": "reading",
        "schemaVersion": READING_ARCHIVE_SCHEMA_VERSION,
        "exportedAt": "2026-07-15T10:00:00Z",
        "count": submissions.len(),
        "submissions": submissions,
    })
}

fn attempt_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM attempts", [], |row| row.get(0))
        .unwrap()
}

#[test]
fn canonical_archive_round_trip_preserves_full_reading_snapshot() {
    let (_source_dir, source) = open_db();
    seed_attempt(&source, &reading_attempt("roundtrip-1", "asset-roundtrip"));

    let exported = export_reading_archive(&source).unwrap();
    assert_eq!(exported.activity, "reading");
    assert_eq!(exported.schema_version, READING_ARCHIVE_SCHEMA_VERSION);
    assert_eq!(exported.count, 1);
    assert_eq!(exported.submissions[0].answers.len(), 1);
    assert_eq!(exported.submissions[0].annotations.len(), 1);

    let (_target_dir, target) = open_db();
    let mut stale = reading_attempt("roundtrip-1", "asset-roundtrip");
    stale.annotations.push(AttemptAnnotationDto {
        id: "stale-annotation".into(),
        attempt_id: Some("roundtrip-1".into()),
        asset_id: "asset-roundtrip".into(),
        scope: "passage".into(),
        question_id: None,
        kind: "note".into(),
        anchor: json!({ "quote": "must be removed" }),
        note_text: None,
    });
    seed_attempt(&target, &stale);
    let report =
        import_reading_archive_value(&target, &serde_json::to_value(&exported).unwrap()).unwrap();
    assert!(report.committed);
    assert_eq!(report.imported, 1);
    assert_eq!(report.failed, 0);
    assert!(report.report.is_empty());

    let reexported = export_reading_archive(&target).unwrap();
    assert_eq!(reexported.count, exported.count);
    assert_eq!(reexported.submissions, exported.submissions);
}

#[test]
fn partial_bad_record_is_rejected_before_any_write() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, &reading_attempt("existing", "asset-existing"));
    let good = serde_json::to_value(reading_attempt("would-write", "asset-new")).unwrap();
    let bad = json!({
        "schemaVersion": AttemptRecord::SCHEMA_VERSION,
        "id": "bad-record",
        "activity": "reading",
        "mode": "single",
        "status": "completed",
        "startedAt": "2026-07-15T09:00:00Z",
        "durationMs": 1,
        "answers": [{ "questionId": "", "answer": "A" }],
        "annotations": [],
    });

    let report = import_reading_archive_value(&conn, &canonical_archive(vec![good, bad])).unwrap();
    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert_eq!(report.failed, 1);
    assert!(report
        .report
        .iter()
        .any(|entry| entry.code == "answer_question_id_invalid"));
    assert_eq!(
        attempt_count(&conn),
        1,
        "valid sibling must not be persisted"
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT COUNT(*) FROM practice_assets WHERE id = 'asset-new'",
            [],
            |row| row.get(0),
        )
        .unwrap(),
        0,
        "prevalidation must not write imported asset stubs",
    );
}

#[test]
fn all_bad_records_return_a_report_and_leave_database_unchanged() {
    let (_dir, conn) = open_db();
    let archive = canonical_archive(vec![json!({}), Value::Null]);

    let report = import_reading_archive_value(&conn, &archive).unwrap();
    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert_eq!(report.failed, 2);
    assert_eq!(report.report.len(), 2);
    assert_eq!(attempt_count(&conn), 0);
}

#[test]
fn unknown_schema_is_rejected_without_legacy_shape_loss() {
    let (_dir, conn) = open_db();
    let mut archive = canonical_archive(vec![serde_json::to_value(reading_attempt(
        "would-lose-answers",
        "asset-new",
    ))
    .unwrap()]);
    archive["schemaVersion"] = json!("practice-history-archive.v999");

    let report = import_reading_archive_value(&conn, &archive).unwrap();
    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert_eq!(report.failed, 1);
    assert!(report
        .report
        .iter()
        .any(|entry| entry.code == "archive_schema_unsupported"));
    assert_eq!(attempt_count(&conn), 0);
}

#[test]
fn database_conflict_rolls_back_prior_valid_records() {
    let (_dir, conn) = open_db();
    seed_attempt(&conn, &reading_attempt("immutable-id", "asset-existing"));
    let valid_first = serde_json::to_value(reading_attempt("would-write", "asset-new")).unwrap();
    let conflicting = serde_json::to_value(reading_attempt("immutable-id", "asset-other")).unwrap();

    let report =
        import_reading_archive_value(&conn, &canonical_archive(vec![valid_first, conflicting]))
            .unwrap();
    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert_eq!(report.failed, 2);
    assert!(report
        .report
        .iter()
        .any(|entry| entry.code == "transaction_rolled_back"));
    assert_eq!(
        attempt_count(&conn),
        1,
        "first record must roll back with the second"
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT COUNT(*) FROM practice_assets WHERE id IN ('asset-new', 'asset-other')",
            [],
            |row| row.get(0),
        )
        .unwrap(),
        0,
        "asset stubs created in the failed transaction must roll back too",
    );
}

#[test]
fn duplicate_annotation_ids_reject_the_whole_archive_before_any_write() {
    let (_dir, conn) = open_db();
    let first = reading_attempt("first", "asset-first");
    let mut second = reading_attempt("second", "asset-second");
    second.annotations[0].id = first.annotations[0].id.clone();

    let report = import_reading_archive_value(
        &conn,
        &canonical_archive(vec![
            serde_json::to_value(first).unwrap(),
            serde_json::to_value(second).unwrap(),
        ]),
    )
    .unwrap();

    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert!(report
        .report
        .iter()
        .any(|entry| entry.code == "annotation_id_duplicate"));
    assert_eq!(attempt_count(&conn), 0);
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM attempt_annotations", [], |row| {
            row.get(0)
        })
        .unwrap(),
        0
    );
}

#[test]
fn annotation_id_owned_by_another_attempt_is_rejected_without_overwrite() {
    let (_dir, conn) = open_db();
    let mut local = reading_attempt("local", "asset-local");
    local.annotations[0].id = "shared-annotation".into();
    seed_attempt(&conn, &local);

    let mut imported = reading_attempt("imported", "asset-imported");
    imported.annotations[0].id = "shared-annotation".into();
    let report = import_reading_archive_value(
        &conn,
        &canonical_archive(vec![serde_json::to_value(imported).unwrap()]),
    )
    .unwrap();

    assert!(!report.committed);
    assert_eq!(report.imported, 0);
    assert!(report
        .report
        .iter()
        .any(|entry| entry.code == "annotation_id_conflict"));
    assert_eq!(attempt_count(&conn), 1);
    let owner: Option<String> = conn
        .query_row(
            "SELECT attempt_id FROM attempt_annotations WHERE id = 'shared-annotation'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(owner.as_deref(), Some("local"));
}

#[test]
fn annotation_asset_references_are_materialized_for_full_backup_integrity() {
    let (_dir, conn) = open_db();
    let mut imported = reading_attempt("with-detached-annotation", "asset-attempt");
    imported.annotations[0].asset_id = "asset-annotation-only".into();

    let report = import_reading_archive_value(
        &conn,
        &canonical_archive(vec![serde_json::to_value(imported).unwrap()]),
    )
    .unwrap();

    assert!(report.committed);
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT EXISTS(SELECT 1 FROM practice_assets WHERE id = 'asset-annotation-only')",
            [],
            |row| row.get(0),
        )
        .unwrap(),
        1
    );
    assert!(create_backup_package(&conn, "archive-test").is_ok());
}
