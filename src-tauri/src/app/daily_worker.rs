//! One in-app consumer. No OS scheduler.
//!
//! Two jobs, both best-effort while the app is open:
//! * the daily pass: build the day's deterministic journal (a summary of facts,
//!   no model, no dream);
//! * the weekly pass: the single weekly consolidation, the only model call the
//!   worker makes and the only place memory is written. It is first attempted on
//!   a Saturday or Sunday, and an attempt that failed is retried on the following
//!   days (once per local day) until it completes or has failed
//!   `WEEKLY_MAX_FAILED_ATTEMPTS` times; then that weekend is given up and the
//!   next weekend's window folds its records in.
use std::time::{Duration, Instant};

use chrono::DateTime;
use ielts_application::JournalService;
use ielts_db::{background_jobs, BackgroundJob, DbError, DbResult, WeeklyWindow};
use ielts_domain::{DailyJournalQuery, WeeklyReportState};
use tauri::Manager;

use super::{
    application_store::ApplicationStore,
    state::{AppDb, AppVault},
};
use crate::cognitive_runtime::{is_weekend, local_day_start_utc, plan_weekly_window, RuntimeManager};

/// How often an idle worker looks at the weekly pass. Cheap checks first, so on
/// an ordinary weekday this is a clock comparison and one indexed lookup.
const WEEKLY_CHECK_INTERVAL: Duration = Duration::from_secs(600);
/// Failed attempts one weekend gets before it is given up until the next weekend.
/// The failed runs stay in `dream_runs`, so the failure remains visible.
const WEEKLY_MAX_FAILED_ATTEMPTS: usize = 3;
const OPERATIONAL_PRUNE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

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
    service
        .ensure_journal(&query)
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

/// The weekly window that is due now, or `None`: the cheap, provider-free half of
/// "is the weekly pass worth a model call". One predicate decides it: the weekend
/// this window belongs to (the latest Saturday or Sunday at or before now) has no
/// completed run, none was attempted today, and either today is a weekend day (the
/// first attempt) or that weekend's earlier attempt failed (the retry, on any
/// following day), and it has not yet failed `WEEKLY_MAX_FAILED_ATTEMPTS` times.
/// Automatic learning must be on.
fn weekly_window_due<Tz: chrono::TimeZone>(
    db: &AppDb,
    now: &DateTime<Tz>,
) -> DbResult<Option<WeeklyWindow>> {
    if !db.with_conn(background_jobs::automatic_learning_enabled)? {
        return Ok(None);
    }
    let last_end = db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local"))?;
    let Some(window) = plan_weekly_window(now, last_end) else { return Ok(None) };
    let since = local_day_start_utc(now).to_rfc3339();
    let (completed, attempted_today, failures) = db.with_conn(|conn| {
        Ok((
            ielts_db::weekly_run_completed(conn, "local", &window.key)?,
            ielts_db::weekly_attempted_since(conn, "local", &window.key, &since)?,
            ielts_db::weekly_failed_attempt_count(conn, "local", &window.key)?,
        ))
    })?;
    Ok(weekly_attempt_due(completed, attempted_today, failures, is_weekend(now)).then_some(window))
}

/// The pure decision behind `weekly_window_due`.
fn weekly_attempt_due(completed: bool, attempted_today: bool, failures: usize, weekend: bool) -> bool {
    !completed && !attempted_today && failures < WEEKLY_MAX_FAILED_ATTEMPTS && (weekend || failures > 0)
}

/// Whether the window holds enough scored observations to be worth a model call.
/// A thin window is not recorded as a run: it simply keeps growing (up to the
/// 28-day cap) until it has something to say.
fn weekly_has_evidence(db: &AppDb, window: &WeeklyWindow) -> DbResult<bool> {
    db.with_conn(|conn| ielts_db::weekly_observation_count(conn, "local", window.start, window.end))
        .map(|count| count >= ielts_db::WEEKLY_MIN_OBSERVATIONS)
}

