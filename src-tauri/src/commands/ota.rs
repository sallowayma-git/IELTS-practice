//! Tiered OTA glue: the signed channel manifest, live content packs, and
//! the mirror-aware source list the app updater also uses.
//!
//! Pure logic (manifest, policy, sources, pack store) lives in `ielts-ota`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use ielts_ota::fetch::{download_verified, fetch_manifest, Progress, Transport};
use ielts_ota::manifest::OtaManifest;
use ielts_ota::pack::{ContentStore, PackOrigin};
use ielts_ota::policy::{
    decide_app, decide_content, AppDecision, AppTier, ContentDecision, ContentState,
};
use ielts_ota::sources::SourceConfig;
use semver::Version;
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};

use crate::app::state::{AppDb, AppPaths};

const BUNDLED_SOURCES: &str = include_str!("../../ota/sources.json");
const PROBE_TIMEOUT: Duration = Duration::from_secs(12);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
pub const WRITING_CATALOG_FILE: &str = "bc-task2-2024-12_2025-01.catalog.json";
const DEFAULT_DOWNLOAD_PAGE: &str =
    "https://github.com/sallowayma-git/IELTS-practice/releases/latest";

/// Content slots the app knows how to load: (pack id, bundled resource dir).
const CONTENT_SLOTS: [(&str, &str); 2] =
    [("reading", "reading"), ("writing-topics", "writing-topics")];

// ---------------------------------------------------------------- state

#[derive(Default)]
pub struct OtaState {
    last_check: Mutex<Option<CachedCheck>>,
    /// One content install at a time.
    installing: tokio::sync::Mutex<()>,
}

#[derive(Clone)]
struct CachedCheck {
    manifest: OtaManifest,
    source_order: Vec<String>,
}

impl OtaState {
    fn remember(&self, check: CachedCheck) {
        if let Ok(mut slot) = self.last_check.lock() {
            *slot = Some(check);
        }
    }

    fn cached(&self) -> Option<CachedCheck> {
        self.last_check.lock().ok().and_then(|slot| slot.clone())
    }

    /// Fastest sources first, as measured by the last manifest probe.
    pub fn source_order(&self) -> Vec<String> {
        self.cached()
            .map(|check| check.source_order)
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------- config

fn ota_root(paths: &AppPaths) -> PathBuf {
    paths.app_data.join("ota")
}

fn content_store(paths: &AppPaths) -> ContentStore {
    ContentStore::new(ota_root(paths).join("content"))
}

/// `<app_data>/ota/sources.json` lets self-hosters add a mirror without a
/// rebuild; a broken override falls back to the bundled list.
pub fn source_config(paths: &AppPaths) -> SourceConfig {
    let override_path = ota_root(paths).join("sources.json");
    if let Ok(raw) = std::fs::read(&override_path) {
        match SourceConfig::parse(&raw) {
            Ok(config) => return config,
            Err(error) => {
                tracing::warn!(%error, path = %override_path.display(), "ignoring invalid OTA source override")
            }
        }
    }
    SourceConfig::parse(BUNDLED_SOURCES.as_bytes()).expect("bundled OTA sources are valid")
}

/// The updater public key is the single trust root for every tier.
pub fn updater_pubkey(app: &AppHandle) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_owned)
}

fn app_version(app: &AppHandle) -> Version {
    let raw = app.package_info().version.to_string();
    Version::parse(&raw).unwrap_or_else(|_| Version::new(0, 0, 0))
}

fn bundled_dir(app: &AppHandle, resource: &str) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|dir| dir.join(resource))
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------- transport

pub struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new(timeout: Duration) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("IELTS-Practice-OTA/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(8))
            .timeout(timeout)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client })
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn get(
        &self,
        url: &str,
        max_bytes: u64,
        progress: Progress<'_>,
    ) -> Result<Vec<u8>, String> {
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        let length = response.content_length();
        if length.is_some_and(|length| length > max_bytes) {
            return Err(format!("response is larger than {max_bytes} bytes"));
        }
        let mut body = Vec::with_capacity(length.unwrap_or(0).min(max_bytes) as usize);
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            if (body.len() + chunk.len()) as u64 > max_bytes {
                return Err(format!("response is larger than {max_bytes} bytes"));
            }
            body.extend_from_slice(&chunk);
            progress(body.len() as u64, length);
        }
        Ok(body)
    }
}

