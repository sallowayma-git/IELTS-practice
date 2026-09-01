//! Phase 7: suite / endless / memorize / timer state machines.

use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    advance_endless, cancel_endless, create_endless_session, create_memorize_session,
    create_suite_session, finish_memorize_session, get_endless_session, get_open_reading_draft,
    get_open_reading_draft_for_scope, get_suite_session, import_asset_payload_file, list_history,
    migrate, open_connection, patch_reading_answer, pick_reading_practice_asset, remaining_pool,
    save_reading_draft, save_suite_passage_draft, submit_endless_passage, submit_reading_attempt,
    submit_suite_passage, AdvanceEndlessCommand, CreateEndlessCommand, CreateMemorizeCommand,
    CreateSuiteCommand, DbOpenOptions, PassageStatus, PickReadingPracticeAssetCommand,
    ReadingDraftCommand, ReadingQuestionProgress, ReadingSubmitCommand,
    SaveSuitePassageDraftCommand, SubmitEndlessCommand, SubmitSuitePassageCommand, SuiteAssetSeed,
    TimerMode, TimerState,
};
use ielts_domain::domain::{Activity, AttemptMode, SuiteFlowMode, SuiteStatus};
use ielts_domain::dto::ListHistoryQuery;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn payload_with_frequency(exam_id: &str, frequency: &str) -> serde_json::Value {
    let category = if exam_id.starts_with("p2") {
        "P2"
    } else if exam_id.starts_with("p3") {
        "P3"
    } else {
        "P1"
    };
    json!({
        "examId": exam_id,
        "category": category,
        "frequency": frequency,
        "meta": { "category": category, "frequency": frequency },
        "answerKey": { "q1": "TRUE", "q2": "A" },
        "interactionModel": {},
        "questionGroups": []
    })
}

fn seed_asset(conn: &rusqlite::Connection, dir: &tempfile::TempDir, id: &str, frequency: &str) {
    let path = dir.path().join(format!("{id}.json"));
    std::fs::write(
        &path,
        serde_json::to_vec(&payload_with_frequency(id, frequency)).unwrap(),
    )
    .unwrap();
    import_asset_payload_file(conn, &path).unwrap();
}

fn seed_assets(conn: &rusqlite::Connection, dir: &tempfile::TempDir, ids: &[&str]) {
    for id in ids {
        seed_asset(conn, dir, id, "high");
    }
}

#[test]
fn native_single_practice_picker_is_seeded_and_category_scoped() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["p1-a", "p1-b", "p2-a"]);

    let command = PickReadingPracticeAssetCommand {
        category: Some("P1".into()),
        seed: Some("picker-seed".into()),
    };
    let first = pick_reading_practice_asset(&conn, &command).unwrap();
    let again = pick_reading_practice_asset(&conn, &command).unwrap();
    assert_eq!(first, again);
    assert!(matches!(first.asset_id.as_str(), "p1-a" | "p1-b"));

    let missing = pick_reading_practice_asset(
        &conn,
        &PickReadingPracticeAssetCommand {
            category: Some("P3".into()),
            seed: Some("picker-seed".into()),
        },
    )
    .unwrap_err();
    assert!(missing.to_string().contains("no answerable reading assets"));
}

fn suite_sequence() -> Vec<SuiteAssetSeed> {
    vec![
        SuiteAssetSeed {
            asset_id: "p1".into(),
            title: Some("P1".into()),
            category: Some("P1".into()),
        },
        SuiteAssetSeed {
            asset_id: "p2".into(),
            title: Some("P2".into()),
            category: Some("P2".into()),
        },
        SuiteAssetSeed {
            asset_id: "p3".into(),
            title: Some("P3".into()),
            category: Some("P3".into()),
        },
    ]
}

