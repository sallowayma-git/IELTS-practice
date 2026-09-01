#[cfg(feature = "context-compiler-v1")]
use ielts_application::ContextMaterializerService;
#[cfg(feature = "context-compiler-v1")]
use ielts_domain::{CommandResponse, ContextPack, ContextPlan, ErrorEnvelope};
#[cfg(feature = "context-compiler-v1")]
use tauri::State;

#[cfg(feature = "context-compiler-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "context-compiler-v1")]
use crate::app::state::AppDb;

/// M5-08: materialize a typed ContextPlan into an audited ContextPack.
///
/// Rust re-validates every stable ID, re-fetches canonical text, injects the
/// Soul/policy section, enforces the hard token ceiling, hashes the rendered
/// context, and persists the snapshot. The caller may invoke the model only
/// after this returns successfully.
#[tauri::command]
#[cfg(feature = "context-compiler-v1")]
pub fn context_materialize(
    db: State<'_, AppDb>,
    plan: ContextPlan,
    scope: String,
) -> CommandResponse<ContextPack> {
    let store = ApplicationStore::new(db.inner());
    let service = ContextMaterializerService::new(&store, &store);
    respond(service.materialize(&plan, &scope))
}

#[cfg(feature = "context-compiler-v1")]
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
