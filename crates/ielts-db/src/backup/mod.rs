//! Versioned, lossless backup / restore for the canonical SQLite store.
//! Ordinary backups contain opaque keychain references, never secret bytes.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, params_from_iter, Connection, Transaction};
use sha2::{Digest, Sha256};

use ielts_domain::dto::{
    AttemptRecord, BackupManifest, BackupPackage, BackupSqlValue, BackupTable, ImportBackupReport,
    SecretRef, SettingEntry,
};

use crate::attempts::{parse_writing_task_type, upsert_attempt};
use crate::migrate::current_version;
use crate::settings::{list_secret_refs, list_settings, put_secret_ref, upsert_setting};
use crate::sqlite::{DbError, DbResult};

pub const BACKUP_SCHEMA_VERSION: u32 = 16;
const LEGACY_BACKUP_SCHEMA_VERSION: u32 = 1;

// Parent tables precede their children. Restore inserts in this order and
// clears in reverse order, so foreign keys remain enabled for the whole
// transaction.
const CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
    "teaching_strategy_catalog",
    "teaching_strategy_assignments",
    "teaching_strategy_feedback",
    "teaching_strategy_outcomes",
    "user_strategy_state",
    "strategy_candidate_batches",
    "strategy_candidate_evaluations",
    "prompt_templates",
    "prompt_versions",
    "skill_definitions",
    "skill_versions",
    "eval_cases",
    "candidate_promotions",
    "eval_runs",
    "eval_results",
    "shadow_runs",
    "agent_threads",
    "agent_messages",
    "agent_checkpoints",
    "study_plans",
    "study_plan_items",
    "agent_action_approvals",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v15 predates the M10 strategy-candidate evaluation evidence table.
// Keep this exact list frozen so existing v15 backups remain restorable after
// the gate table is added.
const V15_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
    "teaching_strategy_catalog",
    "teaching_strategy_assignments",
    "teaching_strategy_feedback",
    "teaching_strategy_outcomes",
    "user_strategy_state",
    "strategy_candidate_batches",
    "prompt_templates",
    "prompt_versions",
    "skill_definitions",
    "skill_versions",
    "eval_cases",
    "candidate_promotions",
    "eval_runs",
    "eval_results",
    "shadow_runs",
    "agent_threads",
    "agent_messages",
    "agent_checkpoints",
    "study_plans",
    "study_plan_items",
    "agent_action_approvals",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v13 predates the M11 Prompt/Skill Evolution tables. Keep this exact
// list frozen: historical v13 packages do not contain the nine M11 tables.
const V13_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
    "teaching_strategy_catalog",
    "teaching_strategy_assignments",
    "teaching_strategy_feedback",
    "teaching_strategy_outcomes",
    "user_strategy_state",
    "strategy_candidate_batches",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v12 predates the M10 Teaching Strategy Evolution tables. Keep this
// exact list frozen: historical v12 packages do not contain the six M10
// tables.
const V12_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v11 predates the M8 Memory Consolidation tables. Keep this exact list
// frozen: historical v11 packages do not contain the three M8 tables.
const V11_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v10 predates the M7 Daily Journal / Dream tables. Keep this exact
// list frozen: historical v10 packages do not contain the five M7 tables.
const V10_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v8 predates the Memory/Profile core. Keep this exact 29-table list
// frozen: historical v8 packages do not contain the six M3 tables.
const V8_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v7 predates the Learning Event Ledger. Keep this exact list frozen so
// checksummed v7 packages remain structurally valid after the current schema
// grows.
const V7_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "agent_runs",
    "agent_tool_calls",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v6 has durable Reading timers but predates Agent audit records.
// Freeze this list: adding current tables here would invalidate every existing
// checksummed v6 package as structurally incomplete.
const V6_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v5 has first-class Writing prompts but predates durable standalone
// and Endless Reading timer state. Existing table columns remain unchanged, so
// the old checksummed package can restore without fabricating a timer table.
const V5_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v4 predates the first-class prompt-policy table. Keep this exact
// payload shape valid so old checksummed backups restore and migrate prompts
// inside the target transaction.
const V4_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v3 has first-class writing topics but predates the independent
// retention-policy table. Keep the exact package shape so its checksum stays
// meaningful and old backups remain importable.
const V3_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "reading_suites",
    "attempts",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v2 predates the first-class writing topic projection. Keep its
// immutable package shape explicit: adding an empty table after checksum
// verification would forge the backup instead of importing it compatibly.
const V2_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "reading_suites",
    "attempts",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

// Schema v14 predates the M12 Agent Threads / Planner tables. Keep this
// exact list frozen: historical v14 packages do not contain the six M12
// tables.
const V14_CANONICAL_TABLES: &[&str] = &[
    "practice_assets",
    "writing_topics",
    "writing_prompts",
    "reading_suites",
    "attempts",
    "history_retention_policy",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "attempt_idempotency",
    "evaluation_sessions",
    "evaluation_checkpoints",
    "evaluation_events",
    "evaluation_lineage",
    "reading_suite_items",
    "endless_sessions",
    "reading_timer_states",
    "mode_idempotency",
    "coach_threads",
    "coach_messages",
    "coach_feedback",
    "coach_reask_links",
    "coach_strategy_assignments_v0",
    "coach_outcome_links_v0",
    "agent_runs",
    "agent_tool_calls",
    "learning_events",
    "explicit_user_preferences",
    "memory_items",
    "memory_candidate_batches",
    "memory_candidates",
    "memory_evidence",
    "memory_mutations",
    "daily_journals",
    "daily_journal_sources",
    "background_jobs",
    "dream_runs",
    "dream_candidates",
    "memory_relations",
    "memory_feedback",
    "memory_capacity_state",
    "teaching_strategy_catalog",
    "teaching_strategy_assignments",
    "teaching_strategy_feedback",
    "teaching_strategy_outcomes",
    "user_strategy_state",
    "strategy_candidate_batches",
    "prompt_templates",
    "prompt_versions",
    "skill_definitions",
    "skill_versions",
    "eval_cases",
    "candidate_promotions",
    "eval_runs",
    "eval_results",
    "shadow_runs",
    "vocabulary_items",
    "vocabulary_review_state",
    "dictionary_entries",
    "settings",
    "migration_meta",
];

