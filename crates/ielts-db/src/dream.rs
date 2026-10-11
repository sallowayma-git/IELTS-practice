//! Dream-run ledger.
//!
//! `dream_runs` is the ledger of the weekly consolidation, the only dream there
//! is: the daily journal is a deterministic summary and has no run. The legacy
//! `dream_candidates` table stays in the schema (no destructive migration) but
//! nothing writes or reads it any more.

use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, Utc};
use ielts_domain::{DreamRun, DreamRunStatus};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

const DEFAULT_USER_ID: &str = "local";

/// Insert a new dream run in `queued` status.
pub fn insert_dream_run(
    conn: &Connection,
    user_id: &str,
    journal_id: &str,
    input_hash: Option<&str>,
) -> DbResult<DreamRun> {
    let user_id = normalize_user_id(user_id);
    require_text(journal_id, "journalId")?;
    let id = format!("drmrun-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO dream_runs (
           id, user_id, journal_id, status, input_hash, output_hash, started_at,
           finished_at, error_json, attempts, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, 0, ?6, ?6)",
        params![
            id,
            user_id,
            journal_id,
            DreamRunStatus::Queued.as_str(),
            input_hash,
            now,
        ],
    )?;
    Ok(DreamRun {
        id,
        user_id,
        journal_id: journal_id.into(),
        status: DreamRunStatus::Queued,
        input_hash: input_hash.map(str::to_owned),
        output_hash: None,
        started_at: None,
        finished_at: None,
        error: None,
        attempts: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Mark a dream run as running (claimed).
pub fn start_dream_run(conn: &Connection, run_id: &str, now: &str) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'running', started_at = ?1, attempts = attempts + 1, updated_at = ?1
         WHERE id = ?2 AND status IN ('queued','failed')",
        params![now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not claimable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after claim".into()))
}

/// Mark a dream run completed and record the output hash.
pub fn finish_dream_run(
    conn: &Connection,
    run_id: &str,
    output_hash: &str,
    now: &str,
) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(output_hash, "outputHash")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'completed', output_hash = ?1, finished_at = ?2, updated_at = ?2
         WHERE id = ?3 AND status = 'running'",
        params![output_hash, now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not finishable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after finish".into()))
}

/// Mark a dream run failed (fail-closed).
pub fn fail_dream_run(
    conn: &Connection,
    run_id: &str,
    error: &serde_json::Value,
    now: &str,
) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(now, "now")?;
    let error_json =
        serde_json::to_string(error).map_err(|error| DbError::Message(error.to_string()))?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'failed', error_json = ?1, finished_at = ?2, updated_at = ?2
         WHERE id = ?3 AND status IN ('running','queued')",
        params![error_json, now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not failable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after failure".into()))
}

/// Startup sweep: mark `running` dream runs as `failed` (interrupted by
/// restart). A process kill between start and finish would otherwise strand
/// the row in `running` forever — start_dream_run cannot reclaim it.
pub fn recover_interrupted_dream_runs(conn: &Connection) -> DbResult<u64> {
    let now = chrono::Utc::now().to_rfc3339();
    let error_json = serde_json::json!({
        "error": "interrupted by restart",
    })
    .to_string();
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'failed', error_json = ?1, finished_at = ?2, updated_at = ?2
         WHERE status = 'running'",
        params![error_json, now],
    )?;
    Ok(changed as u64)
}

// ---------------------------------------------------------------------------
// Weekly consolidation window and receipt.
//
// A weekly run happens on a weekend and covers everything since the previous
// COMPLETED run (exclusive), at most `WEEKLY_MAX_LOOKBACK_DAYS` back, up to the
// moment it starts. A missed weekend is therefore folded into the next one with
// no separate catch-up path. One weekend is one ISO week, and that ISO week is
// the idempotency key: at most one completed run per key.
//
// The run row carries the whole window in `dream_runs.input_hash` (the run's
// input identity): `weekly:<ISO week>:<start>..<end>`, instants as RFC3339 UTC.
// Failed attempts carry only `weekly:<ISO week>`. Rows written before windows
// existed carry `weekly:<ISO week>` and cover that ISO week, Monday to Sunday.
// ---------------------------------------------------------------------------

const WEEKLY_MARKER_PREFIX: &str = "weekly:";

/// The furthest back a weekly window may reach, however long since the last run.
pub const WEEKLY_MAX_LOOKBACK_DAYS: i64 = 28;

/// The span one weekly consolidation covers, and the identity of that run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeeklyWindow {
    /// ISO week (`YYYY-Www`) of the weekend the run belongs to: the idempotency key.
    pub key: String,
    /// Exclusive: observations at exactly this instant belong to the previous window.
    pub start: DateTime<Utc>,
    /// Inclusive.
    pub end: DateTime<Utc>,
}

