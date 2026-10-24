//! Reading asset + attempt Tauri commands (Phase 6).

use ielts_domain::domain::Activity;
use ielts_domain::dto::CommandResponse;
use ielts_domain::ErrorEnvelope;
use tauri::{Manager, State};

use crate::app::state::AppDb;
use ielts_db::{
    export_reading_archive, get_open_reading_draft_with_timer, import_reading_archive_value,
    list_assets, load_pdf_data_url, load_practice_asset_payload_for_view, patch_reading_answer,
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
    match db.with_conn(|conn| load_practice_asset_payload_for_view(conn, &asset_id)) {
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

fn explanation_error(code: &str, message: String) -> ErrorEnvelope {
    ErrorEnvelope {
        code: code.into(),
        message,
        retryable: false,
        context: None,
        cause_id: None,
    }
}

/// Explanations are static bundled JSON (schema ReadingExplanationV1). They carry
/// no practice state, so they are read straight from the packed resources and
/// verified against the pack manifest's sha256 on every read — no SQLite seeding.
#[tauri::command]
pub fn reading_get_asset_explanation(
    app: tauri::AppHandle,
    asset_id: String,
) -> CommandResponse<serde_json::Value> {
    // Asset ids look like "p1-high-01"; anything else never matches a payload
    // file and must not be allowed to traverse paths.
    if asset_id.is_empty()
        || !asset_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return CommandResponse::failure(explanation_error(
            "reading.explanation_invalid_id",
            format!("invalid reading asset id: {asset_id}"),
        ));
    }
    let pack_dir = match app.path().resource_dir() {
        Ok(dir) => dir.join("reading-explanations"),
        Err(error) => {
            return CommandResponse::failure(explanation_error(
                "reading.explanation_pack_unavailable",
                format!("reading explanation pack unavailable: {error}"),
            ))
        }
    };
    let command = load_bundled_explanation(&pack_dir, &asset_id);
    match command {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(error),
    }
}

fn load_bundled_explanation(
    pack_dir: &std::path::Path,
    asset_id: &str,
) -> Result<serde_json::Value, ErrorEnvelope> {
    use sha2::{Digest, Sha256};

    let manifest_path = pack_dir.join("manifest.json");
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&manifest_path).map_err(|error| {
            explanation_error(
                "reading.explanation_pack_unavailable",
                format!("reading explanation manifest unreadable: {error}"),
            )
        })?)
        .map_err(|error| {
            explanation_error(
                "reading.explanation_pack_invalid",
                format!("reading explanation manifest invalid: {error}"),
            )
        })?;

    let entries = manifest
        .get("entries")
        .and_then(|value| value.as_array())
        .ok_or_else(|| {
            explanation_error(
                "reading.explanation_pack_invalid",
                "reading explanation manifest has no entries".into(),
            )
        })?;
    let entry = entries
        .iter()
        .find(|entry| entry.get("examId").and_then(|v| v.as_str()) == Some(asset_id))
        .ok_or_else(|| {
            explanation_error(
                "reading.explanation_not_found",
                format!("no bundled explanation for asset {asset_id}"),
            )
        })?;

    let file = entry
        .get("file")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    // Mirrors the seed path's guard (assets.rs): reject absolute paths (Path::join
    // would discard the pack dir entirely) and any parent traversal.
    if file.is_empty() || std::path::Path::new(file).is_absolute() || file.contains("..") {
        return Err(explanation_error(
            "reading.explanation_pack_invalid",
            format!("reading explanation entry has unsafe path: {file}"),
        ));
    }
    let raw = std::fs::read(pack_dir.join(file)).map_err(|error| {
        explanation_error(
            "reading.explanation_payload_unreadable",
            format!("reading explanation payload unreadable: {error}"),
        )
    })?;
    let expected = entry
        .get("sha256")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    // Fail closed: an absent checksum invalidates the pack rather than skipping
    // verification (mirrors the seed path, which hard-fails on mismatch).
    if expected.is_empty() {
        return Err(explanation_error(
            "reading.explanation_pack_invalid",
            format!("reading explanation entry for {asset_id} has no sha256"),
        ));
    }
    let actual = hex::encode(Sha256::digest(&raw));
    if actual != expected {
        return Err(explanation_error(
            "reading.explanation_checksum_mismatch",
            format!("reading explanation payload checksum mismatch for {asset_id}"),
        ));
    }
    serde_json::from_slice(&raw).map_err(|error| {
        explanation_error(
            "reading.explanation_pack_invalid",
            format!("reading explanation payload invalid: {error}"),
        )
    })
}
