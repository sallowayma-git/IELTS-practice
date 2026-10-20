//! Bridge the published weekly snapshot's divergent migrations 31-33.
//! Identify history before touching structure; never guess from MAX(version).
use rusqlite::{params, Connection};

use crate::sqlite::{DbError, DbResult};

const LOCAL_NAMES: [&str; 3] = [
    "practice_assets_question_kinds",
    "reading_matching_subtypes",
    "soul",
];

pub(super) fn validate_history(conn: &Connection) -> DbResult<bool> {
    let mut statement =
        conn.prepare("SELECT version, name FROM schema_migrations ORDER BY version")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut local = false;
    for (index, row) in rows.enumerate() {
        let (version, name) = row?;
        let expected = super::migrations().get(index).ok_or_else(|| {
            DbError::Migration(format!(
                "database migration {version} is newer than this build"
            ))
        })?;
        let is_local = (31..=33).contains(&version) && name == LOCAL_NAMES[(version - 31) as usize];
        if version != expected.version || (version >= 31 && name != expected.name && !is_local) {
            return Err(DbError::Migration(format!(
                "unrecognized migration history at {version}: {name}"
            )));
        }
        if (31..=33).contains(&version) && version > 31 && is_local != local {
            return Err(DbError::Migration(
                "mixed weekly snapshot migration history".into(),
            ));
        }
        local |= is_local;
    }
    if local {
        require_column(conn, "practice_assets", "question_kinds_json", true)?;
        require_column(conn, "coach_threads", "learner_profile_json", false)?;
        if super::current_version(conn)? == 33 {
            require_column(conn, "soul_revisions", "reverts_id", true)?;
        }
    } else if super::current_version(conn)? >= 31 {
        require_column(conn, "coach_threads", "learner_profile_json", true)?;
    }
    Ok(local)
}

fn require_column(conn: &Connection, table: &str, column: &str, present: bool) -> DbResult<()> {
    if has_column(conn, table, column)? != present {
        return Err(DbError::Migration(format!(
            "migration history disagrees with {table}.{column}"
        )));
    }
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> DbResult<bool> {
    // Both identifiers are internal constants, never user input.
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for name in columns {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn reconcile(conn: &mut Connection) -> DbResult<Vec<i64>> {
    if !validate_history(conn)? {
        return Ok(Vec::new());
    }
    let tx = conn.transaction()?;
    let history: String = tx.query_row(
        "SELECT json_group_array(json_object('version', version, 'name', name, 'appliedAt', applied_at))
           FROM (SELECT * FROM schema_migrations WHERE version >= 31 ORDER BY version)",
        [], |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO migration_meta(key, value) VALUES ('weekly_snapshot.original_migrations', ?1)",
        params![history],
    )?;
    // All three remote migrations are replay-safe here: the profile column is
    // known absent, skill additions use OR IGNORE, and cleanup uses IF EXISTS.
    tx.execute("DELETE FROM schema_migrations WHERE version >= 31", [])?;
    let mut applied = Vec::new();
    for migration in super::migrations()
        .iter()
        .filter(|m| (31..=33).contains(&m.version))
    {
        tx.execute_batch(migration.sql)?;
        super::record(&tx, migration)?;
        applied.push(migration.version);
    }
    tx.commit()?;
    Ok(applied)
}

pub(super) fn add_question_kinds(conn: &Connection) -> DbResult<()> {
    if !has_column(conn, "practice_assets", "question_kinds_json")? {
        conn.execute_batch("ALTER TABLE practice_assets ADD COLUMN question_kinds_json TEXT CHECK(question_kinds_json IS NULL OR json_valid(question_kinds_json));")?;
    }
    Ok(())
}
