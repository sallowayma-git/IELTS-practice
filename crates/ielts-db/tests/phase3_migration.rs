use ielts_db::migrate::{migrate, open_and_migrate, verify_idempotent};
use ielts_db::sqlite::{checkpoint_wal, open_connection, DbOpenOptions};
use tempfile::tempdir;

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
fn migrate_function_transactional_versions() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("m.db");
    let mut conn = open_connection(&DbOpenOptions::create(path)).unwrap();
    let applied = migrate(&mut conn).unwrap();
    assert_eq!(
        applied,
        vec![
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31, 32, 33
        ]
    );
    let applied_again = migrate(&mut conn).unwrap();
    assert!(applied_again.is_empty());
}
