//! Data isolation and delete safety: the raw-data delete gate, the ledger's
//! RESTRICT foreign key, pre-destructive snapshots, operational retention,
//! the weekly digest table, the atomic backup writer and the restore preview.

use std::thread::sleep;
use std::time::Duration;

use ielts_db::{
    build_daily_facts, create_backup_package, delete_attempt, delete_history_attempts,
    finish_dream_run, format17_attempt_summaries, get_history_retention_policy, import_backup,
    insert_dream_run, insert_journal, migrate, open_connection,
    prune_operational_records, prune_terminal_attempts_in_transaction, put_weekly_digest,
    read_backup_file, snapshot_before, start_dream_run, upsert_attempt, upsert_setting,
    with_delete_gate, write_backup_file, DbError, DbOpenOptions, WeeklyDigestProse,
    OPERATIONAL_RETENTION_DAYS, SNAPSHOT_KEEP,
};
use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::AttemptRecord;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn terminal_attempt(id: &str, day: u32) -> AttemptRecord {
    let stamp = format!("2026-01-{day:02}T00:00:00Z");
    AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: id.into(),
        activity: Activity::Reading,
        asset_id: None,
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: stamp.clone(),
        submitted_at: Some(stamp.clone()),
        completed_at: Some(stamp),
        duration_ms: 1,
        score_value: Some(1.0),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(1.0),
        question_count: Some(1),
        title_snapshot: Some(id.into()),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![],
        annotations: vec![],
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

/// A completed dream run to hang a digest on.
fn dream_run(conn: &Connection) -> String {
    let facts = build_daily_facts(conn, "local", "2026-10-10").unwrap();
    let journal = insert_journal(conn, "local", &facts, None).unwrap().id;
    let run = insert_dream_run(conn, "local", &journal, Some("weekly:2026-W41:x")).unwrap();
    start_dream_run(conn, &run.id, "2026-10-10T09:00:00Z").unwrap();
    finish_dream_run(conn, &run.id, "out", "2026-10-10T09:01:00Z").unwrap();
    run.id
}

fn gate_open(conn: &Connection) -> i64 {
    count(conn, "SELECT open FROM delete_gate WHERE singleton = 1")
}

/// A ledger event attached to `attempt_id`, enough for the foreign key and the
/// observation rebuild.
fn insert_ledger_event(conn: &Connection, id: &str, attempt_id: &str) {
    conn.execute(
        "INSERT INTO learning_events (id, event_type, source_kind, idempotency_key, activity,
            attempt_id, occurred_at, payload_json, content_hash, created_at, updated_at)
         VALUES (?1, 'attempt_submitted', 'attempt', ?1, 'reading', ?2,
                 '2026-01-01T00:00:00Z', '{}', 'hash', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id, attempt_id],
    )
    .unwrap();
}

// ---- migration 0027: unlimited by default -------------------------------

#[test]
fn fresh_install_is_unlimited_and_submitting_never_prunes() {
    let (_dir, conn) = open_db();
    assert_eq!(get_history_retention_policy(&conn).unwrap().max_terminal_attempts, None);
    for day in 0..120 {
        upsert_attempt(&conn, &terminal_attempt(&format!("a{day}"), 1 + day % 28)).unwrap();
    }
    let tx = conn.unchecked_transaction().unwrap();
    let pruned = prune_terminal_attempts_in_transaction(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(pruned, 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM attempts"), 120);
}

#[test]
fn an_explicit_limit_is_the_only_thing_that_prunes() {
    let (_dir, conn) = open_db();
    for day in 0..60 {
        upsert_attempt(&conn, &terminal_attempt(&format!("b{day}"), 1 + day % 28)).unwrap();
    }
    ielts_db::set_history_retention_policy(&conn, Some(50)).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM attempts"), 50);
}

// ---- the delete gate -----------------------------------------------------

#[test]
fn raw_deletes_outside_the_helper_are_refused() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("g1", 1)).unwrap();
    let error = conn
        .execute("DELETE FROM attempts WHERE id = 'g1'", [])
        .unwrap_err();
    assert!(error.to_string().contains("delete_gate"), "{error}");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM attempts WHERE id = 'g1'"), 1);
}

#[test]
fn cascades_cannot_bypass_the_gate() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("g2", 1)).unwrap();
    conn.execute(
        "INSERT INTO writing_evaluations (id, attempt_id, status, stage, rubric_version, prompt_version,
            result_json, degradation_json, started_at, updated_at)
         VALUES ('ev-g2', 'g2', 'completed', 'done', 'ielts-v1', 'default', '{}', '{}', NULL, '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    // The attempt row is gated, so its cascade into the evaluation never starts.
    assert!(conn.execute("DELETE FROM attempts WHERE id = 'g2'", []).is_err());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM writing_evaluations"), 1);
}

