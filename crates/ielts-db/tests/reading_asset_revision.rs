//! Submission revision authority through real single/suite/endless adapters.
use ielts_db::*;
use rusqlite::Connection;
use serde_json::{json, Value};

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("revision.db"))).unwrap();
    migrate(&mut conn).unwrap();
    for category in ["P1", "P2", "P3"] {
        import(&conn, &dir, category, "TRUE");
    }
    (dir, conn)
}

fn import(conn: &Connection, dir: &tempfile::TempDir, id: &str, answer: &str) {
    let path = dir.path().join(format!("{id}.json"));
    let payload = json!({"examId": id, "meta": {"title": id, "category": id},
        "questionCount": 1, "questionOrder": ["q1"], "answerKey": {"q1": answer},
        "passage": {"blocks": [{"html": format!("<p>Revision supports {answer}</p>")}]},
        "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}]});
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(conn, &path).unwrap();
}

fn submit(conn: &Connection, mode: &str) -> (ReadingSubmitResult, Value) {
    let base = json!({"assetId": "P1", "answers": {"q1": "FALSE"}, "idempotencyKey": mode});
    match mode {
        "suite" => {
            let session = create_suite_session(
                conn,
                &serde_json::from_value(json!({
                    "sequence": [{"assetId": "P1"}, {"assetId": "P2"}, {"assetId": "P3"}]
                }))
                .unwrap(),
            )
            .unwrap();
            let mut cmd = base;
            cmd["suiteId"] = json!(session.session_id);
            (
                submit_suite_passage(conn, &serde_json::from_value(cmd.clone()).unwrap())
                    .unwrap()
                    .submission,
                cmd,
            )
        }
        "endless" => {
            let session = create_endless_session(
                conn,
                &serde_json::from_value(json!({
                    "poolPolicy": {"categories": ["P1"]}
                }))
                .unwrap(),
            )
            .unwrap();
            let mut cmd = base;
            cmd["sessionId"] = json!(session.id);
            (
                submit_endless_passage(conn, &serde_json::from_value(cmd.clone()).unwrap())
                    .unwrap()
                    .submission,
                cmd,
            )
        }
        _ => {
            let mut cmd = base;
            cmd["attemptId"] = json!("single-attempt");
            (
                submit_reading_attempt(conn, &serde_json::from_value(cmd.clone()).unwrap())
                    .unwrap(),
                cmd,
            )
        }
    }
}

fn revision(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT submitted_asset_fingerprint FROM attempts WHERE id=?1",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn all_real_modes_bind_scoring_revision_and_replay_never_rebinds_after_reimport() {
    for mode in ["single", "suite", "endless"] {
        let (dir, conn) = fixture();
        let expected = load_practice_asset_payload(&conn, "P1")
            .unwrap()
            .asset
            .fingerprint;
        let (result, cmd) = submit(&conn, mode);
        assert_eq!(result.attempt.answers[0].is_correct, Some(false));
        assert_eq!(
            revision(&conn, &result.attempt.id).as_deref(),
            Some(expected.as_str())
        );
        let thread = ensure_coach_thread(
            &conn,
            &EnsureCoachThreadCommand {
                thread_id: None,
                attempt_id: Some(result.attempt.id.clone()),
                asset_id: None,
                kind: "practice".into(),
            },
        )
        .unwrap();
        let context = resolve_reading_coach_context(&conn, &thread.id, None).unwrap();
        assert_eq!(context.evidence["identity"]["assetFingerprint"], expected);
        assert_eq!(context.evidence["evidenceLimitations"], json!([]));
        import(&conn, &dir, "P1", "FALSE");
        assert_ne!(
            load_practice_asset_payload(&conn, "P1")
                .unwrap()
                .asset
                .fingerprint,
            expected
        );
        let replay = match mode {
            "suite" => {
                submit_suite_passage(&conn, &serde_json::from_value(cmd).unwrap())
                    .unwrap()
                    .submission
            }
            "endless" => {
                submit_endless_passage(&conn, &serde_json::from_value(cmd).unwrap())
                    .unwrap()
                    .submission
            }
            _ => submit_reading_attempt(&conn, &serde_json::from_value(cmd).unwrap()).unwrap(),
        };
        assert!(replay.idempotent_replay);
        assert_eq!(replay.attempt.answers[0].is_correct, Some(false));
        assert_eq!(
            revision(&conn, &result.attempt.id).as_deref(),
            Some(expected.as_str())
        );
        assert!(resolve_reading_coach_context(&conn, &thread.id, None)
            .unwrap_err()
            .to_string()
            .contains("submitted asset fingerprint mismatch"));
        // Restoring the exact submitted bytes restores trustworthy evidence.
        import(&conn, &dir, "P1", "TRUE");
        assert!(resolve_reading_coach_context(&conn, &thread.id, None).is_ok());
    }
}

#[test]
fn failed_submission_rolls_back_revision_answers_and_attempt_for_all_modes() {
    for mode in ["single", "suite", "endless"] {
        let (_dir, conn) = fixture();
        conn.execute_batch("CREATE TRIGGER reject_revision BEFORE UPDATE OF submitted_asset_fingerprint ON attempts
            BEGIN SELECT RAISE(ABORT, 'revision failure'); END;").unwrap();
        // Prepare mode owners before invoking the actual submission.
        let mut cmd = json!({"assetId": "P1", "answers": {"q1": "FALSE"}, "idempotencyKey": mode});
        let error = match mode {
            "suite" => {
                let session = create_suite_session(
                    &conn,
                    &serde_json::from_value(json!({
                        "sequence": [{"assetId": "P1"}, {"assetId": "P2"}, {"assetId": "P3"}]
                    }))
                    .unwrap(),
                )
                .unwrap();
                cmd["suiteId"] = json!(session.session_id);
                submit_suite_passage(&conn, &serde_json::from_value(cmd).unwrap())
                    .unwrap_err()
                    .to_string()
            }
            "endless" => {
                let session = create_endless_session(
                    &conn,
                    &serde_json::from_value(json!({
                        "poolPolicy": {"categories": ["P1"]}
                    }))
                    .unwrap(),
                )
                .unwrap();
                cmd["sessionId"] = json!(session.id);
                submit_endless_passage(&conn, &serde_json::from_value(cmd).unwrap())
                    .unwrap_err()
                    .to_string()
            }
            _ => {
                cmd["attemptId"] = json!("single-attempt");
                submit_reading_attempt(&conn, &serde_json::from_value(cmd).unwrap())
                    .unwrap_err()
                    .to_string()
            }
        };
        assert!(error.contains("revision failure"));
        for table in ["attempts", "attempt_answers"] {
            assert_eq!(
                conn.query_row::<i64, _, _>(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get(0))
                    .unwrap(),
                0
            );
        }
    }
}

#[test]
fn legacy_history_uses_retained_results_without_loading_replaced_or_missing_source() {
    let (dir, conn) = fixture();
    let (result, _) = submit(&conn, "single");
    conn.execute(
        "UPDATE attempts SET submitted_asset_fingerprint=NULL WHERE id=?1",
        [&result.attempt.id],
    )
    .unwrap();
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some(result.attempt.id.clone()),
            asset_id: None,
            kind: "practice".into(),
        },
    )
    .unwrap();
    import(&conn, &dir, "P1", "FALSE");
    std::fs::remove_file(dir.path().join("P1.json")).unwrap();
    let context = resolve_reading_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"focusQuestionIds": ["q1"]})),
    )
    .unwrap();
    assert!(context.evidence["source"].is_null());
    assert!(context.evidence["identity"]["assetFingerprint"].is_null());
    assert_eq!(context.evidence["result"]["answers"][0]["isCorrect"], false);
    assert_eq!(
        context.evidence["evidenceLimitations"][0]["code"],
        "submission_asset_revision_unavailable"
    );
    let display = resolve_reading_coach_context(
        &conn,
        &thread.id,
        Some(
            &json!({"focusQuestionNumbers": ["1"], "selectedContext": {"questionNumbers": ["14"]}}),
        ),
    )
    .unwrap();
    assert!(display.evidence["source"].is_null());
    assert_eq!(display.message_metadata["focusQuestionIds"], json!([]));
    assert!(resolve_reading_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"focusQuestionIds": ["q99"]}))
    )
    .is_err());
}

