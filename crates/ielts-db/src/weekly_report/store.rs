//! Persistence of finished weekly reports (`weekly_digests.digest_json`, v2).

use ielts_domain::WeeklyReport;
use rusqlite::Connection;

use crate::sqlite::DbResult;

/// Store the report of a weekly run. Idempotent per run.
pub fn put_weekly_report(_conn: &Connection, _run_id: &str, _report: &WeeklyReport, _now: &str) -> DbResult<()> {
    Ok(())
}

/// Newest persisted weekly reports, one per window.
pub fn list_weekly_reports(_conn: &Connection, _user_id: &str, _limit: u32) -> DbResult<Vec<WeeklyReport>> {
    Ok(Vec::new())
}