#[test]
fn gated_work_is_allowed_and_the_gate_closes_again() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("g3", 1)).unwrap();
    let deleted = with_delete_gate(&conn, || {
        Ok(conn.execute("DELETE FROM attempts WHERE id = 'g3'", [])?)
    })
    .unwrap();
    assert_eq!(deleted, 1);
    assert_eq!(gate_open(&conn), 0);
}

#[test]
fn gate_is_closed_and_work_rolled_back_after_an_error() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("g4", 1)).unwrap();
    let result: Result<(), DbError> = with_delete_gate(&conn, || {
        conn.execute("DELETE FROM attempts WHERE id = 'g4'", [])?;
        Err(DbError::Message("boom after the delete".into()))
    });
    assert!(result.is_err());
    assert_eq!(gate_open(&conn), 0, "the gate must be closed after an error");
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM attempts WHERE id = 'g4'"),
        1,
        "gated work is all-or-nothing"
    );
    assert!(conn.execute("DELETE FROM attempts WHERE id = 'g4'", []).is_err());
}

#[test]
fn user_delete_paths_run_through_the_gate() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("u1", 1)).unwrap();
    upsert_attempt(&conn, &terminal_attempt("u2", 2)).unwrap();
    assert!(delete_attempt(&conn, "u1").unwrap());
    assert_eq!(delete_history_attempts(&conn, &["u2".into()]).unwrap(), 1);
    assert_eq!(gate_open(&conn), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM attempts"), 0);
}

#[test]
fn bulk_delete_refuses_more_than_200_ids() {
    let (_dir, conn) = open_db();
    let ids: Vec<String> = (0..201).map(|index| format!("x{index}")).collect();
    assert!(delete_history_attempts(&conn, &ids).is_err());
}

// ---- ledger RESTRICT (migration 0028) ----------------------------------

#[test]
fn a_ledger_row_blocks_an_attempt_delete_that_is_not_the_explicit_path() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("l1", 1)).unwrap();
    insert_ledger_event(&conn, "ev-l1", "l1");
    let error = with_delete_gate(&conn, || {
        Ok(conn.execute("DELETE FROM attempts WHERE id = 'l1'", [])?)
    })
    .unwrap_err();
    assert!(error.to_string().to_lowercase().contains("foreign key"), "{error}");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_events WHERE id = 'ev-l1'"), 1);
}

#[test]
fn explicit_attempt_delete_removes_only_its_own_ledger_rows() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("l2", 1)).unwrap();
    upsert_attempt(&conn, &terminal_attempt("l3", 2)).unwrap();
    insert_ledger_event(&conn, "ev-l2", "l2");
    insert_ledger_event(&conn, "ev-l3", "l3");
    assert!(delete_attempt(&conn, "l2").unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_events WHERE id = 'ev-l2'"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM learning_events WHERE id = 'ev-l3'"), 1);
}

// ---- pre-destructive snapshots ------------------------------------------

#[test]
fn snapshot_is_written_verified_and_rotated_to_three() {
    let (dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("s1", 1)).unwrap();
    let backups = dir.path().join("backups");
    let mut written = Vec::new();
    for _ in 0..(SNAPSHOT_KEEP + 2) {
        written.push(snapshot_before(&conn, &backups, "clear-history").unwrap());
        // Millisecond names: keep each stamp distinct.
        sleep(Duration::from_millis(3));
    }
    let mut names: Vec<String> = std::fs::read_dir(&backups)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names.len(), SNAPSHOT_KEEP, "{names:?}");
    assert!(names
        .iter()
        .all(|name| name.starts_with("pre-clear-history-") && name.ends_with(".db")));
    assert!(written.last().unwrap().exists());
    assert!(!written[0].exists());
    let snapshot = Connection::open(written.last().unwrap()).unwrap();
    assert_eq!(count(&snapshot, "SELECT COUNT(*) FROM attempts"), 1);
}

#[test]
fn snapshot_rejects_bad_names_and_open_transactions() {
    let (dir, conn) = open_db();
    let backups = dir.path().join("backups");
    assert!(snapshot_before(&conn, &backups, "Bad Name").is_err());
    assert!(snapshot_before(&conn, &backups, "").is_err());
    conn.execute_batch("BEGIN").unwrap();
    assert!(snapshot_before(&conn, &backups, "restore").is_err());
    conn.execute_batch("ROLLBACK").unwrap();
}

// ---- operational retention ----------------------------------------------

