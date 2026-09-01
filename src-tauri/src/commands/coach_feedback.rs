#[cfg(feature = "learning-observation-v1")]
use ielts_application::CoachFeedbackService;
#[cfg(feature = "learning-observation-v1")]
use ielts_domain::{
    CommandResponse, ErrorEnvelope, LinkCoachOutcomeCommand, RecordCoachFeedbackCommand,
    RecordCoachStrategyAssignmentCommand, RecordReaskLinkCommand,
};
#[cfg(feature = "learning-observation-v1")]
use tauri::State;

#[cfg(feature = "learning-observation-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "learning-observation-v1")]
use crate::app::state::AppDb;

/// M6-05: record canonical coach feedback (user interaction fact). Idempotent
/// on (coach_message_id, feedback_kind).
#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn coach_record_feedback(
    db: State<'_, AppDb>,
    command: RecordCoachFeedbackCommand,
) -> CommandResponse<ielts_domain::CoachFeedbackRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(CoachFeedbackService::new(&store).record_feedback(&command))
}

/// M6-06: record a re-ask linkage between a prior assistant message and a new
/// user message. Asking a new question never creates a row here.
#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn coach_record_reask_link(
    db: State<'_, AppDb>,
    command: RecordReaskLinkCommand,
) -> CommandResponse<ielts_domain::CoachReaskLinkRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(CoachFeedbackService::new(&store).record_reask_link(&command))
}

/// M6-04: record the teaching-strategy provenance for a coach response. The
/// body text remains natural language; this metadata records what teaching form
/// was used and which context/memory fed the response.
#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn coach_record_strategy_assignment(
    db: State<'_, AppDb>,
    command: RecordCoachStrategyAssignmentCommand,
) -> CommandResponse<ielts_domain::CoachStrategyAssignmentRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(CoachFeedbackService::new(&store).record_strategy_assignment(&command))
}

/// M6-10: link a strategy assignment to a future observation. Satisfaction and
/// learning outcomes are recorded on separate rows; a thumbs-up is never
/// treated as a learning outcome.
#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn coach_link_outcome(
    db: State<'_, AppDb>,
    command: LinkCoachOutcomeCommand,
) -> CommandResponse<ielts_domain::CoachOutcomeLinkRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(CoachFeedbackService::new(&store).link_outcome(&command))
}

#[cfg(feature = "learning-observation-v1")]
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
