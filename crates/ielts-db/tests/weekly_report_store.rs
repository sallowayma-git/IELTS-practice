//! Weekly reports v3 persist in `weekly_digests` beside the old prose rows and
//! read back one per window: a completed run's report over a failed run's. A v3
//! write must carry the exact facts projection of its own blocks.

use ielts_db::{
    build_daily_facts, finish_dream_run, insert_dream_run, insert_journal, list_weekly_reports, migrate,
    open_connection, project_weekly_facts, put_weekly_report, record_failed_weekly_run, start_dream_run,
    DbOpenOptions,
};
use ielts_domain::{
    display_title, BlockKind, ReportBlock, WeeklyNarrative, WeeklyReport, WeeklyReportState,
    WEEKLY_REPORT_SCHEMA_VERSION,
};
use chrono::FixedOffset;
use rusqlite::Connection;
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v3.db"))).unwrap();
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

const UTC: FixedOffset = FixedOffset::east_opt(0).unwrap();

/// A stored report built the one legal way: blocks, the narrative the model
/// wrote (final only), and the facts projection of both.
fn report(key: &str, end: &str, state: WeeklyReportState, title: &str) -> WeeklyReport {
    report_with(key, "2026-01-01T00:00:00Z", end, state, title, 3)
}

fn report_with(
    key: &str,
    start: &str,
    end: &str,
    state: WeeklyReportState,
    title: &str,
    reading_attempts: u64,
) -> WeeklyReport {
    let blocks = vec![ReportBlock::new(
        BlockKind::Volume,
        json!({"readingAttempts": reading_attempts, "writingEssays": 0}),
    )];
    let narrative = (state == WeeklyReportState::Final).then(|| WeeklyNarrative {
        title: title.to_owned(),
        body: vec!["这周把阅读错题重做了一遍。".to_owned()],
        ..WeeklyNarrative::default()
    });
    let as_of = chrono::NaiveDate::parse_from_str(&end[..10], "%Y-%m-%d").unwrap();
    WeeklyReport {
        schema_version: WEEKLY_REPORT_SCHEMA_VERSION,
        window: key.to_owned(),
        window_start: start.to_owned(),
        window_end: end.to_owned(),
        state,
        generated_at: end.to_owned(),
        display_title: display_title(narrative.as_ref(), &blocks),
        facts: project_weekly_facts(&blocks, None, as_of),
        blocks,
        narrative,
        profile_edits: Vec::new(),
        memory_changes: Vec::new(),
    }
}

fn titles(reports: &[WeeklyReport]) -> Vec<&str> {
    reports.iter().map(|report| report.display_title.as_str()).collect()
}

#[test]
fn a_report_round_trips_and_rewrites_in_place() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let run = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    let mut stored = report("2026-W41", end, WeeklyReportState::FinalNoAi, "first");
    put_weekly_report(&conn, "local", &run, &stored, UTC, "2026-10-10T09:31:00Z").unwrap();
    assert_eq!(list_weekly_reports(&conn, "local", 8).unwrap(), vec![stored.clone()]);

    stored.state = WeeklyReportState::Final;
    stored.narrative = Some(WeeklyNarrative {
        title: "second".to_owned(),
        body: vec!["读了 {{f:volume.reading}} 篇。".to_owned()],
        ..WeeklyNarrative::default()
    });
    stored.display_title = display_title(stored.narrative.as_ref(), &stored.blocks);
    put_weekly_report(&conn, "local", &run, &stored, UTC, "2026-10-11T09:31:00Z").unwrap();
    // The blank user id is the local user.
    assert_eq!(list_weekly_reports(&conn, "  ", 8).unwrap(), vec![stored]);
}