#[test]
fn operational_prune_removes_old_trace_rows_and_keeps_raw_data() {
    let (_dir, conn) = open_db();
    upsert_attempt(&conn, &terminal_attempt("o1", 1)).unwrap();
    let old = "2025-01-01T00:00:00+00:00";
    let fresh = "2026-10-01T00:00:00+00:00";
    conn.execute(
        "INSERT INTO llm_invocations (id, kind, request_hash, created_at) VALUES ('llm-old', 'completion', 'h', ?1)",
        [old],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO llm_invocations (id, kind, request_hash, created_at) VALUES ('llm-new', 'completion', 'h', ?1)",
        [fresh],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, provider_id, model, status, created_at, updated_at, completed_at)
         VALUES ('run-old', 'p', 'm', 'completed', ?1, ?1, ?1)",
        [old],
    )
    .unwrap();
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-11T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let report = prune_operational_records(&conn, now, OPERATIONAL_RETENTION_DAYS).unwrap();
    assert_eq!(report.llm_invocations, 1);
    assert_eq!(report.agent_runs, 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM llm_invocations WHERE id = 'llm-new'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM attempts WHERE id = 'o1'"), 1);
}

// ---- weekly digests (migration 0029) ------------------------------------

#[test]
fn legacy_digest_settings_rows_move_into_the_table() {
    let (_dir, conn) = open_db();
    let run_id = dream_run(&conn);
    let prose = WeeklyDigestProse {
        observations: vec!["Missed tfng twice".into()],
        ..Default::default()
    };
    // The legacy shape: a settings row keyed by the run id.
    conn.execute(
        "INSERT INTO settings (namespace, key, value_json, updated_at)
         VALUES ('weekly_digest', ?1, ?2, '2026-10-10T09:02:00Z')",
        params![run_id, serde_json::to_string(&prose).unwrap()],
    )
    .unwrap();
    let tx = conn.unchecked_transaction().unwrap();
    let moved = ielts_db::dream::move_settings_weekly_digests_in_transaction(&tx).unwrap();
    tx.commit().unwrap();
    assert_eq!(moved, 1);
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM settings WHERE namespace = 'weekly_digest'"),
        0
    );
    assert_eq!(
        count(&conn, &format!("SELECT COUNT(*) FROM weekly_digests WHERE run_id = '{run_id}'")),
        1
    );
    put_weekly_digest(&conn, &run_id, &prose, "2026-10-10T09:03:00Z").unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM weekly_digests"), 1);
}

// ---- backup format 18 ----------------------------------------------------

#[test]
fn format_18_backup_writes_attempts_once_and_writes_atomically() {
    let (dir, source) = open_db();
    upsert_attempt(&source, &terminal_attempt("bk1", 1)).unwrap();
    let package = create_backup_package(&source, "test").unwrap();
    assert_eq!(package.manifest.schema_version, 18);
    assert!(package.attempts.is_empty());
    assert_eq!(package.manifest.attempt_count, 1);

    let path = dir.path().join("ielts-backup-1.json");
    write_backup_file(&package, &path).unwrap();
    assert!(!dir.path().join("ielts-backup-1.json.tmp").exists());
    let json = std::fs::read_to_string(&path).unwrap();
    let top: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(top.get("attempts").is_none(), "the attempts summary array must not be written");
    assert_eq!(read_backup_file(&path).unwrap(), package);
}

#[test]
fn format_17_backup_with_a_summary_array_still_restores_and_carries_digests() {
    let (_dir, source) = open_db();
    upsert_attempt(&source, &terminal_attempt("old1", 1)).unwrap();
    let run_id = dream_run(&source);
    upsert_setting(
        &source,
        "weekly_digest",
        &run_id,
        &serde_json::json!({"observations": ["Read the stem first"], "changes": [], "nextPractice": []}),
    )
    .unwrap();

    // Fabricate what format 17 wrote: no weekly_digests table, the summary array
    // present, and a checksum over that exact shape.
    let mut legacy = create_backup_package(&source, "v17").unwrap();
    legacy.manifest.schema_version = 17;
    legacy.database.retain(|table| table.name != "weekly_digests");
    legacy.manifest.table_count = legacy.database.len() as u32;
    legacy.manifest.row_count = legacy
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + legacy.secret_refs.len() as u64;
    legacy.attempts = format17_attempt_summaries(&source).unwrap();
    legacy.manifest.checksum_sha256.clear();
    legacy.manifest.checksum_sha256 =
        hex::encode(Sha256::digest(serde_json::to_vec(&legacy).unwrap()));

    let (_dir2, target) = open_db();
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(count(&target, "SELECT COUNT(*) FROM attempts"), 1);
    assert_eq!(
        count(&target, "SELECT COUNT(*) FROM settings WHERE namespace = 'weekly_digest'"),
        0
    );
    assert_eq!(count(&target, "SELECT COUNT(*) FROM weekly_digests"), 1);
}

