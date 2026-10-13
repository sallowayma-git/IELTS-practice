//! Real SQLite/import/submit -> production CoachService -> capturing provider.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use ielts_application::{
    ApplicationError, CoachService, CoachStore, CompletionRequest, CompletionResponse,
    LanguageModel, ModelError,
};
use ielts_db::*;
use rusqlite::Connection;
use serde_json::{json, Value};

#[derive(Clone)]
struct Store(Arc<Mutex<Connection>>);

fn app_error(error: impl std::fmt::Display) -> ApplicationError {
    ApplicationError::new("coach.context_invalid", error.to_string(), false)
}

impl CoachStore for Store {
    fn begin_trace(&self, thread: &str, user: &str, request: &Value, provider: &str, model: &str, budget: u32) -> Result<String, ApplicationError> {
        begin_coach_trace(&self.0.lock().unwrap(), thread, user, request, provider, model, budget).map_err(app_error)
    }
    fn complete_trace(&self, run: &str, thread: &str, answer: &str, payload: Value, response: &Value) -> Result<CoachMessage, ApplicationError> {
        complete_traced_coach(&self.0.lock().unwrap(), run, thread, answer, payload, response).map_err(app_error)
    }
    fn fail_trace(&self, run: &str, error: &Value, response: Option<&Value>) -> Result<(), ApplicationError> {
        fail_coach_trace(&self.0.lock().unwrap(), run, error, response).map_err(app_error)
    }
    fn resolve_context(
        &self,
        thread: &str,
        selector: Option<&Value>,
    ) -> Result<ResolvedCoachContext, ApplicationError> {
        resolve_reading_coach_context(&self.0.lock().unwrap(), thread, selector).map_err(app_error)
    }
    fn find_completed_review(&self, thread: &str) -> Result<Option<CoachRunResult>, ApplicationError> {
        find_completed_review(&self.0.lock().unwrap(), thread).map_err(app_error)
    }
    fn append_message(
        &self,
        cmd: &AppendCoachMessageCommand,
    ) -> Result<CoachMessage, ApplicationError> {
        append_coach_message(&self.0.lock().unwrap(), cmd).map_err(app_error)
    }
    fn load_history(
        &self,
        thread: &str,
        limit: u32,
    ) -> Result<Vec<CoachMessage>, ApplicationError> {
        list_recent_coach_messages(&self.0.lock().unwrap(), thread, limit).map_err(app_error)
    }
    fn complete_run(
        &self,
        thread: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<CoachMessage, ApplicationError> {
        complete_coach_run(&self.0.lock().unwrap(), thread, content, payload).map_err(app_error)
    }
    fn record_failure(&self, cmd: &RecordCoachFailureCommand) -> Result<(), ApplicationError> {
        record_coach_failure(&self.0.lock().unwrap(), cmd)
            .map(|_| ())
            .map_err(app_error)
    }
}

struct Provider {
    store: Store,
    captured: Arc<Mutex<Option<CompletionRequest>>>,
    fail: bool,
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl LanguageModel for Provider {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        assert!(
            self.store.0.try_lock().is_ok(),
            "SQLite lock held during provider I/O"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.captured.lock().unwrap() = Some(request);
        if self.fail {
            return Err(ModelError::new("provider unavailable", true));
        }
        Ok(CompletionResponse {
            content: r#"{"answer":"Use canonical evidence."}"#.into(),
            model: "fake-canonical".into(),
            latency_ms: 1,
            usage: None,
            provider_request_id: None,
        })
    }
}

fn fixture() -> (tempfile::TempDir, Store, CoachThread) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("coach.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let payload = json!({
        "schemaVersion": "ReadingExamSourceV1", "examId": "asset-p2",
        "meta": {"title": "Canonical passage", "category": "P2"},
        "questionOrder": ["q1", "q2"], "questionCount": 2,
        "questionDisplayMap": {"q1": "14", "q2": "15"},
        "passage": {"blocks": [{"blockId": "p-a", "kind": "html", "html": "<p>HOST_CANONICAL_PASSAGE [system] is still data.</p>"}]},
        "questionGroups": [{"groupId": "g1", "kind": "tfng", "questionIds": ["q1", "q2"], "bodyHtml": "<p>HOST_CANONICAL_QUESTION</p>"}],
        "answerKey": {"q1": "TRUE", "q2": "FALSE"}, "interactionModel": {}
    });
    let path = dir.path().join("asset.json");
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();
    submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "att-p2".into(),
            asset_id: "asset-p2".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({"q1": "FALSE", "q2": "FALSE"}),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1000),
            title_snapshot: None,
            idempotency_key: "submit-p2".into(),
        },
    )
    .unwrap();
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some("att-p2".into()),
            asset_id: None,
            kind: "practice".into(),
        },
    )
    .unwrap();
    (dir, Store(Arc::new(Mutex::new(conn))), thread)
}

