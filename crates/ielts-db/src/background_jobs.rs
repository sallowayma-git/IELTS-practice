//! M7-01 SQLite Job Worker.
//!
//! A durable process-local job ledger backed by `background_jobs`. This is NOT
//! a copy of TechSpar's process-local `_task_status` + FastAPI BackgroundTasks:
//! there is a single worker per machine, claim is atomic via BEGIN IMMEDIATE +
//! RETURNING (§23.15), and lease timeout reclaims abandoned runs on the next
//! start.
//!
//! The worker is deliberately minimal: it owns claim/heartbeat/finish/fail and
//! startup recovery. Business logic (journal build, dream run) lives in the
//! application layer and calls into these primitives.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

pub const DEFAULT_LEASE_TIMEOUT_SECS: i64 = 300;
pub const DEFAULT_MAX_ATTEMPTS: i64 = 3;
const DEFAULT_USER_ID: &str = "local";
const DAILY_JOURNAL_PRIORITY: i64 = 5;
const DAILY_DREAM_PRIORITY: i64 = 4;

/// A durable background job row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackgroundJob {
    pub id: String,
    pub job_kind: String,
    pub user_id: String,
    pub status: String,
    pub priority: i64,
    pub scheduled_at: String,
    pub locked_at: Option<String>,
    pub locked_by: Option<String>,
    pub heartbeat_at: Option<String>,
    pub attempts: i64,
    pub max_attempts: i64,
    pub dedupe_key: Option<String>,
    pub last_error: Option<String>,
    pub checkpoint_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

/// Counts the work performed by startup recovery. `requeued_jobs` retains the
/// legacy `startup_recovery` return value; the other fields describe catch-up
/// jobs created from canonical activity dates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupRecoveryReport {
    pub requeued_jobs: u64,
    pub journal_jobs_enqueued: u64,
    pub dream_jobs_enqueued: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActivityWindow {
    user_id: String,
    day: String,
}

/// Enqueue a job. If `dedupe_key` is set and a queued job with the same
/// (job_kind, user_id, dedupe_key) already exists, the enqueue is a no-op and
/// returns the existing job id (idempotent).
pub fn enqueue_job(
    conn: &Connection,
    job_kind: &str,
    user_id: &str,
    scheduled_at: &str,
    priority: i64,
    dedupe_key: Option<&str>,
    checkpoint: Option<&Value>,
) -> DbResult<String> {
    require_text(job_kind, "jobKind")?;
    require_text(user_id, "userId")?;
    require_text(scheduled_at, "scheduledAt")?;
    // Only kinds the background_jobs CHECK constraint accepts. The weekly
    // dream bypasses the queue entirely (dream_run_weekly runs inline), so
    // accepting it here would just crash the INSERT against migration 0018.
    if !matches!(job_kind, "daily_journal" | "daily_dream") {
        return Err(DbError::Validation(format!(
            "unsupported job_kind: {job_kind}"
        )));
    }
    if let Some(key) = dedupe_key {
        require_text(key, "dedupeKey")?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM background_jobs
                 WHERE job_kind = ?1 AND user_id = ?2 AND dedupe_key = ?3 AND status = 'queued'
                 LIMIT 1",
                params![job_kind, user_id, key],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Ok(id);
        }
    }
    let id = format!("job-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let checkpoint_json = checkpoint
        .map(|value| serde_json::to_string(value))
        .transpose()
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO background_jobs (
           id, job_kind, user_id, status, priority, scheduled_at, locked_at, locked_by,
           heartbeat_at, attempts, max_attempts, dedupe_key, last_error, checkpoint_json,
           created_at, updated_at
         ) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, NULL, NULL, NULL, 0, ?6, ?7, NULL, ?8, ?9, ?9)",
        params![
            id,
            job_kind,
            user_id,
            priority,
            scheduled_at,
            DEFAULT_MAX_ATTEMPTS,
            dedupe_key,
            checkpoint_json,
            now,
        ],
    )?;
    Ok(id)
}