fn suite_submit_command(
    suite_id: &str,
    asset_id: &str,
    idempotency_key: &str,
) -> SubmitSuitePassageCommand {
    SubmitSuitePassageCommand {
        suite_id: suite_id.into(),
        asset_id: asset_id.into(),
        asset_revision: None,
        asset_fingerprint: None,
        answers: json!({ "q1": "TRUE", "q2": "A" }),
        marked_questions: vec![],
        question_timeline: vec![],
        duration_ms: Some(5_000),
        title_snapshot: None,
        timer_snapshot: None,
        idempotency_key: idempotency_key.into(),
    }
}

fn endless_submit_command(
    session_id: &str,
    asset_id: &str,
    idempotency_key: &str,
) -> SubmitEndlessCommand {
    SubmitEndlessCommand {
        session_id: session_id.into(),
        asset_id: asset_id.into(),
        asset_revision: None,
        asset_fingerprint: None,
        answers: json!({ "q1": "TRUE", "q2": "A" }),
        marked_questions: vec![],
        question_timeline: vec![],
        duration_ms: Some(5_000),
        title_snapshot: None,
        timer_snapshot: None,
        idempotency_key: idempotency_key.into(),
    }
}

#[test]
fn timer_pause_and_countdown_policy() {
    let mut t = TimerState::new_suite(1_000);
    t.mode = TimerMode::Countdown;
    t.limit_seconds = Some(10);
    assert!(!t.should_auto_submit(5_000));
    t.pause(5_000);
    assert_eq!(t.elapsed_seconds(20_000), 4);
    t.resume(20_000);
    assert!(t.should_auto_submit(26_000));
}

#[test]
fn malformed_suite_timer_is_rejected_instead_of_silently_reset() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["p1", "p2", "p3"]);
    let session = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("all".into()),
            seed: Some("malformed-timer".into()),
            sequence: suite_sequence(),
            timer: None,
            idempotency_key: Some("malformed-suite-timer".into()),
        },
    )
    .unwrap();
    conn.execute(
        "UPDATE reading_suites SET timer_state_json = '{not-json', timer_policy_json = '{not-json' WHERE id = ?1",
        [&session.session_id],
    )
    .unwrap();

    let error = get_suite_session(&conn, &session.session_id).unwrap_err();
    assert!(error.to_string().contains("suite timer state is invalid"));
}

#[test]
fn suite_create_submit_and_recover() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["p1", "p2", "p3"]);
    let session = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("all".into()),
            seed: Some("s1".into()),
            sequence: suite_sequence(),
            timer: None,
            idempotency_key: Some("create-suite-1".into()),
        },
    )
    .unwrap();
    assert_eq!(session.status, SuiteStatus::Active);
    assert_eq!(session.flow_mode, SuiteFlowMode::Simulation);
    assert_eq!(session.current_index, 0);

    let replay = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: None,
            seed: None,
            sequence: suite_sequence(),
            timer: None,
            idempotency_key: Some("create-suite-1".into()),
        },
    )
    .unwrap();
    assert_eq!(replay.session_id, session.session_id);

    let r1 = submit_suite_passage(
        &conn,
        &SubmitSuitePassageCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p1".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(30_000),
            title_snapshot: Some("P1".into()),
            timer_snapshot: None,
            idempotency_key: "suite-sub-1".into(),
        },
    )
    .unwrap();
    assert_eq!(r1.suite_session.current_index, 1);
    assert_eq!(r1.suite_session.aggregate.submitted_passages, 1);
    assert_eq!(r1.submission.attempt.mode, AttemptMode::Suite);
    assert_eq!(
        r1.submission.attempt.suite_id.as_deref(),
        Some(session.session_id.as_str())
    );

    let bad = submit_suite_passage(
        &conn,
        &SubmitSuitePassageCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p3".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: None,
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "suite-sub-bad".into(),
        },
    );
    assert!(bad.is_err());

    let loaded = get_suite_session(&conn, &session.session_id).unwrap();
    assert_eq!(loaded.current_index, 1);
    assert_eq!(loaded.sequence[0].status, PassageStatus::Submitted);

    let r2 = submit_suite_passage(
        &conn,
        &SubmitSuitePassageCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p2".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(10_000),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "suite-sub-2".into(),
        },
    )
    .unwrap();
    let r3 = submit_suite_passage(
        &conn,
        &SubmitSuitePassageCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p3".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(10_000),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "suite-sub-3".into(),
        },
    )
    .unwrap();
    assert_eq!(r3.suite_session.status, SuiteStatus::Completed);
    assert_eq!(r3.suite_session.aggregate.submitted_passages, 3);
    assert!(r2.submission.score.accuracy > 0.0);

    let again = submit_suite_passage(
        &conn,
        &SubmitSuitePassageCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p3".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "FALSE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "suite-sub-3".into(),
        },
    )
    .unwrap();
    assert_eq!(
        again.submission.score.accuracy,
        r3.submission.score.accuracy
    );
    assert!(again.submission.idempotent_replay);
}