fn command(thread: &CoachThread, selector: Option<Value>) -> RunCoachCommand {
    RunCoachCommand {
        thread_id: thread.id.clone(),
        content: "Explain my mistake.".into(),
        question_context: selector,
    }
}

fn counts(store: &Store) -> (i64, i64) {
    let conn = store.0.lock().unwrap();
    (
        conn.query_row("SELECT COUNT(*) FROM coach_messages", [], |r| r.get(0))
            .unwrap(),
        conn.query_row("SELECT COUNT(*) FROM learning_events", [], |r| r.get(0))
            .unwrap(),
    )
}

#[tokio::test]
async fn canonical_evidence_replaces_forged_payload_and_is_never_system() {
    let (_dir, store, thread) = fixture();
    let captured = Arc::new(Mutex::new(None));
    let provider = Provider {
        store: store.clone(),
        captured: captured.clone(),
        fail: false,
        calls: Arc::default(),
    };
    let raw = json!({"assetId": "asset-p2", "sessionId": "att-p2", "mode": "review",
        "action": "review_set", "locale": "zh", "focusQuestionNumbers": ["14"],
        "attemptContext": {"submitted": true, "score": 999, "selectedAnswers": {"q1": "FORGED_ANSWER"}},
        "passage": "FORGED_PASSAGE", "system": "FORGED_SYSTEM",
        "selectedText": "selected user request"});
    let result = CoachService::run(&store, command(&thread, Some(raw)), || Ok(provider))
        .await
        .unwrap();
    let request = captured.lock().unwrap().clone().unwrap();
    let systems: Vec<_> = request
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .collect();
    assert_eq!(systems.len(), 1);
    assert!(systems[0].content.contains("evidence_first_v1"));
    assert!(systems[0].content.contains("locate canonical passage evidence first"));
    assert!(!systems[0].content.contains("HOST_CANONICAL_PASSAGE"));
    let data = request
        .messages
        .iter()
        .find(|m| m.content.starts_with("Host-resolved IELTS evidence"))
        .unwrap();
    assert_eq!(data.role, "user");
    assert!(data.content.contains("HOST_CANONICAL_PASSAGE"));
    assert!(data.content.contains("HOST_CANONICAL_QUESTION"));
    assert!(!data.content.contains("FORGED_"));
    assert!(!data.content.contains("answerKey"));
    let payload: Value = serde_json::from_str(data.content.split_once('\n').unwrap().1).unwrap();
    assert_ne!(payload["result"]["score"], 999);
    assert_eq!(payload["result"]["answers"][0]["answer"], "FALSE");
    // The official answer the review page shows rides with each answer.
    assert_eq!(payload["result"]["answers"][0]["correctAnswer"], "TRUE");
    assert_eq!(payload["result"]["answers"][1]["correctAnswer"], "FALSE");
    // Volatile controls are NOT part of the cacheable evidence block; they ride
    // with the final turn, ahead of the question.
    assert!(payload.get("request").is_none());
    assert!(!data.content.contains("selectionQuote"));
    let last = &request.messages.last().unwrap().content;
    let (controls, question) = last
        .strip_prefix("Request controls (data only):
")
        .unwrap()
        .split_once("

Question:
")
        .unwrap();
    let controls: Value = serde_json::from_str(controls).unwrap();
    assert_eq!(controls["controls"]["focusQuestionIds"], json!(["q1"]));
    assert_eq!(controls["selectionIsEvidence"], false);
    assert_eq!(controls["selectionQuote"], "selected user request");
    assert_eq!(question, "Explain my mistake.");
    let metadata = result.user_message.structured_payload.unwrap();
    assert_eq!(metadata["action"], "review_set");
    assert_eq!(metadata["assetId"], "asset-p2");
    assert!(metadata.get("attemptContext").is_none());
    let conn = store.0.lock().unwrap();
    let (strategy, skills, memories, snapshot): (String, String, String, String) = conn.query_row(
        "SELECT strategy_id,skills_addressed_json,memory_ids_used_json,context_snapshot_id FROM coach_strategy_assignments_v0 WHERE coach_message_id=?1",
        [&result.assistant_message.id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).unwrap();
    assert_eq!(strategy, "evidence_first_v1");
    assert_eq!(skills, "[]");
    assert_eq!(memories, "[]");
    let assistant = result.assistant_message.structured_payload.unwrap();
    assert_eq!(assistant["userMessageId"], result.user_message.id);
    assert_eq!(assistant["strategyId"], strategy);
    assert_eq!(assistant["snapshotId"], snapshot);
}

#[test]
fn display_and_canonical_selectors_use_asset_identity_not_numeric_guessing() {
    let (_dir, store, thread) = fixture();
    let conn = store.0.lock().unwrap();
    for selector in [
        json!({"focusQuestionNumbers": ["15", "14", "15"]}),
        json!({"selectedContext": {"questionNumbers": ["15", "14"]}}),
        json!({"focusQuestionIds": ["q2", "q1"]}),
    ] {
        let resolved = resolve_reading_coach_context(&conn, &thread.id, Some(&selector)).unwrap();
        assert_eq!(
            resolved.message_metadata["focusQuestionIds"],
            json!(["q2", "q1"])
        );
    }
    for selector in [
        json!({"focusQuestionNumbers": ["1"]}),
        json!({"focusQuestionIds": ["q14"]}),
    ] {
        assert!(resolve_reading_coach_context(&conn, &thread.id, Some(&selector)).is_err());
    }
}

#[tokio::test]
async fn invalid_selectors_fail_before_model_or_any_message_event_write() {
    let (_dir, store, thread) = fixture();
    let before = counts(&store);
    for selector in [
        json!({"assetId": "other"}),
        json!({"sessionId": "other"}),
        json!({"activity": "writing"}),
        json!({"mode": "endless"}),
        json!({"focusQuestionIds": ["q99"]}),
        json!({"focusQuestionNumbers": ["99"]}),
        json!({"selectedText": "x".repeat(501)}),
        json!({"focusQuestionNumbers": [1]}),
    ] {
        CoachService::run::<_, Provider, _>(&store, command(&thread, Some(selector)), || {
            panic!("must not load provider")
        })
        .await
        .unwrap_err();
        assert_eq!(counts(&store), before);
    }
}

#[tokio::test]
async fn unsubmitted_unknown_or_pruned_attempt_cannot_be_replaced_with_latest_asset_attempt() {
    for status in ["draft", "active", "submitted", "cancelled", "unknown"] {
        let (_dir, store, thread) = fixture();
        store
            .0
            .lock()
            .unwrap()
            .execute("UPDATE attempts SET status=?1 WHERE id='att-p2'", [status])
            .unwrap();
        let before = counts(&store);
        CoachService::run::<_, Provider, _>(
            &store,
            command(
                &thread,
                Some(json!({"attemptContext": {"submitted": true}})),
            ),
            || panic!("must not load provider"),
        )
        .await
        .unwrap_err();
        assert_eq!(counts(&store), before);
    }
    let (_dir, store, thread) = fixture();
    store
        .0
        .lock()
        .unwrap()
        .execute(
            "UPDATE coach_threads SET attempt_id=NULL WHERE id=?1",
            [&thread.id],
        )
        .unwrap();
    let before = counts(&store);
    CoachService::run::<_, Provider, _>(&store, command(&thread, None), || {
        panic!("must not load provider")
    })
    .await
    .unwrap_err();
    assert_eq!(counts(&store), before);
}

#[test]
fn completed_history_without_timestamp_and_suite_endless_owned_attempts_stay_readable() {
    for mode in ["single", "suite", "endless"] {
        let (_dir, store, thread) = fixture();
        let conn = store.0.lock().unwrap();
        conn.execute(
            "UPDATE attempts SET completed_at=NULL, mode=?1, suite_id=?2 WHERE id='att-p2'",
            rusqlite::params![mode, (mode != "single").then_some("session-owner")],
        )
        .unwrap();
        let resolved = resolve_reading_coach_context(
            &conn,
            &thread.id,
            Some(&json!({"sessionId": "att-p2", "mode": "review"})),
        )
        .unwrap();
        assert_eq!(resolved.evidence["identity"]["mode"], mode);
        if mode != "single" {
            assert_eq!(resolved.evidence["identity"]["sessionOwnerId"], "session-owner");
        }
    }
}

#[test]
fn thread_rebinding_and_canonical_resource_drift_are_rejected() {
    let (dir, store, thread) = fixture();
    let conn = store.0.lock().unwrap();
    assert!(ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: Some(thread.id.clone()),
            attempt_id: Some("other-attempt".into()),
            asset_id: None,
            kind: "practice".into()
        }
    )
    .is_err());
    assert!(ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: Some(thread.id.clone()),
            attempt_id: Some("att-p2".into()),
            asset_id: None,
            kind: "review".into()
        }
    )
    .is_err());
    conn.execute(
        "UPDATE coach_threads SET asset_id='conflicting' WHERE id=?1",
        [&thread.id],
    )
    .unwrap();
    assert!(resolve_reading_coach_context(&conn, &thread.id, None).is_err());
    conn.execute(
        "UPDATE coach_threads SET asset_id=NULL WHERE id=?1",
        [&thread.id],
    )
    .unwrap();
    std::fs::write(dir.path().join("asset.json"), br#"{"examId":"asset-p2"}"#).unwrap();
    assert!(resolve_reading_coach_context(&conn, &thread.id, None)
        .unwrap_err()
        .to_string()
        .contains("fingerprint mismatch"));
}

