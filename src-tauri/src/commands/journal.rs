//! M7 Daily Journal + M8 Weekly Dream/Consolidation Tauri commands
//! (feature-gated `daily-dream-v1`).
//!
//! The daily journal is a deterministic summary of facts: Rust builds and
//! versions it, no model and no dream are involved. The only dream is the weekly
//! weekly pass, which runs in the Python sidecar; Rust is the durable authority
//! that persists its run, stores its digest prose, and gates its memory mutations.

#![cfg(feature = "daily-dream-v1")]

use ielts_application::{
    ApplicationError, ConsolidationService, DreamService, JournalService, MemoryService,
    SubmitMemoryCandidatesCommand, WeeklyEvidence,
};
use ielts_db::background_jobs::{self, BackgroundJob};
use ielts_db::WeeklyWindow;
use ielts_domain::{WeeklyReport, WeeklyReportState};
use ielts_domain::{
    CommandResponse, DailyDreamQuery, DailyJournal, DailyJournalQuery, ErrorEnvelope,
    MemoryFeedbackKind, MemoryMutationProposalBatch, MemorySourceClass, WeeklyDreamQuery,
    MEMORY_PROPOSAL_SCHEMA_VERSION,
};
use serde::Serialize;
use tauri::State;

use crate::app::application_store::ApplicationStore;
use crate::app::state::AppDb;

/// Read today's journal: build fresh deterministic facts, return the latest
/// version when its source hash still matches, otherwise insert a new version
/// (M7-03). The same path the daily worker takes. No LLM is involved.
#[tauri::command]
pub fn journal_get_daily(
    db: State<'_, AppDb>,
    query: DailyJournalQuery,
) -> CommandResponse<DailyJournal> {
    let store = ApplicationStore::new(db.inner());
    let service = JournalService::new(&store);
    respond(service.ensure_journal(&query))
}

/// Manually rerun the daily journal for a day: build fresh deterministic facts
/// and insert a new versioned journal, superseding the previous one (M7-05).
/// The background_job row is an honest audit trail: the command claims the job
/// it enqueued, marks it completed only after the journal row exists, and
/// records failures via `fail_job` — never before the work happens.
#[tauri::command]
pub fn journal_rerun(
    db: State<'_, AppDb>,
    query: DailyJournalQuery,
) -> CommandResponse<DailyJournal> {
    let store = ApplicationStore::new(db.inner());
    let service = JournalService::new(&store);
    const WORKER_ID: &str = "manual-rerun";
    let now = now_iso();
    // Reclaim stale running leases (e.g. a previous run that panicked) so
    // the ledger never permanently strands a job mid-session.
    let _ = db.with_conn(|conn| background_jobs::lease_recover(conn, &now, 300));
    let dedupe = format!("daily_journal:{}:{}", query.user_id, query.journal_date);
    let enqueue_result = db.with_conn(|conn| {
        background_jobs::enqueue_job(
            conn,
            "daily_journal",
            &query.user_id,
            &now,
            5,
            Some(&dedupe),
            None,
        )
    });
    let job_id = match enqueue_result {
        Ok(id) => id,
        Err(error) => {
            return CommandResponse::failure(ErrorEnvelope::new(
                "journal.background_job_failed",
                error.to_string(),
                false,
            ));
        }
    };
    let claimed = db
        .with_conn(|conn| background_jobs::claim_job_by_id(conn, &job_id, &now, WORKER_ID))
        .unwrap_or(false);
    if !claimed {
        return CommandResponse::failure(ErrorEnvelope::new(
            "journal.background_job_failed",
            "enqueued journal job is not claimable",
            false,
        ));
    }
    let result = service
        .build_facts(&query)
        .and_then(|facts| service.insert_journal(&facts, None));
    match &result {
        Ok(_) => {
            let _ = db.with_conn(|conn| {
                background_jobs::finish_job(conn, &job_id, WORKER_ID, &now_iso())
            });
        }
        Err(error) => {
            let _ = db.with_conn(|conn| {
                background_jobs::fail_job(
                    conn,
                    &job_id,
                    WORKER_ID,
                    &now_iso(),
                    &error.message,
                    0,
                )
            });
        }
    }
    respond(result)
}

/// List all journal versions for a day, including superseded history.
#[tauri::command]
pub fn journal_list_versions(
    db: State<'_, AppDb>,
    query: DailyJournalQuery,
) -> CommandResponse<Vec<DailyJournal>> {
    let store = ApplicationStore::new(db.inner());
    respond(JournalService::new(&store).list_journal_versions(&query))
}

