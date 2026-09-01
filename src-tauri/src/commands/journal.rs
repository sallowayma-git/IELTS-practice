//! M7 Daily Journal + Daily Dream + M8 Weekly Dream/Consolidation Tauri commands
//! (feature-gated `daily-dream-v1`).
//!
//! Exposes the Rust-owned journal/dream/consolidation authority to the UI.
//! The actual LLM enrichment runs in the Python sidecar; Rust is the durable
//! authority that builds deterministic facts, persists versioned journals,
//! records dream proposals as pending candidates (never writing active memory),
//! and re-validates weekly consolidation patterns by stable ID.

#![cfg(feature = "daily-dream-v1")]

use ielts_application::{
    ApplicationError, ConsolidationService, DreamService, JournalService,
};
use ielts_db::background_jobs::{self, BackgroundJob};
use ielts_db::{BeginAgentRunCommand, StoredAgentRunStatus};
use ielts_domain::{
    AgentRunKind, CommandResponse, DailyDreamQuery, DailyDreamResult, DailyJournal,
    DailyJournalQuery, ErrorEnvelope, MemoryFeedbackKind, PatternProposal, WeeklyDreamQuery,
};
use serde::Serialize;
use tauri::State;

use crate::app::application_store::ApplicationStore;
use crate::app::run_audit::RunAuditGuard;
use crate::app::state::AppDb;
use crate::cognitive_runtime::RuntimeManager;

/// Read or build today's journal. If a published journal exists for the day it
/// is returned; otherwise the deterministic facts are built and a new version
/// is inserted (M7-03). No LLM is involved on this path.
#[tauri::command]
pub fn journal_get_daily(
    db: State<'_, AppDb>,
    query: DailyJournalQuery,
) -> CommandResponse<DailyJournal> {
    let store = ApplicationStore::new(db.inner());
    let service = JournalService::new(&store);
    let result = service.load_latest_journal(&query).and_then(|maybe| match maybe {
        Some(journal) => Ok(journal),
        None => {
            let facts = service.build_facts(&query)?;
            service.insert_journal(&facts, None)
        }
    });
    respond(result)
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
    // The current JournalStore port only exposes the latest journal; version
    // history listing is a future diagnostic. Return an empty list rather than
    // fabricating a single-row result so the UI degrades cleanly.
    let _ = (db, query);
    respond(Ok(Vec::new()))
}

