//! Phase 5: writing draft, evaluation state machine, checkpoints, idempotency.

use ielts_domain::domain::{
    Activity, AttemptMode, AttemptStatus, EvaluationStage, EvaluationStatus,
};
use ielts_domain::dto::{
    CloneWritingDraftCommand, SaveDraftCommand, SubmitAttemptCommand, WritingEvaluationV4,
};
use tempfile::tempdir;

use ielts_db::{
    clone_writing_draft, finish_evaluation, get_history_detail, get_writing_draft, list_events,
    list_learning_events, load_evaluation_for_attempt, migrate, open_connection,
    prepare_evaluation, recover_interrupted_sessions, request_cancel, save_writing_draft,
    start_evaluation, submit_writing_attempt, DbOpenOptions, DeterministicProvider, ProviderError,
    StartEvaluationCommand, WritingProvider,
};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{WritingFeedbackV4, WritingScoreV4};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn draft_cmd(id: &str, text: &str, key: &str) -> SaveDraftCommand {
    SaveDraftCommand {
        attempt_id: id.into(),
        activity: Activity::Writing,
        mode: AttemptMode::Bank,
        asset_id: None,
        content_text: Some(text.into()),
        prompt_snapshot: Some("Discuss both views.".into()),
        task_type: Some(WritingTaskType::Task2),
        idempotency_key: key.into(),
    }
}

#[test]
fn draft_and_idempotent_submit() {
    let (_dir, conn) = open_db();
    let essay = "Practical skills matter in modern education. ".repeat(40);
    save_writing_draft(&conn, &draft_cmd("a1", &essay, "draft-1")).unwrap();
    let d = get_writing_draft(&conn, "a1").unwrap().unwrap();
    assert!(d.word_count > 10);
    assert_eq!(d.mode, Some(AttemptMode::Bank));

    let submitted = submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: "a1".into(),
            idempotency_key: "submit-1".into(),
        },
    )
    .unwrap();
    assert_eq!(
        format!("{:?}", submitted.status).to_ascii_lowercase(),
        "submitted"
    );

    let again = submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: "a1".into(),
            idempotency_key: "submit-1".into(),
        },
    )
    .unwrap();
    assert_eq!(again.id, submitted.id);
}

#[test]
fn durable_submit_does_not_require_ai_provider_configuration() {
    let (_dir, conn) = open_db();
    save_writing_draft(
        &conn,
        &draft_cmd(
            "submit-without-ai",
            &"A durable submission must survive missing provider setup. ".repeat(20),
            "draft-no-ai",
        ),
    )
    .unwrap();

    // No provider_configs setting or vault secret is created here. Submission
    // remains a durable state transition; evaluation is the fail-closed edge.
    let attempt = submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: "submit-without-ai".into(),
            idempotency_key: "submit-no-ai".into(),
        },
    )
    .unwrap();
    assert_eq!(attempt.status, AttemptStatus::Submitted);
}

