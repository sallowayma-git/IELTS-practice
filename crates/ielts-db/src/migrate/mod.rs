use std::sync::OnceLock;

use rusqlite::Connection;

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

fn migrations() -> &'static [Migration] {
    static MIGRATIONS: OnceLock<Vec<Migration>> = OnceLock::new();
    MIGRATIONS.get_or_init(|| {
        vec![
            Migration {
                version: 1,
                name: "v2_core",
                sql: include_str!("../../migrations/0001_v2_core.sql"),
            },
            Migration {
                version: 2,
                name: "writing_eval_sessions",
                sql: include_str!("../../migrations/0002_writing_eval_sessions.sql"),
            },
            Migration {
                version: 3,
                name: "eval_lineage_multi",
                sql: include_str!("../../migrations/0003_eval_lineage_multi.sql"),
            },
            Migration {
                version: 4,
                name: "modes_timer",
                sql: include_str!("../../migrations/0004_modes_timer.sql"),
            },
            Migration {
                version: 5,
                name: "annotations_vocab_coach",
                sql: include_str!("../../migrations/0005_annotations_vocab_coach.sql"),
            },
            Migration {
                version: 6,
                name: "writing_topics",
                sql: include_str!("../../migrations/0006_writing_topics.sql"),
            },
            Migration {
                version: 7,
                name: "attempt_writing_task_type",
                sql: include_str!("../../migrations/0007_attempt_writing_task_type.sql"),
            },
            Migration {
                version: 8,
                name: "history_retention_policy",
                sql: include_str!("../../migrations/0008_history_retention_policy.sql"),
            },
            Migration {
                version: 9,
                name: "writing_prompt_policy",
                sql: include_str!("../../migrations/0009_writing_prompt_policy.sql"),
            },
            Migration {
                version: 10,
                name: "reading_timer_states",
                sql: include_str!("../../migrations/0010_reading_timer_states.sql"),
            },
            Migration {
                version: 11,
                name: "agent_runs_tool_calls",
                sql: include_str!("../../migrations/0011_agent_runs_tool_calls.sql"),
            },
            Migration {
                version: 12,
                name: "learning_event_ledger",
                sql: include_str!("../../migrations/0012_learning_event_ledger.sql"),
            },
            Migration {
                version: 13,
                name: "learning_observation_projection",
                sql: include_str!("../../migrations/0013_learning_observation_projection.sql"),
            },
            Migration {
                version: 14,
                name: "memory_profile_core",
                sql: include_str!("../../migrations/0014_memory_profile_core.sql"),
            },
            Migration {
                version: 15,
                name: "learner_model_v1",
                sql: include_str!("../../migrations/0015_learner_model_v1.sql"),
            },
            Migration {
                version: 16,
                name: "context_retrieval_trace",
                sql: include_str!("../../migrations/0016_context_retrieval_trace.sql"),
            },
            Migration {
                version: 17,
                name: "coach_learning_feedback",
                sql: include_str!("../../migrations/0017_coach_learning_feedback.sql"),
            },
            Migration {
                version: 18,
                name: "daily_journal_jobs",
                sql: include_str!("../../migrations/0018_daily_journal_jobs.sql"),
            },
            Migration {
                version: 19,
                name: "memory_consolidation_v1",
                sql: include_str!("../../migrations/0019_memory_consolidation_v1.sql"),
            },
            Migration {
                version: 20,
                name: "teaching_strategy_evolution",
                sql: include_str!("../../migrations/0020_teaching_strategy_evolution.sql"),
            },
            Migration {
                version: 21,
                name: "prompt_skill_evolution",
                sql: include_str!("../../migrations/0021_prompt_skill_evolution.sql"),
            },
            Migration {
                version: 22,
                name: "agent_threads_planner",
                sql: include_str!("../../migrations/0022_agent_threads_planner.sql"),
            },
            Migration {
                version: 23,
                name: "strategy_candidate_eval_gate",
                sql: include_str!("../../migrations/0023_strategy_candidate_eval_gate.sql"),
            },
            Migration {
                version: 24,
                name: "coach_outcome_link_fk_fix",
                sql: include_str!("../../migrations/0024_coach_outcome_link_fk_fix.sql"),
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
        let tx = conn.transaction()?;
        tx.execute_batch(migration.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                migration.version,
                migration.name,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        tx.commit()?;
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
    Ok(applied)
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