#[test]
fn suite_custom_sequence_rejects_duplicates_and_wrong_order() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["p1", "p2", "p3"]);
    let sequence = suite_sequence();

    let duplicate = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("custom".into()),
            seed: None,
            sequence: vec![
                sequence[0].clone(),
                sequence[0].clone(),
                sequence[2].clone(),
            ],
            timer: None,
            idempotency_key: Some("invalid-suite-duplicate".into()),
        },
    )
    .unwrap_err();
    assert!(duplicate
        .to_string()
        .contains("suite sequence cannot contain duplicate assets"));

    let wrong_order = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("custom".into()),
            seed: None,
            sequence: vec![
                sequence[1].clone(),
                sequence[0].clone(),
                sequence[2].clone(),
            ],
            timer: None,
            idempotency_key: Some("invalid-suite-order".into()),
        },
    )
    .unwrap_err();
    assert!(wrong_order
        .to_string()
        .contains("suite passage 1 must be P1, got P2"));

    let suite_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM reading_suites", [], |row| row.get(0))
        .unwrap();
    assert_eq!(suite_count, 0);
}

#[test]
fn suite_frequency_scope_never_falls_back() {
    let (dir, conn) = open_db();
    seed_asset(&conn, &dir, "p1", "high");
    seed_asset(&conn, &dir, "p2", "low");
    seed_asset(&conn, &dir, "p3", "high");

    let error = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("high".into()),
            seed: Some("strict-high".into()),
            sequence: vec![],
            timer: None,
            idempotency_key: Some("strict-high-suite".into()),
        },
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("no reading assets available for P2 under frequency scope"));
    let suite_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM reading_suites", [], |row| row.get(0))
        .unwrap();
    assert_eq!(suite_count, 0);
}

