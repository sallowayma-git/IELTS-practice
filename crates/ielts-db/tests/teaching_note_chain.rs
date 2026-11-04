//! The teaching-note loop end to end, against real SQLite and the production
//! validator: the learner's own words -> a coach line of the weekly pack ->
//! a weekly-consolidated memory that cites them -> the way back to the
//! original message -> the next coach thread's context.
use chrono::{DateTime, Utc};
use ielts_db::*;
use ielts_domain::{
    Activity, MemoryMutationProposal, MemoryMutationProposalBatch, MemoryNamespace, MemoryPromotionCommand,
    MemoryScope, MemorySourceClass, MEMORY_PROPOSAL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

// Compile the production validator without reversing the application -> DB
// dependency or changing either crate's manifest.
#[path = "../../ielts-application/src/memory/validator.rs"]
#[allow(dead_code)]
mod candidate_validator;

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("chain.db"))).unwrap();
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
    submit_reading_attempt(
        &conn,
        &serde_json::from_value(json!({
            "attemptId": "a1", "assetId": "P1", "answers": {"q1": "FALSE", "q2": "FALSE", "q3": "A"}, "idempotencyKey": "a1"
        }))
        .unwrap(),
    )
    .unwrap();
    conn.execute(
        "UPDATE learning_events SET occurred_at = '2026-10-05T09:00:00Z' WHERE json_extract(payload_json, '$.attemptId') = 'a1'",
        [],
    )
    .unwrap();
    conn.execute("UPDATE attempts SET completed_at = '2026-10-05T09:00:00Z' WHERE id = 'a1'", []).unwrap();
    (dir, conn)
}

fn thread(conn: &Connection, id: &str) {
    ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: Some(id.into()),
            attempt_id: Some("a1".into()),
            asset_id: Some("P1".into()),
            kind: "chat".into(),
        },
    )
    .unwrap();
}

fn say(conn: &Connection, thread: &str, role: &str, content: &str, payload: Option<Value>) -> CoachMessage {
    append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.into(),
            role: role.into(),
            content: content.into(),
            structured_payload: payload,
            status: "completed".into(),
        },
    )
    .unwrap()
}

/// One real coach turn: the learner's free input, then the coach's answer with notes.
fn turn(conn: &Connection, thread_id: &str, learner: &str, notes: Value) -> (CoachMessage, CoachMessage) {
    thread(conn, thread_id);
    let user = say(conn, thread_id, "user", learner, Some(json!({"promptKind": "freeform"})));
    let answer = say(conn, thread_id, "assistant", "Sure.", Some(json!({"answer": "Sure.", "teachingNotes": notes})));
    conn.execute(
        "UPDATE coach_messages SET created_at = '2026-10-05T10:05:00Z' WHERE id = ?1",
        params![answer.id],
    )
    .unwrap();
    (user, answer)
}

fn the_pack(conn: &Connection) -> WeeklyPack {
    weekly_pack(conn, "local", at("2026-10-03T00:00:00Z"), at("2026-10-10T00:00:00Z")).unwrap()
}

fn observation_type(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT observation_type FROM learner_observations WHERE id = ?1", [id], |row| row.get(0)).unwrap()
}

/// Apply one weekly ADD the way the host does: production validator, then promotion as the dream.
fn weekly_add(conn: &Connection, key: &str, statement: &str, evidence: Vec<String>) -> String {
    let proposal = MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Preference,
        canonical_key: key.into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: statement.into(),
        evidence_observation_ids: evidence.clone(),
    };
    let batch = MemoryMutationProposalBatch { schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION, proposals: vec![proposal] };
    let snapshot = load_memory_validation_snapshot(conn, "local", &evidence).unwrap();
    let validation = candidate_validator::MemoryProposalValidator::default().validate(
        &batch,
        candidate_validator::MemoryProposalOrigin::CognitiveRuntime { source_class: MemorySourceClass::Consolidated },
        &snapshot,
    );
    let receipt = persist_memory_candidate_batch(
        conn,
        &ielts_domain::MemoryCandidatePersistenceInput {
            request_id: format!("weekly-{key}"),
            user_id: "local".into(),
            run_id: None,
            source_class: MemorySourceClass::Consolidated,
            batch,
            validation,
            snapshot,
        },
    )
    .unwrap();
    let candidate = &receipt.candidates[0];
    assert_eq!(candidate.disposition, "pending", "{receipt:?}");
    let done = promote_memory_candidate(
        conn,
        &MemoryPromotionCommand {
            candidate_id: candidate.id.clone(),
            expected_candidate_version: candidate.version,
            actor_type: "dream".into(),
            actor_id: Some("weekly_dream".into()),
            reason: "weekly dream".into(),
        },
    )
    .unwrap();
    done.memory_id.expect("promotion created a memory")
}

