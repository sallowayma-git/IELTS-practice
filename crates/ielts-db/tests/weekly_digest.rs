//! Weekly dream receipts: the `dream_runs` marker carries the weekend key (the
//! per-weekend idempotency key) and the window the run covered.

use chrono::{DateTime, Utc};
use ielts_db::{
    build_daily_facts, finish_dream_run, insert_dream_run, insert_journal, last_weekly_window_end,
    migrate, open_connection, start_dream_run,
    weekly_failed_attempt_count, weekly_run_completed, DbOpenOptions, WeeklyWindow,
};
use rusqlite::Connection;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn journal_for(conn: &Connection, day: &str) -> String {
    let facts = build_daily_facts(conn, "local", day).unwrap();
    insert_journal(conn, "local", &facts, None).unwrap().id
}

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn window(key: &str, start: &str, end: &str) -> WeeklyWindow {
    WeeklyWindow::new(key, at(start), at(end))
}

fn complete_run(conn: &Connection, journal: &str, input_hash: Option<&str>, at: &str) -> String {
    let run = insert_dream_run(conn, "local", journal, input_hash).unwrap();
    start_dream_run(conn, &run.id, at).unwrap();
    finish_dream_run(conn, &run.id, "out", at).unwrap();
    run.id
}

#[test]
fn weekly_receipt_is_keyed_by_weekend_and_ignores_other_runs() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let saturday = window("2026-W41", "2026-10-03T04:00:00Z", "2026-10-10T09:30:00Z");
    assert!(!weekly_run_completed(&conn, "local", "2026-W41").unwrap());

    // A run with another input is not a weekly receipt.
    complete_run(&conn, &journal, Some("source-hash"), "2026-10-10T10:00:00Z");
    assert!(!weekly_run_completed(&conn, "local", "2026-W41").unwrap());

    // A weekly run that did not finish is not a receipt either.
    let pending = insert_dream_run(&conn, "local", &journal, Some(&saturday.marker())).unwrap();
    start_dream_run(&conn, &pending.id, "2026-10-10T09:31:00Z").unwrap();
    assert!(!weekly_run_completed(&conn, "local", "2026-W41").unwrap());

    complete_run(&conn, &journal, Some(&saturday.marker()), "2026-10-10T09:32:00Z");
    assert!(weekly_run_completed(&conn, "local", "2026-W41").unwrap());
    // Sunday of the same weekend has the same key; the next weekend does not.
    assert!(!weekly_run_completed(&conn, "local", "2026-W42").unwrap());
    // A key that is a prefix of another is not the same weekend.
    assert!(!weekly_run_completed(&conn, "local", "2026-W4").unwrap());
}

#[test]
fn the_next_window_starts_where_the_last_completed_one_ended() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    assert_eq!(last_weekly_window_end(&conn, "local").unwrap(), None);

    // A failed attempt never moves the boundary: its span was not consolidated.
    ielts_db::record_failed_weekly_run(
        &conn, "local", &journal, "2026-W41",
        &serde_json::json!({"code": "journal.weekly_failed"}), "2026-10-10T09:30:00Z",
    ).unwrap();
    assert_eq!(last_weekly_window_end(&conn, "local").unwrap(), None);

    complete_run(&conn, &journal, Some("weekly:2026-W33"), "2026-08-17T01:00:00Z");
    assert_eq!(last_weekly_window_end(&conn, "local").unwrap(), Some(at("2026-08-16T23:59:59Z")));

    let latest = window("2026-W41", "2026-08-16T23:59:59Z", "2026-10-10T09:30:00Z");
    complete_run(&conn, &journal, Some(&latest.marker()), "2026-10-10T09:31:00Z");
    assert_eq!(last_weekly_window_end(&conn, "local").unwrap(), Some(latest.end));
}

#[test]
fn failed_weekly_attempt_is_not_a_receipt_and_bounds_retries_to_one_per_day() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let error = serde_json::json!({"code": "journal.weekly_failed", "message": "provider timeout"});
    let day_start = |day: &str| format!("{day}T00:00:00Z");
    assert!(!ielts_db::weekly_attempted_since(&conn, "local", "2026-W41", &day_start("2026-10-10")).unwrap());

    let run = ielts_db::record_failed_weekly_run(
        &conn, "local", &journal, "2026-W41", &error, "2026-10-10T03:00:00Z",
    )
    .unwrap();
    assert_eq!(run.status.as_str(), "failed");
    assert_eq!(run.input_hash.as_deref(), Some("weekly:2026-W41"));

    // Not a receipt: the weekend is still due, and it is known to have failed.
    assert!(!weekly_run_completed(&conn, "local", "2026-W41").unwrap());
    assert_eq!(weekly_failed_attempt_count(&conn, "local", "2026-W41").unwrap(), 1);
    assert_eq!(weekly_failed_attempt_count(&conn, "local", "2026-W42").unwrap(), 0);
    // One attempt per day: blocked that day, free the next day and for other weekends.
    assert!(ielts_db::weekly_attempted_since(&conn, "local", "2026-W41", &day_start("2026-10-10")).unwrap());
    assert!(!ielts_db::weekly_attempted_since(&conn, "local", "2026-W41", &day_start("2026-10-11")).unwrap());
    assert!(!ielts_db::weekly_attempted_since(&conn, "local", "2026-W42", &day_start("2026-10-10")).unwrap());

    // Sunday's retry can still complete the weekend.
    let sunday = window("2026-W41", "2026-09-12T08:00:00Z", "2026-10-11T03:00:00Z");
    complete_run(&conn, &journal, Some(&sunday.marker()), "2026-10-11T03:01:00Z");
    assert!(weekly_run_completed(&conn, "local", "2026-W41").unwrap());
}
