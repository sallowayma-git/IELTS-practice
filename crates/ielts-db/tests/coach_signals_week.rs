//! The weekly coach-signals block, from real coach rows: coach use that never
//! involved a thumbs-up, repeated asks, the way the learner asked to be taught,
//! and what became of the questions the coach was asked about.

use chrono::{FixedOffset, TimeZone, Utc};
use ielts_db::*;
use ielts_domain::{BlockKind, ReportBlock};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("signals.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let path = dir.path().join("P1.json");
    let payload = json!({
        "examId": "P1", "meta": {"title": "Passage P1", "category": "P1"},
        "questionCount": 3, "questionOrder": ["q1", "q2", "q3"],
        "answerKey": {"q1": "TRUE", "q2": "FALSE", "q3": "B"},
        "questionDisplayMap": {"q1": "14", "q2": "15", "q3": "16"},
        "passage": {"blocks": [{"html": "<p>Never leaves the host.</p>"}]},
        "questionGroups": [
            {"kind": "tfng", "questionIds": ["q1", "q2"]},
            {"kind": "matching", "questionIds": ["q3"]}
        ]
    });
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();
    (dir, conn)
}

/// Submit one attempt and move its whole footprint (events, start, completion) to `when`.
fn submit(conn: &Connection, attempt: &str, answers: Value, when: &str) {
    let command = json!({"attemptId": attempt, "assetId": "P1", "answers": answers, "idempotencyKey": attempt});
    submit_reading_attempt(conn, &serde_json::from_value(command).unwrap()).unwrap();
    conn.execute(
        "UPDATE learning_events SET occurred_at = ?1 WHERE json_extract(payload_json, '$.attemptId') = ?2",
        params![when, attempt],
    )
    .unwrap();
    conn.execute("UPDATE attempts SET started_at = ?1, completed_at = ?1 WHERE id = ?2", params![when, attempt]).unwrap();
}

fn thread(conn: &Connection, attempt: &str) -> String {
    let id = format!("thread-{attempt}");
    ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: Some(id.clone()),
            attempt_id: Some(attempt.into()),
            asset_id: Some("P1".into()),
            kind: "chat".into(),
        },
    )
    .unwrap();
    id
}

fn say(conn: &Connection, thread: &str, role: &str, payload: Value, when: &str) -> String {
    let message = append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.into(),
            role: role.into(),
            content: "text".into(),
            structured_payload: Some(payload),
            status: "completed".into(),
        },
    )
    .unwrap();
    conn.execute("UPDATE coach_messages SET created_at = ?1 WHERE id = ?2", params![when, message.id]).unwrap();
    message.id
}

fn ask(conn: &Connection, thread: &str, focus: &[&str], when: &str) -> String {
    say(conn, thread, "user", json!({"promptKind": "freeform", "action": "explain", "focusQuestionIds": focus}), when)
}

fn block(conn: &Connection) -> Option<ReportBlock> {
    let start = Utc.with_ymd_and_hms(2026, 10, 3, 0, 0, 0).unwrap();
    let end = Utc.with_ymd_and_hms(2026, 10, 10, 0, 0, 0).unwrap();
    let current = week_facts(conn, "local", start, end, FixedOffset::east_opt(0).unwrap()).unwrap();
    let previous = WeekFacts::default();
    build_blocks(&SkillContext { current: &current, previous: &previous, review_needs: &[], memories: &[] })
        .into_iter()
        .find(|block| block.kind == BlockKind::CoachSignals)
}

#[test]
fn chatting_without_a_single_thumbs_up_still_counts_as_coach_use() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    ask(&conn, &t, &["q3"], "2026-10-05T10:05:00Z");
    // The host's automatic review is not a question the learner asked.
    say(&conn, &t, "user", json!({"promptKind": "preset", "action": "review_set", "focusQuestionIds": ["q1", "q2", "q3"]}), "2026-10-05T10:10:00Z");

    let block = block(&conn).expect("coach use without feedback shows a block");
    assert_eq!(block.data["asks"], 2);
    assert_eq!(block.data["attempts"], 1);
    assert_eq!(block.data["feedback"], json!([]));
    assert_eq!(block.data["reasks"], 0);
    assert!(block.data.get("repeatedAsks").is_none());
    assert!(block.data.get("afterCoach").is_none());
}