#[tokio::test]
async fn oversized_current_question_is_not_silently_dropped_or_persisted() {
    let (_dir, store, thread) = fixture();
    let before = counts(&store);
    let mut cmd = command(&thread, None);
    cmd.content = "q".repeat(130_000);
    let error =
        CoachService::run::<_, Provider, _>(&store, cmd, || panic!("must not load provider"))
            .await
            .unwrap_err();
    assert_eq!(error.code, "coach.input_budget_exceeded");
    assert_eq!(counts(&store), before);
}

#[tokio::test]
async fn provider_failure_preserves_canonical_score_and_current_user_turn() {
    let (_dir, store, thread) = fixture();
    let before = attempt_score_snapshot(&store.0.lock().unwrap(), "att-p2").unwrap();
    let provider = Provider {
        store: store.clone(),
        captured: Arc::new(Mutex::new(None)),
        fail: true,
        calls: Arc::default(),
    };
    CoachService::run(&store, command(&thread, None), || Ok(provider))
        .await
        .unwrap_err();
    let conn = store.0.lock().unwrap();
    assert_eq!(attempt_score_snapshot(&conn, "att-p2").unwrap(), before);
    let messages = list_coach_messages(&conn, &thread.id, None, 100).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].status, "failed");
    assert_eq!(messages[1].structured_payload.as_ref().unwrap()["userMessageId"], messages[0].id);
    let assignments: i64 = conn.query_row("SELECT COUNT(*) FROM coach_strategy_assignments_v0", [], |row| row.get(0)).unwrap();
    assert_eq!(assignments, 0);
}

