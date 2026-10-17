use std::sync::OnceLock;

use rusqlite::Connection;

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
    /// Set when the migration rebuilds a table that other tables reference
    /// (DROP + RENAME). SQLite's DROP TABLE performs an implicit DELETE while
    /// foreign keys are enforced, which would cascade into the children, so the
    /// runner switches enforcement off around such a migration (the pragma is a
    /// no-op inside a transaction) and runs `PRAGMA foreign_key_check` on the
    /// named table before committing. See 0028.
    pub rebuilds: Option<&'static str>,
}

fn migrations() -> &'static [Migration] {
    static MIGRATIONS: OnceLock<Vec<Migration>> = OnceLock::new();
    MIGRATIONS.get_or_init(|| {
        vec![
            Migration {
                version: 1,
                name: "v2_core",
                sql: include_str!("../../migrations/0001_v2_core.sql"),
                rebuilds: None,
            },
            Migration {
                version: 2,
                name: "writing_eval_sessions",
                sql: include_str!("../../migrations/0002_writing_eval_sessions.sql"),
                rebuilds: None,
            },
            Migration {
                version: 3,
                name: "eval_lineage_multi",
                sql: include_str!("../../migrations/0003_eval_lineage_multi.sql"),
                rebuilds: None,
            },
            Migration {
                version: 4,
                name: "modes_timer",
                sql: include_str!("../../migrations/0004_modes_timer.sql"),
                rebuilds: None,
            },
            Migration {
                version: 5,
                name: "annotations_vocab_coach",
                sql: include_str!("../../migrations/0005_annotations_vocab_coach.sql"),
                rebuilds: None,
            },
            Migration {
                version: 6,
                name: "writing_topics",
                sql: include_str!("../../migrations/0006_writing_topics.sql"),
                rebuilds: None,
            },
            Migration {
                version: 7,
                name: "attempt_writing_task_type",
                sql: include_str!("../../migrations/0007_attempt_writing_task_type.sql"),
                rebuilds: None,
            },
            Migration {
                version: 8,
                name: "history_retention_policy",
                sql: include_str!("../../migrations/0008_history_retention_policy.sql"),
                rebuilds: None,
            },
            Migration {
                version: 9,
                name: "writing_prompt_policy",
                sql: include_str!("../../migrations/0009_writing_prompt_policy.sql"),
                rebuilds: None,
            },
            Migration {
                version: 10,
                name: "reading_timer_states",
                sql: include_str!("../../migrations/0010_reading_timer_states.sql"),
                rebuilds: None,
            },
            Migration {
                version: 11,
                name: "agent_runs_tool_calls",
                sql: include_str!("../../migrations/0011_agent_runs_tool_calls.sql"),
                rebuilds: None,
            },
            Migration {
                version: 12,
                name: "learning_event_ledger",
                sql: include_str!("../../migrations/0012_learning_event_ledger.sql"),
                rebuilds: None,
            },
            Migration {
                version: 13,
                name: "learning_observation_projection",
                sql: include_str!("../../migrations/0013_learning_observation_projection.sql"),
                rebuilds: None,
            },
            Migration {
                version: 14,
                name: "memory_profile_core",
                sql: include_str!("../../migrations/0014_memory_profile_core.sql"),
                rebuilds: None,
            },
            Migration {
                version: 15,
                name: "learner_model_v1",
                sql: include_str!("../../migrations/0015_learner_model_v1.sql"),
                rebuilds: None,
            },
            Migration {
                version: 16,
                name: "context_retrieval_trace",
                sql: include_str!("../../migrations/0016_context_retrieval_trace.sql"),
                rebuilds: None,
            },
            Migration {
                version: 17,
                name: "coach_learning_feedback",
                sql: include_str!("../../migrations/0017_coach_learning_feedback.sql"),
                rebuilds: None,
            },
            Migration {
                version: 18,
                name: "daily_journal_jobs",
                sql: include_str!("../../migrations/0018_daily_journal_jobs.sql"),
                rebuilds: None,
            },
            Migration {
                version: 19,
                name: "memory_consolidation_v1",
                sql: include_str!("../../migrations/0019_memory_consolidation_v1.sql"),
                rebuilds: None,
            },
            Migration {
                version: 20,
                name: "teaching_strategy_evolution",
                sql: include_str!("../../migrations/0020_teaching_strategy_evolution.sql"),
                rebuilds: None,
            },
            Migration {
                version: 21,
                name: "prompt_skill_evolution",
                sql: include_str!("../../migrations/0021_prompt_skill_evolution.sql"),
                rebuilds: None,
            },
            Migration {
                version: 22,
                name: "agent_threads_planner",
                sql: include_str!("../../migrations/0022_agent_threads_planner.sql"),
                rebuilds: None,
            },
            Migration {
                version: 23,
                name: "strategy_candidate_eval_gate",
                sql: include_str!("../../migrations/0023_strategy_candidate_eval_gate.sql"),
                rebuilds: None,
            },
            Migration {
                version: 24,
                name: "coach_outcome_link_fk_fix",
                sql: include_str!("../../migrations/0024_coach_outcome_link_fk_fix.sql"),
                rebuilds: None,
            },
            Migration {
                version: 25,
                name: "prompt_release_predecessor",
                sql: include_str!("../../migrations/0025_prompt_release_predecessor.sql"),
                rebuilds: None,
            },
            Migration {
                version: 26,
                name: "attempt_asset_revision",
                sql: include_str!("../../migrations/0026_attempt_asset_revision.sql"),
                rebuilds: None,
            },
            Migration {
                version: 27,
                name: "history_retention_unlimited_default",
                sql: include_str!("../../migrations/0027_history_retention_unlimited_default.sql"),
                rebuilds: None,
            },
            Migration {
                version: 28,
                name: "ledger_restrict_attempt_delete",
                sql: include_str!("../../migrations/0028_ledger_restrict_attempt_delete.sql"),
                rebuilds: Some("learning_events"),
            },
            Migration {
                version: 29,
                name: "weekly_digests",
                sql: include_str!("../../migrations/0029_weekly_digests.sql"),
                rebuilds: None,
            },
            Migration {
                version: 30,
                name: "raw_data_delete_gate",
                sql: include_str!("../../migrations/0030_raw_data_delete_gate.sql"),
                rebuilds: None,
            },
            Migration {
                version: 31,
                name: "coach_thread_learner_profile",
                sql: include_str!("../../migrations/0031_coach_thread_learner_profile.sql"),
                rebuilds: None,
            },
            Migration {
                version: 32,
                name: "reading_matching_skills",
                sql: include_str!("../../migrations/0032_reading_matching_skills.sql"),
                rebuilds: None,
            },
        ]
    })
}

