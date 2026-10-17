//! M7-01 SQLite Job Worker.
//!
//! A durable process-local job ledger backed by `background_jobs`: there is a
//! single worker per machine, claim is atomic via BEGIN IMMEDIATE +
//! RETURNING (§23.15), and lease timeout reclaims abandoned runs on the next
//! start.
//!
//! The worker is deliberately minimal: it owns claim/heartbeat/finish/fail and
//! startup recovery. Business logic (the deterministic daily journal) lives in
//! the application layer and calls into these primitives. There is one daily
//! job kind, `daily_journal`; `daily_dream` is a legacy kind that old databases
//! may still hold, and it is claimed and completed exactly like a journal job.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

pub const DEFAULT_LEASE_TIMEOUT_SECS: i64 = 300;
pub const DEFAULT_MAX_ATTEMPTS: i64 = 3;
const DEFAULT_USER_ID: &str = "local";
const DAILY_JOURNAL_PRIORITY: i64 = 5;

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
/// legacy `startup_recovery` return value; `journal_jobs_enqueued` counts
/// catch-up jobs created from canonical activity dates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupRecoveryReport {
    pub requeued_jobs: u64,
    pub journal_jobs_enqueued: u64,
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
    // Only the daily journal is queued. The weekly dream bypasses the queue
    // entirely, and `daily_dream` (still allowed by the migration 0018 CHECK)
    // is a legacy kind that nothing enqueues any more.
    if job_kind != "daily_journal" {
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

/// Claim the next automatic daily job. Automatic client work is limited to
/// closed local calendar days (`crate::local_day`). Manual current day work
/// retains its explicit command path and is never stolen by this loop.
pub fn claim_closed_daily_job(conn: &Connection, now: &str, worker_id: &str) -> DbResult<Option<BackgroundJob>> {
    claim_closed_daily_job_in(conn, now, worker_id, &chrono::Local)
}

fn claim_closed_daily_job_in<Tz: chrono::TimeZone>(
    conn: &Connection,
    now: &str,
    worker_id: &str,
    tz: &Tz,
) -> DbResult<Option<BackgroundJob>> {
    let Some(today) = crate::local_day::day_of_timestamp_in(now, tz) else {
        return Ok(None);
    };
    let tx = conn.unchecked_transaction()?;
    if !automatic_learning_enabled(&tx)? {
        return Ok(None);
    }
    let id: Option<String> = tx.query_row(
        "SELECT id FROM background_jobs WHERE status='queued' AND user_id='local'
         AND scheduled_at <= ?1 AND job_kind IN ('daily_journal','daily_dream')
         AND dedupe_key = job_kind || ':local:' || substr(dedupe_key,-10)
         AND date(substr(dedupe_key,-10)) < ?2
         ORDER BY priority DESC, scheduled_at ASC, id LIMIT 1", params![now, today], |r| r.get(0),
    ).optional()?;
    let job = match id {
        Some(id) if claim_job_by_id(&tx, &id, now, worker_id)? => load_job(&tx, &id)?,
        _ => None,
    };
    tx.commit()?;
    Ok(job)
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
    recover_daily_jobs(conn, now, lease_timeout_secs, true)
}

/// Periodic lease/receipt recovery without scanning the activity history.
pub fn recover_daily_leases(conn: &Connection, now: &str, lease_timeout_secs: i64) -> DbResult<u64> {
    Ok(recover_daily_jobs(conn, now, lease_timeout_secs, false)?.requeued_jobs)
}

fn recover_daily_jobs(
    conn: &Connection,
    now: &str,
    lease_timeout_secs: i64,
    catch_up: bool,
) -> DbResult<StartupRecoveryReport> {
    require_text(now, "now")?;
    let tx = conn.unchecked_transaction()?;
    lease_recover(&tx, now, lease_timeout_secs)?;
    // Completing a receipt is not another business attempt. Match the exact
    // persisted business binding before applying the retry-budget terminal gate.
    reconcile_business_receipts(&tx, now, None)?;
    // A crashed final attempt and an explicit final failure have the same
    // terminal semantics. Keep the row (and checkpoint) as the retry receipt.
    tx.execute(
        "UPDATE background_jobs
         SET status = 'failed', last_error = 'retry budget exhausted during startup recovery',
             updated_at = ?1
         WHERE status = 'interrupted' AND attempts >= max_attempts",
        params![now],
    )?;
    // enqueue_job deliberately allows a manual rerun while a prior job is
    // running. Recovering that prior job must not collide with the queued
    // rerun's unique key. Prefer an existing live replacement; otherwise keep
    // the oldest interrupted row. Preserve losers as terminal audit receipts,
    // not stranded interrupted rows that can resurrect on the next startup.
    tx.execute(
        "UPDATE background_jobs AS job
         SET status = 'failed', last_error = 'duplicate window superseded during startup recovery',
             updated_at = ?1
         WHERE job.status = 'interrupted' AND job.dedupe_key IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM background_jobs AS other
             WHERE other.id != job.id AND other.job_kind = job.job_kind
               AND other.user_id = job.user_id AND other.dedupe_key = job.dedupe_key
               AND (other.status IN ('queued', 'running')
                    OR (other.status = 'interrupted'
                        AND (other.created_at, other.id) < (job.created_at, job.id)))
           )",
        params![now],
    )?;
    let requeued = tx.execute(
        "UPDATE background_jobs
         SET status = 'queued', last_error = 'requeued after startup recovery',
             updated_at = ?1
         WHERE status = 'interrupted' AND attempts < max_attempts",
        params![now],
    )?;
    let journal_jobs_enqueued = if catch_up {
        enqueue_missing_daily_jobs(&tx, now)?
    } else {
        0
    };
    tx.commit()?;
    Ok(StartupRecoveryReport {
        requeued_jobs: requeued as u64,
        journal_jobs_enqueued,
    })
}

