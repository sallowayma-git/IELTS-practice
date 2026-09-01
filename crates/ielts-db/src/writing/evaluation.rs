//! Persisted writing evaluation state machine (Phase 5).
//!
//! Stages: Preparing → Scoring → Reviewing → Finalizing
//! Checkpoints after each stage. Cancel aborts executor only; inputs remain.
//! Retries create lineage via `retry_of` without losing prior evaluation rows.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::domain::{AttemptStatus, EvaluationStage, EvaluationStatus, WritingTaskType};
use ielts_domain::dto::{
    EvaluationDegradation, WritingEvaluationV4, WritingFeedbackV4, WritingScoreV4,
};
use ielts_domain::ErrorEnvelope;

use crate::attempts::writing_task_type_str;
use crate::history::prune_terminal_attempts_in_transaction;
use crate::learning_events::{append_learning_event_if_enabled, NewLearningEvent};
use crate::sqlite::{DbError, DbResult};
use crate::writing::draft::get_writing_draft;
use crate::writing::eval_resolve::{
    resolve_writing_eval_policy, ResolvedWritingEvalPolicy, DEFAULT_SYSTEM_PROMPT,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationEvent {
    pub evaluation_id: String,
    pub sequence: u32,
    pub revision: u32,
    pub event_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<EvaluationStage>,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationSession {
    pub id: String,
    pub attempt_id: String,
    pub evaluation_id: String,
    pub status: EvaluationStatus,
    pub stage: EvaluationStage,
    pub revision: u32,
    pub sequence: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
    pub cancel_requested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartEvaluationCommand {
    pub attempt_id: String,
    pub idempotency_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationRunResult {
    pub session: EvaluationSession,
    pub evaluation: WritingEvaluationV4,
    pub events: Vec<EvaluationEvent>,
}

/// Durable handle returned before provider I/O begins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationHandle {
    pub attempt_id: String,
    pub session_id: String,
    pub evaluation_id: String,
    pub status: EvaluationStatus,
    pub stage: EvaluationStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
    pub sequence: u32,
}

#[derive(Debug, Clone)]
pub struct PreparedEvaluation {
    pub evaluation_id: String,
    pub session_id: String,
    pub essay: String,
    pub prompt: Option<String>,
    pub task_type: Option<WritingTaskType>,
    /// Active system prompt body (Settings prompt bank or default schema instruction).
    pub system_prompt: String,
    /// Sampling temperature resolved from model settings for this task.
    pub temperature: f32,
    pub prompt_id: Option<String>,
    pub prompt_version: String,
    pub handle: EvaluationHandle,
    pub existing: Option<EvaluationRunResult>,
}

/// Provider abstraction: production plugs real HTTP/AI; tests use Fake/Deterministic.
pub trait WritingProvider: Send + Sync {
    fn id(&self) -> &str;
    fn model(&self) -> &str;
    fn score(
        &self,
        essay: &str,
        prompt: Option<&str>,
        task_type: Option<WritingTaskType>,
    ) -> Result<WritingScoreV4, ProviderError>;
    fn review(
        &self,
        essay: &str,
        score: &WritingScoreV4,
    ) -> Result<WritingFeedbackV4, ProviderError>;
}

#[derive(Debug, Clone)]
pub struct ProviderError {
    pub message: String,
    pub retryable: bool,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Deterministic offline provider for tests and degraded local runs.
#[derive(Debug, Default)]
pub struct DeterministicProvider;

impl WritingProvider for DeterministicProvider {
    fn id(&self) -> &str {
        "deterministic"
    }
    fn model(&self) -> &str {
        "local-v1"
    }
    fn score(
        &self,
        essay: &str,
        _prompt: Option<&str>,
        _task_type: Option<WritingTaskType>,
    ) -> Result<WritingScoreV4, ProviderError> {
        let words = essay.split_whitespace().count().max(1) as f64;
        // Stable pseudo-band from word count (5.0–8.0)
        let overall = ((words / 50.0).clamp(0.0, 1.0) * 3.0 + 5.0).min(8.0);
        let overall = (overall * 2.0).round() / 2.0;
        Ok(WritingScoreV4 {
            overall,
            task_response: overall,
            coherence: (overall - 0.5).max(5.0),
            lexical: overall,
            grammar: (overall - 0.5).max(5.0),
        })
    }
    fn review(
        &self,
        essay: &str,
        score: &WritingScoreV4,
    ) -> Result<WritingFeedbackV4, ProviderError> {
        let first = essay.lines().next().unwrap_or("").trim();
        Ok(WritingFeedbackV4 {
            overall: Some(format!(
                "Deterministic review: overall band {:.1}. Focus on development and precision.",
                score.overall
            )),
            plan: vec![
                "Strengthen topic sentences".into(),
                "Add one concrete example per body paragraph".into(),
            ],
            paragraphs: vec![],
            sentences: if first.is_empty() {
                vec![]
            } else {
                vec![ielts_domain::dto::SentenceFeedback {
                    sentence: first.to_string(),
                    correction: None,
                    kind: Some("observation".into()),
                }]
            },
            rewrites: vec![],
        })
    }
}

/// Orchestrator with priority, failure counts, cooldown (minimal Phase 5).
#[derive(Debug, Default)]
pub struct ProviderOrchestrator {
    pub failure_count: u32,
    pub cooldown_until: Option<i64>,
}

impl ProviderOrchestrator {
    pub fn select<'a>(
        &self,
        providers: &'a [&'a dyn WritingProvider],
    ) -> Option<&'a dyn WritingProvider> {
        if let Some(until) = self.cooldown_until {
            if chrono::Utc::now().timestamp() < until {
                return None;
            }
        }
        providers.first().copied()
    }

    pub fn record_failure(&mut self) {
        self.failure_count = self.failure_count.saturating_add(1);
        if self.failure_count >= 3 {
            self.cooldown_until = Some(chrono::Utc::now().timestamp() + 30);
        }
    }

    pub fn record_success(&mut self) {
        self.failure_count = 0;
        self.cooldown_until = None;
    }
}

pub fn start_evaluation(
    conn: &Connection,
    cmd: &StartEvaluationCommand,
    provider: &dyn WritingProvider,
) -> DbResult<EvaluationRunResult> {
    let prepared = prepare_evaluation(conn, cmd, provider.id(), provider.model())?;
    if let Some(existing) = prepared.existing {
        return Ok(existing);
    }
    let score = provider.score(
        &prepared.essay,
        prepared.prompt.as_deref(),
        prepared.task_type,
    );
    let (feedback, review_error) = match score.as_ref() {
        Ok(score) => match provider.review(&prepared.essay, score) {
            Ok(feedback) => (Some(feedback), None),
            Err(error) => (None, Some(error)),
        },
        Err(_) => (None, None),
    };
    finish_evaluation(conn, &prepared, score, feedback, review_error)
}

/// Creates the persisted session and returns an owned provider request.
/// The caller must release its database lock before performing network I/O.
pub fn prepare_evaluation(
    conn: &Connection,
    cmd: &StartEvaluationCommand,
    provider_id: &str,
    model: &str,
) -> DbResult<PreparedEvaluation> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }

    // Idempotent start
    let existing_eval: Result<Option<String>, rusqlite::Error> = conn.query_row(
        "SELECT evaluation_id FROM attempt_idempotency
         WHERE scope = 'writing.evaluate' AND idempotency_key = ?1",
        params![cmd.idempotency_key],
        |r| r.get(0),
    );
    if let Ok(Some(eval_id)) = existing_eval {
        if let Some(session) = load_session_by_evaluation(conn, &eval_id)? {
            let evaluation = load_evaluation_result(conn, &eval_id)?.unwrap_or_else(|| {
                empty_eval(
                    eval_id.clone(),
                    EvaluationStatus::Running,
                    EvaluationStage::Preparing,
                )
            });
            let events = list_events(conn, &eval_id, 0)?;
            return Ok(PreparedEvaluation {
                evaluation_id: eval_id,
                session_id: session.id.clone(),
                essay: String::new(),
                prompt: None,
                task_type: None,
                system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
                temperature: 0.2,
                prompt_id: None,
                prompt_version: "prompt-v1".into(),
                handle: handle_from_session(&session),
                existing: Some(EvaluationRunResult {
                    session,
                    evaluation,
                    events,
                }),
            });
        }
    }

    let draft = get_writing_draft(conn, &cmd.attempt_id)?
        .ok_or_else(|| DbError::Validation("draft required before evaluation".into()))?;
    if draft.content_text.trim().is_empty() {
        return Err(DbError::Validation("empty essay".into()));
    }

    let requested_task_type = parse_task(cmd.task_type.as_deref())?;
    let task_type = reconcile_attempt_task_type(draft.task_type, requested_task_type)?;
    let policy: ResolvedWritingEvalPolicy = resolve_writing_eval_policy(conn, task_type)?;
    let now = chrono::Utc::now().to_rfc3339();
    let evaluation_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    let revision = 1u32;
    let mut initial_evaluation = empty_eval(
        evaluation_id.clone(),
        EvaluationStatus::Queued,
        EvaluationStage::Preparing,
    );
    initial_evaluation.task_type = task_type;
    let initial_result_json = serde_json::to_string(&initial_evaluation)
        .map_err(|error| DbError::Message(error.to_string()))?;

    // Create evaluation row first, then session — transactionally related.
    let tx = conn.unchecked_transaction()?;

    persist_attempt_task_type(&tx, &cmd.attempt_id, task_type)?;

    tx.execute(
        "INSERT INTO writing_evaluations (
            id, attempt_id, status, stage, provider_id, model, rubric_version, prompt_version,
            result_json, degradation_json, error_json, started_at, completed_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, NULL, ?10)",
        params![
            evaluation_id,
            cmd.attempt_id,
            status_str(EvaluationStatus::Queued),
            stage_str(EvaluationStage::Preparing),
            provider_id,
            model,
            "rubric-v1",
            policy.prompt_version.as_str(),
            initial_result_json,
            now,
        ],
    )?;

    if let Some(retry_of) = &cmd.retry_of {
        let root = resolve_root_evaluation(&tx, retry_of)?.unwrap_or_else(|| retry_of.clone());
        tx.execute(
            "INSERT INTO evaluation_lineage (evaluation_id, attempt_id, retry_of, root_evaluation_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![evaluation_id, cmd.attempt_id, retry_of, root, now],
        )?;
    }

    tx.execute(
        "INSERT INTO evaluation_sessions (
            id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
            cancel_requested, provider_id, model, started_at, updated_at, completed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 0, ?8, ?9, ?10, ?10, NULL)",
        params![
            session_id,
            cmd.attempt_id,
            evaluation_id,
            status_str(EvaluationStatus::Queued),
            stage_str(EvaluationStage::Preparing),
            revision as i64,
            cmd.retry_of,
            provider_id,
            model,
            now,
        ],
    )?;

    tx.execute(
        "UPDATE evaluation_sessions SET sequence = 1 WHERE id = ?1",
        params![session_id],
    )?;
    tx.execute(
        "INSERT INTO evaluation_events (
            evaluation_id, sequence, revision, event_type, stage, payload_json, created_at
         ) VALUES (?1, 1, ?2, 'stage', ?3, ?4, ?5)",
        params![
            evaluation_id,
            revision as i64,
            stage_str(EvaluationStage::Preparing),
            json!({ "stage": "preparing", "status": "queued" }).to_string(),
            now,
        ],
    )?;

    // A retry reopens the same attempt. Derive its visible state from the
    // newest evaluation row so an older result can never leak through while
    // the retry is queued.
    sync_attempt_from_latest_evaluation(&tx, &cmd.attempt_id, &now)?;

    tx.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('writing.evaluate', ?1, ?2, ?3, ?4, ?5)",
        params![
            cmd.idempotency_key,
            cmd.attempt_id,
            evaluation_id,
            json!({ "evaluationId": evaluation_id, "sessionId": session_id }).to_string(),
            now
        ],
    )?;

    tx.commit()?;

    Ok(PreparedEvaluation {
        evaluation_id: evaluation_id.clone(),
        session_id: session_id.clone(),
        essay: draft.content_text,
        prompt: draft.prompt_snapshot,
        task_type,
        system_prompt: policy.system_prompt,
        temperature: policy.temperature,
        prompt_id: policy.prompt_id,
        prompt_version: policy.prompt_version,
        handle: EvaluationHandle {
            attempt_id: cmd.attempt_id.clone(),
            session_id: session_id.clone(),
            evaluation_id: evaluation_id.clone(),
            status: EvaluationStatus::Queued,
            stage: EvaluationStage::Preparing,
            retry_of: cmd.retry_of.clone(),
            sequence: 1,
        },
        existing: None,
    })
}

