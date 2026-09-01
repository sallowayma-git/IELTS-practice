//! Reading asset + attempt Tauri commands (Phase 6).

use ielts_domain::domain::Activity;
use ielts_domain::dto::CommandResponse;
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::app::state::AppDb;
use ielts_db::{
    export_reading_archive, get_open_reading_draft_with_timer, import_reading_archive_value,
    list_assets, load_pdf_data_url, load_practice_asset_payload, patch_reading_answer,
    pick_reading_practice_asset, save_reading_draft, submit_reading_attempt, AssetIndexEntry,
    PickReadingPracticeAssetCommand, PickedReadingPracticeAsset, ReadingArchiveImportResult,
    ReadingArchiveSnapshot, ReadingDraftCommand, ReadingOpenDraft, ReadingSubmitCommand,
    ReadingSubmitResult,
};

fn map_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "reading.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[tauri::command]
pub fn reading_list_assets(db: State<'_, AppDb>) -> CommandResponse<Vec<AssetIndexEntry>> {
    match db.with_conn(|conn| list_assets(conn, Some(Activity::Reading))) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

/// Rust owns random Reading practice selection; Vue receives only the chosen id.
#[tauri::command]
pub fn reading_pick_practice_asset(
    db: State<'_, AppDb>,
    cmd: PickReadingPracticeAssetCommand,
) -> CommandResponse<PickedReadingPracticeAsset> {
    match db.with_conn(|conn| pick_reading_practice_asset(conn, &cmd)) {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn reading_get_asset_payload(
    db: State<'_, AppDb>,
    asset_id: String,
) -> CommandResponse<ielts_domain::dto::PracticeAssetV2Payload> {
    match db.with_conn(|conn| load_practice_asset_payload(conn, &asset_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn reading_get_pdf_data_url(db: State<'_, AppDb>, asset_id: String) -> CommandResponse<String> {
    match db.with_conn(|conn| load_pdf_data_url(conn, &asset_id)) {
        Ok(value) => CommandResponse::success(value),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

/// Rust-owned, one-snapshot export for the Reading Library archive download.
#[tauri::command]
pub fn reading_export_archive(db: State<'_, AppDb>) -> CommandResponse<ReadingArchiveSnapshot> {
    match db.with_conn(export_reading_archive) {
        Ok(snapshot) => CommandResponse::success(snapshot),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

/// Validate every archive record before writing, then commit all or none.
#[tauri::command]
pub fn reading_import_archive(
    db: State<'_, AppDb>,
    value: serde_json::Value,
) -> CommandResponse<ReadingArchiveImportResult> {
    match db.with_conn(|conn| import_reading_archive_value(conn, &value)) {
        Ok(result) => CommandResponse::success(result),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn reading_save_draft(
    db: State<'_, AppDb>,
    cmd: ReadingDraftCommand,
) -> CommandResponse<ielts_domain::dto::AttemptRecord> {
    match db.with_conn(|conn| save_reading_draft(conn, &cmd)) {
        Ok(a) => CommandResponse::success(a),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn reading_get_open_draft(
    db: State<'_, AppDb>,
    asset_id: String,
    suite_id: Option<String>,
    endless_session_id: Option<String>,
) -> CommandResponse<Option<ReadingOpenDraft>> {
    match db.with_conn(|conn| {
        get_open_reading_draft_with_timer(
            conn,
            &asset_id,
            suite_id.as_deref(),
            endless_session_id.as_deref(),
        )
    }) {
        Ok(a) => CommandResponse::success(a),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn reading_patch_answer(
    db: State<'_, AppDb>,
    attempt_id: String,
    question_id: String,
    answer: serde_json::Value,
    marked: Option<bool>,
) -> CommandResponse<bool> {
    match db.with_conn(|conn| {
        patch_reading_answer(
            conn,
            &attempt_id,
            &question_id,
            &answer,
            marked.unwrap_or(false),
        )
    }) {
        Ok(()) => CommandResponse::success(true),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn reading_submit_attempt(
    db: State<'_, AppDb>,
    cmd: ReadingSubmitCommand,
) -> CommandResponse<ReadingSubmitResult> {
    match db.with_conn(|conn| submit_reading_attempt(conn, &cmd)) {
        Ok(r) => CommandResponse::success(r),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}
