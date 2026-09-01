use std::path::Path;

use serde_json::Value;

use crate::reading::{
    import_reading_archive_value as import_canonical_reading_archive, ReadingArchiveImportResult,
};
use crate::sqlite::{DbError, DbResult};
use rusqlite::Connection;

/// Compatibility name for migration callers. Product code uses
/// `ReadingArchiveImportResult` from `reading::archive` directly.
pub type ImportReport = ReadingArchiveImportResult;

pub fn import_reading_archive_value(conn: &Connection, doc: &Value) -> DbResult<ImportReport> {
    import_canonical_reading_archive(conn, doc)
}

pub fn import_reading_archive_file(conn: &Connection, path: &Path) -> DbResult<ImportReport> {
    let text = std::fs::read_to_string(path)?;
    let doc: Value = serde_json::from_str(&text).map_err(|e| DbError::Import(e.to_string()))?;
    import_reading_archive_value(conn, &doc)
}
