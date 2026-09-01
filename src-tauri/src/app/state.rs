use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use ielts_db::{migrate, open_connection, DbOpenOptions, DbResult, SecretVault};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data: PathBuf,
    pub logs: PathBuf,
    pub backups: PathBuf,
    pub imports: PathBuf,
    pub exports: PathBuf,
    pub diagnostics: PathBuf,
    pub db_dir: PathBuf,
    pub legacy_candidates: Vec<PathBuf>,
}

impl AppPaths {
    pub fn discover() -> Self {
        let app_data = default_app_data_dir();
        let logs = app_data.join("logs");
        let backups = app_data.join("backups");
        let imports = app_data.join("imports");
        let exports = app_data.join("exports");
        let diagnostics = app_data.join("diagnostics");
        let db_dir = app_data.join("db");
        let legacy_candidates = discover_legacy_dirs();

        Self {
            app_data,
            logs,
            backups,
            imports,
            exports,
            diagnostics,
            db_dir,
            legacy_candidates,
        }
    }

    pub fn ensure_layout(&self) -> std::io::Result<()> {
        for dir in [
            &self.app_data,
            &self.logs,
            &self.backups,
            &self.imports,
            &self.exports,
            &self.diagnostics,
            &self.db_dir,
        ] {
            fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    pub fn v2_db_path(&self) -> PathBuf {
        self.db_dir.join("ielts-practice-v2.db")
    }

    pub fn vault_path(&self) -> PathBuf {
        self.app_data.join("secrets").join("vault.json")
    }
}

/// Process-local SQLite handle. Commands take short-lived locks.
pub struct AppDb {
    conn: Mutex<rusqlite::Connection>,
    pub path: PathBuf,
}

impl AppDb {
    pub fn open(paths: &AppPaths) -> DbResult<Self> {
        paths.ensure_layout().map_err(ielts_db::DbError::Io)?;
        let path = paths.v2_db_path();
        let mut conn = open_connection(&DbOpenOptions::create(&path))?;
        migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&rusqlite::Connection) -> DbResult<T>,
    ) -> DbResult<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| ielts_db::DbError::Message("db lock poisoned".into()))?;
        f(&guard)
    }

    #[cfg(test)]
    pub(crate) fn from_test_connection(conn: rusqlite::Connection, path: PathBuf) -> Self {
        Self {
            conn: Mutex::new(conn),
            path,
        }
    }
}

pub struct AppVault(pub SecretVault);

impl AppVault {
    pub fn open(paths: &AppPaths) -> DbResult<Self> {
        Ok(Self(SecretVault::open(paths.vault_path())?))
    }
}

fn default_app_data_dir() -> PathBuf {
    if let Some(base) = std::env::var_os("APPDATA") {
        return PathBuf::from(base).join("IELTS Practice");
    }
    if let Some(base) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(base).join("ielts-practice");
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("IELTS Practice");
    }
    std::env::temp_dir().join("ielts-practice")
}

/// Locate historical Electron / browser data directories without migrating them.
pub fn discover_legacy_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut push_if_exists = |path: PathBuf| {
        if path.exists() && !out.iter().any(|p| p == &path) {
            out.push(path);
        }
    };

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let base = PathBuf::from(appdata);
        push_if_exists(base.join("IELTS Practice"));
        push_if_exists(base.join("ielts-practice"));
        push_if_exists(base.join("ielts-writing"));
        push_if_exists(base.join("ielts-practice-app"));
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        push_if_exists(
            home.join("Library")
                .join("Application Support")
                .join("IELTS Practice"),
        );
        push_if_exists(
            home.join("Library")
                .join("Application Support")
                .join("ielts-practice"),
        );
        push_if_exists(home.join(".config").join("ielts-practice"));
        push_if_exists(home.join(".config").join("IELTS Practice"));
    }

    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local);
        push_if_exists(base.join("IELTS Practice"));
        push_if_exists(base.join("ielts-practice"));
    }

    out
}