pub fn current_version(conn: &Connection) -> DbResult<i64> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )?;
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    Ok(version)
}

/// The schema version this build migrates to.
pub fn latest_version() -> i64 {
    migrations().last().map_or(0, |migration| migration.version)
}

/// Whether an existing database (version > 0) is behind this build. A brand new
/// database is not "pending": there is nothing in it to protect.
pub fn has_pending_migrations(conn: &Connection) -> DbResult<bool> {
    let version = current_version(conn)?;
    Ok(version > 0 && version < latest_version())
}

/// Apply all pending migrations inside individual transactions.
pub fn migrate(conn: &mut Connection) -> DbResult<Vec<i64>> {
    let mut applied = Vec::new();
    let mut version = current_version(conn)?;
    for migration in migrations() {
        if migration.version <= version {
            continue;
        }
        if migration.version != version + 1 {
            return Err(DbError::Migration(format!(
                "migration gap: have {version}, next {}",
                migration.version
            )));
        }
        apply(conn, migration)?;
        applied.push(migration.version);
        version = migration.version;
    }
    // The v9 table has to exist before this data-preserving bridge runs. SQL
    // migrations cannot safely normalize every historical prompt payload, so
    // the Rust aggregate converts valid rows while retaining the original
    // settings bytes as a recoverable one-time migration source.
    if version >= 9 {
        crate::writing::migrate_legacy_writing_prompts(conn)?;
    }
    // Digests written before 0029 live in `settings`; move them to their table.
    // Idempotent: a current database has no such rows.
    if version >= 29 {
        let tx = conn.transaction()?;
        crate::dream::move_settings_weekly_digests_in_transaction(&tx)?;
        tx.commit()?;
    }
    // The delete gate is only ever opened inside a savepoint that is restored
    // before the transaction ends, so it cannot be persisted open. Starting
    // from a known-closed state anyway costs one statement and removes the
    // question.
    if version >= 30 {
        crate::safety::close_delete_gate(conn)?;
    }
    Ok(applied)
}

