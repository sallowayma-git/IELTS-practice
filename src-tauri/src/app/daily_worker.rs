//! One in-app consumer. No OS scheduler.
//!
//! Two jobs, both best-effort while the app is open:
//! * the daily pass: build the day's deterministic journal (a summary of facts,
//!   no model, no dream);
//! * the weekend pass: the single weekly consolidation, the only model call the
//!   worker makes and the only place memory is consolidated.
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
use ielts_application::JournalService;
use ielts_db::{background_jobs, BackgroundJob, DbError, DbResult, WeeklyWindow};
use ielts_domain::DailyJournalQuery;
use tauri::Manager;

use super::{
    application_store::ApplicationStore,
    state::{AppDb, AppVault},
};
use crate::cognitive_runtime::{
    is_weekend, local_day_start_utc, plan_weekly_window, weekly_candidate_pool, RuntimeManager,
    WEEKLY_MIN_CANDIDATE_POOL,
};

/// How often an idle worker looks at the weekend pass. Cheap checks first, so
/// outside a weekend this is a weekday comparison and nothing else.
const WEEKLY_CHECK_INTERVAL: Duration = Duration::from_secs(600);

pub(crate) fn valid_local_window(user: &str, day: &str) -> bool {
    user == "local"
        && chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .is_ok_and(|date| date.format("%Y-%m-%d").to_string() == day)
}

fn job_day(job: &BackgroundJob) -> DbResult<String> {
    let prefix = format!("{}:{}:", job.job_kind, job.user_id);
    let day = job
        .dedupe_key
        .as_deref()
        .and_then(|key| key.strip_prefix(&prefix))
        .ok_or_else(|| DbError::Validation("daily job has no canonical window".into()))?;
    if !valid_local_window(&job.user_id, day) {
        return Err(DbError::Validation("unsupported daily user/window".into()));
    }
    if let Some(checkpoint) = &job.checkpoint_json {
        if checkpoint.get("day").and_then(serde_json::Value::as_str) != Some(day)
            || checkpoint.get("userId").and_then(serde_json::Value::as_str)
                != Some(job.user_id.as_str())
        {
            return Err(DbError::Validation(
                "daily checkpoint disagrees with owned window".into(),
            ));
        }
    }
    Ok(day.to_owned())
}

pub(crate) fn ensure_journal(db: &AppDb, day: &str) -> DbResult<String> {
    let store = ApplicationStore::new(db);
    let service = JournalService::new(&store);
    let query = DailyJournalQuery {
        user_id: "local".into(),
        journal_date: day.into(),
    };
    let facts = service
        .build_facts(&query)
        .map_err(|error| DbError::Message(error.to_string()))?;
    service
        .load_latest_journal(&query)
        .and_then(|journal| match journal {
            Some(journal) if journal.source_hash == facts.source_hash => Ok(journal),
            _ => service.insert_journal(&facts, None),
        })
        .map(|journal| journal.id)
        .map_err(|error| DbError::Message(error.to_string()))
}

pub(crate) fn journal_binding(
    db: &AppDb,
    day: &str,
    journal_id: &str,
    job_id: &str,
    worker: &str,
) -> DbResult<serde_json::Value> {
    db.with_conn(|conn| {
        let journal = ielts_db::load_latest_journal(conn, "local", day)?
            .filter(|j| j.id == journal_id).ok_or_else(|| DbError::Validation("daily journal changed before binding".into()))?;
        let binding = serde_json::json!({"day":day,"userId":"local","journalId":journal.id,"sourceHash":journal.source_hash,"jobId":job_id,"workerId":worker});
        background_jobs::bind_job_business(conn,job_id,worker,&binding)?;
        background_jobs::load_job(conn, job_id)?
            .and_then(|job| job.checkpoint_json)
            .ok_or_else(|| DbError::Validation("daily binding vanished".into()))
    })
}