/// Record a failed weekly attempt (anchored on the journal of the window's end
/// day) so the weekend is retried on a later day instead of being treated as an
/// empty success. `attempt_started` is when this attempt began: a run the
/// consolidation already marked failed since then is the same attempt and is
/// reused, so one attempt never counts twice against the retry cap.
pub(crate) fn record_weekly_failure(
    db: &AppDb,
    window: &WeeklyWindow,
    error: &serde_json::Value,
    attempt_started: &str,
) -> DbResult<()> {
    let journal_id = ensure_journal(db, &window.anchor_day())?;
    let now = chrono::Utc::now().to_rfc3339();
    // The failed run commits on its own: it is what bounds retries to one a day,
    // and it does not close the window, so a missing report costs nothing lasting.
    let run_id = db.with_conn(|conn| {
        match ielts_db::weekly_failed_run_since(conn, "local", &window.key, attempt_started)? {
            Some(id) => Ok(id),
            None => Ok(ielts_db::record_failed_weekly_run(conn, "local", &journal_id, &window.key, error, &now)?.id),
        }
    })?;
    // The blocks are final either way; only the narrative is owed a retry.
    let local = crate::app::clock::now();
    let report = weekly_report_without_narrative(db, window, WeeklyReportState::NarrativeFailed, local)?;
    db.with_conn(|conn| ielts_db::put_weekly_report(conn, "local", &run_id, &report, *local.offset(), &now))
}

/// Close a due window without a model (none configured): its blocks become the
/// week's final report, and the next window starts after it. The report is built
/// first and stored in the same transaction as the run that closes the window,
/// so a report that cannot be built or stored leaves the window due.
pub(crate) fn record_weekly_without_ai(db: &AppDb, window: &WeeklyWindow) -> DbResult<()> {
    let journal_id = ensure_journal(db, &window.anchor_day())?;
    let now = chrono::Utc::now().to_rfc3339();
    let local = crate::app::clock::now();
    let report = weekly_report_without_narrative(db, window, WeeklyReportState::FinalNoAi, local)?;
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let run = ielts_db::record_completed_weekly_run(&tx, "local", &journal_id, window, &now)?;
        ielts_db::put_weekly_report(&tx, "local", &run.id, &report, *local.offset(), &now)?;
        tx.commit()?;
        Ok(())
    })
}

fn weekly_report_without_narrative(
    db: &AppDb,
    window: &WeeklyWindow,
    state: WeeklyReportState,
    now: DateTime<chrono::FixedOffset>,
) -> DbResult<ielts_domain::WeeklyReport> {
    crate::commands::journal::finished_report(db, window, state, now)
        .map_err(|error| DbError::Validation(error.to_string()))
}

