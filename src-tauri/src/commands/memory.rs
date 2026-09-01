use ielts_application::{MemoryService, SubmitMemoryCandidatesCommand};
use ielts_domain::{
    Activity, AgentRunKind, CommandResponse, ErrorEnvelope, ExplicitPreference, ExplicitPreferenceUpsert,
    MemoryCandidateBatchReceipt, MemoryCatalogQuery, MemoryContextPreview, MemoryContextQuery,
    MemoryForgetCommand, MemoryMutationProposalBatch, MemoryMutationReceipt,
    MemoryPromotionCommand, MemorySourceClass, MAX_MEMORY_PROPOSALS,
};
use ielts_db::{BeginAgentRunCommand, StoredAgentRunStatus};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::app::application_store::ApplicationStore;
use crate::app::run_audit::RunAuditGuard;
use crate::ai::load_provider_config;
use crate::app::state::{AppDb, AppVault};
use crate::cognitive_runtime::{RuntimeManager, RuntimeStatus};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateMemoryCandidatesInput {
    #[serde(default)]
    pub since: Option<String>,
    pub activity: Activity,
    #[serde(default = "default_max_candidates")]
    pub max_candidates: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteMemoryCandidateInput {
    pub candidate_id: String,
    pub expected_candidate_version: u64,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutExplicitPreferenceInput {
    pub preference_key: String,
    #[serde(default = "default_global_scope")]
    pub scope: String,
    pub value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForgetMemoryInput {
    pub memory_id: String,
    pub expected_version: u64,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextPreviewInput {
    pub activity: Activity,
    #[serde(default)]
    pub current_instruction: Option<String>,
    #[serde(default = "default_context_limit")]
    pub limit: u32,
}

#[tauri::command]
pub async fn memory_generate_candidates(
    app: AppHandle,
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    runtime: State<'_, RuntimeManager>,
    input: GenerateMemoryCandidatesInput,
) -> Result<CommandResponse<MemoryCandidateBatchReceipt>, ErrorEnvelope> {
    Ok(memory_generate_candidates_inner(app, db, vault, runtime, input).await)
}

async fn memory_generate_candidates_inner(
    app: AppHandle,
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    runtime: State<'_, RuntimeManager>,
    input: GenerateMemoryCandidatesInput,
) -> CommandResponse<MemoryCandidateBatchReceipt> {
    if !(1..=MAX_MEMORY_PROPOSALS).contains(&input.max_candidates) {
        return CommandResponse::failure(ErrorEnvelope::new(
            "memory.invalid_request",
            format!("maxCandidates must be 1..={MAX_MEMORY_PROPOSALS}"),
            false,
        ));
    }
    let enabled = db
        .with_conn(|conn| ielts_db::get_setting(conn, "features", "memory_auto_candidates_v1"))
        .map(|entry| {
            entry
                .and_then(|item| item.value.as_str().map(str::to_owned))
                .is_none_or(|mode| mode == "proposal_only")
        });
    match enabled {
        Ok(true) => {}
        Ok(false) => {
            return CommandResponse::failure(ErrorEnvelope::new(
                "memory.learning_disabled",
                "automatic memory learning is disabled",
                false,
            ))
        }
        Err(error) => return db_failure(error),
    }
    let mut reservation = match runtime.reserve_generation(&app).await {
        Ok(reservation) => reservation,
        Err(error) => {
            return CommandResponse::failure(ErrorEnvelope::new(
                "memory.runtime_unavailable",
                error.to_string(),
                true,
            ))
        }
    };
    let provider = match load_provider_config(&db, &vault) {
        Ok(provider) => provider,
        Err(error) => {
            return CommandResponse::failure(ErrorEnvelope::new(
                "memory.ai_not_configured",
                error.to_string(),
                false,
            ))
        }
    };
    let run_id = format!("memory-run-{}", uuid::Uuid::new_v4());
    if let Err(error) = db.with_conn(|conn| {
        ielts_db::begin_agent_run(
            conn,
            &BeginAgentRunCommand {
                id: run_id.clone(),
                provider_id: provider.provider.clone(),
                model: provider.model.clone(),
                run_kind: AgentRunKind::MemoryManager,
            },
        )
    }) {
        return db_failure(error);
    }
    let mut audit = RunAuditGuard::new(
        db.inner(),
        run_id.clone(),
        StoredAgentRunStatus::Interrupted,
        json!({
            "code": "memory.run_interrupted",
            "message": "memory generation future was cancelled",
            "retryable": true,
        }),
    );
    let store = ApplicationStore::new(db.inner());
    let candidate_input = match MemoryService::new(&store).prepare_candidate_input(
        "local",
        input.activity,
        input.since,
        input.max_candidates,
    ) {
        Ok(value) => value,
        Err(error) => return fail_run(&mut audit, application_failure(error)),
    };
    let candidate_input = match serde_json::to_value(candidate_input) {
        Ok(value) => value,
        Err(error) => {
            return fail_run(
                &mut audit,
                ErrorEnvelope::new("memory.input_serialization", error.to_string(), false),
            )
        }
    };
    let trusted_input_hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&candidate_input).unwrap_or_default(),
    ));
    let runtime_started = std::time::Instant::now();
    let generated = match runtime
        .generate_memory_candidates(
            &mut reservation,
            &run_id,
            candidate_input,
            input.max_candidates as u32,
        )
        .await
    {
        Ok(value) => value,
        Err(crate::cognitive_runtime::RuntimeHostError::Cancelled) => {
            return interrupt_run(&mut audit)
        }
        Err(error) => {
            return fail_run(
                &mut audit,
                ErrorEnvelope::new("memory.runtime_failed", error.to_string(), true),
            )
        }
    };
    let batch: MemoryMutationProposalBatch = match generated
        .get("batch")
        .cloned()
        .ok_or_else(|| "runtime result is missing batch".to_owned())
        .and_then(|value| serde_json::from_value(value).map_err(|error| error.to_string()))
    {
        Ok(batch) => batch,
        Err(error) => {
            return fail_run(
                &mut audit,
                ErrorEnvelope::new("memory.runtime_invalid", error, false),
            )
        }
    };
    let receipt = match MemoryService::new(&store).submit_cognitive_candidates(
            &SubmitMemoryCandidatesCommand {
                request_id: stable_candidate_request_id(&trusted_input_hash, &batch),
                user_id: "local".into(),
                run_id: Some(run_id.clone()),
                batch,
            },
            MemorySourceClass::Inferred,
        ) {
        Ok(receipt) => receipt,
        Err(error) => return fail_run(&mut audit, application_failure(error)),
    };
    let result = json!({
        "runKind": "memory_manager",
        "batchId": receipt.batch_id,
        "candidateCount": receipt.candidates.len(),
        "fallbackUsed": generated.get("fallbackUsed"),
        "runtimeLatencyMs": runtime_started.elapsed().as_millis() as u64,
    });
    if let Err(error) = audit.finish(
        StoredAgentRunStatus::Completed,
        Some(result),
        None,
    ) {
        return db_failure(error);
    }
    CommandResponse::success(receipt)
}

#[tauri::command]
pub async fn cognitive_runtime_status(
    runtime: State<'_, RuntimeManager>,
) -> Result<CommandResponse<RuntimeStatus>, ErrorEnvelope> {
    Ok(CommandResponse::success(runtime.status().await))
}

#[tauri::command]
pub async fn cognitive_runtime_health(
    app: AppHandle,
    runtime: State<'_, RuntimeManager>,
) -> Result<CommandResponse<RuntimeStatus>, ErrorEnvelope> {
    if let Err(error) = runtime.start(&app).await {
        return Ok(runtime_failure(error));
    }
    Ok(match runtime.health().await {
        Ok(status) => CommandResponse::success(status),
        Err(error) => runtime_failure(error),
    })
}

#[tauri::command]
pub async fn cognitive_runtime_cancel(
    runtime: State<'_, RuntimeManager>,
) -> Result<CommandResponse<RuntimeStatus>, ErrorEnvelope> {
    Ok(match runtime.cancel().await {
        Ok(()) => CommandResponse::success(runtime.status().await),
        Err(error) => runtime_failure(error),
    })
}

#[cfg(feature = "developer-tools")]
#[tauri::command]
pub async fn cognitive_runtime_restart(
    app: AppHandle,
    runtime: State<'_, RuntimeManager>,
) -> Result<CommandResponse<RuntimeStatus>, ErrorEnvelope> {
    if let Err(error) = runtime.shutdown().await {
        return Ok(runtime_failure(error));
    }
    if let Err(error) = runtime.start(&app).await {
        return Ok(runtime_failure(error));
    }
    Ok(CommandResponse::success(runtime.status().await))
}

#[tauri::command]
pub fn memory_promote_candidate(
    db: State<'_, AppDb>,
    input: PromoteMemoryCandidateInput,
) -> CommandResponse<MemoryMutationReceipt> {
    if let Err(error) = require_local_candidate(db.inner(), &input.candidate_id) {
        return db_failure(error);
    }
    let store = ApplicationStore::new(db.inner());
    respond(MemoryService::new(&store).promote_candidate(
        &MemoryPromotionCommand {
            candidate_id: input.candidate_id,
            expected_candidate_version: input.expected_candidate_version,
            actor_type: "user".into(),
            actor_id: Some("local".into()),
            reason: input.reason,
        },
    ))
}

#[tauri::command]
pub fn memory_put_explicit_preference(
    db: State<'_, AppDb>,
    input: PutExplicitPreferenceInput,
) -> CommandResponse<ExplicitPreference> {
    let store = ApplicationStore::new(db.inner());
    respond(MemoryService::new(&store).put_explicit_preference(
        &ExplicitPreferenceUpsert {
            user_id: "local".into(),
            preference_key: input.preference_key,
            scope: input.scope,
            value: input.value,
            source: "user".into(),
        },
    ))
}

#[tauri::command]
pub fn memory_context_preview(
    db: State<'_, AppDb>,
    input: MemoryContextPreviewInput,
) -> CommandResponse<MemoryContextPreview> {
    let store = ApplicationStore::new(db.inner());
    respond(MemoryService::new(&store).context_preview(&MemoryContextQuery {
        user_id: "local".into(),
        activity: input.activity,
        current_instruction: input.current_instruction,
        limit: input.limit,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCatalogInput {
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default = "default_catalog_limit")]
    pub limit: u32,
}

fn default_catalog_limit() -> u32 {
    100
}

/// M9/18.3 product-host catalog read: governable memory items with governance
/// metadata + bounded evidence ids for the console's evolution tabs. Private
/// and restricted rows never leave the store. This is what the console reads
/// instead of the compiler-scoped `memory_context_preview`.
#[tauri::command]
pub fn memory_catalog_list(
    db: State<'_, AppDb>,
    input: MemoryCatalogInput,
) -> CommandResponse<ielts_domain::MemoryCatalog> {
    let store = ApplicationStore::new(db.inner());
    respond(MemoryService::new(&store).load_catalog(&MemoryCatalogQuery {
        user_id: "local".into(),
        include_archived: input.include_archived,
        limit: input.limit,
    }))
}

#[tauri::command]
pub fn memory_forget(
    db: State<'_, AppDb>,
    input: ForgetMemoryInput,
) -> CommandResponse<()> {
    if let Err(error) = require_local_memory(db.inner(), &input.memory_id) {
        return db_failure(error);
    }
    let store = ApplicationStore::new(db.inner());
    respond(MemoryService::new(&store).forget_memory(&MemoryForgetCommand {
        memory_id: input.memory_id,
        expected_version: input.expected_version,
        actor_type: "user".into(),
        actor_id: Some("local".into()),
        reason: input.reason,
    }))
}

fn respond<T>(result: Result<T, ielts_application::ApplicationError>) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            error.code,
            error.message,
            error.retryable,
        )),
    }
}