impl WeeklyWindow {
    pub fn new(key: impl Into<String>, start: DateTime<Utc>, end: DateTime<Utc>) -> Self {
        Self { key: key.into(), start, end }
    }

    /// Opaque, host-issued name of this window: what crosses to the sidecar and
    /// comes back unchanged. `<ISO week>:<start>..<end>`.
    pub fn token(&self) -> String {
        format!("{}:{}..{}", self.key, rfc3339(self.start), rfc3339(self.end))
    }

    pub fn parse(token: &str) -> Option<Self> {
        let (key, span) = token.split_once(':')?;
        let (start, end) = span.split_once("..")?;
        iso_week_monday(key)?;
        let parse = |value: &str| DateTime::parse_from_rfc3339(value).ok().map(|t| t.with_timezone(&Utc));
        let (start, end) = (parse(start)?, parse(end)?);
        (start < end).then(|| Self::new(key, start, end))
    }

    /// `input_hash` of the run that consolidates this window.
    pub fn marker(&self) -> String {
        format!("{WEEKLY_MARKER_PREFIX}{}", self.token())
    }

    /// UTC day of the window end: the day whose journal the run row is anchored on.
    pub fn anchor_day(&self) -> String {
        self.end.format("%Y-%m-%d").to_string()
    }
}

fn rfc3339(instant: DateTime<Utc>) -> String {
    instant.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn iso_week_monday(key: &str) -> Option<NaiveDate> {
    let (year, week) = key.split_once("-W")?;
    NaiveDate::from_isoywd_opt(year.parse().ok()?, week.parse().ok()?, chrono::Weekday::Mon)
}

/// Window a run marker stands for; a pre-window marker covers its ISO week.
fn window_of_marker(marker: &str) -> Option<WeeklyWindow> {
    let body = marker.strip_prefix(WEEKLY_MARKER_PREFIX)?;
    WeeklyWindow::parse(body).or_else(|| {
        let start = iso_week_monday(body)?.and_hms_opt(0, 0, 0)?.and_utc();
        Some(WeeklyWindow::new(body, start, start + Duration::days(7) - Duration::seconds(1)))
    })
}

/// `input_hash` of a failed attempt: it names the weekend, not a window.
pub fn weekly_key_marker(key: &str) -> String {
    format!("{WEEKLY_MARKER_PREFIX}{key}")
}

/// SQL matching every marker of one weekend key (bare, windowed or legacy).
const WEEKLY_KEY_MATCH: &str = "(input_hash = 'weekly:' || ?2 OR input_hash LIKE 'weekly:' || ?2 || ':%')";

/// Whether a completed weekly consolidation already exists for the weekend key.
pub fn weekly_run_completed(conn: &Connection, user_id: &str, key: &str) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM dream_runs
              WHERE user_id = ?1 AND status = 'completed' AND {WEEKLY_KEY_MATCH})"
        ),
        params![normalize_user_id(user_id), key],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

/// Whether a weekly run for the weekend key already finished (completed OR
/// failed) at or after `since` (RFC3339): the retry bound is one attempt per
/// local day, so callers pass the start of the local day.
pub fn weekly_attempted_since(conn: &Connection, user_id: &str, key: &str, since: &str) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM dream_runs
              WHERE user_id = ?1 AND {WEEKLY_KEY_MATCH} AND status IN ('completed','failed')
                AND julianday(COALESCE(finished_at, updated_at)) >= julianday(?3))"
        ),
        params![normalize_user_id(user_id), key, since],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

/// Whether a weekly attempt for the weekend key failed (and so is still owed a
/// retry unless a completed run exists for the key).
pub fn weekly_failed_attempt_exists(conn: &Connection, user_id: &str, key: &str) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM dream_runs
              WHERE user_id = ?1 AND status = 'failed' AND {WEEKLY_KEY_MATCH})"
        ),
        params![normalize_user_id(user_id), key],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

