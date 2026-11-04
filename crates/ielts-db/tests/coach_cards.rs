//! Preference-card eligibility against real SQLite: which kept teaching notes
//! earn a "remember this about me?" card, and which never do.
use chrono::{DateTime, Duration, Utc};
use ielts_db::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

const SKILL: &str = "reading.tfng.false_vs_not_given";

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn now() -> DateTime<Utc> {
    at("2026-11-04T12:00:00Z")
}

fn fixture() -> (tempfile::TempDir, Connection, String) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("cards.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let thread = thread(&conn);
    (dir, conn, thread)
}

fn thread(conn: &Connection) -> String {
    ensure_coach_thread(conn, &EnsureCoachThreadCommand { thread_id: None, attempt_id: None, asset_id: None, kind: "chat".into() })
        .unwrap()
        .id
}

fn difficulty(skill: Option<&str>, text: &str) -> Value {
    match skill {
        Some(skill) => json!({"kind": "difficulty", "text": text, "skillKey": skill}),
        None => json!({"kind": "difficulty", "text": text}),
    }
}

fn preference(text: &str, remember: bool) -> Value {
    json!({"kind": "preference", "text": text, "remember": remember})
}

/// A stored assistant answer carrying `notes`, created at `created_at`.
fn stored(conn: &Connection, thread: &str, notes: Value, created_at: &str) -> CoachMessage {
    let message = append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.into(),
            role: "assistant".into(),
            content: "answer".into(),
            structured_payload: Some(json!({"teachingNotes": notes})),
            status: "completed".into(),
        },
    )
    .unwrap();
    conn.execute("UPDATE coach_messages SET created_at=?1 WHERE id=?2", params![created_at, message.id]).unwrap();
    message
}

fn card(conn: &Connection, notes: Value) -> Option<CoachMemoryCard> {
    evaluate_coach_memory_card(conn, &json!({"teachingNotes": notes}), None, now()).unwrap()
}

fn add_memory(conn: &Connection, id: &str, content: &str, status: &str) {
    conn.execute(
        "INSERT INTO memory_items (id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
           source_class,confidence,importance,sensitivity,created_by,content_hash,created_at,updated_at)
         VALUES (?1,'preference','activity:reading','semantic',?1,?1,?2,?3,'user_explicit',0.8,0.8,'normal','test',?1,
           '2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
        params![id, content, status],
    )
    .unwrap();
}

#[test]
fn a_remember_request_earns_a_card_at_once() {
    let (_dir, conn, _) = fixture();
    let got = card(&conn, json!([preference("该学习者希望以后先讲结论再讲证据", true)])).unwrap();
    assert_eq!(got, CoachMemoryCard { note_index: 0, text: "该学习者希望以后先讲结论再讲证据".into(), skill_key: None });
    let difficult = card(&conn, json!([json!({"kind": "difficulty", "text": "t", "skillKey": SKILL, "remember": true})])).unwrap();
    assert_eq!(difficult.skill_key.as_deref(), Some(SKILL));
    assert_eq!(serde_json::to_value(&difficult).unwrap(), json!({"noteIndex": 0, "text": "t", "skillKey": SKILL}));
}

#[test]
fn a_preference_without_remember_never_does_however_often_it_repeats() {
    let (_dir, conn, thread) = fixture();
    for day in 1..=3 {
        stored(&conn, &thread, json!([preference("喜欢短例子", false)]), &format!("2026-11-0{day}T09:00:00Z"));
    }
    assert_eq!(card(&conn, json!([preference("喜欢短例子", false)])), None);
}

#[test]
fn a_first_difficulty_earns_nothing_and_the_second_on_the_same_skill_does() {
    let (_dir, conn, thread) = fixture();
    assert_eq!(card(&conn, json!([difficulty(Some(SKILL), "该学习者对判断题容易困惑")])), None);
    stored(&conn, &thread, json!([difficulty(Some(SKILL), "该学习者对判断题容易困惑")]), "2026-10-20T09:00:00Z");
    let got = card(&conn, json!([difficulty(Some(SKILL), "该学习者对 NG 题容易困惑，需要更细致的思路")])).unwrap();
    assert_eq!(got.skill_key.as_deref(), Some(SKILL));
    assert!(got.text.contains("NG"));
}

