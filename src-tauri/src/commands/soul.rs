//! Soul preferences for the settings page.
//!
//! The webview never sees the actor or evidence fields: user edits are
//! recorded by `ielts_db::soul::soul_update` as `actor=user`, and an undo is
//! recorded as `actor=undo`. All validation and auditing stays in the DB layer.

use ielts_domain::{CommandResponse, ErrorEnvelope};
use serde_json::Value;
use tauri::State;

use crate::app::state::AppDb;

/// The single local profile the shipping app reads and writes.
const USER: &str = "local";

#[tauri::command]
pub fn soul_get(db: State<'_, AppDb>) -> CommandResponse<Value> {
    respond(
        db.with_conn(|conn| ielts_db::soul::soul_snapshot(conn, USER)),
        "soul.get_failed",
    )
}

#[tauri::command]
pub fn soul_update(db: State<'_, AppDb>, fields: Value) -> CommandResponse<Value> {
    respond(
        db.with_conn(|conn| ielts_db::soul::soul_update(conn, USER, &fields)),
        "soul.update_failed",
    )
}

#[tauri::command]
pub fn soul_undo(db: State<'_, AppDb>, revision_id: String) -> CommandResponse<Value> {
    respond(
        db.with_conn(|conn| ielts_db::soul::soul_undo(conn, USER, &revision_id)),
        "soul.undo_failed",
    )
}

fn respond(result: ielts_db::DbResult<Value>, code: &str) -> CommandResponse<Value> {
    match result {
        Ok(snapshot) => CommandResponse::success(snapshot),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(code, error.to_string(), false)),
    }
}
