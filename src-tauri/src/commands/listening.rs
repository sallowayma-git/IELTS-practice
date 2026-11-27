//! Listening asset + attempt Tauri commands.
//!
//! Mirrors the reading command surface: the store owns validation, scoring and
//! idempotency, while this module only maps `DbError` into the wire envelope
//! and resolves the bundled pack root for audio.

use std::path::PathBuf;

use ielts_domain::dto::{AttemptRecord, CommandResponse};
use ielts_domain::ErrorEnvelope;
use tauri::{Manager, State};

use crate::app::state::AppDb;
use crate::idictation::listening::PREVIEW_PREFIX;
use ielts_db::{
    get_open_listening_draft, list_listening_assets, load_listening_audio_data_url,
    load_listening_payload_for_view, save_listening_draft, submit_listening_attempt,
    ListeningDraftCommand, ListeningSubmitCommand, ListeningSubmitResult,
};

const PACK_DIR: &str = "listening";

fn error(message: String) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "listening.error".into(),
        message,
        retryable: false,
        context: None,
        cause_id: None,
    }
}

fn map_err(err: ielts_db::DbError) -> ErrorEnvelope {
    error(err.to_string())
}

/// The bundled pack root. A missing resource directory is a command error,
/// never a panic: a rebuild without the pack keeps the app usable.
fn pack_root(app: &tauri::AppHandle) -> Result<PathBuf, ErrorEnvelope> {
    app.path()
        .resource_dir()
        .map(|dir| dir.join(PACK_DIR))
        .map_err(|err| error(format!("listening resource directory is unavailable: {err}")))
}

#[tauri::command]
pub fn listening_list_assets(
    db: State<'_, AppDb>,
) -> CommandResponse<Vec<ielts_db::AssetIndexEntry>> {
    match db.with_conn(list_listening_assets) {
        Ok(assets) => CommandResponse::success(assets),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}

#[tauri::command]
pub fn listening_get_asset_payload(
    db: State<'_, AppDb>,
    asset_id: String,
) -> CommandResponse<serde_json::Value> {
    match db.with_conn(|conn| load_listening_payload_for_view(conn, &asset_id)) {
        Ok(payload) => CommandResponse::success(payload),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}

#[tauri::command]
pub fn listening_get_audio_data_url(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    asset_id: String,
) -> CommandResponse<String> {
    let root = match pack_root(&app) {
        Ok(root) => root,
        Err(err) => return CommandResponse::failure(err),
    };
    match db.with_conn(|conn| load_listening_audio_data_url(conn, &asset_id, &root)) {
        Ok(data_url) => CommandResponse::success(data_url),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}

#[tauri::command]
pub fn listening_save_draft(
    db: State<'_, AppDb>,
    cmd: ListeningDraftCommand,
) -> CommandResponse<AttemptRecord> {
    if cmd.asset_id.starts_with(PREVIEW_PREFIX) {
        return CommandResponse::failure(error("爱听写预览作答不保存".into()));
    }
    match db.with_conn(|conn| save_listening_draft(conn, &cmd)) {
        Ok(attempt) => CommandResponse::success(attempt),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}

#[tauri::command]
pub fn listening_get_open_draft(
    db: State<'_, AppDb>,
    asset_id: String,
) -> CommandResponse<Option<AttemptRecord>> {
    match db.with_conn(|conn| get_open_listening_draft(conn, &asset_id)) {
        Ok(draft) => CommandResponse::success(draft),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}

#[tauri::command]
pub fn listening_submit_attempt(
    db: State<'_, AppDb>,
    cmd: ListeningSubmitCommand,
) -> CommandResponse<ListeningSubmitResult> {
    if cmd.asset_id.starts_with(PREVIEW_PREFIX) {
        return CommandResponse::failure(error("爱听写预览不支持交卷".into()));
    }
    match db.with_conn(|conn| submit_listening_attempt(conn, &cmd)) {
        Ok(result) => CommandResponse::success(result),
        Err(err) => CommandResponse::failure(map_err(err)),
    }
}