pub fn finish_evaluation(
    conn: &Connection,
    prepared: &PreparedEvaluation,
    score: Result<WritingScoreV4, ProviderError>,
    feedback: Option<WritingFeedbackV4>,
    review_error: Option<ProviderError>,
) -> DbResult<EvaluationRunResult> {
    if let Some(session) = load_session(conn, &prepared.session_id)? {
        if session.cancel_requested && session.completed_at.is_some() {
            let evaluation =
                load_evaluation_result(conn, &prepared.evaluation_id)?.unwrap_or_else(|| {
                    empty_eval(
                        prepared.evaluation_id.clone(),
                        EvaluationStatus::Interrupted,
                        EvaluationStage::Preparing,
                    )
                });
            let events = list_events(conn, &prepared.evaluation_id, 0)?;
            return Ok(EvaluationRunResult {
                session,
                evaluation,
                events,
            });
        }
    }
    let provider = PreparedProvider {
        score,
        feedback,
        review_error,
    };
    run_state_machine(
        conn,
        &prepared.evaluation_id,
        &prepared.session_id,
        &provider,
        &prepared.essay,
        prepared.prompt.as_deref(),
        prepared.task_type,
    )
}

struct PreparedProvider {
    score: Result<WritingScoreV4, ProviderError>,
    feedback: Option<WritingFeedbackV4>,
    review_error: Option<ProviderError>,
}

