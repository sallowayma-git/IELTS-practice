use std::collections::BTreeSet;

use ielts_db::{
    delete_attempt, learning_observations_rebuild, learning_observations_verify, migrate,
    open_connection, DbOpenOptions,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[test]
fn replay_is_idempotent_and_reading_transitions_are_golden() {
    let (_dir, conn) = open_db();
    insert_reading_question(
        &conn,
        "corrected-before",
        "q-corrected",
        "2026-08-12T00:00:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "corrected-after",
        "q-corrected",
        "2026-08-12T00:30:00Z",
        Some(true),
    );
    insert_reading_question(
        &conn,
        "wrong-before",
        "q-still-wrong",
        "2026-08-12T01:00:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "wrong-after",
        "q-still-wrong",
        "2026-08-12T01:30:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "regress-before",
        "q-newly-wrong",
        "2026-08-12T02:00:00Z",
        Some(true),
    );
    insert_reading_question(
        &conn,
        "regress-after",
        "q-newly-wrong",
        "2026-08-12T02:30:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "steady-before",
        "q-still-correct",
        "2026-08-12T03:00:00Z",
        Some(true),
    );
    insert_reading_question(
        &conn,
        "steady-after",
        "q-still-correct",
        "2026-08-12T03:30:00Z",
        Some(true),
    );
    insert_reading_attempt(&conn, "reading-attempt", "2026-08-12T04:00:00Z", 0.75);

    let first = learning_observations_rebuild(&conn).unwrap();
    let first_ids = observation_ids(&conn);
    assert_eq!(
        first.output_hash,
        "51554e40ee953c2a8524f889f2deb5d45a6efde6e007e59f8116d2a7c97f57db"
    );
    let repeat_types = observation_types(&conn, "reading.repeat.%");
    assert_eq!(
        repeat_types,
        BTreeSet::from([
            "reading.repeat.corrected".to_string(),
            "reading.repeat.newly_wrong".to_string(),
            "reading.repeat.still_correct".to_string(),
            "reading.repeat.still_wrong".to_string(),
        ])
    );
    assert!(observation_types(&conn, "reading.question.%").contains("reading.question.outcome"));
    assert!(observation_types(&conn, "reading.attempt.%").contains("reading.attempt.score"));
    assert!(first.output_count > 0);

    let second = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(first.input_hash, second.input_hash);
    assert_eq!(first.output_hash, second.output_hash);
    assert_eq!(first_ids, observation_ids(&conn));
    assert!(learning_observations_verify(&conn).unwrap().consistent);
}

#[test]
fn unscored_question_does_not_reset_last_scored_transition() {
    let (_dir, conn) = open_db();
    insert_reading_question(
        &conn,
        "unscored-before",
        "q-unscored-gap",
        "2026-08-12T05:00:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "unscored-middle",
        "q-unscored-gap",
        "2026-08-12T05:30:00Z",
        None,
    );
    insert_reading_question(
        &conn,
        "unscored-after",
        "q-unscored-gap",
        "2026-08-12T06:00:00Z",
        Some(true),
    );

    learning_observations_rebuild(&conn).unwrap();

    let repeat_types = observation_types(&conn, "reading.repeat.%");
    assert_eq!(
        repeat_types,
        BTreeSet::from(["reading.repeat.corrected".to_string()])
    );
    let unscored_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observations
             WHERE observation_type = 'reading.question.outcome'
               AND value_text = 'unscored'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unscored_count, 1);
}

