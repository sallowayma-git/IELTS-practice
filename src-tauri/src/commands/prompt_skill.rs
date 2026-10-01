//! M11 Prompt/Skill Evolution Tauri commands.
//!
//! Feature-gated on `daily-dream-v1` (the evolution layer sits above the
//! context/journal/dream surface). These commands wrap the
//! `PromptSkillService` use cases for the IPC boundary. Rust is the release
//! gate; the LLM may only propose candidates. Product eval verdicts, approval,
//! promotion and rollback are NOT Webview commands (task book §17.8). The
//! offline application/db services remain available to engineering tooling.

#[cfg(feature = "daily-dream-v1")]
use ielts_application::PromptSkillService;
#[cfg(feature = "daily-dream-v1")]
use ielts_domain::{
    CommandResponse, ErrorEnvelope, ProposeCandidateCommand, PromptModule, SkillName,
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
