use std::sync::OnceLock;

use rusqlite::Connection;

use crate::sqlite::{DbError, DbResult};

mod snapshot;

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
            Migration {
                version: 33,
                name: "drop_dead_evolution_tables",
                sql: include_str!("../../migrations/0033_drop_dead_evolution_tables.sql"),
                rebuilds: None,
            },
            Migration {
                version: 34,
                name: "snapshot_compatibility",
                sql: include_str!("../../migrations/0034_snapshot_compatibility.sql"),
                rebuilds: None,
            },
            Migration {
                version: 35,
                name: "soul",
                sql: include_str!("../../migrations/0035_soul.sql"),
                rebuilds: None,
            },
            Migration {
                version: 36,
                name: "vocabulary_sm2_state",
                sql: include_str!("../../migrations/0036_vocabulary_sm2_state.sql"),
                rebuilds: Some("vocabulary_review_state"),
            },
            Migration {
                version: 37,
                name: "writing_skills",
                sql: include_str!("../../migrations/0037_writing_skills.sql"),
                rebuilds: None,
            },
            Migration {
                version: 38,
                name: "practice_assets_activity_scope",
                sql: include_str!("../../migrations/0038_practice_assets_activity_scope.sql"),
                rebuilds: Some("practice_assets"),
            },
            Migration {
                version: 39,
                name: "attempts_activity_scope",
                sql: include_str!("../../migrations/0039_attempts_activity_scope.sql"),
                rebuilds: Some("attempts"),
            },
            Migration {
                version: 40,
                name: "listening_skills",
                sql: include_str!("../../migrations/0040_listening_skills.sql"),
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
    snapshot::validate_history(conn)?;
    Ok(version > 0 && version < latest_version())
}