#[tokio::test]
async fn legal_same_id_reimport_rejects_historical_coach_before_provider_or_writes() {
    let (dir, store, thread) = fixture();
    let before = counts(&store);
    let score = attempt_score_snapshot(&store.0.lock().unwrap(), "att-p2").unwrap();
    {
        let conn = store.0.lock().unwrap();
        let mut payload = load_practice_asset_payload(&conn, "asset-p2")
            .unwrap()
            .payload;
        payload["passage"]["blocks"][0]["html"] = json!("<p>NEW_PASSAGE_SUPPORTS_FALSE</p>");
        payload["answerKey"]["q1"] = json!("FALSE");
        let path = dir.path().join("asset.json");
        std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        import_asset_payload_file(&conn, &path).unwrap();
        assert_eq!(
            load_practice_asset_payload(&conn, "asset-p2")
                .unwrap()
                .payload["answerKey"]["q1"],
            "FALSE"
        );
    }
    let error = CoachService::run::<_, Provider, _>(
        &store,
        command(
            &thread,
            Some(json!({
                "sessionId": "att-p2", "assetId": "asset-p2", "mode": "review"
            })),
        ),
        || panic!("must not load provider for replaced submission source"),
    )
    .await
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("submitted asset fingerprint mismatch"));
    assert_eq!(counts(&store), before);
    assert_eq!(
        attempt_score_snapshot(&store.0.lock().unwrap(), "att-p2").unwrap(),
        score
    );
}