/// Atomically claim the next queued job due at or before `now` (§23.15).
///
/// Uses BEGIN IMMEDIATE + UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING
/// so two workers racing on the same database cannot both claim the same job.
/// Selection order is priority DESC, scheduled_at ASC.
pub fn claim_job(conn: &Connection, now: &str, worker_id: &str) -> DbResult<Option<BackgroundJob>> {    require_text(now, "now")?;
    require_text(worker_id, "workerId")?;
    // BEGIN IMMEDIATE acquires a write lock immediately, preventing a race
    // between two workers both reading the same queued row.
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = claim_job_inner(conn, now, worker_id);
    match result {
        Ok(job) => {
            conn.execute_batch("COMMIT")?;
            Ok(job)
        }
        Err(error) => {
            // ROLLBACK is safe even if the transaction is already committed.
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// Claim a specific queued job by id (e.g. the job a command just enqueued).
///
/// `claim_job` always claims the globally next queued job, which is not
/// necessarily the one the caller enqueued. Manual commands that enqueue +
/// run inline must claim their own job so the ledger reflects what actually
/// executed. Returns false when the job is not claimable (already claimed,
/// not queued, or scheduled in the future).
pub fn claim_job_by_id(
    conn: &Connection,
    job_id: &str,
    now: &str,
    worker_id: &str,
) -> DbResult<bool> {
    require_text(job_id, "jobId")?;
    require_text(now, "now")?;
    require_text(worker_id, "workerId")?;
    let changed = conn.execute(
        "UPDATE background_jobs
         SET status = 'running', locked_at = ?1, locked_by = ?2, heartbeat_at = ?1,
             attempts = attempts + 1, updated_at = ?1
         WHERE id = ?3 AND status = 'queued' AND scheduled_at <= ?1",
        params![now, worker_id, job_id],
    )?;
    Ok(changed == 1)
}

fn claim_job_inner(
    conn: &Connection,
    now: &str,
    worker_id: &str,
) -> DbResult<Option<BackgroundJob>> {
    let row = conn
        .query_row(
            "UPDATE background_jobs
             SET status = 'running', locked_at = ?1, locked_by = ?2, heartbeat_at = ?1,
                 attempts = attempts + 1, updated_at = ?1
             WHERE id = (
               SELECT id FROM background_jobs
               WHERE status = 'queued' AND scheduled_at <= ?1
               ORDER BY priority DESC, scheduled_at ASC
               LIMIT 1
             )
             RETURNING id, job_kind, user_id, status, priority, scheduled_at, locked_at,
                       locked_by, heartbeat_at, attempts, max_attempts, dedupe_key, last_error,
                       checkpoint_json, created_at, updated_at",
            params![now, worker_id],
            map_job,
        )
        .optional()?;
    Ok(row)
}

/// Update the heartbeat for a running job. Returns true if the job is still
/// owned by `worker_id` and was updated.
pub fn heartbeat(conn: &Connection, job_id: &str, worker_id: &str, now: &str) -> DbResult<bool> {
    require_text(job_id, "jobId")?;
    require_text(worker_id, "workerId")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE background_jobs
         SET heartbeat_at = ?1, updated_at = ?1
         WHERE id = ?2 AND locked_by = ?3 AND status = 'running'",
        params![now, job_id, worker_id],
    )?;
    Ok(changed == 1)
}

/// Reclaim jobs whose lease has expired: running jobs with a heartbeat older
/// than `lease_timeout_secs` go back to queued (status interrupted). This is the
/// lease-recovery path called on startup and periodically.
pub fn lease_recover(conn: &Connection, now: &str, lease_timeout_secs: i64) -> DbResult<u64> {
    require_text(now, "now")?;
    let cutoff = compute_lease_cutoff(now, lease_timeout_secs)?;
    let changed = conn.execute(
        "UPDATE background_jobs
         SET status = 'interrupted', locked_at = NULL, locked_by = NULL,
             heartbeat_at = NULL, last_error = 'lease timeout', updated_at = ?1
         WHERE status = 'running'
           AND heartbeat_at IS NOT NULL
           AND heartbeat_at < ?2",
        params![now, cutoff],
    )?;
    Ok(changed as u64)
}

/// Backwards-compatible startup recovery entry point. The return value remains
/// the number of interrupted jobs requeued; catch-up counts are available from
/// `startup_recovery_with_catch_up`.
pub fn startup_recovery(conn: &Connection, now: &str, lease_timeout_secs: i64) -> DbResult<u64> {
    Ok(startup_recovery_with_catch_up(conn, now, lease_timeout_secs)?.requeued_jobs)
}

/// Startup recovery: reclaim abandoned leases, requeue interrupted jobs, and
/// enqueue missing daily journal/dream windows derived from canonical activity
/// tables. This only creates queued rows; it never executes business logic.
pub fn startup_recovery_with_catch_up(
    conn: &Connection,
    now: &str,
    lease_timeout_secs: i64,
) -> DbResult<StartupRecoveryReport> {
    require_text(now, "now")?;
    lease_recover(conn, now, lease_timeout_secs)?;
    // Requeue interrupted jobs that still have attempts available.
    let requeued = conn.execute(
        "UPDATE background_jobs
         SET status = 'queued', last_error = 'requeued after startup recovery',
             updated_at = ?1
         WHERE status = 'interrupted' AND attempts < max_attempts",
        params![now],
    )?;
    let (journal_jobs_enqueued, dream_jobs_enqueued) = enqueue_missing_daily_jobs(conn, now)?;
    Ok(StartupRecoveryReport {
        requeued_jobs: requeued as u64,
        journal_jobs_enqueued,
        dream_jobs_enqueued,
    })
}

/// Find canonical activity dates that do not yet have the corresponding daily
/// derived work. Dates are read from the same source tables used by
/// `build_daily_facts`; the derived journal/job tables are intentionally not
/// used to discover activity. SQLite's `date()` accepts the RFC3339 timestamps
/// written by the Rust stores and ignores malformed values by returning NULL.
fn canonical_activity_windows(conn: &Connection, now: &str) -> DbResult<Vec<ActivityWindow>> {
    let mut statement = conn.prepare(
        "SELECT user_id, activity_date FROM (
           SELECT ?1 AS user_id, date(COALESCE(submitted_at, started_at)) AS activity_date
           FROM attempts
           UNION
           SELECT ?1, date(COALESCE(completed_at, updated_at))
           FROM writing_evaluations
           UNION
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), date(occurred_at)
           FROM learning_events
           UNION
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), date(observed_at)
           FROM learner_observations
           UNION
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), date(observed_at)
           FROM learner_skill_observations
           UNION
           SELECT ?1, date(created_at)
           FROM memory_mutations
           UNION
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), date(created_at)
           FROM coach_feedback
           UNION
           SELECT ?1, date(created_at)
           FROM coach_reask_links
         )
         WHERE activity_date IS NOT NULL AND activity_date <= date(?2)
         ORDER BY user_id, activity_date",
    )?;
    let rows = statement.query_map(params![DEFAULT_USER_ID, now], |row| {
        Ok(ActivityWindow {
            user_id: row.get(0)?,
            day: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn enqueue_missing_daily_jobs(
    conn: &Connection,
    now: &str,
) -> DbResult<(u64, u64)> {
    let windows = canonical_activity_windows(conn, now)?;
    let mut journal_jobs_enqueued = 0;
    let mut dream_jobs_enqueued = 0;
    for window in windows {
        let user_id = &window.user_id;
        let day = &window.day;
        let journal_dedupe = format!("daily_journal:{user_id}:{day}");
        if !journal_exists(conn, user_id, &day)?
            && !active_job_exists(conn, "daily_journal", user_id, &journal_dedupe)?
        {
            enqueue_job(
                conn,
                "daily_journal",
                user_id,
                now,
                DAILY_JOURNAL_PRIORITY,
                Some(&journal_dedupe),
                None,
            )?;
            journal_jobs_enqueued += 1;
        }

        let dream_dedupe = format!("daily_dream:{user_id}:{day}");
        if !dream_exists(conn, user_id, &day)?
            && !active_job_exists(conn, "daily_dream", user_id, &dream_dedupe)?
        {
            enqueue_job(
                conn,
                "daily_dream",
                user_id,
                now,
                DAILY_DREAM_PRIORITY,
                Some(&dream_dedupe),
                None,
            )?;
            dream_jobs_enqueued += 1;
        }
    }
    Ok((journal_jobs_enqueued, dream_jobs_enqueued))
}

fn journal_exists(conn: &Connection, user_id: &str, day: &str) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM daily_journals
           WHERE user_id = ?1 AND journal_date = ?2
         )",
        params![user_id, day],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn dream_exists(conn: &Connection, user_id: &str, day: &str) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM dream_runs dr
           JOIN daily_journals dj ON dj.id = dr.journal_id
           WHERE dj.id = (
             SELECT id FROM daily_journals
             WHERE user_id = ?1 AND journal_date = ?2
             ORDER BY version DESC LIMIT 1
           )
             AND dr.user_id = ?1
             AND dj.user_id = ?1
             AND dr.status IN ('queued', 'running', 'completed')
         )",
        params![user_id, day],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

fn active_job_exists(
    conn: &Connection,
    job_kind: &str,
    user_id: &str,
    dedupe_key: &str,
) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM background_jobs
           WHERE job_kind = ?1 AND user_id = ?2 AND dedupe_key = ?3
             AND status IN ('queued', 'running', 'interrupted')
         )",
        params![job_kind, user_id, dedupe_key],
        |row| row.get(0),
    )?;
    Ok(exists != 0)
}