fn snapshot_tables_for_schema(schema_version: u32) -> &'static [&'static str] {
    if schema_version >= 16 {
        CANONICAL_TABLES
    } else if schema_version == 15 {
        V15_CANONICAL_TABLES
    } else if schema_version == 14 {
        V14_CANONICAL_TABLES
    } else if schema_version == 13 {
        V13_CANONICAL_TABLES
    } else if schema_version == 12 {
        V12_CANONICAL_TABLES
    } else if schema_version == 11 {
        V11_CANONICAL_TABLES
    } else if schema_version == 10 {
        V10_CANONICAL_TABLES
    } else if schema_version == 9 {
        V10_CANONICAL_TABLES
    } else if schema_version == 8 {
        V8_CANONICAL_TABLES
    } else if schema_version == 7 {
        V7_CANONICAL_TABLES
    } else if schema_version == 6 {
        V6_CANONICAL_TABLES
    } else if schema_version == 5 {
        V5_CANONICAL_TABLES
    } else if schema_version == 4 {
        V4_CANONICAL_TABLES
    } else if schema_version == 3 {
        V3_CANONICAL_TABLES
    } else {
        V2_CANONICAL_TABLES
    }
}

pub fn create_backup_package(conn: &Connection, app_version: &str) -> DbResult<BackupPackage> {
    let attempts = load_all_attempts(conn)?;
    let settings = list_settings(conn, None)?;
    let secret_refs = list_secret_refs(conn)?;
    let database = snapshot_database(conn)?;
    let database_rows = database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>();

    let mut package = BackupPackage {
        manifest: BackupManifest {
            schema_version: BACKUP_SCHEMA_VERSION,
            database_schema_version: current_version(conn)? as u32,
            created_at: chrono::Utc::now().to_rfc3339(),
            app_version: app_version.to_string(),
            includes_secrets: false,
            attempt_count: attempts.len() as u32,
            settings_count: settings.len() as u32,
            secret_ref_count: secret_refs.len() as u32,
            table_count: database.len() as u32,
            row_count: database_rows + secret_refs.len() as u64,
            checksum_sha256: String::new(),
        },
        attempts,
        settings,
        secret_refs,
        database,
    };
    package.manifest.checksum_sha256 = checksum_package(&package)?;
    // Creating a file is already an export boundary. Refuse to return a
    // package that would fail the same integrity or secret-policy checks on
    // import.
    validate_backup(&package)?;
    Ok(package)
}

pub fn write_backup_file(package: &BackupPackage, path: &Path) -> DbResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(package).map_err(|e| DbError::Message(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(())
}

pub fn read_backup_file(path: &Path) -> DbResult<BackupPackage> {
    let raw = std::fs::read_to_string(path)?;
    serde_json::from_str(&raw).map_err(|e| DbError::Validation(format!("backup parse: {e}")))
}

/// Validate format, counts, checksum, JSON payloads, secret policy and logical
/// references without touching the target database.
pub fn validate_backup(package: &BackupPackage) -> DbResult<Vec<String>> {
    if package.manifest.schema_version == 0
        || package.manifest.schema_version > BACKUP_SCHEMA_VERSION
    {
        return Err(DbError::Validation(format!(
            "unsupported backup schema_version {}",
            package.manifest.schema_version
        )));
    }
    if package.manifest.includes_secrets {
        return Err(DbError::Validation(
            "backup claims includes_secrets=true; refuse ordinary import".into(),
        ));
    }
    verify_checksum(package)?;
    validate_secret_policy(package)?;

    if package.manifest.schema_version == LEGACY_BACKUP_SCHEMA_VERSION {
        if !package.database.is_empty() {
            return Err(DbError::Validation(
                "legacy backup schema v1 must not contain a database snapshot".into(),
            ));
        }
        let mut warnings = validate_legacy_counts(package);
        warnings.push(
            "legacy backup schema v1 is incomplete; only attempt summaries, settings and secret references can be restored"
                .into(),
        );
        return Ok(warnings);
    }

    validate_snapshot_counts(package)?;
    let tables = table_map(
        &package.database,
        snapshot_tables_for_schema(package.manifest.schema_version),
    )?;
    validate_json_cells(&tables)?;
    validate_logical_references(&tables)?;
    validate_redundant_views(package, &tables)?;
    Ok(Vec::new())
}

pub fn import_backup(
    conn: &Connection,
    package: &BackupPackage,
    dry_run: bool,
) -> DbResult<ImportBackupReport> {
    let mut report = empty_report(dry_run);
    match validate_backup(package) {
        Ok(warnings) => report.warnings = warnings,
        Err(error) => {
            report.ok = false;
            report.errors.push(error.to_string());
            return Ok(report);
        }
    }

    if package.manifest.schema_version == LEGACY_BACKUP_SCHEMA_VERSION {
        return import_legacy_backup(conn, package, dry_run, report);
    }

    if let Err(error) = validate_target_schema(conn, package) {
        report.ok = false;
        report.errors.push(error.to_string());
        return Ok(report);
    }

    // Dry-run executes the exact restore against the real schema, then drops
    // the transaction. This verifies CHECK/UNIQUE/FK constraints without
    // leaving any persistent mutation.
    let tx = conn.unchecked_transaction()?;
    match restore_snapshot(&tx, package) {
        Ok(()) => {
            report.attempt_imported = package.manifest.attempt_count;
            report.settings_imported = package.manifest.settings_count;
            report.secret_refs_imported = package.manifest.secret_ref_count;
            report.tables_imported = package.manifest.table_count;
            report.rows_imported = package.manifest.row_count;
            if dry_run {
                drop(tx);
            } else {
                tx.commit()?;
            }
        }
        Err(error) => {
            drop(tx);
            report.ok = false;
            report.errors.push(error.to_string());
        }
    }
    Ok(report)
}

fn empty_report(dry_run: bool) -> ImportBackupReport {
    ImportBackupReport {
        dry_run,
        ok: true,
        attempt_imported: 0,
        settings_imported: 0,
        secret_refs_imported: 0,
        tables_imported: 0,
        rows_imported: 0,
        errors: Vec::new(),
        warnings: Vec::new(),
    }
}

fn import_legacy_backup(
    conn: &Connection,
    package: &BackupPackage,
    dry_run: bool,
    mut report: ImportBackupReport,
) -> DbResult<ImportBackupReport> {
    if dry_run {
        report.attempt_imported = package.attempts.len() as u32;
        report.settings_imported = package.settings.len() as u32;
        report.secret_refs_imported = package.secret_refs.len() as u32;
        return Ok(report);
    }

    let tx = conn.unchecked_transaction()?;
    let result = (|| -> DbResult<()> {
        for attempt in &package.attempts {
            upsert_attempt(&tx, attempt)?;
            report.attempt_imported += 1;
        }
        for setting in &package.settings {
            upsert_setting(&tx, &setting.namespace, &setting.key, &setting.value)?;
            report.settings_imported += 1;
        }
        for secret in &package.secret_refs {
            put_secret_ref(&tx, &secret.name, &secret.ref_id)?;
            report.secret_refs_imported += 1;
        }
        Ok(())
    })();
    match result {
        Ok(()) => tx.commit()?,
        Err(error) => {
            drop(tx);
            report.ok = false;
            report.errors.push(error.to_string());
        }
    }
    Ok(report)
}

fn snapshot_database(conn: &Connection) -> DbResult<Vec<BackupTable>> {
    let mut out = Vec::with_capacity(CANONICAL_TABLES.len());
    for table in CANONICAL_TABLES {
        let columns = table_columns(conn, table)?;
        let projection = columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let predicate = if *table == "settings" {
            " WHERE namespace != 'secret_refs'"
        } else {
            ""
        };
        let sql = format!(
            "SELECT {projection} FROM {}{predicate}",
            quote_identifier(table)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let mut values = Vec::with_capacity(columns.len());
            for index in 0..columns.len() {
                values.push(sql_value_from_ref(row.get_ref(index)?));
            }
            Ok(values)
        })?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row?);
        }
        // Stable ordering makes the checksum independent of row insertion
        // order and enables exact source/restored snapshot comparison.
        values.sort_by_cached_key(|row| serde_json::to_string(row).unwrap_or_default());
        out.push(BackupTable {
            name: (*table).to_string(),
            columns,
            rows: values,
        });
    }
    Ok(out)
}

