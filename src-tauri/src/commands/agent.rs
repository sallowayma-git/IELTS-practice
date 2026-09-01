use ielts_application::{
    AgentLimits, AgentRunOutcome, AgentService, ApplicationError, RunAgentCommand,
};
use ielts_domain::dto::CommandResponse;
use ielts_domain::{AgentRunKind, ErrorEnvelope};
use serde::Deserialize;
use serde_json::json;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::agent::{
    AgentCancelRegistry, LearningReadTools, WorkspaceFileTools, WorkspaceGrant, WorkspaceGrants,
};
use crate::ai::{load_runtime, load_runtime_for_config};
use crate::app::run_audit::RunAuditGuard;
use crate::cognitive_runtime::RuntimeManager;
use crate::app::application_store::ApplicationStore;
use crate::app::state::{AppDb, AppVault};

const AGENT_SYSTEM_PROMPT: &str = "You are IELTS Atlas's local workspace assistant. Use only the provided tools, inspect a file before modifying an existing file, preserve unrelated content, and report exactly what changed. Never invent tool results or claim access outside the granted workspace.";
const ATTEMPT_REVIEW_SYSTEM_PROMPT: &str = "You are IELTS Atlas's Reading attempt review assistant. Use only the provided read-only learning evidence tools. Base every claim on returned canonical evidence, distinguish deterministic observations from interpretation, never invent answers or question text, and never claim to modify learning records.\n\nYou have access to seven read-only tools. The first four are attempt/evidence reads: get_attempt_detail, compare_attempts_for_asset, get_question_history, and search_learning_events. Three additional tools give you the learner's personal context: get_learner_skill_state (bounded learner skill mastery/uncertainty/trend snapshots), search_active_memories (active memory and explicit preference preview for the activity), and get_memory_evidence (canonical upstream learning-event evidence by stable IDs).\n\nFollow the Reading Review Context priority when building your explanation:\n1. CURRENT ATTEMPT — call get_attempt_detail first for score, per-question outcomes, and timing/change signals.\n2. RELEVANT HISTORY — call compare_attempts_for_asset and get_question_history for same-asset transitions and related skill state.\n3. PERSONAL MEMORY — call search_active_memories and get_learner_skill_state to surface only relevant active memories and the learner's current skill state. Use get_memory_evidence to ground any memory in canonical events.\n4. TEACHING PREFERENCE — explicit preferences first, high-confidence inferred candidates second; both arrive through search_active_memories.\n\nNever assert a preference the tools did not return. Feedback is an interaction fact, not a confirmed preference.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkspaceAgentRequest {
    pub grant_id: String,
    pub prompt: String,
    #[serde(default)]
    pub config_id: Option<String>,
    /// Client-generated run id so the UI can cancel while the run executes.
    /// When absent the host generates one (the run is then not cancellable
    /// from outside — same behaviour as before the cancel path existed).
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAttemptReviewRequest {
    pub attempt_id: String,
    #[serde(default)]
    pub config_id: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
}

/// Resolve the run id for a cancellable run: prefer the client-supplied id,
/// fall back to a host-generated one.
/// The client-supplied run id becomes the agent_runs audit primary key, so
/// bound its shape (UUID-ish: alphanumerics + dashes, <= 64 bytes) and fall
/// back to a host-generated id for anything else.
fn resolve_run_id(requested: Option<&String>) -> String {
    let candidate = requested.map(|value| value.trim()).unwrap_or("");
    let valid = !candidate.is_empty()
        && candidate.len() <= 64
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if valid {
        candidate.to_owned()
    } else {
        uuid::Uuid::new_v4().to_string()
    }
}

/// Register a cancellation token and unregister it when the run settles.
struct CancellableRun<'a> {
    registry: &'a AgentCancelRegistry,
    run_id: String,
    token: ielts_application::AgentCancelToken,
}

impl<'a> CancellableRun<'a> {
    fn new(registry: &'a AgentCancelRegistry, run_id: String) -> Option<Self> {
        let token = registry.register(&run_id)?;
        Some(Self {
            registry,
            run_id,
            token,
        })
    }