#[test]
fn dry_run_reports_what_a_restore_would_replace() {
    let (_dir, source) = open_db();
    upsert_attempt(&source, &terminal_attempt("d1", 1)).unwrap();
    upsert_attempt(&source, &terminal_attempt("d2", 2)).unwrap();
    let package = create_backup_package(&source, "delta").unwrap();

    let (_dir2, target) = open_db();
    upsert_attempt(&target, &terminal_attempt("t1", 3)).unwrap();
    let report = import_backup(&target, &package, true).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    let delta = report.delta.expect("delta is reported");
    assert_eq!(delta.current.attempts, 1);
    assert_eq!(delta.incoming.attempts, 2);
    assert_eq!(count(&target, "SELECT COUNT(*) FROM attempts"), 1, "dry run changes nothing");
}

#[test]
fn a_pending_migration_is_preceded_by_a_snapshot_and_a_current_database_is_not() {
    let dir = tempdir().unwrap();
    let backups = dir.path().join("backups");
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    // Current database: nothing pending, nothing snapshotted.
    ielts_db::migrate_with_snapshot(&mut conn, &backups).unwrap();
    assert!(!backups.exists() || std::fs::read_dir(&backups).unwrap().next().is_none());

    // Pretend the last migration has not run yet.
    // 0031 adds a column, so undo it before forgetting it ran.
    conn.execute_batch(
        "ALTER TABLE coach_threads DROP COLUMN learner_profile_json;
         DELETE FROM schema_migrations WHERE version = 31;",
    )
    .unwrap();
    assert!(ielts_db::has_pending_migrations(&conn).unwrap());
    ielts_db::migrate_with_snapshot(&mut conn, &backups).unwrap();
    let snapshots: Vec<_> = std::fs::read_dir(&backups)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(snapshots.len(), 1, "{snapshots:?}");
    assert!(snapshots[0].starts_with("pre-migrate-"));
    assert_eq!(ielts_db::current_version(&conn).unwrap(), 31);
}

#[test]
fn a_pre_0027_backup_restores_its_untouched_retention_default_as_unlimited() {
    let (_dir, source) = open_db();
    // The row migration 0008 wrote and 0027 would have normalised.
    source
        .execute(
            "UPDATE history_retention_policy SET max_terminal_attempts = 100, updated_at = '2026-01-01T00:00:00Z'",
            [],
        )
        .unwrap();
    let mut legacy = create_backup_package(&source, "pre-0027").unwrap();
    legacy.manifest.database_schema_version = 26;
    legacy.manifest.checksum_sha256.clear();
    legacy.manifest.checksum_sha256 =
        hex::encode(Sha256::digest(serde_json::to_vec(&legacy).unwrap()));

    let (_dir2, target) = open_db();
    let report = import_backup(&target, &legacy, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(get_history_retention_policy(&target).unwrap().max_terminal_attempts, None);
}

#[test]
fn rotation_is_per_operation_so_a_migration_copy_survives_clear_history_churn() {
    let (dir, conn) = open_db();
    let backups = dir.path().join("backups");
    let migrate_copy = snapshot_before(&conn, &backups, "migrate").unwrap();
    sleep(Duration::from_millis(3));
    for _ in 0..(SNAPSHOT_KEEP + 3) {
        snapshot_before(&conn, &backups, "clear-history").unwrap();
        sleep(Duration::from_millis(3));
    }
    assert!(migrate_copy.exists(), "the only pre-migrate copy must survive");
    let clear_count = std::fs::read_dir(&backups)
        .unwrap()
        .filter(|entry| {
            entry.as_ref().unwrap().file_name().to_string_lossy().starts_with("pre-clear-history-")
        })
        .count();
    assert_eq!(clear_count, SNAPSHOT_KEEP);
}

#[test]
fn a_failed_rotation_does_not_fail_a_verified_snapshot() {
    let (dir, conn) = open_db();
    let backups = dir.path().join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    // The oldest "snapshot" is a directory: rotation cannot delete it.
    std::fs::create_dir_all(backups.join("pre-clear-history-1.db")).unwrap();
    let mut written = Vec::new();
    for _ in 0..SNAPSHOT_KEEP {
        written.push(snapshot_before(&conn, &backups, "clear-history").unwrap());
        sleep(Duration::from_millis(3));
    }
    // Rotation failed on the stale entry, yet every new snapshot was returned and
    // is a real file on disk.
    for path in written {
        assert!(path.is_file(), "{}", path.display());
    }
}