impl WritingProvider for PreparedProvider {
    fn id(&self) -> &str {
        "prepared"
    }
    fn model(&self) -> &str {
        "prepared"
    }
    fn score(
        &self,
        _essay: &str,
        _prompt: Option<&str>,
        _task_type: Option<WritingTaskType>,
    ) -> Result<WritingScoreV4, ProviderError> {
        self.score.clone()
    }
    fn review(
        &self,
        _essay: &str,
        _score: &WritingScoreV4,
    ) -> Result<WritingFeedbackV4, ProviderError> {
        if let Some(error) = &self.review_error {
            return Err(error.clone());
        }
        self.feedback.clone().ok_or_else(|| ProviderError {
            message: "provider returned no feedback".into(),
            retryable: false,
        })
    }
}

fn run_state_machine(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    provider: &dyn WritingProvider,
    essay: &str,
    prompt: Option<&str>,
    task_type: Option<WritingTaskType>,
) -> DbResult<EvaluationRunResult> {
    let mut events = Vec::new();
    let mut revision = 1u32;

    // Preparing
    if is_cancel_requested(conn, session_id)? {
        return finalize_cancelled(conn, evaluation_id, session_id, events);
    }
    let mut evaluation = empty_eval(
        evaluation_id.to_string(),
        EvaluationStatus::Running,
        EvaluationStage::Preparing,
    );
    evaluation.task_type = task_type;
    persist_stage(
        conn,
        evaluation_id,
        session_id,
        EvaluationStatus::Running,
        EvaluationStage::Preparing,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "stage",
        Some(EvaluationStage::Preparing),
        json!({ "message": "preparing" }),
    )?);
    save_checkpoint(
        conn,
        evaluation_id,
        EvaluationStage::Preparing,
        revision,
        &evaluation,
    )?;

    // Scoring
    if is_cancel_requested(conn, session_id)? {
        return finalize_cancelled(conn, evaluation_id, session_id, events);
    }
    evaluation.stage = EvaluationStage::Scoring;
    persist_stage(
        conn,
        evaluation_id,
        session_id,
        EvaluationStatus::Running,
        EvaluationStage::Scoring,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "stage",
        Some(EvaluationStage::Scoring),
        json!({ "message": "scoring" }),
    )?);

    let score = match provider.score(essay, prompt, task_type) {
        Ok(s) => s,
        Err(err) => {
            return finalize_failed(conn, evaluation_id, session_id, evaluation, events, err);
        }
    };
    evaluation.score = Some(score.clone());
    revision += 1;
    persist_stage(
        conn,
        evaluation_id,
        session_id,
        EvaluationStatus::Running,
        EvaluationStage::Scoring,
        revision,
        &evaluation,
    )?;
    save_checkpoint(
        conn,
        evaluation_id,
        EvaluationStage::Scoring,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "score",
        Some(EvaluationStage::Scoring),
        serde_json::to_value(&score).unwrap_or(Value::Null),
    )?);

    // Reviewing
    if is_cancel_requested(conn, session_id)? {
        // Keep score checkpoint; mark interrupted/cancelled without deleting inputs
        return finalize_cancelled_with_partial(
            conn,
            evaluation_id,
            session_id,
            evaluation,
            events,
        );
    }
    evaluation.stage = EvaluationStage::Reviewing;
    persist_stage(
        conn,
        evaluation_id,
        session_id,
        EvaluationStatus::Running,
        EvaluationStage::Reviewing,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "stage",
        Some(EvaluationStage::Reviewing),
        json!({ "message": "reviewing" }),
    )?);

    match provider.review(essay, &score) {
        Ok(feedback) => {
            evaluation.feedback = Some(feedback);
        }
        Err(err) => {
            // Degrade: keep score, mark degraded
            evaluation.status = EvaluationStatus::Degraded;
            evaluation.degradation = Some(EvaluationDegradation {
                stage: EvaluationStage::Reviewing,
                reason: err.message.clone(),
                missing: vec!["feedback".into(), "sentences".into()],
            });
            revision += 1;
            save_checkpoint(
                conn,
                evaluation_id,
                EvaluationStage::Reviewing,
                revision,
                &evaluation,
            )?;
            events.push(append_event(
                conn,
                evaluation_id,
                revision,
                "degraded",
                Some(EvaluationStage::Reviewing),
                json!({ "reason": err.message }),
            )?);
            return finalize_completed(conn, evaluation_id, session_id, evaluation, events, true);
        }
    }
    revision += 1;
    save_checkpoint(
        conn,
        evaluation_id,
        EvaluationStage::Reviewing,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "review",
        Some(EvaluationStage::Reviewing),
        serde_json::to_value(evaluation.feedback.as_ref()).unwrap_or(Value::Null),
    )?);

    // Finalizing
    evaluation.stage = EvaluationStage::Finalizing;
    evaluation.status = EvaluationStatus::Completed;
    revision += 1;
    save_checkpoint(
        conn,
        evaluation_id,
        EvaluationStage::Finalizing,
        revision,
        &evaluation,
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        revision,
        "stage",
        Some(EvaluationStage::Finalizing),
        json!({ "message": "finalizing" }),
    )?);

    finalize_completed(conn, evaluation_id, session_id, evaluation, events, false)
}