/// "整理今天": refresh the deterministic daily summary of a day on demand. The
/// same job the automatic worker runs: an honest `daily_journal` ledger row that
/// this command enqueues, claims, and closes only after the journal version is
/// bound. No model, no sidecar, no memory proposals (all consolidation is the
/// weekly pass). The command keeps its historical IPC name.
#[tauri::command]
pub fn dream_run_daily(
    db: State<'_, AppDb>,
    query: DailyDreamRunInput,
) -> CommandResponse<DailyJournal> {
    if !crate::app::daily_worker::valid_local_window(&query.user_id, &query.day) {
        return CommandResponse::failure(ErrorEnvelope::new(
            "journal.invalid_request",
            "a valid YYYY-MM-DD day and local user are required",
            false,
        ));
    }
    const WORKER_ID: &str = "manual-dream";
    let now = now_iso();
    let _ = db.with_conn(|conn| background_jobs::lease_recover(conn, &now, 300));
    let dedupe = format!("daily_journal:{}:{}", query.user_id, query.day);
    let claimed = db.with_conn(|conn| {
        let id = background_jobs::enqueue_job(conn, "daily_journal", &query.user_id, &now, 5, Some(&dedupe), None)?;
        let owned = background_jobs::claim_job_by_id(conn, &id, &now, WORKER_ID)?;
        Ok(owned.then(|| background_jobs::load_job(conn, &id)).transpose()?.flatten())
    });
    let job = match claimed {
        Ok(Some(job)) => job,
        Ok(None) => return job_failure("enqueued journal job is not claimable".into()),
        Err(error) => return job_failure(error.to_string()),
    };
    match crate::app::daily_worker::run_daily_journal(db.inner(), &job, WORKER_ID) {
        Ok(journal_id) => load_journal(&db, &query.day, &journal_id),
        Err(error) => {
            let message = error.to_string();
            let _ = db.with_conn(|conn| {
                background_jobs::fail_job(conn, &job.id, WORKER_ID, &now_iso(), &message, 60)
            });
            CommandResponse::failure(ErrorEnvelope::new("journal.build_failed", message, true))
        }
    }
}

fn job_failure(message: String) -> CommandResponse<DailyJournal> {
    CommandResponse::failure(ErrorEnvelope::new("journal.background_job_failed", message, false))
}

fn load_journal(db: &AppDb, day: &str, journal_id: &str) -> CommandResponse<DailyJournal> {
    match db.with_conn(|conn| ielts_db::load_latest_journal(conn, "local", day)) {
        Ok(Some(journal)) if journal.id == journal_id => CommandResponse::success(journal),
        Ok(_) => CommandResponse::failure(ErrorEnvelope::new(
            "journal.build_failed",
            "the daily journal changed while it was being built",
            true,
        )),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new("journal.build_failed", error.to_string(), true)),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyDreamRunInput {
    #[serde(default = "default_local_user")]
    pub user_id: String,
    pub day: String,
}

fn default_local_user() -> String {
    "local".into()
}

/// Read-only: the persisted weekly reports, newest week first, one per week
/// (a completed run's report wins over a failed run's). Nothing here can mutate
/// memory.
#[tauri::command]
pub fn weekly_report_list(
    db: State<'_, AppDb>,
    limit: Option<u32>,
) -> CommandResponse<Vec<ielts_domain::WeeklyReport>> {
    respond_weekly(db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", limit.unwrap_or(8))))
}

/// Read-only: the live report of the week so far (since the last finished
/// weekly run), computed now and never stored. `None` when nothing was
/// practised in it.
#[tauri::command]
pub fn weekly_report_current(db: State<'_, AppDb>) -> CommandResponse<Option<ielts_domain::WeeklyReport>> {
    respond_weekly(live_weekly_report(&db, crate::app::clock::now()))
}

pub(crate) fn live_weekly_report(
    db: &AppDb,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> ielts_db::DbResult<Option<ielts_domain::WeeklyReport>> {
    let last_end = db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local"))?;
    let Some(planned) = crate::cognitive_runtime::plan_weekly_window(&now, last_end) else { return Ok(None) };
    // Named after the weekend that will close it, never the retry key of the
    // weekend before: that week may already have its own finished report.
    let key = live_window_key(db, &now)?;
    let window = ielts_db::WeeklyWindow::new(key, planned.start, planned.end);
    let report = db.with_conn(|conn| {
        ielts_db::build_weekly_report(
            conn,
            "local",
            &window,
            *now.offset(),
            ielts_domain::WeeklyReportState::Live,
            now.with_timezone(&chrono::Utc),
        )
    })?;
    Ok((!report.is_empty()).then_some(report))
}

fn live_window_key(db: &AppDb, now: &chrono::DateTime<chrono::FixedOffset>) -> ielts_db::DbResult<String> {
    let this_weekend = crate::cognitive_runtime::upcoming_weekend_key(now);
    if db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", &this_weekend))? {
        return Ok(crate::cognitive_runtime::upcoming_weekend_key(&(*now + chrono::Duration::days(7))));
    }
    Ok(this_weekend)
}

fn respond_weekly<T: Serialize>(result: ielts_db::DbResult<T>) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new("journal.weekly_report_failed", error.to_string(), false)),
    }
}

/// Inspect background-job status for the diagnostics UI. Returns the most
/// recent jobs (queued/running/interrupted/failed/completed).
#[tauri::command]
pub fn background_job_status(db: State<'_, AppDb>) -> CommandResponse<Vec<BackgroundJobDto>> {
    match db.with_conn(|conn| background_jobs::list_recent_jobs(conn, 50)) {
        Ok(jobs) => CommandResponse::success(jobs.into_iter().map(BackgroundJobDto::from).collect()),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            "journal.background_jobs_failed",
            error.to_string(),
            false,
        )),
    }
}