/// End of the newest completed weekly window: where the next window starts.
pub fn last_weekly_window_end(conn: &Connection, user_id: &str) -> DbResult<Option<DateTime<Utc>>> {
    let marker: Option<String> = conn
        .query_row(
            "SELECT input_hash FROM dream_runs
              WHERE user_id = ?1 AND status = 'completed' AND finished_at IS NOT NULL
                AND input_hash LIKE 'weekly:%'
              ORDER BY finished_at DESC, id DESC LIMIT 1",
            params![normalize_user_id(user_id)],
            |row| row.get(0),
        )
        .optional()?;
    Ok(marker.and_then(|marker| window_of_marker(&marker)).map(|window| window.end))
}

/// Record a weekly attempt that did not produce a result (model/provider/sidecar
/// failure) as a failed run, anchored on a journal. It is not a receipt:
/// `weekly_run_completed` stays false, so a later day retries the weekend.
pub fn record_failed_weekly_run(
    conn: &Connection,
    user_id: &str,
    journal_id: &str,
    key: &str,
    error: &serde_json::Value,
    now: &str,
) -> DbResult<DreamRun> {
    let run = insert_dream_run(conn, user_id, journal_id, Some(&weekly_key_marker(key)))?;
    start_dream_run(conn, &run.id, now)?;
    fail_dream_run(conn, &run.id, error, now)
}

/// The prose of one weekly pass: what was seen, what changed, what to practise
/// next. Plain Chinese sentences, no ids, counts or scores of its own.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WeeklyDigestProse {
    #[serde(default)]
    pub observations: Vec<String>,
    #[serde(default)]
    pub changes: Vec<String>,
    #[serde(default)]
    pub next_practice: Vec<String>,
}

const DIGEST_LINE_CHARS: usize = 240;
const DIGEST_MAX_OBSERVATIONS: usize = 6;
const DIGEST_MAX_CHANGES: usize = 4;
const DIGEST_MAX_NEXT: usize = 4;

/// Legacy settings namespace of the digests (before migration 0029).
const LEGACY_DIGEST_NAMESPACE: &str = "weekly_digest";

impl WeeklyDigestProse {
    pub fn is_empty(&self) -> bool {
        self.observations.is_empty() && self.changes.is_empty() && self.next_practice.is_empty()
    }

    /// Bounded, trimmed prose. A line that fails the prompt-injection / secret /
    /// forbidden-inference guards is dropped, never repaired.
    pub fn sanitized(self) -> Self {
        let clean = |lines: Vec<String>, max: usize| -> Vec<String> {
            lines
                .into_iter()
                .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|line| !line.is_empty())
                .filter(|line| !ielts_domain::contains_security_marker(line))
                .filter(|line| !ielts_domain::contains_forbidden_inference_domain(line))
                .map(|line| line.chars().take(DIGEST_LINE_CHARS).collect::<String>())
                .take(max)
                .collect()
        };
        Self {
            observations: clean(self.observations, DIGEST_MAX_OBSERVATIONS),
            changes: clean(self.changes, DIGEST_MAX_CHANGES),
            next_practice: clean(self.next_practice, DIGEST_MAX_NEXT),
        }
    }
}

/// Store the digest of a weekly run. Idempotent per run.
pub fn put_weekly_digest(conn: &Connection, run_id: &str, digest: &WeeklyDigestProse, now: &str) -> DbResult<()> {
    require_text(run_id, "runId")?;
    let value = serde_json::to_string(digest).map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO weekly_digests (run_id, digest_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(run_id) DO UPDATE SET digest_json = excluded.digest_json, updated_at = excluded.updated_at",
        params![run_id, value, now],
    )?;
    Ok(())
}

fn load_weekly_digest(conn: &Connection, run_id: &str) -> DbResult<WeeklyDigestProse> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT digest_json FROM weekly_digests WHERE run_id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default())
}

/// Migration 0029's data step: digests written before the `weekly_digests`
/// table lived in `settings` (namespace `weekly_digest`, key = run id). Move the
/// ones that still belong to a run, then drop the settings rows. Idempotent.
/// Runs inside the caller's transaction.
pub fn move_settings_weekly_digests_in_transaction(conn: &Connection) -> DbResult<usize> {
    conn.execute(
        "INSERT OR IGNORE INTO weekly_digests (run_id, digest_json, updated_at)
         SELECT s.key, s.value_json, s.updated_at FROM settings s
          WHERE s.namespace = ?1 AND json_valid(s.value_json)
            AND s.key IN (SELECT id FROM dream_runs)",
        params![LEGACY_DIGEST_NAMESPACE],
    )?;
    // Only rows now represented in the table go. Unparseable rows and orphans
    // (no run) stay where they were, so nothing is dropped without a copy.
    Ok(conn.execute(
        "DELETE FROM settings WHERE namespace = ?1
           AND json_valid(value_json) AND key IN (SELECT run_id FROM weekly_digests)",
        params![LEGACY_DIGEST_NAMESPACE],
    )?)
}

