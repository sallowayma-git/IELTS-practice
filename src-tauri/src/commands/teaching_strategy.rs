//! M10 Teaching Strategy Evolution Tauri commands.
//!
//! Feature-gated on `daily-dream-v1` (the evolution layer sits above the
//! context/journal/dream surface). These commands wrap the
//! `TeachingStrategyService` use cases for the IPC boundary.

#[cfg(feature = "daily-dream-v1")]
use ielts_application::TeachingStrategyService;
#[cfg(feature = "daily-dream-v1")]
use ielts_domain::{
    CommandResponse, ErrorEnvelope, PromoteStrategyCandidateCommand,
    RecordStrategyAssignmentCommand, RecordStrategyCandidateBatchCommand,
    RecordStrategyCandidateEvaluationCommand,
    RecordStrategyFeedbackCommand, RecordStrategyOutcomeCommand, SelectStrategyCommand,
    TeachingStrategyId,
};
#[cfg(feature = "daily-dream-v1")]
use tauri::State;

#[cfg(feature = "daily-dream-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "daily-dream-v1")]
use crate::app::state::AppDb;

/// M10-06: select a strategy for the next response (rule-priority).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_select(
    db: State<'_, AppDb>,
    command: SelectStrategyCommand,
) -> CommandResponse<ielts_domain::StrategySelection> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).select_strategy(&command))
}

/// M10-02: record the teaching-strategy assignment for a response message.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_record_assignment(
    db: State<'_, AppDb>,
    command: RecordStrategyAssignmentCommand,
) -> CommandResponse<ielts_domain::StrategyAssignmentRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).record_assignment(&command))
}

/// M10-03: record a SATISFACTION feedback fact (satisfaction channel only).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_record_feedback(
    db: State<'_, AppDb>,
    command: RecordStrategyFeedbackCommand,
) -> CommandResponse<ielts_domain::StrategyFeedbackRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).record_feedback(&command))
}

/// M10-03/04: record a LEARNING outcome (learning channel only; window-checked).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_record_outcome(
    db: State<'_, AppDb>,
    command: RecordStrategyOutcomeCommand,
) -> CommandResponse<ielts_domain::OutcomeAttribution> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).record_outcome(&command))
}

/// M10-05: load the per-user strategy state for a (user, strategy, scope).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_user_state(
    db: State<'_, AppDb>,
    user_id: String,
    strategy_id: TeachingStrategyId,
    scope: String,
) -> CommandResponse<Option<ielts_domain::UserStrategyState>> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).user_state(&user_id, strategy_id, &scope))
}

/// M10-08: record an LLM-proposed candidate strategy batch as pending.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_record_candidate_batch(
    db: State<'_, AppDb>,
    command: RecordStrategyCandidateBatchCommand,
) -> CommandResponse<ielts_domain::StrategyCandidateBatchRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).record_candidate_batch(&command))
}

/// M10-08: run the Rust-owned offline evaluator for a candidate batch. The IPC
/// caller supplies only the batch id; verdict and metrics are derived in Rust.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_record_candidate_evaluation(
    db: State<'_, AppDb>,
    command: RecordStrategyCandidateEvaluationCommand,
) -> CommandResponse<ielts_domain::StrategyCandidateEvaluationRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).record_candidate_evaluation(&command))
}

/// M10-08: promote or reject a candidate batch (offline-eval gate).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn teaching_strategy_promote_candidate(
    db: State<'_, AppDb>,
    command: PromoteStrategyCandidateCommand,
) -> CommandResponse<ielts_domain::StrategyCandidateDecision> {
    let store = ApplicationStore::new(db.inner());
    respond(TeachingStrategyService::new(&store).promote_candidate(&command))
}

#[cfg(feature = "daily-dream-v1")]
fn respond<T>(
    result: Result<T, ielts_application::ApplicationError>,
) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            error.code,
            error.message,
            error.retryable,
        )),
    }
}
