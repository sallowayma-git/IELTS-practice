use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use serde::Serialize;
use tauri::{ipc::Channel, State};
use tauri_plugin_updater::UpdaterExt;

use crate::app::state::AppPaths;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub product_name: String,
    pub host: String,
    pub fastify_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupDiagnostics {
    pub boot_id: String,
    pub started_at: String,
    pub app_data: String,
    pub logs_dir: String,
    pub legacy_data_dirs: Vec<String>,
    pub fastify_enabled: bool,
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    pub configured: bool,
    pub update_available: bool,
    pub installed: bool,
    pub requires_restart: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub body: Option<String>,
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub content_length: Option<u64>,
    pub message: String,
}

#[derive(Default)]
pub struct UpdaterRuntimeState {
    installed: AtomicBool,
}

impl UpdaterRuntimeState {
    fn mark_installed(&self) {
        self.installed.store(true, Ordering::Release);
    }

    fn is_installed(&self) -> bool {
        self.installed.load(Ordering::Acquire)
    }
}

fn updater_config_is_ready(value: Option<&serde_json::Value>) -> bool {
    let Some(config) = value.and_then(serde_json::Value::as_object) else {
        return false;
    };
    let endpoints_ready = config
        .get("endpoints")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|items| {
            !items.is_empty()
                && items.iter().all(|item| {
                    item.as_str()
                        .is_some_and(|endpoint| endpoint.starts_with("https://"))
                })
        });
    let pubkey_ready = config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty());
    endpoints_ready && pubkey_ready
}

fn updater_is_configured(app: &tauri::AppHandle) -> bool {
    updater_config_is_ready(app.config().plugins.0.get("updater"))
}

fn updater_status(
    app: &tauri::AppHandle,
    configured: bool,
    update_available: bool,
    installed: bool,
    latest_version: Option<String>,
    body: Option<String>,
    stage: &str,
    message: impl Into<String>,
) -> UpdaterStatus {
    UpdaterStatus {
        configured,
        update_available,
        installed,
        requires_restart: installed,
        current_version: app.package_info().version.to_string(),
        latest_version,
        body,
        stage: stage.into(),
        message: message.into(),
    }
}

fn send_update_event(
    channel: &Channel<UpdaterProgressEvent>,
    stage: &str,
    downloaded_bytes: u64,
    content_length: Option<u64>,
    message: &str,
) {
    let _ = channel.send(UpdaterProgressEvent {
        stage: stage.into(),
        downloaded_bytes,
        content_length,
        message: message.into(),
    });
}