fn finalize_completed(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    evaluation: WritingEvaluationV4,
    events: Vec<EvaluationEvent>,
    degraded: bool,
) -> DbResult<EvaluationRunResult> {
    let tx = conn.unchecked_transaction()?;
    let result = finalize_completed_in_transaction(
        &tx,
        evaluation_id,
        session_id,
        evaluation,
        events,
        degraded,
    )?;
    tx.commit()?;
    Ok(result)
}

fn finalize_completed_in_transaction(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    mut evaluation: WritingEvaluationV4,
    mut events: Vec<EvaluationEvent>,
    degraded: bool,
) -> DbResult<EvaluationRunResult> {
    let now = chrono::Utc::now().to_rfc3339();
    if degraded {
        evaluation.status = EvaluationStatus::Degraded;
    } else {
        evaluation.status = EvaluationStatus::Completed;
    }
    evaluation.stage = EvaluationStage::Finalizing;
    let result_json =
        serde_json::to_string(&evaluation).map_err(|e| DbError::Message(e.to_string()))?;
    let degradation_json = evaluation
        .degradation
        .as_ref()
        .map(|d| serde_json::to_string(d).unwrap_or_else(|_| "null".into()));

    conn.execute(
        "UPDATE writing_evaluations SET status = ?1, stage = ?2, result_json = ?3, degradation_json = ?4,
            completed_at = ?5, updated_at = ?5 WHERE id = ?6",
        params![
            status_str(evaluation.status),
            stage_str(EvaluationStage::Finalizing),
            result_json,
            degradation_json,
            now,
            evaluation_id
        ],
    )?;

    conn.execute(
        "UPDATE evaluation_sessions SET status = ?1, stage = ?2, completed_at = ?3, updated_at = ?3 WHERE id = ?4",
        params![
            status_str(evaluation.status),
            stage_str(EvaluationStage::Finalizing),
            now,
            session_id
        ],
    )?;

    let session = load_session(conn, session_id)?.expect("session");
    // Do not let an older provider request which happened to finish later
    // overwrite the attempt-level view of a newer retry.
    sync_attempt_from_latest_evaluation(conn, &session.attempt_id, &now)?;

    let score = evaluation
        .score
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| DbError::Message(error.to_string()))?;
    let degradation = evaluation
        .degradation
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| DbError::Message(error.to_string()))?;
    append_learning_event_if_enabled(
        conn,
        NewLearningEvent::writing_evaluation_completed(
            evaluation_id,
            &session.attempt_id,
            status_str(evaluation.status),
            stage_str(evaluation.stage),
            evaluation.task_type.map(writing_task_type_str),
            score.as_ref(),
            degradation.as_ref(),
            None,
            session.provider_id.as_deref(),
            session.model.as_deref(),
            now.clone(),
        ),
    )?;

    events.push(append_event(
        conn,
        evaluation_id,
        0,
        "completed",
        Some(EvaluationStage::Finalizing),
        json!({ "status": status_str(evaluation.status), "evaluation": &evaluation }),
    )?);
    prune_terminal_attempts_in_transaction(conn)?;

    Ok(EvaluationRunResult {
        session,
        evaluation,
        events,
    })
}

fn finalize_failed(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    evaluation: WritingEvaluationV4,
    events: Vec<EvaluationEvent>,
    err: ProviderError,
) -> DbResult<EvaluationRunResult> {
    let tx = conn.unchecked_transaction()?;
    let result =
        finalize_failed_in_transaction(&tx, evaluation_id, session_id, evaluation, events, err)?;
    tx.commit()?;
    Ok(result)
}