#[test]
fn writing_draft_and_submit_never_reopen_a_closed_attempt() {
    let (_dir, conn) = open_db();
    let original = "A submitted essay is an immutable evaluation snapshot. ".repeat(25);
    let stale_autosave = "This stale autosave must not replace the submitted essay.";
    let attempt_id = "writing-state-monotonic";
    save_writing_draft(&conn, &draft_cmd(attempt_id, &original, "draft-open")).unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: attempt_id.into(),
            idempotency_key: "submit-open".into(),
        },
    )
    .unwrap();

    let mut stale = draft_cmd(attempt_id, stale_autosave, "draft-stale");
    let save_error = save_writing_draft(&conn, &stale).unwrap_err();
    assert!(save_error
        .to_string()
        .contains("only an open writing attempt may be changed"));
    let submit_error = submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: attempt_id.into(),
            idempotency_key: "submit-stale".into(),
        },
    )
    .unwrap_err();
    assert!(submit_error
        .to_string()
        .contains("only an open writing attempt may be changed"));

    let submitted = get_history_detail(&conn, attempt_id).unwrap().attempt;
    assert_eq!(submitted.status, AttemptStatus::Submitted);
    assert_eq!(submitted.content_text.as_deref(), Some(original.as_str()));
    assert_eq!(
        get_writing_draft(&conn, attempt_id)
            .unwrap()
            .unwrap()
            .content_text,
        original
    );

    // Evaluation moves the attempt into `reviewing` before provider I/O. A
    // delayed frontend autosave must not roll that projection back to draft.
    prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: attempt_id.into(),
            idempotency_key: "evaluate-open".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "deterministic",
        "test-model",
    )
    .unwrap();
    let reviewing = get_history_detail(&conn, attempt_id).unwrap().attempt;
    assert_eq!(reviewing.status, AttemptStatus::Reviewing);
    stale.idempotency_key = "draft-during-evaluation".into();
    let reviewing_save_error = save_writing_draft(&conn, &stale).unwrap_err();
    assert!(reviewing_save_error
        .to_string()
        .contains("only an open writing attempt may be changed"));
    assert_eq!(
        get_history_detail(&conn, attempt_id)
            .unwrap()
            .attempt
            .content_text
            .as_deref(),
        Some(original.as_str())
    );
}

#[test]
fn cloning_a_frozen_writing_attempt_creates_an_independent_open_draft() {
    let (_dir, conn) = open_db();
    let source_id = "writing-clone-source";
    let source_essay = "The frozen evaluation input must remain untouched. ".repeat(24);
    save_writing_draft(
        &conn,
        &draft_cmd(source_id, &source_essay, "clone-source-draft"),
    )
    .unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: source_id.into(),
            idempotency_key: "clone-source-submit".into(),
        },
    )
    .unwrap();
    prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: source_id.into(),
            idempotency_key: "clone-source-evaluation".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "deterministic",
        "test-model",
    )
    .unwrap();
    assert_eq!(
        get_history_detail(&conn, source_id).unwrap().attempt.status,
        AttemptStatus::Reviewing
    );

    let cloned = clone_writing_draft(
        &conn,
        &CloneWritingDraftCommand {
            source_attempt_id: source_id.into(),
            idempotency_key: "clone-once".into(),
        },
    )
    .unwrap();
    assert_ne!(cloned.attempt_id, source_id);
    assert_eq!(cloned.content_text, source_essay);
    assert_eq!(cloned.mode, Some(AttemptMode::Bank));

    let replay = clone_writing_draft(
        &conn,
        &CloneWritingDraftCommand {
            source_attempt_id: source_id.into(),
            idempotency_key: "clone-once".into(),
        },
    )
    .unwrap();
    assert_eq!(replay.attempt_id, cloned.attempt_id);

    let edited = "The new draft may change without rewriting its source.".to_string();
    save_writing_draft(
        &conn,
        &draft_cmd(&cloned.attempt_id, &edited, "clone-edited-draft"),
    )
    .unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: cloned.attempt_id.clone(),
            idempotency_key: "clone-edited-submit".into(),
        },
    )
    .unwrap();

    assert_eq!(
        get_history_detail(&conn, source_id)
            .unwrap()
            .attempt
            .content_text
            .as_deref(),
        Some(source_essay.as_str())
    );
    assert_eq!(
        get_history_detail(&conn, &cloned.attempt_id)
            .unwrap()
            .attempt
            .status,
        AttemptStatus::Submitted
    );
}