// Stream source timestamps without deduplicating them; only local activity
// days need a distinct set while the database mutex is held.
const ACTIVITY_WINDOWS_SQL: &str = "SELECT DISTINCT user_id, ielts_local_day(activity_at) AS activity_day FROM (
           SELECT ?1 AS user_id, COALESCE(submitted_at, started_at) AS activity_at
           FROM attempts
           UNION ALL
           SELECT ?1, COALESCE(completed_at, updated_at)
           FROM writing_evaluations
           UNION ALL
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), occurred_at
           FROM learning_events
           UNION ALL
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), observed_at
           FROM learner_observations
           UNION ALL
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), observed_at
           FROM learner_skill_observations
           UNION ALL
           SELECT ?1, created_at
           FROM memory_mutations
           UNION ALL
           SELECT COALESCE(NULLIF(TRIM(user_id), ''), ?1), created_at
           FROM coach_feedback
           UNION ALL
           SELECT ?1, created_at
           FROM coach_reask_links
         )
         WHERE activity_day IS NOT NULL AND activity_day < ?2
         ORDER BY user_id, activity_day";

/// Find canonical activity dates that do not yet have the corresponding daily
/// derived work. Dates are read from the same source tables used by
/// `build_daily_facts`; the derived journal/job tables are intentionally not
/// used to discover activity. A date is the *local* calendar day of the event
/// (`crate::local_day`), the same day `build_daily_facts` bounds, and only days
/// before the local today are closed. Malformed timestamps are ignored.
fn canonical_activity_windows(conn: &Connection, now: &str) -> DbResult<Vec<ActivityWindow>> {
    canonical_activity_windows_in(conn, now, &chrono::Local)
}

