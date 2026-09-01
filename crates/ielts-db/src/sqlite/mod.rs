use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("import error: {0}")]
    Import(String),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("{0}")]
    Message(String),
}

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, Clone)]
pub struct DbOpenOptions {
    pub path: PathBuf,
    pub create: bool,
    pub read_only: bool,
    pub busy_timeout_ms: u32,
    pub enable_wal: bool,
}

impl DbOpenOptions {
    pub fn create(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            create: true,
            read_only: false,
            busy_timeout_ms: 5_000,
            enable_wal: true,
        }
    }

    pub fn read_only(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            create: false,
            read_only: true,
            busy_timeout_ms: 5_000,
            enable_wal: false,
        }
    }
}

pub fn open_connection(opts: &DbOpenOptions) -> DbResult<Connection> {
    if let Some(parent) = opts.path.parent() {
        if opts.create {
            std::fs::create_dir_all(parent)?;
        }
    }

    let mut flags = OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI;
    if opts.read_only {
        flags |= OpenFlags::SQLITE_OPEN_READ_ONLY;
    } else {
        flags |= OpenFlags::SQLITE_OPEN_READ_WRITE;
        if opts.create {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
    }

    let conn = Connection::open_with_flags(&opts.path, flags)?;
    conn.busy_timeout(std::time::Duration::from_millis(
        opts.busy_timeout_ms as u64,
    ))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    if !opts.read_only {
        conn.execute_batch("PRAGMA secure_delete = FAST;")?;
    }
    if opts.enable_wal && !opts.read_only {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    }
    Ok(conn)
}

pub fn checkpoint_wal(conn: &Connection) -> DbResult<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

pub fn backup_file(src: &Path, dest: &Path) -> DbResult<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(src, dest)?;
    Ok(())
}