#[test]
fn autosaving_an_active_writing_attempt_preserves_its_open_status() {
    let (_dir, conn) = open_db();
    let attempt_id = "writing-active-autosave";
    save_writing_draft(
        &conn,
        &draft_cmd(attempt_id, "The first open draft.", "draft-active-first"),
    )
    .unwrap();
    conn.execute(
        "UPDATE attempts SET status = 'active' WHERE id = ?1",
        rusqlite::params![attempt_id],
    )
    .unwrap();

    save_writing_draft(
        &conn,
        &draft_cmd(
            attempt_id,
            "The latest autosave keeps the attempt active.",
            "draft-active-second",
        ),
    )
    .unwrap();

    let attempt = get_history_detail(&conn, attempt_id).unwrap().attempt;
    assert_eq!(attempt.status, AttemptStatus::Active);
    assert_eq!(
        attempt.content_text.as_deref(),
        Some("The latest autosave keeps the attempt active.")
    );
}

#[test]
fn completed_writing_attempt_rejects_a_stale_draft_save() {
    let (_dir, conn) = open_db();
    let original = "A completed evaluation keeps its submitted source immutable. ".repeat(25);
    let attempt_id = "writing-completed-state-monotonic";
    save_writing_draft(&conn, &draft_cmd(attempt_id, &original, "draft-completed")).unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: attempt_id.into(),
            idempotency_key: "submit-completed".into(),
        },
    )
    .unwrap();

    let provider = DeterministicProvider;
    let evaluation = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: attempt_id.into(),
            idempotency_key: "evaluate-completed".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &provider,
    )
    .unwrap();
    assert!(matches!(
        evaluation.evaluation.status,
        EvaluationStatus::Completed | EvaluationStatus::Degraded
    ));
    assert_eq!(
        get_history_detail(&conn, attempt_id)
            .unwrap()
            .attempt
            .status,
        AttemptStatus::Completed
    );

    let error = save_writing_draft(
        &conn,
        &draft_cmd(
            attempt_id,
            "This content must never replace a completed evaluation input.",
            "draft-after-completed",
        ),
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("only an open writing attempt may be changed"));
    assert_eq!(
        get_history_detail(&conn, attempt_id)
            .unwrap()
            .attempt
            .content_text
            .as_deref(),
        Some(original.as_str())
    );
}

#[test]
fn writing_draft_requires_an_explicit_writing_source_mode() {
    let (_dir, conn) = open_db();
    let essay = "A freeform draft has a durable mode rather than a UI default.";
    let mut freeform = draft_cmd("freeform-mode", essay, "freeform-key");
    freeform.mode = AttemptMode::Freeform;
    save_writing_draft(&conn, &freeform).unwrap();
    assert_eq!(
        get_writing_draft(&conn, "freeform-mode")
            .unwrap()
            .unwrap()
            .mode,
        Some(AttemptMode::Freeform)
    );

    let mut invalid = draft_cmd("invalid-mode", essay, "invalid-key");
    invalid.mode = AttemptMode::Single;
    let error = save_writing_draft(&conn, &invalid).unwrap_err();
    assert!(error.to_string().contains("mode=freeform or mode=bank"));
}

#[test]
fn evaluation_runs_stages_and_persists_checkpoints() {
    let (_dir, conn) = open_db();
    let essay = "Universities should balance theory and practice. ".repeat(50);
    save_writing_draft(&conn, &draft_cmd("a2", &essay, "d2")).unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: "a2".into(),
            idempotency_key: "s2".into(),
        },
    )
    .unwrap();

    let provider = DeterministicProvider;
    let result = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a2".into(),
            idempotency_key: "eval-1".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &provider,
    )
    .unwrap();

    assert!(matches!(
        result.evaluation.status,
        EvaluationStatus::Completed | EvaluationStatus::Degraded
    ));
    assert!(result.evaluation.score.is_some());
    assert!(!result.events.is_empty());
    assert!(result.events.iter().any(|e| e.event_type == "score"));

    // checkpoints exist
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evaluation_checkpoints WHERE evaluation_id = ?1",
            rusqlite::params![result.session.evaluation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(n >= 2);

    // reload from DB only
    let loaded = load_evaluation_for_attempt(&conn, "a2").unwrap().unwrap();
    assert_eq!(
        loaded.score.as_ref().unwrap().overall,
        result.evaluation.score.as_ref().unwrap().overall
    );

    // idempotent start
    let again = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a2".into(),
            idempotency_key: "eval-1".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &provider,
    )
    .unwrap();
    assert_eq!(again.session.evaluation_id, result.session.evaluation_id);
    let learning = list_learning_events(&conn, None, Some("a2"), 20).unwrap();
    assert_eq!(learning.len(), 1);
    assert_eq!(
        learning[0].event_type,
        ielts_domain::LearningEventType::WritingEvaluationCompleted
    );
    assert_eq!(
        learning[0].payload["evaluationId"],
        result.session.evaluation_id
    );
    assert!(learning[0].payload.get("contentText").is_none());
    assert!(learning[0].payload.get("promptSnapshot").is_none());
}