/// Serialize-only DTO for `BackgroundJob` (the db struct is not `Serialize`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobDto {
    pub id: String,
    pub job_kind: String,
    pub user_id: String,
    pub status: String,
    pub priority: i64,
    pub scheduled_at: String,
    pub locked_at: Option<String>,
    pub heartbeat_at: Option<String>,
    pub attempts: i64,
    pub max_attempts: i64,
    pub dedupe_key: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<BackgroundJob> for BackgroundJobDto {
    fn from(job: BackgroundJob) -> Self {
        Self {
            id: job.id,
            job_kind: job.job_kind,
            user_id: job.user_id,
            status: job.status,
            priority: job.priority,
            scheduled_at: job.scheduled_at,
            locked_at: job.locked_at,
            heartbeat_at: job.heartbeat_at,
            attempts: job.attempts,
            max_attempts: job.max_attempts,
            dedupe_key: job.dedupe_key,
            last_error: job.last_error,
            created_at: job.created_at,
            updated_at: job.updated_at,
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// What the sidecar's one model call produced, after the host parsed it: the
/// narrative (a title and one sentence per block), and the memory mutations in
/// the same wire shape every cognitive proposal uses. Mutations that do not even
/// parse, and those the sidecar already refused, are counted, never dropped
/// silently.
#[derive(Debug)]
pub(crate) struct WeeklySubmission {
    pub narrative: ielts_domain::WeeklyNarrative,
    pub model_available: bool,
    pub mutations: Vec<ielts_domain::MemoryMutationProposal>,
    pub unparsed: usize,
}

impl Default for WeeklySubmission {
    fn default() -> Self {
        Self { narrative: Default::default(), model_available: true, mutations: Vec::new(), unparsed: 0 }
    }
}

impl WeeklySubmission {
    pub(crate) fn from_params(params: &serde_json::Map<String, serde_json::Value>) -> Self {
        let narrative = params
            .get("narrative")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        let model_available = params.get("modelAvailable").and_then(serde_json::Value::as_bool).unwrap_or(true);
        let dropped = params.get("droppedMutations").and_then(serde_json::Value::as_u64).unwrap_or(0) as usize;
        let mut submission = Self { narrative, model_available, unparsed: dropped, ..Self::default() };
        for item in params.get("mutations").and_then(serde_json::Value::as_array).into_iter().flatten() {
            match serde_json::from_value(item.clone()) {
                Ok(mutation) => submission.mutations.push(mutation),
                Err(_) => submission.unparsed += 1,
            }
        }
        submission
    }
}

/// How a weekly run ended, in the counts the sidecar reports back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WeeklyOutcome {
    pub run_id: String,
    pub validated: usize,
    pub rejected: usize,
    pub accepted: usize,
}

/// M8: record one weekly pass over `window`: its report (the deterministic
/// blocks plus the model's whitelisted narrative) and its memory mutations. Every mutation must cite observations of the pack the model was
/// shown and target memories of that pack (`WeeklyEvidence`), then goes through
/// the one cognitive-proposal gate (`MemoryService`): validation, then promotion
/// as the `dream` actor. Nothing is ever deleted; supersede and archive keep the
/// old row. An empty submission is a success.
///
/// Round-3 audit (A3): this is deliberately NOT a `#[tauri::command]`. The
/// webview must never be able to hand the host digest text or mutations; the only
/// entry is the sidecar reverse-RPC handler, which is host-gated.
///
/// The run is persisted BEFORE any mutation so the ledger bounds it, and the
/// `journal_id` is FK-validated by that insert instead of being echoed back
/// unchecked.
pub(crate) fn run_weekly_consolidation(
    db: &AppDb,
    query: &WeeklyDreamQuery,
    submission: WeeklySubmission,
    window: &WeeklyWindow,
) -> Result<WeeklyOutcome, ApplicationError> {
    let store = ApplicationStore::new(db);
    let dream_service = DreamService::new(&store);
    let now = now_iso();

    // Claim the run row first. `dream_runs.journal_id` is NOT NULL with an FK
    // to `daily_journals(id)` under `PRAGMA foreign_keys = ON`, so a
    // nonexistent journal_id fails closed here rather than being accepted and
    // echoed. (It does not prove ownership — nothing correlates journal_id with
    // user_id — but it does prove existence.)
    let dream_query = DailyDreamQuery {
        user_id: query.user_id.clone(),
        journal_id: query.journal_id.clone(),
    };
    // The run row is the weekly receipt: its marker names the weekend (the
    // idempotency key) and the window it covered, so no schema change is needed.
    let marker = window.marker();
    let run = dream_service.insert_dream_run(&dream_query, Some(&marker))?;
    dream_service.start_dream_run(&run.id, &now)?;

    let outcome = apply_weekly_submission(db, &store, query, submission, window, &run.id, &now);
    if let Err(error) = &outcome {
        let _ = dream_service.fail_run(&run.id, &serde_json::json!({ "error": error.to_string() }), &now);
    }
    outcome
}

fn apply_weekly_submission(
    db: &AppDb,
    store: &ApplicationStore<'_>,
    query: &WeeklyDreamQuery,
    submission: WeeklySubmission,
    window: &WeeklyWindow,
    run_id: &str,
    now: &str,
) -> Result<WeeklyOutcome, ApplicationError> {
    let pack = db
        .with_conn(|conn| ielts_db::weekly_pack(conn, &query.user_id, window.start, window.end))
        .map_err(|error| ApplicationError::new("weekly.pack_failed", error.to_string(), true))?;
    let evidence = WeeklyEvidence { observation_ids: pack.evidence_ids(), memory_ids: pack.memory_ids() };

    // Build the report before any memory changes: if the blocks or the narrative
    // cannot be built, the run fails with memory untouched.
    let state = if submission.model_available { WeeklyReportState::Final } else { WeeklyReportState::FinalNoAi };
    let mut report = finished_report(db, window, state, Some(submission.narrative))?;

    let (admitted, refused) = evidence.admitted(submission.mutations);
    let mut rejected = refused + submission.unparsed;
    let mut outcome = ielts_application::AppliedMutations::default();
    if !admitted.is_empty() {
        outcome = MemoryService::new(store).apply_cognitive_mutations(
            &SubmitMemoryCandidatesCommand {
                request_id: ielts_db::weekly_mutation_request_id(run_id),
                user_id: query.user_id.clone(),
                run_id: None,
                batch: MemoryMutationProposalBatch {
                    schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
                    proposals: admitted,
                },
            },
            MemorySourceClass::Consolidated,
            "weekly dream",
        )?;
    }
    rejected += outcome.rejected;
    // The report (with what memory changed) and the run's completion commit
    // together. Should that fail after memory changed, a retry's validator
    // refuses to apply the changes twice (an ADD is a duplicate key, a
    // SUPERSEDE or ARCHIVE target is no longer active, a REINFORCE has no newer
    // evidence), and the report lists every change made since the last
    // completed run, read from the promotion records, so it still carries them.
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        report.memory_changes = ielts_db::weekly_memory_changes(&tx, &query.user_id)?;
        ielts_db::put_weekly_report(&tx, run_id, &report, now)?;
        ielts_db::finish_dream_run(&tx, run_id, &weekly_output_hash(&report), now)?;
        tx.commit()?;
        Ok(())
    })
    .map_err(|error: ielts_db::DbError| {
        let applied: Vec<&str> = outcome.applied.iter().filter_map(|receipt| receipt.memory_id.as_deref()).collect();
        ApplicationError::new(
            "weekly.report_failed",
            format!("{error}; memory changes already applied: {applied:?}"),
            true,
        )
    })?;
    Ok(WeeklyOutcome {
        run_id: run_id.to_owned(),
        validated: outcome.validated,
        rejected,
        accepted: outcome.applied.len(),
    })
}