#[test]
fn suite_draft_recovers_answers_progress_and_timer_after_reopen() {
    let (dir, conn) = open_db();
    let db_path = dir.path().join("v2.db");
    seed_assets(&conn, &dir, &["p1", "p2", "p3"]);
    let session = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("custom".into()),
            seed: None,
            sequence: suite_sequence(),
            timer: None,
            idempotency_key: Some("draft-suite".into()),
        },
    )
    .unwrap();
    let mut timer = session.timer.clone();
    timer.mode = TimerMode::Countdown;
    timer.limit_seconds = Some(3_600);
    timer.paused_offset_ms = 2_500;
    timer.pause(timer.anchor_ms + 8_000);

    let saved = save_suite_passage_draft(
        &conn,
        &SaveSuitePassageDraftCommand {
            suite_id: session.session_id.clone(),
            asset_id: "p1".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE" }),
            marked_questions: vec!["q2".into()],
            question_timeline: vec![ReadingQuestionProgress {
                question_id: "q1".into(),
                change_count: 2,
                visit_count: 3,
                elapsed_ms: 4_000,
                answered_at: Some("2026-07-13T12:00:00Z".into()),
            }],
            title_snapshot: Some("P1".into()),
            timer_snapshot: Some(timer.clone()),
            idempotency_key: "draft-p1".into(),
        },
    )
    .unwrap();
    assert_eq!(saved.attempt.mode, AttemptMode::Suite);
    assert_eq!(
        saved.attempt.suite_id.as_deref(),
        Some(session.session_id.as_str())
    );
    assert_eq!(saved.suite_session.timer.mode, TimerMode::Countdown);
    assert!(!saved.suite_session.timer.running);
    drop(conn);

    let mut reopened = open_connection(&DbOpenOptions::create(db_path)).unwrap();
    migrate(&mut reopened).unwrap();
    assert!(get_open_reading_draft(&reopened, "p1").unwrap().is_none());
    let restored =
        get_open_reading_draft_for_scope(&reopened, "p1", Some(session.session_id.as_str()))
            .unwrap()
            .unwrap();
    assert_eq!(restored.mode, AttemptMode::Suite);
    assert_eq!(
        restored.suite_id.as_deref(),
        Some(session.session_id.as_str())
    );
    let q1 = restored
        .answers
        .iter()
        .find(|answer| answer.question_id == "q1")
        .unwrap();
    assert_eq!(q1.answer, json!("TRUE"));
    assert_eq!(q1.change_count, 2);
    assert_eq!(q1.visit_count, 3);
    assert_eq!(q1.elapsed_ms, 4_000);
    assert_eq!(q1.answered_at.as_deref(), Some("2026-07-13T12:00:00Z"));
    assert!(restored
        .answers
        .iter()
        .any(|answer| answer.question_id == "q2" && answer.marked));
    let restored_session = get_suite_session(&reopened, &session.session_id).unwrap();
    assert_eq!(restored_session.timer.mode, TimerMode::Countdown);
    assert_eq!(restored_session.timer.limit_seconds, Some(3_600));
    assert_eq!(restored_session.timer.paused_offset_ms, 2_500);
    assert_eq!(restored_session.timer.paused_at_ms, timer.paused_at_ms);
    assert!(!restored_session.timer.running);
}

#[test]
fn suite_submit_rolls_back_attempt_session_and_idempotency() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["p1", "p2", "p3"]);
    let session = create_suite_session(
        &conn,
        &CreateSuiteCommand {
            flow_mode: Some("simulation".into()),
            frequency_scope: Some("custom".into()),
            seed: None,
            sequence: suite_sequence(),
            timer: None,
            idempotency_key: Some("suite-rollback".into()),
        },
    )
    .unwrap();
    conn.execute_batch(&format!(
        "CREATE TRIGGER fail_suite_items BEFORE DELETE ON reading_suite_items
         WHEN OLD.suite_id = '{}'
         BEGIN SELECT RAISE(ABORT, 'inject suite item failure'); END;",
        session.session_id.replace('\'', "''")
    ))
    .unwrap();

    let attempt_id = format!("reading-{}-p1", session.session_id);
    let result = submit_suite_passage(
        &conn,
        &suite_submit_command(&session.session_id, "p1", "suite-submit-rollback"),
    );
    assert!(result.is_err());
    let attempt_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE id = ?1",
            [&attempt_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempt_count, 0);
    let restored = get_suite_session(&conn, &session.session_id).unwrap();
    assert_eq!(restored.current_index, 0);
    assert_eq!(restored.sequence[0].status, session.sequence[0].status);
    assert!(restored.sequence[0].attempt_id.is_none());
    let idempotency_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mode_idempotency
             WHERE scope = 'suite.submit' AND idempotency_key = 'suite-submit-rollback'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(idempotency_count, 0);
    conn.execute_batch("DROP TRIGGER fail_suite_items;")
        .unwrap();
}