/// The whole daily job, for a job this worker already claimed: build (or reuse)
/// the day's deterministic journal, bind the job to that exact version, close it.
/// Returns the journal id. Shared by the automatic worker and "整理今天".
pub(crate) fn run_daily_journal(db: &AppDb, job: &BackgroundJob, worker: &str) -> DbResult<String> {
    let day = job_day(job)?;
    let journal_id = ensure_journal(db, &day)?;
    journal_binding(db, &day, &journal_id, &job.id, worker)?;
    let closed = db.with_conn(|conn| {
        background_jobs::finish_bound_daily_job(conn, &job.id, worker, &chrono::Utc::now().to_rfc3339())
    })?;
    if !closed {
        return Err(DbError::Validation("daily job lease lost before completion".into()));
    }
    Ok(journal_id)
}

/// The weekend window that is due now, or `None`: the cheap, provider-free half
/// of "is the weekly pass worth a model call". Due means: it is a weekend, there
/// is a window since the last completed run, automatic learning is on, this
/// weekend has no completed run, no attempt (completed or failed) was made
/// today, and the host-bounded pool of that window has something to consolidate.
fn weekly_window_due<Tz: chrono::TimeZone>(
    db: &AppDb,
    now: &DateTime<Tz>,
) -> DbResult<Option<WeeklyWindow>> {
    if !is_weekend(now) || !db.with_conn(background_jobs::automatic_learning_enabled)? {
        return Ok(None);
    }
    let last_end = db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local"))?;
    let Some(window) = plan_weekly_window(now, last_end) else { return Ok(None) };
    let since = local_day_start_utc(now).to_rfc3339();
    if db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", &window.key))?
        // A failed attempt is retried by a later tick on a later day, at most once per day.
        || db.with_conn(|conn| ielts_db::weekly_attempted_since(conn, "local", &window.key, &since))?
    {
        return Ok(None);
    }
    let pool = weekly_candidate_pool(db, &window).map_err(|error| DbError::Message(error.to_string()))?;
    let pooled = pool["candidates"].as_array().map_or(0, Vec::len);
    Ok((pooled >= WEEKLY_MIN_CANDIDATE_POOL).then_some(window))
}

/// Record a failed weekly attempt (anchored on the journal of the window's end
/// day) so the weekend is retried on a later day instead of being treated as an
/// empty success.
fn record_weekly_failure(db: &AppDb, window: &WeeklyWindow, error: &serde_json::Value) -> DbResult<()> {
    let journal_id = ensure_journal(db, &window.anchor_day())?;
    let now = chrono::Utc::now().to_rfc3339();
    db.with_conn(|conn| ielts_db::record_failed_weekly_run(conn, "local", &journal_id, &window.key, error, &now))
        .map(|_| ())
}