fn table_columns(conn: &Connection, table: &str) -> DbResult<Vec<String>> {
    let sql = format!("PRAGMA table_info({})", quote_identifier(table));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let mut columns = Vec::new();
    for row in rows {
        columns.push(row?);
    }
    if columns.is_empty() {
        return Err(DbError::Validation(format!(
            "canonical backup table is missing: {table}"
        )));
    }
    Ok(columns)
}

fn sql_value_from_ref(value: ValueRef<'_>) -> BackupSqlValue {
    match value {
        ValueRef::Null => BackupSqlValue::Null,
        ValueRef::Integer(value) => BackupSqlValue::Integer(value),
        ValueRef::Real(value) => BackupSqlValue::Real(value),
        ValueRef::Text(value) => BackupSqlValue::Text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => BackupSqlValue::Blob(value.to_vec()),
    }
}

fn sql_value(value: &BackupSqlValue) -> SqlValue {
    match value {
        BackupSqlValue::Null => SqlValue::Null,
        BackupSqlValue::Integer(value) => SqlValue::Integer(*value),
        BackupSqlValue::Real(value) => SqlValue::Real(*value),
        BackupSqlValue::Text(value) => SqlValue::Text(value.clone()),
        BackupSqlValue::Blob(value) => SqlValue::Blob(value.clone()),
    }
}

fn validate_target_schema(conn: &Connection, package: &BackupPackage) -> DbResult<()> {
    let target_version = current_version(conn)?;
    if target_version < package.manifest.database_schema_version as i64 {
        return Err(DbError::Validation(format!(
            "backup requires database schema {}, target has {}",
            package.manifest.database_schema_version, target_version
        )));
    }
    for table in &package.database {
        let target_columns = table_columns(conn, &table.name)?;
        if table.columns != target_columns {
            return Err(DbError::Validation(format!(
                "backup table {} columns do not match target schema",
                table.name
            )));
        }
    }
    Ok(())
}