#[test]
fn a_report_of_another_schema_or_foreign_facts_is_rejected() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let run = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");

    let mut old = report("2026-W41", end, WeeklyReportState::FinalNoAi, "v1");
    old.schema_version = 1;
    assert!(put_weekly_report(&conn, "local", &run, &old, UTC, end).is_err());

    // Facts are not hand-written: one changed value is refused.
    let mut edited = report("2026-W41", end, WeeklyReportState::FinalNoAi, "edited");
    edited.facts.get_mut("volume.reading").unwrap().value = json!(99);
    assert!(put_weekly_report(&conn, "local", &run, &edited, UTC, end).is_err());

    // The title has exactly one derivation too.
    let mut retitled = report("2026-W41", end, WeeklyReportState::FinalNoAi, "retitled");
    retitled.display_title = "另一个标题".to_owned();
    assert!(put_weekly_report(&conn, "local", &run, &retitled, UTC, end).is_err());

    // A final report without a body is not final.
    let mut bodiless = report("2026-W41", end, WeeklyReportState::Final, "bodiless");
    bodiless.narrative.as_mut().unwrap().body.clear();
    assert!(put_weekly_report(&conn, "local", &run, &bodiless, UTC, end).is_err());

    assert!(list_weekly_reports(&conn, "local", 8).unwrap().is_empty());
}

#[test]
fn a_completed_report_beats_a_failed_one_of_the_same_window() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    let done = complete_run(&conn, &journal, "2026-W41", end, "2026-10-10T09:31:00Z");
    put_weekly_report(&conn, "local", &done, &report("2026-W41", end, WeeklyReportState::Final, "completed"), UTC, end)
        .unwrap();
    // A later failed run of the same window does not replace it.
    let failed = failed_run(&conn, &journal, "2026-W41", "2026-10-11T09:31:00Z");
    let failed_report = report("2026-W41", end, WeeklyReportState::NarrativeFailed, "failed");
    put_weekly_report(&conn, "local", &failed, &failed_report, UTC, "2026-10-11T09:31:00Z").unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["completed"]);
}

#[test]
fn a_window_with_only_failed_runs_lists_the_newest_failed_report() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let end = "2026-10-10T09:30:00Z";
    for (attempts, at) in [(1, "2026-10-10T09:31:00Z"), (2, "2026-10-11T09:31:00Z")] {
        let run = failed_run(&conn, &journal, "2026-W41", at);
        let failed = report_with("2026-W41", "2026-01-01T00:00:00Z", end, WeeklyReportState::NarrativeFailed, "", attempts);
        put_weekly_report(&conn, "local", &run, &failed, UTC, at).unwrap();
    }
    let reports = list_weekly_reports(&conn, "local", 8).unwrap();
    assert_eq!(titles(&reports), vec!["这一周读了 2 篇"]);
    assert_eq!(reports[0].state, WeeklyReportState::NarrativeFailed);
    assert!(reports[0].narrative.is_none());
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
    empty.facts.clear();
    empty.display_title = display_title(None, &[]);
    put_weekly_report(&conn, "local", &empty_run, &empty, UTC, end).unwrap();

    // A non-weekly run's row is not a weekly report.
    let other = insert_dream_run(&conn, "local", &journal, Some("source-hash")).unwrap();
    start_dream_run(&conn, &other.id, end).unwrap();
    finish_dream_run(&conn, &other.id, "out", end).unwrap();
    put_weekly_report(&conn, "local", &other.id, &report("2026-W42", end, WeeklyReportState::Final, "other"), UTC, end)
        .unwrap();

    assert!(list_weekly_reports(&conn, "local", 8).unwrap().is_empty());
}