#[test]
fn full_backup_roundtrip_preserves_submission_revision() {
    let (_dir, conn) = fixture();
    let (result, _) = submit(&conn, "single");
    let expected = revision(&conn, &result.attempt.id);
    let package = create_backup_package(&conn, "revision-test").unwrap();
    let (_target_dir, target) = fixture();
    let report = import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(revision(&target, &result.attempt.id), expected);
}

#[test]
fn migration_does_not_invent_a_revision_for_existing_completed_history() {
    let (_dir, mut conn) = fixture();
    let (result, _) = submit(&conn, "single");
    conn.execute_batch(
        "ALTER TABLE attempts DROP COLUMN submitted_asset_fingerprint;
        DELETE FROM schema_migrations WHERE version=26;",
    )
    .unwrap();
    assert_eq!(migrate(&mut conn).unwrap(), vec![26]);
    verify_idempotent(&mut conn).unwrap();
    assert!(revision(&conn, &result.attempt.id).is_none());
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some(result.attempt.id),
            asset_id: None,
            kind: "practice".into(),
        },
    )
    .unwrap();
    let context = resolve_reading_coach_context(&conn, &thread.id, None).unwrap();
    assert!(context.evidence["source"].is_null());
}

#[test]
fn pre_revision_full_backup_restores_as_unversioned_history() {
    let (_dir, source) = fixture();
    let (result, _) = submit(&source, "single");
    source
        .execute_batch(
            "ALTER TABLE attempts DROP COLUMN submitted_asset_fingerprint;
        DELETE FROM schema_migrations WHERE version=26;",
        )
        .unwrap();
    let package = create_backup_package(&source, "pre-revision-test").unwrap();
    let (_target_dir, target) = fixture();
    let report = import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert!(revision(&target, &result.attempt.id).is_none());
}