fn restore_snapshot(tx: &Transaction<'_>, package: &BackupPackage) -> DbResult<()> {
    // Defer foreign keys for the duration of this restore.
    //
    // The snapshot carries `coach_outcome_links_v0`, whose `future_observation_id`
    // references `learner_observations` (0017:112) -- a DERIVED projection table
    // deliberately excluded from the snapshot because it is rebuilt on the target
    // (see the note in `validate_referential_integrity`). But SQLite enforces a
    // foreign key on INSERT, not only on delete, so restoring the link before its
    // parent exists aborted the whole restore with a bare
    // "FOREIGN KEY constraint failed". Any user who had ever recorded a coach
    // learning outcome therefore held a backup that could not be restored at all.
    //
    // Deferring is sound here because the rebuild below recreates the exact
    // parent rows: an observation id is `format!("obs-{source_fingerprint}")`
    // (crates/ielts-db/src/learning_observations.rs:908), a pure function of the
    // restored `learning_events`, so the ids the links point at come back
    // identical. `assert_no_foreign_key_violations` at the end still runs, so
    // nothing is weakened -- the check simply happens once the transaction is
    // internally consistent instead of mid-load.
    //
    // `defer_foreign_keys` is used rather than `foreign_keys` because the latter
    // is a documented no-op inside a transaction. SQLite also resets this flag
    // automatically when the transaction ends, so it cannot leak to later work on
    // this connection.
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")?;

    let source_tables = snapshot_tables_for_schema(package.manifest.schema_version);
    let tables = table_map(&package.database, source_tables)?;
    for table in CANONICAL_TABLES.iter().rev() {
        // Old snapshots have no independent policy. Preserve the target row
        // until the legacy app/settings value below has a chance to migrate.
        if *table == "history_retention_policy" && !source_tables.contains(table) {
            continue;
        }
        tx.execute(&format!("DELETE FROM {}", quote_identifier(table)), [])?;
    }
    for table_name in source_tables {
        let Some(table) = tables.get(table_name) else {
            // Older snapshots may predate tables added in a later schema
            // version. snapshot_tables_for_schema returns the current list, but
            // the package only carries the tables that existed when it was
            // written; skip any that are absent rather than panicking.
            continue;
        };
        let table = *table;
        let columns = table
            .columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = (1..=table.columns.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {} ({columns}) VALUES ({placeholders})",
            quote_identifier(table_name)
        );
        let mut stmt = tx.prepare(&sql)?;
        for row in &table.rows {
            let values = row.iter().map(sql_value).collect::<Vec<_>>();
            stmt.execute(params_from_iter(values))?;
        }
    }
    // Secret references are deliberately outside the raw settings snapshot.
    // Preserve their timestamps while never asking the keychain for values.
    for secret in &package.secret_refs {
        let value_json = serde_json::to_string(&serde_json::json!({
            "refId": secret.ref_id,
            "name": secret.name,
        }))
        .map_err(|error| DbError::Message(error.to_string()))?;
        tx.execute(
            "INSERT INTO settings(namespace, key, value_json, updated_at) VALUES ('secret_refs', ?1, ?2, ?3)",
            params![secret.name, value_json, secret.updated_at],
        )?;
    }
    if package.manifest.schema_version == 2 {
        // A v2 package has no canonical writing-topic rows. Its restored
        // settings are the only cold-import source, so discard any checkpoint
        // marker carried by an intermediate v2 build before the next topic
        // query seeds the new projection.
        crate::writing::topics::reset_legacy_writing_topics_import_marker(tx)?;
    }
    if package.manifest.schema_version < 4 {
        crate::history::restore_legacy_history_retention_policy(tx)?;
    }
    if package.manifest.schema_version < 5 {
        // An older snapshot has no canonical prompt table. Ignore any stale
        // checkpoint copied in its migration metadata, then project the
        // restored settings rows while this restore transaction is still open.
        tx.execute(
            "DELETE FROM migration_meta WHERE key = 'writing_prompts.settings_v1_imported'",
            [],
        )?;
        crate::writing::migrate_legacy_writing_prompts_in_transaction(tx)?;
    }
    // Rebuild the derived learning-observation projection before validating.
    // It is the parent of the restored `coach_outcome_links_v0` rows, and it is
    // intentionally not carried in the snapshot, so it must be regenerated from
    // the restored `learning_events` while this transaction is still open --
    // after commit would be too late for the deferred check below.
    crate::learning_observations::learning_observations_rebuild_in_transaction(tx)?;

    assert_no_foreign_key_violations(tx)?;
    Ok(())
}

fn assert_no_foreign_key_violations(conn: &Connection) -> DbResult<()> {
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let parent: String = row.get(2)?;
        return Err(DbError::Validation(format!(
            "foreign key violation after restore: {table} -> {parent}"
        )));
    }
    Ok(())
}

fn table_map<'a>(
    tables: &'a [BackupTable],
    required_tables: &[&str],
) -> DbResult<HashMap<&'a str, &'a BackupTable>> {
    let allowed = required_tables.iter().copied().collect::<HashSet<_>>();
    let mut out = HashMap::new();
    for table in tables {
        if !allowed.contains(table.name.as_str()) {
            return Err(DbError::Validation(format!(
                "backup contains unsupported table: {}",
                table.name
            )));
        }
        if table.columns.is_empty() {
            return Err(DbError::Validation(format!(
                "backup table {} has no columns",
                table.name
            )));
        }
        let unique_columns = table.columns.iter().collect::<HashSet<_>>();
        if unique_columns.len() != table.columns.len() {
            return Err(DbError::Validation(format!(
                "backup table {} contains duplicate columns",
                table.name
            )));
        }
        if table
            .rows
            .iter()
            .any(|row| row.len() != table.columns.len())
        {
            return Err(DbError::Validation(format!(
                "backup table {} contains a row with the wrong width",
                table.name
            )));
        }
        if out.insert(table.name.as_str(), table).is_some() {
            return Err(DbError::Validation(format!(
                "backup contains duplicate table: {}",
                table.name
            )));
        }
    }
    for required in required_tables {
        if !out.contains_key(required) {
            return Err(DbError::Validation(format!(
                "backup is incomplete; missing canonical table: {required}"
            )));
        }
    }
    Ok(out)
}

fn validate_snapshot_counts(package: &BackupPackage) -> DbResult<()> {
    if package.manifest.table_count != package.database.len() as u32 {
        return Err(DbError::Validation(format!(
            "manifest table_count {} != payload {}",
            package.manifest.table_count,
            package.database.len()
        )));
    }
    let row_count = package
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
    if package.manifest.row_count != row_count {
        return Err(DbError::Validation(format!(
            "manifest row_count {} != payload {}",
            package.manifest.row_count, row_count
        )));
    }
    if package.manifest.attempt_count != package.attempts.len() as u32
        || package.manifest.settings_count != package.settings.len() as u32
        || package.manifest.secret_ref_count != package.secret_refs.len() as u32
    {
        return Err(DbError::Validation(
            "manifest summary counts do not match payload".into(),
        ));
    }
    if package.manifest.database_schema_version == 0 {
        return Err(DbError::Validation(
            "backup database_schema_version is required for snapshot backups".into(),
        ));
    }
    Ok(())
}