/// Mark a job completed.
pub fn finish_job(conn: &Connection, job_id: &str, worker_id: &str, now: &str) -> DbResult<bool> {
    require_text(job_id, "jobId")?;
    require_text(worker_id, "workerId")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE background_jobs
         SET status = 'completed', locked_at = NULL, locked_by = NULL, heartbeat_at = NULL,
             updated_at = ?1
         WHERE id = ?2 AND locked_by = ?3 AND status = 'running'",
        params![now, job_id, worker_id],
    )?;
    Ok(changed == 1)
}

/// Mark a job failed. Increments attempts (claim already did) and reschedules
/// if attempts < max_attempts; otherwise leaves it failed (terminal).
pub fn fail_job(
    conn: &Connection,
    job_id: &str,
    worker_id: &str,
    now: &str,
    error: &str,
    reschedule_delay_secs: i64,
) -> DbResult<bool> {
    require_text(job_id, "jobId")?;
    require_text(worker_id, "workerId")?;
    require_text(now, "now")?;
    require_text(error, "error")?;
    let job = load_job(conn, job_id)?
        .ok_or_else(|| DbError::Validation("job not found".into()))?;
    if job.locked_by.as_deref() != Some(worker_id) || job.status != "running" {
        return Ok(false);
    }
    if job.attempts < job.max_attempts {
        // Reschedule: back to queued with a delayed scheduled_at.
        let reschedule_at = shift_timestamp(now, reschedule_delay_secs)?;
        conn.execute(
            "UPDATE background_jobs
             SET status = 'queued', locked_at = NULL, locked_by = NULL, heartbeat_at = NULL,
                 last_error = ?1, scheduled_at = ?2, updated_at = ?3
             WHERE id = ?4",
            params![error, reschedule_at, now, job_id],
        )?;
    } else {
        // Terminal failure.
        conn.execute(
            "UPDATE background_jobs
             SET status = 'failed', locked_at = NULL, locked_by = NULL, heartbeat_at = NULL,
                 last_error = ?1, updated_at = ?2
             WHERE id = ?3",
            params![error, now, job_id],
        )?;
    }
    Ok(true)
}

