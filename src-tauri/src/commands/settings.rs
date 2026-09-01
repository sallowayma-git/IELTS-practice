//! Settings + secret-ref commands (Phase 4).
//! Secrets go to vault; SQLite stores refs only.

use ielts_domain::dto::{
    CommandResponse, SecretRef, SetSecretCommand, SettingEntry, UpsertSettingCommand,
};
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::app::state::{AppDb, AppVault};

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
pub fn list_settings(
    db: State<'_, AppDb>,
    namespace: Option<String>,
) -> CommandResponse<Vec<SettingEntry>> {
    match db.with_conn(|conn| ielts_db::list_settings(conn, namespace.as_deref())) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn upsert_setting(
    db: State<'_, AppDb>,
    cmd: UpsertSettingCommand,
) -> CommandResponse<SettingEntry> {
    match db.with_conn(|conn| ielts_db::upsert_setting(conn, &cmd.namespace, &cmd.key, &cmd.value))
    {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn migrate_local_preferences(
    db: State<'_, AppDb>,
    prefs: serde_json::Map<String, serde_json::Value>,
) -> CommandResponse<u32> {
    match db.with_conn(|conn| ielts_db::migrate_local_storage_prefs(conn, &prefs)) {
        Ok(n) => CommandResponse::success(n),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn set_secret(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    cmd: SetSecretCommand,
) -> CommandResponse<SecretRef> {
    let ref_id = match vault.0.set_secret(&cmd.name, &cmd.secret) {
        Ok(r) => r,
        Err(e) => return CommandResponse::failure(map_db_err(e)),
    };
    match db.with_conn(|conn| ielts_db::put_secret_ref(conn, &cmd.name, &ref_id)) {
        Ok(r) => CommandResponse::success(r),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn list_secret_refs(db: State<'_, AppDb>) -> CommandResponse<Vec<SecretRef>> {
    match db.with_conn(|conn| ielts_db::list_secret_refs(conn)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn delete_secret(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    name: String,
) -> CommandResponse<bool> {
    let _ = vault.0.delete_secret(&name);
    match db.with_conn(|conn| ielts_db::delete_secret_ref(conn, &name)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}