fn validate_legacy_counts(package: &BackupPackage) -> Vec<String> {
    let mut warnings = Vec::new();
    for (label, manifest, actual) in [
        (
            "attempt_count",
            package.manifest.attempt_count,
            package.attempts.len() as u32,
        ),
        (
            "settings_count",
            package.manifest.settings_count,
            package.settings.len() as u32,
        ),
        (
            "secret_ref_count",
            package.manifest.secret_ref_count,
            package.secret_refs.len() as u32,
        ),
    ] {
        if manifest != actual {
            warnings.push(format!("manifest {label} {manifest} != payload {actual}"));
        }
    }
    warnings
}

fn validate_redundant_views(
    package: &BackupPackage,
    tables: &HashMap<&str, &BackupTable>,
) -> DbResult<()> {
    let attempt_ids = text_set(tables["attempts"], "id")?;
    let summary_ids = package
        .attempts
        .iter()
        .map(|attempt| attempt.id.clone())
        .collect::<HashSet<_>>();
    if attempt_ids != summary_ids {
        return Err(DbError::Validation(
            "attempt summary does not match canonical attempts table".into(),
        ));
    }
    let setting_keys = composite_text_set(tables["settings"], "namespace", "key")?;
    let summary_setting_keys = package
        .settings
        .iter()
        .map(|setting| (setting.namespace.clone(), setting.key.clone()))
        .collect::<HashSet<_>>();
    if setting_keys != summary_setting_keys {
        return Err(DbError::Validation(
            "settings summary does not match canonical settings table".into(),
        ));
    }
    Ok(())
}

