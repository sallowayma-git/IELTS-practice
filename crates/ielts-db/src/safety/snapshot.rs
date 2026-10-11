//! Pre-destructive snapshots.
//!
//! Before an operation that rewrites or erases user data, the caller takes a
//! whole-database snapshot with `VACUUM INTO` and aborts the operation if the
//! snapshot fails (fail closed). There is deliberately no periodic backup: a
//! snapshot exists to answer "what was there just before that happened".
//!
//! Files are `pre-<op>-<unix-ms>.db` in the app's `backups` directory. Only the
//! newest [`SNAPSHOT_KEEP`] are kept, whatever the operation; user-made JSON
//! backups in the same directory are never touched (the pattern does not match
//! them). A snapshot is a plain SQLite database, restorable by copying it over
//! the live file while the app is closed.
//!
//! The snapshot is written to `<name>.db.tmp`, verified, flushed and then
//! renamed, so a `pre-*.db` file is always a complete database.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::sqlite::{DbError, DbResult};

/// How many pre-destructive snapshots are kept.
pub const SNAPSHOT_KEEP: usize = 3;

const PREFIX: &str = "pre-";
const SUFFIX: &str = ".db";
const TMP_SUFFIX: &str = ".db.tmp";

/// Snapshot `conn`'s database into `dir` for the operation named `op`
/// (lowercase letters, digits and `-`). Returns the snapshot path.
///
/// Must be called outside a transaction (`VACUUM` cannot run inside one); the
/// snapshot is of committed state.
pub fn snapshot_before(conn: &Connection, dir: &Path, op: &str) -> DbResult<PathBuf> {
    if op.is_empty()
        || op.len() > 32
        || !op
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(DbError::Validation(format!("invalid snapshot name {op:?}")));
    }
    if !conn.is_autocommit() {
        return Err(DbError::Message(
            "a snapshot cannot be taken inside a transaction".into(),
        ));
    }
    fs::create_dir_all(dir)?;

    let stamp = chrono::Utc::now().timestamp_millis();
    let name = format!("{PREFIX}{op}-{stamp}");
    let target = dir.join(format!("{name}{SUFFIX}"));
    let temp = dir.join(format!("{name}{TMP_SUFFIX}"));
    if target.exists() || temp.exists() {
        return Err(DbError::Message(format!(
            "snapshot {name} already exists; refusing to overwrite it"
        )));
    }

    let result = write_snapshot(conn, &temp, &target);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
        remove_sidecars(&temp);
    }
    result?;
    // The snapshot is on disk and verified; failing to tidy old ones must not
    // turn a successful safety copy into an error.
    if let Err(error) = rotate(dir) {
        tracing::warn!(%error, "snapshot rotation failed; the new snapshot is kept");
    }
    Ok(target)
}

fn write_snapshot(conn: &Connection, temp: &Path, target: &Path) -> DbResult<()> {
    let temp_str = temp
        .to_str()
        .ok_or_else(|| DbError::Message("snapshot path is not valid UTF-8".into()))?;
    conn.execute("VACUUM INTO ?1", [temp_str])?;
    verify(conn, temp)?;
    // The data must be on disk before the name says it is a snapshot.
    fs::OpenOptions::new().write(true).open(temp)?.sync_all()?;
    remove_sidecars(temp);
    fs::rename(temp, target)?;
    Ok(())
}

/// The snapshot must open and describe the same schema version and attempt
/// count as the database it was taken from.
fn verify(source: &Connection, snapshot: &Path) -> DbResult<()> {
    let probe = Connection::open_with_flags(snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count = |conn: &Connection| -> DbResult<(i64, i64)> {
        Ok((
            conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )?,
            conn.query_row("SELECT COUNT(*) FROM attempts", [], |row| row.get(0))
                .unwrap_or(0),
        ))
    };
    if count(source)? != count(&probe)? {
        return Err(DbError::Message(
            "snapshot verification failed: it does not match the database it was taken from".into(),
        ));
    }
    Ok(())
}

fn remove_sidecars(path: &Path) {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar = path.as_os_str().to_owned();
        sidecar.push(suffix);
        let _ = fs::remove_file(PathBuf::from(sidecar));
    }
}

/// `pre-<op>-<unix-ms>.db` -> (`op`, stamp).
fn op_and_stamp_of(file_name: &str) -> Option<(String, i64)> {
    let stem = file_name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    let (op, stamp) = stem.rsplit_once('-')?;
    Some((op.to_string(), stamp.parse().ok()?))
}

/// Keep the newest [`SNAPSHOT_KEEP`] snapshots of each operation; drop older ones
/// and any half-written `.tmp` left behind by a crash. Rotation is per operation,
/// so a flood of `clear-history` copies can never evict the only `pre-migrate`
/// copy. Files that do not match the naming pattern are never touched.
fn rotate(dir: &Path) -> DbResult<()> {
    let mut by_op: std::collections::BTreeMap<String, Vec<(i64, PathBuf)>> =
        std::collections::BTreeMap::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(PREFIX) && name.ends_with(TMP_SUFFIX) {
            let _ = fs::remove_file(entry.path());
        } else if let Some((op, stamp)) = op_and_stamp_of(&name) {
            by_op.entry(op).or_default().push((stamp, entry.path()));
        }
    }
    let mut first_error = None;
    for snapshots in by_op.values_mut() {
        snapshots.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in snapshots.iter().skip(SNAPSHOT_KEEP) {
            if let Err(error) = fs::remove_file(path) {
                first_error.get_or_insert(DbError::Io(error));
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_names_split_into_operation_and_stamp() {
        assert_eq!(
            op_and_stamp_of("pre-clear-history-1760000000123.db"),
            Some(("clear-history".to_string(), 1760000000123))
        );
        assert_eq!(op_and_stamp_of("pre-migrate.db"), None);
    }

    #[test]
    fn only_snapshot_names_have_a_stamp() {
        let stamp = |name: &str| op_and_stamp_of(name).map(|(_, stamp)| stamp);
        assert_eq!(stamp("pre-restore-1760000000123.db"), Some(1760000000123));
        assert_eq!(stamp("pre-clear-history-5.db"), Some(5));
        for other in [
            "ielts-backup-20261005-101010.json",
            "pre-restore-1760000000123.db.tmp",
            "pre-restore.db",
            "restore-1.db",
        ] {
            assert_eq!(stamp(other), None, "{other}");
        }
    }
}
