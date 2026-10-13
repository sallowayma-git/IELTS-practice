//! The weekly dream's input pack, built from real submissions: wrong-question
//! lines, redo detection, coach feedback and review lines, the aggregate header,
//! and the size cap with its omission rule.

use chrono::{DateTime, Utc};
use ielts_db::*;
use ielts_domain::estimate_tokens;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("pack.db"))).unwrap();
    migrate(&mut conn).unwrap();
    for id in ["P1", "P2", "P3"] {
        import(&conn, &dir, id);
    }
    (dir, conn)
}

fn import(conn: &Connection, dir: &tempfile::TempDir, id: &str) {
    let path = dir.path().join(format!("{id}.json"));
    let payload = json!({
        "examId": id, "meta": {"title": format!("Passage {id}"), "category": id},
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
    import_asset_payload_file(conn, &path).unwrap();
}

/// Submit one attempt and move its whole ledger footprint to `when`.
fn submit(conn: &Connection, attempt: &str, asset: &str, answers: Value, when: &str) {
    let command = json!({
        "attemptId": attempt, "assetId": asset, "answers": answers, "idempotencyKey": attempt
    });
    submit_reading_attempt(conn, &serde_json::from_value(command).unwrap()).unwrap();
    conn.execute(
        "UPDATE learning_events SET occurred_at = ?1 WHERE json_extract(payload_json, '$.attemptId') = ?2",
        params![when, attempt],
    )
    .unwrap();
    conn.execute("UPDATE attempts SET completed_at = ?1 WHERE id = ?2", params![when, attempt]).unwrap();
}

fn pack(conn: &Connection, start: &str, end: &str) -> WeeklyPack {
    weekly_pack(conn, "local", at(start), at(end)).unwrap()
}

fn texts(pack: &WeeklyPack, kind: &str) -> Vec<String> {
    pack.lines.iter().filter(|line| line.kind == kind).map(|line| line.text.clone()).collect()
}

fn coach_feedback(conn: &Connection, attempt: &str, asset: &str, at: &str, kinds: &[&str], reasks: usize) {
    let thread = format!("thread-{attempt}-{at}");
    conn.execute(
        "INSERT INTO coach_threads (id, attempt_id, asset_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'open', ?4, ?4)",
        params![thread, attempt, asset, at],
    )
    .unwrap();
    for (index, role) in ["assistant", "user"].into_iter().enumerate() {
        conn.execute(
            "INSERT INTO coach_messages (id, thread_id, role, content, status, created_at, sequence)
             VALUES (?1, ?2, ?3, 'text', 'completed', ?4, ?5)",
            params![format!("{thread}-m{index}"), thread, role, at, index as i64 + 1],
        )
        .unwrap();
    }
    for kind in kinds {
        conn.execute(
            "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, created_at) VALUES (?1, 'local', ?2, ?3, ?4)",
            params![format!("cfb-{thread}-{kind}"), format!("{thread}-m0"), kind, at],
        )
        .unwrap();
    }
    for index in 0..reasks {
        conn.execute(
            "INSERT INTO coach_reask_links (parent_assistant_message_id, new_user_message_id, feedback_kind, created_at)
             VALUES (?1, ?2, 'reask_same_question', ?3)",
            params![format!("{thread}-m0"), format!("{thread}-m1"), at],
        )
        .unwrap_or_else(|_| panic!("reask {index}"));
    }
}

#[test]
fn wrong_questions_carry_the_learners_answer_the_key_and_a_citable_id() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", "P1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert_eq!(
        texts(&pack, "miss"),
        vec![
            "P1 q14 [tfng] answered FALSE -> key TRUE".to_string(),
            "P1 q16 [matching] answered A -> key B".to_string(),
        ]
    );
    let attempt = &texts(&pack, "reading")[0];
    assert_eq!(attempt, "P1 \"Passage P1\" correct 1/3, attempt #1");
    // Right answers never appear as lines, and no passage text leaks.
    assert!(!pack.to_value().to_string().contains("Never leaves the host"));
    assert_eq!(pack.observation_count, 3);
    let miss_ids: Vec<_> = pack.lines.iter().filter(|line| line.kind == "miss").flat_map(|line| line.ids.clone()).collect();
    assert!(miss_ids.iter().all(|id| id.starts_with("obs-") && pack.evidence_ids().contains(id)));
}

#[test]
fn a_redo_line_says_how_many_earlier_misses_it_fixed() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", "P1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-04T09:00:00Z");
    submit(&conn, "a2", "P1", json!({"q1": "TRUE", "q2": "FALSE", "q3": "A"}), "2026-10-07T09:00:00Z");
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert_eq!(texts(&pack, "redo"), vec!["redo P1 \"Passage P1\": fixed 1 of 2 earlier misses; still wrong q16".to_string()]);
    assert_eq!(pack.header["redo"], json!({"fixed": 1, "stillWrong": 1, "newlyWrong": 0}));
    // Misses first: the still-wrong observation is the line's first citable id.
    let redo = pack.lines.iter().find(|line| line.kind == "redo").unwrap();
    assert!(!redo.ids.is_empty() && redo.ids.len() <= 3);
}

