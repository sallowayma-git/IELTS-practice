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
    pub fn open(path: impl Into<PathBuf>) -> DbResult<Self> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if !path.exists() {
            let json = serde_json::to_vec_pretty(&VaultFile {
                version: 2,
                entries: HashMap::new(),
            })
            .map_err(|e| DbError::Message(e.to_string()))?;
            fs::write(&path, json)?;
        }
        let vault = Self { path };
        vault.migrate_legacy_file()?;
        Ok(vault)
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
        fs::write(&self.path, json)?;
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
