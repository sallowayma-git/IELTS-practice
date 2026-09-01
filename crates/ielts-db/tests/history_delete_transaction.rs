//! History deletion is a server-side transaction, not a frontend loop that can
//! leave the learner with a half-deleted timeline after one IPC failure.

use ielts_domain::domain::Activity;
use ielts_domain::dto::ListHistoryQuery;
use tempfile::tempdir;

use ielts_db::{
    clear_history, delete_history_attempts, list_history, migrate, open_connection, DbOpenOptions,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn =
        open_connection(&DbOpenOptions::create(dir.path().join("history-delete.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn insert_attempt(conn: &rusqlite::Connection, id: &str, status: &str) {
    let now = "2026-07-16T00:00:00Z";
    conn.execute(
        "INSERT INTO attempts (
            id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
            completed_at, duration_ms, score_value, score_scale, correct_count,
            question_count, title_snapshot, prompt_snapshot, content_text,
            schema_version, created_at, updated_at, task_type
         ) VALUES (?1, 'writing', NULL, 'freeform', NULL, ?2, ?3, ?3, ?3,
                   0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, ?3, ?3, 'task2')",
        rusqlite::params![id, status, now],
    )
    .unwrap();
}

fn attempt_exists(conn: &rusqlite::Connection, id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM attempts WHERE id = ?1)",
        rusqlite::params![id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
        != 0
}

#[test]
fn bulk_delete_rejects_open_attempts_without_partial_mutation() {
    let (_dir, conn) = open_db();
    insert_attempt(&conn, "terminal-history", "completed");
    insert_attempt(&conn, "open-draft", "draft");

    let error = delete_history_attempts(&conn, &["terminal-history".into(), "open-draft".into()])
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("only terminal history attempts may be deleted"));
    assert!(attempt_exists(&conn, "terminal-history"));
    assert!(attempt_exists(&conn, "open-draft"));

    let deleted = delete_history_attempts(&conn, &["terminal-history".into()]).unwrap();
    assert_eq!(deleted, 1);
    assert!(!attempt_exists(&conn, "terminal-history"));
    assert!(attempt_exists(&conn, "open-draft"));
}

#[test]
fn clear_history_removes_only_terminal_records_for_the_requested_activity() {
    let (_dir, conn) = open_db();
    insert_attempt(&conn, "completed-history", "completed");
    insert_attempt(&conn, "failed-history", "failed");
    insert_attempt(&conn, "reviewing-work", "reviewing");

    assert_eq!(clear_history(&conn, Some(Activity::Writing)).unwrap(), 2);
    assert!(!attempt_exists(&conn, "completed-history"));
    assert!(!attempt_exists(&conn, "failed-history"));
    assert!(attempt_exists(&conn, "reviewing-work"));
}

#[test]
fn history_list_excludes_submitted_and_reviewing_workflow_state() {
    let (_dir, conn) = open_db();
    insert_attempt(&conn, "completed-history", "completed");
    insert_attempt(&conn, "submitted-work", "submitted");
    insert_attempt(&conn, "reviewing-work", "reviewing");

    let page = list_history(
        &conn,
        &ListHistoryQuery {
            activity: Some(Activity::Writing),
            limit: 20,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, "completed-history");
}
