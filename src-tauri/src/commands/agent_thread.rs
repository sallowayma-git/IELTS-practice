//! M12 General Agent Thread / Planner / Approval Tauri commands.
//!
//! Feature-gated on `agent-threads-v1`. These commands wrap the
//! `AgentThreadService` use cases for the IPC boundary. Rust is the
//! controlled-action authority; the LLM may only request approval-gated
//! actions, never execute them directly. Forbidden action kinds are rejected
//! by the reverse-RPC dispatcher before reaching this layer.

#[cfg(feature = "agent-threads-v1")]
use ielts_application::AgentThreadService;
#[cfg(feature = "agent-threads-v1")]
use ielts_domain::{
    CommandResponse, CreateStudyPlanCommand, CreateThreadCommand, DecideApprovalCommand,
    ErrorEnvelope, MarkPlanItemDoneCommand, RequestCancelCommand, SaveCheckpointCommand,
};
#[cfg(feature = "agent-threads-v1")]
use tauri::State;

#[cfg(feature = "agent-threads-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "agent-threads-v1")]
use crate::app::state::AppDb;

/// M12-01: create a thread.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_create(
    db: State<'_, AppDb>,
    command: CreateThreadCommand,
) -> CommandResponse<ielts_domain::AgentThread> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).create_thread(&command))
}

/// M12-01: append a message to a thread.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_append_message(
    db: State<'_, AppDb>,
    command: ielts_domain::AppendMessageCommand,
) -> CommandResponse<ielts_domain::AgentMessageRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).append_message(&command))
}

/// M12-01: list threads for a user.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_list(
    db: State<'_, AppDb>,
    user_id: String,
    limit: Option<u32>,
) -> CommandResponse<Vec<ielts_domain::AgentThread>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).list_threads(&user_id, limit.unwrap_or(50)))
}

/// M12-01: list messages for a thread.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_list_messages(
    db: State<'_, AppDb>,
    thread_id: String,
    limit: Option<u32>,
) -> CommandResponse<Vec<ielts_domain::AgentMessageRecord>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).list_messages(&thread_id, limit.unwrap_or(200)))
}

/// M12-01: archive a thread.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_archive(
    db: State<'_, AppDb>,
    thread_id: String,
) -> CommandResponse<bool> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).archive_thread(&thread_id))
}

/// M12-02: save a checkpoint.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_save_checkpoint(
    db: State<'_, AppDb>,
    command: SaveCheckpointCommand,
) -> CommandResponse<ielts_domain::AgentCheckpointRecord> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).save_checkpoint(&command))
}

/// M12-02: load the latest checkpoint for a thread.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_load_latest_checkpoint(
    db: State<'_, AppDb>,
    thread_id: String,
) -> CommandResponse<Option<ielts_domain::AgentCheckpointRecord>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).load_latest_checkpoint(&thread_id))
}

/// M12-02: request cancellation of a thread run.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_thread_request_cancel(
    db: State<'_, AppDb>,
    command: RequestCancelCommand,
) -> CommandResponse<ielts_domain::CancelOutcome> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).request_cancel(&command))
}

/// M12-06: list pending approvals.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_approval_list(
    db: State<'_, AppDb>,
    limit: Option<u32>,
) -> CommandResponse<Vec<ielts_domain::ActionApproval>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).list_pending_approvals(limit.unwrap_or(50)))
}

/// M12-06: decide a pending approval (approve or reject).
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn agent_approval_decide(
    db: State<'_, AppDb>,
    command: DecideApprovalCommand,
) -> CommandResponse<ielts_domain::ActionApproval> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).decide_approval(&command))
}

/// M12-04: create a study plan with its items.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn study_plan_create(
    db: State<'_, AppDb>,
    command: CreateStudyPlanCommand,
) -> CommandResponse<ielts_domain::StudyPlan> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).create_study_plan(&command))
}

/// M12-04: list study plan items for a plan.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn study_plan_list_items(
    db: State<'_, AppDb>,
    plan_id: String,
) -> CommandResponse<Vec<ielts_domain::StudyPlanItem>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).list_study_plan_items(&plan_id))
}

/// M12-04: latest plan + items for the console plan panel. Plan IDs are not
/// thread IDs — the UI reads the snapshot instead of guessing ids.
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn study_plan_get_latest(
    db: State<'_, AppDb>,
    user_id: String,
) -> CommandResponse<Option<ielts_domain::StudyPlanSnapshot>> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).load_latest_plan(&user_id))
}

/// M12-04: mark a plan item done (or not done).
#[tauri::command]
#[cfg(feature = "agent-threads-v1")]
pub fn study_plan_mark_done(
    db: State<'_, AppDb>,
    command: MarkPlanItemDoneCommand,
) -> CommandResponse<bool> {
    let store = ApplicationStore::new(db.inner());
    respond(AgentThreadService::new(&store).mark_plan_item_done(&command))
}

#[cfg(feature = "agent-threads-v1")]
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