/// The single weekly consolidation call, for the window that is due now.
/// Idempotent per weekend through the `dream_runs` receipt that
/// `run_weekly_consolidation` writes. A window with too little evidence costs
/// nothing; a failed attempt (provider, timeout, malformed model output after the
/// sidecar's own retries, sidecar) is recorded as a failed run and retried by a
/// later tick on a later day, at most once per day, until it completes; if it is
/// still failing when the next weekend arrives, that weekend's window covers
/// everything since the last completed run. Returns whether a sidecar run was
/// started.
pub(crate) async fn run_weekly_if_due(app: &tauri::AppHandle, worker: &str) -> DbResult<bool> {
    use ielts_db::{BeginAgentRunCommand, StoredAgentRunStatus};

    let db = app.state::<AppDb>();
    let vault = app.state::<AppVault>();
    let Some(window) = weekly_window_due(&db, &crate::app::clock::now())? else { return Ok(false) };
    if !weekly_has_evidence(&db, &window)? {
        return Ok(false);
    }
    // Without a provider there is no narrative to write: the blocks alone close the week.
    // A vault or database read failure is not "no provider": the window stays due.
    let provider = match crate::ai::load_provider_config(&db, &vault) {
        Ok(provider) => provider,
        Err(error) if crate::ai::is_provider_missing(&error) => {
            record_weekly_without_ai(&db, &window)?;
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    let audit_run_id = format!("weekly-dream-{}", uuid::Uuid::new_v4());
    let attempt_started = chrono::Utc::now().to_rfc3339();
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
    let result = outcome.map_err(|error| error.to_string()).and_then(|payload| weekly_run_result(&payload));
    let failure = match &result {
        Ok(_) => None,
        Err(error) => Some(("journal.weekly_failed", error.clone())),
    };
    match failure {
        None => audit.finish(StoredAgentRunStatus::Completed, result.ok(), None)?,
        Some((code, message)) => {
            let error = serde_json::json!({"code": code, "message": message});
            // Same-day retries are bounded by this failed run row.
            record_weekly_failure(&db, &window, &error, &attempt_started)?;
            audit.finish(StoredAgentRunStatus::Failed, None, Some(error))?;
        }
    }
    Ok(true)
}

/// The sidecar's `dream.weekly` result, or why the attempt failed. A fallback
/// means it never reached the authoritative write: no report exists, so the
/// attempt is recorded as failed and a later day retries it.
fn weekly_run_result(payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let result = payload.get("result").cloned().ok_or_else(|| "weekly result is missing".to_string())?;
    match result.get("fallbackReason").and_then(serde_json::Value::as_str) {
        Some(reason) if !reason.is_empty() => Err(format!("weekly fallback: {reason}")),
        _ => Ok(result),
    }
}

fn execute(app: &tauri::AppHandle, job: &BackgroundJob, worker: &str) -> DbResult<()> {
    let db = app.state::<AppDb>();
    if !db.with_conn(background_jobs::automatic_learning_enabled)? {
        db.with_conn(|conn| background_jobs::pause_owned_daily_job(conn, &job.id, worker, &chrono::Utc::now().to_rfc3339()))?;
        return Ok(());
    }
    run_daily_journal(&db, job, worker).map(|_| ())
}

/// Age-based cleanup of operational traces (class D). Raw data is never pruned
/// here; see `ielts_db::safety`.
fn prune_operational(db: &AppDb) {
    let now = chrono::Utc::now();
    match db.with_conn(|conn| ielts_db::prune_operational_records(conn, now, ielts_db::OPERATIONAL_RETENTION_DAYS)) {
        Ok(report) if report.total() > 0 => tracing::info!(removed = report.total(), "operational records pruned"),
        Ok(_) => {}
        Err(error) => tracing::warn!(%error, "operational record prune failed"),
    }
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
        let mut last_operational_prune: Option<Instant> = None;
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
                    if last_operational_prune.is_none_or(|last| last.elapsed() >= OPERATIONAL_PRUNE_INTERVAL) {
                        last_operational_prune = Some(Instant::now());
                        prune_operational(&db);
                    }
                    // Idle: the weekly pass gets its turn, outside any job lease.
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
            for table in ["dream_runs", "agent_runs"] {
                let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?;
                assert_eq!(rows, 0, "{table}");
            }
            Ok(())
        }).unwrap();
    }

    #[test]
    fn a_stored_journal_is_replaced_once_new_practice_lands() {
        let (dir, db) = test_db("stale.db");
        // The submit happens "now"; check the UTC and local day alike.
        let days = [Utc::now().date_naive(), chrono::Local::now().date_naive()]
            .map(|day| day.format("%Y-%m-%d").to_string());
        let before = days.clone().map(|day| ensure_journal(&db, &day).unwrap());

        let path = dir.path().join("asset.json");
        std::fs::write(&path, serde_json::to_vec(&serde_json::json!({
            "examId": "stale-asset", "meta": {"title": "Stale", "category": "P1"},
            "questionCount": 1, "questionOrder": ["q1"], "answerKey": {"q1": "TRUE"},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}]
        })).unwrap()).unwrap();
        db.with_conn(|conn| {
            let asset = ielts_db::import_asset_payload_file(conn, &path)?;
            ielts_db::submit_reading_attempt(conn, &ielts_db::ReadingSubmitCommand {
                attempt_id: "stale-attempt".into(),
                asset_id: "stale-asset".into(),
                asset_revision: Some(asset.schema_version),
                asset_fingerprint: Some(asset.fingerprint),
                answers: serde_json::json!({"q1": "FALSE"}),
                marked_questions: vec![],
                question_timeline: vec![],
                duration_ms: Some(900),
                title_snapshot: Some("Stale".into()),
                idempotency_key: "stale-submit".into(),
            })?;
            Ok(())
        }).unwrap();

        let fresh = days.clone().map(|day| {
            let id = ensure_journal(&db, &day).unwrap();
            db.with_conn(|conn| ielts_db::load_latest_journal(conn, "local", &day)).unwrap()
                .filter(|journal| journal.id == id).unwrap()
        });
        // The day holding the submit gets a new version whose skill section was
        // projected from the new practice, not the stale derived rows.
        assert!(fresh.iter().zip(&before).any(|(journal, old)| journal.id != *old
            && journal.version == 2
            && !journal.facts.today_observation_ids.is_empty()
            && !journal.facts.skill_deltas.is_empty()));
        for (journal, day) in fresh.iter().zip(&days) {
            assert_eq!(ensure_journal(&db, day).unwrap(), journal.id);
        }
    }

    #[test]
    fn concurrent_readers_and_writes_never_publish_a_stale_or_duplicate_version() {
        let (_dir, db) = test_db("race.db");
        let db = std::sync::Arc::new(db);
        let day = "2026-10-01";
        let writer = {
            let db = db.clone();
            std::thread::spawn(move || {
                for index in 0..40 {
                    db.with_conn(|conn| {
                        conn.execute(
                            "INSERT INTO attempts
                               (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
                             VALUES (?1, 'reading', 'single', 'completed', '2026-10-01T12:00:00Z', 1000, 2,
                                     '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z')",
                            [format!("race-{index}")],
                        )?;
                        Ok(())
                    }).unwrap();
                }
            })
        };
        let readers: Vec<_> = (0..4)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        ensure_journal(&db, day).unwrap();
                    }
                })
            })
            .collect();
        writer.join().unwrap();
        readers.into_iter().for_each(|reader| reader.join().unwrap());

        let latest = ensure_journal(&db, day).unwrap();
        db.with_conn(|conn| {
            let versions = ielts_db::list_journal_versions(conn, "local", day)?;
            assert_eq!(versions[0].id, latest);
            assert_eq!(versions[0].facts.attempts_count, 40, "the newest version saw every write");
            for pair in versions.windows(2) {
                assert_ne!(pair[0].source_hash, pair[1].source_hash, "a version republished unchanged facts");
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

    const SATURDAY: &str = "2026-10-10T03:00:00Z"; // 11:00 local (UTC+8), ISO week 2026-W41
    const KEY: &str = "2026-W41";

    fn journal(db: &AppDb) -> String {
        ensure_journal(db, "2026-10-10").unwrap()
    }

    /// A weekly attempt that failed at `when`.
    fn fail_at(db: &AppDb, key: &str, when: &str) {
        let journal = journal(db);
        let error = serde_json::json!({"code": "journal.weekly_failed", "message": "provider timeout"});
        db.with_conn(|conn| ielts_db::record_failed_weekly_run(conn, "local", &journal, key, &error, when)).unwrap();
    }

    /// A weekly attempt that completed at `when`, covering `window`.
    fn complete_at(db: &AppDb, window: &WeeklyWindow, when: &str) {
        let journal = journal(db);
        db.with_conn(|conn| {
            let run = ielts_db::insert_dream_run(conn, "local", &journal, Some(&window.marker()))?;
            ielts_db::start_dream_run(conn, &run.id, when)?;
            ielts_db::finish_dream_run(conn, &run.id, "out", when)?;
            Ok(())
        }).unwrap();
    }

    fn due(db: &AppDb, local: &DateTime<FixedOffset>) -> Option<WeeklyWindow> {
        weekly_window_due(db, local).unwrap()
    }

    #[test]
    fn the_first_attempt_is_weekend_only() {
        let (_dir, db) = test_db("first.db");
        // Monday to Friday: nothing has failed, so nothing is due.
        for day in 5..=9 {
            assert!(due(&db, &at(8, &format!("2026-10-{day:02}T03:00:00Z"))).is_none(), "weekday {day}");
        }
        let window = due(&db, &at(8, SATURDAY)).expect("Saturday is due");
        assert_eq!(window.key, KEY);
        assert_eq!(window.end, Utc.with_ymd_and_hms(2026, 10, 10, 3, 0, 0).unwrap());
        // No completed run: the cap still bounds the window.
        assert_eq!(window.start, window.end - chrono::Duration::days(28));
        assert!(due(&db, &at(8, "2026-10-11T03:00:00Z")).is_some(), "Sunday is due too");
        db.with_conn(|conn| {
            ielts_db::upsert_setting(conn, "features", "memory_auto_candidates_v1", &serde_json::json!("disabled"))
        }).unwrap();
        assert!(due(&db, &at(8, SATURDAY)).is_none(), "paused learning costs nothing");
    }

    #[test]
    fn a_failed_weekend_is_retried_once_a_day_until_it_completes() {
        let (_dir, db) = test_db("retry.db");
        let saturday = at(8, SATURDAY);
        let window = due(&db, &saturday).unwrap();

        // Saturday fails: no second attempt that day, but Sunday tries again.
        fail_at(&db, KEY, "2026-10-10T03:05:00Z");
        assert!(due(&db, &saturday).is_none());
        let sunday = at(8, "2026-10-11T03:00:00Z");
        assert_eq!(due(&db, &sunday).unwrap().key, KEY);

        // Sunday fails too. Monday is not a weekend, yet it retries the same weekend.
        fail_at(&db, KEY, "2026-10-11T03:05:00Z");
        assert!(due(&db, &sunday).is_none());
        let monday = at(8, "2026-10-12T03:00:00Z");
        let retry = due(&db, &monday).expect("a failed weekend is retried on a weekday");
        assert_eq!(retry.key, KEY, "the retry belongs to the weekend it retries");
        // A failure moves no boundary: with no completed run the cap still bounds the window.
        assert_eq!(retry.start, retry.end - chrono::Duration::days(28));
        assert_eq!(window.start, window.end - chrono::Duration::days(28));

        // Monday succeeds: nothing more until the next weekend.
        complete_at(&db, &retry, "2026-10-12T03:06:00Z");
        for day in 12..=16 {
            assert!(due(&db, &at(8, &format!("2026-10-{day:02}T05:00:00Z"))).is_none(), "after success, day {day}");
        }
        // The next window starts where the completed one ended.
        let next = due(&db, &at(8, "2026-10-17T03:00:00Z")).unwrap();
        assert_eq!((next.key.as_str(), next.start), ("2026-W42", retry.end));
    }

    #[test]
    fn a_weekend_that_succeeded_is_not_run_again_on_monday() {
        let (_dir, db) = test_db("done.db");
        let window = due(&db, &at(8, SATURDAY)).unwrap();
        complete_at(&db, &window, "2026-10-10T03:06:00Z");
        for day in 10..=16 {
            assert!(due(&db, &at(8, &format!("2026-10-{day:02}T05:00:00Z"))).is_none(), "day {day}");
        }
    }

    #[test]
    fn failing_all_week_makes_the_next_weekend_cover_both_weeks() {
        let (_dir, db) = test_db("fold.db");
        // The last completed pass ended on Saturday 2026-10-03.
        let earlier = WeeklyWindow::new(
            "2026-W40",
            Utc.with_ymd_and_hms(2026, 9, 26, 3, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 10, 3, 3, 0, 0).unwrap(),
        );
        complete_at(&db, &earlier, "2026-10-03T03:06:00Z");

        // The weekend and the Monday after it fail, one attempt per day; then the
        // weekend is given up for the rest of the week.
        for day in 10..=12 {
            let now = at(8, &format!("2026-10-{day:02}T03:00:00Z"));
            assert_eq!(due(&db, &now).unwrap().key, KEY, "day {day}");
            fail_at(&db, KEY, &format!("2026-10-{day:02}T03:05:00Z"));
            assert!(due(&db, &now).is_none(), "one attempt per day, day {day}");
        }
        for day in 13..=16 {
            assert!(due(&db, &at(8, &format!("2026-10-{day:02}T03:00:00Z"))).is_none(), "given up, day {day}");
        }
        let failures = db.with_conn(|conn| ielts_db::weekly_failed_attempt_count(conn, "local", KEY)).unwrap();
        assert_eq!(failures, WEEKLY_MAX_FAILED_ATTEMPTS, "the failures stay in the run ledger");
        // The next Saturday is a new weekend whose window reaches back to the last success.
        let next = due(&db, &at(8, "2026-10-17T03:00:00Z")).unwrap();
        assert_eq!(next.key, "2026-W42");
        assert_eq!(next.start, earlier.end);
        assert_eq!(next.end - next.start, chrono::Duration::days(14));
        // Completing it ends the retries of the old, failed weekend for good.
        complete_at(&db, &next, "2026-10-17T03:06:00Z");
        assert!(due(&db, &at(8, "2026-10-19T03:00:00Z")).is_none());
    }

    #[test]
    fn retries_stop_after_the_failure_cap() {
        let first = |weekend| weekly_attempt_due(false, false, 0, weekend);
        assert!(first(true) && !first(false), "the first attempt is weekend-only");
        for failures in 1..WEEKLY_MAX_FAILED_ATTEMPTS {
            assert!(weekly_attempt_due(false, false, failures, false), "retry {failures}");
        }
        for weekend in [true, false] {
            assert!(!weekly_attempt_due(false, false, WEEKLY_MAX_FAILED_ATTEMPTS, weekend), "capped");
            assert!(!weekly_attempt_due(false, true, 1, weekend), "once per local day");
            assert!(!weekly_attempt_due(true, false, 0, weekend), "completed");
        }
    }

    #[test]
    fn a_sidecar_fallback_is_a_failed_attempt_not_a_quiet_success() {
        let success = serde_json::json!({"result": {
            "runId": "drmrun-1", "validated": 2, "rejected": 0, "accepted": 1, "fallbackReason": null
        }});
        assert!(weekly_run_result(&success).is_ok());
        let fallback = serde_json::json!({"result": {
            "runId": "", "validated": 0, "rejected": 0, "accepted": 0,
            "fallbackReason": "model_invoke_failed:ProtocolError"
        }});
        let error = weekly_run_result(&fallback).unwrap_err();
        assert!(error.contains("model_invoke_failed"), "{error}");
        assert!(weekly_run_result(&serde_json::json!({})).is_err());
    }

    fn seed_scored_outcome(db: &AppDb, index: usize) {
        use sha2::{Digest, Sha256};
        db.with_conn(|conn| {
            let payload = serde_json::json!({
                "attemptId": "attempt-1", "assetId": "P1", "questionId": format!("q{index}"),
                "attemptOrdinal": 1, "isCorrect": index % 2 == 0, "questionKind": "tfng",
                "changeCount": 0, "visitCount": 1, "elapsedMs": 900, "firstTryCorrect": true
            }).to_string();
            conn.execute(
                "INSERT INTO learning_events (id, user_id, event_type, source_kind, source_id, idempotency_key,
                    activity, asset_id, attempt_id, question_id, occurred_at, payload_json, content_hash,
                    schema_version, consolidation_state, sensitivity, created_at, updated_at)
                 VALUES (?1, 'local', 'reading_question_outcome', 'test', ?1, ?1, 'reading', 'P1', NULL, ?2,
                    '2026-10-07T10:00:00Z', ?3, ?4, 1, 'pending', 'normal', '2026-10-07T10:00:00Z', '2026-10-07T10:00:00Z')",
                rusqlite::params![format!("ev-{index}"), format!("q{index}"), payload, hex::encode(Sha256::digest(payload.as_bytes()))],
            )?;
            Ok(())
        }).unwrap();
    }

    #[test]
    fn too_little_evidence_costs_no_model_call() {
        let (_dir, db) = test_db("evidence.db");
        let window = due(&db, &at(8, SATURDAY)).unwrap();
        assert!(!weekly_has_evidence(&db, &window).unwrap(), "no observations at all");
        for index in 0..ielts_db::WEEKLY_MIN_OBSERVATIONS - 1 {
            seed_scored_outcome(&db, index);
        }
        assert!(!weekly_has_evidence(&db, &window).unwrap());
        seed_scored_outcome(&db, ielts_db::WEEKLY_MIN_OBSERVATIONS);
        assert!(weekly_has_evidence(&db, &window).unwrap());
    }

    /// Review on #243: the no-model path closed the window before storing its
    /// report, so a failed write dropped the report and the window for good.
    #[test]
    fn a_no_model_week_whose_report_cannot_be_stored_stays_due() {
        let (_dir, db) = test_db("no-ai-fail.db");
        let window = due(&db, &at(8, SATURDAY)).unwrap();
        db.with_conn(|conn| Ok(conn.execute_batch(
            "CREATE TEMP TRIGGER fail_report BEFORE INSERT ON weekly_digests
             BEGIN SELECT RAISE(ABORT, 'injected report write failure'); END;",
        )?)).unwrap();
        assert!(record_weekly_without_ai(&db, &window).is_err());
        assert!(!db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", KEY)).unwrap());
        assert_eq!(db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local")).unwrap(), None);
        assert!(due(&db, &at(8, SATURDAY)).is_some(), "the weekend is still owed its report");
    }

    #[test]
    fn a_consolidation_failure_and_the_worker_count_as_one_attempt() {
        let (_dir, db) = test_db("one-attempt.db");
        let window = due(&db, &at(8, SATURDAY)).unwrap();
        let count = || db.with_conn(|conn| ielts_db::weekly_failed_attempt_count(conn, "local", KEY)).unwrap();
        // Yesterday's attempt failed on its own: it stays a separate attempt.
        fail_at(&db, KEY, "2000-01-01T00:00:00Z");
        let started = chrono::Utc::now().to_rfc3339();
        // The host consolidation marks its own run failed, then the error reaches the worker.
        let journal = journal(&db);
        let error = serde_json::json!({"code": "weekly.report_failed"});
        db.with_conn(|conn| {
            let run = ielts_db::insert_dream_run(conn, "local", &journal, Some(&window.marker()))?;
            ielts_db::start_dream_run(conn, &run.id, &started)?;
            ielts_db::fail_dream_run(conn, &run.id, &error, &chrono::Utc::now().to_rfc3339())?;
            Ok(())
        }).unwrap();
        record_weekly_failure(&db, &window, &error, &started).unwrap();
        assert_eq!(count(), 2, "one earlier attempt plus this one, not three");
        // An attempt that failed before anything was recorded still leaves a row.
        record_weekly_failure(&db, &window, &error, &chrono::Utc::now().to_rfc3339()).unwrap();
        assert_eq!(count(), 3);
    }

    #[test]
    fn a_week_without_a_model_closes_with_its_blocks_and_a_failure_keeps_them() {
        let (_dir, db) = test_db("no-ai.db");
        let window = due(&db, &at(8, SATURDAY)).unwrap();
        record_weekly_without_ai(&db, &window).unwrap();
        assert!(db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", KEY)).unwrap());
        assert_eq!(db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local")).unwrap(), Some(window.end));
        assert!(due(&db, &at(8, SATURDAY)).is_none(), "the weekend is closed");

        let error = serde_json::json!({"code": "journal.weekly_failed", "message": "provider timeout"});
        let next = WeeklyWindow::new("2026-W42", window.end, window.end + chrono::Duration::days(7));
        record_weekly_failure(&db, &next, &error, &chrono::Utc::now().to_rfc3339()).unwrap();
        assert_eq!(db.with_conn(|conn| ielts_db::weekly_failed_attempt_count(conn, "local", "2026-W42")).unwrap(), 1);
    }
}