#[test]
fn a_question_asked_twice_is_a_repeated_ask_and_gets_an_example() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    ask(&conn, &t, &["q1", "q2"], "2026-10-05T10:05:00Z");
    ask(&conn, &t, &["q1"], "2026-10-06T10:05:00Z");

    let block = block(&conn).unwrap();
    assert_eq!(block.data["repeatedAsks"], json!({"questions": 1, "asks": 3, "assetIds": ["P1"]}));
    assert_eq!(block.examples.len(), 1);
    assert_eq!(block.examples[0].detail.as_deref(), Some("同一题反复追问"));
    assert_eq!(block.examples[0].label, "「Passage P1」");
}

#[test]
fn feedback_rows_carry_the_passages_and_a_reask_verdict_is_not_counted_twice() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    let answer = say(&conn, &t, "assistant", json!({"answer": "x"}), "2026-10-05T10:01:00Z");
    let again = ask(&conn, &t, &["q1"], "2026-10-05T10:02:00Z");
    for kind in ["too_long", "reask_same_question"] {
        conn.execute(
            "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, created_at) VALUES (?1, 'local', ?2, ?3, '2026-10-05T10:03:00Z')",
            params![format!("cfb-{kind}"), answer, kind],
        )
        .unwrap();
    }
    record_reask_link(
        &conn,
        &serde_json::from_value(json!({"parentAssistantMessageId": answer, "newUserMessageId": again, "userId": "local"})).unwrap(),
    )
    .unwrap();
    conn.execute("UPDATE coach_reask_links SET created_at = '2026-10-05T10:02:30Z'", []).unwrap();

    let block = block(&conn).unwrap();
    assert_eq!(block.data["feedback"], json!([{"kind": "too_long", "label": "太长", "count": 1, "assetIds": ["P1"]}]));
    assert_eq!(block.data["reasks"], 1, "the link table is the one source of re-asks");
}

#[test]
fn teaching_notes_are_tallied_by_verdict_and_by_strategy_ignoring_spelling() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    let notes = json!([
        {"kind": "strategy_outcome", "text": "t", "strategy": "Contrastive walk-through", "outcome": "helped", "evidence": "now I get it"},
        {"kind": "preference", "text": "short examples", "evidence": "short examples first"},
        // A note the weekly pack would also refuse (only an id token) is not counted either.
        {"kind": "preference", "text": "x", "evidence": "obs-14"},
    ]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": notes}), "2026-10-05T10:01:00Z");
    ask(&conn, &t, &["q2"], "2026-10-06T10:00:00Z");
    let more = json!([{"kind": "strategy_outcome", "text": "t", "strategy": "contrastive_walk-through", "outcome": "not_helped", "evidence": "still confused"}]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": more}), "2026-10-06T10:01:00Z");

    let block = block(&conn).unwrap();
    assert_eq!(block.data["teachingNotes"], json!({"wished": 1, "helped": 1, "notHelped": 1}));
    assert_eq!(
        block.data["strategies"],
        json!([{"strategy": "Contrastive walk-through", "helped": 1, "notHelped": 1}])
    );
}

#[test]
fn a_miss_the_coach_was_asked_about_is_counted_apart_from_one_it_was_not() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), "2026-10-04T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-04T10:00:00Z");
    // The redo: q1 (asked about) is fixed, q2 (never asked about) is still wrong.
    submit(&conn, "a2", json!({"q1": "TRUE", "q2": "TRUE", "q3": "B"}), "2026-10-07T09:00:00Z");

    let block = block(&conn).unwrap();
    assert_eq!(
        block.data["afterCoach"],
        json!({"explainedFixed": 1, "explainedStillWrong": 0, "unexplainedFixed": 0, "unexplainedStillWrong": 1, "assetIds": ["P1"]})
    );
}

#[test]
fn asking_only_after_the_redo_started_is_not_an_explanation_of_it() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), "2026-10-04T09:00:00Z");
    submit(&conn, "a2", json!({"q1": "TRUE", "q2": "TRUE", "q3": "B"}), "2026-10-07T09:00:00Z");
    let t = thread(&conn, "a2");
    ask(&conn, &t, &["q1", "q2"], "2026-10-07T10:00:00Z");

    let block = block(&conn).unwrap();
    assert!(block.data.get("afterCoach").is_none(), "nothing was asked before the redo: no comparison to make");
    assert_eq!(block.data["asks"], 1);
}

#[test]
fn the_block_is_a_pure_function_of_the_rows() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    ask(&conn, &t, &["q1"], "2026-10-05T10:05:00Z");
    assert_eq!(block(&conn), block(&conn));
}