#[test]
fn the_count_is_per_skill_per_window_and_never_includes_other_kinds_or_roles() {
    let (_dir, conn, thread) = fixture();
    // Other skill, older than 30 days, another kind, not an assistant answer, not completed.
    stored(&conn, &thread, json!([difficulty(Some("reading.matching_headings"), "x")]), "2026-10-30T09:00:00Z");
    stored(&conn, &thread, json!([difficulty(Some(SKILL), "x")]), "2026-10-04T11:59:59Z");
    stored(&conn, &thread, json!([preference("x", false), json!({"kind": "strategy_outcome", "text": "x", "skillKey": SKILL, "strategy": "s", "outcome": "helped"})]), "2026-10-30T09:00:00Z");
    let user = stored(&conn, &thread, json!([difficulty(Some(SKILL), "x")]), "2026-10-30T09:00:00Z");
    conn.execute("UPDATE coach_messages SET role='user' WHERE id=?1", [&user.id]).unwrap();
    let failed = stored(&conn, &thread, json!([difficulty(Some(SKILL), "x")]), "2026-10-30T09:00:00Z");
    conn.execute("UPDATE coach_messages SET status='failed' WHERE id=?1", [&failed.id]).unwrap();
    assert_eq!(card(&conn, json!([difficulty(Some(SKILL), "该学习者容易困惑")])), None);

    // Exactly inside the window counts, and a different thread counts: the learner is the unit.
    let other = self::thread(&conn);
    stored(&conn, &other, json!([difficulty(Some(SKILL), "x")]), "2026-10-05T12:00:01Z");
    assert!(card(&conn, json!([difficulty(Some(SKILL), "该学习者容易困惑")])).is_some());
}

#[test]
fn one_earlier_answer_counts_once_and_a_difficulty_needs_a_skill_to_repeat() {
    let (_dir, conn, thread) = fixture();
    stored(&conn, &thread, json!([difficulty(Some(SKILL), "a"), difficulty(Some(SKILL), "b")]), "2026-11-01T09:00:00Z");
    // One earlier answer plus this one is two answers: eligible.
    assert!(card(&conn, json!([difficulty(Some(SKILL), "c")])).is_some());
    // No skill key: nothing to count, so no card unless remembered.
    stored(&conn, &thread, json!([difficulty(None, "gets lost in long sentences")]), "2026-11-02T09:00:00Z");
    assert_eq!(card(&conn, json!([difficulty(None, "gets lost in long sentences")])), None);
}

#[test]
fn the_stored_message_itself_is_not_counted_twice() {
    let (_dir, conn, thread) = fixture();
    let message = stored(&conn, &thread, json!([difficulty(Some(SKILL), "该学习者容易困惑")]), "2026-11-04T11:00:00Z");
    let payload = message.structured_payload.clone().unwrap();
    assert_eq!(evaluate_coach_memory_card(&conn, &payload, Some(&message.id), now()).unwrap(), None);
    assert!(evaluate_coach_memory_card(&conn, &payload, None, now()).unwrap().is_some(), "without the id it would count itself");
}

#[test]
fn the_first_qualifying_note_wins_and_note_index_points_at_it() {
    let (_dir, conn, _) = fixture();
    let got = card(&conn, json!([
        preference("不记", false),
        {"kind": "strategy_outcome", "text": "有效", "strategy": "step_by_step_v1", "outcome": "helped", "remember": true},
        preference("以后都先讲结论", true),
        preference("以后都用例子", true),
    ]))
    .unwrap();
    assert_eq!(got.note_index, 2);
    assert_eq!(got.text, "以后都先讲结论");
}

#[test]
fn a_statement_that_is_already_an_active_memory_earns_no_card_but_other_statuses_do() {
    let (_dir, conn, _) = fixture();
    add_memory(&conn, "mem-archived", "先讲结论再讲证据", "archived");
    add_memory(&conn, "mem-candidate", "喜欢例子", "candidate");
    assert!(card(&conn, json!([preference("先讲结论，再讲证据。", true)])).is_some());
    assert!(card(&conn, json!([preference("喜欢例子", true)])).is_some());
    add_memory(&conn, "mem-active", "Prefers SHORT examples", "active");
    assert_eq!(card(&conn, json!([preference("prefers short   examples!", true)])), None);
    // A duplicate note is skipped, not fatal: a later one still qualifies.
    let got = card(&conn, json!([preference("Prefers short examples", true), preference("以后先讲结论", true)])).unwrap();
    assert_eq!(got.note_index, 1);
}