fn finalize_failed_in_transaction(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    mut evaluation: WritingEvaluationV4,
    mut events: Vec<EvaluationEvent>,
    err: ProviderError,
) -> DbResult<EvaluationRunResult> {
    let now = chrono::Utc::now().to_rfc3339();
    evaluation.status = EvaluationStatus::Failed;
    evaluation.error = Some(ErrorEnvelope::new(
        "provider.failed",
        err.message.clone(),
        err.retryable,
    ));
    let result_json = serde_json::to_string(&evaluation).unwrap_or_else(|_| "{}".into());
    let error_json = serde_json::to_string(evaluation.error.as_ref().unwrap()).unwrap();
    conn.execute(
        "UPDATE writing_evaluations
         SET status = ?1, stage = ?2, result_json = ?3, error_json = ?4,
             completed_at = ?5, updated_at = ?5
         WHERE id = ?6",
        params![
            status_str(EvaluationStatus::Failed),
            stage_str(evaluation.stage),
            result_json,
            error_json,
            now,
            evaluation_id,
        ],
    )?;
    conn.execute(
        "UPDATE evaluation_sessions SET status = ?1, updated_at = ?2, completed_at = ?2 WHERE id = ?3",
        params![status_str(EvaluationStatus::Failed), now, session_id],
    )?;
    let session = load_session(conn, session_id)?.expect("session");
    sync_attempt_from_latest_evaluation(conn, &session.attempt_id, &now)?;
    let error = evaluation
        .error
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| DbError::Message(error.to_string()))?;
    append_learning_event_if_enabled(
        conn,
        NewLearningEvent::writing_evaluation_completed(
            evaluation_id,
            &session.attempt_id,
            status_str(evaluation.status),
            stage_str(evaluation.stage),
            evaluation.task_type.map(writing_task_type_str),
            None,
            None,
            error.as_ref(),
            session.provider_id.as_deref(),
            session.model.as_deref(),
            now.clone(),
        ),
    )?;
    events.push(append_event(
        conn,
        evaluation_id,
        0,
        "failed",
        Some(evaluation.stage),
        json!({
            "code": "provider.failed",
            "message": err.message,
            "retryable": err.retryable,
        }),
    )?);
    prune_terminal_attempts_in_transaction(conn)?;
    Ok(EvaluationRunResult {
        session,
        evaluation,
        events,
    })
}

fn finalize_cancelled(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    events: Vec<EvaluationEvent>,
) -> DbResult<EvaluationRunResult> {
    let evaluation = empty_eval(
        evaluation_id.to_string(),
        EvaluationStatus::Interrupted,
        EvaluationStage::Preparing,
    );
    finalize_cancelled_with_partial(conn, evaluation_id, session_id, evaluation, events)
}

fn finalize_cancelled_with_partial(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    evaluation: WritingEvaluationV4,
    events: Vec<EvaluationEvent>,
) -> DbResult<EvaluationRunResult> {
    let tx = conn.unchecked_transaction()?;
    let result = finalize_cancelled_with_partial_in_transaction(
        &tx,
        evaluation_id,
        session_id,
        evaluation,
        events,
    )?;
    tx.commit()?;
    Ok(result)
}

fn finalize_cancelled_with_partial_in_transaction(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    mut evaluation: WritingEvaluationV4,
    mut events: Vec<EvaluationEvent>,
) -> DbResult<EvaluationRunResult> {
    let now = chrono::Utc::now().to_rfc3339();
    evaluation.status = EvaluationStatus::Interrupted;
    let result_json = serde_json::to_string(&evaluation).unwrap_or_else(|_| "{}".into());
    conn.execute(
        "UPDATE writing_evaluations
         SET status = ?1, stage = ?2, result_json = ?3, completed_at = ?4, updated_at = ?4
         WHERE id = ?5",
        params![
            status_str(EvaluationStatus::Interrupted),
            stage_str(evaluation.stage),
            result_json,
            now,
            evaluation_id,
        ],
    )?;
    conn.execute(
        "UPDATE evaluation_sessions
         SET status = ?1, stage = ?2, cancel_requested = 1, updated_at = ?3, completed_at = ?3
         WHERE id = ?4",
        params![
            status_str(EvaluationStatus::Interrupted),
            stage_str(evaluation.stage),
            now,
            session_id,
        ],
    )?;
    let session = load_session(conn, session_id)?.expect("session");
    sync_attempt_from_latest_evaluation(conn, &session.attempt_id, &now)?;
    // Do NOT wipe attempt content / draft
    events.push(append_event(
        conn,
        evaluation_id,
        0,
        "cancelled",
        Some(evaluation.stage),
        json!({ "keptInputs": true }),
    )?);
    prune_terminal_attempts_in_transaction(conn)?;
    Ok(EvaluationRunResult {
        session,
        evaluation,
        events,
    })
}