/// Apply all pending migrations inside individual transactions.
pub fn migrate(conn: &mut Connection) -> DbResult<Vec<i64>> {
    current_version(conn)?;
    let mut applied = snapshot::reconcile(conn)?;
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
    if version >= 34 {
        crate::reading::backfill_question_kinds(conn)?;
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
    if migration.version == 34 {
        snapshot::add_question_kinds(&tx)?;
    }
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
        "practice_assets" => &["attempts", "writing_topics"],
        // writing_evaluations_v2 was renamed away in 0003, so it is not a child.
        "attempts" => &[
            "attempt_answers",
            "attempt_annotations",
            "writing_evaluations",
            "writing_drafts",
            "attempt_idempotency",
            "evaluation_sessions",
            "learning_events",
        ],
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

#[cfg(test)]
mod tests {
    use super::*;

    fn history_at(version: i64) -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        current_version(&conn).unwrap();
        for migration in migrations().iter().filter(|m| m.version <= version) {
            apply(&mut conn, migration).unwrap();
        }
        conn
    }

    #[test]
    fn vocabulary_v35_upgrade_preserves_rows_and_delete_protection() {
        use rusqlite::types::Value;
        fn rows(conn: &Connection, sql: &str) -> Vec<Vec<Value>> {
            let mut stmt = conn.prepare(sql).unwrap();
            let width = stmt.column_count();
            stmt.query_map([], |row| (0..width).map(|col| row.get(col)).collect())
                .unwrap().collect::<rusqlite::Result<_>>().unwrap()
        }
        let mut conn = history_at(35);
        conn.execute_batch("INSERT INTO vocabulary_items(id,term,normalized_term,created_at,updated_at)
            VALUES ('new','New','new','created','updated'),('reviewed','Reviewed','reviewed','created','updated');
            INSERT INTO vocabulary_review_state VALUES ('new',2.9,0,0,'2026-11-12T00:00:00Z',NULL,0),
                ('reviewed',2.7,8,3,'2026-11-20T00:00:00Z','2026-11-12T00:00:00Z',2);").unwrap();
        let words = rows(&conn, "SELECT * FROM vocabulary_items ORDER BY id");
        let expected = rows(&conn, "SELECT item_id, CASE WHEN last_reviewed_at IS NULL THEN NULL ELSE ease END,
            interval_days,repetitions,0,0,lapses,due_at,last_reviewed_at FROM vocabulary_review_state ORDER BY item_id");
        let trigger: String = conn.query_row("SELECT sql FROM sqlite_master WHERE name='trg_delete_gate_vocabulary_review_state'",
            [], |row| row.get(0)).unwrap();
        assert_eq!(migrate(&mut conn).unwrap(), vec![36, 37, 38, 39, 40]);
        assert_eq!(rows(&conn,"SELECT * FROM vocabulary_review_state ORDER BY item_id"), expected);
        assert_eq!(rows(&conn,"SELECT * FROM vocabulary_items ORDER BY id"), words);
        assert_eq!(conn.query_row("SELECT sql FROM sqlite_master WHERE name='trg_delete_gate_vocabulary_review_state'",
            [], |row| row.get::<_,String>(0)).unwrap(), trigger);
        assert!(conn.execute("DELETE FROM vocabulary_items WHERE id='new'",[]).is_err());
        assert!(conn.execute("DELETE FROM vocabulary_review_state WHERE item_id='new'",[]).is_err());
        assert!(conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_,bool>(0)).unwrap());
        assert_eq!(foreign_key_violations(&conn,"vocabulary_review_state").unwrap(),0);
        assert!(crate::vocab::delete_vocab(&conn,"new").unwrap());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM vocabulary_review_state WHERE item_id='new'",[], |r| r.get::<_,i64>(0)).unwrap(),0);
        verify_idempotent(&mut conn).unwrap();
    }

    fn local_history(version: i64) -> Connection {
        let mut conn = history_at(30);
        let local = [
            (31, "practice_assets_question_kinds", include_str!("../../../../developer/tests/fixtures/weekly-snapshot/0031_practice_assets_question_kinds.sql")),
            (32, "reading_matching_subtypes", include_str!("../../../../developer/tests/fixtures/weekly-snapshot/0032_reading_matching_subtypes.sql")),
            (33, "soul", include_str!("../../../../developer/tests/fixtures/weekly-snapshot/0033_soul.sql")),
        ];
        for (number, name, sql) in local.into_iter().filter(|(number, _, _)| *number <= version) {
            apply(&mut conn, &Migration {version: number, name, sql, rebuilds: None}).unwrap();
        }
        conn
    }

    #[test]
    fn both_published_histories_and_common_base_upgrade_without_losing_snapshot_audit() {
        let mut databases = vec![history_at(0), history_at(30), history_at(33)];
        databases.extend((31..=33).map(local_history));
        for mut conn in databases {
            let had_soul = current_version(&conn).unwrap() == 33
                && conn.query_row("SELECT name FROM schema_migrations WHERE version=33", [], |r|r.get::<_, String>(0)).unwrap() == "soul";
            if had_soul {
                conn.execute_batch("INSERT INTO soul_revisions VALUES ('audit', 'local', 'soul.tone', 'null', '\"warm\"', 'user', '[]', 'keep', NULL, NULL, 'now')").unwrap();
            }
            migrate(&mut conn).unwrap();
            assert_eq!(current_version(&conn).unwrap(), latest_version());
            conn.prepare("SELECT learner_profile_json FROM coach_threads").unwrap();
            conn.prepare("SELECT question_kinds_json FROM practice_assets").unwrap();
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM skill_catalog WHERE skill_key IN ('reading.matching', 'reading.matching_sentence_endings')", [], |r|r.get::<_,i64>(0)).unwrap(), 2);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name='prompt_skill_releases'", [], |r|r.get::<_,i64>(0)).unwrap(), 0);
            assert_eq!(conn.query_row("SELECT COUNT(*) FROM soul_revisions", [], |r|r.get::<_,i64>(0)).unwrap(), i64::from(had_soul));
            verify_idempotent(&mut conn).unwrap();
        }
    }

    #[test]
    fn snapshot_upgrade_takes_a_snapshot_and_rejects_unknown_or_mixed_history() {
        let mut conn = local_history(33);
        let directory = tempfile::tempdir().unwrap();
        assert!(has_pending_migrations(&conn).unwrap());
        migrate_with_snapshot(&mut conn, directory.path()).unwrap();
        let path = std::fs::read_dir(directory.path()).unwrap().next().unwrap().unwrap().path();
        let before = Connection::open(path).unwrap();
        assert_eq!(current_version(&before).unwrap(), 33);
        assert_eq!(before.query_row("SELECT name FROM schema_migrations WHERE version=33", [], |r|r.get::<_,String>(0)).unwrap(), "soul");
        before.prepare("SELECT * FROM prompt_skill_releases").unwrap();
        let original: String = conn.query_row("SELECT value FROM migration_meta WHERE key='weekly_snapshot.original_migrations'", [], |r|r.get(0)).unwrap();
        assert!(original.contains("practice_assets_question_kinds"));
        for name in ["unknown", "reading_matching_skills"] {
            let mut invalid = local_history(33);
            invalid.execute("UPDATE schema_migrations SET name=?1 WHERE version=32", [name]).unwrap();
            assert!(migrate(&mut invalid).is_err());
            assert_eq!(current_version(&invalid).unwrap(), 33);
            assert_eq!(invalid.query_row("SELECT name FROM schema_migrations WHERE version=31", [], |r|r.get::<_,String>(0)).unwrap(), "practice_assets_question_kinds");
        }
    }

    #[test]
    fn a_failed_bridge_rolls_back_structure_history_and_audit_marker() {
        let mut conn = local_history(33);
        // Force the last cleanup statement to fail after profile/skills changed.
        conn.execute_batch("DROP TABLE dream_candidates; CREATE VIEW dream_candidates AS SELECT 1;").unwrap();
        assert!(migrate(&mut conn).is_err());
        assert_eq!(conn.query_row("SELECT name FROM schema_migrations WHERE version=31", [], |r|r.get::<_,String>(0)).unwrap(), "practice_assets_question_kinds");
        assert!(conn.prepare("SELECT learner_profile_json FROM coach_threads").is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM migration_meta WHERE key='weekly_snapshot.original_migrations'", [], |r|r.get::<_,i64>(0)).unwrap(), 0);
    }

    #[test]
    fn migration_33_drops_a_prompt_release_chain_with_foreign_keys_on() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        current_version(&conn).unwrap();
        for migration in migrations().iter().filter(|m| m.version <= 32) {
            apply(&mut conn, migration).unwrap();
        }
        seed_release_chain(&conn);
        migrate(&mut conn).unwrap();
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'prompt_skill_releases'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    /// Only the self-reference matters here, so the chain is written with
    /// enforcement off and the candidate it names is left out.
    fn seed_release_chain(conn: &Connection) {
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO prompt_skill_releases
               (id, target_kind, parent_id, version_id, predecessor_version_id,
                predecessor_release_id, candidate_id, created_at)
             VALUES ('r1', 'prompt', 'tpl', 'v1', NULL, NULL, 'c1', 'now'),
                    ('r2', 'prompt', 'tpl', 'v2', 'v1', 'r1', 'c2', 'now');
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();
    }

    // ---------------------------------------------------------------------
    // W3-2 activity-scope migrations (38, 39, 40).
    // ---------------------------------------------------------------------

    use rusqlite::types::Value;

    /// Tables whose rows must survive the two table rebuilds, with a stable
    /// ordering key each. `SELECT *` is deliberate: the snapshot is compared
    /// column-by-column, so a changed column order fails too.
    const ACTIVITY_TABLES: &[(&str, &str)] = &[
        ("practice_assets", "id"),
        ("writing_topics", "asset_id"),
        ("attempts", "id"),
        ("attempt_answers", "attempt_id, question_id"),
        ("attempt_annotations", "id"),
        ("writing_evaluations", "id"),
        ("writing_drafts", "attempt_id"),
        ("attempt_idempotency", "scope, idempotency_key"),
        ("evaluation_sessions", "id"),
        ("learning_events", "id"),
        ("coach_threads", "id"),
        ("reading_suites", "id"),
        ("reading_suite_items", "suite_id, item_index"),
    ];

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn table_rows(conn: &Connection, table: &str, order: &str) -> Vec<Vec<Value>> {
        let mut stmt = conn
            .prepare(&format!("SELECT * FROM {table} ORDER BY {order}"))
            .unwrap();
        let width = stmt.column_count();
        stmt.query_map([], |row| (0..width).map(|col| row.get(col)).collect())
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn snapshot_activity_rows(conn: &Connection) -> Vec<(&'static str, Vec<Vec<Value>>)> {
        ACTIVITY_TABLES
            .iter()
            .map(|(table, order)| (*table, table_rows(conn, table, order)))
            .collect()
    }

    fn object_count(conn: &Connection, kind: &str, name: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = ?1 AND name = ?2",
            rusqlite::params![kind, name],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn foreign_key_check_count(conn: &Connection) -> i64 {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
        stmt.query_map([], |_| Ok(())).unwrap().count() as i64
    }

    fn foreign_key_children(conn: &Connection, parent: &str) -> Vec<String> {
        let mut tables_stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = tables_stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let mut children = Vec::new();
        for table in tables {
            let mut fk = conn
                .prepare(&format!("PRAGMA foreign_key_list({table})"))
                .unwrap();
            let parents: Vec<String> = fk
                .query_map([], |row| row.get(2))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            if parents.iter().any(|candidate| candidate == parent) {
                children.push(table);
            }
        }
        children
    }

    /// One reading asset, one writing asset/topic, a reading and a writing
    /// attempt, one row in every attempt child table, a coach thread, a suite
    /// item and a ledger event. Everything is FK-consistent so both the
    /// migration checks and the backup validator accept it.
    fn seed_activity_fixture(conn: &Connection) {
        conn.execute_batch(
            r#"
            INSERT INTO practice_assets (
              id, activity, source_kind, source_key, title, category, difficulty, frequency,
              content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at,
              updated_at, question_kinds_json
            ) VALUES
              ('asset-reading', 'reading', 'imported', 'reading:1', 'Reading One', 'P1', 'medium',
               'high', 'C:/fixtures/reading.json', 2, 'fp-reading', 0, '{"revision":2}',
               '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '["tfng","multi_choice"]'),
              ('asset-writing', 'writing', 'freeform', 'writing:1', 'Writing One', NULL, NULL,
               NULL, NULL, 2, 'fp-writing', 0, '{"taskType":"task2"}',
               '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL);

            INSERT INTO writing_topics (
              asset_id, task_type, title_json, image_path, is_official, created_at, updated_at
            ) VALUES (
              'asset-writing', 'task2', '{"type":"doc","content":[]}', NULL, 0,
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            );

            INSERT INTO reading_suites (
              id, mode, flow_mode, status, current_index, timer_policy_json, created_at,
              updated_at, frequency_scope, seed, aggregate_json, completed_at, timer_state_json
            ) VALUES (
              'suite-1', 'suite', 'linear', 'active', 0, '{"limitMs":3600000}',
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', 'all', 'seed-1',
              '{"correct":1}', NULL, '{"elapsedMs":1234,"running":true}'
            );

            INSERT INTO attempts (
              id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
              completed_at, duration_ms, score_value, score_scale, correct_count,
              question_count, title_snapshot, prompt_snapshot, content_text, schema_version,
              created_at, updated_at, task_type, submitted_asset_fingerprint
            ) VALUES
              ('r1', 'reading', 'asset-reading', 'suite', 'suite-1', 'completed',
               '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', '2026-01-01T00:10:00Z',
               600000, 1.0, 'ratio', 1.0, 1, 'Reading One', NULL, NULL, 2,
               '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', NULL, NULL),
              ('w1', 'writing', 'asset-writing', 'bank', NULL, 'completed',
               '2026-01-02T00:00:00Z', '2026-01-02T00:40:00Z', '2026-01-02T00:41:00Z',
               2400000, 7.0, 'band9', NULL, NULL, 'Writing One', 'Discuss both views',
               'Essay body', 2, '2026-01-02T00:00:00Z', '2026-01-02T00:41:00Z',
               'task2', 'fp-writing');

            INSERT INTO attempt_answers (
              attempt_id, question_id, answer_json, is_correct, weight, question_kind,
              change_count, visit_count, elapsed_ms, marked, answered_at
            ) VALUES ('r1', 'q1', '"A"', 1, 1.0, 'choice', 2, 3, 4567, 1,
                      '2026-01-01T00:09:00Z');

            INSERT INTO attempt_annotations (
              id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text,
              created_at, updated_at
            ) VALUES ('ann-1', 'r1', 'asset-reading', 'question', 'q1', 'note',
                      '{"start":2,"end":4}', 'why A?', '2026-01-01T00:05:00Z',
                      '2026-01-01T00:06:00Z');

            INSERT INTO writing_evaluations (
              id, attempt_id, status, stage, provider_id, model, rubric_version,
              prompt_version, result_json, degradation_json, error_json, started_at,
              completed_at, updated_at
            ) VALUES ('eval-1', 'w1', 'completed', 'done', 'openai', 'gpt-test', 'rubric-4',
                      'prompt-2', '{"overallBand":7.0}', NULL, NULL,
                      '2026-01-02T00:40:00Z', '2026-01-02T00:41:00Z',
                      '2026-01-02T00:41:00Z');

            INSERT INTO writing_drafts (
              attempt_id, content_text, prompt_snapshot, task_type, word_count,
              idempotency_key, updated_at
            ) VALUES ('w1', 'Essay body', 'Discuss both views', 'task2', 2, 'draft-key-1',
                      '2026-01-02T00:39:00Z');

            INSERT INTO attempt_idempotency (
              scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at
            ) VALUES ('writing.submit', 'submit-key-1', 'w1', 'eval-1',
                      '{"evaluationId":"eval-1"}', '2026-01-02T00:40:00Z');

            INSERT INTO evaluation_sessions (
              id, attempt_id, evaluation_id, status, stage, revision, sequence, retry_of,
              cancel_requested, provider_id, model, started_at, updated_at, completed_at
            ) VALUES ('session-1', 'w1', 'eval-1', 'completed', 'done', 1, 2, NULL, 0,
                      'openai', 'gpt-test', '2026-01-02T00:40:00Z',
                      '2026-01-02T00:41:00Z', '2026-01-02T00:41:00Z');

            INSERT INTO reading_suite_items (
              suite_id, item_index, asset_id, attempt_id, status, title, category,
              submitted_at, score_json
            ) VALUES ('suite-1', 0, 'asset-reading', 'r1', 'completed', 'Reading One', 'P1',
                      '2026-01-01T00:10:00Z', '{"correct":1,"total":1}');

            INSERT INTO coach_threads (
              id, attempt_id, asset_id, status, created_at, updated_at, kind,
              last_error_json, learner_profile_json
            ) VALUES ('thread-1', 'r1', 'asset-reading', 'active', '2026-01-05T00:00:00Z',
                      '2026-01-05T00:01:00Z', 'chat', NULL, NULL);

            INSERT INTO learning_events (
              id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
              asset_id, attempt_id, question_id, skill_key, occurred_at, payload_json,
              content_hash, schema_version, consolidation_state, sensitivity, created_at,
              updated_at
            ) VALUES ('event-1', 'local', 'reading.question.outcome', 'reading_attempt',
                      'source-1', 'event-key-1', 'reading', 'asset-reading', 'r1', 'q1',
                      'reading.tfng', '2026-01-01T00:09:30Z', '{"correct":true}', 'hash-1',
                      1, 'pending', 'normal', '2026-01-01T00:09:30Z',
                      '2026-01-01T00:09:30Z');
            "#,
        )
        .unwrap();
    }

    #[test]
    fn activity_scope_upgrade_from_v36_and_v37_preserves_every_row() {
        for start in [36_i64, 37_i64] {
            let mut conn = history_at(start);
            seed_activity_fixture(&conn);
            let asset_columns = column_names(&conn, "practice_assets");
            let attempt_columns = column_names(&conn, "attempts");
            let before = snapshot_activity_rows(&conn);

            let expected: Vec<i64> = (start + 1..=40).collect();
            assert_eq!(migrate(&mut conn).unwrap(), expected, "from v{start}");
            assert_eq!(current_version(&conn).unwrap(), 40);

            assert_eq!(column_names(&conn, "practice_assets"), asset_columns);
            assert_eq!(column_names(&conn, "attempts"), attempt_columns);
            assert_eq!(snapshot_activity_rows(&conn), before, "from v{start}");
            assert_eq!(foreign_key_check_count(&conn), 0);
            for index in [
                "idx_attempts_activity_submitted",
                "idx_attempts_status",
                "idx_attempts_suite",
                "idx_attempts_writing_task_type_submitted",
            ] {
                assert_eq!(object_count(&conn, "index", index), 1, "{index}");
            }
            assert_eq!(
                object_count(&conn, "trigger", "trg_delete_gate_attempts"),
                1
            );
            verify_idempotent(&mut conn).unwrap();
        }
    }

    #[test]
    fn activity_scope_accepts_listening_and_vocabulary_but_rejects_speaking() {
        let conn = history_at(40);
        for activity in ["listening", "vocabulary"] {
            conn.execute(
                "INSERT INTO practice_assets
                   (id, activity, source_kind, title, schema_version, fingerprint, created_at, updated_at)
                 VALUES (?1, ?2, 'builtin', ?3, 1, 'fp', 'now', 'now')",
                rusqlite::params![format!("asset-{activity}"), activity, activity],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO attempts
                   (id, activity, mode, status, started_at, schema_version, created_at, updated_at)
                 VALUES (?1, ?2, 'single', 'completed', 'now', 1, 'now', 'now')",
                rusqlite::params![format!("attempt-{activity}"), activity],
            )
            .unwrap();
        }

        let assets = |conn: &Connection| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM practice_assets", [], |row| row.get(0))
                .unwrap()
        };
        let attempts = |conn: &Connection| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM attempts", [], |row| row.get(0))
                .unwrap()
        };
        let before_assets = assets(&conn);
        let before_attempts = attempts(&conn);

        for sql in [
            "INSERT INTO practice_assets
               (id, activity, source_kind, title, schema_version, fingerprint, created_at, updated_at)
             VALUES ('asset-speaking', 'speaking', 'builtin', 'speaking', 1, 'fp', 'now', 'now')",
            "INSERT INTO attempts
               (id, activity, mode, status, started_at, schema_version, created_at, updated_at)
             VALUES ('attempt-speaking', 'speaking', 'single', 'completed', 'now', 1, 'now', 'now')",
        ] {
            let error = conn.execute(sql, []).unwrap_err();
            assert!(
                error.to_string().contains("CHECK constraint failed"),
                "{error}"
            );
        }
        assert_eq!(assets(&conn), before_assets, "a rejected asset left a row");
        assert_eq!(
            attempts(&conn),
            before_attempts,
            "a rejected attempt left a row"
        );
    }

    #[test]
    fn activity_scope_rebuild_failure_rolls_back_and_a_later_migrate_succeeds() {
        let mut conn = history_at(37);
        seed_activity_fixture(&conn);
        let assets_before = table_rows(&conn, "practice_assets", "id");

        // Orphan attempt: its asset_id has no practice_assets parent. It is
        // written with enforcement off, exactly like data a broken old build
        // could have left behind.
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO attempts
               (id, activity, asset_id, mode, status, started_at, schema_version, created_at, updated_at)
             VALUES ('orphan', 'reading', 'missing-asset', 'single', 'completed', 'now', 2, 'now', 'now');
             PRAGMA foreign_keys = ON;",
        )
        .unwrap();

        let error = migrate(&mut conn).unwrap_err();
        assert!(
            error.to_string().contains("foreign key violation"),
            "{error}"
        );
        assert_eq!(current_version(&conn).unwrap(), 37);
        assert_eq!(table_rows(&conn, "practice_assets", "id"), assets_before);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE name IN ('practice_assets_new', 'attempts_new')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert!(conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, bool>(0))
            .unwrap());

        crate::safety::with_delete_gate(&conn, || {
            conn.execute("DELETE FROM attempts WHERE id = 'orphan'", [])?;
            Ok(())
        })
        .unwrap();

        assert_eq!(migrate(&mut conn).unwrap(), vec![38, 39, 40]);
        assert_eq!(current_version(&conn).unwrap(), 40);
        assert_eq!(foreign_key_check_count(&conn), 0);
    }

    #[test]
    fn activity_scope_backup_from_v37_restores_into_v40() {
        use crate::backup::{create_backup_package, import_backup};

        let mut conn = history_at(37);
        seed_activity_fixture(&conn);
        let asset_columns = column_names(&conn, "practice_assets");
        let attempt_columns = column_names(&conn, "attempts");
        let before = snapshot_activity_rows(&conn);
        let package = create_backup_package(&conn, "activity-scope-test").unwrap();
        assert_eq!(package.manifest.database_schema_version, 37);

        migrate(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 40);
        assert_eq!(column_names(&conn, "practice_assets"), asset_columns);
        assert_eq!(column_names(&conn, "attempts"), attempt_columns);

        let report = import_backup(&conn, &package, false).unwrap();
        assert!(report.ok, "{:?}", report.errors);
        assert_eq!(snapshot_activity_rows(&conn), before);
        assert_eq!(foreign_key_check_count(&conn), 0);
    }

    #[test]
    fn activity_scope_delete_gate_and_asset_cascade_stay_intact() {
        let conn = history_at(40);
        seed_activity_fixture(&conn);

        // Raw delete is still refused by the recreated trigger.
        let raw = conn
            .execute("DELETE FROM attempts WHERE id = 'r1'", [])
            .unwrap_err();
        assert!(raw.to_string().contains("delete_gate"), "{raw}");

        // Deleting an asset nulls the attempt pointer and cascades its topic.
        conn.execute("DELETE FROM practice_assets WHERE id = 'asset-writing'", [])
            .unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM writing_topics WHERE asset_id = 'asset-writing'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT asset_id FROM attempts WHERE id = 'w1'", [], |row| {
                row.get::<_, Option<String>>(0)
            })
            .unwrap(),
            None
        );
        assert_eq!(foreign_key_check_count(&conn), 0);

        // Under the gate the attempt delete cascades every child. The ledger
        // is RESTRICT, so its rows are removed first, as the history path does.
        let deleted: DbResult<()> = crate::safety::with_delete_gate(&conn, || {
            conn.execute("DELETE FROM learning_events WHERE attempt_id = 'r1'", [])?;
            conn.execute("DELETE FROM attempts WHERE id IN ('r1', 'w1')", [])?;
            Ok(())
        });
        deleted.unwrap();

        for (table, column, attempt) in [
            ("attempt_answers", "attempt_id", "r1"),
            ("attempt_annotations", "attempt_id", "r1"),
            ("writing_evaluations", "attempt_id", "w1"),
            ("writing_drafts", "attempt_id", "w1"),
            ("attempt_idempotency", "attempt_id", "w1"),
            ("evaluation_sessions", "attempt_id", "w1"),
            ("learning_events", "attempt_id", "r1"),
        ] {
            let left: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?1"),
                    rusqlite::params![attempt],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(left, 0, "{table} kept rows for {attempt}");
        }
        assert_eq!(foreign_key_check_count(&conn), 0);
    }

    #[test]
    fn activity_scope_seeds_thirteen_listening_skills_once() {
        let mut conn = history_at(40);
        let listening = |conn: &Connection| -> Vec<String> {
            let mut stmt = conn
                .prepare("SELECT skill_key FROM skill_catalog WHERE activity = 'listening' ORDER BY skill_key")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let mut expected = vec![
            "listening.diagram_labelling",
            "listening.flow_chart_completion",
            "listening.form_completion",
            "listening.map_labelling",
            "listening.matching",
            "listening.multi_choice",
            "listening.note_completion",
            "listening.plan_labelling",
            "listening.sentence_completion",
            "listening.short_answer",
            "listening.single_choice",
            "listening.summary_completion",
            "listening.table_completion",
        ];
        expected.sort_unstable();
        assert_eq!(listening(&conn), expected);
        verify_idempotent(&mut conn).unwrap();
        assert_eq!(listening(&conn), expected);
    }

    #[test]
    fn rebuilt_children_match_declared_foreign_keys() {
        let conn = history_at(40);
        for parent in ["practice_assets", "attempts", "learning_events"] {
            let mut declared: Vec<String> = rebuilt_children(parent)
                .iter()
                .map(|table| (*table).to_string())
                .collect();
            declared.sort();
            let mut actual = foreign_key_children(&conn, parent);
            actual.sort();
            assert_eq!(actual, declared, "{parent}");
        }
    }
}