/// The single weekly consolidation call, for the window that is due on this
/// weekend day. Idempotent per weekend through the `dream_runs` receipt that
/// `run_weekly_consolidation` writes. A window with nothing to consolidate costs
/// nothing; a failed attempt (provider, timeout, malformed model output after the
/// sidecar's own retries, sidecar) is recorded as a failed run and retried by a
/// later tick on a later day, at most once per day; a weekend that never
/// succeeds is folded into the next weekend's window. Returns whether a sidecar
/// run was started.
pub(crate) async fn run_weekly_if_due(app: &tauri::AppHandle, worker: &str) -> DbResult<bool> {
    use ielts_db::{BeginAgentRunCommand, StoredAgentRunStatus};

    let db = app.state::<AppDb>();
    let vault = app.state::<AppVault>();
    let Some(window) = weekly_window_due(&db, &Local::now())? else { return Ok(false) };
    // Without a provider the sidecar would record an empty window and burn it.
    let Ok(provider) = crate::ai::load_provider_config(&db, &vault) else { return Ok(false) };
    let audit_run_id = format!("weekly-dream-{}", uuid::Uuid::new_v4());
    db.with_conn(|conn| {
        ielts_db::begin_agent_run(conn, &BeginAgentRunCommand {
            id: audit_run_id.clone(),
            provider_id: provider.provider.clone(),
            model: provider.model.clone(),
            run_kind: ielts_domain::AgentRunKind::Dream,
        })
    })?;
    let mut audit = crate::app::run_audit::RunAuditGuard::new(
        &db,
        audit_run_id.clone(),
        StoredAgentRunStatus::Failed,
        serde_json::json!({"code": "journal.weekly_abandoned", "message": "weekly dream was abandoned before completion"}),
    );
    let runtime = app.state::<RuntimeManager>();
    let outcome = match runtime.reserve_generation(app).await {
        Ok(mut reservation) => {
            let binding = serde_json::json!({"window": window.token(), "userId": "local", "workerId": worker});
            runtime.run_weekly_dream(&mut reservation, &audit_run_id, &window, binding).await
        }
        Err(error) => Err(error),
    };
    let result = outcome.map_err(|error| error.to_string()).and_then(|payload| {
        payload.get("result").cloned().ok_or_else(|| "weekly result is missing".to_string())
    });
    let failure = match &result {
        Ok(value) if value["fallbackReason"].is_null() => None,
        Ok(value) => Some(("journal.weekly_fallback", value["fallbackReason"].to_string())),
        Err(error) => Some(("journal.weekly_failed", error.clone())),
    };
    match failure {
        None => audit.finish(StoredAgentRunStatus::Completed, result.ok(), None)?,
        Some((code, message)) => {
            let error = serde_json::json!({"code": code, "message": message});
            // Same-day retries are bounded by this failed run row.
            record_weekly_failure(&db, &window, &error)?;
            audit.finish(StoredAgentRunStatus::Failed, None, Some(error))?;
        }
    }
    Ok(true)
}

fn execute(app: &tauri::AppHandle, job: &BackgroundJob, worker: &str) -> DbResult<()> {
    let db = app.state::<AppDb>();
    if !db.with_conn(background_jobs::automatic_learning_enabled)? {
        db.with_conn(|conn| background_jobs::pause_owned_daily_job(conn, &job.id, worker, &chrono::Utc::now().to_rfc3339()))?;
        return Ok(());
    }
    run_daily_journal(&db, job, worker).map(|_| ())
}