/// One completed weekly pass, as the notebook reads it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyDigest {
    /// Idempotency key: ISO week of the weekend the run belongs to.
    pub window: String,
    /// The span the run actually covered, RFC3339 UTC (start exclusive).
    pub window_start: String,
    pub window_end: String,
    pub finished_at: String,
    pub observations: Vec<String>,
    pub changes: Vec<String>,
    pub next_practice: Vec<String>,
}

/// Newest completed weekly runs that have something to say. A run whose pass
/// produced no prose (an empty result is a success) is omitted. Read-only.
pub fn list_weekly_digests(conn: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<WeeklyDigest>> {
    let user_id = normalize_user_id(user_id);
    let mut runs = conn.prepare(
        "SELECT id, input_hash, finished_at FROM dream_runs
          WHERE user_id = ?1 AND status = 'completed' AND finished_at IS NOT NULL
            AND input_hash LIKE 'weekly:%'
          ORDER BY finished_at DESC, id DESC LIMIT ?2",
    )?;
    let rows = runs
        .query_map(params![user_id, limit.min(52) as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut digests = Vec::new();
    for (run_id, marker, finished_at) in rows {
        let Some(window) = window_of_marker(&marker) else { continue };
        let prose = load_weekly_digest(conn, &run_id)?;
        if prose.is_empty() {
            continue;
        }
        digests.push(WeeklyDigest {
            window_start: rfc3339(window.start),
            window_end: rfc3339(window.end),
            window: window.key,
            finished_at,
            observations: prose.observations,
            changes: prose.changes,
            next_practice: prose.next_practice,
        });
    }
    Ok(digests)
}

/// Load a dream run by id.
pub fn load_dream_run(conn: &Connection, run_id: &str) -> DbResult<Option<DreamRun>> {
    require_text(run_id, "runId")?;
    let row = conn
        .query_row(
            "SELECT id, user_id, journal_id, status, input_hash, output_hash, started_at,
                    finished_at, error_json, attempts, created_at, updated_at
             FROM dream_runs
             WHERE id = ?1",
            params![run_id],
            map_run,
        )
        .optional()?;
    Ok(row)
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<DreamRun> {
    let status_str: String = row.get(3)?;
    let status = DreamRunStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid dream run status: {status_str}"),
            )),
        )
    })?;
    let error_json: Option<String> = row.get(8)?;
    let error = error_json
        .as_deref()
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                8,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(DreamRun {
        id: row.get(0)?,
        user_id: row.get(1)?,
        journal_id: row.get(2)?,
        status,
        input_hash: row.get(4)?,
        output_hash: row.get(5)?,
        started_at: row.get(6)?,
        finished_at: row.get(7)?,
        error,
        attempts: row.get::<_, i64>(9)? as u32,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn normalize_user_id(user_id: &str) -> String {
    if user_id.trim().is_empty() {
        DEFAULT_USER_ID.into()
    } else {
        user_id.trim().to_string()
    }
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn window_token_round_trips_and_rejects_garbage() {
        let window = WeeklyWindow::new("2026-W41", at("2026-10-03T04:00:00Z"), at("2026-10-10T09:30:00Z"));
        assert_eq!(window.token(), "2026-W41:2026-10-03T04:00:00Z..2026-10-10T09:30:00Z");
        assert_eq!(WeeklyWindow::parse(&window.token()), Some(window.clone()));
        assert_eq!(window.marker(), "weekly:2026-W41:2026-10-03T04:00:00Z..2026-10-10T09:30:00Z");
        assert_eq!(window.anchor_day(), "2026-10-10");
        for bad in [
            "", "2026-W41", "2026-W41:garbage", "2026-W99:2026-10-03T04:00:00Z..2026-10-10T09:30:00Z",
            "2026-W41:2026-10-10T09:30:00Z..2026-10-03T04:00:00Z",
        ] {
            assert_eq!(WeeklyWindow::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_legacy_marker_covers_its_iso_week() {
        let window = window_of_marker("weekly:2026-W33").unwrap();
        assert_eq!(window.start, at("2026-08-10T00:00:00Z"));
        assert_eq!(window.end, at("2026-08-16T23:59:59Z"));
        assert!(window_of_marker("source-hash").is_none());
    }
}
