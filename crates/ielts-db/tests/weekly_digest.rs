//! Weekly dream receipts: the `dream_runs` marker carries the weekend key (the
//! per-weekend idempotency key) and the window the run covered, and completed
//! runs are readable as plain patterns.

use chrono::{DateTime, Utc};
use ielts_db::{
    build_daily_facts, finish_dream_run, insert_dream_run, insert_journal, last_weekly_window_end,
    list_weekly_digests, migrate, open_connection, start_dream_run, weekly_run_completed,
    DbOpenOptions, WeeklyWindow,
};
use rusqlite::{params, Connection};
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

fn pattern(conn: &Connection, id: &str, statement: &str, status: &str, created_at: &str) {
    conn.execute(
        "INSERT INTO memory_items (
            id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
            content, status, source_class, confidence, importance, source_trust, sensitivity,
            improvement_state, version, created_by, content_hash,
            first_observed_at, last_observed_at, created_at, updated_at
         ) VALUES (?1, 'local', 'strategy', 'consolidated', 'procedural', ?1, ?2, ?2,
                   ?3, 'consolidated', 0.6, 0.6, 0.7, 'normal', 'baseline', 1,
                   'weekly_dream', ?1, ?4, ?4, ?4, ?4)",
        params![id, statement, status, created_at],
    )
    .unwrap();
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
fn weekly_digests_list_active_patterns_with_the_window_actually_covered() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");

    let finished = "2026-10-10T09:31:00Z";
    let fold = window("2026-W41", "2026-09-19T08:00:00Z", "2026-10-10T09:30:00Z");
    complete_run(&conn, &journal, Some(&fold.marker()), finished);
    pattern(&conn, "mem-a", "Rushes the final check.", "active", finished);
    pattern(&conn, "mem-b", "Skips paraphrase review.", "active", finished);
    pattern(&conn, "mem-old", "Replaced by a newer pattern.", "superseded", finished);
    // Not produced by that run (different timestamp).
    pattern(&conn, "mem-other", "Unrelated pattern.", "active", "2026-10-10T12:00:00Z");

    // A run written before windows existed covers its ISO week.
    let legacy = "2026-08-17T01:00:00Z";
    complete_run(&conn, &journal, Some("weekly:2026-W33"), legacy);
    pattern(&conn, "mem-legacy", "Reads the stem first.", "active", legacy);

    // A completed run with nothing to show, and a non-weekly run, add no entries.
    complete_run(&conn, &journal, Some(&window("2026-W42", "2026-10-10T09:30:00Z", "2026-10-17T09:30:00Z").marker()),
        "2026-10-17T09:31:00Z");
    complete_run(&conn, &journal, Some("source-hash"), "2026-10-18T01:00:00Z");

    let digests = list_weekly_digests(&conn, "local", 8).unwrap();
    assert_eq!(digests.len(), 2);
    let newest = &digests[0];
    assert_eq!((newest.window.as_str(), newest.finished_at.as_str()), ("2026-W41", finished));
    // The span is what the run covered (a folded, three-week window), not an ISO week.
    assert_eq!(newest.window_start, "2026-09-19T08:00:00Z");
    assert_eq!(newest.window_end, "2026-10-10T09:30:00Z");
    let statements: Vec<_> = newest.patterns.iter().map(|p| p.statement.as_str()).collect();
    assert_eq!(statements, vec!["Rushes the final check.", "Skips paraphrase review."]);

    let old = &digests[1];
    assert_eq!(old.window, "2026-W33");
    assert_eq!(old.window_start, "2026-08-10T00:00:00Z");
    assert_eq!(old.window_end, "2026-08-16T23:59:59Z");

    // Forgetting a pattern removes it; a run left empty disappears.
    conn.execute("DELETE FROM memory_items WHERE id IN ('mem-a','mem-b','mem-legacy')", []).unwrap();
    assert!(list_weekly_digests(&conn, "local", 8).unwrap().is_empty());
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

    // Not a receipt: the weekend is still due.
    assert!(!weekly_run_completed(&conn, "local", "2026-W41").unwrap());
    // One attempt per day: blocked that day, free the next day and for other weekends.
    assert!(ielts_db::weekly_attempted_since(&conn, "local", "2026-W41", &day_start("2026-10-10")).unwrap());
    assert!(!ielts_db::weekly_attempted_since(&conn, "local", "2026-W41", &day_start("2026-10-11")).unwrap());
    assert!(!ielts_db::weekly_attempted_since(&conn, "local", "2026-W42", &day_start("2026-10-10")).unwrap());

    // Sunday's retry can still complete the weekend.
    let sunday = window("2026-W41", "2026-09-12T08:00:00Z", "2026-10-11T03:00:00Z");
    complete_run(&conn, &journal, Some(&sunday.marker()), "2026-10-11T03:01:00Z");
    assert!(weekly_run_completed(&conn, "local", "2026-W41").unwrap());
}