fn canonical_activity_windows_in<Tz: chrono::TimeZone + Send + 'static>(
    conn: &Connection,
    now: &str,
    tz: &Tz,
) -> DbResult<Vec<ActivityWindow>> {
    let Some(today) = crate::local_day::day_of_timestamp_in(now, tz) else {
        return Ok(Vec::new());
    };
    crate::local_day::register_local_day_fn(conn, tz.clone())?;
    let mut statement = conn.prepare(ACTIVITY_WINDOWS_SQL)?;
    let rows = statement.query_map(params![DEFAULT_USER_ID, today], |row| {
        Ok(ActivityWindow {
            user_id: row.get(0)?,
            day: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn enqueue_missing_daily_jobs(conn: &Connection, now: &str) -> DbResult<u64> {
    let mut enqueued = 0;
    for window in canonical_activity_windows(conn, now)? {
        let (user_id, day) = (&window.user_id, &window.day);
        let dedupe = format!("daily_journal:{user_id}:{day}");
        if journal_exists(conn, user_id, day)?
            || catch_up_job_exists(conn, "daily_journal", user_id, &dedupe)?
        {
            continue;
        }
        enqueue_job(
            conn,
            "daily_journal",
            user_id,
            now,
            DAILY_JOURNAL_PRIORITY,
            Some(&dedupe),
            Some(&serde_json::json!({"day": day, "userId": user_id})),
        )?;
        enqueued += 1;
    }
    Ok(enqueued)
}

fn journal_exists(conn: &Connection, user_id: &str, day: &str) -> DbResult<bool> {
    let hash: Option<String> = conn.query_row(
        "SELECT source_hash FROM daily_journals WHERE user_id=?1 AND journal_date=?2 ORDER BY version DESC LIMIT 1",
        params![user_id, day],
        |row| row.get(0),
    ).optional()?;
    match hash {
        Some(hash) => Ok(hash == crate::build_daily_facts(conn, user_id, day)?.source_hash),
        None => Ok(false),
    }
}

// Startup is not an explicit user retry. A terminal failure must not acquire a
// fresh attempts=0 identity on every reboot. Manual enqueue remains available.
fn catch_up_job_exists(
    conn: &Connection,
    job_kind: &str,
    user_id: &str,
    dedupe_key: &str,
) -> DbResult<bool> {
    let exists: i64 = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM background_jobs
           WHERE job_kind = ?1 AND user_id = ?2 AND dedupe_key = ?3
             AND status IN ('queued', 'running', 'interrupted', 'failed')
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
    if reconcile_business_receipts(conn, now, Some((job_id, worker_id)))? > 0 {
        return Ok(true);
    }
    if worker_id.starts_with("daily-worker-") && !automatic_learning_enabled(conn)? {
        return pause_owned_daily_job(conn, job_id, worker_id, now);
    }
    if job.attempts < job.max_attempts {
        // Reschedule: back to queued with a delayed scheduled_at.
        let reschedule_at = shift_timestamp(now, reschedule_delay_secs)?;
        conn.execute(
            "UPDATE background_jobs AS job
             SET status = CASE WHEN EXISTS (
                   SELECT 1 FROM background_jobs other WHERE other.id!=job.id
                   AND other.job_kind=job.job_kind AND other.user_id=job.user_id
                   AND other.dedupe_key=job.dedupe_key AND other.status='queued'
                 ) THEN 'failed' ELSE 'queued' END,
                 locked_at = NULL, locked_by = NULL, heartbeat_at = NULL,
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

/// A daily job's business result is its journal version and nothing else, so a
/// job whose checkpoint names a journal that exists with the same source hash is
/// complete, whatever happened to the worker afterwards. This closes a crashed
/// job (`owned == None`) or the caller's own running job (`owned == Some`) without
/// executing it again. Returns the number of jobs closed.
fn reconcile_business_receipts(conn: &Connection, now: &str, owned: Option<(&str, &str)>) -> DbResult<u64> {
    let (id, worker) = (owned.map(|o| o.0), owned.map(|o| o.1));
    let changed = conn.execute(
        "UPDATE background_jobs
            SET status='completed', last_error='completed business receipt recovered',
                locked_at=NULL, locked_by=NULL, heartbeat_at=NULL, updated_at=?1
          WHERE ((?2 IS NULL AND status='interrupted')
                 OR (id=?2 AND locked_by=?3 AND status='running'))
            AND EXISTS (
              SELECT 1 FROM daily_journals j
               WHERE j.id=json_extract(background_jobs.checkpoint_json,'$.journalId')
                 AND j.user_id=background_jobs.user_id
                 AND j.journal_date=json_extract(background_jobs.checkpoint_json,'$.day')
                 AND j.source_hash=json_extract(background_jobs.checkpoint_json,'$.sourceHash'))",
        params![now, id, worker],
    )?;
    Ok(changed as u64)
}

/// Close the caller's own running job once its journal version is bound. Returns
/// whether the job was closed (false: the lease was lost or the binding is stale).
pub fn finish_bound_daily_job(conn: &Connection, id: &str, worker: &str, now: &str) -> DbResult<bool> {
    load_job(conn, id)?.ok_or_else(|| DbError::Validation("daily job missing".into()))?;
    Ok(reconcile_business_receipts(conn, now, Some((id, worker)))? == 1)
}

/// Persist the host-owned journal version a job is bound to, under its lease.
pub fn bind_job_business(conn: &Connection, id: &str, worker: &str, binding: &Value) -> DbResult<()> {
    let changed = conn.execute(
        "UPDATE background_jobs SET checkpoint_json=?1 WHERE id=?2 AND locked_by=?3 AND status='running'",
        params![binding.to_string(), id, worker],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("cannot bind business version without owning job lease".into()));
    }
    Ok(())
}

pub fn automatic_learning_enabled(conn: &Connection) -> DbResult<bool> {
    Ok(crate::get_setting(conn, "features", "memory_auto_candidates_v1")?
        .and_then(|entry| entry.value.as_str().map(str::to_owned))
        .is_none_or(|mode| mode == "proposal_only"))
}

/// Release a paused automatic claim and refund only its current attempt.
pub fn pause_owned_daily_job(conn: &Connection, id: &str, worker: &str, now: &str) -> DbResult<bool> {
    let changed = conn.execute(
        "UPDATE background_jobs AS job SET status=CASE WHEN EXISTS (
           SELECT 1 FROM background_jobs other WHERE other.id!=job.id
           AND other.job_kind=job.job_kind AND other.user_id=job.user_id
           AND other.dedupe_key=job.dedupe_key AND other.status='queued'
         ) THEN 'interrupted' ELSE 'queued' END,
         locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,attempts=MAX(0,attempts-1),updated_at=?1
         WHERE id=?2 AND locked_by=?3 AND status='running'",
        params![now, id, worker],
    )?;
    Ok(changed == 1)
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

#[cfg(test)]
mod local_day_tests {
    use super::*;

    #[test]
    fn activity_days_are_local_calendar_days() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn =
            crate::open_connection(&crate::DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
        crate::migrate(&mut conn).unwrap();
        // 01:30 Beijing on Oct 13 is still Oct 12 in UTC.
        conn.execute(
            "INSERT INTO attempts
               (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
             VALUES ('early', 'reading', 'single', 'completed', ?1, 0, 2, ?1, ?1)",
            ["2026-10-12T17:30:00Z"],
        )
        .unwrap();
        let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        let utc = chrono::FixedOffset::east_opt(0).unwrap();
        let days = |now: &str, tz: &chrono::FixedOffset| {
            canonical_activity_windows_in(&conn, now, tz)
                .unwrap()
                .into_iter()
                .map(|window| window.day)
                .collect::<Vec<_>>()
        };
        // Beijing Oct 13 is still open at 23:00 local (15:00Z).
        assert!(days("2026-10-13T15:00:00Z", &beijing).is_empty());
        assert_eq!(days("2026-10-13T16:00:00Z", &beijing), ["2026-10-13"]);
        assert_eq!(days("2026-10-13T00:00:00Z", &utc), ["2026-10-12"]);
    }

    #[test]
    fn activity_scan_only_deduplicates_days_in_the_query_plan() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn =
            crate::open_connection(&crate::DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
        crate::migrate(&mut conn).unwrap();
        let utc = chrono::FixedOffset::east_opt(0).unwrap();
        crate::local_day::register_local_day_fn(&conn, utc).unwrap();
        let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {ACTIVITY_WINDOWS_SQL}")).unwrap();
        let plan = statement.query_map(params![DEFAULT_USER_ID, "2026-10-13"], |row| {
            row.get::<_, String>(3)
        }).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        assert!(plan.iter().any(|step| step.contains("DISTINCT")), "{plan:?}");
        assert!(!plan.iter().any(|step| step.contains("UNION USING TEMP B-TREE")), "{plan:?}");

        // Thousands of distinct timestamps in one day still produce one window.
        conn.execute_batch(
            "WITH RECURSIVE history(n) AS (
               SELECT 0 UNION ALL SELECT n + 1 FROM history WHERE n < 4095
             )
             INSERT INTO attempts
               (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
             SELECT 'history-' || n, 'reading', 'single', 'completed',
               strftime('%Y-%m-%dT%H:%M:%SZ', '2026-10-12', '+' || n || ' seconds'),
               0, 2, '2026-10-12T00:00:00Z', '2026-10-12T00:00:00Z'
             FROM history;"
        ).unwrap();
        let windows = canonical_activity_windows_in(&conn, "2026-10-13T00:00:00Z", &utc).unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].user_id, DEFAULT_USER_ID);
        assert_eq!(windows[0].day, "2026-10-12");
    }

    #[test]
    fn a_local_day_closes_at_local_midnight() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn =
            crate::open_connection(&crate::DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
        crate::migrate(&mut conn).unwrap();
        let day = "2026-10-12";
        enqueue_job(&conn, "daily_journal", "local", "2026-10-12T00:00:00Z", 5,
            Some(&format!("daily_journal:local:{day}")), Some(&serde_json::json!({"day": day, "userId": "local"})))
            .unwrap();
        let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        // 23:30 Beijing on Oct 12: the day is still open even though it is UTC 15:30.
        assert!(claim_closed_daily_job_in(&conn, "2026-10-12T15:30:00Z", "w", &beijing).unwrap().is_none());
        // 00:30 Beijing on Oct 13 (still Oct 12 in UTC): closed locally.
        assert!(claim_closed_daily_job_in(&conn, "2026-10-12T16:30:00Z", "w", &beijing).unwrap().is_some());
    }
}