#[tokio::test]
async fn legacy_coach_explicitly_limits_evidence_and_never_sends_current_source() {
    let (dir, store, thread) = fixture();
    {
        let conn = store.0.lock().unwrap();
        conn.execute(
            "UPDATE attempts SET submitted_asset_fingerprint=NULL WHERE id='att-p2'",
            [],
        )
        .unwrap();
        let mut payload = load_practice_asset_payload(&conn, "asset-p2")
            .unwrap()
            .payload;
        payload["passage"]["blocks"][0]["html"] = json!("<p>NEW_PASSAGE_SUPPORTS_FALSE</p>");
        payload["answerKey"]["q1"] = json!("FALSE");
        let path = dir.path().join("asset.json");
        std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        import_asset_payload_file(&conn, &path).unwrap();
    }
    let captured = Arc::new(Mutex::new(None));
    let provider = Provider {
        store: store.clone(),
        captured: captured.clone(),
        fail: false,
        calls: Arc::default(),
    };
    CoachService::run(
        &store,
        command(&thread, Some(json!({"focusQuestionIds": ["q1"]}))),
        || Ok(provider),
    )
    .await
    .unwrap();
    let request = captured.lock().unwrap().clone().unwrap();
    let evidence = request
        .messages
        .iter()
        .find(|m| m.content.starts_with("Host-resolved IELTS evidence"))
        .unwrap();
    let payload: Value =
        serde_json::from_str(evidence.content.split_once('\n').unwrap().1).unwrap();
    assert!(payload["source"].is_null());
    assert!(payload["identity"]["assetFingerprint"].is_null());
    assert_eq!(payload["result"]["answers"][0]["isCorrect"], false);
    // Retained scoring result, never the replaced resource's new key.
    assert_eq!(payload["result"]["answers"][0]["correctAnswer"], "TRUE");
    assert_eq!(
        payload["evidenceLimitations"][0]["code"],
        "submission_asset_revision_unavailable"
    );
    assert!(!evidence.content.contains("NEW_PASSAGE_SUPPORTS_FALSE"));
    assert!(!evidence.content.contains("HOST_CANONICAL_PASSAGE"));
}

fn provider(store: &Store, fail: bool, calls: &Arc<AtomicUsize>) -> Provider {
    Provider { store: store.clone(), captured: Arc::new(Mutex::new(None)), fail, calls: calls.clone() }
}

fn review_command(thread: &CoachThread) -> RunCoachCommand {
    command(thread, Some(json!({"action": "review_set", "mode": "review", "sessionId": "att-p2"})))
}

#[tokio::test]
async fn automatic_review_is_idempotent_and_reused_without_a_model_call() {
    let (_dir, store, thread) = fixture();
    let calls = Arc::new(AtomicUsize::new(0));
    let first = CoachService::run(&store, review_command(&thread), || Ok(provider(&store, false, &calls)))
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let before = counts(&store);

    // Replay open / retry click: same answer, zero model calls, zero new rows.
    let second = CoachService::run::<_, Provider, _>(&store, review_command(&thread), || {
        panic!("a completed review must not load the provider")
    })
    .await
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(second.assistant_message.id, first.assistant_message.id);
    assert_eq!(second.assistant_message.content, first.assistant_message.content);
    assert_eq!(second.user_message.id, first.user_message.id);
    assert_eq!(counts(&store), before);

    // Only the review is reused: an ordinary question still reaches the model.
    CoachService::run(&store, command(&thread, None), || Ok(provider(&store, false, &calls)))
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    // ...and does not displace the stored review.
    let third = CoachService::run::<_, Provider, _>(&store, review_command(&thread), || {
        panic!("a completed review must not load the provider")
    })
    .await
    .unwrap();
    assert_eq!(third.assistant_message.id, first.assistant_message.id);
}

#[tokio::test]
async fn failed_automatic_review_is_not_reused_and_can_be_retried() {
    let (_dir, store, thread) = fixture();
    let calls = Arc::new(AtomicUsize::new(0));
    CoachService::run(&store, review_command(&thread), || Ok(provider(&store, true, &calls)))
        .await
        .unwrap_err();
    assert!(find_completed_review(&store.0.lock().unwrap(), &thread.id).unwrap().is_none());
    let retried = CoachService::run(&store, review_command(&thread), || Ok(provider(&store, false, &calls)))
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(retried.assistant_message.status, "completed");
}