#[test]
fn the_header_counts_types_and_separates_passages_from_repeats() {
    let (_dir, conn) = fixture();
    submit(&conn, "a1", "P1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), "2026-10-04T09:00:00Z");
    submit(&conn, "a2", "P2", json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-10-05T09:00:00Z");
    submit(&conn, "a3", "P1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-06T09:00:00Z");
    let reading = &pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z").header["reading"];

    assert_eq!(reading["byQuestionType"]["tfng"], json!({"wrong": 4, "passages": 2}));
    assert_eq!(reading["byQuestionType"]["matching"], json!({"wrong": 1, "passages": 1}));
    assert_eq!(reading["missedAcrossPassages"], json!(["tfng (2 passages)"]));
    assert_eq!(reading["missedAgainInSamePassage"], json!(["P1 q1 (2 attempts)"]));
    assert_eq!(reading["byErrorType"]["tfng.boundary"], 4);
}

#[test]
fn coach_feedback_reasks_and_reviews_become_lines_tied_to_the_attempt() {
    let (_dir, conn) = fixture();
    submit(&conn, "old", "P2", json!({"q1": "TRUE", "q2": "FALSE", "q3": "B"}), "2026-09-20T09:00:00Z");
    submit(&conn, "a1", "P1", json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-05T09:00:00Z");
    coach_feedback(&conn, "a1", "P1", "2026-10-05T10:00:00Z", &["too_long", "need_example"], 1);
    coach_feedback(&conn, "old", "P2", "2026-10-06T10:00:00Z", &[], 0);
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert_eq!(
        texts(&pack, "coach"),
        vec!["coach on P1 \"Passage P1\": feedback need_example, too_long; re-asked 1x".to_string()]
    );
    assert_eq!(texts(&pack, "review"), vec!["reviewed P2 \"Passage P2\", attempt of 2026-09-20".to_string()]);
    // Both lines cite the attempt's score observation, so a mutation can rest on them.
    let coach = pack.lines.iter().find(|line| line.kind == "coach").unwrap();
    let score = pack.lines.iter().find(|line| line.kind == "reading").unwrap();
    assert_eq!(coach.ids, score.ids);
    assert_eq!(pack.header["coach"]["feedback"], json!({"need_example": 1, "too_long": 1}));
    assert_eq!(pack.header["coach"]["reasks"], 1);
    assert_eq!(pack.header["coach"]["reviewedOlderAttempts"], 1);
}

#[test]
fn a_writing_line_names_the_task_the_band_and_the_lowest_criteria() {
    let (_dir, conn) = fixture();
    let payload = json!({
        "evaluationId": "w1", "attemptId": "w1", "status": "completed", "stage": "finalizing",
        "taskType": "task2", "providerId": "fake", "model": "fake",
        "score": {"overall": 6.0, "taskResponse": 6.5, "coherence": 6.0, "lexical": 6.0, "grammar": 5.5}
    })
    .to_string();
    conn.execute(
        "INSERT INTO learning_events (id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
            occurred_at, payload_json, content_hash, schema_version, consolidation_state, sensitivity, created_at, updated_at)
         VALUES ('ev-w1', 'local', 'writing_evaluation_completed', 'test', 'w1', 'w1', 'writing',
            '2026-10-06T09:00:00Z', ?1, ?2, 1, 'pending', 'normal', '2026-10-06T09:00:00Z', '2026-10-06T09:00:00Z')",
        params![payload, sha256(&payload)],
    )
    .unwrap();
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert_eq!(texts(&pack, "writing"), vec!["task2 band 6, lowest grammar 5.5, coherence 6".to_string()]);
    assert_eq!(pack.header["writing"]["lowestCriteria"], json!({"coherence": 1, "grammar": 1}));
    assert_eq!(pack.observation_count, 1);
}

fn sha256(text: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(text.as_bytes()))
}

#[test]
fn only_the_window_counts_and_the_count_matches_the_pack() {
    let (_dir, conn) = fixture();
    submit(&conn, "before", "P1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "A"}), "2026-10-01T09:00:00Z");
    submit(&conn, "inside", "P2", json!({"q1": "TRUE", "q2": "FALSE", "q3": "B"}), "2026-10-05T09:00:00Z");
    let (start, end) = ("2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");
    let pack = pack(&conn, start, end);
    assert_eq!(pack.observation_count, 3);
    assert_eq!(weekly_observation_count(&conn, "local", at(start), at(end)).unwrap(), 3);
    assert!(texts(&pack, "miss").is_empty(), "the earlier attempt is outside the window");
    assert_eq!(weekly_observation_count(&conn, "local", at("2026-10-10T00:00:00Z"), at("2026-10-11T00:00:00Z")).unwrap(), 0);
}

#[test]
fn memories_and_preferences_ride_along_but_explicit_ones_are_not_mutable_targets() {
    let (_dir, conn) = fixture();
    for (id, source, scope) in [
        ("mem-inferred", "inferred", "activity:reading"),
        ("mem-explicit", "user_explicit", "activity:reading"),
        ("mem-global", "inferred", "global"),
    ] {
        conn.execute(
            "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
                source_class,created_by,content_hash,last_observed_at,created_at,updated_at)
             VALUES (?1,'local','strategy',?3,'procedural',?1,'label','Reads the stem first.','active',?2,'weekly_dream',?1,
                '2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
            params![id, source, scope],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO explicit_user_preferences (user_id,preference_key,scope,value_json,status,source,created_at,updated_at)
         VALUES ('local','explanation_language','global','\"zh\"','active','user','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");
    assert_eq!(pack.memory_ids().into_iter().collect::<Vec<_>>(), vec!["mem-inferred".to_string()]);
    assert_eq!(pack.preferences.len(), 1);
    assert_eq!(pack.preferences[0].key, "explanation_language");
}

#[test]
fn a_busy_window_fits_the_cap_keeps_repeated_types_and_says_what_it_omitted() {
    let (_dir, conn) = fixture();
    // Matching is missed in three different passages: protected. tfng only in P1: not protected.
    for (index, asset) in ["P1", "P2", "P3"].into_iter().enumerate() {
        submit(&conn, &format!("m{index}"), asset, json!({"q1": "TRUE", "q2": "FALSE", "q3": "A"}), "2026-10-03T12:00:00Z");
    }
    // Plenty of newer, unprotected noise: far more lines than the cap allows.
    for index in 0..60 {
        let day = format!("2026-10-{:02}T09:{:02}:00Z", 4 + index % 5, index % 60);
        submit(&conn, &format!("n{index}"), "P1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), &day);
    }
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert!(pack.estimated_tokens() <= WEEKLY_PACK_TOKEN_CAP, "{}", pack.estimated_tokens());
    assert!(pack.omitted > 0);
    assert_eq!(pack.to_value()["omitted"], json!(format!("omitted {} older items", pack.omitted)));
    let kept_matching = texts(&pack, "miss").into_iter().filter(|text| text.contains("[matching]")).count();
    assert_eq!(kept_matching, 3, "every line of a repeatedly missed question type survives");
    // The header still counts everything, omitted lines included.
    assert_eq!(pack.header["reading"]["wrongQuestions"], 123);
    // Determinism: the same database and window give the same bytes.
    let again = weekly_pack(&conn, "local", at("2026-10-03T00:00:00Z"), at("2026-10-10T00:00:00Z")).unwrap();
    assert_eq!(pack.to_value(), again.to_value());
}

#[test]
fn a_huge_memory_block_is_bounded_and_practice_lines_keep_their_share() {
    let (_dir, conn) = fixture();
    // Thirty memories and twenty preferences of long CJK text: unbounded, they alone overflow the cap.
    let long = "先读题干再定位关键词并核对同义替换".repeat(20);
    for index in 0..30 {
        let id = format!("mem-{index:02}");
        conn.execute(
            "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
                source_class,created_by,content_hash,last_observed_at,created_at,updated_at)
             VALUES (?1,'local','strategy','activity:reading','procedural',?1,'label',?2,'active','inferred','weekly_dream',?1,
                ?3,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
            params![id, long, format!("2026-09-{:02}T00:00:00Z", 1 + index % 28)],
        )
        .unwrap();
    }
    for index in 0..20 {
        conn.execute(
            "INSERT INTO explicit_user_preferences (user_id,preference_key,scope,value_json,status,source,created_at,updated_at)
             VALUES ('local',?1,'global',?2,'active','user','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
            params![format!("pref_{index:02}"), json!(long).to_string()],
        )
        .unwrap();
    }
    for index in 0..60 {
        let day = format!("2026-10-{:02}T09:{:02}:00Z", 4 + index % 5, index % 60);
        submit(&conn, &format!("n{index}"), "P1", json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), &day);
    }
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");

    assert!(pack.estimated_tokens() <= WEEKLY_PACK_TOKEN_CAP, "{}", pack.estimated_tokens());
    let context = estimate_tokens(&json!(pack.memories).to_string()) + estimate_tokens(&json!(pack.preferences).to_string());
    assert!(context <= WEEKLY_CONTEXT_TOKEN_BUDGET, "{context}");
    assert!(pack.memories.len() + pack.preferences.len() < 50, "the context was trimmed");
    // Practice lines keep the rest of the budget: plenty of them survive.
    let lines = estimate_tokens(&json!(pack.lines).to_string());
    assert!(lines >= WEEKLY_PACK_TOKEN_CAP / 3, "{lines}");
    assert!(!texts(&pack, "miss").is_empty());
}

#[test]
fn coach_lines_keep_the_most_recent_days_not_the_smallest_attempt_ids() {
    let (_dir, conn) = fixture();
    // a00 is the oldest coach day and a20 the newest: one more than the coach line limit.
    for index in 0..21 {
        let attempt = format!("a{index:02}");
        submit(&conn, &attempt, "P1", json!({"q1": "TRUE", "q2": "FALSE", "q3": "B"}), "2026-09-20T09:00:00Z");
        let at = format!("2026-10-{:02}T{:02}:00:00Z", 4 + index / 6, 8 + index % 6);
        coach_feedback(&conn, &attempt, "P1", &at, &["too_long"], 0);
    }
    let pack = pack(&conn, "2026-10-03T00:00:00Z", "2026-10-10T00:00:00Z");
    let score_id = |attempt: &str| -> String {
        conn.query_row(
            "SELECT id FROM learner_observations WHERE observation_type = 'reading.attempt.score'
               AND json_extract(payload_json, '$.attemptId') = ?1",
            [attempt],
            |row| row.get(0),
        )
        .unwrap()
    };
    let coach: Vec<_> = pack.lines.iter().filter(|line| line.kind == "coach").collect();
    assert_eq!(coach.len(), 20);
    assert!(coach.iter().all(|line| !line.ids.contains(&score_id("a00"))), "the oldest day is the one dropped");
    assert!(coach.iter().any(|line| line.ids.contains(&score_id("a20"))), "the newest day survives");
}