#[test]
fn scored_transition_semantics_cover_all_unscored_goldens() {
    let cases = [
        (
            "wrong-gap-correct",
            vec![Some(false), None, Some(true)],
            Some("reading.repeat.corrected"),
        ),
        (
            "correct-gap-wrong",
            vec![Some(true), None, Some(false)],
            Some("reading.repeat.newly_wrong"),
        ),
        ("gap-first-correct", vec![None, Some(true)], None),
        ("two-unscored", vec![None, None], None),
    ];
    for (case, outcomes, expected_transition) in cases {
        let (_dir, conn) = open_db();
        let expected_unscored = outcomes.iter().filter(|value| value.is_none()).count() as i64;
        for (index, outcome) in outcomes.into_iter().enumerate() {
            insert_reading_question_at_ordinal(
                &conn,
                &format!("{case}-{index}"),
                case,
                &format!("2026-08-12T07:{:02}:00Z", index * 10),
                outcome,
                (index + 1) as u64,
            );
        }
        learning_observations_rebuild(&conn).unwrap();
        let transitions = observation_types(&conn, "reading.repeat.%");
        assert_eq!(
            transitions,
            expected_transition
                .map(|value| BTreeSet::from([value.to_owned()]))
                .unwrap_or_default(),
            "case {case}"
        );
        let unscored_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM learner_observations
                 WHERE observation_type='reading.question.outcome' AND value_text='unscored'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            unscored_count,
            expected_unscored,
            "case {case}"
        );
    }
}

#[test]
fn event_insert_order_does_not_change_projection_hash() {
    let (_dir, conn) = open_db();
    let events = vec![
        ("shuffle-after", "q1", "2026-08-12T00:30:00Z", Some(true)),
        ("shuffle-before", "q1", "2026-08-12T00:00:00Z", Some(false)),
    ];
    for event in &events {
        insert_reading_question(&conn, event.0, event.1, event.2, event.3);
    }
    let first = learning_observations_rebuild(&conn).unwrap();
    conn.execute("DELETE FROM learner_observations", [])
        .unwrap();
    conn.execute("DELETE FROM learning_events", []).unwrap();
    for event in events.iter().rev() {
        insert_reading_question(&conn, event.0, event.1, event.2, event.3);
    }
    let second = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(first.input_hash, second.input_hash);
    assert_eq!(first.output_hash, second.output_hash);
}

#[test]
fn same_timestamp_uses_attempt_ordinal_instead_of_random_event_id() {
    let (_dir, conn) = open_db();
    insert_reading_question_at_ordinal(
        &conn,
        "z-first-event-id",
        "q1",
        "2026-08-12T00:00:00Z",
        Some(false),
        1,
    );
    insert_reading_question_at_ordinal(
        &conn,
        "a-second-event-id",
        "q1",
        "2026-08-12T00:00:00Z",
        Some(true),
        2,
    );

    learning_observations_rebuild(&conn).unwrap();
    assert_eq!(
        observation_types(&conn, "reading.repeat.%"),
        BTreeSet::from(["reading.repeat.corrected".to_string()])
    );
}

#[test]
fn deleting_ledger_evidence_removes_derived_observations_without_orphans() {
    let (_dir, conn) = open_db();
    insert_reading_question(
        &conn,
        "cascade-before",
        "q1",
        "2026-08-12T00:00:00Z",
        Some(false),
    );
    insert_reading_question(
        &conn,
        "cascade-after",
        "q1",
        "2026-08-12T00:30:00Z",
        Some(true),
    );
    learning_observations_rebuild(&conn).unwrap();
    conn.execute(
        "DELETE FROM learning_events WHERE id = 'cascade-before'",
        [],
    )
    .unwrap();

    let orphan_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observations o
             LEFT JOIN learner_observation_evidence e ON e.observation_id = o.id
             WHERE e.observation_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let deleted_evidence_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observation_evidence WHERE event_id = 'cascade-before'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let repeat_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observations WHERE observation_type LIKE 'reading.repeat.%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(orphan_count, 0);
    assert_eq!(deleted_evidence_count, 0);
    assert_eq!(repeat_count, 0);
}