#[test]
fn a_teaching_note_reaches_a_memory_that_can_name_its_message_and_returns_to_the_next_thread() {
    let (_dir, conn) = fixture();
    let (user, answer) = turn(
        &conn,
        "t1",
        "Could you use short examples first? It helps me.",
        json!([{"kind": "preference", "text": "short examples first", "evidence": "use short examples first"}]),
    );
    let pack = the_pack(&conn);

    // 1. The coach line carries the learner message's observation, then the attempt score.
    let coach = pack.lines.iter().find(|line| line.kind == "coach").expect("a coach line");
    assert!(coach.text.contains("learner asked: \"use short examples first\""), "{}", coach.text);
    assert_eq!(coach.ids.len(), 2, "{:?}", coach.ids);
    assert_eq!(observation_type(&conn, &coach.ids[0]), "coach.question.asked");
    assert_eq!(observation_type(&conn, &coach.ids[1]), "reading.attempt.score");
    assert!(pack.evidence_ids().contains(&coach.ids[0]), "the host admits a mutation that cites it");

    // 2. The weekly dream cites it; the production validator and promotion accept it.
    let memory = weekly_add(
        &conn,
        "preference.reading.short_examples_first",
        "学习者希望讲解先给简短例子，再讲规则。",
        coach.ids.clone(),
    );

    // 3. The way back: memory -> evidence observation -> the learner's own message.
    let sources = memory_coach_sources(&conn, "local", &memory).unwrap();
    assert_eq!(sources.len(), 1, "{sources:?}");
    assert_eq!(sources[0].learner_message_id, user.id);
    assert_eq!(sources[0].answer_message_id.as_deref(), Some(answer.id.as_str()));
    assert_eq!(sources[0].thread_id, "t1");
    assert_eq!(sources[0].attempt_id.as_deref(), Some("a1"));
    assert_eq!(sources[0].quotes, vec!["use short examples first".to_string()]);
    assert!(memory_coach_sources(&conn, "someone-else", &memory).unwrap().is_empty());

    // 4. The next thread's context sees the memory, ahead of content facts, as a recalled memory id.
    let next = build_coach_system_context(&conn, "local").unwrap();
    assert_eq!(next.memory_ids(), vec![memory.clone()]);
    assert!(next.memories[0].statement.contains("简短例子"));
}

#[test]
fn a_quote_that_is_not_in_the_preceding_learner_message_gets_no_message_provenance() {
    let (_dir, conn) = fixture();
    turn(
        &conn,
        "t1",
        "Please explain question 14 again.",
        json!([{"kind": "preference", "text": "short examples", "evidence": "short examples first please"}]),
    );
    let pack = the_pack(&conn);
    let coach = pack.lines.iter().find(|line| line.kind == "coach").expect("the phrase is still read");
    assert_eq!(coach.ids.len(), 1, "only the attempt score: nothing proves the learner wrote the quote");
    assert_eq!(observation_type(&conn, &coach.ids[0]), "reading.attempt.score");
}

#[test]
fn a_memory_with_only_practice_evidence_has_no_coach_source() {
    let (_dir, conn) = fixture();
    let pack = the_pack(&conn);
    let score = pack.lines.iter().find(|line| line.kind == "reading").unwrap().ids[0].clone();
    let memory = weekly_add(&conn, "preference.reading.some_habit", "学习者倾向先做配对题。", vec![score]);
    assert!(memory_coach_sources(&conn, "local", &memory).unwrap().is_empty());
}
