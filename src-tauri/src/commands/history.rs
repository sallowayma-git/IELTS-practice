//! Unified history Tauri commands (Phase 4).

use ielts_domain::dto::{
    ClearHistoryCommand, CommandResponse, DeleteHistoryAttemptsCommand, ExportHistoryCommand,
    ExportHistoryResult, HistoryDetailResponse, HistoryRetentionPolicyDto, ListHistoryPage,
    ListHistoryQuery, SetHistoryRetentionPolicyCommand, SetHistoryRetentionPolicyResult,
    WritingHistoryStatistics, WritingHistoryStatisticsQuery,
};
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::app::state::{AppDb, AppPaths};

fn map_db_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "db.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[tauri::command]
pub fn list_history(
    db: State<'_, AppDb>,
    query: ListHistoryQuery,
) -> CommandResponse<ListHistoryPage> {
    match db.with_conn(|conn| ielts_db::list_history(conn, &query)) {
        Ok(page) => CommandResponse::success(page),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn get_history_detail(
    db: State<'_, AppDb>,
    attempt_id: String,
) -> CommandResponse<HistoryDetailResponse> {
    match db.with_conn(|conn| ielts_db::get_history_detail(conn, &attempt_id)) {
        Ok(detail) => CommandResponse::success(detail),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn history_writing_statistics(
    db: State<'_, AppDb>,
    query: WritingHistoryStatisticsQuery,
) -> CommandResponse<WritingHistoryStatistics> {
    match db.with_conn(|conn| ielts_db::writing_history_statistics(conn, &query)) {
        Ok(statistics) => CommandResponse::success(statistics),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

#[tauri::command]
pub fn delete_history_attempts(
    db: State<'_, AppDb>,
    cmd: DeleteHistoryAttemptsCommand,
) -> CommandResponse<u32> {
    match db.with_conn(|conn| ielts_db::delete_history_attempts(conn, &cmd.attempt_ids)) {
        Ok(deleted) => CommandResponse::success(deleted),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

#[tauri::command]
pub fn clear_history(db: State<'_, AppDb>, cmd: ClearHistoryCommand) -> CommandResponse<u32> {
    match db.with_conn(|conn| ielts_db::clear_history(conn, cmd.activity)) {
        Ok(deleted) => CommandResponse::success(deleted),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

#[tauri::command]
pub fn export_history(
    db: State<'_, AppDb>,
    paths: State<'_, AppPaths>,
    cmd: ExportHistoryCommand,
) -> CommandResponse<ExportHistoryResult> {
    match db.with_conn(|conn| ielts_db::export_history(conn, cmd.format, cmd.query.as_ref())) {
        Ok(mut result) => {
            // Optionally persist export under app exports dir for file dialogs later.
            let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let ext = match result.format {
                ielts_domain::dto::HistoryExportFormat::Csv => "csv",
                ielts_domain::dto::HistoryExportFormat::Markdown => "md",
                ielts_domain::dto::HistoryExportFormat::Json => "json",
            };
            let path = paths.exports.join(format!("history-{stamp}.{ext}"));
            if let Err(err) = std::fs::write(&path, result.body.as_bytes()) {
                tracing::warn!(error = %err, "failed to write history export file");
            } else {
                tracing::info!(path = %path.display(), "history export written");
            }
            // body still returned for UI download/copy
            let _ = &mut result;
            CommandResponse::success(result)
        }
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn delete_history_attempt(db: State<'_, AppDb>, attempt_id: String) -> CommandResponse<bool> {
    match db.with_conn(|conn| ielts_db::delete_attempt(conn, &attempt_id)) {
        Ok(ok) => CommandResponse::success(ok),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

/// Read the SQLite-owned history retention policy. The UI must consume this
/// value directly instead of presenting an unrelated settings KV as a switch.
#[tauri::command]
pub fn history_get_retention_policy(
    db: State<'_, AppDb>,
) -> CommandResponse<HistoryRetentionPolicyDto> {
    match db.with_conn(ielts_db::get_history_retention_policy) {
        Ok(policy) => CommandResponse::success(policy),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

/// Set a bounded policy (50–500 in steps of 50) or `null` for unlimited
/// retention. The repository validates and applies immediate pruning atomically.
#[tauri::command]
pub fn history_set_retention_policy(
    db: State<'_, AppDb>,
    cmd: SetHistoryRetentionPolicyCommand,
) -> CommandResponse<SetHistoryRetentionPolicyResult> {
    match db
        .with_conn(|conn| ielts_db::set_history_retention_policy(conn, cmd.max_terminal_attempts))
    {
        Ok(result) => CommandResponse::success(result),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

/// Compatibility command name for callers not yet on `reading_import_archive`.
/// It returns the same canonical all-or-nothing report as the Reading command.
#[tauri::command]
pub fn import_reading_archive_value(
    db: State<'_, AppDb>,
    value: serde_json::Value,
) -> CommandResponse<ielts_db::ReadingArchiveImportResult> {
    match db.with_conn(|conn| ielts_db::import_reading_archive_value(conn, &value)) {
        Ok(report) => CommandResponse::success(report),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}