/// The report a weekly run leaves behind: the window's blocks as they stand
/// now, the narrative that passed the number whitelist, and what weekly runs
/// changed in memory since the last completed one. A failed or no-model report
/// carries those changes too: a failed attempt may already have made them.
pub(crate) fn finished_report(
    db: &AppDb,
    window: &WeeklyWindow,
    state: WeeklyReportState,
    narrative: Option<ielts_domain::WeeklyNarrative>,
) -> Result<WeeklyReport, ApplicationError> {
    let now = crate::app::clock::now();
    db.with_conn(|conn| {
        let mut report =
            ielts_db::build_weekly_report(conn, "local", window, *now.offset(), state, chrono::Utc::now())?;
        if let Some(narrative) = narrative {
            let refused = ielts_db::apply_narrative(&mut report, narrative);
            if refused > 0 {
                tracing::info!(refused, "weekly narrative items refused by the number whitelist");
            }
        }
        report.memory_changes = ielts_db::weekly_memory_changes(conn, "local")?;
        Ok(report)
    })
    .map_err(|error: ielts_db::DbError| ApplicationError::new("weekly.report_failed", error.to_string(), true))
}

/// Deterministic hash over the report and the memories the pass touched.
fn weekly_output_hash(report: &WeeklyReport) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_string(&report.blocks).unwrap_or_default().as_bytes());
    hasher.update(report.title.as_bytes());
    for change in &report.memory_changes {
        hasher.update(b"|");
        hasher.update(change.memory_id.as_bytes());
        hasher.update(change.action.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// M8-09: record user feedback against a stable memory_id. `inaccurate` is
/// strong contradiction but does NOT delete learning facts (M8-09).
#[tauri::command]
pub fn memory_record_feedback(
    db: State<'_, AppDb>,
    memory_id: String,
    feedback_kind: MemoryFeedbackKind,
) -> CommandResponse<ielts_domain::MemoryFeedbackRecord> {
    let store = ApplicationStore::new(db.inner());
    let service = ConsolidationService::new(&store);
    let now = now_iso();
    respond(service.record_memory_feedback(
        &memory_id,
        feedback_kind,
        "local",
        &serde_json::json!({}),
        &now,
    ))
}

/// M8-08: run the stale archive sweep (per-kind policy; archive not delete).
#[tauri::command]
pub fn consolidation_archive_stale(
    db: State<'_, AppDb>,
) -> CommandResponse<ielts_domain::StaleArchiveReport> {
    let store = ApplicationStore::new(db.inner());
    let service = ConsolidationService::new(&store);
    let now = now_iso();
    respond(service.archive_stale(&now))
}

fn respond<T>(
    result: Result<T, ielts_application::ApplicationError>,
) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            error.code,
            error.message,
            error.retryable,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::state::AppPaths;

    fn temp_db() -> (tempfile::TempDir, AppDb) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let paths = AppPaths {
            app_data: root.clone(),
            logs: root.join("logs"),
            backups: root.join("backups"),
            imports: root.join("imports"),
            exports: root.join("exports"),
            diagnostics: root.join("diagnostics"),
            db_dir: root.join("db"),
            legacy_candidates: Vec::new(),
        };
        let db = AppDb::open(&paths).unwrap();
        (dir, db)
    }

    /// Insert a journal so the weekly run has a real FK target, and return its id.
    fn seed_journal(db: &AppDb, user_id: &str) -> String {
        let store = ApplicationStore::new(db);
        let service = JournalService::new(&store);
        let query = DailyJournalQuery {
            user_id: user_id.to_string(),
            journal_date: "2026-10-10".to_string(),
        };
        let facts = service.build_facts(&query).unwrap();
        service.insert_journal(&facts, None).unwrap().id
    }

    fn window(key: &str, start: &str, end: &str) -> WeeklyWindow {
        let at = |value: &str| chrono::DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&chrono::Utc);
        WeeklyWindow::new(key, at(start), at(end))
    }

    fn saturday() -> WeeklyWindow {
        window("2026-W41", "2026-10-03T04:00:00Z", "2026-10-10T09:30:00Z")
    }

    /// Codex review on #243: midweek the retry key still names last weekend, so a
    /// live report keyed by it collided with that weekend's finished report.
    #[test]
    fn the_live_report_is_named_after_the_weekend_that_will_close_it() {
        let (_dir, db) = temp_db();
        let local = |value: &str| chrono::DateTime::parse_from_rfc3339(value).unwrap();
        let key = |value: &str| live_window_key(&db, &local(value)).unwrap();
        assert_eq!(key("2026-10-07T12:00:00+08:00"), "2026-W41", "Wednesday belongs to the coming weekend");
        assert_eq!(key("2026-10-11T12:00:00+08:00"), "2026-W41", "Sunday before its run");

        let journal_id = seed_journal(&db, "local");
        db.with_conn(|conn| ielts_db::record_completed_weekly_run(conn, "local", &journal_id, &saturday(), "2026-10-10T09:30:00Z"))
            .unwrap();
        assert_eq!(key("2026-10-11T12:00:00+08:00"), "2026-W42", "after the weekend closed");
        assert_eq!(key("2026-10-12T09:00:00+08:00"), "2026-W42", "Monday after a finished weekend");
    }

    fn dream_run_status(db: &AppDb, run_id: &str) -> Option<String> {
        db.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT status FROM dream_runs WHERE id=?1",
                    rusqlite::params![run_id],
                    |row| row.get::<_, String>(0),
                )
                .ok())
        })
        .unwrap()
    }

    fn params(value: serde_json::Value) -> WeeklySubmission {
        WeeklySubmission::from_params(value.as_object().unwrap())
    }

    fn narrative_json() -> serde_json::Value {
        serde_json::json!({
            "title": "判断题在两篇文章里都出了错",
            "sentences": {"question_types": "判断题是这周最需要回头看的题型。", "volume": "这周练了 99 篇。"}
        })
    }

    /// Round-3 audit (A3): the weekly path minted a synthetic `weekly-<uuid>`
    /// run id and wrote no `dream_runs` row at all, so an irreversible memory
    /// mutation left no ledger entry.
    #[test]
    fn weekly_consolidation_persists_a_completed_run_row() {
        let (_dir, db) = temp_db();
        let journal_id = seed_journal(&db, "local");
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id };

        // An empty submission is a legitimate success, and still must be
        // recorded: the run happened, it just produced nothing.
        let result = run_weekly_consolidation(&db, &query, WeeklySubmission::default(), &saturday()).unwrap();

        assert!(
            !result.run_id.starts_with("weekly-"),
            "run id must come from the dream_runs authority, not a synthetic uuid"
        );
        assert_eq!(dream_run_status(&db, &result.run_id).as_deref(), Some("completed"));
        assert_eq!((result.validated, result.rejected, result.accepted), (0, 0, 0));
    }

    /// The `journal_id` used to be accepted and echoed without ever being
    /// checked. It is now the FK of the run row, so a forged one fails closed
    /// before any memory is touched.
    #[test]
    fn weekly_consolidation_rejects_an_unknown_journal_id() {
        let (_dir, db) = temp_db();
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id: "journal-does-not-exist".into() };
        let submission = params(serde_json::json!({
            "narrative": narrative_json(),
            "mutations": [add_json("strategy.reading.never", &["obs-x"])],
        }));

        assert!(run_weekly_consolidation(&db, &query, submission, &saturday()).is_err());
        let written: i64 = db
            .with_conn(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM memory_items", [], |row| row.get(0)).unwrap_or(0)))
            .unwrap();
        assert_eq!(written, 0, "no memory may land when the run cannot be claimed");
    }

    /// The weekly run row is the per-weekend idempotency receipt. A week with no
    /// practice leaves a receipt but no report to show; a week without a model
    /// is final without narrative.
    #[test]
    fn weekly_consolidation_leaves_a_receipt_and_no_report_for_an_empty_week() {
        let (_dir, db) = temp_db();
        let journal_id = seed_journal(&db, "local");
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id };
        let due = |key: &str| db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", key)).unwrap();
        assert!(!due("2026-W41"));
        let window = saturday();
        run_weekly_consolidation(&db, &query, WeeklySubmission::default(), &window).unwrap();
        assert!(due("2026-W41") && !due("2026-W42"));
        assert_eq!(db.with_conn(|conn| ielts_db::last_weekly_window_end(conn, "local")).unwrap(), Some(window.end));
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        assert!(reports.is_empty(), "nothing practised, nothing to show");
    }

    /// Another run over the same span (the pack, and so the citable ids, is the same).
    fn rerun_of(window: &WeeklyWindow, key: &str) -> WeeklyWindow {
        WeeklyWindow::new(key, window.start, window.end)
    }

    fn add_json(key: &str, evidence: &[&str]) -> serde_json::Value {
        serde_json::json!({
            "action": "ADD", "namespace": "strategy", "canonicalKey": key,
            "scope": {"type": "activity", "key": "reading"},
            "statement": "判断题里把“没提到”当成“错误”，需要先确认原文有无相反表述。",
            "evidenceObservationIds": evidence,
        })
    }

    fn import_passage(db: &AppDb, dir: &std::path::Path, id: &str) {
        let path = dir.join(format!("{id}.json"));
        let payload = serde_json::json!({
            "examId": id, "meta": {"title": format!("Passage {id}"), "category": id},
            "questionCount": 3, "questionOrder": ["q1", "q2", "q3"],
            "answerKey": {"q1": "TRUE", "q2": "FALSE", "q3": "B"},
            "questionDisplayMap": {"q1": "14", "q2": "15", "q3": "16"},
            "passage": {"blocks": [{"html": "<p>Body text.</p>"}]},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1", "q2"]}, {"kind": "matching", "questionIds": ["q3"]}]
        });
        std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        db.with_conn(|conn| ielts_db::import_asset_payload_file(conn, &path).map(|_| ())).unwrap();
    }

    fn submit(db: &AppDb, attempt: &str, asset: &str, answers: serde_json::Value, when: &str) {
        db.with_conn(|conn| {
            let command = serde_json::json!({
                "attemptId": attempt, "assetId": asset, "answers": answers, "idempotencyKey": attempt
            });
            ielts_db::submit_reading_attempt(conn, &serde_json::from_value(command).unwrap())?;
            conn.execute(
                "UPDATE learning_events SET occurred_at = ?1 WHERE json_extract(payload_json, '$.attemptId') = ?2",
                rusqlite::params![when, attempt],
            )?;
            Ok(())
        }).unwrap();
    }

    fn memories(db: &AppDb) -> Vec<(String, String, String)> {
        db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT id, status, content FROM memory_items WHERE created_by = 'weekly_dream' ORDER BY created_at, id")?;
            let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }).unwrap()
    }

    /// Review on #243: a report that cannot be stored after memory changed must
    /// leave the run failed and retryable, name the memories it changed, and the
    /// retry must not apply them twice.
    #[test]
    fn a_report_write_failure_fails_the_run_and_the_retry_does_not_repeat_its_mutations() {
        let (dir, db) = temp_db();
        import_passage(&db, dir.path(), "P1");
        submit(&db, "a1", "P1", serde_json::json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-05T09:00:00Z");
        let window = saturday();
        let pack = db.with_conn(|conn| ielts_db::weekly_pack(conn, "local", window.start, window.end)).unwrap();
        let miss = pack.lines.iter().find(|line| line.kind == "miss").unwrap().ids[0].clone();
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id: seed_journal(&db, "local") };
        let submission = || params(serde_json::json!({
            "narrative": narrative_json(),
            "mutations": [add_json("strategy.reading.tfng_boundary", &[&miss])],
        }));

        db.with_conn(|conn| Ok(conn.execute_batch(
            "CREATE TEMP TRIGGER fail_report BEFORE INSERT ON weekly_digests
             BEGIN SELECT RAISE(ABORT, 'injected report write failure'); END;",
        )?)).unwrap();
        let error = run_weekly_consolidation(&db, &query, submission(), &window).unwrap_err();
        let written = memories(&db);
        assert_eq!(written.len(), 1);
        assert!(error.to_string().contains(&written[0].0), "the failure names the memory it changed: {error}");
        assert!(!db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", "2026-W41")).unwrap());
        assert!(db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap().is_empty());

        db.with_conn(|conn| Ok(conn.execute_batch("DROP TRIGGER fail_report;")?)).unwrap();
        let retry = run_weekly_consolidation(&db, &query, submission(), &window).unwrap();
        assert_eq!(retry.accepted, 0, "the same ADD is a duplicate the second time");
        assert_eq!(memories(&db).len(), 1);
        assert!(db.with_conn(|conn| ielts_db::weekly_run_completed(conn, "local", "2026-W41")).unwrap());
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        assert_eq!(reports.len(), 1);
        // The change the failed attempt made is still this week's change.
        let changes: Vec<(&str, &str)> =
            reports[0].memory_changes.iter().map(|change| (change.action.as_str(), change.memory_id.as_str())).collect();
        assert_eq!(changes, vec![("ADD", written[0].0.as_str())]);
    }

    /// Changes of one run, by action and memory id.
    fn changes(report: &WeeklyReport) -> Vec<(String, String)> {
        report.memory_changes.iter().map(|change| (change.action.clone(), change.memory_id.clone())).collect()
    }

    /// Fail W41's run after its ADD was promoted (the report write aborts).
    fn a_week_whose_report_write_failed(db: &AppDb, dir: &std::path::Path) -> (WeeklyWindow, Vec<(String, String)>) {
        import_passage(db, dir, "P1");
        submit(db, "a1", "P1", serde_json::json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-05T09:00:00Z");
        let window = saturday();
        let pack = db.with_conn(|conn| ielts_db::weekly_pack(conn, "local", window.start, window.end)).unwrap();
        let miss = pack.lines.iter().find(|line| line.kind == "miss").unwrap().ids[0].clone();
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id: seed_journal(db, "local") };
        db.with_conn(|conn| Ok(conn.execute_batch(
            "CREATE TEMP TRIGGER fail_report BEFORE INSERT ON weekly_digests
             BEGIN SELECT RAISE(ABORT, 'injected report write failure'); END;",
        )?)).unwrap();
        let submission = params(serde_json::json!({
            "narrative": narrative_json(),
            "mutations": [add_json("strategy.reading.tfng_boundary", &[&miss])],
        }));
        run_weekly_consolidation(db, &query, submission, &window).unwrap_err();
        db.with_conn(|conn| Ok(conn.execute_batch("DROP TRIGGER fail_report;")?)).unwrap();
        let written = memories(db);
        assert_eq!(written.len(), 1);
        (window, vec![("ADD".to_owned(), written[0].0.clone())])
    }

    /// Review on #243: the change a failed attempt made is shown on the failed
    /// report, and the W42 run that folds W41 in reports it as its own.
    #[test]
    fn a_change_made_before_a_report_failure_reaches_the_failed_and_the_folded_reports() {
        let (dir, db) = temp_db();
        let (w41, added) = a_week_whose_report_write_failed(&db, dir.path());
        crate::app::daily_worker::record_weekly_failure(&db, &w41, &serde_json::json!({"code": "weekly.report_failed"}))
            .unwrap();
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].state, WeeklyReportState::NarrativeFailed);
        assert_eq!(changes(&reports[0]), added);

        let w42 = window("2026-W42", "2026-10-03T04:00:00Z", "2026-10-17T09:30:00Z");
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id: seed_journal(&db, "local") };
        let folded = run_weekly_consolidation(&db, &query, params(serde_json::json!({"narrative": narrative_json()})), &w42)
            .unwrap();
        assert_eq!(folded.accepted, 0);
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        assert_eq!(reports.iter().map(|report| report.window.as_str()).collect::<Vec<_>>(), vec!["2026-W42"]);
        assert_eq!(changes(&reports[0]), added, "the folded week's change is on the report that closes it");

        // Reported once: nothing is owed to the next week's report.
        assert!(db.with_conn(|conn| ielts_db::weekly_memory_changes(conn, "local")).unwrap().is_empty());
    }

    /// Review on #243: with the model gone, the no-model report that closes the
    /// week still lists the change the failed attempt made.
    #[test]
    fn a_change_made_before_a_report_failure_reaches_the_no_model_report() {
        let (dir, db) = temp_db();
        let (w41, added) = a_week_whose_report_write_failed(&db, dir.path());
        crate::app::daily_worker::record_weekly_without_ai(&db, &w41).unwrap();
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].state, WeeklyReportState::FinalNoAi);
        assert_eq!(changes(&reports[0]), added);
    }

    /// The whole weekly path with a fake model, on real submissions: the pack the
    /// sidecar would read, a model answer written from that pack, and the host
    /// gate. Every mutation cites pack ids or it is refused; accepted ones become
    /// memory with their evidence; nothing is ever deleted.
    #[test]
    fn a_fake_model_over_a_real_pack_writes_a_report_and_gated_memory_mutations() {
        let (dir, db) = temp_db();
        for id in ["P1", "P2"] {
            import_passage(&db, dir.path(), id);
        }
        submit(&db, "a1", "P1", serde_json::json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-05T09:00:00Z");
        submit(&db, "a2", "P2", serde_json::json!({"q1": "FALSE", "q2": "FALSE", "q3": "B"}), "2026-10-07T09:00:00Z");
        let window = saturday();
        let pack = db.with_conn(|conn| ielts_db::weekly_pack(conn, "local", window.start, window.end)).unwrap();
        let first_miss = pack.lines.iter().find(|line| line.kind == "miss" && line.text.starts_with("P1")).unwrap().ids[0].clone();
        let later_miss = pack.lines.iter().find(|line| line.kind == "miss" && line.text.starts_with("P2")).unwrap().ids[0].clone();
        let query = WeeklyDreamQuery { user_id: "local".into(), journal_id: seed_journal(&db, "local") };

        // Run 1: one grounded ADD, one citing an id the pack never offered, one
        // targeting a memory that does not exist, one the validator rejects
        // (writing scope cannot rest on reading evidence), and one malformed.
        let mut wrong_scope = add_json("strategy.writing.x", &[&first_miss]);
        wrong_scope["scope"] = serde_json::json!({"type": "activity", "key": "writing"});
        let first = run_weekly_consolidation(&db, &query, params(serde_json::json!({
            "narrative": narrative_json(),
            "mutations": [
                add_json("strategy.reading.tfng_boundary", &[&first_miss]),
                add_json("strategy.reading.invented", &["obs-forged"]),
                {"action": "REINFORCE", "targetMemoryId": "mem-not-in-pack", "evidenceObservationIds": [first_miss]},
                wrong_scope,
                {"action": "ADD", "bogus": true},
            ],
        })), &window).unwrap();
        assert_eq!((first.validated, first.accepted, first.rejected), (1, 1, 4));
        let written = memories(&db);
        assert_eq!(written.len(), 1);
        let memory = written[0].0.clone();
        let evidence: i64 = db.with_conn(|c| Ok(c.query_row(
            "SELECT COUNT(*) FROM memory_evidence WHERE memory_id = ?1 AND observation_id = ?2",
            rusqlite::params![memory, first_miss], |r| r.get(0))?)).unwrap();
        assert_eq!(evidence, 1, "the memory carries the evidence it was written from");

        // Run 2: the memory is now in the pack, so newer evidence can reinforce it.
        let again = db.with_conn(|conn| ielts_db::weekly_pack(conn, "local", window.start, window.end)).unwrap();
        assert!(again.memory_ids().contains(&memory));
        let second = run_weekly_consolidation(&db, &query, params(serde_json::json!({"mutations": [
            {"action": "REINFORCE", "targetMemoryId": memory, "evidenceObservationIds": [later_miss]},
        ]})), &rerun_of(&window, "2026-W42")).unwrap();
        assert_eq!((second.validated, second.accepted, second.rejected), (1, 1, 0));

        // Run 3: a sharper statement supersedes it; the old row stays, as superseded.
        let sharper = serde_json::json!({
            "action": "SUPERSEDE", "targetMemoryId": memory, "namespace": "strategy",
            "canonicalKey": "strategy.reading.tfng_not_given", "scope": {"type": "activity", "key": "reading"},
            "proposedStatement": "判断题先找反面证据，没有再选 Not Given。", "evidenceObservationIds": [later_miss],
        });
        let third = run_weekly_consolidation(&db, &query, params(serde_json::json!({"mutations": [sharper]})),
            &rerun_of(&window, "2026-W43")).unwrap();
        assert_eq!(third.accepted, 1);
        let rows = memories(&db);
        assert_eq!(rows.len(), 2, "supersede keeps the old row");
        let status = |id: &str| rows.iter().find(|(row, _, _)| row == id).unwrap().1.clone();
        assert_eq!(status(&memory), "superseded");
        assert_eq!(rows.iter().filter(|(_, status, _)| status == "active").count(), 1);

        // The notebook reads one report per week; the first run's narrative
        // passed the whitelist except the sentence with a number nobody computed.
        let reports = db.with_conn(|conn| ielts_db::list_weekly_reports(conn, "local", 8)).unwrap();
        let first_report = reports.iter().find(|report| report.window == "2026-W41").unwrap();
        assert_eq!(first_report.state, WeeklyReportState::Final);
        assert_eq!(first_report.title, "判断题在两篇文章里都出了错");
        let narrative = |id: &str| first_report.blocks.iter().find(|block| block.id == id).and_then(|block| block.narrative.clone());
        assert_eq!(narrative("question_types").as_deref(), Some("判断题是这周最需要回头看的题型。"));
        assert_eq!(narrative("volume"), None, "99 is not in the volume block");
        assert_eq!(first_report.memory_changes.len(), 1);
        assert_eq!(first_report.memory_changes[0].memory_id, memory);
    }

    /// "整理今天" is the deterministic journal and nothing else: no run, no
    /// candidate, no sidecar, and the ledger row it used is closed.
    #[test]
    fn manual_daily_summary_builds_the_journal_through_an_honest_job_and_no_dream() {
        let (_dir, db) = temp_db();
        let now = now_iso();
        let job = db.with_conn(|conn| {
            let id = background_jobs::enqueue_job(conn, "daily_journal", "local", &now, 5,
                Some("daily_journal:local:2026-10-01"), None)?;
            background_jobs::claim_job_by_id(conn, &id, &now, "manual-dream")?;
            Ok(background_jobs::load_job(conn, &id)?.unwrap())
        }).unwrap();
        let journal_id = crate::app::daily_worker::run_daily_journal(&db, &job, "manual-dream").unwrap();
        let loaded = load_journal(&db, "2026-10-01", &journal_id);
        assert!(loaded.ok);
        assert_eq!(loaded.data.unwrap().id, journal_id);
        let (jobs, dreams): (String, i64) = db.with_conn(|conn| Ok((
            background_jobs::load_job(conn, &job.id)?.unwrap().status,
            conn.query_row("SELECT COUNT(*) FROM dream_runs", [], |row| row.get(0))?,
        ))).unwrap();
        assert_eq!((jobs.as_str(), dreams), ("completed", 0));
        assert!(!load_journal(&db, "2026-10-01", "some-other-journal").ok);
    }
}
