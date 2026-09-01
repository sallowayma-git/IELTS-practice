//! M11 Prompt/Skill Evolution Tauri commands.
//!
//! Feature-gated on `daily-dream-v1` (the evolution layer sits above the
//! context/journal/dream surface). These commands wrap the
//! `PromptSkillService` use cases for the IPC boundary. Rust is the release
//! gate; the LLM may only propose candidates.

#[cfg(feature = "daily-dream-v1")]
use ielts_application::PromptSkillService;
#[cfg(feature = "daily-dream-v1")]
use ielts_domain::{
    ApproveCandidateCommand, CommandResponse, ErrorEnvelope, PromoteCandidateCommand,
    ProposeCandidateCommand, PromptModule, RollbackCommand, RunEvalCommand, SkillName,
};
#[cfg(feature = "daily-dream-v1")]
use tauri::State;

#[cfg(feature = "daily-dream-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "daily-dream-v1")]
use crate::app::state::AppDb;

/// M11-05: list prompt versions for a module, ordered by version desc.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_list_versions(
    db: State<'_, AppDb>,
    module: PromptModule,
) -> CommandResponse<Vec<ielts_domain::PromptVersion>> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).list_prompt_versions(module))
}

/// M11-05: get the active prompt version for a module. Returns None when no
/// registry version is active (callers fall back to the compiled-in const).
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_get_active(
    db: State<'_, AppDb>,
    module: PromptModule,
) -> CommandResponse<Option<ielts_domain::PromptVersion>> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).get_active_prompt_version(module))
}

/// M11-05: propose a candidate (prompt or skill version). The candidate
/// starts at proposed; promotion is gated on a passing eval run.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_propose_candidate(
    db: State<'_, AppDb>,
    command: ProposeCandidateCommand,
) -> CommandResponse<ielts_domain::CandidatePromotion> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).propose_candidate(&command))
}

/// M11-05: run the offline eval for a candidate.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn eval_run_case(
    db: State<'_, AppDb>,
    command: RunEvalCommand,
) -> CommandResponse<ielts_domain::EvalRunOutcome> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).run_eval(&command))
}

/// M11-05: approve a candidate (manual gate). Requires eval_passed.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_approve_candidate(
    db: State<'_, AppDb>,
    command: ApproveCandidateCommand,
) -> CommandResponse<ielts_domain::CandidatePromotion> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).approve_candidate(&command))
}

/// M11-05: promote a candidate. Requires approved; sets the underlying
/// version active and the previously active version rollback.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_promote_candidate(
    db: State<'_, AppDb>,
    command: PromoteCandidateCommand,
) -> CommandResponse<ielts_domain::CandidateDecision> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).promote_candidate(&command))
}

/// M11-05: exact rollback. Marks the active version rollback and reinstates
/// the prior version.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn prompt_rollback(
    db: State<'_, AppDb>,
    command: RollbackCommand,
) -> CommandResponse<ielts_domain::RollbackOutcome> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).rollback_version(&command))
}

/// M11-05: list skill versions.
#[tauri::command]
#[cfg(feature = "daily-dream-v1")]
pub fn skill_list_versions(
    db: State<'_, AppDb>,
    skill: SkillName,
) -> CommandResponse<Vec<ielts_domain::SkillVersion>> {
    let store = ApplicationStore::new(db.inner());
    respond(PromptSkillService::new(&store).list_skill_versions(skill))
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
