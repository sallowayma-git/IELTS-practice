#[cfg(feature = "context-compiler-v1")]
use ielts_application::CorpusExportService;
#[cfg(feature = "context-compiler-v1")]
use ielts_domain::{
    CommandResponse, CorpusExportPage, CorpusExportQuery, CorpusFetchQuery, CorpusFetchResult,
    CorpusManifest, ErrorEnvelope,
};
#[cfg(feature = "context-compiler-v1")]
use tauri::State;

#[cfg(feature = "context-compiler-v1")]
use crate::app::application_store::ApplicationStore;
#[cfg(feature = "context-compiler-v1")]
use crate::app::state::AppDb;

#[tauri::command]
#[cfg(feature = "context-compiler-v1")]
pub fn corpus_manifest(db: State<'_, AppDb>) -> CommandResponse<CorpusManifest> {
    let store = ApplicationStore::new(db.inner());
    respond(CorpusExportService::new(&store).corpus_manifest())
}

#[tauri::command]
#[cfg(feature = "context-compiler-v1")]
pub fn corpus_export_chunks(
    db: State<'_, AppDb>,
    query: CorpusExportQuery,
) -> CommandResponse<CorpusExportPage> {
    let store = ApplicationStore::new(db.inner());
    respond(CorpusExportService::new(&store).export_chunks(&query))
}

#[tauri::command]
#[cfg(feature = "context-compiler-v1")]
pub fn corpus_fetch_chunks(
    db: State<'_, AppDb>,
    query: CorpusFetchQuery,
) -> CommandResponse<CorpusFetchResult> {
    let store = ApplicationStore::new(db.inner());
    respond(CorpusExportService::new(&store).fetch_chunks(&query))
}

#[cfg(feature = "context-compiler-v1")]
fn respond<T>(result: Result<T, ielts_application::ApplicationError>) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            error.code,
            error.message,
            error.retryable,
        )),
    }
}
