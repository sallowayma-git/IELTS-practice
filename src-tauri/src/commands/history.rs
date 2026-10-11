//! Unified history Tauri commands (Phase 4).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use ielts_domain::domain::Activity;
use ielts_domain::dto::{
    ClearHistoryCommand, CommandResponse, DeleteHistoryAttemptsCommand, ExportHistoryCommand,
    ExportHistoryResult, HistoryDetailResponse, HistoryRetentionPolicyDto, IssuedClearHistoryToken,
    ListHistoryPage, ListHistoryQuery, SetHistoryRetentionPolicyCommand,
    SetHistoryRetentionPolicyResult, WritingHistoryStatistics, WritingHistoryStatisticsQuery,
};
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::app::state::{AppDb, AppPaths};

const CLEAR_TOKEN_TTL: Duration = Duration::from_secs(120);

fn refuse(code: &str, message: impl Into<String>) -> ErrorEnvelope {
    ErrorEnvelope {
        code: code.into(),
        message: message.into(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

struct ClearTokenRecord {
    activity: Option<Activity>,
    expires_at: Instant,
}

/// Short-lived, single-use grants for `clear_history`. Issued only by
/// `history_issue_clear_token`, which the UI calls after the typed confirmation.
#[derive(Default)]
pub struct ClearHistoryTokens {
    tokens: Mutex<HashMap<String, ClearTokenRecord>>,
}

impl ClearHistoryTokens {
    fn issue(&self, activity: Option<Activity>) -> Result<(String, Instant), String> {
        self.issue_with_ttl(activity, CLEAR_TOKEN_TTL)
    }

    fn issue_with_ttl(
        &self,
        activity: Option<Activity>,
        ttl: Duration,
    ) -> Result<(String, Instant), String> {
        let token = uuid::Uuid::new_v4().to_string();
        let expires_at = Instant::now() + ttl;
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "clear token store is unavailable".to_string())?;
        let now = Instant::now();
        tokens.retain(|_, record| record.expires_at > now);
        tokens.insert(token.clone(), ClearTokenRecord { activity, expires_at });
        Ok((token, expires_at))
    }

    /// Consume the token. It is removed whether or not it matches, so a token is
    /// good for one attempt at one scope.
    fn consume(&self, token: &str, activity: Option<Activity>) -> Result<(), String> {
        let mut tokens = self
            .tokens
            .lock()
            .map_err(|_| "clear token store is unavailable".to_string())?;
        let record = tokens
            .remove(token)
            .ok_or("clear confirmation is missing or already used")?;
        if record.expires_at <= Instant::now() {
            return Err("clear confirmation has expired; confirm again".into());
        }
        if record.activity != activity {
            return Err("clear confirmation was issued for a different scope".into());
        }
        Ok(())
    }
}

/// Step two of clearing history: the UI has taken the typed confirmation and asks
/// for a token that `clear_history` will accept once.
#[tauri::command]
pub fn history_issue_clear_token(
    db: State<'_, AppDb>,
    clear_tokens: State<'_, ClearHistoryTokens>,
    cmd: ClearHistoryCommand,
) -> CommandResponse<IssuedClearHistoryToken> {
    let count = match db.with_conn(|conn| ielts_db::count_clearable_history(conn, cmd.activity)) {
        Ok(count) => count,
        Err(error) => return CommandResponse::failure(map_db_err(error)),
    };
    match clear_tokens.issue(cmd.activity) {
        Ok((token, expires_at)) => {
            let ttl = expires_at.saturating_duration_since(Instant::now());
            CommandResponse::success(IssuedClearHistoryToken {
                token,
                expires_at: (chrono::Utc::now()
                    + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::seconds(120)))
                .to_rfc3339(),
                clearable_count: count,
            })
        }
        Err(message) => CommandResponse::failure(ErrorEnvelope {
            retryable: true,
            ..refuse("history.clear_token", message)
        }),
    }
}

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

/// Validate a bulk delete before anything is touched. A snapshot is taken only
/// when rows will actually go, so a rejected or empty request never evicts a
/// restore point.
fn prepare_bulk_delete(db: &AppDb, paths: &AppPaths, ids: &[String]) -> Result<(), ErrorEnvelope> {
    let deletable = db
        .with_conn(|conn| ielts_db::count_deletable_history_attempts(conn, ids))
        .map_err(map_db_err)?;
    if deletable == 0 {
        return Ok(());
    }
    db.snapshot_before(paths, "bulk-delete")
}

#[tauri::command]
pub fn delete_history_attempts(
    db: State<'_, AppDb>,
    paths: State<'_, AppPaths>,
    cmd: DeleteHistoryAttemptsCommand,
) -> CommandResponse<u32> {
    if let Err(error) = prepare_bulk_delete(&db, &paths, &cmd.attempt_ids) {
        return CommandResponse::failure(error);
    }
    match db.with_conn(|conn| ielts_db::delete_history_attempts(conn, &cmd.attempt_ids)) {
        Ok(deleted) => CommandResponse::success(deleted),
        Err(error) => CommandResponse::failure(map_db_err(error)),
    }
}

#[tauri::command]
pub fn clear_history(
    db: State<'_, AppDb>,
    paths: State<'_, AppPaths>,
    clear_tokens: State<'_, ClearHistoryTokens>,
    cmd: ClearHistoryCommand,
) -> CommandResponse<u32> {
    if let Err(message) = clear_tokens.consume(&cmd.token, cmd.activity) {
        return CommandResponse::failure(ErrorEnvelope {
            retryable: false,
            ..refuse("history.clear_token", message)
        });
    }
    match db.with_conn(|conn| ielts_db::count_clearable_history(conn, cmd.activity)) {
        Ok(0) => return CommandResponse::success(0),
        Ok(_) => {}
        Err(error) => return CommandResponse::failure(map_db_err(error)),
    }
    if let Err(error) = db.snapshot_before(&paths, "clear-history") {
        return CommandResponse::failure(error);
    }
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
    paths: State<'_, AppPaths>,
    cmd: SetHistoryRetentionPolicyCommand,
) -> CommandResponse<SetHistoryRetentionPolicyResult> {
    let candidates = db.with_conn(|conn| {
        ielts_db::count_retention_prune_candidates(conn, cmd.max_terminal_attempts)
    });
    match candidates {
        Ok(0) => {}
        Ok(_) => {
            if let Err(error) = db.snapshot_before(&paths, "retention-prune") {
                return CommandResponse::failure(error);
            }
        }
        Err(error) => return CommandResponse::failure(map_db_err(error)),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clear_token_is_single_use_and_scoped() {
        let tokens = ClearHistoryTokens::default();
        let (token, _) = tokens.issue(Some(Activity::Reading)).unwrap();
        assert!(tokens.consume(&token, None).is_err(), "wrong scope is refused");
        // The failed attempt burned the token.
        assert!(tokens.consume(&token, Some(Activity::Reading)).is_err());

        let (token, _) = tokens.issue(None).unwrap();
        assert!(tokens.consume(&token, None).is_ok());
        assert!(tokens.consume(&token, None).is_err(), "a token is used once");
    }

    #[test]
    fn a_rejected_bulk_delete_takes_no_snapshot() {
        use crate::app::state::test_support::{test_db, test_paths};
        let dir = tempfile::tempdir().unwrap();
        let paths = test_paths(dir.path());
        let db = test_db(dir.path());
        // Unknown ids are harmless replays: nothing to delete, so no restore point.
        assert!(prepare_bulk_delete(&db, &paths, &["missing".into()]).is_ok());
        assert!(!paths.backups.exists(), "nothing deletable, so no restore point");
        // Over the cap: refused before any snapshot.
        let too_many: Vec<String> = (0..201).map(|index| format!("x{index}")).collect();
        assert!(prepare_bulk_delete(&db, &paths, &too_many).is_err());
        assert!(!paths.backups.exists(), "a rejected call must not evict restore points");
    }

    #[test]
    fn a_clear_token_expires_and_unknown_tokens_are_refused() {
        let tokens = ClearHistoryTokens::default();
        let (expired, _) = tokens.issue_with_ttl(None, Duration::ZERO).unwrap();
        assert!(tokens.consume(&expired, None).is_err());
        assert!(tokens.consume("forged", None).is_err());
    }
}
