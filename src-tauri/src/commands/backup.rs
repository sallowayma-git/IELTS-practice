//! Backup create / dry-run import / import commands (Phase 4).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use ielts_domain::dto::{BackupManifest, CommandResponse, ImportBackupReport};
use ielts_domain::ErrorEnvelope;
use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::app::state::{AppDb, AppPaths, AppVault};

const BACKUP_GRANT_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;

fn map_db_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "backup.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupResult {
    pub manifest: BackupManifest,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileEntry {
    pub name: String,
    pub grant_id: String,
    pub display_path: String,
    pub modified_at: Option<String>,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportGrant {
    pub grant_id: String,
    pub display_path: String,
    pub expires_at: String,
}

#[derive(Debug)]
struct BackupGrantRecord {
    path: PathBuf,
    expires_at: Instant,
}

#[derive(Default)]
pub struct BackupImportGrants {
    grants: Mutex<HashMap<String, BackupGrantRecord>>,
}

impl BackupImportGrants {
    fn issue(&self, path: &Path) -> Result<BackupImportGrant, String> {
        self.issue_with_ttl(path, BACKUP_GRANT_TTL)
    }

    fn issue_with_ttl(&self, path: &Path, ttl: Duration) -> Result<BackupImportGrant, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("invalid backup path: {error}"))?;
        let metadata = canonical
            .metadata()
            .map_err(|error| format!("cannot inspect backup file: {error}"))?;
        if !metadata.is_file() {
            return Err("backup selection is not a file".into());
        }
        if canonical
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
        {
            return Err("backup file must use the .json extension".into());
        }
        if metadata.len() > MAX_BACKUP_BYTES {
            return Err(format!(
                "backup file exceeds the {} MiB limit",
                MAX_BACKUP_BYTES / 1024 / 1024
            ));
        }

        let grant_id = uuid::Uuid::new_v4().to_string();
        let expires_at = Instant::now() + ttl;
        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "backup path grant store is unavailable".to_string())?;
        grants.retain(|_, grant| grant.expires_at > Instant::now());
        grants.insert(
            grant_id.clone(),
            BackupGrantRecord {
                path: canonical.clone(),
                expires_at,
            },
        );
        Ok(BackupImportGrant {
            grant_id,
            display_path: canonical.display().to_string(),
            expires_at: (chrono::Utc::now()
                + chrono::Duration::from_std(ttl)
                    .unwrap_or_else(|_| chrono::Duration::minutes(15)))
            .to_rfc3339(),
        })
    }

    fn resolve(&self, grant_id: &str, consume: bool) -> Result<PathBuf, String> {
        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "backup path grant store is unavailable".to_string())?;
        let now = Instant::now();
        grants.retain(|_, grant| grant.expires_at > now);
        if consume {
            return grants
                .remove(grant_id)
                .map(|grant| grant.path)
                .ok_or_else(|| "backup path grant is invalid or expired".into());
        }
        grants
            .get(grant_id)
            .map(|grant| grant.path.clone())
            .ok_or_else(|| "backup path grant is invalid or expired".into())
    }
}

