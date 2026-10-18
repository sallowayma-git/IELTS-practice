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

/// Namespaces the webview writes (see `apps/writing-vue/src`, `upsertSetting`).
/// Everything else is host state: `secret_refs` (keychain references),
/// `weekly_digest` (model output), `reading_draft`, `features`, and so on.
const WEBVIEW_WRITABLE_NAMESPACES: &[&str] = &["app", "frontend-preferences"];
/// Keys in `app` that the host itself reads or migrates.
const HOST_OWNED_APP_KEYS: &[&str] = &["history_limit"];
const MAX_SETTING_KEY_CHARS: usize = 200;

/// The host's allow-list for interface writes. Pure, so it is unit-tested.
pub(crate) fn check_webview_setting(namespace: &str, key: &str) -> Result<(), String> {
    if !WEBVIEW_WRITABLE_NAMESPACES.contains(&namespace) {
        return Err(format!("setting namespace {namespace:?} is not writable from the interface"));
    }
    if key.trim().is_empty() || key.chars().count() > MAX_SETTING_KEY_CHARS {
        return Err("setting key must be 1-200 characters".into());
    }
    if namespace == "app" && HOST_OWNED_APP_KEYS.contains(&key) {
        return Err(format!("setting {key:?} is owned by the host"));
    }
    Ok(())
}

#[tauri::command]
pub fn upsert_setting(
    db: State<'_, AppDb>,
    cmd: UpsertSettingCommand,
) -> CommandResponse<SettingEntry> {
    if let Err(message) = check_webview_setting(&cmd.namespace, &cmd.key) {
        return CommandResponse::failure(ErrorEnvelope {
            code: "settings.forbidden".into(),
            message,
            retryable: false,
            context: None,
            cause_id: None,
        });
    }
    match db.with_conn(|conn| ielts_db::upsert_setting(conn, &cmd.namespace, &cmd.key, &cmd.value))
    {
        Ok(v) => CommandResponse::success(v),
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

#[cfg(test)]
mod tests {
    use super::check_webview_setting;

    #[test]
    fn the_interface_may_write_only_its_own_namespaces() {
        assert!(check_webview_setting("app", "temperature_mode").is_ok());
        assert!(check_webview_setting("frontend-preferences", "theme").is_ok());
        for namespace in [
            "secret_refs",
            "weekly_digest",
            "reading_draft",
            "features",
            "prompts",
            "ui",
            "",
        ] {
            assert!(
                check_webview_setting(namespace, "anything").is_err(),
                "{namespace:?} must be host-owned"
            );
        }
    }

    #[test]
    fn host_owned_keys_and_oversized_keys_are_refused() {
        assert!(check_webview_setting("app", "history_limit").is_err());
        assert!(check_webview_setting("frontend-preferences", "history_limit").is_ok());
        assert!(check_webview_setting("app", "   ").is_err());
        assert!(check_webview_setting("app", &"k".repeat(201)).is_err());
        assert!(check_webview_setting("app", &"k".repeat(200)).is_ok());
    }
}