    fn token(&self) -> &ielts_application::AgentCancelToken {
        &self.token
    }
}

impl Drop for CancellableRun<'_> {
    fn drop(&mut self) {
        self.registry.unregister(&self.run_id);
    }
}

#[tauri::command]
pub fn agent_pick_workspace(
    app: tauri::AppHandle,
    grants: State<'_, WorkspaceGrants>,
) -> CommandResponse<Option<WorkspaceGrant>> {
    let folder = app.dialog().file().blocking_pick_folder();
    let Some(folder) = folder else {
        return CommandResponse::success(None);
    };
    let path = match folder.into_path() {
        Ok(path) => path,
        Err(error) => return CommandResponse::failure(path_error(error.to_string())),
    };
    match grants.issue(&path) {
        Ok(grant) => CommandResponse::success(Some(grant)),
        Err(error) => CommandResponse::failure(path_error(error)),
    }
}

#[tauri::command]
pub async fn agent_run(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    grants: State<'_, WorkspaceGrants>,
    cancels: State<'_, AgentCancelRegistry>,
    request: RunWorkspaceAgentRequest,
) -> Result<CommandResponse<AgentRunOutcome>, ErrorEnvelope> {
    if request.prompt.trim().is_empty() {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "agent.invalid_request",
            "agent prompt is required",
            false,
        )));
    }
    let root = match grants.resolve(&request.grant_id) {
        Ok(root) => root,
        Err(error) => return Ok(CommandResponse::failure(path_error(error))),
    };
    let tools = match WorkspaceFileTools::new(root) {
        Ok(tools) => tools,
        Err(error) => return Ok(CommandResponse::failure(path_error(error))),
    };
    let runtime_result = match request
        .config_id
        .as_deref()
        .filter(|config_id| !config_id.trim().is_empty())
    {
        Some(config_id) => load_runtime_for_config(&db, &vault, config_id),
        None => load_runtime(&db, &vault),
    };
    let runtime = match runtime_result {
        Ok(runtime) => runtime,
        Err(error) => {
            return Ok(CommandResponse::failure(ErrorEnvelope::new(
                "agent.ai_not_configured",
                error.to_string(),
                false,
            )))
        }
    };
    let run_id = resolve_run_id(request.run_id.as_ref());
    let cancellable = match CancellableRun::new(&cancels, run_id.clone()) {
        Some(cancellable) => cancellable,
        None => {
            return Ok(CommandResponse::failure(ErrorEnvelope::new(
                "agent.duplicate_run_id",
                "a run with this id is already active",
                false,
            )))
        }
    };
    let command = RunAgentCommand {
        run_id: run_id.clone(),
        provider_id: runtime.config.provider.clone(),
        model: runtime.config.model.clone(),
        run_kind: AgentRunKind::Workspace,
        system_prompt: AGENT_SYSTEM_PROMPT.into(),
        user_prompt: request.prompt.trim().into(),
        temperature: 0.1,
        limits: AgentLimits::default(),
    };
    let store = ApplicationStore::new(&db);
    Ok(
        match AgentService::run(&store, &runtime, &tools, command, cancellable.token()).await {
            Ok(outcome) => CommandResponse::success(outcome),
            Err(error) => CommandResponse::failure(
                application_error(error).with_context(json!({"runId": run_id})),
            ),
        },
    )
}