fn map_path_err(message: impl Into<String>) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "backup.path_grant".into(),
        message: message.into(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[tauri::command]
pub fn create_backup(
    db: State<'_, AppDb>,
    paths: State<'_, AppPaths>,
    app_version: Option<String>,
) -> CommandResponse<CreateBackupResult> {
    let version = app_version.unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    match db.with_conn(|conn| ielts_db::create_backup_package(conn, &version)) {
        Ok(package) => {
            let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let path = paths.backups.join(format!("ielts-backup-{stamp}.json"));
            if let Err(e) = std::fs::create_dir_all(&paths.backups) {
                return CommandResponse::failure(ErrorEnvelope {
                    code: "backup.path".into(),
                    message: format!("cannot create backups dir: {e}"),
                    retryable: false,
                    context: None,
                    cause_id: None,
                });
            }
            if let Err(e) = ielts_db::write_backup_file(&package, &path) {
                return CommandResponse::failure(map_db_err(e));
            }
            tracing::info!(path = %path.display(), "backup written");
            CommandResponse::success(CreateBackupResult {
                manifest: package.manifest,
                path: path.display().to_string(),
            })
        }
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[tauri::command]
pub fn list_backups(
    paths: State<'_, AppPaths>,
    grants: State<'_, BackupImportGrants>,
) -> CommandResponse<Vec<BackupFileEntry>> {
    let mut entries = Vec::new();
    let dir = &paths.backups;
    if !dir.exists() {
        return CommandResponse::success(entries);
    }
    let read = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            return CommandResponse::failure(ErrorEnvelope {
                code: "backup.path".into(),
                message: format!("cannot read backups dir: {e}"),
                retryable: false,
                context: None,
                cause_id: None,
            })
        }
    };
    for item in read.flatten() {
        let path = item.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let meta = item.metadata().ok();
        let modified_at = meta.as_ref().and_then(|m| m.modified().ok()).map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.to_rfc3339()
        });
        let grant = match grants.issue(&path) {
            Ok(grant) => grant,
            Err(error) => {
                tracing::warn!(path = %path.display(), error = %error, "skipping unauthorized backup entry");
                continue;
            }
        };
        entries.push(BackupFileEntry {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string()),
            grant_id: grant.grant_id,
            display_path: grant.display_path,
            modified_at,
            size_bytes: meta.map(|m| m.len()).unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    CommandResponse::success(entries)
}

#[tauri::command]
pub fn pick_backup_import_path(
    app: tauri::AppHandle,
    grants: State<'_, BackupImportGrants>,
) -> CommandResponse<Option<BackupImportGrant>> {
    let file = app
        .dialog()
        .file()
        .add_filter("IELTS Backup", &["json"])
        .blocking_pick_file();
    let Some(file) = file else {
        return CommandResponse::success(None);
    };
    let path = match file.into_path() {
        Ok(path) => path,
        Err(error) => return CommandResponse::failure(map_path_err(error.to_string())),
    };
    match grants.issue(&path) {
        Ok(grant) => CommandResponse::success(Some(grant)),
        Err(error) => CommandResponse::failure(map_path_err(error)),
    }
}

#[tauri::command]
pub fn import_backup_path(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    grants: State<'_, BackupImportGrants>,
    grant_id: String,
    dry_run: bool,
) -> CommandResponse<ImportBackupReport> {
    let canon = match grants.resolve(&grant_id, !dry_run) {
        Ok(path) => path,
        Err(error) => return CommandResponse::failure(map_path_err(error)),
    };
    let package = match ielts_db::read_backup_file(&canon) {
        Ok(p) => p,
        Err(e) => return CommandResponse::failure(map_db_err(e)),
    };
    let result = db.with_conn(|conn| {
        let mut report = ielts_db::import_backup(conn, &package, dry_run)?;
        if report.ok && report.secret_refs_imported > 0 {
            report.warnings.push(
                "备份只包含 API Key 的引用，不包含密钥本身：同一设备且本机凭据记录仍在时可继续使用；换设备后必须重新填写 API Key。"
                    .into(),
            );
        }
        Ok(report)
    });
    let result = result.and_then(|mut report| {
        if report.ok && !dry_run {
            match crate::ai::list_ai_configs_with_vault(db.inner(), vault.inner()) {
                Ok(configs) => {
                    let unavailable = configs.iter().filter(|config| !config.has_secret).count();
                    if unavailable > 0 {
                        report.warnings.push(format!(
                            "恢复后有 {unavailable} 个 AI 配置在本机没有可用 API Key，已取消默认状态，重新填写后才能评测。"
                        ));
                    }
                }
                Err(_) => {
                    // `import_backup` has already committed its validated
                    // snapshot. Never turn that into a false failed restore;
                    // instead disable AI until the user repairs the metadata.
                    db.with_conn(|conn| ielts_db::set_default_ai_config(conn, None))?;
                    report.warnings.push(
                        "恢复后的 AI 配置无法在本机验证，已取消默认状态；请在设置中检查并重新填写 API Key。"
                            .into(),
                    );
                }
            }
        }
        Ok(report)
    });
    match result {
        Ok(report) => CommandResponse::success(report),
        Err(e) => CommandResponse::failure(map_db_err(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::BackupImportGrants;
    use std::{fs, time::Duration};

    #[test]
    fn backup_grants_expire_and_are_consumed() {
        let path =
            std::env::temp_dir().join(format!("ielts-backup-grant-{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, b"{}").unwrap();
        let grants = BackupImportGrants::default();

        let grant = grants
            .issue_with_ttl(&path, Duration::from_secs(60))
            .unwrap();
        assert_eq!(
            grants.resolve(&grant.grant_id, false).unwrap(),
            path.canonicalize().unwrap()
        );
        assert!(grants.resolve(&grant.grant_id, true).is_ok());
        assert!(grants.resolve(&grant.grant_id, false).is_err());

        let expired = grants.issue_with_ttl(&path, Duration::ZERO).unwrap();
        assert!(grants.resolve(&expired.grant_id, false).is_err());
        assert!(grants.resolve("forged", false).is_err());
        let _ = fs::remove_file(path);
    }
}