pub fn request_cancel(conn: &Connection, evaluation_id: &str) -> DbResult<bool> {
    let Some(session) = load_session_by_evaluation(conn, evaluation_id)? else {
        return Ok(false);
    };
    if session.completed_at.is_some() {
        return Ok(false);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut evaluation = load_evaluation_result(conn, evaluation_id)?.unwrap_or_else(|| {
        empty_eval(
            evaluation_id.to_string(),
            EvaluationStatus::Interrupted,
            session.stage,
        )
    });
    evaluation.status = EvaluationStatus::Interrupted;
    evaluation.stage = session.stage;
    let result_json =
        serde_json::to_string(&evaluation).map_err(|error| DbError::Message(error.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE evaluation_sessions
         SET status = ?1, cancel_requested = 1, completed_at = ?2, updated_at = ?2
         WHERE id = ?3",
        params![status_str(EvaluationStatus::Interrupted), now, session.id],
    )?;
    tx.execute(
        "UPDATE writing_evaluations
         SET status = ?1, stage = ?2, result_json = ?3, completed_at = ?4, updated_at = ?4
         WHERE id = ?5",
        params![
            status_str(EvaluationStatus::Interrupted),
            stage_str(session.stage),
            result_json,
            now,
            evaluation_id,
        ],
    )?;
    sync_attempt_from_latest_evaluation(&tx, &session.attempt_id, &now)?;
    append_event(
        &tx,
        evaluation_id,
        session.revision,
        "cancelled",
        Some(session.stage),
        json!({ "evaluationId": evaluation_id, "keptInputs": true }),
    )?;
    prune_terminal_attempts_in_transaction(&tx)?;
    tx.commit()?;
    Ok(true)
}

pub fn list_events(
    conn: &Connection,
    evaluation_id: &str,
    after_seq: u32,
) -> DbResult<Vec<EvaluationEvent>> {
    let mut stmt = conn.prepare(
        "SELECT evaluation_id, sequence, revision, event_type, stage, payload_json, created_at
         FROM evaluation_events
         WHERE evaluation_id = ?1 AND sequence > ?2
         ORDER BY sequence ASC",
    )?;
    let rows = stmt.query_map(params![evaluation_id, after_seq as i64], |row| {
        let stage_raw: Option<String> = row.get(4)?;
        let payload_json: String = row.get(5)?;
        Ok(EvaluationEvent {
            evaluation_id: row.get(0)?,
            sequence: row.get::<_, i64>(1)? as u32,
            revision: row.get::<_, i64>(2)? as u32,
            event_type: row.get(3)?,
            stage: stage_raw.as_deref().and_then(parse_stage),
            payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
            created_at: row.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn load_evaluation_for_attempt(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<Option<WritingEvaluationV4>> {
    match load_latest_evaluation_row(conn, attempt_id)? {
        Some(latest) => {
            let Some(json) = latest.result_json.filter(|value| !value.is_empty()) else {
                return Ok(None);
            };
            let mut v: WritingEvaluationV4 = serde_json::from_str(&json)
                .map_err(|e| DbError::Message(format!("eval parse: {e}")))?;
            v.id = latest.id;
            Ok(Some(v))
        }
        None => Ok(None),
    }
}

pub fn recover_interrupted_sessions(conn: &Connection) -> DbResult<u32> {
    // On boot, complete every durable state transition in one transaction. The
    // old implementation changed only the two status columns, leaving result
    // JSON, event replay and attempt history mutually contradictory.
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let sessions = {
        let mut stmt = tx.prepare(
            "SELECT id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
                    cancel_requested, provider_id, model, started_at, updated_at, completed_at
             FROM evaluation_sessions
             WHERE completed_at IS NULL AND status IN ('queued', 'running')
             ORDER BY started_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], map_session)?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        sessions
    };

    let mut recovered_attempts = std::collections::BTreeSet::new();
    for session in &sessions {
        let mut evaluation =
            load_recoverable_evaluation(&tx, &session.evaluation_id, session.stage)?;
        evaluation.status = EvaluationStatus::Interrupted;
        evaluation.stage = session.stage;
        let result_json = serde_json::to_string(&evaluation)
            .map_err(|error| DbError::Message(error.to_string()))?;

        tx.execute(
            "UPDATE writing_evaluations
             SET status = ?1, stage = ?2, result_json = ?3, completed_at = ?4, updated_at = ?4
             WHERE id = ?5",
            params![
                status_str(EvaluationStatus::Interrupted),
                stage_str(session.stage),
                result_json,
                now,
                session.evaluation_id,
            ],
        )?;
        tx.execute(
            "UPDATE evaluation_sessions
             SET status = ?1, completed_at = ?2, updated_at = ?2
             WHERE id = ?3",
            params![status_str(EvaluationStatus::Interrupted), now, session.id],
        )?;
        append_event(
            &tx,
            &session.evaluation_id,
            session.revision,
            "interrupted",
            Some(session.stage),
            json!({
                "reason": "process_restarted",
                "keptInputs": true,
                "evaluation": evaluation,
            }),
        )?;
        recovered_attempts.insert(session.attempt_id.clone());
    }

    for attempt_id in recovered_attempts {
        sync_attempt_from_latest_evaluation(&tx, &attempt_id, &now)?;
    }
    if !sessions.is_empty() {
        prune_terminal_attempts_in_transaction(&tx)?;
    }

    tx.commit()?;
    Ok(sessions.len() as u32)
}

fn append_event(
    conn: &Connection,
    evaluation_id: &str,
    revision: u32,
    event_type: &str,
    stage: Option<EvaluationStage>,
    payload: Value,
) -> DbResult<EvaluationEvent> {
    let now = chrono::Utc::now().to_rfc3339();
    // sequence from session
    let seq: i64 = conn.query_row(
        "SELECT sequence FROM evaluation_sessions WHERE evaluation_id = ?1",
        params![evaluation_id],
        |r| r.get(0),
    )?;
    let next = seq + 1;
    conn.execute(
        "UPDATE evaluation_sessions SET sequence = ?1, updated_at = ?2 WHERE evaluation_id = ?3",
        params![next, now, evaluation_id],
    )?;
    conn.execute(
        "UPDATE evaluation_sessions SET revision = ?1 WHERE evaluation_id = ?2 AND revision < ?1",
        params![revision as i64, evaluation_id],
    )?;

    let payload_json = payload.to_string();
    conn.execute(
        "INSERT INTO evaluation_events (evaluation_id, sequence, revision, event_type, stage, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            evaluation_id,
            next,
            revision as i64,
            event_type,
            stage.map(stage_str),
            payload_json,
            now
        ],
    )?;
    Ok(EvaluationEvent {
        evaluation_id: evaluation_id.to_string(),
        sequence: next as u32,
        revision,
        event_type: event_type.to_string(),
        stage,
        payload,
        created_at: now,
    })
}

fn save_checkpoint(
    conn: &Connection,
    evaluation_id: &str,
    stage: EvaluationStage,
    revision: u32,
    evaluation: &WritingEvaluationV4,
) -> DbResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let payload = serde_json::to_string(evaluation).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT OR REPLACE INTO evaluation_checkpoints (evaluation_id, stage, revision, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![evaluation_id, stage_str(stage), revision as i64, payload, now],
    )?;
    Ok(())
}

fn persist_stage(
    conn: &Connection,
    evaluation_id: &str,
    session_id: &str,
    status: EvaluationStatus,
    stage: EvaluationStage,
    revision: u32,
    evaluation: &WritingEvaluationV4,
) -> DbResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let result_json =
        serde_json::to_string(evaluation).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "UPDATE writing_evaluations SET status = ?1, stage = ?2, result_json = ?3, updated_at = ?4 WHERE id = ?5",
        params![status_str(status), stage_str(stage), result_json, now, evaluation_id],
    )?;
    conn.execute(
        "UPDATE evaluation_sessions SET status = ?1, stage = ?2, revision = ?3, updated_at = ?4 WHERE id = ?5",
        params![status_str(status), stage_str(stage), revision as i64, now, session_id],
    )?;
    Ok(())
}

fn is_cancel_requested(conn: &Connection, session_id: &str) -> DbResult<bool> {
    let v: i64 = conn.query_row(
        "SELECT cancel_requested FROM evaluation_sessions WHERE id = ?1",
        params![session_id],
        |r| r.get(0),
    )?;
    Ok(v != 0)
}

fn load_session(conn: &Connection, session_id: &str) -> DbResult<Option<EvaluationSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
                cancel_requested, provider_id, model, started_at, updated_at, completed_at
         FROM evaluation_sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_session(row)?))
    } else {
        Ok(None)
    }
}