fn validate_json_cells(tables: &HashMap<&str, &BackupTable>) -> DbResult<()> {
    for table in tables.values() {
        for (column_index, column) in table.columns.iter().enumerate() {
            let is_json = column.ends_with("_json") || column == "structured_payload";
            if !is_json {
                continue;
            }
            for (row_index, row) in table.rows.iter().enumerate() {
                if let BackupSqlValue::Text(raw) = &row[column_index] {
                    let value =
                        serde_json::from_str::<serde_json::Value>(raw).map_err(|error| {
                            DbError::Validation(format!(
                                "invalid JSON in {}.{} row {}: {}",
                                table.name, column, row_index, error
                            ))
                        })?;
                    reject_json_secret_material(
                        &value,
                        &format!("{}.{} row {}", table.name, column, row_index),
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn validate_logical_references(tables: &HashMap<&str, &BackupTable>) -> DbResult<()> {
    let assets = text_set(tables["practice_assets"], "id")?;
    let suites = text_set(tables["reading_suites"], "id")?;
    let attempts = text_set(tables["attempts"], "id")?;
    let evaluations = text_set(tables["writing_evaluations"], "id")?;
    let threads = text_set(tables["coach_threads"], "id")?;
    let vocab = text_set(tables["vocabulary_items"], "id")?;

    if let Some(topics) = tables.get("writing_topics") {
        require_refs(topics, "asset_id", &assets)?;
    }
    require_optional_refs(tables["attempts"], "asset_id", &assets)?;
    require_optional_refs(tables["attempts"], "suite_id", &suites)?;
    require_refs(tables["attempt_answers"], "attempt_id", &attempts)?;
    require_optional_refs(tables["attempt_annotations"], "attempt_id", &attempts)?;
    require_refs(tables["attempt_annotations"], "asset_id", &assets)?;
    for table in [
        "writing_evaluations",
        "writing_drafts",
        "attempt_idempotency",
        "evaluation_sessions",
        "evaluation_lineage",
    ] {
        require_refs(tables[table], "attempt_id", &attempts)?;
    }
    require_optional_refs(tables["attempt_idempotency"], "evaluation_id", &evaluations)?;
    require_refs(tables["evaluation_sessions"], "evaluation_id", &evaluations)?;
    for table in [
        "evaluation_checkpoints",
        "evaluation_events",
        "evaluation_lineage",
    ] {
        require_refs(tables[table], "evaluation_id", &evaluations)?;
    }
    require_optional_refs(tables["evaluation_lineage"], "retry_of", &evaluations)?;
    require_optional_refs(
        tables["evaluation_lineage"],
        "root_evaluation_id",
        &evaluations,
    )?;
    require_refs(tables["reading_suite_items"], "suite_id", &suites)?;
    require_refs(tables["reading_suite_items"], "asset_id", &assets)?;
    require_optional_refs(tables["reading_suite_items"], "attempt_id", &attempts)?;
    require_optional_refs(tables["endless_sessions"], "current_asset_id", &assets)?;
    require_optional_refs(tables["endless_sessions"], "current_attempt_id", &attempts)?;
    if let Some(timers) = tables.get("reading_timer_states") {
        validate_timer_owner_refs(
            timers,
            &attempts,
            &text_set(tables["endless_sessions"], "id")?,
        )?;
    }
    require_optional_refs(tables["coach_threads"], "attempt_id", &attempts)?;
    require_optional_refs(tables["coach_threads"], "asset_id", &assets)?;
    require_refs(tables["coach_messages"], "thread_id", &threads)?;
    if let (Some(runs), Some(tool_calls)) =
        (tables.get("agent_runs"), tables.get("agent_tool_calls"))
    {
        require_refs(tool_calls, "run_id", &text_set(runs, "id")?)?;
    }
    if let (
        Some(items),
        Some(batches),
        Some(candidates),
        Some(evidence),
        Some(mutations),
    ) = (
        tables.get("memory_items"),
        tables.get("memory_candidate_batches"),
        tables.get("memory_candidates"),
        tables.get("memory_evidence"),
        tables.get("memory_mutations"),
    ) {
        let memory_ids = text_set(items, "id")?;
        let batch_ids = text_set(batches, "id")?;
        let candidate_ids = text_set(candidates, "id")?;
        require_optional_refs(items, "supersedes_id", &memory_ids)?;
        require_refs(candidates, "batch_id", &batch_ids)?;
        require_optional_refs(candidates, "resolved_memory_id", &memory_ids)?;
        require_refs(evidence, "memory_id", &memory_ids)?;
        require_optional_refs(mutations, "memory_id", &memory_ids)?;
        require_optional_refs(mutations, "candidate_id", &candidate_ids)?;
        if let Some(runs) = tables.get("agent_runs") {
            let run_ids = text_set(runs, "id")?;
            require_optional_refs(items, "created_run_id", &run_ids)?;
            require_optional_refs(batches, "run_id", &run_ids)?;
            require_optional_refs(mutations, "run_id", &run_ids)?;
        }
    }
    require_optional_refs(tables["vocabulary_items"], "source_asset_id", &assets)?;
    require_optional_refs(tables["vocabulary_items"], "source_attempt_id", &attempts)?;
    require_refs(tables["vocabulary_review_state"], "item_id", &vocab)?;
    // M12 Agent Threads / Planner tables. agent_threads is the parent for
    // messages, checkpoints, and approvals; study_plans is the parent for
    // plan items. run_id on checkpoints references agent_runs but is
    // optional and may predate the run row, so it is not validated here.
    if let (Some(threads), Some(messages), Some(checkpoints), Some(plans), Some(items), Some(approvals)) = (
        tables.get("agent_threads"),
        tables.get("agent_messages"),
        tables.get("agent_checkpoints"),
        tables.get("study_plans"),
        tables.get("study_plan_items"),
        tables.get("agent_action_approvals"),
    ) {
        let thread_ids = text_set(threads, "id")?;
        require_refs(messages, "thread_id", &thread_ids)?;
        require_refs(checkpoints, "thread_id", &thread_ids)?;
        require_optional_refs(approvals, "thread_id", &thread_ids)?;
        let plan_ids = text_set(plans, "id")?;
        require_refs(items, "plan_id", &plan_ids)?;
    }
    if let (Some(feedback), Some(reask)) = (
        tables.get("coach_feedback"),
        tables.get("coach_reask_links"),
    ) {
        let message_ids = text_set(tables["coach_messages"], "id")?;
        require_refs(feedback, "coach_message_id", &message_ids)?;
        require_refs(reask, "parent_assistant_message_id", &message_ids)?;
        require_refs(reask, "new_user_message_id", &message_ids)?;
    }
    if let (Some(assignments), Some(outcome_links)) = (
        tables.get("coach_strategy_assignments_v0"),
        tables.get("coach_outcome_links_v0"),
    ) {
        let message_ids = text_set(tables["coach_messages"], "id")?;
        require_refs(assignments, "coach_message_id", &message_ids)?;
        let assignment_ids = text_set(assignments, "id")?;
        require_refs(
            outcome_links,
            "strategy_assignment_id",
            &assignment_ids,
        )?;
        // context_snapshot_id and future_observation_id reference derived
        // projection tables (agent_context_snapshots / learner_observations)
        // that are intentionally not part of the backup snapshot; they are
        // rebuilt on the target after restore, so we do not validate them.
    }
    if let Some(journals) = tables.get("daily_journals") {
        // superseded_by is a self-reference; validate it points to an existing
        // journal id when present.
        let journal_ids = text_set(journals, "id")?;
        require_optional_refs(journals, "superseded_by", &journal_ids)?;
        if let Some(sources) = tables.get("daily_journal_sources") {
            require_refs(sources, "journal_id", &journal_ids)?;
        }
        if let Some(runs) = tables.get("dream_runs") {
            require_refs(runs, "journal_id", &journal_ids)?;
            let run_ids = text_set(runs, "id")?;
            if let Some(candidates) = tables.get("dream_candidates") {
                require_refs(candidates, "run_id", &run_ids)?;
                if let Some(items) = tables.get("memory_items") {
                    let memory_ids = text_set(items, "id")?;
                    require_optional_refs(candidates, "target_memory_id", &memory_ids)?;
                }
            }
        }
    }
    Ok(())
}

fn require_refs(table: &BackupTable, column: &str, valid: &HashSet<String>) -> DbResult<()> {
    let index = column_index(table, column)?;
    for row in &table.rows {
        match &row[index] {
            BackupSqlValue::Text(value) if valid.contains(value) => {}
            BackupSqlValue::Text(value) => {
                return Err(DbError::Validation(format!(
                    "dangling reference {}.{}={value}",
                    table.name, column
                )))
            }
            _ => {
                return Err(DbError::Validation(format!(
                    "required text reference {}.{} is missing",
                    table.name, column
                )))
            }
        }
    }
    Ok(())
}

fn require_optional_refs(
    table: &BackupTable,
    column: &str,
    valid: &HashSet<String>,
) -> DbResult<()> {
    let index = column_index(table, column)?;
    for row in &table.rows {
        match &row[index] {
            BackupSqlValue::Null => {}
            BackupSqlValue::Text(value) if valid.contains(value) => {}
            BackupSqlValue::Text(value) => {
                return Err(DbError::Validation(format!(
                    "dangling reference {}.{}={value}",
                    table.name, column
                )))
            }
            _ => {
                return Err(DbError::Validation(format!(
                    "optional text reference {}.{} has invalid type",
                    table.name, column
                )))
            }
        }
    }
    Ok(())
}

fn validate_timer_owner_refs(
    table: &BackupTable,
    attempts: &HashSet<String>,
    endless_sessions: &HashSet<String>,
) -> DbResult<()> {
    let scope_index = column_index(table, "scope")?;
    let owner_index = column_index(table, "owner_id")?;
    for row in &table.rows {
        let (BackupSqlValue::Text(scope), BackupSqlValue::Text(owner_id)) =
            (&row[scope_index], &row[owner_index])
        else {
            return Err(DbError::Validation(
                "reading timer owner must be text".into(),
            ));
        };
        let valid = match scope.as_str() {
            "attempt" => attempts.contains(owner_id),
            "endless" => endless_sessions.contains(owner_id),
            _ => false,
        };
        if !valid {
            return Err(DbError::Validation(format!(
                "dangling reading timer owner {scope}:{owner_id}"
            )));
        }
    }
    Ok(())
}

fn text_set(table: &BackupTable, column: &str) -> DbResult<HashSet<String>> {
    let index = column_index(table, column)?;
    let mut values = HashSet::new();
    for row in &table.rows {
        let BackupSqlValue::Text(value) = &row[index] else {
            return Err(DbError::Validation(format!(
                "{}.{} must contain text values",
                table.name, column
            )));
        };
        if !values.insert(value.clone()) {
            return Err(DbError::Validation(format!(
                "duplicate logical id in {}.{}: {}",
                table.name, column, value
            )));
        }
    }
    Ok(values)
}

fn composite_text_set(
    table: &BackupTable,
    first: &str,
    second: &str,
) -> DbResult<HashSet<(String, String)>> {
    let first_index = column_index(table, first)?;
    let second_index = column_index(table, second)?;
    let mut values = HashSet::new();
    for row in &table.rows {
        let (BackupSqlValue::Text(first_value), BackupSqlValue::Text(second_value)) =
            (&row[first_index], &row[second_index])
        else {
            return Err(DbError::Validation(format!(
                "{}.{} and {} must contain text values",
                table.name, first, second
            )));
        };
        values.insert((first_value.clone(), second_value.clone()));
    }
    Ok(values)
}

fn column_index(table: &BackupTable, column: &str) -> DbResult<usize> {
    table
        .columns
        .iter()
        .position(|candidate| candidate == column)
        .ok_or_else(|| {
            DbError::Validation(format!(
                "backup table {} is missing column {column}",
                table.name
            ))
        })
}

fn validate_secret_policy(package: &BackupPackage) -> DbResult<()> {
    for setting in &package.settings {
        reject_secret_setting(&setting.namespace, &setting.key, &setting.value)?;
    }
    if let Some(table) = package
        .database
        .iter()
        .find(|table| table.name == "settings")
    {
        let namespace_index = column_index(table, "namespace")?;
        let key_index = column_index(table, "key")?;
        let value_index = column_index(table, "value_json")?;
        for row in &table.rows {
            let (
                BackupSqlValue::Text(namespace),
                BackupSqlValue::Text(key),
                BackupSqlValue::Text(value_json),
            ) = (&row[namespace_index], &row[key_index], &row[value_index])
            else {
                return Err(DbError::Validation(
                    "backup settings row has invalid SQLite types".into(),
                ));
            };
            if namespace == "secret_refs" {
                return Err(DbError::Validation(
                    "secret references must not be duplicated in the raw settings snapshot".into(),
                ));
            }
            let value = serde_json::from_str(value_json).map_err(|error| {
                DbError::Validation(format!("settings JSON for {namespace}.{key}: {error}"))
            })?;
            reject_secret_setting(namespace, key, &value)?;
        }
    }
    for (table_name, columns) in [
        ("memory_items", &["content", "title"][..]),
        ("memory_candidates", &["proposed_statement"][..]),
        ("memory_mutations", &["reason"][..]),
    ] {
        let Some(table) = package.database.iter().find(|table| table.name == table_name) else {
            continue;
        };
        for column in columns {
            let index = column_index(table, column)?;
            for row in &table.rows {
                if let BackupSqlValue::Text(value) = &row[index] {
                    if looks_like_secret_text(value) {
                        return Err(DbError::Validation(format!(
                            "backup {table_name}.{column} appears to contain plaintext secret material"
                        )));
                    }
                }
            }
        }
    }
    for secret in &package.secret_refs {
        if secret.name.trim().is_empty() || secret.ref_id.trim().is_empty() {
            return Err(DbError::Validation(
                "secret reference name/ref_id must not be empty".into(),
            ));
        }
        if looks_like_secret_text(&secret.ref_id) {
            return Err(DbError::Validation(format!(
                "secret reference {} appears to contain plaintext secret material",
                secret.name
            )));
        }
    }
    Ok(())
}

fn reject_secret_setting(namespace: &str, key: &str, value: &serde_json::Value) -> DbResult<()> {
    let key_lower = key.to_ascii_lowercase();
    let known_reference_metadata = key_lower == "secretname" || key_lower == "hassecret";
    let sensitive_key = sensitive_field_name(&key_lower);
    if sensitive_key && !known_reference_metadata {
        return Err(DbError::Validation(format!(
            "backup setting looks like secret material: {namespace}.{key}"
        )));
    }
    if value.as_str().is_some_and(looks_like_secret_text) {
        return Err(DbError::Validation(format!(
            "backup setting contains plaintext secret material: {namespace}.{key}"
        )));
    }
    Ok(())
}

fn reject_json_secret_material(value: &serde_json::Value, location: &str) -> DbResult<()> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, child) in object {
                let key_lower = key.to_ascii_lowercase();
                let metadata_only = key_lower == "secretname" || key_lower == "hassecret";
                if sensitive_field_name(&key_lower) && !metadata_only && !child.is_null() {
                    return Err(DbError::Validation(format!(
                        "backup JSON contains secret-bearing field {key} at {location}"
                    )));
                }
                reject_json_secret_material(child, location)?;
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                reject_json_secret_material(child, location)?;
            }
        }
        serde_json::Value::String(text) if looks_like_secret_text(text) => {
            return Err(DbError::Validation(format!(
                "backup JSON contains plaintext secret material at {location}"
            )))
        }
        _ => {}
    }
    Ok(())
}

fn sensitive_field_name(key_lower: &str) -> bool {
    key_lower.contains("api_key")
        || key_lower.contains("apikey")
        || key_lower.contains("password")
        || key_lower == "secret"
        || key_lower == "token"
        || key_lower == "accesstoken"
        || key_lower == "access_token"
        || key_lower == "authtoken"
        || key_lower == "auth_token"
}

fn looks_like_secret_text(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("sk-")
        || trimmed.starts_with("sk_")
        || trimmed.starts_with("AIza")
        || trimmed.starts_with("xoxb-")
        || trimmed.starts_with("xoxp-")
        || trimmed.to_ascii_lowercase().starts_with("bearer ")
}

fn verify_checksum(package: &BackupPackage) -> DbResult<()> {
    if package.manifest.schema_version >= 2 && package.manifest.checksum_sha256.is_empty() {
        return Err(DbError::Validation(
            "checksum_sha256 is required for snapshot backup schemas".into(),
        ));
    }
    let expected = checksum_package(package)?;
    if !package.manifest.checksum_sha256.is_empty() && package.manifest.checksum_sha256 != expected
    {
        return Err(DbError::Validation(format!(
            "checksum mismatch: manifest {} computed {}",
            package.manifest.checksum_sha256, expected
        )));
    }
    Ok(())
}

fn checksum_package(package: &BackupPackage) -> DbResult<String> {
    let mut for_hash = package.clone();
    for_hash.manifest.checksum_sha256.clear();
    let bytes = serde_json::to_vec(&for_hash).map_err(|e| DbError::Message(e.to_string()))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn load_all_attempts(conn: &Connection) -> DbResult<Vec<AttemptRecord>> {
    let mut attempts = load_all_attempt_summaries(conn)?;
    for attempt in &mut attempts {
        let mut answer_stmt = conn.prepare(
            "SELECT question_id, answer_json, is_correct, weight, question_kind, change_count,
                    visit_count, elapsed_ms, marked, answered_at
             FROM attempt_answers WHERE attempt_id = ?1 ORDER BY question_id",
        )?;
        let answers = answer_stmt.query_map(params![attempt.id], |row| {
            let answer_json: String = row.get(1)?;
            Ok(ielts_domain::AttemptAnswer {
                question_id: row.get(0)?,
                answer: serde_json::from_str(&answer_json).unwrap_or(serde_json::Value::Null),
                is_correct: row.get::<_, Option<i64>>(2)?.map(|value| value != 0),
                weight: row.get(3)?,
                question_kind: row.get(4)?,
                change_count: row.get::<_, i64>(5)? as u32,
                visit_count: row.get::<_, i64>(6)? as u32,
                elapsed_ms: row.get::<_, i64>(7)? as u64,
                marked: row.get::<_, i64>(8)? != 0,
                answered_at: row.get(9)?,
            })
        })?;
        for answer in answers {
            attempt.answers.push(answer?);
        }

        let mut annotation_stmt = conn.prepare(
            "SELECT id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text
             FROM attempt_annotations WHERE attempt_id = ?1 ORDER BY id",
        )?;
        let annotations = annotation_stmt.query_map(params![attempt.id], |row| {
            let anchor_json: String = row.get(6)?;
            Ok(ielts_domain::AttemptAnnotationDto {
                id: row.get(0)?,
                attempt_id: row.get(1)?,
                asset_id: row.get(2)?,
                scope: row.get(3)?,
                question_id: row.get(4)?,
                kind: row.get(5)?,
                anchor: serde_json::from_str(&anchor_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
                note_text: row.get(7)?,
            })
        })?;
        for annotation in annotations {
            attempt.annotations.push(annotation?);
        }
    }
    Ok(attempts)
}

fn load_all_attempt_summaries(conn: &Connection) -> DbResult<Vec<AttemptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, task_type
         FROM attempts
         ORDER BY COALESCE(submitted_at, started_at) DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
        Ok(AttemptRecord {
            schema_version: row.get::<_, i64>(17)? as u32,
            id: row.get(0)?,
            activity: match row.get::<_, String>(1)?.as_str() {
                "writing" => Activity::Writing,
                _ => Activity::Reading,
            },
            asset_id: row.get(2)?,
            mode: match row.get::<_, String>(3)?.as_str() {
                "suite" => AttemptMode::Suite,
                "endless" => AttemptMode::Endless,
                "memorize" => AttemptMode::Memorize,
                "freeform" => AttemptMode::Freeform,
                "bank" => AttemptMode::Bank,
                _ => AttemptMode::Single,
            },
            suite_id: row.get(4)?,
            status: match row.get::<_, String>(5)?.as_str() {
                "draft" => AttemptStatus::Draft,
                "active" => AttemptStatus::Active,
                "submitted" => AttemptStatus::Submitted,
                "reviewing" => AttemptStatus::Reviewing,
                "cancelled" => AttemptStatus::Cancelled,
                "failed" => AttemptStatus::Failed,
                "interrupted" => AttemptStatus::Interrupted,
                _ => AttemptStatus::Completed,
            },
            started_at: row.get(6)?,
            submitted_at: row.get(7)?,
            completed_at: row.get(8)?,
            duration_ms: row.get::<_, i64>(9)? as u64,
            score_value: row.get(10)?,
            score_scale: row
                .get::<_, Option<String>>(11)?
                .and_then(|scale| match scale.as_str() {
                    "ratio" => Some(ScoreScale::Ratio),
                    "band9" => Some(ScoreScale::Band9),
                    _ => None,
                }),
            correct_count: row.get(12)?,
            question_count: row.get::<_, Option<i64>>(13)?.map(|value| value as u32),
            title_snapshot: row.get(14)?,
            prompt_snapshot: row.get(15)?,
            content_text: row.get(16)?,
            task_type: parse_writing_task_type(row.get(18)?),
            answers: Vec::new(),
            annotations: Vec::new(),
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// Keep these imports part of the public compatibility surface documented by
// this module even when feature combinations trim callers.
#[allow(dead_code)]
fn _touch_secret_ref(_: &SecretRef) {}
#[allow(dead_code)]
fn _touch_setting(_: &SettingEntry) {}
