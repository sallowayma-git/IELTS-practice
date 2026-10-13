//! Deterministic post-submit reading review analysis reaches both the fresh
//! submit response and the history detail used to reopen a past attempt.
use ielts_db::*;
use rusqlite::Connection;
use serde_json::{json, Value};

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("analysis.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let path = dir.path().join("P1.json");
    let payload = json!({"examId": "P1", "meta": {"title": "P1", "category": "P1"},
        "questionCount": 4, "questionOrder": ["q1", "q2", "q3", "q4"],
        "answerKey": {"q1": "TRUE", "q2": "FALSE", "q3": "A", "q4": "B"},
        "passage": {"blocks": [{"html": "<p>Analysis passage</p>"}]},
        "questionGroups": [
            {"kind": "true_false_not_given", "questionIds": ["q1", "q2"]},
            {"kind": "matching", "questionIds": ["q3", "q4"]}
        ]});
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();
    (dir, conn)
}

fn submit(conn: &Connection, timeline: Value, key: &str) -> ReadingSubmitResult {
    let cmd = json!({
        "attemptId": "analysis-attempt",
        "assetId": "P1",
        // q1 correct, q2 wrong, q3 blank, q4 wrong
        "answers": {"q1": "TRUE", "q2": "TRUE", "q3": "", "q4": "C"},
        "markedQuestions": ["q2"],
        "questionTimeline": timeline,
        "durationMs": 120000,
        "idempotencyKey": key
    });
    submit_reading_attempt(conn, &serde_json::from_value(cmd).unwrap()).unwrap()
}

#[test]
fn submit_and_history_detail_return_deterministic_analysis() {
    let (_dir, conn) = fixture();
    let result = submit(
        &conn,
        json!([
            {"questionId": "q1", "visitCount": 1, "elapsedMs": 10000},
            {"questionId": "q2", "visitCount": 2, "changeCount": 1, "elapsedMs": 40000},
            {"questionId": "q4", "visitCount": 1, "elapsedMs": 20000}
        ]),
        "submit-1",
    );

    let signals = result.analysis_signals.clone().expect("signals on submit");
    assert_eq!(signals.unanswered_count, 1, "blank q3 is unanswered");
    assert_eq!(signals.incorrect_count, 2);
    assert_eq!(signals.correct_count, 1);
    assert_eq!(signals.marked_question_count, 1);
    assert_eq!(signals.changed_answer_count, Some(1));
    assert_eq!(signals.interaction_density, Some(2.5));
    let analysis = result.single_attempt_analysis.clone().expect("analysis on submit");
    assert!(!analysis.diagnosis.is_empty());
    assert!(!analysis.next_actions.is_empty());
    assert_eq!(analysis.radar.by_question_kind.len(), 2);

    // Wire shape the Vue review panel reads.
    let wire = serde_json::to_value(&result).unwrap();
    assert_eq!(wire["analysisSignals"]["unansweredCount"], 1);
    assert_eq!(wire["analysisSignals"]["changedAnswerCount"], 1);
    let row = &wire["singleAttemptAnalysis"]["radar"]["byQuestionKind"][0];
    assert_eq!(row["kind"], "matching");
    assert_eq!(row["total"], 2);
    assert_eq!(row["correct"], 0);
    assert_eq!(row["accuracy"], 0.0);
    assert!(wire["singleAttemptAnalysis"]["diagnosis"][0]["type"].is_string());
    assert!(wire["singleAttemptAnalysis"]["diagnosis"][0]["severity"].is_string());
    assert!(wire["singleAttemptAnalysis"]["diagnosis"][0]["message"].is_string());
    assert!(wire["singleAttemptAnalysis"]["nextActions"][0]["instruction"].is_string());

    // Reopening the attempt (getState → history detail) derives the same analysis.
    let detail = get_history_detail(&conn, "analysis-attempt").unwrap();
    assert_eq!(detail.analysis_signals.as_ref(), Some(&signals));
    assert_eq!(detail.single_attempt_analysis.as_ref(), Some(&analysis));

    // Idempotent replay carries it too.
    let replay = submit(&conn, json!([]), "submit-1");
    assert!(replay.idempotent_replay);
    assert_eq!(replay.analysis_signals, Some(signals));
    assert_eq!(replay.single_attempt_analysis, Some(analysis));
}

#[test]
fn submit_without_timeline_reports_null_change_metrics() {
    let (_dir, conn) = fixture();
    let result = submit(&conn, json!([]), "submit-no-timeline");
    let wire = serde_json::to_value(&result).unwrap();
    assert!(wire["analysisSignals"]["changedAnswerCount"].is_null());
    assert!(wire["analysisSignals"]["interactionDensity"].is_null());
    assert_eq!(wire["analysisSignals"]["unansweredCount"], 1);
    assert_eq!(wire["analysisSignals"]["markedQuestionCount"], 1);
    let detail = serde_json::to_value(get_history_detail(&conn, "analysis-attempt").unwrap()).unwrap();
    assert!(detail["analysisSignals"]["changedAnswerCount"].is_null());
    assert_eq!(detail["singleAttemptAnalysis"], wire["singleAttemptAnalysis"]);
}