fn fail_run<T>(audit: &mut RunAuditGuard<'_>, error: ErrorEnvelope) -> CommandResponse<T> {
    let audit_error = json!({"code": error.code, "message": error.message, "retryable": error.retryable});
    match audit.finish(
        StoredAgentRunStatus::Failed,
        None,
        Some(audit_error),
    ) {
        Ok(()) => CommandResponse::failure(error),
        Err(finish_error) => CommandResponse::failure(ErrorEnvelope::new(
            "memory.audit_failed",
            format!("{}; failed to close AgentRun: {finish_error}", error.message),
            false,
        )),
    }
}

fn interrupt_run<T>(audit: &mut RunAuditGuard<'_>) -> CommandResponse<T> {
    let error = ErrorEnvelope::new("memory.run_cancelled", "memory generation was cancelled", true);
    let audit_error = json!({"code": error.code, "message": error.message, "retryable": true});
    match audit.finish(StoredAgentRunStatus::Interrupted, None, Some(audit_error)) {
        Ok(()) => CommandResponse::failure(error),
        Err(finish_error) => CommandResponse::failure(ErrorEnvelope::new(
            "memory.audit_failed",
            format!("failed to record cancelled AgentRun: {finish_error}"),
            false,
        )),
    }
}

fn stable_candidate_request_id(input_hash: &str, batch: &MemoryMutationProposalBatch) -> String {
    let mut digest = Sha256::new();
    digest.update(input_hash.as_bytes());
    digest.update(serde_json::to_vec(batch).unwrap_or_default());
    format!("memory-candidates-{}", hex::encode(digest.finalize()))
}

