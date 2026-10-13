//! Weekly reports v2 persist in `weekly_digests` beside the old prose rows and
//! read back one per window: a completed run's report over a failed run's.

use ielts_db::{
    build_daily_facts, finish_dream_run, insert_dream_run, insert_journal, list_weekly_reports, migrate,
    open_connection, put_weekly_report, record_failed_weekly_run, start_dream_run,
    DbOpenOptions,
};
use ielts_domain::{BlockKind, ReportBlock, WeeklyReport, WeeklyReportState, WEEKLY_REPORT_SCHEMA_VERSION};
use rusqlite::Connection;
use serde_json::json;
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

fn complete_run(conn: &Connection, journal: &str, key: &str, end: &str, at: &str) -> String {
    let marker = format!("weekly:{key}:2026-01-01T00:00:00Z..{end}");
    let run = insert_dream_run(conn, "local", journal, Some(&marker)).unwrap();
    start_dream_run(conn, &run.id, at).unwrap();
    finish_dream_run(conn, &run.id, "out", at).unwrap();
    run.id
}

fn failed_run(conn: &Connection, journal: &str, key: &str, at: &str) -> String {
    let error = json!({"code": "journal.weekly_failed"});
    record_failed_weekly_run(conn, "local", journal, key, &error, at).unwrap().id
}

fn report(key: &str, end: &str, state: WeeklyReportState, title: &str) -> WeeklyReport {
    WeeklyReport {
        schema_version: WEEKLY_REPORT_SCHEMA_VERSION,
        window: key.to_owned(),
        window_start: "2026-01-01T00:00:00Z".to_owned(),
        window_end: end.to_owned(),
        state,
        generated_at: end.to_owned(),
        title: title.to_owned(),
        blocks: vec![ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 3}))],
        memory_changes: Vec::new(),
    }
}

fn titles(reports: &[WeeklyReport]) -> Vec<&str> {
    reports.iter().map(|report| report.title.as_str()).collect()
}

#[test]
fn a_report_round_trips_and_rewrites_in_place() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let run = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    let mut stored = report("2026-W41", end, WeeklyReportState::FinalNoAi, "first");
    put_weekly_report(&conn, &run, &stored, "2026-10-10T09:31:00Z").unwrap();
    assert_eq!(list_weekly_reports(&conn, "local", 8).unwrap(), vec![stored.clone()]);

    stored.state = WeeklyReportState::Final;
    stored.title = "second".to_owned();
    stored.blocks[0].narrative = Some("读了 3 篇".to_owned());
    put_weekly_report(&conn, &run, &stored, "2026-10-11T09:31:00Z").unwrap();
    // The blank user id is the local user.
    assert_eq!(list_weekly_reports(&conn, "  ", 8).unwrap(), vec![stored]);
}

#[test]
fn a_report_of_another_schema_is_rejected() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let run = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    let mut old = report("2026-W41", end, WeeklyReportState::Final, "v1");
    old.schema_version = 1;
    assert!(put_weekly_report(&conn, &run, &old, end).is_err());
    assert!(list_weekly_reports(&conn, "local", 8).unwrap().is_empty());
}

#[test]
fn a_completed_report_beats_a_failed_one_of_the_same_window() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let done = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    put_weekly_report(&conn, &done, &report("2026-W41", end, WeeklyReportState::Final, "completed"), end).unwrap();
    // A later failed run of the same window does not replace it.
    let failed = failed_run(&conn, &journal, "2026-W41", "2026-10-11T09:31:00Z");
    let failed_report = report("2026-W41", end, WeeklyReportState::NarrativeFailed, "failed");
    put_weekly_report(&conn, &failed, &failed_report, "2026-10-11T09:31:00Z").unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["completed"]);
}

#[test]
fn a_window_with_only_failed_runs_lists_the_newest_failed_report() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    for (title, at) in [("saturday", "2026-10-10T09:31:00Z"), ("sunday", "2026-10-11T09:31:00Z")] {
        let run = failed_run(&conn, &journal, "2026-W41", at);
        put_weekly_report(&conn, &run, &report("2026-W41", end, WeeklyReportState::NarrativeFailed, title), at).unwrap();
    }
    let reports = list_weekly_reports(&conn, "local", 8).unwrap();
    assert_eq!(titles(&reports), vec!["sunday"]);
    assert_eq!(reports[0].state, WeeklyReportState::NarrativeFailed);
}

#[test]
fn v1_prose_rows_runs_without_blocks_and_other_runs_are_skipped() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let legacy = complete_run(&conn, &journal, "2026-W33", "2026-08-16T23:59:59Z", "2026-08-17T01:00:00Z");
    conn.execute(
        "INSERT INTO weekly_digests (run_id, digest_json, updated_at) VALUES (?1, ?2, '2026-08-17T01:00:00Z')",
        [&legacy, &serde_json::json!({"observations": ["Read the stem first"]}).to_string()],
    )
    .unwrap();

    let end = "2026-10-10T09:30:00Z";
    let empty_run = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    let mut empty = report("2026-W41", end, WeeklyReportState::FinalNoAi, "empty");
    empty.blocks.clear();
    put_weekly_report(&conn, &empty_run, &empty, end).unwrap();

    // A non-weekly run's row is not a weekly report.
    let other = insert_dream_run(&conn, "local", &journal, Some("source-hash")).unwrap();
    start_dream_run(&conn, &other.id, end).unwrap();
    finish_dream_run(&conn, &other.id, "out", end).unwrap();
    put_weekly_report(&conn, &other.id, &report("2026-W42", end, WeeklyReportState::Final, "other"), end).unwrap();

    assert!(list_weekly_reports(&conn, "local", 8).unwrap().is_empty());
}

#[test]
fn reports_are_newest_window_first_and_limited() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    // Written out of order: the order is by window end, not by insertion.
    let weeks = [
        ("2026-W40", "2026-10-03T09:30:00Z"),
        ("2026-W42", "2026-10-17T09:30:00Z"),
        ("2026-W39", "2026-09-26T09:30:00Z"),
        ("2026-W41", "2026-10-10T09:30:00Z"),
    ];
    for (key, end) in weeks {
        let run = complete_run(&conn, &journal, key, end, end);
        put_weekly_report(&conn, &run, &report(key, end, WeeklyReportState::Final, key), end).unwrap();
    }
    let all = list_weekly_reports(&conn, "local", 52).unwrap();
    assert_eq!(titles(&all), vec!["2026-W42", "2026-W41", "2026-W40", "2026-W39"]);
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 2).unwrap()), vec!["2026-W42", "2026-W41"]);
    // A limit of 0 still returns one; another user sees none.
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 0).unwrap()), vec!["2026-W42"]);
    assert!(list_weekly_reports(&conn, "someone-else", 8).unwrap().is_empty());
}
