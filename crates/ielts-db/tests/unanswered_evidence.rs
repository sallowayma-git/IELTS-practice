//! A blank answer is scored wrong on the exam sheet, but it is not evidence of
//! a weak skill. Unanswered questions must not become negative outcomes,
//! mastery drops, weekly misses or repeat transitions, and the review page's
//! unanswered count must come from the same rule.

use chrono::{DateTime, Utc};
use ielts_db::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("blank.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let path = dir.path().join("blank.json");
    let payload = json!({
        "examId": "P1", "meta": {"title": "Passage P1", "category": "P1"},
        "questionCount": 5, "questionOrder": ["q1", "q2", "q3", "q4", "q5"],
        "answerKey": {"q1": "TRUE", "q2": "FALSE", "q3": "NOT GIVEN", "q4": "TRUE", "q5": "B"},
        "questionGroups": [
            {"kind": "tfng", "questionIds": ["q1", "q2", "q3", "q4"]},
            {"kind": "matching", "questionIds": ["q5"]}
        ]
    });
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();
    (dir, conn)
}

fn submit(conn: &Connection, attempt: &str, answers: Value) -> ReadingSubmitResult {
    let command = json!({
        "attemptId": attempt, "assetId": "P1", "answers": answers, "idempotencyKey": attempt,
        "durationMs": 120_000
    });
    let result = submit_reading_attempt(conn, &serde_json::from_value(command).unwrap()).unwrap();
    conn.execute(
        "UPDATE learning_events SET occurred_at = '2026-10-05T09:00:00Z' WHERE attempt_id = ?1",
        params![attempt],
    )
    .unwrap();
    conn.execute(
        "UPDATE attempts SET completed_at = '2026-10-05T09:00:00Z' WHERE id = ?1",
        params![attempt],
    )
    .unwrap();
    result
}

/// Four blank TFNG answers (empty, whitespace-only, empty list, missing) and one
/// correct matching answer.
fn submit_blank_tfng(conn: &Connection) -> ReadingSubmitResult {
    submit(conn, "a1", json!({"q1": "", "q2": "   ", "q3": [], "q5": "B"}))
}

fn outcome_rows(conn: &Connection) -> Vec<(Option<String>, Option<f64>, Option<String>)> {
    let mut statement = conn
        .prepare(
            "SELECT polarity, value_num, value_text FROM learner_observations
             WHERE observation_type = 'reading.question.outcome' ORDER BY scope_key",
        )
        .unwrap();
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap();
    rows.collect::<Result<_, _>>().unwrap()
}

#[test]
fn blank_tfng_answers_are_unanswered_not_tfng_mistakes() {
    let (_dir, conn) = fixture();
    let result = submit_blank_tfng(&conn);

    // The exam sheet is unchanged: blanks still score zero.
    assert_eq!(result.score.correct, 1.0);
    assert_eq!(result.score.total, 5.0);
    // The review page's unanswered count has a source.
    assert_eq!(result.analysis_signals.question_count, 5);
    assert_eq!(result.analysis_signals.answered_count, 1);
    assert_eq!(result.analysis_signals.unanswered_count, 4);
    let wire = serde_json::to_value(&result).unwrap();
    assert_eq!(wire["analysisSignals"]["unansweredCount"], 4);

    learning_observations_rebuild(&conn).unwrap();
    let outcomes = outcome_rows(&conn);
    assert_eq!(outcomes.len(), 5);
    let unanswered = (None, None, Some("unanswered".to_string()));
    assert_eq!(outcomes.iter().filter(|row| **row == unanswered).count(), 4);
    assert_eq!(outcomes.iter().filter(|row| row.0.as_deref() == Some("negative")).count(), 0);
    assert_eq!(outcomes.iter().filter(|row| row.0.as_deref() == Some("positive")).count(), 1);

    let score_payload: String = conn
        .query_row(
            "SELECT payload_json FROM learner_observations WHERE observation_type = 'reading.attempt.score'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let score_payload: Value = serde_json::from_str(&score_payload).unwrap();
    assert_eq!(score_payload["answeredCount"], 1);
    assert_eq!(score_payload["unansweredCount"], 4);

    // No TFNG skill evidence at all, so no mastery drop.
    learner_model_rebuild(&conn).unwrap();
    let tfng: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_skill_observations WHERE skill_key = 'reading.tfng'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tfng, 0);
    let wrong: i64 = conn
        .query_row("SELECT COUNT(*) FROM learner_skill_observations WHERE outcome < 0.5", [], |row| row.get(0))
        .unwrap();
    assert_eq!(wrong, 0);
    assert!(learner_model_verify(&conn).unwrap().consistent);

    // The weekly pack sees no TFNG misses, only the count on the attempt line.
    let pack = weekly_pack(&conn, "local", at("2026-10-03T00:00:00Z"), at("2026-10-10T00:00:00Z")).unwrap();
    assert!(pack.lines.iter().all(|line| line.kind != "miss"));
    assert_eq!(pack.header["reading"]["wrongQuestions"], 0);
    assert_eq!(pack.header["reading"]["byQuestionType"], json!({}));
    let attempt = pack.lines.iter().find(|line| line.kind == "reading").unwrap();
    assert!(attempt.text.ends_with("correct 1/5, 4 unanswered, attempt #1"), "{}", attempt.text);
    assert_eq!(pack.observation_count, 1);
}