fn load_session_by_evaluation(
    conn: &Connection,
    evaluation_id: &str,
) -> DbResult<Option<EvaluationSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
                cancel_requested, provider_id, model, started_at, updated_at, completed_at
         FROM evaluation_sessions WHERE evaluation_id = ?1 ORDER BY started_at DESC LIMIT 1",
    )?;
    let mut rows = stmt.query(params![evaluation_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_session(row)?))
    } else {
        Ok(None)
    }
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvaluationSession> {
    Ok(EvaluationSession {
        id: row.get(0)?,
        attempt_id: row.get(1)?,
        evaluation_id: row.get(2)?,
        status: parse_status(&row.get::<_, String>(3)?).unwrap_or(EvaluationStatus::Queued),
        stage: parse_stage(&row.get::<_, String>(4)?).unwrap_or(EvaluationStage::Preparing),
        revision: row.get::<_, i64>(5)? as u32,
        sequence: row.get::<_, i64>(6)? as u32,
        retry_of: row.get(7)?,
        cancel_requested: row.get::<_, i64>(8)? != 0,
        provider_id: row.get(9)?,
        model: row.get(10)?,
        started_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

/// A retry is newer because it was created later, not because an older provider
/// call happened to write after it. `rowid` makes the ordering deterministic
/// when tests or fast local calls share the same timestamp.
struct LatestEvaluationRow {
    id: String,
    status: EvaluationStatus,
    result_json: Option<String>,
    completed_at: Option<String>,
}

fn load_latest_evaluation_row(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<Option<LatestEvaluationRow>> {
    let result: Result<(String, String, Option<String>, Option<String>), rusqlite::Error> = conn
        .query_row(
            "SELECT id, status, result_json, completed_at
             FROM writing_evaluations
             WHERE attempt_id = ?1
             ORDER BY COALESCE(started_at, updated_at) DESC, rowid DESC, id DESC
             LIMIT 1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        );
    match result {
        Ok((id, status, result_json, completed_at)) => {
            let status = parse_status(&status).ok_or_else(|| {
                DbError::Validation(format!("unknown writing evaluation status for {id}"))
            })?;
            Ok(Some(LatestEvaluationRow {
                id,
                status,
                result_json,
                completed_at,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// Recovery must not be defeated by a missing or malformed historical JSON
/// payload. The durable row still carries the evaluation id and current stage,
/// enough to reconstruct a canonical interrupted result.
fn load_recoverable_evaluation(
    conn: &Connection,
    evaluation_id: &str,
    stage: EvaluationStage,
) -> DbResult<WritingEvaluationV4> {
    let result: Result<Option<String>, rusqlite::Error> = conn.query_row(
        "SELECT result_json FROM writing_evaluations WHERE id = ?1",
        params![evaluation_id],
        |row| row.get(0),
    );
    let result_json = match result {
        Ok(result_json) => result_json,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(DbError::Validation(format!(
                "evaluation session references missing evaluation {evaluation_id}"
            )));
        }
        Err(error) => return Err(error.into()),
    };
    let mut evaluation = result_json
        .as_deref()
        .filter(|json| !json.is_empty())
        .and_then(|json| serde_json::from_str::<WritingEvaluationV4>(json).ok())
        .unwrap_or_else(|| {
            empty_eval(
                evaluation_id.to_string(),
                EvaluationStatus::Interrupted,
                stage,
            )
        });
    evaluation.id = evaluation_id.to_string();
    Ok(evaluation)
}

/// The attempt is only a projection of its latest evaluation. Keeping that
/// projection here prevents retry, cancellation and crash recovery paths from
/// each inventing a subtly different answer.
fn sync_attempt_from_latest_evaluation(
    conn: &Connection,
    attempt_id: &str,
    now: &str,
) -> DbResult<()> {
    let Some(latest) = load_latest_evaluation_row(conn, attempt_id)? else {
        return Ok(());
    };
    let completed_at = latest
        .completed_at
        .clone()
        .unwrap_or_else(|| now.to_string());
    let score = latest
        .result_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<WritingEvaluationV4>(json).ok())
        .and_then(|evaluation| evaluation.score)
        .map(|score| score.overall);
    let (attempt_status, score_value, score_scale, completed_at) = match latest.status {
        EvaluationStatus::Queued | EvaluationStatus::Running => {
            (AttemptStatus::Reviewing, None, None, None)
        }
        EvaluationStatus::Completed | EvaluationStatus::Degraded => (
            AttemptStatus::Completed,
            score,
            score.map(|_| "band9"),
            Some(completed_at),
        ),
        EvaluationStatus::Failed => (AttemptStatus::Failed, None, None, Some(completed_at)),
        EvaluationStatus::Interrupted => {
            (AttemptStatus::Interrupted, None, None, Some(completed_at))
        }
    };
    conn.execute(
        "UPDATE attempts
         SET status = ?1, score_value = ?2, score_scale = ?3, completed_at = ?4, updated_at = ?5
         WHERE id = ?6",
        params![
            status_attempt(attempt_status),
            score_value,
            score_scale,
            completed_at,
            now,
            attempt_id,
        ],
    )?;
    Ok(())
}

fn load_evaluation_result(
    conn: &Connection,
    evaluation_id: &str,
) -> DbResult<Option<WritingEvaluationV4>> {
    let json: Option<String> = conn.query_row(
        "SELECT result_json FROM writing_evaluations WHERE id = ?1",
        params![evaluation_id],
        |r| r.get(0),
    )?;
    match json {
        Some(j) if !j.is_empty() => {
            let mut v: WritingEvaluationV4 =
                serde_json::from_str(&j).map_err(|e| DbError::Message(e.to_string()))?;
            v.id = evaluation_id.to_string();
            Ok(Some(v))
        }
        _ => Ok(None),
    }
}

fn resolve_root_evaluation(conn: &Connection, retry_of: &str) -> DbResult<Option<String>> {
    let result: Result<Option<String>, _> = conn.query_row(
        "SELECT root_evaluation_id FROM evaluation_lineage WHERE evaluation_id = ?1",
        params![retry_of],
        |r| r.get(0),
    );
    match result {
        Ok(v) => Ok(v.or_else(|| Some(retry_of.to_string()))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Some(retry_of.to_string())),
        Err(e) => Err(e.into()),
    }
}

fn empty_eval(id: String, status: EvaluationStatus, stage: EvaluationStage) -> WritingEvaluationV4 {
    WritingEvaluationV4 {
        schema_version: WritingEvaluationV4::SCHEMA_VERSION,
        id,
        status,
        stage,
        task_type: None,
        score: None,
        diagnosis: None,
        feedback: None,
        degradation: None,
        error: None,
    }
}

fn handle_from_session(session: &EvaluationSession) -> EvaluationHandle {
    EvaluationHandle {
        attempt_id: session.attempt_id.clone(),
        session_id: session.id.clone(),
        evaluation_id: session.evaluation_id.clone(),
        status: session.status,
        stage: session.stage,
        retry_of: session.retry_of.clone(),
        sequence: session.sequence,
    }
}

fn status_str(s: EvaluationStatus) -> &'static str {
    match s {
        EvaluationStatus::Queued => "queued",
        EvaluationStatus::Running => "running",
        EvaluationStatus::Completed => "completed",
        EvaluationStatus::Degraded => "degraded",
        EvaluationStatus::Failed => "failed",
        EvaluationStatus::Interrupted => "interrupted",
    }
}

fn stage_str(s: EvaluationStage) -> &'static str {
    match s {
        EvaluationStage::Preparing => "preparing",
        EvaluationStage::Scoring => "scoring",
        EvaluationStage::Reviewing => "reviewing",
        EvaluationStage::Finalizing => "finalizing",
    }
}

fn status_attempt(s: AttemptStatus) -> &'static str {
    match s {
        AttemptStatus::Draft => "draft",
        AttemptStatus::Active => "active",
        AttemptStatus::Submitted => "submitted",
        AttemptStatus::Reviewing => "reviewing",
        AttemptStatus::Completed => "completed",
        AttemptStatus::Cancelled => "cancelled",
        AttemptStatus::Failed => "failed",
        AttemptStatus::Interrupted => "interrupted",
    }
}

fn parse_status(raw: &str) -> Option<EvaluationStatus> {
    Some(match raw {
        "queued" => EvaluationStatus::Queued,
        "running" => EvaluationStatus::Running,
        "completed" => EvaluationStatus::Completed,
        "degraded" => EvaluationStatus::Degraded,
        "failed" => EvaluationStatus::Failed,
        "interrupted" => EvaluationStatus::Interrupted,
        _ => return None,
    })
}

fn parse_stage(raw: &str) -> Option<EvaluationStage> {
    Some(match raw {
        "preparing" => EvaluationStage::Preparing,
        "scoring" => EvaluationStage::Scoring,
        "reviewing" => EvaluationStage::Reviewing,
        "finalizing" => EvaluationStage::Finalizing,
        _ => return None,
    })
}

fn parse_task(raw: Option<&str>) -> DbResult<Option<WritingTaskType>> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    WritingTaskType::parse_loose(raw)
        .map(Some)
        .ok_or_else(|| DbError::Validation("task_type must be task1 or task2".into()))
}

fn reconcile_attempt_task_type(
    persisted: Option<WritingTaskType>,
    requested: Option<WritingTaskType>,
) -> DbResult<Option<WritingTaskType>> {
    match (persisted, requested) {
        (Some(persisted), Some(requested)) if persisted != requested => Err(DbError::Validation(
            "evaluation task_type conflicts with the persisted writing attempt".into(),
        )),
        (Some(persisted), _) => Ok(Some(persisted)),
        (None, requested) => Ok(requested),
    }
}

fn persist_attempt_task_type(
    conn: &Connection,
    attempt_id: &str,
    task_type: Option<WritingTaskType>,
) -> DbResult<()> {
    let Some(task_type) = task_type else {
        return Ok(());
    };
    let task_type = writing_task_type_str(task_type);
    let updated = conn.execute(
        "UPDATE attempts
         SET task_type = ?1, updated_at = ?2
         WHERE id = ?3
           AND activity = 'writing'
           AND (task_type IS NULL OR task_type = ?1)",
        params![task_type, chrono::Utc::now().to_rfc3339(), attempt_id],
    )?;
    if updated == 1 {
        return Ok(());
    }
    Err(DbError::Validation(
        "writing attempt is missing or its persisted task_type conflicts with evaluation".into(),
    ))
}
