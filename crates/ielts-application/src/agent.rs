use async_trait::async_trait;
use ielts_db::{
    BeginAgentRunCommand, BeginAgentToolCallCommand, FinishAgentRunCommand,
    FinishAgentToolCallCommand,
};
use ielts_domain::AgentRunKind;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use crate::{ApplicationError, ModelError, TokenUsage};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum AgentMessage {
    System {
        content: String,
    },
    User {
        content: String,
    },
    Assistant {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        tool_calls: Vec<AgentToolCall>,
    },
    ToolResult {
        tool_call_id: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCall {
    pub id: String,
    pub name: String,
    pub arguments_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelRequest {
    pub messages: Vec<AgentMessage>,
    pub tools: Vec<AgentToolDefinition>,
    pub temperature: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<AgentToolCall>,
    pub model: String,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
    #[serde(default)]
    pub retry_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentModelFailure {
    pub error: ModelError,
    pub model: Option<String>,
    pub latency_ms: u64,
    pub usage: Option<TokenUsage>,
    pub provider_request_id: Option<String>,
    pub retry_count: u32,
}

impl AgentModelFailure {
    pub fn new(error: ModelError) -> Self {
        Self {
            error,
            model: None,
            latency_ms: 0,
            usage: None,
            provider_request_id: None,
            retry_count: 0,
        }
    }

    pub fn with_trace(
        error: ModelError,
        model: Option<String>,
        latency_ms: u64,
        usage: Option<TokenUsage>,
        provider_request_id: Option<String>,
        retry_count: u32,
    ) -> Self {
        Self {
            error,
            model,
            latency_ms,
            usage,
            provider_request_id,
            retry_count,
        }
    }
}

impl From<ModelError> for AgentModelFailure {
    fn from(error: ModelError) -> Self {
        Self::new(error)
    }
}

#[async_trait]
pub trait AgentModel: Send + Sync {
    async fn respond(
        &self,
        request: AgentModelRequest,
    ) -> Result<AgentModelResponse, AgentModelFailure>;
}

pub use ielts_db::{
    StoredAgentRunStatus as AgentRunStatus, StoredAgentToolStatus as AgentToolStatus,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolExecution {
    pub status: AgentToolStatus,
    pub model_content: String,
    pub audit_result: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ApplicationError>,
}

impl AgentToolExecution {
    pub fn succeeded(model_content: impl Into<String>, audit_result: Value) -> Self {
        Self {
            status: AgentToolStatus::Succeeded,
            model_content: model_content.into(),
            audit_result,
            error: None,
        }
    }

    pub fn rejected(
        code: impl Into<String>,
        message: impl Into<String>,
        audit_result: Value,
    ) -> Self {
        Self::error(
            AgentToolStatus::Rejected,
            code,
            message,
            false,
            audit_result,
        )
    }

    pub fn failed(
        code: impl Into<String>,
        message: impl Into<String>,
        retryable: bool,
        audit_result: Value,
    ) -> Self {
        Self::error(
            AgentToolStatus::Failed,
            code,
            message,
            retryable,
            audit_result,
        )
    }

    fn error(
        status: AgentToolStatus,
        code: impl Into<String>,
        message: impl Into<String>,
        retryable: bool,
        audit_result: Value,
    ) -> Self {
        let error = ApplicationError::new(code, message, retryable);
        let model_content = serde_json::to_string(&error).unwrap_or_else(|_| {
            "{\"code\":\"agent.tool_failed\",\"message\":\"tool failed\",\"retryable\":false}"
                .into()
        });
        Self {
            status,
            model_content,
            audit_result,
            error: Some(error),
        }
    }
}

#[async_trait]
pub trait AgentToolExecutor: Send + Sync {
    fn definitions(&self) -> Vec<AgentToolDefinition>;

    fn audit_arguments(&self, call: &AgentToolCall) -> Value;

    async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution;
}

pub trait AgentStore: Send + Sync {
    fn begin_run(&self, run: &BeginAgentRunCommand) -> Result<(), ApplicationError>;

    fn begin_tool_call(&self, call: &BeginAgentToolCallCommand) -> Result<(), ApplicationError>;

    fn finish_tool_call(&self, call: &FinishAgentToolCallCommand) -> Result<(), ApplicationError>;

    fn finish_run(&self, run: &FinishAgentRunCommand) -> Result<(), ApplicationError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentLimits {
    pub max_rounds: u32,
    pub max_tool_calls: u32,
}

impl Default for AgentLimits {
    fn default() -> Self {
        Self {
            max_rounds: 8,
            max_tool_calls: 24,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunAgentCommand {
    pub run_id: String,
    pub provider_id: String,
    pub model: String,
    pub run_kind: AgentRunKind,
    pub system_prompt: String,
    pub user_prompt: String,
    pub temperature: f32,
    pub limits: AgentLimits,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunOutcome {
    pub run_id: String,
    pub content: String,
    pub model: String,
    pub run_kind: AgentRunKind,
    pub actual_model: String,
    pub rounds: u32,
    pub tool_calls: u32,
    pub latency_ms: u64,
    pub retry_count: u32,
    pub prompt_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
}

struct AgentRunTrace {
    run_kind: AgentRunKind,
    actual_model: Option<String>,
    latency_ms: u64,
    usage: Option<TokenUsage>,
    retry_count: u32,
    provider_request_id: Option<String>,
    prompt_hash: String,
}

impl AgentRunTrace {
    fn new(run_kind: AgentRunKind, prompt_hash: String) -> Self {
        Self {
            run_kind,
            actual_model: None,
            latency_ms: 0,
            usage: None,
            retry_count: 0,
            provider_request_id: None,
            prompt_hash,
        }
    }

    fn record_response(&mut self, response: &AgentModelResponse) {
        if !response.model.trim().is_empty() {
            self.actual_model = Some(response.model.clone());
        }
        self.latency_ms = self.latency_ms.saturating_add(response.latency_ms);
        self.retry_count = self.retry_count.saturating_add(response.retry_count);
        self.usage = merge_usage(self.usage.take(), response.usage.clone());
        self.provider_request_id = response.provider_request_id.clone();
    }

    fn record_failure(&mut self, failure: &AgentModelFailure) {
        if let Some(model) = failure
            .model
            .as_ref()
            .filter(|model| !model.trim().is_empty())
        {
            self.actual_model = Some(model.clone());
        }
        self.latency_ms = self.latency_ms.saturating_add(failure.latency_ms);
        self.retry_count = self.retry_count.saturating_add(failure.retry_count);
        self.usage = merge_usage(self.usage.take(), failure.usage.clone());
        self.provider_request_id = failure.provider_request_id.clone();
    }

    fn result_json(&self, has_content: bool) -> Value {
        json!({
            "runKind": self.run_kind,
            "actualModel": self.actual_model,
            "hasContent": has_content,
            "latencyMs": self.latency_ms,
            "usage": self.usage,
            "retryCount": self.retry_count,
            "providerRequestId": self.provider_request_id,
            "promptHash": self.prompt_hash,
        })
    }
}

pub struct AgentService;

/// Cooperative cancellation token for one agent run (M12-02/M14 cancel path).
///
/// The host (Tauri command layer) owns the token and hands it to the run;
/// the loop checks it at round and tool-call boundaries and lands the run as
/// `Interrupted` — never as a fabricated failure — when cancelled.
#[derive(Debug, Clone, Default)]
pub struct AgentCancelToken {
    cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AgentCancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl AgentService {
    pub async fn run<S, M, T>(
        store: &S,
        model: &M,
        tools: &T,
        command: RunAgentCommand,
        cancel: &AgentCancelToken,
    ) -> Result<AgentRunOutcome, ApplicationError>
    where
        S: AgentStore,
        M: AgentModel,
        T: AgentToolExecutor,
    {
        validate_command(&command)?;
        let prompt_hash = sha256_hex(&command.system_prompt);
        store.begin_run(&BeginAgentRunCommand {
            id: command.run_id.clone(),
            provider_id: command.provider_id.clone(),
            model: command.model.clone(),
            run_kind: command.run_kind,
        })?;

        let mut trace = AgentRunTrace::new(command.run_kind, prompt_hash);
        let mut messages = vec![
            AgentMessage::System {
                content: command.system_prompt,
            },
            AgentMessage::User {
                content: command.user_prompt,
            },
        ];
        let definitions = tools.definitions();
        let mut tool_call_count = 0_u32;
        let mut seen_tool_call_ids = HashSet::new();

        for round in 1..=command.limits.max_rounds {
            if cancel.is_cancelled() {
                return Err(cancelled_run(
                    store,
                    &command.run_id,
                    round,
                    tool_call_count,
                    &trace,
                ));
            }
            let response = match model
                .respond(AgentModelRequest {
                    messages: messages.clone(),
                    tools: definitions.clone(),
                    temperature: command.temperature,
                })
                .await
            {
                Ok(response) => response,
                Err(failure) => {
                    trace.record_failure(&failure);
                    let error = ApplicationError::new(
                        "agent.provider_failed",
                        failure.error.message,
                        failure.error.retryable,
                    );
                    finish_failed_run_best_effort(
                        store,
                        &command.run_id,
                        AgentRunStatus::Failed,
                        round,
                        tool_call_count,
                        &trace,
                        error.clone(),
                    );
                    return Err(error);
                }
            };
            trace.record_response(&response);

            if response.tool_calls.is_empty() {
                let content = response
                    .content
                    .as_deref()
                    .map(str::trim)
                    .filter(|content| !content.is_empty())
                    .ok_or_else(|| {
                        ApplicationError::new(
                            "agent.invalid_response",
                            "agent response has neither content nor tool calls",
                            false,
                        )
                    });
                let content = match content {
                    Ok(content) => content.to_string(),
                    Err(error) => {
                        finish_failed_run_best_effort(
                            store,
                            &command.run_id,
                            AgentRunStatus::Failed,
                            round,
                            tool_call_count,
                            &trace,
                            error.clone(),
                        );
                        return Err(error);
                    }
                };
                store.finish_run(&FinishAgentRunCommand {
                    id: command.run_id.clone(),
                    status: AgentRunStatus::Completed,
                    rounds: round,
                    tool_call_count,
                    result: Some(trace.result_json(true)),
                    error: None,
                })?;
                let actual_model = trace
                    .actual_model
                    .clone()
                    .unwrap_or_else(|| command.model.clone());
                return Ok(AgentRunOutcome {
                    run_id: command.run_id,
                    content,
                    model: actual_model.clone(),
                    run_kind: command.run_kind,
                    actual_model,
                    rounds: round,
                    tool_calls: tool_call_count,
                    latency_ms: trace.latency_ms,
                    retry_count: trace.retry_count,
                    prompt_hash: trace.prompt_hash,
                    usage: trace.usage,
                    provider_request_id: trace.provider_request_id,
                });
            }

            messages.push(AgentMessage::Assistant {
                content: response.content,
                tool_calls: response.tool_calls.clone(),
            });
            if let Err((status, error)) = validate_tool_batch(
                &response.tool_calls,
                &seen_tool_call_ids,
                command.limits.max_tool_calls - tool_call_count,
                command.limits.max_tool_calls,
            ) {
                finish_failed_run_best_effort(
                    store,
                    &command.run_id,
                    status,
                    round,
                    tool_call_count,
                    &trace,
                    error.clone(),
                );
                return Err(error);
            }

            seen_tool_call_ids.extend(response.tool_calls.iter().map(|call| call.id.clone()));
            for call in response.tool_calls {
                if cancel.is_cancelled() {
                    return Err(cancelled_run(
                        store,
                        &command.run_id,
                        round,
                        tool_call_count,
                        &trace,
                    ));
                }
                tool_call_count += 1;

                store.begin_tool_call(&BeginAgentToolCallCommand {
                    run_id: command.run_id.clone(),
                    call_id: call.id.clone(),
                    sequence: tool_call_count,
                    round,
                    tool_name: call.name.clone(),
                    arguments: tools.audit_arguments(&call),
                })?;
                let execution = tools.execute(&call).await;
                store.finish_tool_call(&FinishAgentToolCallCommand {
                    run_id: command.run_id.clone(),
                    call_id: call.id.clone(),
                    sequence: tool_call_count,
                    status: execution.status,
                    result: execution.audit_result,
                    error: execution.error.as_ref().map(error_json),
                })?;
                messages.push(AgentMessage::ToolResult {
                    tool_call_id: call.id,
                    content: execution.model_content,
                    is_error: execution.status != AgentToolStatus::Succeeded,
                });
            }
        }

        let error = ApplicationError::new(
            "agent.max_rounds_exceeded",
            format!(
                "agent exceeded the round limit of {}",
                command.limits.max_rounds
            ),
            false,
        );
        finish_failed_run_best_effort(
            store,
            &command.run_id,
            AgentRunStatus::LimitExceeded,
            command.limits.max_rounds,
            tool_call_count,
            &trace,
            error.clone(),
        );
        Err(error)
    }
}

/// Land a cancelled run as `Interrupted` (best-effort) and surface a
/// retryable cancellation error. Cancellation is an audit state, not a
/// provider failure.
fn cancelled_run<S: AgentStore>(
    store: &S,
    run_id: &str,
    rounds: u32,
    tool_calls: u32,
    trace: &AgentRunTrace,
) -> ApplicationError {
    let error = ApplicationError::new(
        "agent.run_cancelled",
        "agent run was cancelled",
        true,
    );
    finish_failed_run_best_effort(
        store,
        run_id,
        AgentRunStatus::Interrupted,
        rounds,
        tool_calls,
        trace,
        error.clone(),
    );
    error
}

fn validate_tool_batch(
    calls: &[AgentToolCall],
    seen_ids: &HashSet<String>,
    remaining_limit: u32,
    max_tool_calls: u32,
) -> Result<(), (AgentRunStatus, ApplicationError)> {
    if calls.len() > remaining_limit as usize {
        return Err((
            AgentRunStatus::LimitExceeded,
            ApplicationError::new(
                "agent.max_tool_calls_exceeded",
                format!("agent exceeded the tool call limit of {}", max_tool_calls),
                false,
            ),
        ));
    }

    let mut ids = seen_ids.clone();
    if calls.iter().any(|call| {
        call.id.trim().is_empty() || call.name.trim().is_empty() || !ids.insert(call.id.clone())
    }) {
        return Err((
            AgentRunStatus::Failed,
            ApplicationError::new(
                "agent.invalid_response",
                "agent tool calls require non-empty, unique ids and non-empty names",
                false,
            ),
        ));
    }

    Ok(())
}

fn validate_command(command: &RunAgentCommand) -> Result<(), ApplicationError> {
    if command.run_id.trim().is_empty()
        || command.provider_id.trim().is_empty()
        || command.model.trim().is_empty()
        || command.system_prompt.trim().is_empty()
        || command.user_prompt.trim().is_empty()
    {
        return Err(ApplicationError::new(
            "agent.invalid_request",
            "run id, provider, model, system prompt, and user prompt are required",
            false,
        ));
    }
    if command.limits.max_rounds == 0 || command.limits.max_tool_calls == 0 {
        return Err(ApplicationError::new(
            "agent.invalid_request",
            "agent limits must be greater than zero",
            false,
        ));
    }
    Ok(())
}

fn finish_run_best_effort<S: AgentStore>(store: &S, run: &FinishAgentRunCommand) {
    if let Err(error) = store.finish_run(run) {
        tracing::warn!(
            run_id = %run.id,
            status = ?run.status,
            error = %error,
            "agent run audit finish failed"
        );
    }
}

fn finish_failed_run_best_effort<S: AgentStore>(
    store: &S,
    run_id: &str,
    status: AgentRunStatus,
    rounds: u32,
    tool_calls: u32,
    trace: &AgentRunTrace,
    error: ApplicationError,
) {
    finish_run_best_effort(
        store,
        &FinishAgentRunCommand {
            id: run_id.to_string(),
            status,
            rounds,
            tool_call_count: tool_calls,
            result: Some(trace.result_json(false)),
            error: Some(error_json(&error)),
        },
    );
}

fn error_json(error: &ApplicationError) -> Value {
    serde_json::to_value(error).unwrap_or_else(|_| {
        json!({
            "code": error.code,
            "message": error.message,
            "retryable": error.retryable,
        })
    })
}

fn merge_usage(current: Option<TokenUsage>, next: Option<TokenUsage>) -> Option<TokenUsage> {
    match (current, next) {
        (None, None) => None,
        (Some(usage), None) | (None, Some(usage)) => Some(usage),
        (Some(current), Some(next)) => Some(TokenUsage {
            input_tokens: current.input_tokens.saturating_add(next.input_tokens),
            output_tokens: current.output_tokens.saturating_add(next.output_tokens),
        }),
    }
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Default)]
    struct StoreState {
        run_started: bool,
        calls_started: Vec<BeginAgentToolCallCommand>,
        calls_finished: Vec<FinishAgentToolCallCommand>,
        run_finished: Option<FinishAgentRunCommand>,
        fail_finish_tool_call_once: bool,
        fail_finish_run_once: bool,
    }

    #[derive(Clone, Default)]
    struct FakeStore(Arc<Mutex<StoreState>>);

    impl AgentStore for FakeStore {
        fn begin_run(&self, _run: &BeginAgentRunCommand) -> Result<(), ApplicationError> {
            self.0.lock().unwrap().run_started = true;
            Ok(())
        }

        fn begin_tool_call(
            &self,
            call: &BeginAgentToolCallCommand,
        ) -> Result<(), ApplicationError> {
            self.0.lock().unwrap().calls_started.push(call.clone());
            Ok(())
        }

        fn finish_tool_call(
            &self,
            call: &FinishAgentToolCallCommand,
        ) -> Result<(), ApplicationError> {
            let mut state = self.0.lock().unwrap();
            if state.fail_finish_tool_call_once {
                state.fail_finish_tool_call_once = false;
                return Err(ApplicationError::new(
                    "agent.persistence_failed",
                    "injected tool audit failure",
                    true,
                ));
            }
            state.calls_finished.push(call.clone());
            Ok(())
        }

        fn finish_run(&self, run: &FinishAgentRunCommand) -> Result<(), ApplicationError> {
            let mut state = self.0.lock().unwrap();
            if state.fail_finish_run_once {
                state.fail_finish_run_once = false;
                return Err(ApplicationError::new(
                    "agent.persistence_failed",
                    "injected run audit failure",
                    true,
                ));
            }
            state.run_finished = Some(run.clone());
            Ok(())
        }
    }

    struct ScriptedModel {
        responses: Mutex<VecDeque<Result<AgentModelResponse, AgentModelFailure>>>,
        requests: Mutex<Vec<AgentModelRequest>>,
        store: FakeStore,
    }

    #[async_trait]
    impl AgentModel for ScriptedModel {
        async fn respond(
            &self,
            request: AgentModelRequest,
        ) -> Result<AgentModelResponse, AgentModelFailure> {
            assert!(
                self.store.0.try_lock().is_ok(),
                "store lock was held during model I/O"
            );
            self.requests.lock().unwrap().push(request);
            self.responses.lock().unwrap().pop_front().unwrap()
        }
    }

    #[derive(Default)]
    struct FakeTools(Mutex<Vec<String>>);

    #[async_trait]
    impl AgentToolExecutor for FakeTools {
        fn definitions(&self) -> Vec<AgentToolDefinition> {
            vec![AgentToolDefinition {
                name: "read_file".into(),
                description: "Read a UTF-8 file".into(),
                parameters: json!({"type":"object"}),
            }]
        }

        fn audit_arguments(&self, call: &AgentToolCall) -> Value {
            json!({"tool": call.name, "hasArguments": !call.arguments_json.is_empty()})
        }

        async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution {
            self.0.lock().unwrap().push(call.name.clone());
            if call.name == "read_file" {
                AgentToolExecution::succeeded(
                    r#"{"content":"hello","sha256":"abc"}"#,
                    json!({"path":"note.txt","bytes":5,"sha256":"abc"}),
                )
            } else {
                AgentToolExecution::rejected(
                    "agent.unknown_tool",
                    "unknown tool",
                    json!({"known":false}),
                )
            }
        }
    }

    #[tokio::test]
    async fn completes_without_calling_tools() {
        let store = FakeStore::default();
        let model = model(&store, vec![Ok(response(Some("done"), vec![]))]);
        let outcome = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.content, "done");
        assert_eq!(outcome.rounds, 1);
        assert_eq!(outcome.tool_calls, 0);
        assert_eq!(outcome.latency_ms, 1);
        assert_eq!(outcome.retry_count, 0);
        assert_eq!(
            outcome.prompt_hash,
            "057f0734e79e11e0529fd0d6bb41e5019d7a14933e6cf8219cba32e676946704"
        );
        assert_eq!(outcome.actual_model, "fake-model");
        assert_eq!(
            store
                .0
                .lock()
                .unwrap()
                .run_finished
                .as_ref()
                .unwrap()
                .status,
            AgentRunStatus::Completed
        );
        let result = store
            .0
            .lock()
            .unwrap()
            .run_finished
            .as_ref()
            .unwrap()
            .result
            .clone()
            .unwrap();
        assert_eq!(result["actualModel"], "fake-model");
        assert_eq!(result["latencyMs"], 1);
        assert_eq!(result["retryCount"], 0);
        assert_eq!(result["usage"]["inputTokens"], 2);
        assert_eq!(result["usage"]["outputTokens"], 1);
        assert_eq!(result["providerRequestId"], "request-1");
        assert_eq!(result["promptHash"], outcome.prompt_hash);
        assert!(result.get("content").is_none());
    }

    #[tokio::test]
    async fn replays_read_file_then_content() {
        let store = FakeStore::default();
        let model = model(
            &store,
            vec![
                Ok(response(None, vec![call("call-1", "read_file")])),
                Ok(response(Some("finished"), vec![])),
            ],
        );
        let tools = FakeTools::default();
        let outcome = AgentService::run(&store, &model, &tools, command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.tool_calls, 1);
        assert_eq!(*tools.0.lock().unwrap(), vec!["read_file"]);
        let requests = model.requests.lock().unwrap();
        let second = &requests[1].messages;
        assert!(matches!(
            second[3],
            AgentMessage::ToolResult {
                is_error: false,
                ..
            }
        ));
        let state = store.0.lock().unwrap();
        assert_eq!(state.calls_started.len(), 1);
        assert_eq!(state.calls_finished[0].status, AgentToolStatus::Succeeded);
        assert!(!state.calls_finished[0].result.to_string().contains("hello"));
    }

    #[tokio::test]
    async fn replays_multiple_tools_in_sequence() {
        let store = FakeStore::default();
        let model = model(
            &store,
            vec![
                Ok(response(
                    None,
                    vec![call("call-1", "read_file"), call("call-2", "read_file")],
                )),
                Ok(response(Some("finished"), vec![])),
            ],
        );
        let tools = FakeTools::default();

        let outcome = AgentService::run(&store, &model, &tools, command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.tool_calls, 2);
        assert_eq!(*tools.0.lock().unwrap(), vec!["read_file", "read_file"]);
        let state = store.0.lock().unwrap();
        assert_eq!(state.calls_started[0].sequence, 1);
        assert_eq!(state.calls_started[1].sequence, 2);
    }

    #[tokio::test]
    async fn replays_unknown_tool_as_rejected_result() {
        let store = FakeStore::default();
        let model = model(
            &store,
            vec![
                Ok(response(None, vec![call("call-unknown", "unknown")])),
                Ok(response(Some("handled"), vec![])),
            ],
        );

        let outcome = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.content, "handled");
        let state = store.0.lock().unwrap();
        assert_eq!(state.calls_finished[0].status, AgentToolStatus::Rejected);
        let requests = model.requests.lock().unwrap();
        assert!(matches!(
            requests[1].messages[3],
            AgentMessage::ToolResult { is_error: true, .. }
        ));
    }

    #[tokio::test]
    async fn aggregates_trace_metadata_across_model_rounds() {
        let store = FakeStore::default();
        let mut first = response(None, vec![call("call-1", "read_file")]);
        first.latency_ms = 7;
        first.retry_count = 1;
        first.provider_request_id = Some("request-first".into());
        let mut terminal = response(Some("finished"), vec![]);
        terminal.latency_ms = 11;
        terminal.retry_count = 2;
        terminal.model = "provider-terminal-model".into();
        terminal.provider_request_id = Some("request-terminal".into());
        let model = model(&store, vec![Ok(first), Ok(terminal)]);

        let outcome = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.latency_ms, 18);
        assert_eq!(outcome.retry_count, 3);
        assert_eq!(outcome.actual_model, "provider-terminal-model");
        assert_eq!(
            outcome.provider_request_id.as_deref(),
            Some("request-terminal")
        );
        assert_eq!(outcome.usage.unwrap().input_tokens, 4);
    }

    #[tokio::test]
    async fn rejects_malformed_tool_arguments_without_losing_audit() {
        let store = FakeStore::default();
        let malformed = AgentToolCall {
            id: "call-bad-json".into(),
            name: "read_file".into(),
            arguments_json: "{not-json".into(),
        };
        let model = model(
            &store,
            vec![
                Ok(response(None, vec![malformed])),
                Ok(response(Some("handled"), vec![])),
            ],
        );

        let outcome = AgentService::run(&store, &model, &JsonValidatingTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap();

        assert_eq!(outcome.content, "handled");
        let state = store.0.lock().unwrap();
        assert_eq!(state.calls_finished[0].status, AgentToolStatus::Rejected);
        assert_eq!(
            state.calls_finished[0].error.as_ref().unwrap()["code"],
            "agent.invalid_arguments"
        );
        assert!(!state.calls_started[0]
            .arguments
            .to_string()
            .contains("not-json"));
    }

    #[tokio::test]
    async fn persists_provider_failure() {
        let store = FakeStore::default();
        let model = model(&store, vec![Err(failure("provider timeout", true))]);
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.provider_failed");
        let state = store.0.lock().unwrap();
        let finish = state.run_finished.as_ref().unwrap();
        assert_eq!(finish.status, AgentRunStatus::Failed);
        assert_eq!(
            finish.error.as_ref().unwrap()["retryable"].as_bool(),
            Some(true)
        );
        let trace = finish.result.as_ref().unwrap();
        assert!(trace["actualModel"].is_null());
        assert_eq!(trace["latencyMs"], 3);
        assert_eq!(trace["retryCount"], 2);
        assert_eq!(trace["providerRequestId"], "request-failed");
        assert_eq!(
            trace["promptHash"],
            "057f0734e79e11e0529fd0d6bb41e5019d7a14933e6cf8219cba32e676946704"
        );
        assert_eq!(trace["hasContent"], false);
        assert!(trace.get("content").is_none());
    }

    #[tokio::test]
    async fn persists_aggregated_trace_when_a_later_model_round_fails() {
        let store = FakeStore::default();
        let mut first = response(None, vec![call("call-1", "read_file")]);
        first.latency_ms = 7;
        first.retry_count = 1;
        first.provider_request_id = Some("request-first".into());
        let terminal_failure = AgentModelFailure::with_trace(
            ModelError::new("provider timeout", true),
            Some("provider-failure-model".into()),
            13,
            Some(TokenUsage {
                input_tokens: 5,
                output_tokens: 0,
            }),
            Some("request-failed".into()),
            2,
        );
        let model = model(&store, vec![Ok(first), Err(terminal_failure)]);

        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.provider_failed");
        let state = store.0.lock().unwrap();
        let finish = state.run_finished.as_ref().unwrap();
        let trace = finish.result.as_ref().unwrap();
        assert_eq!(finish.rounds, 2);
        assert_eq!(finish.tool_call_count, 1);
        assert_eq!(trace["actualModel"], "provider-failure-model");
        assert_eq!(trace["latencyMs"], 20);
        assert_eq!(trace["retryCount"], 3);
        assert_eq!(trace["usage"]["inputTokens"], 7);
        assert_eq!(trace["usage"]["outputTokens"], 1);
        assert_eq!(trace["providerRequestId"], "request-failed");
    }

    #[tokio::test]
    async fn tool_audit_finish_failure_stops_before_next_model_round() {
        let store = FakeStore::default();
        store.0.lock().unwrap().fail_finish_tool_call_once = true;
        let model = model(
            &store,
            vec![
                Ok(response(None, vec![call("call-1", "read_file")])),
                Ok(response(Some("finished"), vec![])),
            ],
        );
        let tools = FakeTools::default();
        let error = AgentService::run(&store, &model, &tools, command(), &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.persistence_failed");
        assert_eq!(model.requests.lock().unwrap().len(), 1);
        assert_eq!(*tools.0.lock().unwrap(), vec!["read_file"]);
        let state = store.0.lock().unwrap();
        assert!(state.calls_finished.is_empty());
        assert!(state.run_finished.is_none());
    }

    #[tokio::test]
    async fn successful_run_audit_finish_failure_is_returned() {
        let store = FakeStore::default();
        store.0.lock().unwrap().fail_finish_run_once = true;
        let model = model(&store, vec![Ok(response(Some("finished"), vec![]))]);
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.persistence_failed");
        assert!(store.0.lock().unwrap().run_finished.is_none());
    }

    #[tokio::test]
    async fn failed_run_audit_finish_failure_does_not_mask_provider_error() {
        let store = FakeStore::default();
        store.0.lock().unwrap().fail_finish_run_once = true;
        let model = model(&store, vec![Err(failure("provider timeout", true))]);
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.provider_failed");
        assert!(store.0.lock().unwrap().run_finished.is_none());
    }

    #[tokio::test]
    async fn enforces_tool_call_limit() {
        let store = FakeStore::default();
        let model = model(
            &store,
            vec![Ok(response(
                None,
                vec![call("call-1", "read_file"), call("call-2", "read_file")],
            ))],
        );
        let mut command = command();
        command.limits.max_tool_calls = 1;
        let error = AgentService::run(&store, &model, &FakeTools::default(), command, &AgentCancelToken::new())
            .await
            .unwrap_err();

        assert_eq!(error.code, "agent.max_tool_calls_exceeded");
        let state = store.0.lock().unwrap();
        assert!(state.calls_started.is_empty());
        assert!(state.calls_finished.is_empty());
        assert_eq!(
            state.run_finished.as_ref().unwrap().status,
            AgentRunStatus::LimitExceeded
        );
    }

    #[tokio::test]
    async fn enforces_round_limit_and_rejects_empty_final_response() {
        let store = FakeStore::default();
        let round_limited_model = model(
            &store,
            vec![Ok(response(None, vec![call("call-1", "read_file")]))],
        );
        let mut round_limited_command = command();
        round_limited_command.limits.max_rounds = 1;
        let error = AgentService::run(
            &store,
            &round_limited_model,
            &FakeTools::default(),
            round_limited_command,
            &AgentCancelToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "agent.max_rounds_exceeded");

        let store = FakeStore::default();
        let model = model(&store, vec![Ok(response(Some("  "), vec![]))]);
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.code, "agent.invalid_response");
    }

    #[tokio::test]
    async fn rejects_duplicate_tool_call_ids() {
        let store = FakeStore::default();
        let model = model(
            &store,
            vec![Ok(response(
                None,
                vec![call("call-1", "read_file"), call("call-1", "read_file")],
            ))],
        );
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &AgentCancelToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.code, "agent.invalid_response");
        let state = store.0.lock().unwrap();
        assert!(state.calls_started.is_empty());
        assert!(state.calls_finished.is_empty());
    }

    fn model(
        store: &FakeStore,
        responses: Vec<Result<AgentModelResponse, AgentModelFailure>>,
    ) -> ScriptedModel {
        ScriptedModel {
            responses: Mutex::new(responses.into()),
            requests: Mutex::new(Vec::new()),
            store: store.clone(),
        }
    }

    fn response(content: Option<&str>, tool_calls: Vec<AgentToolCall>) -> AgentModelResponse {
        AgentModelResponse {
            content: content.map(str::to_string),
            tool_calls,
            model: "fake-model".into(),
            latency_ms: 1,
            usage: Some(TokenUsage {
                input_tokens: 2,
                output_tokens: 1,
            }),
            provider_request_id: Some("request-1".into()),
            retry_count: 0,
        }
    }

    fn failure(message: &str, retryable: bool) -> AgentModelFailure {
        AgentModelFailure::with_trace(
            ModelError::new(message, retryable),
            None,
            3,
            None,
            Some("request-failed".into()),
            2,
        )
    }

    #[derive(Default)]
    struct JsonValidatingTools(FakeTools);

    #[async_trait]
    impl AgentToolExecutor for JsonValidatingTools {
        fn definitions(&self) -> Vec<AgentToolDefinition> {
            self.0.definitions()
        }

        fn audit_arguments(&self, call: &AgentToolCall) -> Value {
            json!({"tool": call.name, "validJson": serde_json::from_str::<Value>(&call.arguments_json).is_ok()})
        }

        async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution {
            if serde_json::from_str::<Value>(&call.arguments_json).is_err() {
                return AgentToolExecution::rejected(
                    "agent.invalid_arguments",
                    "tool arguments must be valid JSON",
                    json!({"validJson": false}),
                );
            }
            self.0.execute(call).await
        }
    }

    fn call(id: &str, name: &str) -> AgentToolCall {
        AgentToolCall {
            id: id.into(),
            name: name.into(),
            arguments_json: r#"{"path":"note.txt"}"#.into(),
        }
    }

    fn command() -> RunAgentCommand {
        RunAgentCommand {
            run_id: "run-1".into(),
            provider_id: "openai-compatible".into(),
            model: "fake-model".into(),
            run_kind: AgentRunKind::Workspace,
            system_prompt: "Use tools when needed.".into(),
            user_prompt: "Read note.txt".into(),
            temperature: 0.1,
            limits: AgentLimits::default(),
        }
    }

    #[tokio::test]
    async fn run_lands_interrupted_when_cancelled_before_round() {
        let store = FakeStore::default();
        // An empty scripted queue panics if the model is reached — a
        // cancelled run must never get that far.
        let model = ScriptedModel {
            responses: Mutex::new(VecDeque::new()),
            requests: Mutex::new(Vec::new()),
            store: store.clone(),
        };
        let cancel = AgentCancelToken::new();
        cancel.cancel();
        let error = AgentService::run(&store, &model, &FakeTools::default(), command(), &cancel)
            .await
            .unwrap_err();
        assert_eq!(error.code, "agent.run_cancelled");
        assert!(error.retryable);
        let state = store.0.lock().unwrap();
        assert!(state.run_started);
        let finish = state.run_finished.as_ref().expect("run must land a terminal row");
        assert_eq!(finish.status, AgentRunStatus::Interrupted);
        assert!(
            model.requests.lock().unwrap().is_empty(),
            "cancelled run must not reach the model"
        );
    }
}