/// Trigger a daily dream run: enqueue + claim an honest `daily_dream` audit
/// job, then drive the Python sidecar's deterministic consolidation pass
/// (M7-06) over the reverse-RPC gateway. The Python orchestrator submits its
/// proposals via `dream.run_daily`; Rust stays the only writer — the run row,
/// its queued→running→completed lifecycle, and the candidates are all created
/// on the Rust authority side. Host failure is fail-closed: the job and the
/// sidecar result both record the failure, the practice loop is unaffected.
#[tauri::command]
pub async fn dream_run_daily(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    runtime: State<'_, RuntimeManager>,
    query: DailyDreamRunInput,
) -> Result<CommandResponse<DailyDreamResult>, ErrorEnvelope> {
    Ok(dream_run_daily_inner(app, db, runtime, query).await)
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

async fn dream_run_daily_inner(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    runtime: State<'_, RuntimeManager>,
    query: DailyDreamRunInput,
) -> CommandResponse<DailyDreamResult> {
    if query.day.trim().is_empty() {
        return CommandResponse::failure(ErrorEnvelope::new(
            "journal.invalid_request",
            "day is required",
            false,
        ));
    }
    const WORKER_ID: &str = "manual-dream";
    let now = now_iso();
    let _ = db.with_conn(|conn| background_jobs::lease_recover(conn, &now, 300));
    let dedupe = format!("daily_dream:{}:{}", query.user_id, query.day);

    // 1. Honest job ledger: enqueue, then claim the job THIS command owns.
    let job_id = match db.with_conn(|conn| {
        background_jobs::enqueue_job(
            conn,
            "daily_dream",
            &query.user_id,
            &now,
            4,
            Some(&dedupe),
            None,
        )
    }) {
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
            "enqueued dream job is not claimable",
            false,
        ));
    }

    // 2. Agent-run audit row for the deterministic dream pass (run_kind Dream).
    let audit_run_id = format!("dream-{}", uuid::Uuid::new_v4());
    if let Err(error) = db.with_conn(|conn| {
        ielts_db::begin_agent_run(
            conn,
            &BeginAgentRunCommand {
                id: audit_run_id.clone(),
                provider_id: "deterministic".into(),
                model: "daily-dream-v1".into(),
                run_kind: AgentRunKind::Dream,
            },
        )
    }) {
        let _ = db.with_conn(|conn| {
            background_jobs::fail_job(conn, &job_id, WORKER_ID, &now_iso(), &error.to_string(), 0)
        });
        return CommandResponse::failure(ErrorEnvelope::new(
            "journal.audit_failed",
            error.to_string(),
            false,
        ));
    }
    let mut audit = RunAuditGuard::new(
        db.inner(),
        audit_run_id.clone(),
        StoredAgentRunStatus::Failed,
        serde_json::json!({
            "code": "journal.dream_abandoned",
            "message": "daily dream run was abandoned before completion",
        }),
    );

    // 3. Reserve the sidecar and drive the orchestrator.
    let mut reservation = match runtime.reserve_generation(&app).await {
        Ok(reservation) => reservation,
        Err(error) => {
            return dream_fail(
                &db,
                &mut audit,
                &job_id,
                WORKER_ID,
                "journal.runtime_unavailable",
                &error.to_string(),
            )
        }
    };
    let outcome = runtime
        .run_daily_dream(&mut reservation, &audit_run_id, &query.day)
        .await;
    let payload = match outcome {
        Ok(value) => value,
        Err(crate::cognitive_runtime::RuntimeHostError::Cancelled) => {
            return dream_cancelled(&db, &mut audit, &job_id, WORKER_ID)
        }
        Err(error) => {
            return dream_fail(
                &db,
                &mut audit,
                &job_id,
                WORKER_ID,
                "journal.runtime_failed",
                &error.to_string(),
            )
        }
    };
    let result_value = payload
        .get("result")
        .cloned()
        .ok_or_else(|| "dream result is missing".to_owned());
    let dream_result: DreamOutcome = match result_value
        .and_then(|value| serde_json::from_value(value).map_err(|error| error.to_string()))
    {
        Ok(outcome) => outcome,
        Err(error) => {
            return dream_fail(&db, &mut audit, &job_id, WORKER_ID, "journal.runtime_invalid", &error)
        }
    };
    if let Some(reason) = dream_result.fallback_reason.as_deref() {
        // Fail-closed fallback from the orchestrator (e.g. capability
        // mismatch): the sidecar ran but produced no authoritative run.
        return dream_fail(&db, &mut audit, &job_id, WORKER_ID, "journal.dream_fallback", reason);
    }

    // 4. Load the authoritative run + candidates and close the ledger.
    //    (Created here so the non-Send DreamStore borrow never spans an await.)
    let store = ApplicationStore::new(db.inner());
    let service = DreamService::new(&store);
    let load = service.load_result(&dream_result.run_id);
    match load {
        Ok(Some(result)) => {
            let _ = db.with_conn(|conn| {
                background_jobs::finish_job(conn, &job_id, WORKER_ID, &now_iso())
            });
            let _ = audit.finish(
                StoredAgentRunStatus::Completed,
                Some(serde_json::json!({
                    "runId": result.run.id,
                    "accepted": dream_result.accepted,
                    "rejected": dream_result.rejected,
                    "failed": dream_result.failed,
                })),
                None,
            );
            CommandResponse::success(result)
        }
        Ok(None) => dream_fail(
            &db,
            &mut audit,
            &job_id,
            WORKER_ID,
            "journal.dream_run_missing",
            "sidecar reported a run the store cannot load",
        ),
        Err(error) => dream_fail(&db, &mut audit, &job_id, WORKER_ID, "journal.dream_load_failed", &error.to_string()),
    }
}

/// Wire shape of the Python `dream.daily` dispatch result.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DreamOutcome {
    run_id: String,
    #[serde(default)]
    accepted: i64,
    #[serde(default)]
    rejected: i64,
    #[serde(default)]
    failed: i64,
    #[serde(default)]
    fallback_reason: Option<String>,
}

fn dream_fail(
    db: &AppDb,
    audit: &mut RunAuditGuard<'_>,
    job_id: &str,
    worker_id: &str,
    code: &str,
    message: &str,
) -> CommandResponse<DailyDreamResult> {
    let failed = db.with_conn(|conn| {
        background_jobs::fail_job(conn, job_id, worker_id, &now_iso(), message, 0)
    });
    if let Ok(false) = failed {
        tracing::warn!(job_id, "dream job was not owned by this worker; ledger untouched");
    }
    let audit_error = serde_json::json!({"code": code, "message": message});
    if let Err(finish_error) = audit.finish(StoredAgentRunStatus::Failed, None, Some(audit_error)) {
        tracing::warn!(%finish_error, "failed to close dream agent run");
    }
    CommandResponse::failure(ErrorEnvelope::new(code, message.to_string(), true))
}

