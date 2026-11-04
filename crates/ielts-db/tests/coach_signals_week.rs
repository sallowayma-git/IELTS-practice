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
        {"kind": "preference", "text": "obs-14", "evidence": "short examples"},
        // A recorded difficulty is its own count, not a wish.
        {"kind": "difficulty", "text": "判断题里 NOT GIVEN 与 FALSE 经常混淆"},
    ]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": notes}), "2026-10-05T10:01:00Z");
    ask(&conn, &t, &["q2"], "2026-10-06T10:00:00Z");
    let more = json!([{"kind": "strategy_outcome", "text": "t", "strategy": "contrastive_walk-through", "outcome": "not_helped", "evidence": "still confused"}]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": more}), "2026-10-06T10:01:00Z");

    let block = block(&conn).unwrap();
    assert_eq!(block.data["teachingNotes"], json!({"wished": 1, "helped": 1, "notHelped": 1, "difficulty": 1}));
    assert_eq!(
        block.data["strategies"],
        json!([{"strategy": "Contrastive walk-through", "helped": 1, "notHelped": 1}])
    );
}

#[test]
fn question_scoped_notes_are_not_counted_and_a_message_of_only_such_notes_adds_nothing() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    ask(&conn, &t, &["q1"], "2026-10-05T10:00:00Z");
    let notes = json!([
        {"kind": "difficulty", "text": "第三段 however 没看懂", "scope": "question"},
        {"kind": "preference", "text": "这题请讲慢一点", "scope": "question", "horizon": "session"},
        {"kind": "preference", "text": "short examples", "scope": "profile"},
    ]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": notes}), "2026-10-05T10:01:00Z");
    ask(&conn, &t, &["q2"], "2026-10-06T10:00:00Z");
    let only_question = json!([{"kind": "strategy_outcome", "text": "t", "strategy": "step_by_step_v1", "outcome": "helped", "scope": "question"}]);
    say(&conn, &t, "assistant", json!({"answer": "x", "teachingNotes": only_question}), "2026-10-06T10:01:00Z");

    let block = block(&conn).unwrap();
    assert_eq!(block.data["teachingNotes"], json!({"wished": 1, "helped": 0, "notHelped": 0}));
    assert!(block.data.get("strategies").is_none() || block.data["strategies"] == json!([]));
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

/// One assistant answer written with `strategy` on a thread over `asset`, with the learner's `feedback` on it.
fn strategy_answer(conn: &Connection, asset: &str, message: &str, strategy: &str, feedback: &[&str], at: &str) {
    let thread = format!("thread-{message}");
    conn.execute(
        "INSERT INTO coach_threads (id, attempt_id, asset_id, status, created_at, updated_at) VALUES (?1, NULL, ?2, 'open', ?3, ?3)",
        params![thread, asset, at],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO coach_messages (id, thread_id, role, content, status, created_at, sequence)
         VALUES (?1, ?2, 'assistant', 'text', 'completed', ?3, 1)",
        params![message, thread, at],
    )
    .unwrap();
    if !strategy.is_empty() {
        conn.execute(
            "INSERT INTO coach_strategy_assignments_v0
             (id, user_id, coach_message_id, strategy_id, skills_addressed_json, memory_ids_used_json, followup_type, created_at)
             VALUES (?1, 'local', ?2, ?3, '[]', '[]', 'explain', ?4)",
            params![format!("csa-{message}"), message, strategy, at],
        )
        .unwrap();
    }
    for kind in feedback {
        conn.execute(
            "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, created_at) VALUES (?1, 'local', ?2, ?3, ?4)",
            params![format!("cfb-{message}-{kind}"), message, kind, at],
        )
        .unwrap();
    }
}

#[test]
fn feedback_is_credited_to_the_strategy_that_wrote_the_answer_with_the_passages_it_came_from() {
    let (_dir, conn) = fixture();
    strategy_answer(&conn, "P1", "m1", "example_first_v1", &["need_example", "too_long"], "2026-10-05T10:00:00Z");
    strategy_answer(&conn, "P1", "m2", "example_first_v1", &["thumbs_up"], "2026-10-06T10:00:00Z");
    strategy_answer(&conn, "P2", "m3", "example_first_v1", &["need_example"], "2026-10-07T10:00:00Z");
    strategy_answer(&conn, "P1", "m4", "concise_direct_v1", &["too_long"], "2026-10-07T11:00:00Z");
    // Outside the window, a re-ask verdict, and an answer with no recorded strategy: none of them is counted.
    strategy_answer(&conn, "P3", "m5", "example_first_v1", &["need_example"], "2026-09-01T10:00:00Z");
    strategy_answer(&conn, "P3", "m6", "example_first_v1", &["reask_same_question"], "2026-10-07T12:00:00Z");
    strategy_answer(&conn, "P3", "m7", "", &["need_example"], "2026-10-07T13:00:00Z");
    // The learner's own reports on a catalog strategy join the tally; a free-form label does not.
    submit(&conn, "a1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let t = thread(&conn, "a1");
    say(
        &conn,
        &t,
        "assistant",
        json!({"teachingNotes": [
            {"kind": "strategy_outcome", "text": "例子先行对该学习者有效", "strategy": "Example-First v1", "outcome": "helped"},
            {"kind": "strategy_outcome", "text": "提问引导没有帮助", "strategy": "socratic walk", "outcome": "not_helped"},
        ]}),
        "2026-10-08T10:00:00Z",
    );

    let block = block(&conn).unwrap();
    let rows = block.data["strategyFeedback"].as_array().unwrap();
    assert_eq!(rows.len(), 2, "{rows:?}");
    assert_eq!(rows[0]["strategy"], "example_first_v1");
    assert_eq!(rows[0]["label"], "先给例子");
    assert_eq!((rows[0]["total"].clone(), rows[0]["articles"].clone()), (json!(5), json!(2)));
    assert_eq!(rows[0]["assetIds"], json!(["P1", "P2"]));
    assert_eq!(
        rows[0]["signals"],
        json!([
            {"kind": "need_example", "label": "需要例子", "count": 2, "assetIds": ["P1", "P2"]},
            {"kind": "helped", "label": "学习者说有帮助", "count": 1, "assetIds": ["P1"]},
            {"kind": "thumbs_up", "label": "有帮助", "count": 1, "assetIds": ["P1"]},
            {"kind": "too_long", "label": "太长", "count": 1, "assetIds": ["P1"]},
        ])
    );
    assert_eq!(rows[1]["strategy"], "concise_direct_v1");
    assert_eq!(rows[1]["signals"], json!([{"kind": "too_long", "label": "太长", "count": 1, "assetIds": ["P1"]}]));

    // Every number the narrative may cite carries the passages behind it.
    let facts = project_weekly_facts(&[block], None, chrono::NaiveDate::from_ymd_opt(2026, 10, 10).unwrap());
    let articles = &facts["coach.strategy.example_first_v1.articles"];
    assert_eq!((articles.value.clone(), articles.provenance.asset_ids.clone()), (json!(2), vec!["P1".to_string(), "P2".to_string()]));
    let wanted = &facts["coach.strategy.example_first_v1.need_example"];
    assert_eq!((wanted.value.clone(), wanted.provenance.asset_ids.len()), (json!(2), 2));
    assert!(facts.contains_key("coach.strategy.concise_direct_v1.too_long"));
    assert!(!facts.contains_key("coach.strategy.example_first_v1.too_long"), "only the three busiest signals become facts");
}

#[test]
fn a_week_without_strategy_signals_has_no_strategy_feedback() {
    let (_dir, conn) = fixture();
    strategy_answer(&conn, "P1", "m1", "", &["too_long"], "2026-10-05T10:00:00Z");
    let block = block(&conn).unwrap();
    assert!(block.data.get("strategyFeedback").is_none());
}