#[tauri::command]
pub async fn agent_run_attempt_review(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    cancels: State<'_, AgentCancelRegistry>,
    request: RunAttemptReviewRequest,
) -> Result<CommandResponse<AgentRunOutcome>, ErrorEnvelope> {
    if request.attempt_id.trim().is_empty() {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "agent.invalid_request",
            "attempt id is required",
            false,
        )));
    }
    if let Err(error) =
        db.with_conn(|conn| ielts_db::get_attempt_evidence(conn, &request.attempt_id))
    {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "agent.invalid_attempt",
            error.to_string(),
            false,
        )));
    }
    let runtime_result = match request
        .config_id
        .as_deref()
        .filter(|config_id| !config_id.trim().is_empty())
    {
        Some(config_id) => load_runtime_for_config(&db, &vault, config_id),
        None => load_runtime(&db, &vault),
    };
    let runtime = match runtime_result {
        Ok(runtime) => runtime,
        Err(error) => {
            return Ok(CommandResponse::failure(ErrorEnvelope::new(
                "agent.ai_not_configured",
                error.to_string(),
                false,
            )))
        }
    };
    let run_id = resolve_run_id(request.run_id.as_ref());
    let cancellable = match CancellableRun::new(&cancels, run_id.clone()) {
        Some(cancellable) => cancellable,
        None => {
            return Ok(CommandResponse::failure(ErrorEnvelope::new(
                "agent.duplicate_run_id",
                "a run with this id is already active",
                false,
            )))
        }
    };
    let command = RunAgentCommand {
        run_id: run_id.clone(),
        provider_id: runtime.config.provider.clone(),
        model: runtime.config.model.clone(),
        run_kind: AgentRunKind::AttemptReview,
        system_prompt: ATTEMPT_REVIEW_SYSTEM_PROMPT.into(),
        user_prompt: format!(
            "Review Reading attempt {}. First call get_attempt_detail, then compare_attempts_for_asset using the returned assetId. After grounding in the attempt and history, optionally call get_learner_skill_state and search_active_memories to surface personal context relevant to the skills involved. Explain only evidence-backed changes across attempts.",
            request.attempt_id.trim()
        ),
        temperature: 0.1,
        limits: AgentLimits {
            max_rounds: 6,
            max_tool_calls: 12,
        },
    };
    let store = ApplicationStore::new(&db);
    let tools = LearningReadTools::new(&db);
    Ok(
        match AgentService::run(&store, &runtime, &tools, command, cancellable.token()).await {
            Ok(outcome) => CommandResponse::success(outcome),
            Err(error) => CommandResponse::failure(
                application_error(error).with_context(json!({"runId": run_id})),
            ),
        },
    )
}

/// M12-02 cancel path: request cancellation of a running agent run. The run
/// lands as `Interrupted` at its next round/tool boundary — never fabricated
/// as a provider failure. Returns false when the run is unknown (already
/// finished or started by a different host session).
#[tauri::command]
pub fn agent_cancel_run(
    cancels: State<'_, AgentCancelRegistry>,
    run_id: String,
) -> CommandResponse<bool> {
    CommandResponse::success(cancels.cancel(run_id.trim()))
}

#[cfg(feature = "agent-threads-v1")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunStudyPlannerRequest {
    pub user_goal: String,
    #[serde(default = "default_available_minutes")]
    pub available_minutes: u32,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub plan_date: Option<String>,
}

#[cfg(feature = "agent-threads-v1")]
fn default_available_minutes() -> u32 {
    60
}

