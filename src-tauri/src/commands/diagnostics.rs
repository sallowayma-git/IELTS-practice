use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

use serde::Serialize;
use tauri::{ipc::Channel, State};
use tauri_plugin_updater::UpdaterExt;

use crate::app::state::AppPaths;
use crate::commands::ota::{check_channel, source_config, OtaState};
use ielts_ota::policy::{AppDecision, AppTier};

/// Manifest checks must not hang on a stalled source; installer downloads
/// get longer. A dead mirror fails fast at connect either way.
const CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const INSTALLER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(900);
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub product_name: String,
    pub host: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupDiagnostics {
    pub boot_id: String,
    pub started_at: String,
    pub app_data: String,
    pub logs_dir: String,
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

/// Updater manifest endpoints: the OTA channel on every source (fastest
/// probe first), then the endpoints baked into the release config.
fn updater_endpoints(app: &tauri::AppHandle, paths: &AppPaths, ota: &OtaState) -> Vec<tauri::Url> {
    let config = source_config(paths);
    let configured = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut endpoints: Vec<tauri::Url> = Vec::new();
    let channel = config
        .channel_candidates(&config.updater_file, &ota.source_order())
        .into_iter()
        .map(|candidate| candidate.url);
    let baked = configured.iter().filter_map(|value| value.as_str().map(str::to_owned));
    for url in channel.chain(baked) {
        if let Ok(url) = tauri::Url::parse(&url) {
            if !endpoints.contains(&url) {
                endpoints.push(url);
            }
        }
    }
    endpoints
}

fn mirrored_updater(
    app: &tauri::AppHandle,
    paths: &AppPaths,
    ota: &OtaState,
) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder()
        .endpoints(updater_endpoints(app, paths, ota))
        .map_err(|error| error.to_string())?
        .timeout(CHECK_TIMEOUT)
        .configure_client(|client| client.connect_timeout(CONNECT_TIMEOUT))
        .build()
        .map_err(|error| error.to_string())
}

/// Installer URLs to try: the fastest source first, GitHub and proxies after.
fn installer_candidates(paths: &AppPaths, ota: &OtaState, canonical: &tauri::Url) -> Vec<tauri::Url> {
    let canonical_text = canonical.to_string();
    let Some(file) = ielts_ota::sources::url_file_name(&canonical_text) else {
        return vec![canonical.clone()];
    };
    let mut urls: Vec<tauri::Url> = source_config(paths)
        .candidates(file, &canonical_text, &ota.source_order())
        .into_iter()
        .filter_map(|candidate| tauri::Url::parse(&candidate.url).ok())
        .collect();
    if !urls.contains(canonical) {
        urls.push(canonical.clone());
    }
    urls
}

#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    paths: State<'_, AppPaths>,
    ota: State<'_, OtaState>,
) -> Result<UpdaterStatus, String> {
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

    let update = mirrored_updater(&app, &paths, &ota)?
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

fn require_install_target(
    policy: &AppDecision,
    signatures: &[String],
    installer_version: &str,
    installer_signature: &str,
) -> Result<(), String> {
    if policy.tier != AppTier::Ota
        || installer_version != policy.latest_version.as_str()
        || installer_signature.trim().is_empty()
        || !signatures.iter().any(|signed| signed.trim() == installer_signature.trim())
    {
        return Err("安装包与已验证的更新策略不一致，请重新检查更新。".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    paths: State<'_, AppPaths>,
    ota: State<'_, OtaState>,
    runtime: State<'_, UpdaterRuntimeState>,
    on_event: Channel<UpdaterProgressEvent>,
) -> Result<UpdaterStatus, String> {
    if !updater_is_configured(&app) {
        return Err("此构建未配置签名更新通道。".into());
    }
    // Never infer permission to migrate from an absent or stale cached check.
    let status = check_channel(&app, &paths, &ota).await?;
    let policy = status.app
        .ok_or("无法验证此版本的更新策略，请重新检查更新。")?;
    if policy.tier == AppTier::Reinstall {
        return Err("这个版本需要重新下载安装，不能在当前版本上直接更新。".into());
    }

    send_update_event(&on_event, "checking", 0, None, "正在确认最新版本。");
    let update = mirrored_updater(&app, &paths, &ota)?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let Some(mut update) = update else {
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

    require_install_target(
        &policy, &status.installer_signatures, &update.version, &update.signature,
    )?;
    let latest_version = update.version.clone();
    let body = update.body.clone();
    update.timeout = Some(INSTALLER_TIMEOUT);
    let downloaded = Arc::new(AtomicU64::new(0));
    let mut errors = Vec::new();
    let mut bytes = None;
    // Same signed bytes from any source: `download` verifies the minisign
    // signature from the updater manifest before returning.
    for url in installer_candidates(&paths, &ota, &update.download_url.clone()) {
        let host = url.host_str().unwrap_or_default().to_string();
        update.download_url = url;
        downloaded.store(0, Ordering::Release);
        send_update_event(&on_event, "downloading", 0, None, &format!("正在从 {host} 下载并验证更新签名。"));
        let chunk_downloaded = Arc::clone(&downloaded);
        let chunk_channel = on_event.clone();
        let result = update
            .download(
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
                || {},
            )
            .await;
        match result {
            Ok(data) => {
                bytes = Some(data);
                break;
            }
            Err(error) => errors.push(format!("{host}: {error}")),
        }
    }
    let install_result = match bytes {
        Some(bytes) => {
            send_update_event(
                &on_event,
                "installing",
                downloaded.load(Ordering::Acquire),
                None,
                "签名验证通过，正在安装更新。",
            );
            update.install(bytes).map_err(|error| error.to_string())
        }
        None => Err(format!("所有下载源都失败了：{}", errors.join("; "))),
    };
    if let Err(error) =
        finalize_install(&runtime, install_result)
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
    }
}

#[tauri::command]
pub fn get_startup_diagnostics(paths: State<'_, AppPaths>) -> StartupDiagnostics {
    StartupDiagnostics {
        boot_id: uuid::Uuid::new_v4().to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        app_data: paths.app_data.display().to_string(),
        logs_dir: paths.logs.display().to_string(),
        notes: vec![
            "Updater is fail-closed; release builds inject a signed endpoint and public key."
                .into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_install, require_install_target, updater_config_is_ready,
        AppDecision, AppTier, UpdaterRuntimeState,
    };
    use serde_json::json;

    #[test]
    fn installer_must_match_a_signed_ota_decision() {
        let mut policy = AppDecision {
            tier: AppTier::Ota,
            current_version: "0.1.0".into(),
            latest_version: "0.2.0".into(),
            forced: false,
        };
        let signatures = vec!["signed-package".into()];
        assert!(require_install_target(&policy, &signatures, "0.2.0", "signed-package").is_ok());
        assert!(require_install_target(&policy, &[], "0.2.0", "signed-package").is_err());
        assert!(require_install_target(&policy, &signatures, "0.2.0", "different-package").is_err());
        assert!(require_install_target(&policy, &signatures, "0.3.0", "signed-package").is_err());
        assert!(require_install_target(&policy, &signatures, "0.1.5", "signed-package").is_err());
        policy.tier = AppTier::Reinstall;
        assert!(require_install_target(&policy, &signatures, "0.2.0", "signed-package").is_err());
        policy.tier = AppTier::UpToDate;
        assert!(require_install_target(&policy, &signatures, "0.2.0", "signed-package").is_err());
    }


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