fn dream_cancelled(
    db: &AppDb,
    audit: &mut RunAuditGuard<'_>,
    job_id: &str,
    worker_id: &str,
) -> CommandResponse<DailyDreamResult> {
    let message = "daily dream run was cancelled";
    let failed = db.with_conn(|conn| {
        background_jobs::fail_job(conn, job_id, worker_id, &now_iso(), message, 0)
    });
    if let Ok(false) = failed {
        tracing::warn!(job_id, "dream job was not owned by this worker; ledger untouched");
    }
    let audit_error = serde_json::json!({"code": "journal.dream_cancelled", "message": message, "retryable": true});
    if let Err(finish_error) = audit.finish(StoredAgentRunStatus::Interrupted, None, Some(audit_error)) {
        tracing::warn!(%finish_error, "failed to close cancelled dream agent run");
    }
    CommandResponse::failure(ErrorEnvelope::new(
        "journal.dream_cancelled",
        message.to_string(),
        true,
    ))
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

/// M8: run a Weekly Dream consolidation. Rust re-validates the proposed
/// cross-scope patterns by stable memory ID (M8-02), applies consolidation as
/// relations + supersede (M8-06, never deletes), and returns the report +
/// receipts. Empty validated is success (M8-01: better zero than a wrong
/// pattern).
///
/// Round-3 audit (A3): this is deliberately NOT a `#[tauri::command]`.
///
/// It used to be one, registered in `generate_handler!`, taking
/// `patterns: Vec<PatternProposal>` straight off the wire. Since
/// `capabilities/main.json` grants blanket `core:*` with no per-command ACL,
/// any code running in the webview could hand this function arbitrary
/// statements and arbitrary `mem-*` support ids, and `apply_consolidation`
/// would write those statements into `memory_items` as `status='active'` while
/// flipping the named supports to `superseded`. That made the webview a
/// source of trusted, irreversible memory mutations — the exact inversion the
/// architecture forbids. Dropping the attribute means serde can never
/// deserialize `patterns` from the webview again; the only remaining entry is
/// the sidecar reverse-RPC handler, which is host-gated.
///
/// The run is persisted BEFORE any mutation so the ledger bounds it, and the
/// `journal_id` is FK-validated by that insert instead of being echoed back
/// unchecked.
pub(crate) fn run_weekly_consolidation(
    db: &AppDb,
    query: &WeeklyDreamQuery,
    patterns: &[PatternProposal],
) -> Result<ielts_application::WeeklyDreamResult, ApplicationError> {
    let store = ApplicationStore::new(db);
    let service = ConsolidationService::new(&store);
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
    let run = dream_service.insert_dream_run(&dream_query, None)?;
    dream_service.start_dream_run(&run.id, &now)?;

    let outcome = (|| -> Result<ielts_application::WeeklyDreamResult, ApplicationError> {
        let report = service.validate_patterns(patterns, &query.user_id)?;
        let receipts = service
            .apply_consolidations(&report.validated, &query.user_id, &now)
            .map_err(|partial| {
                // Per-pattern commits mean the prefix already landed. Record
                // what was actually applied before surfacing the failure, so
                // the ledger never claims a clean failure over a mutated DB.
                let payload = serde_json::json!({
                    "error": partial.to_string(),
                    "failedStatement": partial.failed_statement,
                    "appliedMemoryIds": partial
                        .applied
                        .iter()
                        .map(|receipt| receipt.consolidated_memory_id.clone())
                        .collect::<Vec<_>>(),
                    "partiallyApplied": !partial.is_clean(),
                });
                let _ = dream_service.fail_run(&run.id, &payload, &now);
                ApplicationError::from(partial)
            })?;
        let output_hash = weekly_output_hash(&receipts);
        dream_service.finish_dream_run(&run.id, &output_hash, &now)?;
        Ok(ielts_application::WeeklyDreamResult {
            run_id: run.id.clone(),
            query: query.clone(),
            report,
            receipts,
        })
    })();

    if let Err(error) = &outcome {
        // `fail_run` is idempotent enough for the double-call case above: the
        // partial-application arm already recorded the richer payload, and a
        // second terminal write on an already-terminal run is a no-op.
        let _ = dream_service.fail_run(
            &run.id,
            &serde_json::json!({ "error": error.to_string() }),
            &now,
        );
    }
    outcome
}

/// Deterministic hash over the consolidation receipts, mirroring the shape the
/// daily dream records. Order-independent per receipt, stable across runs.
fn weekly_output_hash(receipts: &[ielts_domain::ConsolidationReceipt]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for receipt in receipts {
        hasher.update(receipt.consolidated_memory_id.as_bytes());
        hasher.update(b"|");
        let mut supports = receipt.support_ids.clone();
        supports.sort();
        hasher.update(supports.join(",").as_bytes());
        hasher.update(b"
");
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
    use ielts_domain::PatternKind;

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
            journal_date: "2026-08-10".to_string(),
        };
        let facts = service.build_facts(&query).unwrap();
        service.insert_journal(&facts, None).unwrap().id
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

    /// Round-3 audit (A3): the weekly path minted a synthetic `weekly-<uuid>`
    /// run id and wrote no `dream_runs` row at all, so an irreversible memory
    /// mutation left no ledger entry.
    #[test]
    fn weekly_consolidation_persists_a_completed_run_row() {
        let (_dir, db) = temp_db();
        let journal_id = seed_journal(&db, "local");
        let query = WeeklyDreamQuery {
            user_id: "local".into(),
            journal_id,
        };

        // Zero patterns is a legitimate success (M8-01), and still must be
        // recorded: the run happened, it just produced nothing.
        let result = run_weekly_consolidation(&db, &query, &[]).unwrap();

        assert!(
            !result.run_id.starts_with("weekly-"),
            "run id must come from the dream_runs authority, not a synthetic uuid"
        );
        assert_eq!(
            dream_run_status(&db, &result.run_id).as_deref(),
            Some("completed"),
            "the run must be persisted and closed"
        );
        assert_eq!(result.report.validated.len(), 0);
        assert_eq!(result.receipts.len(), 0);
    }

    /// The `journal_id` used to be accepted and echoed without ever being
    /// checked. It is now the FK of the run row, so a forged one fails closed
    /// before any memory is touched.
    #[test]
    fn weekly_consolidation_rejects_an_unknown_journal_id() {
        let (_dir, db) = temp_db();
        let query = WeeklyDreamQuery {
            user_id: "local".into(),
            journal_id: "journal-does-not-exist".into(),
        };
        let patterns = vec![PatternProposal {
            statement: "should never be applied".into(),
            supporting_memory_ids: vec!["mem-a".into()],
            pattern_kind: PatternKind::BehaviorPattern,
            confidence_proposal: 0.8,
        }];

        let outcome = run_weekly_consolidation(&db, &query, &patterns);

        assert!(outcome.is_err(), "a nonexistent journal_id must fail closed");
        let written: i64 = db
            .with_conn(|conn| {
                Ok(conn
                    .query_row(
                        "SELECT COUNT(*) FROM memory_items WHERE created_by='weekly_dream'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap_or(0))
            })
            .unwrap();
        assert_eq!(written, 0, "no consolidation may land when the run cannot be claimed");
    }

    /// A rejected pattern is a recorded rejection, not a silent drop, and the
    /// run still completes: rejecting everything is a successful run that
    /// consolidated nothing.
    #[test]
    fn weekly_consolidation_records_rejections_and_still_completes() {
        let (_dir, db) = temp_db();
        let journal_id = seed_journal(&db, "local");
        let query = WeeklyDreamQuery {
            user_id: "local".into(),
            journal_id,
        };
        let patterns = vec![PatternProposal {
            // Hallucinated support id: nothing in memory_items matches.
            statement: "learner rushes conclusions".into(),
            supporting_memory_ids: vec!["mem-nope".into()],
            pattern_kind: PatternKind::BehaviorPattern,
            confidence_proposal: 0.8,
        }];

        let result = run_weekly_consolidation(&db, &query, &patterns).unwrap();

        assert_eq!(result.report.validated.len(), 0);
        assert_eq!(result.report.rejected.len(), 1);
        assert_eq!(
            result.report.rejected[0].reason.code(),
            "hallucinated_support_id"
        );
        assert_eq!(
            dream_run_status(&db, &result.run_id).as_deref(),
            Some("completed")
        );
    }
}