// ---------------------------------------------------------------- check

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaStatus {
    /// False when this build has no updater key (dev builds): fail closed.
    pub configured: bool,
    pub current_version: String,
    pub app: Option<AppDecision>,
    #[serde(skip)]
    pub installer_signatures: Vec<String>,
    pub notes: Option<String>,
    pub download_pages: Vec<DownloadPageView>,
    pub content: Vec<ContentDecision>,
    pub source: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPageView {
    pub index: usize,
    pub label: String,
}

fn installed_versions(app: &AppHandle, paths: &AppPaths) -> Vec<(String, u64)> {
    let store = content_store(paths);
    let version = app_version(app);
    CONTENT_SLOTS
        .iter()
        .filter_map(|(id, resource)| {
            let bundled = bundled_dir(app, resource).ok()?;
            Some((
                id.to_string(),
                store.resolve(id, &bundled, &version).version,
            ))
        })
        .collect()
}

fn status_message(app: &AppDecision, content: &[ContentDecision]) -> String {
    let content_ready = content
        .iter()
        .filter(|item| item.state == ContentState::Available)
        .count();
    match (app.tier, content_ready) {
        (AppTier::Reinstall, _) => format!("新版本 {} 需要重新安装。", app.latest_version),
        (AppTier::Ota, _) => format!("发现新版本 {}。", app.latest_version),
        (AppTier::UpToDate, 0) => "应用和题库都是最新的。".into(),
        (AppTier::UpToDate, n) => format!("有 {n} 个题库更新，无需重启。"),
    }
}

#[tauri::command]
pub async fn ota_check(
    app: AppHandle,
    paths: State<'_, AppPaths>,
    state: State<'_, OtaState>,
) -> Result<OtaStatus, String> {
    check_channel(&app, &paths, &state).await
}

/// Refresh the signed policy for the operation that is about to consume it.
pub async fn check_channel(
    app: &AppHandle,
    paths: &AppPaths,
    state: &OtaState,
) -> Result<OtaStatus, String> {
    let current = app_version(app);
    let Some(pubkey) = updater_pubkey(app) else {
        return Ok(OtaStatus {
            configured: false,
            current_version: current.to_string(),
            app: None,
            installer_signatures: Vec::new(),
            notes: None,
            download_pages: Vec::new(),
            content: Vec::new(),
            source: None,
            message: "此构建未配置签名更新通道。".into(),
        });
    };
    let config = source_config(paths);
    let transport: Arc<dyn Transport> = Arc::new(HttpTransport::new(PROBE_TIMEOUT)?);
    let verified = fetch_manifest(transport, &config, &pubkey, PROBE_TIMEOUT)
        .await
        .map_err(|error| format!("所有更新源都不可用：{error}"))?;
    let manifest = verified.manifest;
    let decision = decide_app(&current, &manifest.app);
    let installed = installed_versions(app, paths);
    let content: Vec<ContentDecision> = manifest
        .content
        .iter()
        .filter_map(|pack| {
            let (_, version) = installed.iter().find(|(id, _)| *id == pack.id)?;
            Some(decide_content(&current, pack, *version))
        })
        .collect();
    let source = verified.source_order.first().map(|id| config.label(id));
    let status = OtaStatus {
        configured: true,
        current_version: current.to_string(),
        message: status_message(&decision, &content),
        notes: manifest.app.notes.clone(),
        download_pages: download_pages(&manifest)
            .into_iter()
            .enumerate()
            .map(|(index, (label, _))| DownloadPageView { index, label })
            .collect(),
        app: Some(decision.clone()),
        installer_signatures: manifest.app.installer_signatures.clone(),
        content,
        source,
    };
    state.remember(CachedCheck {
        manifest,
        source_order: verified.source_order,
    });
    Ok(status)
}

fn download_pages(manifest: &OtaManifest) -> Vec<(String, String)> {
    let pages: Vec<(String, String)> = manifest
        .app
        .download_pages
        .iter()
        .map(|page| (page.label.clone(), page.url.clone()))
        .collect();
    if pages.is_empty() {
        return vec![("GitHub".into(), DEFAULT_DOWNLOAD_PAGE.into())];
    }
    pages
}

/// Opens only pages named by the verified manifest (or the GitHub default):
/// the webview never passes a URL.
#[tauri::command]
pub fn ota_open_download_page(
    app: AppHandle,
    state: State<'_, OtaState>,
    index: usize,
) -> Result<(), String> {
    let pages = state
        .cached()
        .map(|check| download_pages(&check.manifest))
        .unwrap_or_else(|| vec![("GitHub".into(), DEFAULT_DOWNLOAD_PAGE.into())]);
    let (_, url) = pages.get(index).ok_or("下载页不存在。")?;
    #[allow(deprecated)]
    tauri_plugin_shell::ShellExt::shell(&app)
        .open(url.as_str(), None)
        .map_err(|error| error.to_string())
}

// ---------------------------------------------------------------- content install

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaContentEvent {
    pub id: String,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaContentResult {
    pub id: String,
    pub version: u64,
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn ota_install_content(
    app: AppHandle,
    paths: State<'_, AppPaths>,
    db: State<'_, AppDb>,
    state: State<'_, OtaState>,
    on_event: Channel<OtaContentEvent>,
) -> Result<Vec<OtaContentResult>, String> {
    let _guard = state
        .installing
        .try_lock()
        .map_err(|_| "题库更新正在进行中。")?;
    let check = state.cached().ok_or("请先检查更新。")?;
    let current = app_version(&app);
    let installed = installed_versions(&app, &paths);
    let config = source_config(&paths);
    let transport = HttpTransport::new(DOWNLOAD_TIMEOUT)?;
    let store = content_store(&paths);
    let mut results = Vec::new();
    for pack in &check.manifest.content {
        let Some((_, version)) = installed.iter().find(|(id, _)| *id == pack.id) else {
            continue;
        };
        if decide_content(&current, pack, *version).state != ContentState::Available {
            continue;
        }
        let send = |stage: &str, done: u64, message: &str| {
            let _ = on_event.send(OtaContentEvent {
                id: pack.id.clone(),
                stage: stage.into(),
                downloaded_bytes: done,
                total_bytes: pack.size,
                message: message.into(),
            });
        };
        send("downloading", 0, "正在下载题库更新。");
        let candidates = config.channel_candidates(&pack.file, &check.source_order);
        let progress = |done: u64, _: Option<u64>| send("downloading", done, "正在下载题库更新。");
        let outcome =
            match download_verified(&transport, &candidates, &pack.sha256, pack.size, &progress)
                .await
            {
                Ok((archive, _source)) => {
                    send("installing", pack.size, "校验通过，正在导入题库。");
                    install_pack(
                        &app,
                        &store,
                        &db,
                        &pack.id,
                        pack.version,
                        &pack.sha256,
                        &archive,
                    )
                }
                Err(error) => Err(error.to_string()),
            };
        let (ok, message) = match outcome {
            Ok(message) => (true, message),
            Err(error) => (false, format!("更新失败，已保留当前题库：{error}")),
        };
        send(if ok { "installed" } else { "failed" }, pack.size, &message);
        results.push(OtaContentResult {
            id: pack.id.clone(),
            version: pack.version,
            ok,
            message,
        });
    }
    Ok(results)
}

/// Install and validate, persist the activation marker, then seed in one
/// database transaction. A marker-write failure cannot leave imported rows;
/// a seed failure restores the previous marker.
fn install_pack(
    app: &AppHandle,
    store: &ContentStore,
    db: &AppDb,
    id: &str,
    version: u64,
    sha256: &str,
    archive: &[u8],
) -> Result<String, String> {
    let dir = store
        .install(id, version, archive)
        .map_err(|error| error.to_string())?;
    let previous = slot_resource(id)
        .and_then(|resource| bundled_dir(app, resource).ok())
        .map(|bundled| store.resolve(id, &bundled, &app_version(app)).dir);
    let Some(previous) = previous else {
        let _ = store.discard(id, version);
        return Err(format!("未知题库 {id}"));
    };
    activate_prepared_pack(store, db, id, version, sha256, &dir, &previous)
}

fn activate_prepared_pack(
    store: &ContentStore,
    db: &AppDb,
    id: &str,
    version: u64,
    sha256: &str,
    dir: &Path,
    previous: &Path,
) -> Result<String, String> {
    // Validate the history superset before making the new marker durable.
    if id == "reading" {
        require_reading_superset(previous, dir)?;
    }
    let summary = store
        .activate_and_apply(id, version, sha256, || {
            seed_slot(db, id, dir, None).map_err(ielts_ota::OtaError::Pack)
        })
        .map_err(|error| error.to_string())?;
    // On errors above retain the candidate: its marker may still be active if
    // restoring the old marker failed. Startup can safely prune it later.
    let _ = prune_content(store, db, id);
    tracing::info!(id, version, "content pack activated");
    Ok(summary)
}

fn slot_resource(id: &str) -> Option<&'static str> {
    CONTENT_SLOTS
        .iter()
        .find(|(slot, _)| *slot == id)
        .map(|(_, resource)| *resource)
}

/// Index one content slot from `dir`. For reading, `previous` is the pack
/// being replaced: a new pack must keep every exam it had, because history
/// rows point at those exams and their payload files.
fn seed_slot(db: &AppDb, id: &str, dir: &Path, previous: Option<&Path>) -> Result<String, String> {
    match id {
        "reading" => {
            if let Some(previous) = previous {
                require_reading_superset(previous, dir)?;
            }
            let report = db
                .with_conn(|conn| ielts_db::seed_builtin_reading_pack(conn, dir))
                .map_err(|error| error.to_string())?;
            Ok(format!("阅读题库已更新，共 {} 篇。", report.imported))
        }
        "writing-topics" => {
            let report = db
                .with_conn(|conn| {
                    ielts_db::seed_builtin_writing_catalog(conn, &dir.join(WRITING_CATALOG_FILE))
                })
                .map_err(|error| error.to_string())?;
            Ok(format!(
                "写作题库已更新：新增 {}，更新 {}。",
                report.created, report.updated
            ))
        }
        other => Err(format!("未知题库 {other}")),
    }
}

fn reading_exam_ids(dir: &Path) -> Result<std::collections::BTreeSet<String>, String> {
    let raw = std::fs::read(dir.join("manifest.json")).map_err(|error| error.to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
    Ok(manifest["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["examId"].as_str().map(str::to_owned))
        .collect())
}

fn require_reading_superset(previous: &Path, next: &Path) -> Result<(), String> {
    let before = reading_exam_ids(previous)?;
    let after = reading_exam_ids(next)?;
    let missing: Vec<&String> = before.difference(&after).take(5).collect();
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!("新题库缺少已有题目 {missing:?}，拒绝安装。"))
}

/// Read references and prune under the same database lock so an import
/// cannot add a file reference between the query and directory removal.
fn prune_content(store: &ContentStore, db: &AppDb, id: &str) -> Result<(), String> {
    db.with_conn(|conn| {
        let keep: Vec<u64> = store.active_version(id).into_iter().collect();
        let mut refs = Vec::new();
        if id == "reading" {
            let mut query = conn.prepare(
                "SELECT content_ref FROM practice_assets
                 WHERE activity = 'reading' AND content_ref IS NOT NULL",
            )?;
            let rows = query.query_map([], |row| row.get::<_, String>(0))?;
            for row in rows {
                refs.push(PathBuf::from(row?));
            }
        }
        store.prune_unreferenced(id, &keep, &refs)
            .map_err(|error| ielts_db::DbError::Message(error.to_string()))?;
        Ok(())
    }).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------- startup

/// Seed every content slot from the newest valid pack. A broken download is
/// deactivated and the bundled pack seeded instead; only a broken bundle is
/// fatal, exactly as before OTA existed.
pub fn seed_content_at_startup(
    app: &AppHandle,
    paths: &AppPaths,
    db: &AppDb,
) -> Result<(), String> {
    let store = content_store(paths);
    let version = app_version(app);
    for (id, resource) in CONTENT_SLOTS {
        let bundled = bundled_dir(app, resource)?;
        seed_content_slot(&store, db, id, &bundled, &version)?;
    }
    Ok(())
}

fn seed_content_slot(
    store: &ContentStore,
    db: &AppDb,
    id: &str,
    bundled: &Path,
    version: &Version,
) -> Result<(), String> {
    let resolved = store.resolve(id, bundled, version);
    let seeded = seed_slot(db, id, &resolved.dir, None);
    match (seeded, resolved.origin) {
        (Ok(summary), origin) => {
            tracing::info!(
                id,
                version = resolved.version,
                ?origin,
                summary,
                "content pack indexed"
            );
        }
        (Err(error), PackOrigin::Downloaded) => {
            tracing::error!(id, %error, "downloaded content pack failed; using the bundled pack");
            let _ = store.deactivate(id);
            seed_slot(db, id, bundled, None)?;
        }
        (Err(error), PackOrigin::Bundled) => return Err(format!("bundled {id} pack: {error}")),
    }
    // Fallback only re-indexes bundled exams; downloaded-only exams can
    // still be referenced by the library and practice history.
    let _ = prune_content(store, db, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading_fixture(dir: &Path, version: u64, ids: &[&str]) {
        use sha2::Digest;
        std::fs::create_dir_all(dir).unwrap();
        let entries: Vec<_> = ids.iter().map(|id| {
            let bytes = serde_json::to_vec(&serde_json::json!({
                "examId": id, "questionGroups": [], "questionOrder": [], "answerKey": {}
            })).unwrap();
            let file = format!("{id}.json");
            std::fs::write(dir.join(&file), &bytes).unwrap();
            serde_json::json!({
                "examId": id, "file": file, "title": id,
                "sha256": hex::encode(sha2::Sha256::digest(&bytes))
            })
        }).collect();
        std::fs::write(dir.join("manifest.json"), serde_json::json!({
            "schemaVersion": 1, "packId": "test", "assetCount": entries.len(), "entries": entries
        }).to_string()).unwrap();
        std::fs::write(dir.join("ota-pack.json"), serde_json::json!({
            "id": "reading", "version": version
        }).to_string()).unwrap();
    }

    fn reading_rows(db: &AppDb) -> Vec<(String, String)> {
        db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, content_ref FROM practice_assets WHERE activity = 'reading' ORDER BY id"
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            let values = rows.collect::<Result<Vec<_>, _>>()?;
            Ok(values)
        }).unwrap()
    }

    #[test]
    fn activation_write_failure_cannot_insert_new_reading_exams() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::app::state::test_support::test_db(temp.path());
        let store_root = temp.path().join("content");
        let store = ContentStore::new(&store_root);
        let old = temp.path().join("bundle");
        let next = store_root.join("reading/2");
        reading_fixture(&old, 1, &["a"]);
        reading_fixture(&next, 2, &["a", "b"]);
        seed_slot(&db, "reading", &old, None).unwrap();
        let before = reading_rows(&db);
        std::fs::create_dir_all(store_root.join("reading/active.json.tmp")).unwrap();
        assert!(activate_prepared_pack(&store, &db, "reading", 2, "hash", &next, &old).is_err());
        assert_eq!(reading_rows(&db), before);
        assert_eq!(store.active_version("reading"), None);
    }

    #[test]
    fn failed_reading_import_restores_marker_and_all_database_rows() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::app::state::test_support::test_db(temp.path());
        let store_root = temp.path().join("content");
        let store = ContentStore::new(&store_root);
        let old = store_root.join("reading/1");
        let next = store_root.join("reading/2");
        reading_fixture(&old, 1, &["a"]);
        reading_fixture(&next, 2, &["a", "b"]);
        seed_slot(&db, "reading", &old, None).unwrap();
        store.activate("reading", 1, "old").unwrap();
        let before = reading_rows(&db);
        std::fs::write(next.join("b.json"), "corrupted").unwrap();
        assert!(activate_prepared_pack(&store, &db, "reading", 2, "new", &next, &old).is_err());
        assert_eq!(reading_rows(&db), before);
        assert_eq!(store.active_version("reading"), Some(1));
    }

    #[test]
    fn startup_fallback_retains_downloaded_only_reading_payloads() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::app::state::test_support::test_db(temp.path());
        let store_root = temp.path().join("content");
        let store = ContentStore::new(&store_root);
        let bundled = temp.path().join("bundle");
        let downloaded = store_root.join("reading/2");
        reading_fixture(&bundled, 1, &["a"]);
        reading_fixture(&downloaded, 2, &["a", "b"]);
        seed_slot(&db, "reading", &downloaded, None).unwrap();
        store.activate("reading", 2, "download").unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO attempts (id, activity, asset_id, mode, status, started_at,
                 schema_version, created_at, updated_at)
                 VALUES ('history-b', 'reading', 'b', 'single', 'completed', 't', 2, 't', 't')",
                [],
            )?;
            Ok(())
        }).unwrap();
        // A different payload fails validation; b is still valid and referenced.
        std::fs::write(downloaded.join("a.json"), "corrupted").unwrap();
        seed_content_slot(&store, &db, "reading", &bundled, &Version::new(1, 0, 0)).unwrap();
        assert_eq!(store.active_version("reading"), None);
        let rows = reading_rows(&db);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].1, bundled.join("a.json").display().to_string());
        assert_eq!(rows[1].1, downloaded.join("b.json").display().to_string());
        assert!(Path::new(&rows[1].1).is_file());
        let history_ref: String = db.with_conn(|conn| Ok(conn.query_row(
            "SELECT pa.content_ref FROM attempts at JOIN practice_assets pa ON pa.id = at.asset_id
             WHERE at.id = 'history-b'", [], |row| row.get(0),
        )?)).unwrap();
        assert!(Path::new(&history_ref).is_file());
    }

    #[test]
    fn successful_content_activation_imports_new_exams_and_prunes_unreferenced_files() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::app::state::test_support::test_db(temp.path());
        let store_root = temp.path().join("content");
        let store = ContentStore::new(&store_root);
        let old = store_root.join("reading/1");
        let next = store_root.join("reading/2");
        reading_fixture(&old, 1, &["a"]);
        reading_fixture(&next, 2, &["a", "b"]);
        seed_slot(&db, "reading", &old, None).unwrap();
        store.activate("reading", 1, "old").unwrap();
        activate_prepared_pack(&store, &db, "reading", 2, "new", &next, &old).unwrap();
        assert_eq!(store.active_version("reading"), Some(2));
        assert_eq!(reading_rows(&db).len(), 2);
        assert!(!old.exists());
        assert!(next.join("b.json").is_file());
    }

    #[test]
    fn activation_write_failure_cannot_insert_new_writing_topics() {
        let temp = tempfile::tempdir().unwrap();
        let db = crate::app::state::test_support::test_db(temp.path());
        let store_root = temp.path().join("content");
        let store = ContentStore::new(&store_root);
        let old = temp.path().join("bundle");
        let next = store_root.join("writing-topics/2");
        let write = |dir: &Path, ids: &[&str]| {
            std::fs::create_dir_all(dir).unwrap();
            let topics: Vec<_> = ids.iter().map(|id| serde_json::json!({
                "source_id": id, "type": "task2", "prompt": format!("Discuss education: {id}."),
                "category": "education", "difficulty": 2
            })).collect();
            std::fs::write(dir.join(WRITING_CATALOG_FILE), serde_json::json!({
                "topics": topics
            }).to_string()).unwrap();
        };
        write(&old, &["topic-a"]);
        write(&next, &["topic-a", "topic-b"]);
        seed_slot(&db, "writing-topics", &old, None).unwrap();
        std::fs::create_dir_all(store_root.join("writing-topics/active.json.tmp")).unwrap();
        assert!(activate_prepared_pack(&store, &db, "writing-topics", 2, "hash", &next, &old).is_err());
        let count: i64 = db.with_conn(|conn| Ok(conn.query_row(
            "SELECT COUNT(*) FROM writing_topics", [], |row| row.get(0)
        )?)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn bundled_sources_parse_and_lead_with_github() {
        let config = SourceConfig::parse(BUNDLED_SOURCES.as_bytes()).unwrap();
        assert_eq!(config.sources[0].id, "github");
        assert_eq!(config.manifest_file, "ota.json");
    }

    #[test]
    fn reading_superset_rule() {
        let temp = tempfile::tempdir().unwrap();
        let write = |name: &str, ids: &[&str]| {
            let dir = temp.path().join(name);
            std::fs::create_dir_all(&dir).unwrap();
            let entries: Vec<_> = ids
                .iter()
                .map(|id| serde_json::json!({"examId": id}))
                .collect();
            std::fs::write(
                dir.join("manifest.json"),
                serde_json::json!({"entries": entries}).to_string(),
            )
            .unwrap();
            dir
        };
        let old = write("old", &["a", "b"]);
        assert!(require_reading_superset(&old, &write("grow", &["a", "b", "c"])).is_ok());
        assert!(require_reading_superset(&old, &write("shrink", &["a", "c"])).is_err());
    }

    #[test]
    fn bundled_packs_carry_markers() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        for (id, dir) in [
            ("reading", "assets/resource-pack/reading"),
            ("writing-topics", "assets/generated/writing-topics"),
        ] {
            let marker =
                ielts_ota::pack::read_marker(&root.join(dir)).expect("bundled pack marker");
            assert_eq!(marker.id, id);
            assert!(marker.version > 0);
        }
        assert!(root
            .join("assets/generated/writing-topics")
            .join(WRITING_CATALOG_FILE)
            .is_file());
    }
}
