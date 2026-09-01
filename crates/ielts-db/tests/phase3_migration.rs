use std::path::PathBuf;

use ielts_db::import::{
    import_browser_export_file, import_reading_archive_file, migrate_legacy_sqlite_to_v2,
    scan_legacy_sqlite,
};
use ielts_db::migrate::{migrate, open_and_migrate, verify_idempotent};
use ielts_db::shadow::{compare_history_views, shadow_read_from_db};
use ielts_db::sqlite::{checkpoint_wal, open_connection, DbOpenOptions};
use rusqlite::Connection;
use tempfile::tempdir;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

#[test]
fn migration_applies_and_is_idempotent() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("v2.db");
    let mut conn = open_and_migrate(&db_path).expect("migrate");
    verify_idempotent(&mut conn).expect("idempotent");
    checkpoint_wal(&conn).expect("checkpoint");
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(version >= 23, "migration 0023 was not applied, got {version}");
}

#[test]
fn import_reading_archive_and_shadow_match() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("v2.db");
    let conn = open_and_migrate(&db_path).unwrap();
    let archive = repo_root()
        .join("tests/fixtures/legacy-data/reading-archive/reading-archive-v1-sample.json");
    let report = import_reading_archive_file(&conn, &archive).unwrap();
    assert_eq!(report.imported, 1);
    assert_eq!(report.failed, 0);

    let vms = ielts_db::list_history_view_models(&conn).unwrap();
    assert_eq!(vms.len(), 1);
    assert_eq!(vms[0].title, "A Brief History of Tea");
    assert_eq!(vms[0].score_label, "Accuracy");

    // shadow against itself must be clean
    let shadow = shadow_read_from_db(&conn, &vms).unwrap();
    assert_eq!(shadow.matched, 1);
    assert!(shadow.diffs.is_empty());
}

#[test]
fn import_browser_export_settings_and_records() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("v2.db");
    let conn = open_and_migrate(&db_path).unwrap();
    let path =
        repo_root().join("tests/fixtures/legacy-data/browser-export/legacy-browser-export-v1.json");
    let report = import_browser_export_file(&conn, &path).unwrap();
    assert_eq!(report.practice_records, 1);
    assert!(report.settings >= 2);
    assert!(report.errors.is_empty());
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM attempts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn legacy_sqlite_scan_and_migrate() {
    let dir = tempdir().unwrap();
    let legacy_path = dir.path().join("ielts-writing.db");
    let v2_path = dir.path().join("v2.db");
    let backup_dir = dir.path().join("backups");
    std::fs::create_dir_all(&backup_dir).unwrap();

    // Build a minimal legacy DB matching electron schema subsets.
    {
        let conn = Connection::open(&legacy_path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE essays (
              id INTEGER PRIMARY KEY,
              topic_id INTEGER,
              topic_text TEXT,
              task_type TEXT NOT NULL,
              content TEXT NOT NULL,
              word_count INTEGER NOT NULL,
              llm_provider TEXT NOT NULL,
              model_name TEXT NOT NULL,
              total_score REAL,
              task_achievement REAL,
              coherence_cohesion REAL,
              lexical_resource REAL,
              grammatical_range REAL,
              evaluation_json TEXT NOT NULL,
              submitted_at TEXT
            );
            CREATE TABLE practice_history_records (
              id TEXT PRIMARY KEY,
              activity TEXT NOT NULL,
              session_id TEXT NOT NULL UNIQUE,
              asset_id TEXT,
              exam_id TEXT,
              title TEXT NOT NULL,
              status TEXT NOT NULL,
              score REAL NOT NULL DEFAULT 0,
              total_questions INTEGER NOT NULL DEFAULT 0,
              correct_answers REAL NOT NULL DEFAULT 0,
              accuracy REAL NOT NULL DEFAULT 0,
              duration INTEGER NOT NULL DEFAULT 0,
              submitted_at TEXT NOT NULL,
              started_at TEXT,
              ended_at TEXT NOT NULL,
              metadata_json TEXT NOT NULL,
              submission_json TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO essays(
              id, topic_id, topic_text, task_type, content, word_count, llm_provider, model_name,
              total_score, task_achievement, coherence_cohesion, lexical_resource, grammatical_range,
              evaluation_json, submitted_at
            ) VALUES (
              1, 9, 'Practical skills topic', 'task2', 'Essay body', 280, 'openai', 'gpt',
              6.5, 6.5, 6.0, 6.5, 6.0,
              '{"status":"completed","feedback":"ok","improvement_plan":["plan"],"review_degraded":false}',
              '2025-01-01T10:00:00.000Z'
            );
            INSERT INTO practice_history_records(
              id, activity, session_id, asset_id, exam_id, title, status, score, total_questions,
              correct_answers, accuracy, duration, submitted_at, started_at, ended_at, metadata_json, submission_json
            ) VALUES (
              'hist-1', 'reading', 'sess-1', 'p1-high-01', 'p1-high-01', 'A Brief History of Tea', 'completed',
              11, 13, 11, 0.846, 1400, '2025-01-15T11:55:00.000Z', '2025-01-15T11:30:00.000Z',
              '2025-01-15T11:55:00.000Z', '{}', NULL
            );
            "#,
        )
        .unwrap();
    }

    let scan = scan_legacy_sqlite(&legacy_path).unwrap();
    assert!(scan.readable);
    assert_eq!(scan.essays, 1);
    assert_eq!(scan.practice_history_records, 1);

    let report = migrate_legacy_sqlite_to_v2(&legacy_path, &v2_path, Some(&backup_dir)).unwrap();
    assert_eq!(report.history_imported, 1);
    assert_eq!(report.essays_imported, 1);
    assert_eq!(report.target_attempts, 2);
    assert!(report.errors.is_empty());
    assert!(backup_dir.read_dir().unwrap().any(|e| e
        .unwrap()
        .path()
        .extension()
        .and_then(|x| x.to_str())
        == Some("db")));

    // Old DB still has original rows (read-only migration source).
    let legacy = open_connection(&DbOpenOptions::read_only(legacy_path)).unwrap();
    let essays: i64 = legacy
        .query_row("SELECT COUNT(*) FROM essays", [], |r| r.get(0))
        .unwrap();
    assert_eq!(essays, 1);

    let v2 = open_connection(&DbOpenOptions::read_only(v2_path)).unwrap();
    let vms = ielts_db::list_history_view_models(&v2).unwrap();
    assert_eq!(vms.len(), 2);

    // Shadow: rebuild expected from imported attempts via list (self compare).
    let shadow = compare_history_views(&vms, &vms);
    assert_eq!(shadow.matched, 2);
    assert!(shadow.diffs.is_empty());
}

#[test]
fn migrate_function_transactional_versions() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("m.db");
    let mut conn = open_connection(&DbOpenOptions::create(path)).unwrap();
    let applied = migrate(&mut conn).unwrap();
    assert_eq!(
        applied,
        vec![
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24
        ]
    );
    let applied_again = migrate(&mut conn).unwrap();
    assert!(applied_again.is_empty());
}