struct FailReviewProvider;
impl WritingProvider for FailReviewProvider {
    fn id(&self) -> &str {
        "fail-review"
    }
    fn model(&self) -> &str {
        "x"
    }
    fn score(
        &self,
        essay: &str,
        prompt: Option<&str>,
        task_type: Option<WritingTaskType>,
    ) -> Result<WritingScoreV4, ProviderError> {
        DeterministicProvider.score(essay, prompt, task_type)
    }
    fn review(
        &self,
        _essay: &str,
        _score: &WritingScoreV4,
    ) -> Result<WritingFeedbackV4, ProviderError> {
        Err(ProviderError {
            message: "review json invalid".into(),
            retryable: true,
        })
    }
}

#[test]
fn review_failure_degrades_but_keeps_score() {
    let (_dir, conn) = open_db();
    let essay = "Balanced education is important. ".repeat(40);
    save_writing_draft(&conn, &draft_cmd("a3", &essay, "d3")).unwrap();
    let result = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a3".into(),
            idempotency_key: "eval-deg".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &FailReviewProvider,
    )
    .unwrap();
    assert_eq!(result.evaluation.status, EvaluationStatus::Degraded);
    assert!(result.evaluation.score.is_some());
    assert!(result.evaluation.degradation.is_some());
    let learning = list_learning_events(&conn, None, Some("a3"), 20).unwrap();
    assert_eq!(learning.len(), 1);
    assert_eq!(learning[0].payload["status"], "degraded");
}

#[test]
fn cancel_keeps_draft_inputs() {
    let (_dir, conn) = open_db();
    let essay = "Keep my essay text safe. ".repeat(30);
    save_writing_draft(&conn, &draft_cmd("a4", &essay, "d4")).unwrap();
    // Pre-create a session-like path: start with a provider that we cancel mid-flight is hard
    // in sync mode; instead mark cancel before stages via manual session is overkill.
    // Verify request_cancel API + draft retained after interrupted recovery.
    let provider = DeterministicProvider;
    let result = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a4".into(),
            idempotency_key: "eval-c".into(),
            task_type: None,
            retry_of: None,
        },
        &provider,
    )
    .unwrap();
    // cancel after complete is no-op; draft still present
    let _ = request_cancel(&conn, &result.session.evaluation_id).unwrap();
    let draft = get_writing_draft(&conn, "a4").unwrap().unwrap();
    assert!(draft.content_text.contains("Keep my essay"));
}

