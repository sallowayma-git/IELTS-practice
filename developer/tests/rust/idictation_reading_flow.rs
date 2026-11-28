use super::*;
use ielts_db::coach::{ensure_coach_thread, EnsureCoachThreadCommand};

#[test]
fn official_reading_result_survives_reopen_and_resolves_through_local_coach() {
    let source: Value =
        serde_json::from_str(include_str!("../fixtures/idictation/observed-exams.json")).unwrap();
    let sample: Value = serde_json::from_str(include_str!(
        "../fixtures/idictation/observed-reading-result.json"
    ))
    .unwrap();
    let exam = exam::convert(Subject::Reading, "2101", &source["reading"]).unwrap();
    let asset_id = format!("{PREFIX}fixture");
    let dir = tempfile::tempdir().unwrap();
    let options = ielts_db::DbOpenOptions::create(dir.path().join("reading.sqlite"));
    let mut conn = ielts_db::open_connection(&options).unwrap();
    ielts_db::migrate(&mut conn).unwrap();
    let path = dir.path().join("exam.json");
    let mut payload = exam.payload.clone();
    payload["examId"] = json!(asset_id);
    payload["answerKey"] = json!(exam.official_answers);
    std::fs::write(&path, payload.to_string()).unwrap();
    let asset =
        reading::import_asset_payload(&conn, &payload, Some(path.to_string_lossy().into_owned()))
            .unwrap();
    assert_eq!(
        reading::load_practice_asset_payload_for_view(&conn, &asset_id)
            .unwrap()
            .payload["answerKey"],
        json!({})
    );
    let (answers, marks) = resume_answers(&exam, "7", &sample["result"]).unwrap();
    assert_eq!(answers["q1"], "mining");
    assert_eq!(answers["q8"], "T");
    assert!(marks.is_empty());
    let draft = ReadingDraftCommand {
        attempt_id: "source-fixture-attempt".into(),
        asset_id: asset_id.clone(),
        answers: json!(answers),
        marked_questions: marks,
        question_timeline: vec![],
        asset_revision: Some(asset.schema_version),
        asset_fingerprint: Some(asset.fingerprint.clone()),
        title_snapshot: None,
        timer_snapshot: None,
        idempotency_key: "draft-fixture".into(),
    };
    reading::save_reading_draft(&conn, &draft).unwrap();
    let local_submit = ReadingSubmitCommand {
        attempt_id: draft.attempt_id.clone(),
        asset_id: asset_id.clone(),
        answers: draft.answers.clone(),
        marked_questions: vec![],
        question_timeline: vec![],
        asset_revision: draft.asset_revision,
        asset_fingerprint: draft.asset_fingerprint.clone(),
        duration_ms: None,
        title_snapshot: None,
        idempotency_key: "local-submit".into(),
    };
    assert!(reading::submit_reading_attempt(&conn, &local_submit)
        .unwrap_err()
        .to_string()
        .contains("官方交卷"));
    let mut verified =
        exam::result::verify_reading(&exam, "7", &asset_id, &sample["request"], &sample["result"])
            .unwrap();
    verified.attempt.id = draft.attempt_id.clone();
    let tx = conn.transaction().unwrap();
    ielts_db::persist_completed_attempt(&tx, &verified.attempt, &asset.fingerprint).unwrap();
    tx.commit().unwrap();
    drop(conn);
    let conn = ielts_db::open_connection(&options).unwrap();
    let detail = ielts_db::get_history_detail(&conn, &draft.attempt_id).unwrap();
    assert_eq!(detail.attempt.correct_count, Some(2.0));
    assert!(reading::get_open_reading_draft(&conn, &asset_id)
        .unwrap()
        .is_none());
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some(draft.attempt_id),
            asset_id: Some(asset_id),
            kind: "chat".into(),
        },
    )
    .unwrap();
    let coach = ielts_db::coach::resolve_reading_coach_context(&conn, &thread.id, None).unwrap();
    assert_eq!(coach.evidence["result"]["correctCount"], 2.0);
    assert!(coach.evidence["result"]["answers"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["correctAnswer"] == "mining"));
    assert!(!coach.evidence["evidenceLimitations"]
        .as_array()
        .unwrap()
        .is_empty());
}