/// Load a job by id.
pub fn load_job(conn: &Connection, job_id: &str) -> DbResult<Option<BackgroundJob>> {
    require_text(job_id, "jobId")?;
    let job = conn
        .query_row(
            "SELECT id, job_kind, user_id, status, priority, scheduled_at, locked_at,
                    locked_by, heartbeat_at, attempts, max_attempts, dedupe_key, last_error,
                    checkpoint_json, created_at, updated_at
             FROM background_jobs
             WHERE id = ?1",
            params![job_id],
            map_job,
        )
        .optional()?;
    Ok(job)
}

/// Load the next queued job due at or before `now` without claiming it
/// (inspection only).
pub fn peek_next_queued(conn: &Connection, now: &str) -> DbResult<Option<BackgroundJob>> {
    require_text(now, "now")?;
    let job = conn
        .query_row(
            "SELECT id, job_kind, user_id, status, priority, scheduled_at, locked_at,
                    locked_by, heartbeat_at, attempts, max_attempts, dedupe_key, last_error,
                    checkpoint_json, created_at, updated_at
             FROM background_jobs
             WHERE status = 'queued' AND scheduled_at <= ?1
             ORDER BY priority DESC, scheduled_at ASC
             LIMIT 1",
            params![now],
            map_job,
        )
        .optional()?;
    Ok(job)
}

fn map_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundJob> {
    let checkpoint_json: Option<String> = row.get(13)?;
    let checkpoint = checkpoint_json
        .as_deref()
        .map(serde_json::from_str::<Value>)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                13,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(BackgroundJob {
        id: row.get(0)?,
        job_kind: row.get(1)?,
        user_id: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        scheduled_at: row.get(5)?,
        locked_at: row.get(6)?,
        locked_by: row.get(7)?,
        heartbeat_at: row.get(8)?,
        attempts: row.get(9)?,
        max_attempts: row.get(10)?,
        dedupe_key: row.get(11)?,
        last_error: row.get(12)?,
        checkpoint_json: checkpoint,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn compute_lease_cutoff(now: &str, lease_timeout_secs: i64) -> DbResult<String> {
    shift_timestamp(now, -lease_timeout_secs)
}

fn shift_timestamp(now: &str, delta_secs: i64) -> DbResult<String> {
    let parsed = chrono::DateTime::parse_from_rfc3339(now)
        .map_err(|error| DbError::Validation(format!("now is not a valid RFC3339 timestamp: {error}")))?;
    let shifted = parsed
        .checked_add_signed(chrono::Duration::seconds(delta_secs))
        .ok_or_else(|| DbError::Validation("timestamp shift overflowed".into()))?;
    Ok(shifted.to_rfc3339())
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

/// List recent jobs (diagnostics UI). Ordered newest-first, bounded by `limit`.
pub fn list_recent_jobs(conn: &Connection, limit: u32) -> DbResult<Vec<BackgroundJob>> {
    let bounded = limit.clamp(1, 200) as i64;
    let mut statement = conn.prepare(
        "SELECT id, job_kind, user_id, status, priority, scheduled_at, locked_at,
                locked_by, heartbeat_at, attempts, max_attempts, dedupe_key, last_error,
                checkpoint_json, created_at, updated_at
         FROM background_jobs
         ORDER BY updated_at DESC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![bounded], map_job)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}