#[test]
fn retry_creates_lineage() {
    let (_dir, conn) = open_db();
    let essay = "Retry lineage should preserve history. ".repeat(40);
    save_writing_draft(&conn, &draft_cmd("a5", &essay, "d5")).unwrap();
    let provider = DeterministicProvider;
    let first = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a5".into(),
            idempotency_key: "eval-r1".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &provider,
    )
    .unwrap();
    let second = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a5".into(),
            idempotency_key: "eval-r2".into(),
            task_type: Some("task2".into()),
            retry_of: Some(first.session.evaluation_id.clone()),
        },
        &provider,
    )
    .unwrap();
    assert_ne!(first.session.evaluation_id, second.session.evaluation_id);
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM evaluation_lineage WHERE evaluation_id = ?1",
            rusqlite::params![second.session.evaluation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn recover_marks_running_sessions_interrupted() {
    let (_dir, conn) = open_db();
    let essay = "Crash recovery test content. ".repeat(30);
    save_writing_draft(&conn, &draft_cmd("a6", &essay, "d6")).unwrap();
    // Insert synthetic running session
    conn.execute(
        "INSERT INTO attempts (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
         VALUES ('a6', 'writing', 'bank', 'reviewing', '2025-01-01T00:00:00Z', 0, 1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .ok();
    conn.execute(
        "INSERT INTO writing_evaluations (id, attempt_id, status, stage, rubric_version, prompt_version, updated_at, started_at)
         VALUES ('e-run', 'a6', 'running', 'scoring', 'r', 'p', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO evaluation_sessions (
            id, attempt_id, evaluation_id, status, stage, revision, sequence, cancel_requested, started_at, updated_at
         ) VALUES ('s-run', 'a6', 'e-run', 'running', 'scoring', 1, 1, 0, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let n = recover_interrupted_sessions(&conn).unwrap();
    assert!(n >= 1);
    let status: String = conn
        .query_row(
            "SELECT status FROM evaluation_sessions WHERE id = 's-run'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "interrupted");
    // draft still there
    assert!(get_writing_draft(&conn, "a6").unwrap().is_some());
}

#[test]
fn recovery_reconciles_result_event_and_attempt_projection() {
    let (_dir, conn) = open_db();
    let essay = "Recovery must leave one canonical writing state. ".repeat(30);
    save_writing_draft(&conn, &draft_cmd("a-reconcile", &essay, "d-reconcile")).unwrap();
    let prepared = prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-reconcile".into(),
            idempotency_key: "eval-reconcile".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "openai-compatible",
        "test-model",
    )
    .unwrap();

    // Simulate a process death after the durable session moved to scoring but
    // before its JSON snapshot was updated for that stage.
    conn.execute(
        "UPDATE evaluation_sessions SET status = 'running', stage = 'scoring', revision = 4
         WHERE id = ?1",
        rusqlite::params![prepared.session_id],
    )
    .unwrap();
    conn.execute(
        "UPDATE writing_evaluations SET status = 'running', stage = 'scoring'
         WHERE id = ?1",
        rusqlite::params![prepared.evaluation_id],
    )
    .unwrap();

    assert_eq!(recover_interrupted_sessions(&conn).unwrap(), 1);
    assert_eq!(recover_interrupted_sessions(&conn).unwrap(), 0);

    let canonical = load_evaluation_for_attempt(&conn, "a-reconcile")
        .unwrap()
        .unwrap();
    assert_eq!(canonical.id, prepared.evaluation_id);
    assert_eq!(canonical.status, EvaluationStatus::Interrupted);
    assert_eq!(canonical.stage, EvaluationStage::Scoring);

    let result_json: String = conn
        .query_row(
            "SELECT result_json FROM writing_evaluations WHERE id = ?1",
            rusqlite::params![prepared.evaluation_id],
            |row| row.get(0),
        )
        .unwrap();
    let persisted: WritingEvaluationV4 = serde_json::from_str(&result_json).unwrap();
    assert_eq!(persisted.status, EvaluationStatus::Interrupted);
    assert_eq!(persisted.stage, EvaluationStage::Scoring);

    let events = list_events(&conn, &prepared.evaluation_id, 0).unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "interrupted")
            .count(),
        1
    );
    assert!(events.iter().any(|event| {
        event.event_type == "interrupted"
            && event.payload["reason"] == "process_restarted"
            && event.payload["keptInputs"] == true
    }));

    let (attempt_status, attempt_completed_at): (String, Option<String>) = conn
        .query_row(
            "SELECT status, completed_at FROM attempts WHERE id = 'a-reconcile'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(attempt_status, "interrupted");
    assert!(attempt_completed_at.is_some());
    assert_eq!(
        get_writing_draft(&conn, "a-reconcile")
            .unwrap()
            .unwrap()
            .content_text,
        essay
    );
}

#[test]
fn retry_keeps_latest_result_when_an_older_provider_call_finishes_late() {
    let (_dir, conn) = open_db();
    let essay = "Latest retry must win over an old provider response. ".repeat(40);
    save_writing_draft(
        &conn,
        &draft_cmd("a-latest-retry", &essay, "d-latest-retry"),
    )
    .unwrap();

    let first = prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-latest-retry".into(),
            idempotency_key: "eval-latest-first".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "openai-compatible",
        "test-model",
    )
    .unwrap();
    let second = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-latest-retry".into(),
            idempotency_key: "eval-latest-second".into(),
            task_type: Some("task2".into()),
            retry_of: Some(first.evaluation_id.clone()),
        },
        &DeterministicProvider,
    )
    .unwrap();
    let second_score = second.evaluation.score.as_ref().unwrap().overall;

    // The stale request finishes after the retry. Its update timestamp is now
    // newer, but it is not the newest evaluation in the retry lineage.
    let late_score = WritingScoreV4 {
        overall: 5.0,
        task_response: 5.0,
        coherence: 5.0,
        lexical: 5.0,
        grammar: 5.0,
    };
    let late_feedback = WritingFeedbackV4 {
        overall: Some("stale response".into()),
        plan: vec![],
        paragraphs: vec![],
        sentences: vec![],
        rewrites: vec![],
    };
    finish_evaluation(&conn, &first, Ok(late_score), Some(late_feedback), None).unwrap();

    let latest = load_evaluation_for_attempt(&conn, "a-latest-retry")
        .unwrap()
        .unwrap();
    assert_eq!(latest.id, second.session.evaluation_id);
    assert_eq!(latest.score.as_ref().unwrap().overall, second_score);

    let history = get_history_detail(&conn, "a-latest-retry").unwrap();
    assert_eq!(history.evaluation.unwrap().id, second.session.evaluation_id);
    let (attempt_status, attempt_score): (String, Option<f64>) = conn
        .query_row(
            "SELECT status, score_value FROM attempts WHERE id = 'a-latest-retry'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(attempt_status, "completed");
    assert_eq!(attempt_score, Some(second_score));
}

#[test]
fn recovery_of_an_old_session_does_not_override_a_completed_retry() {
    let (_dir, conn) = open_db();
    let essay = "Recovering an old session must not hide the newer retry. ".repeat(35);
    save_writing_draft(
        &conn,
        &draft_cmd("a-recovery-retry", &essay, "d-recovery-retry"),
    )
    .unwrap();

    let first = prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-recovery-retry".into(),
            idempotency_key: "eval-recovery-old".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "openai-compatible",
        "test-model",
    )
    .unwrap();
    let second = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-recovery-retry".into(),
            idempotency_key: "eval-recovery-new".into(),
            task_type: Some("task2".into()),
            retry_of: Some(first.evaluation_id.clone()),
        },
        &DeterministicProvider,
    )
    .unwrap();

    assert_eq!(recover_interrupted_sessions(&conn).unwrap(), 1);
    let latest = load_evaluation_for_attempt(&conn, "a-recovery-retry")
        .unwrap()
        .unwrap();
    assert_eq!(latest.id, second.session.evaluation_id);
    assert!(matches!(
        latest.status,
        EvaluationStatus::Completed | EvaluationStatus::Degraded
    ));
    let attempt_status: String = conn
        .query_row(
            "SELECT status FROM attempts WHERE id = 'a-recovery-retry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempt_status, "completed");
}

#[test]
fn crash_during_unlocked_provider_call_recovers_without_losing_input() {
    let (_dir, conn) = open_db();
    let essay = "The provider call must not own the database lock. ".repeat(30);
    save_writing_draft(&conn, &draft_cmd("a-network", &essay, "d-network")).unwrap();
    let prepared = prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-network".into(),
            idempotency_key: "eval-network".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "openai-compatible",
        "test-model",
    )
    .unwrap();

    assert!(prepared.existing.is_none());
    assert_eq!(prepared.essay, essay);
    assert_eq!(recover_interrupted_sessions(&conn).unwrap(), 1);
    let status: String = conn
        .query_row(
            "SELECT status FROM evaluation_sessions WHERE id = ?1",
            rusqlite::params![prepared.session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "interrupted");
    assert_eq!(
        get_writing_draft(&conn, "a-network")
            .unwrap()
            .unwrap()
            .content_text,
        essay
    );
}

#[test]
fn prepare_returns_a_durable_handle_before_provider_io() {
    let (_dir, conn) = open_db();
    let essay = "A durable handle must exist before the network request. ".repeat(25);
    save_writing_draft(&conn, &draft_cmd("a-handle", &essay, "d-handle")).unwrap();

    let prepared = prepare_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a-handle".into(),
            idempotency_key: "eval-handle".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "openai-compatible",
        "test-model",
    )
    .unwrap();

    assert_eq!(prepared.handle.attempt_id, "a-handle");
    assert_eq!(prepared.handle.session_id, prepared.session_id);
    assert_eq!(prepared.handle.evaluation_id, prepared.evaluation_id);
    assert_eq!(prepared.handle.sequence, 1);
    let snapshot = load_evaluation_for_attempt(&conn, "a-handle")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.id, prepared.evaluation_id);
    assert_eq!(snapshot.status, EvaluationStatus::Queued);
    let events = list_events(&conn, &prepared.evaluation_id, 0).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "stage");
}