#[test]
fn snapshot_prose_remains_readable_without_entering_the_typed_report_list() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let run = complete_run(&conn, &journal, "2026-W41", "2026-10-10T09:30:00Z", "2026-10-10T09:31:00Z");
    let original = json!({"schemaVersion":2, "title":"旧周记", "body":["练了 {{f:practice.count}} 次"], "facts":{"practice.count":{"value":3}}, "profileEdits":[]});
    conn.execute("INSERT INTO weekly_digests VALUES (?1, ?2, '2026-10-10T09:31:00Z')", [&run, &original.to_string()]).unwrap();
    assert!(list_weekly_reports(&conn, "local", 8).unwrap().is_empty());
    let history = ielts_db::list_legacy_weekly_digests(&conn, "local", 52).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].digest, original);
    assert_eq!(history[0].window, "2026-W41");
    assert!(ielts_db::list_legacy_weekly_digests(&conn, "other-user", 52).unwrap().is_empty());
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
        put_weekly_report(&conn, "local", &run, &report(key, end, WeeklyReportState::Final, key), UTC, end).unwrap();
    }
    let all = list_weekly_reports(&conn, "local", 52).unwrap();
    assert_eq!(titles(&all), vec!["2026-W42", "2026-W41", "2026-W40", "2026-W39"]);
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 2).unwrap()), vec!["2026-W42", "2026-W41"]);
    // A limit of 0 still returns one; another user sees none.
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 0).unwrap()), vec!["2026-W42"]);
    assert!(list_weekly_reports(&conn, "someone-else", 8).unwrap().is_empty());
}

/// Review on #243: W41 kept failing, then the W42 run folded W41's span in and
/// completed. The failed W41 report is superseded, not shown beside it.
#[test]
fn a_failed_week_folded_into_a_later_completed_run_is_not_listed() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let w41_end = "2026-10-12T09:30:00Z";
    let failed = failed_run(&conn, &journal, "2026-W41", w41_end);
    put_weekly_report(&conn, "local", &failed, &report("2026-W41", w41_end, WeeklyReportState::NarrativeFailed, "w41 failed"), UTC, w41_end)
        .unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["这一周读了 3 篇"]);

    // Same start (the last completed boundary), later end.
    let w42_end = "2026-10-17T09:30:00Z";
    let done = complete_run(&conn, &journal, "2026-W42", w42_end, w42_end);
    put_weekly_report(&conn, "local", &done, &report("2026-W42", w42_end, WeeklyReportState::Final, "w42 folded"), UTC, w42_end).unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["w42 folded"]);
}

/// Review on #243: after a provider outage longer than the 28-day lookback, the
/// completed run starts later than the oldest failures. Those weeks only partly
/// overlap it, or not at all, yet the boundary has passed them: they can never
/// retry and are not listed as if they would.
#[test]
fn failed_weeks_behind_a_capped_completed_run_are_retired() {
    let (_dir, conn) = open_db();
    let journal = journal_for(&conn, "2026-10-10");
    let failed = [
        ("2026-W36", "2026-08-29T09:30:00Z", "2026-09-05T09:30:00Z"),
        ("2026-W38", "2026-08-29T09:30:00Z", "2026-09-19T09:30:00Z"),
        ("2026-W40", "2026-08-29T09:30:00Z", "2026-10-03T09:30:00Z"),
    ];
    for (key, start, end) in failed {
        let run = failed_run(&conn, &journal, key, end);
        put_weekly_report(&conn, "local", &run, &report_with(key, start, end, WeeklyReportState::NarrativeFailed, key, 1), UTC, end).unwrap();
    }
    // The capped run starts 28 days before its end, after the W36 and W38 starts.
    let end = "2026-10-10T09:30:00Z";
    let done = complete_run(&conn, &journal, "2026-W41", end, end);
    put_weekly_report(&conn, "local", &done, &report_with("2026-W41", "2026-09-12T09:30:00Z", end, WeeklyReportState::Final, "capped", 3), UTC, end)
        .unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["capped"]);

    // A failure after the boundary is still owed a retry and stays listed.
    let later = "2026-10-17T09:30:00Z";
    let run = failed_run(&conn, &journal, "2026-W42", later);
    put_weekly_report(&conn, "local", &run, &report_with("2026-W42", end, later, WeeklyReportState::NarrativeFailed, "w42 failed", 4), UTC, later)
        .unwrap();
    assert_eq!(titles(&list_weekly_reports(&conn, "local", 8).unwrap()), vec!["这一周读了 4 篇", "capped"]);
}
