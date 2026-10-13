//! Persistence of finished weekly reports (`weekly_digests.digest_json`, v2).
//!
//! Reports reuse the table of the v1 prose digests: one row per weekly run.
//! Old prose rows stay where they are and are simply not reports.

use std::cmp::Reverse;
use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use ielts_domain::{WeeklyReport, WEEKLY_REPORT_SCHEMA_VERSION};
use rusqlite::{params, Connection};

use crate::dream::normalize_user_id;
use crate::sqlite::{DbError, DbResult};

const MAX_REPORTS: u32 = 52;

/// Store the report of a weekly run. Idempotent per run.
pub fn put_weekly_report(conn: &Connection, run_id: &str, report: &WeeklyReport, now: &str) -> DbResult<()> {
    if run_id.trim().is_empty() {
        return Err(DbError::Validation("runId is required".into()));
    }
    if report.schema_version != WEEKLY_REPORT_SCHEMA_VERSION {
        return Err(DbError::Validation(format!(
            "weekly report schema_version {} is not {WEEKLY_REPORT_SCHEMA_VERSION}",
            report.schema_version
        )));
    }
    let value = serde_json::to_string(report).map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO weekly_digests (run_id, digest_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(run_id) DO UPDATE SET digest_json = excluded.digest_json, updated_at = excluded.updated_at",
        params![run_id, value, now],
    )?;
    Ok(())
}

/// A stored report ranked for "which report of this window wins": a completed
/// run over a failed one, then finished_at, updated_at, run id (newest wins).
struct Candidate {
    rank: (bool, String, String, String),
    report: WeeklyReport,
}

fn parse_report(raw: &str) -> Option<WeeklyReport> {
    // v1 prose rows do not parse as a report; they are skipped, not errors.
    let report: WeeklyReport = serde_json::from_str(raw).ok()?;
    let usable = report.schema_version == WEEKLY_REPORT_SCHEMA_VERSION && !report.is_empty();
    usable.then_some(report)
}

type Row = (String, String, String, String, String);

fn candidates(conn: &Connection, user_id: &str) -> DbResult<Vec<Candidate>> {
    let mut statement = conn.prepare(
        "SELECT r.id, r.status, COALESCE(r.finished_at, ''), r.updated_at, d.digest_json
           FROM dream_runs r JOIN weekly_digests d ON d.run_id = r.id
          WHERE r.user_id = ?1 AND r.status IN ('completed', 'failed')
            AND r.input_hash LIKE 'weekly:%'",
    )?;
    let rows = statement
        .query_map(params![user_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })?
        .collect::<Result<Vec<Row>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, status, finished_at, updated_at, raw)| {
            let report = parse_report(&raw)?;
            Some(Candidate { rank: (status == "completed", finished_at, updated_at, id), report })
        })
        .collect())
}

fn window_order(report: &WeeklyReport) -> (Option<DateTime<Utc>>, String) {
    let end = DateTime::parse_from_rfc3339(&report.window_end).ok().map(|end| end.with_timezone(&Utc));
    (end, report.window.clone())
}

/// Newest persisted weekly reports (window end descending), one per window.
/// Rows that are not v2 reports and reports without blocks are skipped.
pub fn list_weekly_reports(conn: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<WeeklyReport>> {
    let user_id = normalize_user_id(user_id);
    let mut best: BTreeMap<String, Candidate> = BTreeMap::new();
    for candidate in candidates(conn, &user_id)? {
        let beaten = best.get(&candidate.report.window).is_some_and(|current| current.rank >= candidate.rank);
        if !beaten {
            best.insert(candidate.report.window.clone(), candidate);
        }
    }
    let mut reports: Vec<WeeklyReport> = best.into_values().map(|candidate| candidate.report).collect();
    reports.sort_by_key(|report| Reverse(window_order(report)));
    reports.truncate(limit.clamp(1, MAX_REPORTS) as usize);
    Ok(reports)
}
