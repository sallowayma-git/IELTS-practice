//! W3-2: listening drafts, scoring, idempotent submit and the learning ledger.

mod listening_fixture;

use serde_json::json;

use ielts_db::{
    get_open_listening_draft, list_learning_events, save_listening_draft, seed_builtin_listening_pack,
    submit_listening_attempt, ListeningDraftCommand, ListeningQuestionProgress,
    ListeningSubmitCommand,
};
use ielts_domain::domain::{Activity, AttemptStatus, ScoreScale};
use ielts_domain::LearningEventType;
use listening_fixture::{open_db, sample_payload, wav_bytes, write_pack};

fn seeded() -> (tempfile::TempDir, rusqlite::Connection, std::path::PathBuf, String) {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let sha = write_pack(&pack, &sample_payload(), &wav_bytes());
    seed_builtin_listening_pack(&conn, &pack).unwrap();
    (dir, conn, pack, sha)
}

fn timeline() -> Vec<ListeningQuestionProgress> {
    vec![ListeningQuestionProgress {
        question_id: "q1".into(),
        change_count: 1,
        visit_count: 2,
        elapsed_ms: 800,
        answered_at: Some("2026-11-01T10:00:00Z".into()),
    }]
}

#[test]
fn submit_scores_completion_single_choice_multi_choice_and_matching() {
    let (_dir, conn, _pack, sha) = seeded();
    let result = submit_listening_attempt(
        &conn,
        &ListeningSubmitCommand {
            attempt_id: "l-att-1".into(),
            asset_id: "l1-test".into(),
            asset_revision: Some(2),
            asset_fingerprint: Some(sha),
            answers: json!({
                "q1": "waterproof",
                "q2": "cotton",
                "q3": "B",
                "q4": ["C", "A"],
                "q5": "A"
            }),
            marked_questions: vec!["q6".into()],
            question_timeline: timeline(),
            duration_ms: Some(600_000),
            title_snapshot: None,
            idempotency_key: "listen-submit-1".into(),
        },
    )
    .unwrap();

    assert!(!result.idempotent_replay);
    assert_eq!(result.correct_count, 5.0); // q1 + q3 + q4 (weight 2) + q5
    assert_eq!(result.question_count, 7); // one question, two answers for q4
    assert!((result.score_value - 5.0 / 7.0).abs() < 1e-9);
    assert_eq!(result.attempt.activity, Activity::Listening);
    assert_eq!(result.attempt.status, AttemptStatus::Completed);
    assert_eq!(result.attempt.score_scale, Some(ScoreScale::Ratio));
    assert_eq!(result.attempt.title_snapshot.as_deref(), Some("Listening Test 1"));
    assert_eq!(result.attempt.duration_ms, 600_000);
    assert_eq!(result.attempt.answers.len(), 6);

    let answer = |id: &str| {
        result
            .attempt
            .answers
            .iter()
            .find(|answer| answer.question_id == id)
            .unwrap()
    };
    assert_eq!(answer("q1").is_correct, Some(true));
    assert_eq!(answer("q2").is_correct, Some(false));
    assert_eq!(answer("q3").is_correct, Some(true));
    assert_eq!(answer("q4").is_correct, Some(true));
    assert_eq!(answer("q4").weight, 2.0);
    assert_eq!(answer("q5").is_correct, Some(true));
    assert_eq!(answer("q6").is_correct, Some(false));
    assert!(!answer("q6").is_answered());
    assert!(answer("q1").marked == false);

    for answer in &result.attempt.answers {
        assert!(answer.question_kind.is_some(), "{answer:?}");
    }
    assert_eq!(answer("q4").question_kind.as_deref(), Some("multi_choice"));

    let mut statement = conn
        .prepare("SELECT question_kind FROM attempt_answers WHERE attempt_id = 'l-att-1'")
        .unwrap();
    let kinds = statement
        .query_map([], |row| row.get::<_, Option<String>>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(kinds.len(), 6);
    assert!(kinds.iter().all(Option::is_some));
}

#[test]
fn multi_choice_is_all_or_nothing_with_the_required_weight() {
    let (_dir, conn, _pack, sha) = seeded();
    let result = submit_listening_attempt(
        &conn,
        &ListeningSubmitCommand {
            attempt_id: "l-att-mc".into(),
            asset_id: "l1-test".into(),
            asset_revision: None,
            asset_fingerprint: Some(sha),
            answers: json!({ "q4": ["A"] }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: None,
            title_snapshot: None,
            idempotency_key: "listen-mc".into(),
        },
    )
    .unwrap();

    let q4 = result
        .attempt
        .answers
        .iter()
        .find(|answer| answer.question_id == "q4")
        .unwrap();
    assert_eq!(q4.weight, 2.0);
    assert_eq!(q4.is_correct, Some(false));
    assert_eq!(result.correct_count, 0.0);
    assert_eq!(result.question_count, 7);
}

#[test]
fn draft_restores_and_submit_is_idempotent() {
    let (_dir, conn, _pack, sha) = seeded();
    let draft = save_listening_draft(
        &conn,
        &ListeningDraftCommand {
            attempt_id: "l-att-draft".into(),
            asset_id: "l1-test".into(),
            answers: json!({ "q1": "waterproof" }),
            marked_questions: vec!["q6".into()],
            question_timeline: timeline(),
            asset_revision: Some(2),
            asset_fingerprint: Some(sha.clone()),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "listen-draft-1".into(),
        },
    )
    .unwrap();
    assert_eq!(draft.status, AttemptStatus::Draft);
    assert_eq!(draft.activity, Activity::Listening);

    let restored = get_open_listening_draft(&conn, "l1-test").unwrap().unwrap();
    assert_eq!(restored.id, "l-att-draft");
    assert!(restored
        .answers
        .iter()
        .any(|answer| answer.question_id == "q1" && answer.change_count == 1));
    assert!(restored
        .answers
        .iter()
        .any(|answer| answer.question_id == "q6" && answer.marked));

    let submit = ListeningSubmitCommand {
        attempt_id: "l-att-draft".into(),
        asset_id: "l1-test".into(),
        asset_revision: Some(2),
        asset_fingerprint: Some(sha),
        answers: json!({ "q1": "waterproof", "q3": "B" }),
        marked_questions: vec![],
        question_timeline: vec![],
        duration_ms: Some(1_000),
        title_snapshot: None,
        idempotency_key: "listen-draft-submit".into(),
    };
    let first = submit_listening_attempt(&conn, &submit).unwrap();
    assert!(!first.idempotent_replay);

    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_events WHERE attempt_id = 'l-att-draft'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let replay = submit_listening_attempt(&conn, &submit).unwrap();
    assert!(replay.idempotent_replay);
    assert_eq!(replay.score_value, first.score_value);
    let after_replay: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learning_events WHERE attempt_id = 'l-att-draft'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(after_replay, event_count);

    let attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE id = 'l-att-draft'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempts, 1);

    let mut second = submit.clone();
    second.idempotency_key = "listen-draft-submit-2".into();
    let err = submit_listening_attempt(&conn, &second).unwrap_err();
    assert!(err.to_string().contains("open listening attempt"), "{err}");
}

#[test]
fn submit_writes_one_attempt_event_and_one_event_per_question() {
    let (_dir, conn, _pack, sha) = seeded();
    submit_listening_attempt(
        &conn,
        &ListeningSubmitCommand {
            attempt_id: "l-att-events".into(),
            asset_id: "l1-test".into(),
            asset_revision: None,
            asset_fingerprint: Some(sha),
            answers: json!({
                "q1": "waterproof",
                "q2": "cotton",
                "q3": "B",
                "q4": ["C", "A"],
                "q5": "A"
            }),
            marked_questions: vec!["q6".into()],
            question_timeline: timeline(),
            duration_ms: Some(600_000),
            title_snapshot: None,
            idempotency_key: "listen-events".into(),
        },
    )
    .unwrap();

    let events = list_learning_events(&conn, None, Some("l-att-events"), 200).unwrap();
    assert_eq!(events.len(), 7, "1 attempt + 6 questions");

    let attempt_events: Vec<_> = events
        .iter()
        .filter(|event| event.event_type == LearningEventType::AttemptCompleted)
        .collect();
    assert_eq!(attempt_events.len(), 1);
    let attempt_event = attempt_events[0];
    assert_eq!(attempt_event.activity.as_deref(), Some("listening"));
    assert_eq!(attempt_event.source_kind, "listening_attempt");
    assert_eq!(attempt_event.source_id.as_deref(), Some("l-att-events"));
    let payload = attempt_event.payload.as_object().unwrap();
    for key in [
        "attemptId",
        "assetId",
        "correctCount",
        "questionCount",
        "scoreValue",
        "durationMs",
        "answeredCount",
        "unansweredCount",
        "sectionCount",
    ] {
        assert!(payload.contains_key(key), "missing {key}");
    }
    assert_eq!(payload["attemptId"], "l-att-events");
    assert_eq!(payload["correctCount"], 5.0);
    assert_eq!(payload["questionCount"], 7);
    assert_eq!(payload["answeredCount"], 5);
    assert_eq!(payload["unansweredCount"], 1);
    assert_eq!(payload["sectionCount"], 4);
    assert_eq!(payload["durationMs"], 600_000);

    let question_events: Vec<_> = events
        .iter()
        .filter(|event| event.event_type == LearningEventType::ListeningQuestionOutcome)
        .collect();
    assert_eq!(question_events.len(), 6);
    let mut skill_keys = std::collections::BTreeSet::new();
    for event in &question_events {
        assert_eq!(event.activity.as_deref(), Some("listening"));
        assert_eq!(event.source_kind, "listening_question");
        assert!(event
            .source_id
            .as_deref()
            .is_some_and(|id| id.starts_with("l-att-events:")));
        let payload = event.payload.as_object().unwrap();
        for key in [
            "attemptId",
            "assetId",
            "questionId",
            "section",
            "questionKind",
            "skillKey",
            "isCorrect",
            "answered",
            "firstTryCorrect",
            "changeCount",
            "visitCount",
            "elapsedMs",
            "marked",
        ] {
            assert!(payload.contains_key(key), "missing {key}");
        }
        let section = payload["section"].as_u64().unwrap();
        assert!((1..=4).contains(&section));
        let skill_key = event.skill_key.as_deref().unwrap();
        assert_eq!(payload["skillKey"], skill_key);
        assert_eq!(skill_key, format!("listening.{}", payload["questionKind"].as_str().unwrap()));
        skill_keys.insert(skill_key.to_string());
        // The ledger never carries the correct answer text.
        assert!(!event.payload.to_string().contains("waterproof"), "{event:?}");
        assert!(!payload.contains_key("correctAnswer"));
    }
    assert_eq!(
        skill_keys,
        ["listening.form_completion", "listening.matching", "listening.multi_choice", "listening.single_choice"]
            .iter()
            .map(|key| key.to_string())
            .collect()
    );

    let q1 = question_events
        .iter()
        .find(|event| event.question_id.as_deref() == Some("q1"))
        .unwrap();
    assert_eq!(q1.payload["section"], 1);
    assert_eq!(q1.payload["isCorrect"], true);
    assert_eq!(q1.payload["firstTryCorrect"], false); // change_count was 1
    let q3 = question_events
        .iter()
        .find(|event| event.question_id.as_deref() == Some("q3"))
        .unwrap();
    assert_eq!(q3.payload["firstTryCorrect"], true);
    let q6 = question_events
        .iter()
        .find(|event| event.question_id.as_deref() == Some("q6"))
        .unwrap();
    assert_eq!(q6.payload["answered"], false);
    assert_eq!(q6.payload["marked"], true);
    assert_eq!(q6.payload["section"], 4);
}

#[test]
fn activity_scope_accepts_listening_and_rejects_unknown_activities() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO attempts (
            id, activity, mode, status, started_at, schema_version, created_at, updated_at
         ) VALUES ('a-listen', 'listening', 'single', 'draft',
                   '2026-01-01T00:00:00Z', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO attempts (
                id, activity, mode, status, started_at, schema_version, created_at, updated_at
             ) VALUES ('a-bad', 'speaking', 'single', 'draft',
                       '2026-01-01T00:00:00Z', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .is_err());

    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, title, schema_version, fingerprint, pdf_only, created_at, updated_at
         ) VALUES ('l-asset', 'listening', 'builtin', 'Listening', 2, 'fp', 0,
                   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO practice_assets (
                id, activity, source_kind, title, schema_version, fingerprint, pdf_only, created_at, updated_at
             ) VALUES ('bad-asset', 'speaking', 'builtin', 'Bad', 2, 'fp', 0,
                       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .is_err());
}