#[test]
fn deleting_middle_attempt_rebuilds_adjacent_repeat_transition() {
    let (_dir, conn) = open_db();
    insert_test_attempt(&conn, "attempt-a", "2026-08-12T00:00:00Z");
    insert_test_attempt(&conn, "attempt-b", "2026-08-12T00:30:00Z");
    insert_test_attempt(&conn, "attempt-c", "2026-08-12T01:00:00Z");
    insert_reading_question_for_attempt(
        &conn,
        "event-a",
        "attempt-a",
        "q1",
        "2026-08-12T00:00:00Z",
        Some(false),
        1,
    );
    insert_reading_question_for_attempt(
        &conn,
        "event-b",
        "attempt-b",
        "q1",
        "2026-08-12T00:30:00Z",
        Some(true),
        2,
    );
    insert_reading_question_for_attempt(
        &conn,
        "event-c",
        "attempt-c",
        "q1",
        "2026-08-12T01:00:00Z",
        Some(false),
        3,
    );
    learning_observations_rebuild(&conn).unwrap();
    assert_eq!(
        observation_types(&conn, "reading.repeat.%"),
        BTreeSet::from([
            "reading.repeat.corrected".to_string(),
            "reading.repeat.newly_wrong".to_string(),
        ])
    );

    assert!(delete_attempt(&conn, "attempt-b").unwrap());
    let report = learning_observations_verify(&conn).unwrap();
    assert!(report.consistent, "{:?}", report.mismatches);
    assert_eq!(
        observation_types(&conn, "reading.repeat.%"),
        BTreeSet::from(["reading.repeat.still_wrong".to_string()])
    );
    let payload: String = conn
        .query_row(
            "SELECT payload_json FROM learner_observations
             WHERE observation_type = 'reading.repeat.still_wrong'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(payload.contains("event-a"));
    assert!(payload.contains("event-c"));
}

#[test]
fn corrupted_and_sensitive_events_are_reported_without_inference() {
    let (_dir, conn) = open_db();
    insert_raw_event(
        &conn,
        "corrupt",
        "reading_question_outcome",
        Some("reading"),
        Some("asset-1"),
        Some("q1"),
        "2026-08-12T00:00:00Z",
        "{not-json",
        "normal",
    );
    insert_reading_question(
        &conn,
        "hash-corrupt",
        "q-hash",
        "2026-08-12T00:00:30Z",
        Some(true),
    );
    conn.execute(
        "UPDATE learning_events SET content_hash = 'not-the-payload-hash' WHERE id = 'hash-corrupt'",
        [],
    )
    .unwrap();
    insert_raw_event(
        &conn,
        "bad-shape",
        "reading_question_outcome",
        Some("reading"),
        Some("asset-1"),
        Some("q-bad-shape"),
        "2026-08-12T00:00:45Z",
        &json!({
            "attemptId": "attempt-bad-shape",
            "assetId": "asset-1",
            "questionId": "q-bad-shape",
            "attemptOrdinal": 2,
            "isCorrect": false,
            "questionKind": "mcq",
            "changeCount": "one",
            "visitCount": 1,
            "elapsedMs": 100,
            "firstTryCorrect": false
        })
        .to_string(),
        "normal",
    );
    insert_reading_question_with_sensitivity(
        &conn,
        "private",
        "q-private",
        "2026-08-12T00:01:00Z",
        Some(false),
        "private",
    );
    insert_reading_question_with_sensitivity(
        &conn,
        "restricted",
        "q-restricted",
        "2026-08-12T00:01:15Z",
        Some(true),
        "restricted",
    );
    insert_reading_question(
        &conn,
        "future-schema",
        "q-future",
        "2026-08-12T00:01:30Z",
        Some(true),
    );
    conn.execute(
        "UPDATE learning_events SET schema_version = 2 WHERE id = 'future-schema'",
        [],
    )
    .unwrap();
    insert_writing(
        &conn,
        "writing-failed",
        "failed",
        "2026-08-12T00:02:00Z",
        Value::Null,
        Value::Null,
    );
    insert_writing(
        &conn,
        "writing-degraded",
        "degraded",
        "2026-08-12T00:03:00Z",
        json!({
            "overall": 6.5,
            "taskResponse": 6.0,
            "coherence": 6.5,
            "lexical": 6.0,
            "grammar": 6.5
        }),
        json!({
            "reason": "review_unavailable",
            "stage": "reviewing",
            "missing": ["feedback", "sentences"]
        }),
    );
    insert_coach(
        &conn,
        "coach-question",
        "coach_question_asked",
        "2026-08-12T00:04:00Z",
    );
    insert_coach(
        &conn,
        "coach-response",
        "coach_response_generated",
        "2026-08-12T00:05:00Z",
    );

    let report = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(report.quarantined, 4);
    assert_eq!(report.skipped_sensitive, 2);
    assert!(report
        .quarantined_event_ids
        .contains(&"future-schema".to_string()));
    assert!(report
        .quarantined_event_ids
        .contains(&"hash-corrupt".to_string()));
    assert!(report
        .quarantined_event_ids
        .contains(&"bad-shape".to_string()));
    assert_eq!(
        observation_types(&conn, "writing.evaluation.%"),
        BTreeSet::from([
            "writing.evaluation.criterion_score".to_string(),
            "writing.evaluation.degraded".to_string(),
            "writing.evaluation.overall_band".to_string(),
            "writing.evaluation.status".to_string(),
        ])
    );
    let failed_score_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observations
             WHERE scope_key = 'writing-failed'
             AND observation_type IN ('writing.evaluation.overall_band', 'writing.evaluation.criterion_score')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(failed_score_count, 0);
    assert_eq!(observation_types(&conn, "coach.%").len(), 2);
    assert_eq!(
        observation_types(&conn, "%preference%"),
        BTreeSet::<String>::new()
    );
    let degraded_category: String = conn
        .query_row(
            "SELECT value_text FROM learner_observations
             WHERE observation_type = 'writing.evaluation.degraded'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(degraded_category, "review_feedback_missing");
    let raw_reason_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_observations WHERE payload_json LIKE '%review_unavailable%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw_reason_count, 0);
}

#[test]
fn hash_valid_but_out_of_range_scores_are_quarantined() {
    let (_dir, conn) = open_db();
    insert_reading_attempt(&conn, "invalid-reading-score", "2026-08-12T08:00:00Z", 1.5);
    insert_writing(
        &conn,
        "invalid-writing-score",
        "completed",
        "2026-08-12T08:01:00Z",
        json!({
            "overall": 9.5,
            "taskResponse": 9.0,
            "coherence": 9.0,
            "lexical": 9.0,
            "grammar": 9.0
        }),
        Value::Null,
    );

    let report = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(report.quarantined, 2);
    assert_eq!(report.output_count, 0);
    assert_eq!(
        report.quarantined_event_ids,
        vec![
            "invalid-reading-score".to_owned(),
            "invalid-writing-score".to_owned(),
        ]
    );
}

#[test]
fn verify_detects_derived_row_loss() {
    let (_dir, conn) = open_db();
    insert_reading_question(
        &conn,
        "verify-event",
        "q1",
        "2026-08-12T00:00:00Z",
        Some(true),
    );
    learning_observations_rebuild(&conn).unwrap();
    conn.execute(
        "DELETE FROM learner_observations WHERE observation_type = 'reading.question.outcome'",
        [],
    )
    .unwrap();
    let report = learning_observations_verify(&conn).unwrap();
    assert!(!report.consistent);
    assert!(report
        .mismatches
        .iter()
        .any(|value| value.contains("mismatch")));
}

#[test]
fn failed_rebuild_is_audited_and_error_retention_is_bounded() {
    let (_dir, conn) = open_db();
    insert_reading_attempt(&conn, "failure-fixture", "2026-08-12T04:00:00Z", 0.75);
    conn.execute_batch(
        "CREATE TRIGGER force_projection_failure
         BEFORE INSERT ON learner_observations
         BEGIN
           SELECT RAISE(ABORT, 'forced projection failure');
         END;",
    )
    .unwrap();

    for _ in 0..7 {
        assert!(learning_observations_rebuild(&conn).is_err());
    }

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_projection_runs
             WHERE projector_key='learning_observation_v1' AND status='failed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 5);
    let error: String = conn
        .query_row(
            "SELECT error_json FROM learning_projection_runs
             WHERE projector_key='learning_observation_v1' AND status='failed'
             ORDER BY finished_at DESC,id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(error.contains("projection.rebuild_failed"));
    assert!(error.contains("forced projection failure"));
}

fn insert_reading_question(
    conn: &Connection,
    id: &str,
    question_id: &str,
    occurred_at: &str,
    is_correct: Option<bool>,
) {
    insert_reading_question_with_sensitivity(
        conn,
        id,
        question_id,
        occurred_at,
        is_correct,
        "normal",
    );
}

fn insert_reading_question_for_attempt(
    conn: &Connection,
    id: &str,
    attempt_id: &str,
    question_id: &str,
    occurred_at: &str,
    is_correct: Option<bool>,
    attempt_ordinal: u64,
) {
    insert_reading_question_at_ordinal_with_attempt(
        conn,
        id,
        attempt_id,
        question_id,
        occurred_at,
        is_correct,
        attempt_ordinal,
    );
}

fn insert_reading_question_at_ordinal(
    conn: &Connection,
    id: &str,
    question_id: &str,
    occurred_at: &str,
    is_correct: Option<bool>,
    attempt_ordinal: u64,
) {
    insert_raw_event(
        conn,
        id,
        "reading_question_outcome",
        Some("reading"),
        Some("asset-1"),
        Some(question_id),
        occurred_at,
        &json!({
            "attemptId": format!("attempt-{id}"),
            "assetId": "asset-1",
            "questionId": question_id,
            "attemptOrdinal": attempt_ordinal,
            "isCorrect": is_correct,
            "questionKind": "mcq",
            "changeCount": 0,
            "visitCount": 1,
            "elapsedMs": 900,
            "firstTryCorrect": is_correct
        })
        .to_string(),
        "normal",
    );
}

fn insert_reading_question_at_ordinal_with_attempt(
    conn: &Connection,
    id: &str,
    attempt_id: &str,
    question_id: &str,
    occurred_at: &str,
    is_correct: Option<bool>,
    attempt_ordinal: u64,
) {
    insert_raw_event_with_attempt(
        conn,
        id,
        "reading_question_outcome",
        Some("reading"),
        Some("asset-1"),
        Some(attempt_id),
        Some(question_id),
        occurred_at,
        &json!({
            "attemptId": attempt_id,
            "assetId": "asset-1",
            "questionId": question_id,
            "attemptOrdinal": attempt_ordinal,
            "isCorrect": is_correct,
            "questionKind": "mcq",
            "changeCount": 0,
            "visitCount": 1,
            "elapsedMs": 900,
            "firstTryCorrect": is_correct
        })
        .to_string(),
        "normal",
    );
}

fn insert_reading_question_with_sensitivity(
    conn: &Connection,
    id: &str,
    question_id: &str,
    occurred_at: &str,
    is_correct: Option<bool>,
    sensitivity: &str,
) {
    insert_raw_event(
        conn,
        id,
        "reading_question_outcome",
        Some("reading"),
        Some("asset-1"),
        Some(question_id),
        occurred_at,
        &json!({
            "attemptId": format!("attempt-{id}"),
            "assetId": "asset-1",
            "questionId": question_id,
            "attemptOrdinal": test_attempt_ordinal(occurred_at),
            "isCorrect": is_correct,
            "questionKind": "mcq",
            "changeCount": 1,
            "visitCount": 2,
            "elapsedMs": 900,
            "firstTryCorrect": false
        })
        .to_string(),
        sensitivity,
    );
}

fn insert_test_attempt(conn: &Connection, id: &str, completed_at: &str) {
    conn.execute(
        "INSERT INTO attempts
         (id, activity, asset_id, mode, status, started_at, completed_at,
          duration_ms, schema_version, created_at, updated_at)
         VALUES (?1, 'reading', NULL, 'single', 'completed', ?2, ?2, 0, 1, ?2, ?2)",
        params![id, completed_at],
    )
    .unwrap();
}

fn insert_reading_attempt(conn: &Connection, id: &str, occurred_at: &str, score: f64) {
    insert_raw_event(
        conn,
        id,
        "attempt_completed",
        Some("reading"),
        Some("asset-1"),
        None,
        occurred_at,
        &json!({
            "attemptId": id,
            "assetId": "asset-1",
            "attemptOrdinal": test_attempt_ordinal(occurred_at),
            "scoreValue": score,
            "correctCount": 3,
            "questionCount": 4,
            "durationMs": 1000,
            "mode": "practice"
        })
        .to_string(),
        "normal",
    );
}

fn insert_writing(
    conn: &Connection,
    id: &str,
    status: &str,
    occurred_at: &str,
    score: Value,
    degradation: Value,
) {
    insert_raw_event(
        conn,
        id,
        "writing_evaluation_completed",
        Some("writing"),
        None,
        None,
        occurred_at,
        &json!({
            "evaluationId": id,
            "attemptId": id,
            "status": status,
            "stage": "finalizing",
            "taskType": "task2",
            "score": score,
            "degradation": degradation,
            "providerId": "fake",
            "model": "fake-model"
        })
        .to_string(),
        "normal",
    );
}

fn insert_coach(conn: &Connection, id: &str, event_type: &str, occurred_at: &str) {
    insert_raw_event(
        conn,
        id,
        event_type,
        Some("reading"),
        Some("asset-1"),
        None,
        occurred_at,
        &json!({
            "messageId": id,
            "threadId": "thread-1",
            "role": if event_type == "coach_question_asked" { "user" } else { "assistant" },
            "sequence": 1,
            "questionContext": Value::Null
        })
        .to_string(),
        "normal",
    );
}

fn insert_raw_event(
    conn: &Connection,
    id: &str,
    event_type: &str,
    activity: Option<&str>,
    asset_id: Option<&str>,
    question_id: Option<&str>,
    occurred_at: &str,
    payload_json: &str,
    sensitivity: &str,
) {
    insert_raw_event_with_attempt(
        conn,
        id,
        event_type,
        activity,
        asset_id,
        None,
        question_id,
        occurred_at,
        payload_json,
        sensitivity,
    );
}

fn insert_raw_event_with_attempt(
    conn: &Connection,
    id: &str,
    event_type: &str,
    activity: Option<&str>,
    asset_id: Option<&str>,
    attempt_id: Option<&str>,
    question_id: Option<&str>,
    occurred_at: &str,
    payload_json: &str,
    sensitivity: &str,
) {
    conn.execute(
        "INSERT INTO learning_events
         (id, user_id, event_type, source_kind, source_id, idempotency_key, activity, asset_id,
          attempt_id, question_id, skill_key, occurred_at, payload_json, content_hash,
          schema_version, consolidation_state, sensitivity, created_at, updated_at)
         VALUES (?1, 'local', ?2, 'test', ?1, ?1, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, 1,
                 'pending', ?10, ?7, ?7)",
        params![
            id,
            event_type,
            activity,
            asset_id,
            attempt_id,
            question_id,
            occurred_at,
            payload_json,
            sha256_hex(payload_json),
            sensitivity,
        ],
    )
    .unwrap();
}

fn sha256_hex(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    hex::encode(digest.finalize())
}

fn test_attempt_ordinal(occurred_at: &str) -> u64 {
    let hour = occurred_at[11..13].parse::<u64>().unwrap();
    let minute = occurred_at[14..16].parse::<u64>().unwrap();
    hour * 60 + minute + 1
}

fn observation_ids(conn: &Connection) -> BTreeSet<String> {
    let mut statement = conn
        .prepare("SELECT id FROM learner_observations ORDER BY id")
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<BTreeSet<String>, _>>()
        .unwrap()
}

fn observation_types(conn: &Connection, pattern: &str) -> BTreeSet<String> {
    let mut statement = conn
        .prepare("SELECT DISTINCT observation_type FROM learner_observations WHERE observation_type LIKE ?1")
        .unwrap();
    statement
        .query_map(params![pattern], |row| row.get(0))
        .unwrap()
        .collect::<Result<BTreeSet<String>, _>>()
        .unwrap()
}
