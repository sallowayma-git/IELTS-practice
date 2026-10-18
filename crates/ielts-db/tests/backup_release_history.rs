//! Every snapshot schema before release history remains restorable.
use ielts_db::{
    create_backup_package, import_backup, migrate, open_connection, validate_backup,
    DbOpenOptions,
};
use ielts_domain::dto::BackupPackage;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db(path: impl Into<std::path::PathBuf>) -> Connection {
    let mut conn = open_connection(&DbOpenOptions::create(path.into())).unwrap();
    migrate(&mut conn).unwrap();
    conn
}

/// Keep the manifest's table and row counts in step with a fabricated payload.
fn recount(package: &mut BackupPackage) {
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
}

fn rechecksum(package: &mut BackupPackage) {
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package
        .database
        .iter()
        .map(|t| t.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
    package.manifest.checksum_sha256.clear();
    package.manifest.checksum_sha256 =
        hex::encode(Sha256::digest(serde_json::to_vec(package).unwrap()));
}

fn assert_fk_enabled(conn: &Connection) {
    assert_eq!(
        conn.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(stmt.query([]).unwrap().next().unwrap().is_none());
    assert_eq!(
        conn.query_row("PRAGMA defer_foreign_keys", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn every_snapshot_schema_before_release_history_remains_restorable() {
    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    let current = create_backup_package(&source, "compatibility").unwrap();
    let summaries = ielts_db::format17_attempt_summaries(&source).unwrap();
    let target = open_db(dir.path().join("target.db"));
    // Freeze the introduction boundary independently from the implementation's
    // table lists. v9 and v10 have the same snapshot shape.
    for schema in 2..=16 {
        let mut package = current.clone();
        package.manifest.schema_version = schema;
        package.database.retain(|table| {
            let introduced = match table.name.as_str() {
                "writing_topics" => 3,
                "history_retention_policy" => 4,
                "writing_prompts" => 5,
                "reading_timer_states" => 6,
                "agent_runs" | "agent_tool_calls" => 7,
                "learning_events" => 8,
                "explicit_user_preferences"
                | "memory_items"
                | "memory_candidate_batches"
                | "memory_candidates"
                | "memory_evidence"
                | "memory_mutations"
                | "coach_feedback"
                | "coach_reask_links"
                | "coach_strategy_assignments_v0"
                | "coach_outcome_links_v0" => 9,
                "daily_journals"
                | "daily_journal_sources"
                | "background_jobs"
                | "dream_runs"
                | "dream_candidates" => 11,
                "memory_relations" | "memory_feedback" | "memory_capacity_state" => 12,
                "teaching_strategy_catalog"
                | "teaching_strategy_assignments"
                | "teaching_strategy_feedback"
                | "teaching_strategy_outcomes"
                | "user_strategy_state"
                | "strategy_candidate_batches" => 13,
                "prompt_templates"
                | "prompt_versions"
                | "skill_definitions"
                | "skill_versions"
                | "eval_cases"
                | "candidate_promotions"
                | "eval_runs"
                | "eval_results"
                | "shadow_runs" => 14,
                "agent_threads"
                | "agent_messages"
                | "agent_checkpoints"
                | "study_plans"
                | "study_plan_items"
                | "agent_action_approvals" => 15,
                "strategy_candidate_evaluations" => 16,
                "prompt_skill_releases" | "prompt_skill_release_heads" => 17,
                "weekly_digests" => 18,
                "agent_context_snapshots" | "agent_context_items" => 19,
                _ => 2,
            };
            schema >= introduced
        });
        if schema < 18 {
            package.attempts = summaries.clone();
        }
        recount(&mut package);
        rechecksum(&mut package);
        validate_backup(&package).unwrap_or_else(|error| panic!("v{schema}: {error}"));
        for dry_run in [true, false] {
            let report = import_backup(&target, &package, dry_run).unwrap();
            assert!(report.ok, "v{schema}, dry={dry_run}: {:?}", report.errors);
            assert_fk_enabled(&target);
        }
    }
}

#[test]
fn format_19_package_with_tables_migration_0033_dropped_still_restores() {
    use ielts_domain::dto::{BackupSqlValue, BackupTable};

    let dir = tempdir().unwrap();
    let source = open_db(dir.path().join("source.db"));
    let mut package = create_backup_package(&source, "dropped-tables").unwrap();
    assert_eq!(package.manifest.schema_version, 20);
    assert!(package.database.iter().all(|table| table.name != "dream_candidates"));

    // A format 19 package still carries the evolution tables; their rows are
    // accepted and ignored, since the target no longer has those tables.
    package.manifest.schema_version = 19;
    for name in ["dream_candidates", "teaching_strategy_catalog", "prompt_skill_releases"] {
        package.database.push(BackupTable {
            name: name.into(),
            columns: vec!["id".into()],
            rows: vec![vec![BackupSqlValue::Text(format!("{name}-row"))]],
        });
    }
    recount(&mut package);
    rechecksum(&mut package);
    validate_backup(&package).unwrap();

    let target = open_db(dir.path().join("target.db"));
    let report = import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_fk_enabled(&target);
    let dropped: i64 = target
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'dream_candidates'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(dropped, 0);
}