#[test]
fn a_blank_between_two_wrong_answers_is_not_a_repeat_transition() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE"}));
    submit(&conn, "a2", json!({"q1": ""}));
    learning_observations_rebuild(&conn).unwrap();
    let transitions: Vec<String> = conn
        .prepare(
            "SELECT observation_type FROM learner_observations
             WHERE observation_type LIKE 'reading.repeat.%' AND scope_key = 'P1:q1'",
        )
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    // a2 left q1 blank: "still wrong" would fabricate a repeated error.
    assert!(transitions.is_empty(), "{transitions:?}");
}

#[test]
fn replayed_submit_derives_the_unanswered_count() {
    let (_dir, conn) = fixture();
    submit_blank_tfng(&conn);
    // A response stored before analysisSignals existed.
    let stored: String = conn
        .query_row("SELECT response_json FROM attempt_idempotency WHERE scope = 'reading.submit'", [], |row| row.get(0))
        .unwrap();
    let mut stored: Value = serde_json::from_str(&stored).unwrap();
    stored.as_object_mut().unwrap().remove("analysisSignals");
    conn.execute(
        "UPDATE attempt_idempotency SET response_json = ?1 WHERE scope = 'reading.submit'",
        params![stored.to_string()],
    )
    .unwrap();
    let command = json!({"attemptId": "a1", "assetId": "P1", "answers": {}, "idempotencyKey": "a1"});
    let replay = submit_reading_attempt(&conn, &serde_json::from_value(command).unwrap()).unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(replay.analysis_signals.unanswered_count, 4);
}

#[test]
fn events_recorded_before_the_split_still_verify_and_replay() {
    let (_dir, conn) = fixture();
    submit_blank_tfng(&conn);
    // Rewrite the ledger as the previous build recorded it: no answered markers,
    // answeredCount counting every question.
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT id, payload_json FROM learning_events")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for (id, payload) in rows {
        let mut payload: Value = serde_json::from_str(&payload).unwrap();
        let object = payload.as_object_mut().unwrap();
        object.remove("answered");
        object.remove("answeredCount");
        object.remove("unansweredCount");
        if let Some(timeline) = object.get_mut("timelineSummary") {
            timeline["answeredCount"] = json!(5);
        }
        let json = payload.to_string();
        let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
        conn.execute(
            "UPDATE learning_events SET payload_json = ?1, content_hash = ?2 WHERE id = ?3",
            params![json, hash, id],
        )
        .unwrap();
    }
    let verify = learning_events_verify(&conn).unwrap();
    assert!(verify.consistent, "{verify:?}");
    let rebuilt = learning_events_rebuild(&conn, 100).unwrap();
    assert_eq!(rebuilt.inserted_events, 0);
    assert_eq!(rebuilt.existing_events, 6);
    // Legacy rows keep their recorded meaning; they are not rewritten.
    learning_observations_rebuild(&conn).unwrap();
    assert!(learning_observations_verify(&conn).unwrap().consistent);
}
