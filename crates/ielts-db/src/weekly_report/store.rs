//! Persistence of finished weekly reports (`weekly_digests.digest_json`).
//!
//! Reports reuse the table of the v1 prose digests: one row per weekly run.
//! Old prose rows stay where they are and are simply not reports. A v3 report is
//! written by exactly one path, which first re-projects the fact map from the
//! blocks and the Soul profile and refuses a report whose facts (or title) are
//! not that exact projection.

use std::cmp::Reverse;
use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, Utc};
use ielts_domain::{
    display_title, WeeklyMemoryChange, WeeklyReport, LEGACY_WEEKLY_REPORT_SCHEMA_VERSION,
    WEEKLY_REPORT_SCHEMA_VERSION,
};
use rusqlite::{params, Connection};

use crate::dream::normalize_user_id;
use crate::sqlite::{DbError, DbResult};
use crate::weekly_report::project_weekly_facts;

const MAX_PAGE_SIZE: u32 = 52;

/// Original prose retained for read-only history. New runs never write it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyWeeklyDigest {
    pub run_id: String,
    pub window: String,
    pub start: String,
    pub end: String,
    pub digest: serde_json::Value,
}

pub fn list_legacy_weekly_digests(conn: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<LegacyWeeklyDigest>> {
    list_legacy_weekly_digests_page(conn, user_id, limit, 0)
}

/// A page of readable legacy digests. The offset counts legacy rows only;
/// modern reports sharing the table must not consume the page's positions.
pub fn list_legacy_weekly_digests_page(
    conn: &Connection,
    user_id: &str,
    limit: u32,
    offset: u32,
) -> DbResult<Vec<LegacyWeeklyDigest>> {
    let mut statement = conn.prepare(
        "SELECT r.id, r.input_hash, d.digest_json FROM dream_runs r
           JOIN weekly_digests d ON d.run_id = r.id
          WHERE r.user_id = ?1 AND r.status IN ('completed', 'failed')
            AND r.input_hash LIKE 'weekly:%'
          ORDER BY d.updated_at DESC, r.id DESC",
    )?;
    let rows = statement.query_map(params![normalize_user_id(user_id)], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    let mut out = Vec::new();
    let mut skipped = 0;
    for row in rows {
        let (run_id, marker, raw) = row?;
        let digest: serde_json::Value = serde_json::from_str(&raw).map_err(|error| DbError::Validation(error.to_string()))?;
        let prose = digest.get("body").is_some_and(|v| v.is_array())
            || digest.get("observations").is_some_and(|v| v.is_array());
        if !prose || digest.get("blocks").is_some() { continue; }
        let Some(window) = crate::dream::window_of_marker(&marker) else { continue };
        if skipped < offset {
            skipped += 1;
            continue;
        }
        out.push(LegacyWeeklyDigest {
            run_id, window: window.key, start: window.start.to_rfc3339(),
            end: window.end.to_rfc3339(), digest,
        });
        if out.len() >= limit.clamp(1, MAX_PAGE_SIZE) as usize { break; }
    }
    Ok(out)
}

const MUTATION_BATCH_PREFIX: &str = "weekly-mutations-";

/// The memory batch a weekly run submits its mutations under.
pub fn weekly_mutation_request_id(run_id: &str) -> String {
    format!("{MUTATION_BATCH_PREFIX}{run_id}")
}

/// What weekly runs changed in memory since the last completed weekly run,
/// oldest first: the changes the next completed report owes. Read from the
/// promotion records of each run's batch, so a change an earlier, failed
/// attempt already made (of this weekend or of one the closing run folds in)
/// still reaches the report, though no later run makes it again. Each change
/// lands in exactly one completed report: the first one after it.
pub fn weekly_memory_changes(conn: &Connection, user_id: &str) -> DbResult<Vec<WeeklyMemoryChange>> {
    let mut statement = conn.prepare(
        "SELECT c.action, c.resolved_memory_id, COALESCE(m.content, '')
           FROM dream_runs r
           JOIN memory_candidate_batches b ON b.request_id = ?2 || r.id
           JOIN memory_candidates c ON c.batch_id = b.id
           LEFT JOIN memory_items m ON m.id = c.resolved_memory_id
          WHERE r.user_id = ?1 AND r.input_hash LIKE 'weekly:%'
            AND julianday(r.created_at) > COALESCE(
                  (SELECT MAX(julianday(done.created_at)) FROM dream_runs done
                    WHERE done.user_id = ?1 AND done.status = 'completed' AND done.input_hash LIKE 'weekly:%'),
                  0)
            AND c.disposition = 'promoted' AND c.resolved_memory_id IS NOT NULL
          ORDER BY c.updated_at, c.id",
    )?;
    let rows = statement.query_map(params![normalize_user_id(user_id), MUTATION_BATCH_PREFIX], |row| {
        Ok(WeeklyMemoryChange { action: row.get(0)?, memory_id: row.get(1)?, statement: row.get(2)? })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Store the report of a weekly run. Idempotent per run.
///
/// `offset` is the local UTC offset of the run, used to turn `generatedAt` into
/// the local day the exam countdown was computed from. The facts in the report
/// must equal a fresh projection of its own blocks and the active Soul profile:
/// one writer, one projection, no hand-written facts.
pub fn put_weekly_report(
    conn: &Connection,
    user_id: &str,
    run_id: &str,
    report: &WeeklyReport,
    offset: FixedOffset,
    now: &str,
) -> DbResult<()> {
    if run_id.trim().is_empty() {
        return Err(DbError::Validation("runId is required".into()));
    }
    if report.schema_version != WEEKLY_REPORT_SCHEMA_VERSION {
        return Err(DbError::Validation(format!(
            "weekly report schema_version {} is not {WEEKLY_REPORT_SCHEMA_VERSION}",
            report.schema_version
        )));
    }
    match (report.state, report.narrative.as_ref()) {
        (ielts_domain::WeeklyReportState::Final, Some(narrative)) if !narrative.body.is_empty() => {}
        (ielts_domain::WeeklyReportState::Final, _) => {
            return Err(DbError::Validation("a final weekly report needs a narrative body".into()))
        }
        (_, None) => {}
        (state, Some(_)) => {
            return Err(DbError::Validation(format!(
                "weekly report in state {state:?} must not carry a narrative"
            )))
        }
    }
    if report.display_title != display_title(report.narrative.as_ref(), &report.blocks) {
        return Err(DbError::Validation(
            "weekly report displayTitle is not the one derived title".into(),
        ));
    }
    let as_of = DateTime::parse_from_rfc3339(&report.generated_at)
        .map_err(|error| DbError::Validation(format!("invalid generatedAt: {error}")))?
        .with_timezone(&offset)
        .date_naive();
    let exam_date = crate::soul::soul_exam_date(conn, user_id)?;
    let projected = project_weekly_facts(&report.blocks, exam_date, as_of);
    if report.facts != projected {
        return Err(DbError::Validation(
            "weekly report facts do not match project(blocks, soul)".into(),
        ));
    }
    let value = serde_json::to_string(report).map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO weekly_digests (run_id, digest_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(run_id) DO UPDATE SET digest_json = excluded.digest_json, updated_at = excluded.updated_at",
        params![run_id, value, now],
    )?;
    Ok(())
}

/// The narrative of the last completed report before `window_start`, with its
/// fact placeholders resolved: prompt context, never a citation source.
pub fn previous_weekly_digest(
    conn: &Connection,
    user_id: &str,
    window_start: DateTime<Utc>,
) -> DbResult<Option<serde_json::Value>> {
    let user_id = normalize_user_id(user_id);
    let previous = candidates(conn, &user_id)?
        .into_iter()
        .filter(|candidate| candidate.rank.0)
        .filter_map(|candidate| {
            let end = end_of(&candidate.report)?;
            (end <= window_start).then_some((end, candidate.report))
        })
        .max_by_key(|(end, _)| *end);
    let Some((_, report)) = previous else { return Ok(None) };
    let Some(narrative) = report.narrative.as_ref() else { return Ok(None) };
    let mut summary = serde_json::json!({
        "title": narrative.title,
        "body": narrative.body,
        "nextSteps": narrative.next_steps,
    });
    resolve_references(&mut summary, &report.facts);
    Ok(Some(summary))
}

fn resolve_references(value: &mut serde_json::Value, facts: &BTreeMap<String, ielts_domain::WeeklyFact>) {
    match value {
        serde_json::Value::String(text) => {
            for (id, fact) in facts {
                *text = text.replace(&format!("{{{{f:{id}}}}}"), &fact.value.to_string());
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(|item| resolve_references(item, facts)),
        serde_json::Value::Object(map) => map.values_mut().for_each(|item| resolve_references(item, facts)),
        _ => {}
    }
}

/// A stored report ranked for "which report of this window wins": a completed
/// run over a failed one, then finished_at, updated_at, run id (newest wins).
struct Candidate {
    rank: (bool, String, String, String),
    report: WeeklyReport,
}

fn parse_report(raw: &str) -> Option<WeeklyReport> {
    // v1 prose rows do not parse as a report; they are skipped, not errors.
    // v2 rows are historical display only: they parse and never get rewritten.
    let report: WeeklyReport = serde_json::from_str(raw).ok()?;
    let usable = matches!(
        report.schema_version,
        WEEKLY_REPORT_SCHEMA_VERSION | LEGACY_WEEKLY_REPORT_SCHEMA_VERSION
    ) && !report.is_empty();
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

fn end_of(report: &WeeklyReport) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&report.window_end).ok().map(|end| end.with_timezone(&Utc))
}

fn window_order(report: &WeeklyReport) -> (Option<DateTime<Utc>>, String) {
    (end_of(report), report.window.clone())
}

/// Newest persisted weekly reports (window end descending), one per window.
/// Rows that are not v2 reports, reports without blocks, and failed reports
/// that end at or before the latest completed report are skipped.
pub fn list_weekly_reports(conn: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<WeeklyReport>> {
    list_weekly_reports_page(conn, user_id, limit, 0)
}

/// Page the final visible history, after retries have been deduplicated and
/// superseded failures removed. The page-size cap never limits the archive.
pub fn list_weekly_reports_page(
    conn: &Connection,
    user_id: &str,
    limit: u32,
    offset: u32,
) -> DbResult<Vec<WeeklyReport>> {
    let user_id = normalize_user_id(user_id);
    let mut best: BTreeMap<String, Candidate> = BTreeMap::new();
    for candidate in candidates(conn, &user_id)? {
        let beaten = best.get(&candidate.report.window).is_some_and(|current| current.rank >= candidate.rank);
        if !beaten {
            best.insert(candidate.report.window.clone(), candidate);
        }
    }
    // A failed week that a completed run has reached past can never retry: the
    // weekly boundary moved beyond it. Its practice was folded into that run, or
    // dropped by the run's lookback cap; either way the failure is retired.
    let boundary = best.values().filter(|candidate| candidate.rank.0).filter_map(|candidate| end_of(&candidate.report)).max();
    let superseded = |candidate: &Candidate| {
        !candidate.rank.0 && boundary.zip(end_of(&candidate.report)).is_some_and(|(boundary, end)| end <= boundary)
    };
    let mut reports: Vec<WeeklyReport> =
        best.into_values().filter(|candidate| !superseded(candidate)).map(|candidate| candidate.report).collect();
    reports.sort_by_key(|report| Reverse(window_order(report)));
    Ok(reports.into_iter().skip(offset as usize).take(limit.clamp(1, MAX_PAGE_SIZE) as usize).collect())
}
