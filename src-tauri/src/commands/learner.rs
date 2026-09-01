#[cfg(all(feature = "developer-tools", feature = "learner-model-v1"))]
use ielts_application::LearnerModelAdminService;
#[cfg(feature = "learner-model-v1")]
use ielts_application::LearnerModelService;
#[cfg(feature = "learner-model-v1")]
use ielts_domain::{
    CommandResponse, ErrorEnvelope, LearnerStateQuery, LearnerStateSnapshot, SkillReviewNeedsQuery,
    SkillReviewNeedsSnapshot,
};
#[cfg(feature = "learner-model-v1")]
use tauri::State;

#[cfg(feature = "learner-model-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "learner-model-v1")]
use crate::app::state::AppDb;

#[tauri::command]
#[cfg(feature = "learner-model-v1")]
pub fn learner_model_get_state(
    db: State<'_, AppDb>,
    query: LearnerStateQuery,
) -> CommandResponse<LearnerStateSnapshot> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearnerModelService::new(&store).state_snapshot(&query))
}

#[tauri::command]
#[cfg(feature = "learner-model-v1")]
pub fn learner_model_get_review_needs(
    db: State<'_, AppDb>,
    query: SkillReviewNeedsQuery,
) -> CommandResponse<SkillReviewNeedsSnapshot> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearnerModelService::new(&store).review_needs(&query))
}

#[tauri::command]
#[cfg(all(feature = "developer-tools", feature = "learner-model-v1"))]
pub fn learner_model_rebuild(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_domain::LearnerRebuildReport> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearnerModelAdminService::new(&store).rebuild())
}

#[tauri::command]
#[cfg(all(feature = "developer-tools", feature = "learner-model-v1"))]
pub fn learner_model_verify(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_domain::LearnerVerifyReport> {
    let store = ApplicationStore::new(db.inner());
    respond_application(LearnerModelAdminService::new(&store).verify())
}

#[cfg(feature = "learner-model-v1")]
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