#[test]
fn a_card_already_confirmed_or_dismissed_on_the_message_is_not_offered_again() {
    let (_dir, conn, _) = fixture();
    let notes = json!([preference("以后先讲结论", true)]);
    for state in ["confirmed", "dismissed"] {
        let payload = json!({"teachingNotes": notes, "memoryCardState": state});
        assert!(coach_memory_card_handled(&payload));
        assert_eq!(evaluate_coach_memory_card(&conn, &payload, None, now()).unwrap(), None, "{state}");
    }
    let open = json!({"teachingNotes": notes, "memoryCardState": "pending"});
    assert!(!coach_memory_card_handled(&open));
    assert!(evaluate_coach_memory_card(&conn, &open, None, now()).unwrap().is_some());
}

#[test]
fn notes_in_the_old_format_and_odd_stored_payloads_neither_earn_cards_nor_break_the_count() {
    let (_dir, conn, thread) = fixture();
    let old = json!([
        {"kind": "preference", "text": "short examples", "evidence": "short examples"},
        {"kind": "strategy_outcome", "text": "worked", "strategy": "walk-through", "outcome": "helped", "evidence": "now I get it"},
    ]);
    stored(&conn, &thread, old.clone(), "2026-11-01T09:00:00Z");
    assert_eq!(card(&conn, old), None);
    // A payload that is a bare string, a message without notes, and notes that are not objects.
    for odd in [json!("text"), json!({"teachingNotes": "oops"}), json!({"teachingNotes": ["a", 1, null]}), json!({"teachingNotes": {"kind": "difficulty"}})] {
        let message = append_coach_message(&conn, &AppendCoachMessageCommand {
            thread_id: thread.clone(), role: "assistant".into(), content: "x".into(), structured_payload: Some(odd), status: "completed".into(),
        })
        .unwrap();
        conn.execute("UPDATE coach_messages SET created_at='2026-11-02T09:00:00Z' WHERE id=?1", [&message.id]).unwrap();
    }
    append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: thread.clone(), role: "assistant".into(), content: "plain".into(), structured_payload: None, status: "completed".into(),
    })
    .unwrap();
    assert_eq!(card(&conn, json!([difficulty(Some(SKILL), "该学习者容易困惑")])), None);
    assert_eq!(evaluate_coach_memory_card(&conn, &json!({}), None, now()).unwrap(), None);
    assert_eq!(evaluate_coach_memory_card(&conn, &json!({"teachingNotes": "x"}), None, now()).unwrap(), None);
}

#[test]
fn completing_a_run_attaches_the_card_and_ignores_a_forged_one() {
    let (_dir, conn, thread) = fixture();
    let user = append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: thread.clone(), role: "user".into(), content: "请记住，以后先讲结论".into(), structured_payload: None, status: "completed".into(),
    })
    .unwrap();
    let begin = |user: &str| begin_coach_trace(&conn, &thread, user, &json!({"messages": []}), "p", "m", 30_000).unwrap();
    let response = json!({"content": "{}", "model": "m", "latencyMs": 1, "retryCount": 0});
    let run = begin(&user.id);
    let message = complete_traced_coach(&conn, &run, &thread, "好的", json!({
        "answer": "好的",
        "memoryCard": {"noteIndex": 9, "text": "forged"}, "memoryCardState": "confirmed",
        "teachingNotes": [preference("该学习者希望以后先讲结论再讲证据", true)],
    }), &response)
    .unwrap();
    let payload = message.structured_payload.unwrap();
    assert_eq!(payload["memoryCard"], json!({"noteIndex": 0, "text": "该学习者希望以后先讲结论再讲证据"}));
    assert!(payload.get("memoryCardState").is_none(), "state is the learner's to write, never the model's");

    // No qualifying note: no card, and a forged one is gone.
    let user = append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: thread.clone(), role: "user".into(), content: "why".into(), structured_payload: None, status: "completed".into(),
    })
    .unwrap();
    let run = begin(&user.id);
    let message = complete_traced_coach(&conn, &run, &thread, "ok", json!({
        "answer": "ok", "memoryCard": {"noteIndex": 0, "text": "forged"}, "teachingNotes": [preference("喜欢例子", false)],
    }), &response)
    .unwrap();
    assert!(message.structured_payload.unwrap().get("memoryCard").is_none());
    // The window arithmetic uses a real clock here; sanity-check the constant it rests on.
    assert_eq!((now() - Duration::days(CARD_WINDOW_DAYS)).to_rfc3339(), "2026-10-05T12:00:00+00:00");
}