fn require_local_candidate(db: &AppDb, candidate_id: &str) -> ielts_db::DbResult<()> {
    require_local_object(
        db,
        "SELECT COUNT(*) FROM memory_candidates c JOIN memory_candidate_batches b ON b.id=c.batch_id WHERE c.id=?1 AND b.user_id='local'",
        candidate_id,
        "candidate",
    )
}

fn require_local_memory(db: &AppDb, memory_id: &str) -> ielts_db::DbResult<()> {
    require_local_object(
        db,
        "SELECT COUNT(*) FROM memory_items WHERE id=?1 AND user_id='local'",
        memory_id,
        "memory",
    )
}

fn require_local_object(
    db: &AppDb,
    sql: &str,
    id: &str,
    label: &str,
) -> ielts_db::DbResult<()> {
    let count: i64 = db.with_conn(|conn| conn.query_row(sql, [id], |row| row.get(0)).map_err(Into::into))?;
    if count == 1 {
        Ok(())
    } else {
        Err(ielts_db::DbError::Validation(format!("{label} is not owned by the local user")))
    }
}

fn application_failure(error: ielts_application::ApplicationError) -> ErrorEnvelope {
    ErrorEnvelope::new(error.code, error.message, error.retryable)
}

fn db_failure<T>(error: ielts_db::DbError) -> CommandResponse<T> {
    CommandResponse::failure(ErrorEnvelope::new("memory.persistence_failed", error.to_string(), false))
}

fn runtime_failure<T>(error: crate::cognitive_runtime::RuntimeHostError) -> CommandResponse<T> {
    CommandResponse::failure(ErrorEnvelope::new("memory.runtime_failed", error.to_string(), true))
}

fn default_global_scope() -> String {
    "global".into()
}

fn default_context_limit() -> u32 {
    50
}

fn default_max_candidates() -> usize {
    16
}