/// Spawn only after startup business recovery. The host aborts the handle on
/// Exit; durable leases retain the receipt.
pub(crate) fn start(app: tauri::AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let worker = format!("daily-worker-{}", uuid::Uuid::new_v4());
        // lib::run already performed the startup catch-up scan before setup.
        // Start the periodic clock here rather than repeating that full scan.
        let mut last_scan = Instant::now();
        let mut last_lease_recovery: Option<Instant> = None;
        let mut last_weekly_check: Option<Instant> = None;
        loop {
            let db = app.state::<AppDb>();
            let now = chrono::Utc::now().to_rfc3339();
            let next = db.with_conn(|conn| {
                if last_scan.elapsed() >= Duration::from_secs(900) {
                    background_jobs::startup_recovery_with_catch_up(conn, &now, 300)?;
                    last_scan = Instant::now();
                    last_lease_recovery = Some(Instant::now());
                } else if last_lease_recovery.is_none_or(|last| last.elapsed() >= Duration::from_secs(60)) {
                    background_jobs::recover_daily_leases(conn, &now, 300)?;
                    last_lease_recovery = Some(Instant::now());
                }
                background_jobs::claim_closed_daily_job(conn, &now, &worker)
            });
            match next {
                Ok(Some(job)) => {
                    if let Err(error) = execute(&app, &job, &worker) {
                        tracing::warn!(job_id = %job.id, %error, "automatic daily job failed");
                        if let Err(receipt_error) = db.with_conn(|conn| {
                            background_jobs::fail_job(
                                conn,
                                &job.id,
                                &worker,
                                &chrono::Utc::now().to_rfc3339(),
                                &error.to_string(),
                                60,
                            )
                        }) {
                            tracing::error!(%receipt_error, "could not persist daily failure receipt");
                        }
                    }
                }
                Ok(None) => {
                    // Idle: the weekend pass gets its turn, outside any job lease.
                    if last_weekly_check.is_none_or(|last| last.elapsed() >= WEEKLY_CHECK_INTERVAL) {
                        last_weekly_check = Some(Instant::now());
                        if let Err(error) = run_weekly_if_due(&app, &worker).await {
                            tracing::warn!(%error, "weekly dream failed");
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(60)).await
                }
                Err(error) => {
                    tracing::warn!(%error, "automatic daily scan failed");
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone, Utc};

    fn test_db(name: &str) -> (tempfile::TempDir, AppDb) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        let mut conn = ielts_db::open_connection(&ielts_db::DbOpenOptions::create(&path)).unwrap();
        ielts_db::migrate(&mut conn).unwrap();
        (dir, AppDb::from_test_connection(conn, path))
    }

    fn claimed_daily_job(db: &AppDb, day: &str, worker: &str) -> BackgroundJob {
        db.with_conn(|conn| {
            let id = background_jobs::enqueue_job(conn, "daily_journal", "local", "2026-10-02T00:00:00Z", 5,
                Some(&format!("daily_journal:local:{day}")), None)?;
            background_jobs::claim_job_by_id(conn, &id, "2026-10-02T00:00:00Z", worker)?;
            Ok(background_jobs::load_job(conn, &id)?.unwrap())
        }).unwrap()
    }

    #[test]
    fn automatic_window_is_strict_and_local_only() {
        assert!(valid_local_window("local", "2026-10-01"));
        for (user, day) in [
            ("u2", "2026-10-01"),
            ("local", "2026-02-30"),
            ("local", "2026-1-1"),
        ] {
            assert!(!valid_local_window(user, day));
        }
    }

    #[test]
    fn the_daily_job_is_a_deterministic_summary_with_no_dream() {
        let (_dir, db) = test_db("daily.db");
        let id = ensure_journal(&db, "2026-10-01").unwrap();
        assert_eq!(id, ensure_journal(&db, "2026-10-01").unwrap());

        let job = claimed_daily_job(&db, "2026-10-01", "test-worker");
        assert_eq!(run_daily_journal(&db, &job, "test-worker").unwrap(), id);
        db.with_conn(|conn| {
            assert_eq!(background_jobs::load_job(conn, &job.id)?.unwrap().status, "completed");
            // No dream run, no candidate, no model audit row: just the journal.
            for table in ["dream_runs", "dream_candidates", "agent_runs"] {
                let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?;
                assert_eq!(rows, 0, "{table}");
            }
            Ok(())
        }).unwrap();
    }

    #[test]
    fn a_worker_retry_completes_the_same_journal_version() {
        let (_dir, db) = test_db("retry.db");
        let job = claimed_daily_job(&db, "2026-10-01", "worker-one");
        db.with_conn(|conn| {
            background_jobs::fail_job(conn, &job.id, "worker-one", "2026-10-02T00:00:00Z", "retry", 0)?;
            background_jobs::claim_job_by_id(conn, &job.id, "2026-10-02T00:00:00Z", "worker-two")?;
            Ok(())
        }).unwrap();
        let retry = db.with_conn(|conn| Ok(background_jobs::load_job(conn, &job.id)?.unwrap())).unwrap();
        let journal = run_daily_journal(&db, &retry, "worker-two").unwrap();
        assert_eq!(journal, ensure_journal(&db, "2026-10-01").unwrap());
        // A worker that does not own the lease cannot close the job.
        let stolen = claimed_daily_job(&db, "2026-10-02", "worker-one");
        assert!(run_daily_journal(&db, &stolen, "worker-two").is_err());
    }

    fn at(offset_hours: i32, value: &str) -> DateTime<FixedOffset> {
        FixedOffset::east_opt(offset_hours * 3600).unwrap()
            .from_utc_datetime(&DateTime::parse_from_rfc3339(value).unwrap().naive_utc())
    }

    fn seed_pool_memory(db: &AppDb, id: &str, observed: &str) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,
                   content,status,source_class,created_by,content_hash,last_observed_at,created_at,updated_at)
                 VALUES (?1,'local','strategy','activity:reading','procedural',?1,'label','content','active',
                   'observed','system',?1,?2,?2,?2)",
                rusqlite::params![id, observed],
            )?;
            Ok(())
        }).unwrap();
    }

    #[test]
    fn the_weekend_pass_is_due_once_per_weekend_and_retried_once_per_day() {
        let (_dir, db) = test_db("weekly.db");
        seed_pool_memory(&db, "mem-a", "2026-10-07T10:00:00Z");
        // Saturday 2026-10-10 11:00 local (UTC+8): due. A weekday is not.
        let saturday = at(8, "2026-10-10T03:00:00Z");
        let sunday = at(8, "2026-10-11T03:00:00Z");
        let friday = at(8, "2026-10-09T03:00:00Z");
        assert!(weekly_window_due(&db, &friday).unwrap().is_none());
        let window = weekly_window_due(&db, &saturday).unwrap().expect("a weekend with a pool is due");
        assert_eq!(window.key, "2026-W41");
        assert_eq!(window.end, Utc.with_ymd_and_hms(2026, 10, 10, 3, 0, 0).unwrap());

        // A failed Saturday attempt blocks Saturday, not Sunday, and does not move the window.
        let error = serde_json::json!({"code": "journal.weekly_failed", "message": "provider timeout"});
        record_weekly_failure(&db, &window, &error).unwrap();
        db.with_conn(|conn| {
            // The failure row is stamped "now"; pin it to Saturday for the day bound.
            conn.execute("UPDATE dream_runs SET finished_at='2026-10-10T03:05:00Z', updated_at='2026-10-10T03:05:00Z'", [])?;
            Ok(())
        }).unwrap();
        assert!(weekly_window_due(&db, &saturday).unwrap().is_none());
        let retry = weekly_window_due(&db, &sunday).unwrap().expect("Sunday retries");
        assert_eq!(retry.key, "2026-W41");
        // A failure records no boundary: with no completed run the cap still applies.
        assert_eq!(retry.start, retry.end - chrono::Duration::days(28));

        // A completed run closes the weekend for good, and the next window starts at its end.
        db.with_conn(|conn| {
            let journal = ensure_journal_in(conn, &retry.anchor_day());
            let run = ielts_db::insert_dream_run(conn, "local", &journal, Some(&retry.marker()))?;
            ielts_db::start_dream_run(conn, &run.id, "2026-10-11T03:06:00Z")?;
            ielts_db::finish_dream_run(conn, &run.id, "out", "2026-10-11T03:06:30Z")?;
            Ok(())
        }).unwrap();
        assert!(weekly_window_due(&db, &sunday).unwrap().is_none());
        // Memory observed after the window end is the next weekend's pool.
        seed_pool_memory(&db, "mem-b", "2026-10-14T10:00:00Z");
        let next = weekly_window_due(&db, &at(8, "2026-10-17T03:00:00Z")).unwrap().unwrap();
        assert_eq!((next.key.as_str(), next.start), ("2026-W42", retry.end));
    }

    fn ensure_journal_in(conn: &rusqlite::Connection, day: &str) -> String {
        let facts = ielts_db::build_daily_facts(conn, "local", day).unwrap();
        ielts_db::insert_journal(conn, "local", &facts, None).unwrap().id
    }

    #[test]
    fn an_empty_pool_or_paused_learning_costs_nothing() {
        let (_dir, db) = test_db("quiet.db");
        let saturday = at(8, "2026-10-10T03:00:00Z");
        assert!(weekly_window_due(&db, &saturday).unwrap().is_none(), "no memory, no call");
        seed_pool_memory(&db, "mem-a", "2026-10-07T10:00:00Z");
        assert!(weekly_window_due(&db, &saturday).unwrap().is_some());
        db.with_conn(|conn| {
            ielts_db::upsert_setting(conn, "features", "memory_auto_candidates_v1", &serde_json::json!("disabled"))
        }).unwrap();
        assert!(weekly_window_due(&db, &saturday).unwrap().is_none());
    }
}
