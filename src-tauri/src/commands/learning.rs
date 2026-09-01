#[cfg(feature = "learning-observation-v1")]
use ielts_application::CognitiveReadService;
#[cfg(all(feature = "developer-tools", feature = "learning-observation-v1"))]
use ielts_application::LearningObservationService;
use ielts_domain::{
    AttemptComparison, AttemptEvidenceView, CommandResponse, CompareAttemptsQuery, ErrorEnvelope,
    LearningEventEvidenceBatch, LearningEventSearchResult, ObservationBatch, ObservationSnapshot,
    ObservationSnapshotQuery, QuestionHistory, QuestionHistoryQuery, SearchLearningEventsQuery,
};
use tauri::State;

#[cfg(feature = "learning-observation-v1")]
use crate::app::application_store::ApplicationStore;
use crate::app::state::AppDb;

#[tauri::command]
pub fn learning_get_attempt_detail(
    db: State<'_, AppDb>,
    attempt_id: String,
) -> CommandResponse<AttemptEvidenceView> {
    respond(db.with_conn(|conn| ielts_db::get_attempt_evidence(conn, &attempt_id)))
}

#[tauri::command]
pub fn learning_compare_attempts(
    db: State<'_, AppDb>,
    query: CompareAttemptsQuery,
) -> CommandResponse<AttemptComparison> {
    respond(db.with_conn(|conn| ielts_db::compare_attempts_for_asset(conn, &query)))
}

#[tauri::command]
pub fn learning_get_question_history(
    db: State<'_, AppDb>,
    query: QuestionHistoryQuery,
) -> CommandResponse<QuestionHistory> {
    respond(db.with_conn(|conn| ielts_db::get_question_history(conn, &query)))
}

#[tauri::command]
pub fn learning_search_events(
    db: State<'_, AppDb>,
    query: SearchLearningEventsQuery,
) -> CommandResponse<LearningEventSearchResult> {
    respond(db.with_conn(|conn| ielts_db::search_learning_events(conn, &query)))
}

#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn learning_observations_snapshot(
    db: State<'_, AppDb>,
    query: ObservationSnapshotQuery,
) -> CommandResponse<ObservationSnapshot> {
    let store = ApplicationStore::new(db.inner());
    respond_application(CognitiveReadService::new(&store).snapshot(&query))
}

#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn learning_observations_get_by_ids(
    db: State<'_, AppDb>,
    ids: Vec<String>,
) -> CommandResponse<ObservationBatch> {
    let store = ApplicationStore::new(db.inner());
    respond_application(CognitiveReadService::new(&store).observations_by_ids(&ids))
}

#[tauri::command]
#[cfg(feature = "learning-observation-v1")]
pub fn learning_events_get_evidence_by_ids(
    db: State<'_, AppDb>,
    ids: Vec<String>,
) -> CommandResponse<LearningEventEvidenceBatch> {
    let store = ApplicationStore::new(db.inner());
    respond_application(CognitiveReadService::new(&store).learning_events_by_ids(&ids))
}

#[tauri::command]
#[cfg(feature = "developer-tools")]
pub fn learning_events_rebuild(
    db: State<'_, AppDb>,
    limit: Option<u32>,
) -> CommandResponse<ielts_db::LearningEventsRebuildReport> {
    respond(db.with_conn(|conn| ielts_db::learning_events_rebuild(conn, limit.unwrap_or(1000))))
}

#[tauri::command]
#[cfg(feature = "developer-tools")]
pub fn learning_events_verify(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_db::LearningEventsVerifyReport> {
    respond(db.with_conn(ielts_db::learning_events_verify))
}

#[tauri::command]
#[cfg(all(feature = "developer-tools", feature = "learning-observation-v1"))]
pub fn learning_observations_rebuild(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_db::LearningObservationsRebuildReport> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearningObservationService::new(&store).rebuild())
}

#[tauri::command]
#[cfg(all(feature = "developer-tools", feature = "learning-observation-v1"))]
pub fn learning_observations_verify(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_db::LearningObservationsVerifyReport> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearningObservationService::new(&store).verify())
}

fn respond<T>(result: ielts_db::DbResult<T>) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            "learning.evidence_failed",
            error.to_string(),
            false,
        )),
    }
}

#[cfg(feature = "learning-observation-v1")]
fn respond_application<T>(
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