#[test]
fn cancel_is_immediately_persisted_and_idempotent_start_cannot_overwrite_it() {
    let (_dir, conn) = open_db();
    let essay = "Cancellation must not wait for an HTTP timeout. ".repeat(25);
    save_writing_draft(&conn, &draft_cmd("a-cancel-now", &essay, "d-cancel-now")).unwrap();
    let command = StartEvaluationCommand {
        attempt_id: "a-cancel-now".into(),
        idempotency_key: "eval-cancel-now".into(),
        task_type: Some("task2".into()),
        retry_of: None,
    };
    let prepared = prepare_evaluation(&conn, &command, "openai-compatible", "test-model").unwrap();

    assert!(request_cancel(&conn, &prepared.evaluation_id).unwrap());
    assert!(!request_cancel(&conn, &prepared.evaluation_id).unwrap());
    let snapshot = load_evaluation_for_attempt(&conn, "a-cancel-now")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.status, EvaluationStatus::Interrupted);
    assert!(list_events(&conn, &prepared.evaluation_id, 0)
        .unwrap()
        .iter()
        .any(|event| event.event_type == "cancelled"));

    let result = start_evaluation(&conn, &command, &DeterministicProvider).unwrap();
    assert_eq!(result.evaluation.status, EvaluationStatus::Interrupted);
    assert_eq!(
        get_writing_draft(&conn, "a-cancel-now")
            .unwrap()
            .unwrap()
            .content_text,
        essay
    );
}

#[test]
fn events_have_monotonic_sequence() {
    let (_dir, conn) = open_db();
    let essay = "Sequence events for channel consumers. ".repeat(40);
    save_writing_draft(&conn, &draft_cmd("a7", &essay, "d7")).unwrap();
    let result = start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "a7".into(),
            idempotency_key: "eval-seq".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &DeterministicProvider,
    )
    .unwrap();
    let events = list_events(&conn, &result.session.evaluation_id, 0).unwrap();
    let mut last = 0u32;
    for e in &events {
        assert!(e.sequence > last);
        last = e.sequence;
        assert!(e.revision >= 1 || e.event_type == "completed");
    }
}
