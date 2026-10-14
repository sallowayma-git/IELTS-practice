//! OS-backed secret vault. SQLite stores only opaque references; secret bytes
//! are kept in the platform credential manager (Credential Manager, Keychain,
//! or Secret Service). The file contains metadata only and is safe to backup.

use crate::sqlite::{DbError, DbResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const SERVICE: &str = "com.ieltsatlas.practice";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VaultFile {
    version: u32,
    entries: HashMap<String, VaultEntry>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultEntry {
    ref_id: String,
    updated_at: String,
    #[serde(default, skip_serializing)]
    secret_b64: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SecretVault {
    path: PathBuf,
}

impl SecretVault {
    /// Open (or create) the vault metadata file.
    ///
    /// A corrupt/unparseable file must never make startup fail: it is moved
    /// aside to `vault.json.corrupt-<timestamp>` and the vault starts empty.
    /// Secrets themselves live in the OS keyring, so the user only has to
    /// re-enter the API key (the AI config then reports "not configured").
    pub fn open(path: impl Into<PathBuf>) -> DbResult<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let vault = Self { path };
        if vault.path.exists() {
            vault.quarantine_if_corrupt()?;
        }
        if !vault.path.exists() {
            vault.store(&VaultFile {
                version: 2,
                entries: HashMap::new(),
            })?;
        }
        // Legacy migration needs the OS keyring and trusts file contents
        // (base64). Neither may brick startup; the file is left untouched so
        // the migration is retried on the next launch.
        if let Err(err) = vault.migrate_legacy_file() {
            tracing::warn!(error = %err, path = %vault.path.display(), "legacy secret vault migration failed; will retry on next launch");
        }
        Ok(vault)
    }

    /// Move an unparseable vault file aside. Returns the quarantine path when
    /// the file was corrupt. Plain I/O errors (e.g. permission denied) are
    /// returned as errors and the file is left alone.
    fn quarantine_if_corrupt(&self) -> DbResult<Option<PathBuf>> {
        let bytes = fs::read(&self.path)?;
        let parse_err = match serde_json::from_slice::<VaultFile>(&bytes) {
            Ok(_) => return Ok(None),
            Err(e) => e,
        };
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
        let mut name = self.path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".corrupt-{stamp}"));
        let quarantine = self.path.with_file_name(name);
        fs::rename(&self.path, &quarantine)?;
        tracing::error!(
            error = %parse_err,
            path = %self.path.display(),
            quarantined_to = %quarantine.display(),
            "secret vault file is corrupt; moved aside and starting with an empty vault (API keys must be re-entered)"
        );
        Ok(Some(quarantine))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn set_secret(&self, name: &str, secret: &str) -> DbResult<String> {
        if name.trim().is_empty() {
            return Err(DbError::Validation("secret name required".into()));
        }
        if secret.is_empty() {
            return Err(DbError::Validation("secret value required".into()));
        }
        let mut vault = self.load()?;
        let ref_id = format!("kv:{}:{}", short_hash(name), Uuid::new_v4().simple());
        let entry = keyring::Entry::new(SERVICE, name).map_err(keyring_error)?;
        entry.set_password(secret).map_err(keyring_error)?;
        vault.entries.insert(
            name.to_string(),
            VaultEntry {
                ref_id: ref_id.clone(),
                updated_at: chrono::Utc::now().to_rfc3339(),
                secret_b64: None,
            },
        );
        self.store(&vault)?;
        Ok(ref_id)
    }

    pub fn get_secret_by_ref(&self, ref_id: &str) -> DbResult<Option<String>> {
        let vault = self.load()?;
        for (name, entry) in vault.entries {
            if entry.ref_id == ref_id {
                let key = keyring::Entry::new(SERVICE, &name).map_err(keyring_error)?;
                return match key.get_password() {
                    Ok(value) => Ok(Some(value)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(e) => Err(keyring_error(e)),
                };
            }
        }
        Ok(None)
    }

    pub fn delete_secret(&self, name: &str) -> DbResult<bool> {
        let mut vault = self.load()?;
        let removed = vault.entries.remove(name).is_some();
        if removed {
            if let Ok(key) = keyring::Entry::new(SERVICE, name) {
                let _ = key.delete_credential();
            }
            self.store(&vault)?;
        }
        Ok(removed)
    }

    fn load(&self) -> DbResult<VaultFile> {
        let raw = fs::read_to_string(&self.path)?;
        serde_json::from_str(&raw).map_err(|e| DbError::Message(format!("vault parse: {e}")))
    }
    fn store(&self, vault: &VaultFile) -> DbResult<()> {
        let json = serde_json::to_vec_pretty(vault).map_err(|e| DbError::Message(e.to_string()))?;
        write_atomic(&self.path, &json)?;
        Ok(())
    }

    fn migrate_legacy_file(&self) -> DbResult<()> {
        let mut vault = self.load()?;
        let mut migrated = false;
        for (name, metadata) in &mut vault.entries {
            let Some(encoded) = metadata.secret_b64.take() else {
                continue;
            };
            let bytes = base64_decode(&encoded)?;
            let secret = String::from_utf8(bytes)
                .map_err(|e| DbError::Message(format!("legacy secret utf8: {e}")))?;
            keyring::Entry::new(SERVICE, name)
                .map_err(keyring_error)?
                .set_password(&secret)
                .map_err(keyring_error)?;
            migrated = true;
        }
        if migrated || vault.version < 2 {
            vault.version = 2;
            self.store(&vault)?;
        }
        Ok(())
    }
}

/// Write `bytes` to `path` atomically: temp file in the same directory,
/// fsync, rename over the target, then fsync the directory (best effort).
/// The target's existing permissions are carried over to the new file.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(format!(".tmp-{}", Uuid::new_v4().simple()));
    let tmp = dir.join(tmp_name);
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        if let Ok(meta) = fs::metadata(path) {
            file.set_permissions(meta.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

fn keyring_error(e: keyring::Error) -> DbError {
    DbError::Message(format!("OS credential store unavailable: {e}"))
}
fn short_hash(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())[..8].to_string()
}

fn base64_decode(input: &str) -> DbResult<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| DbError::Validation(format!("invalid legacy base64: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn corrupt_vault_is_quarantined_and_recovers_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        // Typical torn write: truncated JSON.
        fs::write(&path, b"{\"version\": 2, \"entries\": {\"ai").unwrap();

        let vault = SecretVault::open(&path).expect("corrupt vault must not fail open");
        let loaded = vault.load().unwrap();
        assert_eq!(loaded.version, 2);
        assert!(loaded.entries.is_empty());
        assert_eq!(vault.get_secret_by_ref("kv:any:ref").unwrap(), None);

        let names = dir_names(dir.path());
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.contains(&"vault.json".to_string()));
        let quarantined = names
            .iter()
            .find(|n| n.starts_with("vault.json.corrupt-"))
            .expect("corrupt file moved aside");
        assert_eq!(
            fs::read(dir.path().join(quarantined)).unwrap(),
            b"{\"version\": 2, \"entries\": {\"ai"
        );
    }

    #[test]
    fn empty_vault_file_is_quarantined() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        fs::write(&path, b"").unwrap();
        let vault = SecretVault::open(&path).unwrap();
        assert!(vault.load().unwrap().entries.is_empty());
        assert!(dir_names(dir.path())
            .iter()
            .any(|n| n.starts_with("vault.json.corrupt-")));
    }

    #[test]
    fn valid_vault_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        let json = br#"{"version":2,"entries":{"openai":{"ref_id":"kv:1:2","updated_at":"t"}}}"#;
        fs::write(&path, json).unwrap();
        let vault = SecretVault::open(&path).unwrap();
        assert_eq!(vault.load().unwrap().entries.len(), 1);
        assert_eq!(dir_names(dir.path()), vec!["vault.json".to_string()]);
        assert_eq!(fs::read(&path).unwrap(), json);
    }

    #[test]
    fn atomic_store_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        let vault = SecretVault::open(&path).unwrap();
        for i in 0..5 {
            let mut file = vault.load().unwrap();
            file.entries.insert(
                format!("name-{i}"),
                VaultEntry {
                    ref_id: format!("kv:{i}"),
                    updated_at: "t".into(),
                    secret_b64: None,
                },
            );
            vault.store(&file).unwrap();
        }
        assert_eq!(vault.load().unwrap().entries.len(), 5);
        assert_eq!(dir_names(dir.path()), vec!["vault.json".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_store_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        let vault = SecretVault::open(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        vault
            .store(&VaultFile {
                version: 2,
                entries: HashMap::new(),
            })
            .unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn legacy_migration_failure_does_not_fail_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vault.json");
        let json = br#"{"version":1,"entries":{"x":{"ref_id":"kv:1","updated_at":"t","secret_b64":"!!not base64!!"}}}"#;
        fs::write(&path, json).unwrap();
        SecretVault::open(&path).expect("bad legacy entry must not brick startup");
        // Left untouched for a retry next launch.
        assert_eq!(fs::read(&path).unwrap(), json);
    }
}