/// Like [`migrate`], but first writes a `VACUUM INTO` snapshot of an existing
/// database that is about to be migrated, into `snapshot_dir`. A migration
/// rewrites the user's file in place; if the snapshot cannot be taken the
/// migration does not run (fail closed) and the error says why.
pub fn migrate_with_snapshot(
    conn: &mut Connection,
    snapshot_dir: &std::path::Path,
) -> DbResult<Vec<i64>> {
    if has_pending_migrations(conn)? {
        crate::safety::snapshot_before(conn, snapshot_dir, "migrate").map_err(|error| {
            DbError::Migration(format!(
                "could not snapshot the database before migrating it, so it was left untouched: {error}"
            ))
        })?;
    }
    migrate(conn)
}

fn apply(conn: &mut Connection, migration: &Migration) -> DbResult<()> {
    let Some(table) = migration.rebuilds else {
        return run_in_transaction(conn, migration);
    };
    let enforced: bool = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let off: bool = conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0).map(|v| v == 0))?;
    let result = if off {
        run_in_transaction_checked(conn, migration, table)
    } else {
        Err(DbError::Migration(format!(
            "migration {} rebuilds {table} and needs foreign key enforcement off, which cannot be changed here",
            migration.version
        )))
    };
    if enforced {
        // Restore even when the migration failed: a connection must never come
        // back from a failed migration with enforcement silently disabled.
        conn.execute_batch("PRAGMA foreign_keys = ON")?;
    }
    result
}

fn run_in_transaction(conn: &mut Connection, migration: &Migration) -> DbResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(migration.sql)?;
    record(&tx, migration)?;
    tx.commit()?;
    Ok(())
}

/// Child tables whose foreign keys reference a rebuilt table. SQLite's check
/// for the rebuilt table covers only its own outgoing keys, so these are checked
/// explicitly.
fn rebuilt_children(table: &str) -> &'static [&'static str] {
    match table {
        "learning_events" => &["learner_observation_evidence", "learner_skill_observations"],
        _ => &[],
    }
}

fn row_count(conn: &Connection, table: &str) -> DbResult<i64> {
    Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?)
}

fn foreign_key_violations(conn: &Connection, table: &str) -> DbResult<i64> {
    let mut stmt = conn.prepare(&format!("PRAGMA foreign_key_check({table})"))?;
    let violations = stmt.query_map([], |_| Ok(()))?.count() as i64;
    Ok(violations)
}

fn run_in_transaction_checked(
    conn: &mut Connection,
    migration: &Migration,
    table: &str,
) -> DbResult<()> {
    let tx = conn.transaction()?;
    let before = row_count(&tx, table)?;
    tx.execute_batch(migration.sql)?;
    let after = row_count(&tx, table)?;
    if before != after {
        return Err(DbError::Migration(format!(
            "migration {} changed {table} from {before} to {after} rows; nothing was changed",
            migration.version
        )));
    }
    let mut violations = foreign_key_violations(&tx, table)?;
    for child in rebuilt_children(table) {
        violations += foreign_key_violations(&tx, child)?;
    }
    if violations > 0 {
        return Err(DbError::Migration(format!(
            "migration {} left {violations} foreign key violation(s) around {table}; nothing was changed",
            migration.version
        )));
    }
    record(&tx, migration)?;
    tx.commit()?;
    Ok(())
}

fn record(tx: &rusqlite::Transaction<'_>, migration: &Migration) -> DbResult<()> {
    tx.execute(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            migration.version,
            migration.name,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

/// Re-run migrate on a fresh connection to assert idempotency.
pub fn verify_idempotent(conn: &mut Connection) -> DbResult<()> {
    let before = current_version(conn)?;
    let applied = migrate(conn)?;
    if !applied.is_empty() {
        return Err(DbError::Migration(format!(
            "expected no migrations, applied {applied:?}"
        )));
    }
    let after = current_version(conn)?;
    if before != after {
        return Err(DbError::Migration(format!(
            "version changed on idempotent verify: {before} -> {after}"
        )));
    }
    Ok(())
}

pub fn open_and_migrate(path: impl AsRef<std::path::Path>) -> DbResult<Connection> {
    let mut conn = crate::sqlite::open_connection(&crate::sqlite::DbOpenOptions::create(
        path.as_ref().to_path_buf(),
    ))?;
    migrate(&mut conn)?;
    Ok(conn)
}