fn finalize_install(
    runtime: &UpdaterRuntimeState,
    install_result: Result<(), String>,
) -> Result<(), String> {
    install_result?;
    runtime.mark_installed();
    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdaterStatus, String> {
    let configured = updater_is_configured(&app);
    if !configured {
        return Ok(updater_status(
            &app,
            false,
            false,
            false,
            None,
            None,
            "unconfigured",
            "此构建未配置签名更新通道。",
        ));
    }

    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    match update {
        Some(item) => Ok(updater_status(
            &app,
            true,
            true,
            false,
            Some(item.version),
            item.body,
            "available",
            "发现已签名的新版本。",
        )),
        None => Ok(updater_status(
            &app,
            true,
            false,
            false,
            None,
            None,
            "upToDate",
            "当前已是最新版本。",
        )),
    }
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    runtime: State<'_, UpdaterRuntimeState>,
    on_event: Channel<UpdaterProgressEvent>,
) -> Result<UpdaterStatus, String> {
    if !updater_is_configured(&app) {
        return Err("此构建未配置签名更新通道。".into());
    }

    send_update_event(&on_event, "checking", 0, None, "正在确认最新版本。");
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let Some(update) = update else {
        send_update_event(&on_event, "upToDate", 0, None, "当前已是最新版本。");
        return Ok(updater_status(
            &app,
            true,
            false,
            false,
            None,
            None,
            "upToDate",
            "当前已是最新版本。",
        ));
    };

    let latest_version = update.version.clone();
    let body = update.body.clone();
    send_update_event(
        &on_event,
        "downloading",
        0,
        None,
        "正在下载并验证更新签名。",
    );

    let downloaded = Arc::new(AtomicU64::new(0));
    let chunk_downloaded = Arc::clone(&downloaded);
    let finish_downloaded = Arc::clone(&downloaded);
    let chunk_channel = on_event.clone();
    let finish_channel = on_event.clone();
    let install_result = update
        .download_and_install(
            move |chunk_size, content_length| {
                let total = chunk_downloaded.fetch_add(chunk_size as u64, Ordering::AcqRel)
                    + chunk_size as u64;
                send_update_event(
                    &chunk_channel,
                    "downloading",
                    total,
                    content_length,
                    "正在下载并验证更新签名。",
                );
            },
            move || {
                send_update_event(
                    &finish_channel,
                    "installing",
                    finish_downloaded.load(Ordering::Acquire),
                    None,
                    "签名验证通过，正在安装更新。",
                );
            },
        )
        .await;
    if let Err(error) =
        finalize_install(&runtime, install_result.map_err(|error| error.to_string()))
    {
        send_update_event(
            &on_event,
            "failed",
            downloaded.load(Ordering::Acquire),
            None,
            "更新安装失败，当前版本保持不变。",
        );
        return Err(error);
    }

    send_update_event(
        &on_event,
        "installed",
        downloaded.load(Ordering::Acquire),
        None,
        "更新已安装，重启后生效。",
    );
    Ok(updater_status(
        &app,
        true,
        false,
        true,
        Some(latest_version),
        body,
        "installed",
        "更新已安装，重启后生效。",
    ))
}

#[tauri::command]
pub fn restart_after_update(
    app: tauri::AppHandle,
    runtime: State<'_, UpdaterRuntimeState>,
) -> Result<(), String> {
    if !runtime.is_installed() {
        return Err("当前进程没有已安装且待重启的更新。".into());
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "ielts-practice".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: tauri::VERSION.into(),
        product_name: "IELTS Practice".into(),
        host: "tauri".into(),
        // Explicit: Phase 2 shell must not start localhost business API.
        fastify_enabled: false,
    }
}

#[tauri::command]
pub fn get_startup_diagnostics(paths: State<'_, AppPaths>) -> StartupDiagnostics {
    StartupDiagnostics {
        boot_id: uuid::Uuid::new_v4().to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        app_data: paths.app_data.display().to_string(),
        logs_dir: paths.logs.display().to_string(),
        legacy_data_dirs: paths
            .legacy_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect(),
        fastify_enabled: false,
        notes: vec![
            "Phase 10 cutover: Tauri/Rust is the only shipping runtime.".into(),
            "No localhost Fastify business API is started.".into(),
            "SQLite v2 is primary store; legacy importers remain for one-shot migration.".into(),
            "Shadow dual-read is test-only; production path is single-source.".into(),
            "Updater is fail-closed; release builds inject a signed endpoint and public key."
                .into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::{finalize_install, updater_config_is_ready, UpdaterRuntimeState};
    use serde_json::json;

    #[test]
    fn updater_config_requires_https_endpoint_and_pubkey() {
        assert!(!updater_config_is_ready(None));
        assert!(!updater_config_is_ready(Some(&json!({
            "endpoints": [],
            "pubkey": ""
        }))));
        assert!(!updater_config_is_ready(Some(&json!({
            "endpoints": ["http://updates.example.test/latest.json"],
            "pubkey": "public-key"
        }))));
        assert!(updater_config_is_ready(Some(&json!({
            "endpoints": ["https://updates.example.test/latest.json"],
            "pubkey": "public-key"
        }))));
    }

    #[test]
    fn failed_install_never_unlocks_restart() {
        let runtime = UpdaterRuntimeState::default();
        assert!(finalize_install(&runtime, Err("injected install failure".into())).is_err());
        assert!(!runtime.is_installed());
        assert!(finalize_install(&runtime, Ok(())).is_ok());
        assert!(runtime.is_installed());
    }
}

#[tauri::command]
pub fn get_performance_budgets() -> ielts_domain::dto::CommandResponse<serde_json::Value> {
    let b = ielts_db::DEFAULT_BUDGETS;
    ielts_domain::dto::CommandResponse::success(serde_json::json!({
        "coldStartInteractiveMs": b.cold_start_interactive_ms,
        "warmStartInteractiveMs": b.warm_start_interactive_ms,
        "libraryFirstPaintMs": b.library_first_paint_ms,
        "answerLocalSaveMs": b.answer_local_save_ms,
        "historyFirstPageMs": b.history_first_page_ms,
        "resultOpenMs": b.result_open_ms,
        "evaluationUiLatencyMs": b.evaluation_ui_latency_ms
    }))
}

#[tauri::command]
pub fn get_query_plan_baselines(
    db: tauri::State<'_, crate::app::state::AppDb>,
) -> ielts_domain::dto::CommandResponse<Vec<ielts_db::QueryPlanBaseline>> {
    match db.with_conn(|conn| ielts_db::collect_query_plan_baselines(conn)) {
        Ok(v) => ielts_domain::dto::CommandResponse::success(v),
        Err(e) => ielts_domain::dto::CommandResponse::failure(ielts_domain::ErrorEnvelope {
            code: "perf.query_plan".into(),
            message: e.to_string(),
            retryable: false,
            context: None,
            cause_id: None,
        }),
    }
}