#[test]
fn endless_submit_rolls_back_attempt_session_and_idempotency() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["a", "b", "c"]);
    let session = create_endless_session(
        &conn,
        &CreateEndlessCommand {
            pool_policy: None,
            seed: Some("endless-rollback".into()),
            idempotency_key: Some("endless-rollback".into()),
        },
    )
    .unwrap();
    let first_asset = session.current_asset_id.clone().unwrap();
    let attempts_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM attempts", [], |row| row.get(0))
        .unwrap();
    conn.execute_batch(&format!(
        "CREATE TRIGGER fail_endless_session BEFORE UPDATE ON endless_sessions
         WHEN OLD.id = '{}'
         BEGIN SELECT RAISE(ABORT, 'inject endless failure'); END;",
        session.id.replace('\'', "''")
    ))
    .unwrap();

    let result = submit_endless_passage(
        &conn,
        &endless_submit_command(&session.id, &first_asset, "endless-submit-rollback"),
    );
    assert!(result.is_err());
    let attempts_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM attempts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(attempts_after, attempts_before);
    let restored = get_endless_session(&conn, &session.id).unwrap();
    assert_eq!(
        restored.current_asset_id.as_deref(),
        Some(first_asset.as_str())
    );
    assert!(restored.current_attempt_id.is_none());
    assert!(restored.completed_asset_ids.is_empty());
    let idempotency_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mode_idempotency
             WHERE scope = 'endless.submit' AND idempotency_key = 'endless-submit-rollback'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(idempotency_count, 0);
    conn.execute_batch("DROP TRIGGER fail_endless_session;")
        .unwrap();
}

#[test]
fn endless_pool_and_advance() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["a", "b", "c"]);
    let session = create_endless_session(
        &conn,
        &CreateEndlessCommand {
            pool_policy: None,
            seed: Some("endless-seed".into()),
            idempotency_key: Some("e1".into()),
        },
    )
    .unwrap();
    let first_asset = session.current_asset_id.clone().unwrap();

    let r = submit_endless_passage(
        &conn,
        &SubmitEndlessCommand {
            session_id: session.id.clone(),
            asset_id: first_asset.clone(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(5_000),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "e-sub-1".into(),
        },
    )
    .unwrap();
    assert!(r
        .next_asset_id
        .as_deref()
        .is_some_and(|id| id != first_asset));
    assert_eq!(remaining_pool(&r.session).len(), 2);
    assert_eq!(r.submission.attempt.mode, AttemptMode::Endless);
    assert_eq!(
        r.submission.attempt.suite_id.as_deref(),
        Some(session.id.as_str())
    );

    let replay = submit_endless_passage(
        &conn,
        &SubmitEndlessCommand {
            session_id: session.id.clone(),
            asset_id: first_asset.clone(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "FALSE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "e-sub-1".into(),
        },
    )
    .unwrap();
    assert_eq!(
        replay.submission.score.accuracy,
        r.submission.score.accuracy
    );
    assert!(replay.submission.idempotent_replay);
    assert_eq!(
        replay.session.current_attempt_id,
        r.session.current_attempt_id
    );
    conn.execute(
        "DELETE FROM mode_idempotency WHERE scope = 'endless.submit' AND idempotency_key = 'e-sub-1'",
        [],
    )
    .unwrap();
    let recovered = submit_endless_passage(
        &conn,
        &SubmitEndlessCommand {
            session_id: session.id.clone(),
            asset_id: first_asset,
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "FALSE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1),
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "e-sub-1".into(),
        },
    )
    .unwrap_err();
    assert!(recovered
        .to_string()
        .contains("already completed in this session"));
    let persisted_attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE suite_id = ?1",
            [&session.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(persisted_attempts, 1);

    let advanced = advance_endless(
        &conn,
        &AdvanceEndlessCommand {
            session_id: session.id.clone(),
        },
    )
    .unwrap_err();
    assert!(advanced.to_string().contains("endless_advance is retired"));
    let unchanged = get_endless_session(&conn, &session.id).unwrap();
    assert_eq!(unchanged.current_asset_id, r.next_asset_id);
    let cancelled = cancel_endless(&conn, &session.id).unwrap();
    assert_eq!(cancelled.status, ielts_db::EndlessStatus::Cancelled);
    assert!(cancelled.current_asset_id.is_none());
}

#[test]
fn endless_submit_accepts_only_the_current_uncompleted_asset() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["a", "b", "c"]);
    let session = create_endless_session(
        &conn,
        &CreateEndlessCommand {
            pool_policy: None,
            seed: Some("endless-current-only".into()),
            idempotency_key: Some("endless-current-only".into()),
        },
    )
    .unwrap();
    let first_asset = session.current_asset_id.clone().unwrap();
    let submitted = submit_endless_passage(
        &conn,
        &endless_submit_command(&session.id, &first_asset, "endless-current-first"),
    )
    .unwrap();
    let current_asset = submitted.next_asset_id.clone().unwrap();
    let another_pending_asset = session
        .pool
        .iter()
        .find(|asset_id| **asset_id != first_asset && **asset_id != current_asset)
        .unwrap()
        .clone();

    let wrong_current = submit_endless_passage(
        &conn,
        &endless_submit_command(&session.id, &another_pending_asset, "endless-wrong-current"),
    )
    .unwrap_err();
    assert!(wrong_current
        .to_string()
        .contains("must target the current asset"));

    let repeated = submit_endless_passage(
        &conn,
        &endless_submit_command(&session.id, &first_asset, "endless-repeated-completed"),
    )
    .unwrap_err();
    assert!(repeated
        .to_string()
        .contains("already completed in this session"));

    let persisted = get_endless_session(&conn, &session.id).unwrap();
    assert_eq!(
        persisted.current_asset_id.as_deref(),
        Some(current_asset.as_str())
    );
    assert_eq!(persisted.completed_asset_ids, vec![first_asset]);
    let attempt_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE suite_id = ?1",
            [&session.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempt_count, 1);
}