/// M12-04: run the deterministic study planner in the Python sidecar. The
/// proposal is persisted via the `study_plan.create` reverse-RPC — Rust stays
/// the only writer of study-plan state. The reply carries the host-assigned
/// `planId` so the UI can list items without guessing ids from threads.
#[cfg(feature = "agent-threads-v1")]
#[tauri::command]
pub async fn study_plan_run(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    runtime: State<'_, RuntimeManager>,
    request: RunStudyPlannerRequest,
) -> Result<CommandResponse<serde_json::Value>, ErrorEnvelope> {
    if request.user_goal.trim().is_empty() {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "planner.invalid_request",
            "user goal is required",
            false,
        )));
    }
    // Mirror the Python PlannerInput bounds so oversized payloads fail at the
    // IPC boundary instead of after the sidecar round trip.
    if request.user_goal.chars().count() > 2048
        || request.available_minutes > 720
        || request.target_date.as_deref().map(str::len).unwrap_or(0) > 40
        || request.plan_date.as_deref().map(str::len).unwrap_or(0) > 40
    {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "planner.invalid_request",
            "userGoal must be <= 2048 chars, availableMinutes <= 720, dates <= 40 chars",
            false,
        )));
    }
    let audit_run_id = format!("plan-{}", uuid::Uuid::new_v4());
    if let Err(error) = db.with_conn(|conn| {
        ielts_db::begin_agent_run(
            conn,
            &ielts_db::BeginAgentRunCommand {
                id: audit_run_id.clone(),
                provider_id: "deterministic".into(),
                model: "study-planner-v1".into(),
                run_kind: AgentRunKind::StudyPlan,
            },
        )
    }) {
        return Ok(CommandResponse::failure(ErrorEnvelope::new(
            "planner.audit_failed",
            error.to_string(),
            false,
        )));
    }
    let mut audit = RunAuditGuard::new(
        db.inner(),
        audit_run_id.clone(),
        ielts_db::StoredAgentRunStatus::Failed,
        json!({
            "code": "planner.abandoned",
            "message": "study planner run was abandoned before completion",
        }),
    );
    let mut reservation = match runtime.reserve_generation(&app).await {
        Ok(reservation) => reservation,
        Err(error) => {
            return Ok(planner_fail(
                &mut audit,
                "planner.runtime_unavailable",
                &error.to_string(),
            ))
        }
    };
    let planner_input = json!({
        "traceId": audit_run_id,
        "userGoal": request.user_goal.trim(),
        "availableMinutes": request.available_minutes,
        "targetDate": request.target_date.unwrap_or_default(),
        "planDate": request.plan_date.unwrap_or_default(),
    });
    let outcome = runtime
        .run_study_planner(&mut reservation, &audit_run_id, planner_input)
        .await;
    let payload = match outcome {
        Ok(value) => value,
        Err(crate::cognitive_runtime::RuntimeHostError::Cancelled) => {
            let _ = audit.finish(
                ielts_db::StoredAgentRunStatus::Interrupted,
                None,
                Some(json!({"code": "planner.cancelled", "message": "study planner run was cancelled"})),
            );
            return Ok(CommandResponse::failure(ErrorEnvelope::new(
                "planner.cancelled",
                "study planner run was cancelled",
                true,
            )));
        }
        Err(error) => {
            return Ok(planner_fail(&mut audit, "planner.runtime_failed", &error.to_string()))
        }
    };
    let Some(proposal) = payload.get("proposal").cloned() else {
        return Ok(planner_fail(
            &mut audit,
            "planner.runtime_invalid",
            "planner reply is missing proposal",
        ));
    };
    let plan_id = proposal
        .get("planId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let fallback_reason = proposal
        .get("fallbackReason")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    if let Some(reason) = fallback_reason {
        return Ok(planner_fail(&mut audit, "planner.fallback", &reason));
    }
    if plan_id.is_empty() {
        return Ok(planner_fail(
            &mut audit,
            "planner.plan_not_persisted",
            "planner proposal carries no host plan id",
        ));
    }
    let _ = audit.finish(
        ielts_db::StoredAgentRunStatus::Completed,
        Some(json!({"planId": plan_id})),
        None,
    );
    Ok(CommandResponse::success(proposal))
}

#[cfg(feature = "agent-threads-v1")]
fn planner_fail(
    audit: &mut RunAuditGuard<'_>,
    code: &str,
    message: &str,
) -> CommandResponse<serde_json::Value> {
    let audit_error = json!({"code": code, "message": message});
    if let Err(finish_error) = audit.finish(ielts_db::StoredAgentRunStatus::Failed, None, Some(audit_error)) {
        tracing::warn!(%finish_error, "failed to close planner agent run");
    }
    CommandResponse::failure(ErrorEnvelope::new(code, message.to_string(), true))
}

#[tauri::command]
pub fn agent_get_run(
    db: State<'_, AppDb>,
    run_id: String,
) -> CommandResponse<Option<ielts_db::AgentRunRecord>> {
    match db.with_conn(|conn| ielts_db::load_agent_run(conn, &run_id)) {
        Ok(run) => CommandResponse::success(run),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(
            "agent.persistence_failed",
            error.to_string(),
            false,
        )),
    }
}

fn path_error(message: impl Into<String>) -> ErrorEnvelope {
    ErrorEnvelope::new("agent.workspace_grant", message, false)
}

fn application_error(error: ApplicationError) -> ErrorEnvelope {
    ErrorEnvelope::new(error.code, error.message, error.retryable)
}