#[test]
fn memorize_excluded_from_history() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["normal-asset"]);
    let mem = create_memorize_session(
        &conn,
        &CreateMemorizeCommand {
            asset_id: "normal-asset".into(),
            title_snapshot: Some("Mem".into()),
            idempotency_key: Some("m1".into()),
        },
    )
    .unwrap();
    assert!(mem.read_only);
    assert!(!mem.enters_history);

    submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "normal-1".into(),
            asset_id: "normal-asset".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1000),
            title_snapshot: Some("N".into()),
            idempotency_key: "n1".into(),
        },
    )
    .unwrap();

    let page = list_history(
        &conn,
        &ListHistoryQuery {
            activity: Some(Activity::Reading),
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
            limit: 50,
            offset: 0,
            cursor: None,
        },
    )
    .unwrap();
    assert!(page.items.iter().all(|i| i.id != mem.attempt.id));
    assert!(page.items.iter().any(|i| i.id == "normal-1"));

    finish_memorize_session(&conn, &mem.attempt.id).unwrap();
}

#[test]
fn generic_reading_writes_cannot_mutate_a_memorize_attempt() {
    let (dir, conn) = open_db();
    seed_assets(&conn, &dir, &["normal-asset"]);
    let memorize = create_memorize_session(
        &conn,
        &CreateMemorizeCommand {
            asset_id: "normal-asset".into(),
            title_snapshot: None,
            idempotency_key: Some("memorize-identity".into()),
        },
    )
    .unwrap();
    let attempt_id = memorize.attempt.id.clone();

    assert!(patch_reading_answer(&conn, &attempt_id, "q1", &json!("TRUE"), false).is_err());
    assert!(save_reading_draft(
        &conn,
        &ReadingDraftCommand {
            attempt_id: attempt_id.clone(),
            asset_id: "normal-asset".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            title_snapshot: None,
            timer_snapshot: None,
            idempotency_key: "illegal-memorize-draft".into(),
        },
    )
    .is_err());
    assert!(submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: attempt_id.clone(),
            asset_id: "normal-asset".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE", "q2": "A" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1_000),
            title_snapshot: None,
            idempotency_key: "illegal-memorize-submit".into(),
        },
    )
    .is_err());

    let persisted: (String, Option<String>, String) = conn
        .query_row(
            "SELECT mode, suite_id, status FROM attempts WHERE id = ?1",
            [&attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(persisted.0, "memorize");
    assert_eq!(persisted.1, None);
    assert_eq!(persisted.2, "active");
}
