use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use ielts_application::{
    AgentMessage, AgentModel, AgentModelFailure, AgentModelRequest, AgentModelResponse,
    AgentToolCall, CompletionRequest, CompletionResponse, LanguageModel, ModelError,
    ReasoningEcho, TokenUsage,
};
use serde::de::DeserializeOwned;
use ielts_db::{MAX_USAGE_COUNT, UNLINKED_REQUEST_HASH};
use ielts_domain::estimate_tokens;
use serde::Deserialize;
use serde_json::{json, Value};

use super::context_window::{agent_input_tokens, budget_for, context_budget, Admission};

/// Transport-layer retries (5xx / 429 / timeout / connect) inside ONE gateway
/// call. The bound is per call; a caller that owns its own semantic retry loop
/// (the weekly dream) asks for 0 via [`AiRuntime::with_transport_retries`] so the
/// two layers never multiply.
pub(crate) const MAX_RETRIES: u32 = 2;

struct ChatCompletionFailure {
    error: ModelError,
    model: Option<String>,
    usage: Option<TokenUsage>,
    latency_ms: u64,
    retry_count: u32,
    provider_request_id: Option<String>,
}

impl ChatCompletionFailure {
    fn new(
        error: ModelError,
        latency_ms: u64,
        retry_count: u32,
        provider_request_id: Option<String>,
    ) -> Self {
        Self {
            error,
            model: None,
            usage: None,
            latency_ms,
            retry_count,
            provider_request_id,
        }
    }

    fn into_trace(self) -> AgentModelFailure {
        AgentModelFailure::with_trace(
            self.error,
            self.model,
            self.latency_ms,
            self.usage,
            self.provider_request_id,
            self.retry_count,
        )
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AiProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub secret_name: String,
    pub timeout: Duration,
}

/// Receives one `llm_invocations` row per ledgered gateway call.
pub(crate) type LedgerSink = Arc<dyn Fn(ielts_db::LlmInvocationRecord) + Send + Sync>;

// The runtime owns the API key. Do not derive Debug/Clone: formatting or
// copying this value would make accidental credential exposure easy.
pub(crate) struct AiRuntime {
    pub config: AiProviderConfig,
    api_key: String,
    client: reqwest::Client,
    transport_retries: u32,
    ledger: Option<LedgerSink>,
    /// Set once this endpoint refused a streamed request: later calls on this
    /// runtime go straight to the plain request.
    stream_unsupported: AtomicBool,
}

impl AiRuntime {
    pub(crate) fn new(
        config: AiProviderConfig,
        api_key: String,
    ) -> Result<Self, ielts_db::DbError> {
        let client = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|error| {
                ielts_db::DbError::Message(format!("failed to build AI HTTP client: {error}"))
            })?;
        Ok(Self {
            config,
            api_key,
            client,
            transport_retries: MAX_RETRIES,
            ledger: None,
            stream_unsupported: AtomicBool::new(false),
        })
    }

    /// Override the per-call transport retry budget (default [`MAX_RETRIES`]).
    pub(crate) fn with_transport_retries(mut self, retries: u32) -> Self {
        self.transport_retries = retries;
        self
    }

    /// Ledger every plain completion and agent call. `complete_with_trace`
    /// callers (the coach) keep their own invocation row and are not ledgered.
    pub(crate) fn with_ledger(mut self, sink: LedgerSink) -> Self {
        self.ledger = Some(sink);
        self
    }

    /// `clamped` is the output ceiling the pre-send guard lowered this call to,
    /// if it did; it lands in the row's `usage_json`.
    fn record_completion(
        &self,
        body: &Value,
        result: &Result<CompletionReply, AgentModelFailure>,
        admission: Admission,
    ) {
        let Some(sink) = &self.ledger else { return };
        let truncated = ModelError::output_truncated();
        let call = match result {
            Ok(reply) => {
                let response = &reply.response;
                LedgerCall {
                    model: &response.model,
                    latency_ms: response.latency_ms,
                    usage: response.usage.as_ref(),
                    provider_request_id: response.provider_request_id.as_deref(),
                    outcome: if is_truncated(reply.finish_reason.as_deref()) {
                        Err(&truncated)
                    } else {
                        Ok(&response.content)
                    },
                    finish_reason: reply.finish_reason.as_deref(),
                    admission,
                }
            }
            Err(failure) => LedgerCall { admission, ..LedgerCall::failed(failure, &self.config.model) },
        };
        sink(ledger_record(&self.config.provider, body, call));
    }

    fn record_agent(
        &self,
        body: &Value,
        result: &Result<AgentReply, AgentModelFailure>,
        admission: Admission,
    ) {
        let Some(sink) = &self.ledger else { return };
        let truncated = ModelError::output_truncated();
        let call = match result {
            Ok(reply) => LedgerCall {
                model: &reply.response.model,
                latency_ms: reply.response.latency_ms,
                usage: reply.response.usage.as_ref(),
                provider_request_id: reply.response.provider_request_id.as_deref(),
                outcome: if is_truncated(reply.finish_reason.as_deref()) {
                    Err(&truncated)
                } else {
                    Ok(reply.response.content.as_deref().unwrap_or(""))
                },
                finish_reason: reply.finish_reason.as_deref(),
                admission,
            },
            Err(failure) => LedgerCall { admission, ..LedgerCall::failed(failure, &self.config.model) },
        };
        sink(ledger_record(&self.config.provider, body, call));
    }
}

/// Writes ledger rows under the host connection's lock. A failed write is logged
/// and dropped: spend bookkeeping must never fail the user's call.
pub(crate) fn usage_ledger(conn: Arc<std::sync::Mutex<rusqlite::Connection>>) -> LedgerSink {
    Arc::new(move |record| match conn.lock() {
        Ok(conn) => {
            if let Err(error) = ielts_db::record_llm_invocation(&conn, &record) {
                tracing::warn!(%error, "llm usage ledger write failed");
            }
        }
        Err(_) => tracing::warn!("llm usage ledger skipped: db lock poisoned"),
    })
}

/// Writes the row for a ledgered call whose future is dropped before its reply is
/// read: a `tokio::time::timeout` around the call, or a cancelled `select!`. It is
/// created right before the HTTP send and disarmed as soon as the send returns, so
/// a call writes exactly one row: the normal one, or this interrupted one, never
/// both. Drop may write: the sink is a sync insert behind a mutex.
struct CallGuard {
    sink: Option<LedgerSink>,
    provider: String,
    model: String,
    started: Instant,
}

impl CallGuard {
    /// The send returned: the caller writes the normal row.
    fn disarm(mut self) {
        self.sink = None;
    }
}

impl Drop for CallGuard {
    fn drop(&mut self) {
        let Some(sink) = self.sink.take() else { return };
        // Nothing is known about the interrupted call: no usage and no estimate.
        let error = ModelError::classed("AI call was interrupted before its reply", true, "interrupted");
        sink(ledger_record(
            &self.provider,
            &Value::Null,
            LedgerCall {
                model: &self.model,
                latency_ms: elapsed_ms(self.started),
                usage: None,
                provider_request_id: None,
                outcome: Err(&error),
                finish_reason: None,
                admission: Admission::default(),
            },
        ));
    }
}

/// One gateway call as the ledger sees it: the provider's facts or the failure.
struct LedgerCall<'a> {
    model: &'a str,
    latency_ms: u64,
    usage: Option<&'a TokenUsage>,
    provider_request_id: Option<&'a str>,
    outcome: Result<&'a str, &'a ModelError>,
    /// The provider's finish reason, when the reply carried one.
    finish_reason: Option<&'a str>,
    /// What the pre-send guard decided (clamp and advisory context warning).
    admission: Admission,
}

impl<'a> LedgerCall<'a> {
    fn failed(failure: &'a AgentModelFailure, configured_model: &'a str) -> Self {
        Self {
            model: failure.model.as_deref().unwrap_or(configured_model),
            latency_ms: failure.latency_ms,
            usage: failure.usage.as_ref(),
            provider_request_id: failure.provider_request_id.as_deref(),
            outcome: Err(&failure.error),
            finish_reason: None,
            admission: Admission::default(),
        }
    }
}

/// The `llm_invocations` row for one call. Usage comes from the provider when it
/// reports any; a successful call without usage gets a chars-based estimate.
fn ledger_record(provider: &str, request: &Value, call: LedgerCall<'_>) -> ielts_db::LlmInvocationRecord {
    let usage = match (call.usage, call.outcome) {
        (Some(usage), _) => Some(provider_usage_json(usage)),
        (None, Ok(content)) => Some(estimated_usage_json(request, content)),
        (None, Err(_)) => None,
    };
    let usage = with_finish_reason(usage, call.finish_reason);
    let usage = with_max_tokens_clamped(usage, call.admission.clamped);
    let usage = with_context_warning(usage, call.admission.context_warning);
    ielts_db::LlmInvocationRecord {
        id: format!("llm-{}", uuid::Uuid::new_v4()),
        provider: provider.into(),
        model: call.model.into(),
        // Unlinked: no content hash (see `UNLINKED_REQUEST_HASH`), no response hash.
        request_hash: UNLINKED_REQUEST_HASH.into(),
        response_hash: None,
        usage_json: usage.map(|value| value.to_string()),
        latency_ms: call.latency_ms,
        provider_request_id: call.provider_request_id.map(str::to_string),
        error_json: call.outcome.err().map(|error| error_record(error).to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Records why the provider stopped next to the counts (`finishReason`), so a
/// truncated call is visible in the usage ledger.
fn with_finish_reason(usage: Option<Value>, finish_reason: Option<&str>) -> Option<Value> {
    let Some(reason) = finish_reason else { return usage };
    let mut value = usage.unwrap_or_else(|| json!({}));
    value["finishReason"] = json!(reason);
    Some(value)
}

/// Marks a call the context estimate said might not fit. Advisory only: the call
/// was still sent, so this is for spend review, not an error.
fn with_context_warning(usage: Option<Value>, warned: bool) -> Option<Value> {
    if !warned {
        return usage;
    }
    let mut value = usage.unwrap_or_else(|| json!({}));
    value["contextWarning"] = json!(true);
    Some(value)
}

/// Records that the pre-send guard lowered `max_tokens` to `clamped`, so a short
/// answer caused by a small remaining window is visible in the usage ledger.
fn with_max_tokens_clamped(usage: Option<Value>, clamped: Option<u32>) -> Option<Value> {
    let Some(max_tokens) = clamped else { return usage };
    let mut value = usage.unwrap_or_else(|| json!({}));
    value["maxTokensClamped"] = json!(max_tokens);
    Some(value)
}

/// What the ledger keeps of a failed call: the HTTP status when there was one,
/// the failure class and whether it was retryable. Never the provider's error
/// text, a URL or anything from the request.
fn error_record(error: &ModelError) -> Value {
    json!({"status": error.status, "class": error.class, "retryable": error.retryable})
}

/// A count as the ledger may store it: never above [`MAX_USAGE_COUNT`].
fn bounded_count(value: u64) -> u64 {
    value.min(MAX_USAGE_COUNT)
}

/// Provider-reported counts. Cache and reasoning keys appear only when non-zero:
/// the parsed `TokenUsage` cannot tell "reported as 0" from "not reported".
fn provider_usage_json(usage: &TokenUsage) -> Value {
    let prompt = bounded_count(usage.input_tokens);
    let completion = bounded_count(usage.output_tokens);
    let mut value = json!({
        "promptTokens": prompt,
        "completionTokens": completion,
        "totalTokens": prompt.saturating_add(completion),
    });
    if usage.cached_input_tokens > 0 {
        value["cachedInputTokens"] = json!(bounded_count(usage.cached_input_tokens));
    }
    if usage.reasoning_tokens > 0 {
        value["reasoningTokens"] = json!(bounded_count(usage.reasoning_tokens));
    }
    value
}

/// No provider usage: estimate the serialized request and the answer, flagged.
fn estimated_usage_json(request: &Value, content: &str) -> Value {
    let prompt = u64::from(estimate_tokens(&request.to_string()));
    let completion = u64::from(estimate_tokens(content));
    json!({
        "promptTokens": prompt,
        "completionTokens": completion,
        "totalTokens": prompt.saturating_add(completion),
        "estimated": true,
    })
}

#[async_trait]
impl LanguageModel for AiRuntime {
    async fn complete(&self, mut request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        // A refused request is still ledgered (with its error), as every plain
        // failure is; it is never sent.
        let admission = self.admit_completion(&mut request);
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        let (admission, reply) = match admission {
            Ok(admission) => (admission, self.send_ledgered(self.send_completion(&body)).await),
            Err(error) => (Admission::default(), Err(AgentModelFailure::new(error))),
        };
        self.record_completion(&body, &reply, admission);
        reply
            .and_then(CompletionReply::into_result)
            .map(|(response, _)| response)
            .map_err(|failure| failure.error)
    }

    fn identity(&self) -> (&str, &str) { (&self.config.provider, &self.config.model) }

    // The coach path owns its own trace row, so a refusal here is returned in
    // the failure for that trace and is not ledgered.
    async fn complete_with_trace(&self, mut request: CompletionRequest) -> Result<(CompletionResponse, u32), AgentModelFailure> {
        self.admit_completion(&mut request).map_err(AgentModelFailure::new)?;
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        self.send_completion(&body).await.and_then(CompletionReply::into_result)
    }

    async fn complete_with_trace_streaming(
        &self,
        mut request: CompletionRequest,
        on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<(CompletionResponse, u32), AgentModelFailure> {
        self.admit_completion(&mut request).map_err(AgentModelFailure::new)?;
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        self.send_completion_streaming(&body, on_delta).await.and_then(CompletionReply::into_result)
    }
}

#[async_trait]
impl AgentModel for AiRuntime {
    async fn respond(
        &self,
        mut request: AgentModelRequest,
    ) -> Result<AgentModelResponse, AgentModelFailure> {
        let admission = self.admit_agent(&mut request);
        let body = agent_request_body(&self.config.model, &self.config.base_url, &request);
        let (admission, result) = match admission {
            Ok(admission) => (admission, self.send_ledgered(self.send_agent(&body)).await),
            Err(error) => (Admission::default(), Err(AgentModelFailure::new(error))),
        };
        self.record_agent(&body, &result, admission);
        result.and_then(AgentReply::into_result).map(|reply| reply.response)
    }
}

impl AiRuntime {
    /// A plain completion for the sidecar. Unlike `complete`, a reply cut off at
    /// its ceiling is returned with whatever text arrived and `truncated` set, so
    /// the sidecar's own malformed-output handling decides what it means. Ledgered
    /// exactly like `complete`.
    pub(crate) async fn complete_partial(&self, mut request: CompletionRequest) -> Result<PartialCompletion, ModelError> {
        let admission = self.admit_completion(&mut request);
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        let (admission, reply) = match admission {
            Ok(admission) => (admission, self.send_ledgered(self.send_completion(&body)).await),
            Err(error) => (Admission::default(), Err(AgentModelFailure::new(error))),
        };
        self.record_completion(&body, &reply, admission);
        let reply = reply.map_err(|failure| failure.error)?;
        let truncated = is_truncated(reply.finish_reason.as_deref());
        Ok(PartialCompletion { response: reply.response, truncated })
    }

    /// Awaits one ledgered send under a [`CallGuard`]. The guard is disarmed when
    /// the send returns; if this future is dropped first, the guard writes the
    /// interrupted row instead.
    async fn send_ledgered<T>(&self, send: impl Future<Output = T>) -> T {
        let guard = CallGuard {
            sink: self.ledger.clone(),
            provider: self.config.provider.clone(),
            model: self.config.model.clone(),
            started: Instant::now(),
        };
        let reply = send.await;
        guard.disarm();
        reply
    }

    /// The pre-send guard for a plain completion. Runs before any HTTP call.
    /// `request.max_tokens` is updated to the clamped ceiling, if any.
    fn admit_completion(&self, request: &mut CompletionRequest) -> Result<Admission, ModelError> {
        let admission = context_budget(&self.config.model, &request.messages, request.max_tokens).admit()?;
        if let Some(max_tokens) = admission.clamped {
            request.max_tokens = max_tokens;
        }
        Ok(admission)
    }

    /// The pre-send guard for an agent round, counting tool definitions as input.
    fn admit_agent(&self, request: &mut AgentModelRequest) -> Result<Admission, ModelError> {
        let estimated = agent_input_tokens(&request.messages, &request.tools);
        let admission = budget_for(&self.config.model, estimated, request.max_tokens).admit()?;
        if let Some(max_tokens) = admission.clamped {
            request.max_tokens = max_tokens;
        }
        Ok(admission)
    }
}

/// A completion that may be cut off: the text that arrived and whether the
/// provider stopped at the output ceiling.
pub(crate) struct PartialCompletion {
    pub response: CompletionResponse,
    pub truncated: bool,
}

/// One provider completion before the caller-facing check. `finish_reason` is
/// what the provider said about why it stopped; only truncation acts on it.
struct CompletionReply {
    response: CompletionResponse,
    retry_count: u32,
    finish_reason: Option<String>,
}

impl CompletionReply {
    /// A reply cut off at the output ceiling is a typed error for every caller:
    /// a JSON caller would otherwise fail with a confusing parse error. Never
    /// retried here with a larger ceiling.
    fn into_result(self) -> Result<(CompletionResponse, u32), AgentModelFailure> {
        if !is_truncated(self.finish_reason.as_deref()) {
            return Ok((self.response, self.retry_count));
        }
        Err(AgentModelFailure::with_trace(
            ModelError::output_truncated(),
            Some(self.response.model),
            self.response.latency_ms,
            self.response.usage,
            self.response.provider_request_id,
            self.retry_count,
        ))
    }
}

/// A tool-calling or plain agent reply plus its finish reason.
struct AgentReply {
    response: AgentModelResponse,
    finish_reason: Option<String>,
}

impl AgentReply {
    /// The same truncation check as `CompletionReply::into_result`. A cut-off
    /// round is a typed error whatever it carries: a partial answer is not a
    /// final answer, and a partial tool call has incomplete arguments, so the
    /// agent service must never see it as a success.
    fn into_result(self) -> Result<Self, AgentModelFailure> {
        if !is_truncated(self.finish_reason.as_deref()) {
            return Ok(self);
        }
        let response = self.response;
        Err(AgentModelFailure::with_trace(
            ModelError::output_truncated(),
            Some(response.model),
            response.latency_ms,
            response.usage,
            response.provider_request_id,
            response.retry_count,
        ))
    }
}

/// Whether a provider finish reason means the output was cut off.
/// `length` is OpenAI-style; `max_tokens` is Anthropic-style `stop_reason`.
/// `model_context_window_exceeded` stops the reply the same way: the prompt
/// plus the output reached the window before the answer finished.
fn is_truncated(finish_reason: Option<&str>) -> bool {
    matches!(
        finish_reason,
        Some("length" | "max_tokens" | "model_context_window_exceeded")
    )
}

impl AiRuntime {
    async fn send_completion(&self, body: &Value) -> Result<CompletionReply, AgentModelFailure> {
        let (envelope, latency_ms, retry_count, header_request_id): (ChatResponse, _, _, _) = self
            .post_chat_completion(body, "AI response envelope invalid")
            .await
            .map_err(ChatCompletionFailure::into_trace)?;
        self.completion_reply(envelope, latency_ms, retry_count, header_request_id)
    }

    /// The caller-facing reply for one decoded chat envelope (shared with the
    /// streamed path, which falls back to a plain JSON body).
    fn completion_reply(
        &self,
        envelope: ChatResponse,
        latency_ms: u64,
        retry_count: u32,
        header_request_id: Option<String>,
    ) -> Result<CompletionReply, AgentModelFailure> {
        let model = envelope.model.clone().unwrap_or_else(|| self.config.model.clone());
        let finish_reason = envelope.finish_reason();
        let truncated = is_truncated(finish_reason.as_deref());
        let usage = envelope.usage.map(token_usage);
        let provider_request_id = prefer_provider_request_id(header_request_id, envelope.id);
        let content = match envelope.choices.into_iter().next().and_then(|choice| choice.message.content) {
            Some(content) => content.into_final_answer(),
            // A reply cut off at the ceiling can carry no text at all: that is a
            // truncation, reported as such rather than as an empty envelope.
            None if truncated => String::new(),
            None => return Err(AgentModelFailure::with_trace(invalid_response("AI response contained no choices"), Some(model), latency_ms, usage, provider_request_id, retry_count)),
        };
        Ok(CompletionReply {
            response: CompletionResponse {
                content,
                model,
                latency_ms,
                usage,
                provider_request_id,
            },
            retry_count,
            finish_reason,
        })
    }

    async fn send_agent(&self, body: &Value) -> Result<AgentReply, AgentModelFailure> {
        let (envelope, latency_ms, retry_count, header_request_id): (AgentChatResponse, _, _, _) =
            self.post_chat_completion(body, "AI agent response envelope invalid")
                .await
                .map_err(ChatCompletionFailure::into_trace)?;
        let finish_reason = envelope.finish_reason();
        let response = parse_agent_response(
            envelope,
            &self.config.model,
            latency_ms,
            retry_count,
            header_request_id,
        )?;
        Ok(AgentReply { response, finish_reason })
    }

    async fn post_chat_completion<T: DeserializeOwned>(
        &self,
        body: &Value,
        invalid_envelope: &str,
    ) -> Result<(T, u64, u32, Option<String>), ChatCompletionFailure> {
        let endpoint = format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let started = Instant::now();
        for attempt in 0..=self.transport_retries {
            let response = self
                .client
                .post(&endpoint)
                .bearer_auth(&self.api_key)
                .json(body)
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    let provider_request_id = provider_request_id_from_headers(response.headers());
                    let value = response.json::<Value>().await.map_err(|error| {
                        ChatCompletionFailure::new(
                            invalid_response(format!("{invalid_envelope}: {error}")),
                            elapsed_ms(started),
                            attempt,
                            provider_request_id.clone(),
                        )
                    })?;
                    let model = value.get("model").and_then(Value::as_str).map(str::to_string);
                    let usage = value.get("usage")
                        .and_then(|usage| serde_json::from_value::<ChatUsage>(usage.clone()).ok())
                        .map(token_usage);
                    let body_request_id = value.get("id").and_then(Value::as_str).map(str::to_string);
                    let envelope = serde_json::from_value::<T>(value).map_err(|_| {
                        // Serde errors can quote invalid string values. Keep only metadata,
                        // never response content, in the failure sent to persistence/UI.
                        ChatCompletionFailure {
                            error: invalid_response(invalid_envelope),
                            model,
                            usage,
                            latency_ms: elapsed_ms(started),
                            retry_count: attempt,
                            provider_request_id: prefer_provider_request_id(
                                provider_request_id.clone(), body_request_id,
                            ),
                        }
                    })?;
                    return Ok((envelope, elapsed_ms(started), attempt, provider_request_id));
                }
                Ok(response) => {
                    let status = response.status();
                    let provider_request_id = provider_request_id_from_headers(response.headers());
                    let retryable = status.is_server_error() || status.as_u16() == 429;
                    if retryable && attempt < self.transport_retries {
                        retry_delay(attempt).await;
                        continue;
                    }
                    // Carry the provider's own explanation. Without it a wrong
                    // key (401), a wrong model name (404), a rejected parameter
                    // (400) and an exhausted quota (429) all reached the user as
                    // the same bare status number under a "连接失败" prefix,
                    // which is undiagnosable. The body is the provider's error
                    // text, not our request, so the bearer token is not in it —
                    // but it is still bounded and never logged.
                    let body = response.text().await.unwrap_or_default();
                    return Err(ChatCompletionFailure::new(
                        provider_http_error(status, &body, retryable),
                        elapsed_ms(started),
                        attempt,
                        provider_request_id,
                    ));
                }
                Err(error) => {
                    let retryable = error.is_timeout() || error.is_connect();
                    if retryable && attempt < self.transport_retries {
                        retry_delay(attempt).await;
                        continue;
                    }
                    return Err(ChatCompletionFailure::new(
                        transport_error(&error, retryable),
                        elapsed_ms(started),
                        attempt,
                        None,
                    ));
                }
            }
        }
        unreachable!("retry loop always returns")
    }
}

/// The typed error for a provider HTTP failure. A 400 whose body says the prompt
/// is over the context window is the context-exceeded error, so the caller can
/// tell it from a bad request.
fn provider_http_error(status: reqwest::StatusCode, body: &str, retryable: bool) -> ModelError {
    let message = status_failure_message(status, extract_provider_error_detail(body));
    if status.as_u16() == 400 && is_context_overflow_body(body) {
        return ModelError::provider_context_exceeded(message, status.as_u16());
    }
    ModelError::http_status(message, retryable, status.as_u16())
}

/// Provider wording for a prompt longer than the model accepts. Checked only on
/// HTTP 400 bodies, where these phrases mean the request itself is too long.
fn is_context_overflow_body(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    ["context_length_exceeded", "maximum context length", "context window"]
        .iter()
        .any(|phrase| lower.contains(phrase))
}

/// The user-facing message for a non-success HTTP status, with the provider's
/// own explanation when it sent one.
fn status_failure_message(status: reqwest::StatusCode, detail: Option<String>) -> String {
    match detail {
        Some(detail) => format!("AI provider returned HTTP {}: {detail}", status.as_u16()),
        None => format!("AI provider returned HTTP {}", status.as_u16()),
    }
}

/// Longest provider error excerpt kept in a user-facing message. Enough for the
/// real explanation ("Incorrect API key provided", "model not found"), short
/// enough that a provider echoing a large payload cannot flood the UI.
const MAX_PROVIDER_ERROR_DETAIL: usize = 300;

/// A short readable reason from a provider error body, split out so it is
/// testable without standing up an HTTP server.
fn extract_provider_error_detail(body: &str) -> Option<String> {
    let body = body.trim();
    if body.is_empty() {
        return None;
    }
    let extracted = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            let error = value.get("error").or_else(|| value.get("message"))?;
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.to_string());

    let collapsed = extracted.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    Some(match collapsed.char_indices().nth(MAX_PROVIDER_ERROR_DETAIL) {
        Some((cut, _)) => format!("{}…", &collapsed[..cut]),
        None => collapsed,
    })
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
    // Anthropic-style top-level stop reason.
    #[serde(default)]
    stop_reason: Option<Value>,
}

impl ChatResponse {
    fn finish_reason(&self) -> Option<String> {
        finish_reason_of(self.choices.first().and_then(|c| c.finish_reason.as_ref()), self.stop_reason.as_ref())
    }
}

/// OpenAI-style `choices[0].finish_reason`, else Anthropic-style `stop_reason`.
/// A non-string value counts as absent.
fn finish_reason_of(choice_reason: Option<&Value>, stop_reason: Option<&Value>) -> Option<String> {
    choice_reason
        .and_then(Value::as_str)
        .or_else(|| stop_reason.and_then(Value::as_str))
        .map(str::to_string)
}

// Reasoning separation (one gateway, every caller).
//
// Rule: only the final answer leaves this file. Reasoning is dropped at the
// wire boundary; the completion path never even deserializes it, so coach,
// writing evaluation, provider probe and the sidecar `model.invoke` (hence the
// Python runtime) can only ever see clean content. Shapes handled:
//   * separate fields: `reasoning_content` (DeepSeek), `reasoning` and
//     `reasoning_details` (OpenRouter) - ignored, except the echo below;
//   * content blocks: `[{"type":"thinking"|"redacted_thinking"|"reasoning",..},
//     {"type":"text","text":..}]` - only text blocks are kept;
//   * inline `<think>..</think>` / `<thinking>..</thinking>` in content (Qwen/R1
//     style gateways), including an unterminated leading block (output cut off
//     mid-thought: the answer is empty) and a bare `</think>` with no opener
//     (the template put `<think>` in the prompt: everything before it is thought).
// Streaming (`complete_with_trace_streaming`) is the one exception: its deltas
// are raw content, so they are forwarded only while the content opens as JSON
// and carries no reasoning tag (`streamable`). A model whose id may carry inline
// reasoning (`may_carry_inline_reasoning`) is not streamed at all: its deltas
// wait for the completed reply, because a bare `</think>` can arrive after
// answer-shaped reasoning has already been sent. The final answer still comes
// from `strip_inline_reasoning`, never from the deltas.
// Tool intents come ONLY from the structured `tool_calls` field, never from text.
//
// Provider docs consulted 2026-10-05 for the echo rule:
//   DeepSeek   https://api-docs.deepseek.com/guides/thinking_mode
//              With `tools`, the `reasoning_content` of a tool-calling turn MUST
//              be passed back in the later requests of that turn. Without tools
//              it need not be passed back.
//   OpenRouter https://openrouter.ai/docs/use-cases/reasoning-tokens
//              Pass `reasoning_details` (and `reasoning`) of a tool-calling reply
//              back unmodified to keep reasoning continuity. Usage reports
//              `completion_tokens_details.reasoning_tokens`, a share of
//              `completion_tokens`.
//   OpenAI     https://developers.openai.com/api/docs/guides/reasoning
//              Chat Completions returns no reasoning text, so there is nothing to
//              echo (the "pass reasoning items back" rule is Responses API only,
//              which this gateway does not use). Reasoning tokens are in usage.
// So the agent loop keeps the echo fields of a tool-calling reply in memory
// (`ReasoningEcho`: redacted Debug, serde-skipped) for the rest of that single
// run only: never persisted, logged, shown, or sent to Python. A reply without
// tool calls (the final answer) carries no echo.

/// Message content: a plain string, or a list of typed blocks.
#[derive(Deserialize)]
#[serde(untagged)]
enum WireContent {
    Text(String),
    Blocks(Vec<WireBlock>),
}

#[derive(Deserialize)]
struct WireBlock {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    text: Option<String>,
}

impl WireBlock {
    fn is_answer_text(&self) -> bool {
        matches!(self.kind.as_deref(), None | Some("text") | Some("output_text"))
    }
}

impl WireContent {
    fn into_final_answer(self) -> String {
        match self {
            Self::Text(text) => strip_inline_reasoning(&text),
            Self::Blocks(blocks) => strip_inline_reasoning(
                &blocks
                    .into_iter()
                    .filter(WireBlock::is_answer_text)
                    .filter_map(|block| block.text)
                    .collect::<Vec<_>>()
                    .join(""),
            ),
        }
    }
}

const INLINE_REASONING_TAGS: [(&str, bool); 4] = [
    ("<thinking>", true),
    ("<think>", true),
    ("</thinking>", false),
    ("</think>", false),
];

/// Earliest reasoning tag in `text` (ASCII case-insensitive): (start, end, is_open).
fn next_reasoning_tag(text: &str) -> Option<(usize, usize, bool)> {
    let lower = text.to_ascii_lowercase();
    INLINE_REASONING_TAGS
        .iter()
        .filter_map(|(tag, open)| lower.find(tag).map(|start| (start, start + tag.len(), *open)))
        .min_by_key(|(start, _, _)| *start)
}

/// Remove inline `<think>` / `<thinking>` reasoning from `content`, returning the
/// final answer. Content without any such tag is returned unchanged.
fn strip_inline_reasoning(content: &str) -> String {
    if next_reasoning_tag(content).is_none() {
        return content.to_string();
    }
    let (mut answer, mut inside, mut rest) = (String::new(), false, content);
    while let Some((start, end, is_open)) = next_reasoning_tag(rest) {
        if !inside {
            answer.push_str(&rest[..start]);
            if !is_open {
                // A closer with no opener: what we kept so far was the thought.
                answer.clear();
            }
        }
        inside = is_open;
        rest = &rest[end..];
    }
    if !inside {
        answer.push_str(rest);
    }
    answer.trim().to_string()
}

/// Model-id fragments of families whose answers may carry inline reasoning that
/// `strip_inline_reasoning` removes: DeepSeek-R1 and reasoner, QwQ, Qwen3 (hybrid
/// thinking, so every Qwen3 id is listed), GLM-Z1, and any id naming R1, thinking
/// or reasoning. Matched on the lowercased whole id, so a vendor prefix does not
/// hide the family.
const INLINE_REASONING_MODEL_MARKERS: [&str; 8] = [
    "deepseek-r1",
    "deepseek-reasoner",
    "qwq",
    "qwen3",
    "glm-z1",
    "-r1",
    "thinking",
    "reason",
];

/// Whether `model` may answer with inline reasoning, so its streamed deltas must
/// wait for the completed reply. Unknown models stream incrementally: their
/// content is checked as it arrives, and a bare closer that shows up late only
/// ends forwarding (see `StreamFold::append_content`). That cannot retract text
/// already sent, which is why this list stays conservative.
fn may_carry_inline_reasoning(model: &str) -> bool {
    let id = model.to_ascii_lowercase();
    INLINE_REASONING_MODEL_MARKERS.iter().any(|marker| id.contains(marker))
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
    #[serde(default)]
    finish_reason: Option<Value>,
}

#[derive(Deserialize)]
struct Message {
    #[serde(default)]
    content: Option<WireContent>,
}

#[derive(Deserialize)]
struct AgentChatResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    choices: Vec<AgentChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
    #[serde(default)]
    stop_reason: Option<Value>,
}

impl AgentChatResponse {
    fn finish_reason(&self) -> Option<String> {
        finish_reason_of(self.choices.first().and_then(|c| c.finish_reason.as_ref()), self.stop_reason.as_ref())
    }
}

#[derive(Deserialize)]
struct AgentChoice {
    message: AgentResponseMessage,
    #[serde(default)]
    finish_reason: Option<Value>,
}

#[derive(Deserialize)]
struct AgentResponseMessage {
    #[serde(default)]
    content: Option<WireContent>,
    #[serde(default)]
    tool_calls: Vec<WireToolCall>,
    // Echo-only (see the reasoning-separation note above).
    #[serde(default)]
    reasoning_content: Option<Value>,
    #[serde(default)]
    reasoning: Option<Value>,
    #[serde(default)]
    reasoning_details: Option<Value>,
}

impl AgentResponseMessage {
    /// The provider-required echo of a TOOL-CALLING reply; `None` otherwise.
    fn take_reasoning_echo(&mut self) -> Option<ReasoningEcho> {
        if self.tool_calls.is_empty() {
            return None;
        }
        let fields = [
            ("reasoning_content", self.reasoning_content.take()),
            ("reasoning", self.reasoning.take()),
            ("reasoning_details", self.reasoning_details.take()),
        ];
        let echo = ReasoningEcho(
            fields
                .into_iter()
                .filter_map(|(name, value)| Some((name.to_string(), value.filter(|v| !v.is_null())?)))
                .collect(),
        );
        (!echo.is_empty()).then_some(echo)
    }
}

#[derive(Deserialize)]
struct WireToolCall {
    id: String,
    function: WireFunctionCall,
}

#[derive(Deserialize)]
struct WireFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Deserialize)]
struct ChatUsage {
    #[serde(default)]
    prompt_tokens: u64,
    #[serde(default)]
    completion_tokens: u64,
    // `{"reasoning_tokens": n}` (OpenAI, DeepSeek, OpenRouter). Kept as a Value
    // so an odd shape here can never discard the main counts.
    #[serde(default)]
    completion_tokens_details: Option<Value>,
    // OpenAI / OpenRouter: `{"cached_tokens": n}`. Same `Value` rationale.
    #[serde(default)]
    prompt_tokens_details: Option<Value>,
    // DeepSeek reports the cached share at the top level.
    #[serde(default)]
    prompt_cache_hit_tokens: Option<Value>,
    // Anthropic-style gateways: cache reads at the top level.
    #[serde(default)]
    cache_read_input_tokens: Option<Value>,
}

/// Output-limit rules by model-name prefix: (prefix, request field, floor).
/// OpenAI reasoning models (o-series, gpt-5) reject `max_tokens`, expect
/// `max_completion_tokens`, and spend part of it on hidden reasoning, so a short
/// ceiling (the 16-token probe) would come back empty: they get a floor.
/// Every other OpenAI-compatible endpoint (DeepSeek, OpenRouter, gateways) keeps
/// the universally supported `max_tokens` with the ceiling as asked.
const OUTPUT_LIMIT_RULES: &[(&str, &str, u32)] = &[
    ("o1", "max_completion_tokens", 1024),
    ("o3", "max_completion_tokens", 1024),
    ("o4", "max_completion_tokens", 1024),
    ("gpt-5", "max_completion_tokens", 1024),
];

/// The request field and floor of the first rule matching `model`, matched on the
/// name after any `vendor/` routing prefix (e.g. `openai/o3-mini`).
fn output_limit_rule(model: &str) -> Option<(&'static str, u32)> {
    let name = model.rsplit('/').next().unwrap_or(model).to_ascii_lowercase();
    OUTPUT_LIMIT_RULES
        .iter()
        .find(|(prefix, _, _)| name.starts_with(prefix))
        .map(|(_, field, floor)| (*field, *floor))
}

/// `(field, value)` for the output ceiling of `model`.
fn output_limit(model: &str, requested: u32) -> (&'static str, u32) {
    match output_limit_rule(model) {
        Some((field, floor)) => (field, requested.max(floor)),
        None => ("max_tokens", requested),
    }
}

/// The smallest output ceiling `model` is ever sent with: the floor from
/// `OUTPUT_LIMIT_RULES`, or zero when no rule applies. The pre-send guard keeps at
/// least this much room, so a clamp is never raised back past the room left.
pub(crate) fn output_floor(model: &str) -> u32 {
    output_limit_rule(model).map_or(0, |(_, floor)| floor)
}

/// Sampling + output ceiling. The models that need `max_completion_tokens`
/// (o-series, gpt-5) also reject any non-default `temperature` with HTTP 400,
/// so they get none; every other model keeps the requested temperature.
fn apply_output_controls(body: &mut Value, model: &str, temperature: f32, max_tokens: u32) {
    let (field, value) = output_limit(model, max_tokens);
    body[field] = json!(value);
    if field == "max_tokens" {
        body["temperature"] = json!(temperature);
    }
}

/// Prompt-cache routing by endpoint host: (host suffix, request body field that
/// takes the caller's stable cache key). One lookup, no scattered provider ifs;
/// an endpoint that is not listed gets nothing extra. Checked 2026-10-05:
/// - OpenAI https://developers.openai.com/api/docs/guides/prompt-caching
///   documents `prompt_cache_key` ("use a stable prompt_cache_key for requests
///   that share a reusable prefix to help route related requests to the same
///   cache"; optional on GPT-5.6+, where routing is automatic).
/// - OpenRouter https://openrouter.ai/docs/features/prompt-caching documents
///   provider sticky routing keyed by `session_id` (body field or `x-session-id`
///   header, at most 256 characters); without it the key is derived from message
///   hashing. It passes the upstream provider's automatic caching through.
/// - DeepSeek https://api-docs.deepseek.com/guides/kv_cache caches automatically
///   by prefix matching and documents no routing parameter, so it has no row.
const CACHE_ROUTING_RULES: &[(&str, &str)] = &[
    ("api.openai.com", "prompt_cache_key"),
    ("openrouter.ai", "session_id"),
];

/// The body field the endpoint documents for a cache routing key, if any.
fn cache_routing_field(base_url: &str) -> Option<&'static str> {
    let host = base_url.split("://").nth(1).unwrap_or(base_url).split(['/', ':']).next().unwrap_or("");
    let host = host.to_ascii_lowercase();
    CACHE_ROUTING_RULES
        .iter()
        .find(|(suffix, _)| host == *suffix || host.ends_with(&format!(".{suffix}")))
        .map(|(_, field)| *field)
}

/// Writes the caller's stable routing key into the field this endpoint documents.
fn apply_cache_key(body: &mut Value, base_url: &str, cache_key: Option<&str>) {
    if let (Some(key), Some(field)) = (cache_key, cache_routing_field(base_url)) {
        body[field] = json!(key);
    }
}

/// Build the chat-completion body. The output ceiling is mandatory, so every
/// provider request is bounded.
fn completion_body(model: &str, base_url: &str, request: &CompletionRequest) -> Value {
    let mut body = json!({
        "model": model,
        "response_format": { "type": "json_object" },
        "messages": request.messages
    });
    apply_output_controls(&mut body, model, request.temperature, request.max_tokens);
    apply_cache_key(&mut body, base_url, request.cache_key.as_deref());
    body
}

fn agent_request_body(model: &str, base_url: &str, request: &AgentModelRequest) -> Value {
    let messages = request
        .messages
        .iter()
        .map(agent_message_json)
        .collect::<Vec<_>>();
    let tools = request
        .tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    });
    apply_output_controls(&mut body, model, request.temperature, request.max_tokens);
    apply_cache_key(&mut body, base_url, request.cache_key.as_deref());
    body
}

fn agent_message_json(message: &AgentMessage) -> Value {
    match message {
        AgentMessage::System { content } => json!({"role":"system","content":content}),
        AgentMessage::User { content } => json!({"role":"user","content":content}),
        AgentMessage::Assistant {
            content,
            tool_calls,
            reasoning,
        } => {
            let mut message = json!({
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls.iter().map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments_json,
                    }
                })).collect::<Vec<_>>(),
            });
            // Provider-required echo, within this tool loop only.
            for (name, value) in reasoning.iter().flat_map(|echo| echo.0.iter()) {
                message[name] = value.clone();
            }
            message
        }
        AgentMessage::ToolResult {
            tool_call_id,
            content,
            ..
        } => json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        }),
    }
}

fn parse_agent_response(
    envelope: AgentChatResponse,
    fallback_model: &str,
    latency_ms: u64,
    retry_count: u32,
    header_request_id: Option<String>,
) -> Result<AgentModelResponse, AgentModelFailure> {
    let actual_model = envelope.model.unwrap_or_else(|| fallback_model.to_string());
    let usage = envelope.usage.map(token_usage);
    let provider_request_id = prefer_provider_request_id(header_request_id, envelope.id);
    let mut message = envelope
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .ok_or_else(|| {
            AgentModelFailure::with_trace(
                invalid_response("AI agent response contained no choices"),
                Some(actual_model.clone()),
                latency_ms,
                usage.clone(),
                provider_request_id.clone(),
                retry_count,
            )
        })?;
    let reasoning = message.take_reasoning_echo();
    Ok(AgentModelResponse {
        content: message
            .content
            .map(WireContent::into_final_answer)
            .filter(|content| !content.is_empty()),
        tool_calls: message
            .tool_calls
            .into_iter()
            .map(|call| AgentToolCall {
                id: call.id,
                name: call.function.name,
                arguments_json: call.function.arguments,
            })
            .collect(),
        model: actual_model,
        latency_ms,
        usage,
        provider_request_id,
        retry_count,
        reasoning,
    })
}

/// `output_tokens` stays the provider's completion total (it already includes
/// reasoning); `reasoning_tokens` is the reasoning share when reported.
fn token_usage(usage: ChatUsage) -> TokenUsage {
    TokenUsage {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        reasoning_tokens: usage
            .completion_tokens_details
            .as_ref()
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input_tokens: usage
            .prompt_tokens_details
            .as_ref()
            .and_then(|details| details.get("cached_tokens"))
            .or(usage.prompt_cache_hit_tokens.as_ref())
            .or(usage.cache_read_input_tokens.as_ref())
            .and_then(Value::as_u64)
            .unwrap_or(0),
    }
}

impl AiRuntime {
    /// One completion requested as a stream. Content deltas reach `on_delta` as
    /// they arrive; the returned reply is what the plain request would have
    /// returned. A provider that refuses streaming gets the plain request. A
    /// plain JSON answer to a streamed request is read as is, so no call is
    /// billed twice.
    async fn send_completion_streaming(
        &self,
        body: &Value,
        on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<CompletionReply, AgentModelFailure> {
        if self.stream_unsupported.load(Ordering::Relaxed) {
            return self.plain_as_one_delta(body, on_delta).await;
        }
        let mut streamed = body.clone();
        streamed["stream"] = json!(true);
        streamed["stream_options"] = json!({"include_usage": true});
        let started = Instant::now();
        let (mut response, retry_count) = match self.post_streaming(&streamed).await {
            Ok(Some(open)) => open,
            Ok(None) => {
                self.stream_unsupported.store(true, Ordering::Relaxed);
                return self.plain_as_one_delta(body, on_delta).await;
            }
            Err(failure) => return Err(failure.into_trace()),
        };
        let header_request_id = provider_request_id_from_headers(response.headers());
        let fail = |error: ModelError| {
            ChatCompletionFailure::new(error, elapsed_ms(started), retry_count, header_request_id.clone())
                .into_trace()
        };
        if !is_event_stream(&response) {
            let value = response
                .json::<Value>()
                .await
                .map_err(|error| fail(invalid_response(format!("AI response envelope invalid: {error}"))))?;
            let envelope = serde_json::from_value::<ChatResponse>(value)
                .map_err(|_| fail(invalid_response("AI response envelope invalid")))?;
            let reply = self.completion_reply(envelope, elapsed_ms(started), retry_count, header_request_id.clone())?;
            if !reply.response.content.is_empty() && streamable(&reply.response.content) {
                on_delta(&reply.response.content);
            }
            return Ok(reply);
        }
        let mut fold = if may_carry_inline_reasoning(&self.config.model) {
            StreamFold::buffered()
        } else {
            StreamFold::new()
        };
        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    if let Err(message) = fold.push(&bytes, on_delta) {
                        return Err(fail(stream_error(message, false)));
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    return Err(fail(stream_error(format!("AI stream failed: {error}"), error.is_timeout())));
                }
            }
            if fold.done {
                break;
            }
        }
        if let Err(message) = fold.finish(on_delta) {
            return Err(fail(stream_error(message, false)));
        }
        fold.into_reply(&self.config.model, elapsed_ms(started), retry_count, header_request_id)
    }

    /// The plain request, its answer delivered as one delta when it may be shown.
    async fn plain_as_one_delta(
        &self,
        body: &Value,
        on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<CompletionReply, AgentModelFailure> {
        let reply = self.send_completion(body).await?;
        if !reply.response.content.is_empty() && streamable(&reply.response.content) {
            on_delta(&reply.response.content);
        }
        Ok(reply)
    }

    /// The streamed request under the same transport policy as
    /// `post_chat_completion`. `Ok(None)` means this endpoint does not accept
    /// streaming (a 400, 404, 405 or 422 whose body names the stream), so the
    /// caller sends the plain request. Any other failure is a typed error.
    async fn post_streaming(
        &self,
        body: &Value,
    ) -> Result<Option<(reqwest::Response, u32)>, ChatCompletionFailure> {
        let endpoint = format!("{}/chat/completions", self.config.base_url.trim_end_matches('/'));
        let started = Instant::now();
        for attempt in 0..=self.transport_retries {
            let response = self
                .client
                .post(&endpoint)
                .bearer_auth(&self.api_key)
                .json(body)
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    return Ok(Some((response, attempt)));
                }
                Ok(response) => {
                    let status = response.status();
                    let provider_request_id = provider_request_id_from_headers(response.headers());
                    let retryable = status.is_server_error() || status.as_u16() == 429;
                    if retryable && attempt < self.transport_retries {
                        retry_delay(attempt).await;
                        continue;
                    }
                    let body = response.text().await.unwrap_or_default();
                    if stream_refused(status, &body) {
                        return Ok(None);
                    }
                    return Err(ChatCompletionFailure::new(
                        provider_http_error(status, &body, retryable),
                        elapsed_ms(started),
                        attempt,
                        provider_request_id,
                    ));
                }
                Err(error) => {
                    let retryable = error.is_timeout() || error.is_connect();
                    if retryable && attempt < self.transport_retries {
                        retry_delay(attempt).await;
                        continue;
                    }
                    return Err(ChatCompletionFailure::new(
                        transport_error(&error, retryable),
                        elapsed_ms(started),
                        attempt,
                        None,
                    ));
                }
            }
        }
        unreachable!("retry loop always returns")
    }
}

/// Whether a failed streamed request means "this endpoint does not stream":
/// a client-error status whose body names the stream parameter or the stream.
fn stream_refused(status: reqwest::StatusCode, body: &str) -> bool {
    matches!(status.as_u16(), 400 | 404 | 405 | 422) && body.to_ascii_lowercase().contains("stream")
}

fn is_event_stream(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("text/event-stream"))
}

/// Whether content seen so far may be forwarded as it streams. The coach reply
/// is one JSON object, so content that does not open with `{` (an inline
/// reasoning block, say) or that carries a reasoning tag is never forwarded:
/// the call still completes, the answer just arrives in one piece.
fn streamable(content_so_far: &str) -> bool {
    let opens_as_json = content_so_far
        .trim_start()
        .chars()
        .next()
        .map_or(true, |first| first == '{');
    opens_as_json && next_reasoning_tag(content_so_far).is_none()
}

/// Bounds on one streamed reply. A provider that exceeds them is failing, not
/// answering: the call ends with a non-retryable error.
const MAX_STREAM_LINE_BYTES: usize = 1 << 20;
const MAX_STREAM_DATA_BYTES: usize = 1 << 20;
const MAX_STREAM_CONTENT_BYTES: usize = 8 << 20;

/// Longest reasoning tag in bytes (`<thinking>`). A tag can straddle two chunks
/// by at most this much minus one.
const MAX_REASONING_TAG_LEN: usize = 10;

/// Folds the server-sent events of one streamed chat completion into the parts
/// a plain reply carries. Only `delta.content` is answer text; reasoning fields
/// are never read. Lines end in LF, CRLF or a bare CR.
#[derive(Default)]
struct StreamFold {
    /// Bytes of the line being read (UTF-8 is decoded once the line is whole).
    line: Vec<u8>,
    /// The last line ended on a CR, so an LF right after it is the same break.
    skip_lf: bool,
    /// `event:` name of the event being read.
    event: Option<String>,
    /// `data:` payloads of the event being read, and their total size.
    data: Vec<String>,
    data_bytes: usize,
    /// Answer text so far; `None` while no content delta has arrived.
    content: Option<String>,
    /// Bytes of `content` already forwarded to the caller.
    forwarded: usize,
    /// The first non-blank character of the content has been seen.
    opened: bool,
    /// Whether deltas are still forwarded (see [`streamable`]). Latched off for good.
    streaming: bool,
    /// The model may carry inline reasoning: nothing is forwarded until the reply
    /// completes, then the sanitized answer goes out as one delta.
    buffered: bool,
    finish_reason: Option<String>,
    usage: Option<ChatUsage>,
    model: Option<String>,
    id: Option<String>,
    done: bool,
}

impl StreamFold {
    /// Forwards content deltas as they arrive, while [`streamable`] allows.
    fn new() -> Self {
        Self { streaming: true, ..Self::default() }
    }

    /// Forwards nothing until the reply completes, then one sanitized delta.
    fn buffered() -> Self {
        Self { streaming: false, buffered: true, ..Self::default() }
    }

    /// The reply a plain request would have returned for the same stream.
    fn into_reply(
        mut self,
        fallback_model: &str,
        latency_ms: u64,
        retry_count: u32,
        header_request_id: Option<String>,
    ) -> Result<CompletionReply, AgentModelFailure> {
        let usage = self.usage.take().map(token_usage);
        if !self.done && self.finish_reason.is_none() {
            return Err(AgentModelFailure::with_trace(
                stream_error("AI stream ended before the reply completed", true),
                None,
                latency_ms,
                usage,
                prefer_provider_request_id(header_request_id, self.id),
                retry_count,
            ));
        }
        let finish_reason = self.finish_reason.clone();
        let truncated = is_truncated(finish_reason.as_deref());
        let model = self.model.clone().unwrap_or_else(|| fallback_model.to_string());
        let provider_request_id = prefer_provider_request_id(header_request_id, self.id.clone());
        let content = match self.content.take() {
            Some(text) => strip_inline_reasoning(&text),
            // Same rule as the plain path: no text at all is a truncation when
            // the ceiling was hit, and otherwise an envelope without choices.
            None if truncated => String::new(),
            None => {
                return Err(AgentModelFailure::with_trace(
                    invalid_response("AI response contained no choices"),
                    Some(model),
                    latency_ms,
                    usage,
                    provider_request_id,
                    retry_count,
                ));
            }
        };
        Ok(CompletionReply {
            response: CompletionResponse {
                content,
                model,
                latency_ms,
                usage,
                provider_request_id,
            },
            retry_count,
            finish_reason,
        })
    }

    fn push(&mut self, bytes: &[u8], on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        for &byte in bytes {
            if self.done {
                break;
            }
            match byte {
                b'\r' => {
                    self.end_line(on_delta)?;
                    self.skip_lf = true;
                }
                b'\n' => {
                    if !std::mem::take(&mut self.skip_lf) {
                        self.end_line(on_delta)?;
                    }
                }
                _ => {
                    self.skip_lf = false;
                    self.line.push(byte);
                    if self.line.len() > MAX_STREAM_LINE_BYTES {
                        return Err("AI stream line too long".into());
                    }
                }
            }
        }
        Ok(())
    }

    /// Flushes a last line that had no terminator, then the open event, then any
    /// answer text still held back while the stream was undecided.
    fn finish(&mut self, on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        if !self.line.is_empty() {
            self.end_line(on_delta)?;
        }
        self.dispatch(on_delta)?;
        if self.buffered {
            // Only a completed, not cut-off reply is shown, and only its final
            // answer: the same text `into_reply` returns.
            let completed = self.done || self.finish_reason.is_some();
            if completed && !is_truncated(self.finish_reason.as_deref()) {
                let answer = self.content.as_deref().map(strip_inline_reasoning).unwrap_or_default();
                if !answer.is_empty() {
                    on_delta(&answer);
                }
            }
            return Ok(());
        }
        if self.streaming && self.opened {
            if let Some(content) = self.content.as_deref() {
                if self.forwarded < content.len() {
                    on_delta(&content[self.forwarded..]);
                    self.forwarded = content.len();
                }
            }
        }
        Ok(())
    }

    fn end_line(&mut self, on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        let line = std::mem::take(&mut self.line);
        self.line_read(&line, on_delta)
    }

    fn line_read(&mut self, line: &[u8], on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        if line.is_empty() {
            return self.dispatch(on_delta);
        }
        let line = String::from_utf8_lossy(line);
        if let Some(value) = line.strip_prefix("data:") {
            let value = value.strip_prefix(' ').unwrap_or(value);
            self.data_bytes += value.len();
            if self.data_bytes > MAX_STREAM_DATA_BYTES {
                return Err("AI stream event too large".into());
            }
            self.data.push(value.to_string());
        } else if let Some(name) = line.strip_prefix("event:") {
            self.event = Some(name.trim().to_string());
        }
        Ok(())
    }

    /// Applies the event that just ended. Its `event:` name is consumed either way.
    fn dispatch(&mut self, on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        let event = self.event.take();
        if self.data.is_empty() {
            return Ok(());
        }
        let data = std::mem::take(&mut self.data).join("\n");
        self.data_bytes = 0;
        if event.as_deref() == Some("error") {
            return Err(match extract_provider_error_detail(&data) {
                Some(detail) => format!("AI provider stream failed: {detail}"),
                None => "AI provider stream failed".to_string(),
            });
        }
        if data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(&data)
            .map_err(|_| "AI stream chunk invalid".to_string())?;
        if value.get("error").is_some_and(|error| !error.is_null()) {
            return Err(match extract_provider_error_detail(&data) {
                Some(detail) => format!("AI provider stream failed: {detail}"),
                None => "AI provider stream failed".to_string(),
            });
        }
        if self.id.is_none() {
            self.id = value.get("id").and_then(Value::as_str).map(str::to_string);
        }
        if self.model.is_none() {
            self.model = value.get("model").and_then(Value::as_str).map(str::to_string);
        }
        // With include_usage the counts arrive in a final chunk with no choices.
        // A later chunk whose usage does not parse keeps the earlier valid counts.
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            if let Ok(parsed) = serde_json::from_value::<ChatUsage>(usage.clone()) {
                self.usage = Some(parsed);
            }
        }
        let Some(choice) = value.get("choices").and_then(Value::as_array).and_then(|choices| choices.first()) else {
            return Ok(());
        };
        if let Some(text) = choice.pointer("/delta/content").and_then(Value::as_str).filter(|text| !text.is_empty()) {
            self.append_content(text, on_delta)?;
        }
        if let Some(reason) = finish_reason_of(choice.get("finish_reason"), value.get("stop_reason")) {
            self.finish_reason = Some(reason);
        }
        Ok(())
    }

    /// Adds a content delta and forwards the part that is safe to show. The
    /// reply must open as JSON and carry no reasoning tag; the tag check scans
    /// only the new text (plus the few bytes a tag can straddle), and a trailing
    /// partial `<...` is held back until it resolves, so a tag prefix is never
    /// forwarded.
    fn append_content(&mut self, text: &str, on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send)) -> Result<(), String> {
        let content = self.content.get_or_insert_with(String::new);
        let previous_len = content.len();
        if previous_len + text.len() > MAX_STREAM_CONTENT_BYTES {
            return Err("AI stream content too large".into());
        }
        content.push_str(text);
        if !self.streaming {
            return Ok(());
        }
        let content = self.content.as_deref().unwrap_or_default();
        if !self.opened {
            match content.trim_start().chars().next() {
                None => return Ok(()),
                Some(first) => {
                    self.opened = true;
                    if first != '{' {
                        self.streaming = false;
                        return Ok(());
                    }
                }
            }
        }
        let mut scan_from = previous_len.saturating_sub(MAX_REASONING_TAG_LEN - 1);
        while !content.is_char_boundary(scan_from) {
            scan_from -= 1;
        }
        if next_reasoning_tag(&content[scan_from..]).is_some() {
            self.streaming = false;
            return Ok(());
        }
        let safe_end = content.len() - partial_reasoning_tag_len(content);
        if safe_end > self.forwarded {
            on_delta(&content[self.forwarded..safe_end]);
            self.forwarded = safe_end;
        }
        Ok(())
    }
}

/// Bytes at the end of `text` that could still become a reasoning tag: a
/// trailing `<` followed by a prefix of one, compared case-insensitively.
fn partial_reasoning_tag_len(text: &str) -> usize {
    let mut start = text.len().saturating_sub(MAX_REASONING_TAG_LEN - 1);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    let tail = &text[start..];
    let Some(open) = tail.rfind('<') else { return 0 };
    let candidate = tail[open..].to_ascii_lowercase();
    let could_become_tag = INLINE_REASONING_TAGS
        .iter()
        .any(|(tag, _)| tag.len() > candidate.len() && tag.starts_with(candidate.as_str()));
    if could_become_tag { tail.len() - open } else { 0 }
}

async fn retry_delay(attempt: u32) {
    tokio::time::sleep(Duration::from_millis(250 * 2u64.pow(attempt))).await;
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn provider_request_id_from_headers(headers: &reqwest::header::HeaderMap) -> Option<String> {
    ["x-request-id", "request-id", "openai-request-id"]
        .iter()
        .find_map(|name| headers.get(*name))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn prefer_provider_request_id(
    header_request_id: Option<String>,
    body_request_id: Option<String>,
) -> Option<String> {
    header_request_id.or(body_request_id)
}

fn model_error(message: impl Into<String>, retryable: bool) -> ModelError {
    ModelError::new(message, retryable)
}

fn invalid_response(message: impl Into<String>) -> ModelError {
    ModelError::classed(message, false, "invalid_response")
}

fn stream_error(message: impl Into<String>, retryable: bool) -> ModelError {
    ModelError::classed(message, retryable, "stream_error")
}

/// A send that never got an answer: a timeout, or a transport failure.
fn transport_error(error: &reqwest::Error, retryable: bool) -> ModelError {
    let class = if error.is_timeout() { "timeout" } else { "transport" };
    ModelError::classed(format!("AI request failed: {error}"), retryable, class)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    // A real loopback provider: requests pass through reqwest and AiRuntime.
    fn http_fixture(
        responses: Vec<(u16, &'static str, bool)>,
    ) -> (AiRuntime, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for (status, body, with_header) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "fixture request timed out");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 1024];
                loop {
                    let read = stream.read(&mut chunk).unwrap();
                    assert!(read > 0, "request ended before body");
                    request.extend_from_slice(&chunk[..read]);
                    let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") else {
                        continue;
                    };
                    let headers = std::str::from_utf8(&request[..end]).unwrap();
                    assert!(headers.starts_with("POST /chat/completions HTTP/1.1"));
                    let length: usize = headers.lines().find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    }).unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
                thread::sleep(Duration::from_millis(20));
                let header = if with_header { "x-request-id: header-request\r\n" } else { "" };
                write!(stream,
                    "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{header}Connection: close\r\n\r\n{body}",
                    body.len(),
                ).unwrap();
            }
        });
        let runtime = AiRuntime::new(AiProviderConfig {
            provider: "loopback".into(),
            base_url: format!("http://{address}"),
            model: "configured-model".into(),
            secret_name: "fixture".into(),
            timeout: Duration::from_secs(5),
        }, "fixture-key".into()).unwrap();
        (runtime, server)
    }

    fn fixture_completion_request() -> CompletionRequest {
        CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: 100,
            cache_key: None,
        }
    }

    fn fixture_agent_request() -> AgentModelRequest {
        AgentModelRequest {
            messages: vec![AgentMessage::User { content: "hello".into() }],
            tools: vec![],
            temperature: 0.2,
            max_tokens: 100,
            cache_key: None,
        }
    }

    #[test]
    fn http_fixture_reads_delayed_request_fragments() {
        let (runtime, server) = http_fixture(vec![(200, r#"{"choices":[]}"#, false)]);
        let address = runtime.config.base_url.strip_prefix("http://").unwrap();
        let mut client = std::net::TcpStream::connect(address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let body = br#"{"model":"configured-model"}"#;
        client.write_all(b"POST /chat/completions HTTP/1.1\r\nHost: localhost\r\n").unwrap();
        thread::sleep(Duration::from_millis(30));
        write!(client, "Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        client.write_all(&body[..10]).unwrap();
        thread::sleep(Duration::from_millis(30));
        client.write_all(&body[10..]).unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        server.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 Fixture\r\n"));
        assert!(response.ends_with(r#"{"choices":[]}"#));
    }

    #[tokio::test]
    async fn http_decode_failures_preserve_independent_metadata() {
        let cases = [
            (r#"{"id":"body-request","model":"actual-v2","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":123}}]}"#, true, true, true),
            (r#"{"id":"body-request","model":"actual-v2","usage":{"prompt_tokens":10,"completion_tokens":4},"private":"RAW_CONTENT_SENTINEL"}"#, false, true, true),
            (r#"{"id":"body-request","model":"actual-v2","usage":{"prompt_tokens":"RAW_CONTENT_SENTINEL","completion_tokens":4},"choices":[{"message":{"content":"RAW_CONTENT_SENTINEL"}}]}"#, false, true, false),
            ("RAW_CONTENT_SENTINEL is not JSON", true, false, false),
        ];
        for agent in [false, true] {
            for (body, header, model, usage) in cases {
                let (runtime, server) = http_fixture(vec![(200, body, header)]);
                let failure = if agent {
                    runtime.respond(fixture_agent_request()).await.unwrap_err()
                } else {
                    runtime.complete_with_trace(fixture_completion_request()).await.unwrap_err()
                };
                server.join().unwrap();
                assert_eq!(failure.model.as_deref(), model.then_some("actual-v2"));
                assert_eq!(failure.usage, usage.then_some(TokenUsage { input_tokens: 10, output_tokens: 4, reasoning_tokens: 0, ..Default::default() }));
                assert_eq!(failure.provider_request_id.as_deref(),
                    Some(if header { "header-request" } else { "body-request" }));
                assert!(failure.latency_ms >= 20);
                assert_eq!(failure.retry_count, 0);
                assert!(!failure.error.retryable);
                assert!(failure.error.message.contains("response envelope invalid"));
                assert!(!format!("{failure:?}").contains("RAW_CONTENT_SENTINEL"));
            }
        }
    }

    #[tokio::test]
    async fn http_decode_failure_keeps_retry_trace() {
        let (runtime, server) = http_fixture(vec![
            (503, "{}", false),
            (200, r#"{"id":"body-request","model":"actual-v2","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":123}}]}"#, true),
        ]);
        let failure = runtime.complete_with_trace(fixture_completion_request()).await.unwrap_err();
        server.join().unwrap();
        assert_eq!(failure.retry_count, 1);
        assert!(failure.latency_ms >= 250);
        assert_eq!(failure.model.as_deref(), Some("actual-v2"));
        assert_eq!(failure.usage, Some(TokenUsage { input_tokens: 10, output_tokens: 4, reasoning_tokens: 0, ..Default::default() }));
        assert_eq!(failure.provider_request_id.as_deref(), Some("header-request"));
        assert!(!failure.error.retryable);
    }

    #[tokio::test]
    async fn http_valid_completion_and_agent_tool_response_still_succeed() {
        let (runtime, server) = http_fixture(vec![(200,
            r#"{"id":"body-request","model":"actual-v2","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":"ok"}}]}"#, false)]);
        let (response, retries) = runtime.complete_with_trace(fixture_completion_request()).await.unwrap();
        server.join().unwrap();
        assert_eq!(response.content, "ok");
        assert_eq!(response.model, "actual-v2");
        assert_eq!(response.usage.unwrap().input_tokens, 10);
        assert_eq!(response.provider_request_id.as_deref(), Some("body-request"));
        assert_eq!(retries, 0);

        let (runtime, server) = http_fixture(vec![(200,
            r#"{"model":"actual-v2","choices":[{"message":{"content":null,"tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{}"}}]}}]}"#, true)]);
        let response = runtime.respond(fixture_agent_request()).await.unwrap();
        server.join().unwrap();
        assert!(response.content.is_none());
        assert_eq!(response.tool_calls[0].name, "read_file");
        assert_eq!(response.model, "actual-v2");
        assert_eq!(response.provider_request_id.as_deref(), Some("header-request"));
    }

    #[test]
    fn model_error_does_not_expose_credentials() {
        let error = model_error("AI provider returned HTTP 401", false);
        assert_eq!(error.message, "AI provider returned HTTP 401");
    }

    #[test]
    fn completion_body_keeps_json_response_format_and_always_bounds_output() {
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: 2_000,
            cache_key: None,
        };
        // Assert against the production builder, not a hand-rolled copy.
        let body = completion_body("fake-model", "https://example.test/v1", &request);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert!(body.get("tools").is_none());
        assert_eq!(body["max_tokens"], json!(2_000));
        assert!(body.get("max_completion_tokens").is_none());
    }

    #[test]
    fn cache_key_is_sent_only_where_the_endpoint_documents_a_routing_field() {
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: 100,
            cache_key: Some("coach-abc".into()),
        };
        let body = |url: &str| completion_body("m", url, &request);
        assert_eq!(body("https://api.openai.com/v1")["prompt_cache_key"], json!("coach-abc"));
        assert_eq!(body("https://openrouter.ai/api/v1")["session_id"], json!("coach-abc"));
        assert!(body("https://openrouter.ai/api/v1").get("prompt_cache_key").is_none());
        // DeepSeek caches by prefix automatically: nothing extra. Neither do unknown hosts,
        // and a look-alike host does not match.
        for url in ["https://api.deepseek.com/v1", "https://gateway.example/v1", "https://api.openai.com.evil.test/v1", "http://localhost:8080/v1"] {
            let body = body(url);
            assert!(body.get("prompt_cache_key").is_none() && body.get("session_id").is_none(), "{url}");
        }
        // No key, no field, even on a provider that has a rule.
        let plain = CompletionRequest { cache_key: None, ..request.clone() };
        assert!(completion_body("m", "https://api.openai.com/v1", &plain).get("prompt_cache_key").is_none());
    }

    #[test]
    fn cached_input_tokens_are_read_from_every_documented_usage_shape() {
        let usage = |raw: &str| token_usage(serde_json::from_str::<ChatUsage>(raw).unwrap());
        assert_eq!(usage(r#"{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":64}}"#).cached_input_tokens, 64);
        assert_eq!(usage(r#"{"prompt_tokens":100,"completion_tokens":5,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":20}"#).cached_input_tokens, 80);
        let none = usage(r#"{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":"odd"}"#);
        assert_eq!((none.input_tokens, none.cached_input_tokens), (100, 0));
        assert!(!serde_json::to_string(&none).unwrap().contains("cachedInputTokens"));
        let anthropic = usage(r#"{"prompt_tokens":100,"completion_tokens":5,"cache_read_input_tokens":50}"#);
        assert_eq!(anthropic.cached_input_tokens, 50);
    }

    #[test]
    fn reasoning_models_get_no_temperature() {
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: 100,
            cache_key: None,
        };
        for model in ["o1", "o3-mini", "o4-mini", "gpt-5", "gpt-5-mini", "openai/o3"] {
            let body = completion_body(model, "https://api.openai.com/v1", &request);
            assert!(body.get("temperature").is_none(), "{model}");
        }
        for model in ["gpt-4o", "gpt-4.1-mini", "deepseek-chat", "qwen-o3"] {
            let body = completion_body(model, "https://api.openai.com/v1", &request);
            assert!(body.get("temperature").is_some(), "{model}");
        }
    }

    #[test]
    fn reasoning_models_get_max_completion_tokens_with_a_floor() {
        for model in ["o1", "o3-mini", "o4-mini", "gpt-5", "gpt-5-mini", "openai/gpt-5", "openai/O3-mini"] {
            assert_eq!(output_limit(model, 16), ("max_completion_tokens", 1024), "{model}");
            // A ceiling above the floor is kept as asked.
            assert_eq!(output_limit(model, 6_144), ("max_completion_tokens", 6_144), "{model}");
        }
        for model in ["gpt-4o", "gpt-4.1-mini", "deepseek-chat", "deepseek-reasoner", "anthropic/claude-sonnet-4", "configured-model", "omni-moderation"] {
            assert_eq!(output_limit(model, 16), ("max_tokens", 16), "{model}");
        }
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: 16,
            cache_key: None,
        };
        let body = completion_body("gpt-5-mini", "https://api.openai.com/v1", &request);
        assert_eq!(body["max_completion_tokens"], json!(1024));
        assert!(body.get("max_tokens").is_none());
        assert_eq!(completion_body("deepseek-chat", "https://api.deepseek.com/v1", &request)["max_tokens"], json!(16));
    }

    #[test]
    fn agent_body_uses_tool_protocol_without_json_response_format() {
        let request = AgentModelRequest {
            messages: vec![
                AgentMessage::User {
                    content: "read it".into(),
                },
                AgentMessage::ToolResult {
                    tool_call_id: "call-1".into(),
                    content: "ok".into(),
                    is_error: false,
                },
            ],
            tools: vec![ielts_application::AgentToolDefinition {
                name: "read_file".into(),
                description: "Read a file".into(),
                parameters: json!({"type":"object"}),
            }],
            temperature: 0.1,
            max_tokens: 1_500,
            cache_key: None,
        };
        let body = agent_request_body("fake-model", "https://example.test/v1", &request);
        assert!(body.get("response_format").is_none());
        assert_eq!(body["max_tokens"], json!(1_500));
        let reasoning = agent_request_body("o3-mini", "https://example.test/v1", &request);
        assert_eq!(reasoning["max_completion_tokens"], json!(1_500));
        assert!(reasoning.get("max_tokens").is_none());
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["messages"][1]["tool_call_id"], "call-1");
        assert_eq!(body["tools"][0]["function"]["name"], "read_file");
    }

    #[test]
    fn provider_error_bodies_become_a_short_readable_reason() {
        // The OpenAI-compatible shape every supported provider uses.
        assert_eq!(
            extract_provider_error_detail(
                r#"{"error":{"message":"Incorrect API key provided: sk-***","type":"invalid_request_error"}}"#
            )
            .as_deref(),
            Some("Incorrect API key provided: sk-***")
        );
        // A plain-string error field.
        assert_eq!(
            extract_provider_error_detail(r#"{"error":"model not found"}"#).as_deref(),
            Some("model not found")
        );
        // Non-JSON (an HTML error page from a proxy) still yields something.
        assert_eq!(
            extract_provider_error_detail("Bad Gateway").as_deref(),
            Some("Bad Gateway")
        );
        // Multi-line bodies are collapsed so the UI message stays one line.
        assert_eq!(
            extract_provider_error_detail("line one
   line two
").as_deref(),
            Some("line one line two")
        );
        // Nothing to say -> the caller keeps its status-only message.
        assert_eq!(extract_provider_error_detail(""), None);
        assert_eq!(extract_provider_error_detail("   
  "), None);
    }

    #[test]
    fn an_oversized_provider_error_body_is_truncated() {
        let detail = extract_provider_error_detail(&"x".repeat(5_000)).unwrap();
        assert_eq!(detail.chars().count(), MAX_PROVIDER_ERROR_DETAIL + 1);
        assert!(detail.ends_with('…'));
    }

    const COT: &str = "SECRET_CHAIN_OF_THOUGHT";

    /// Final content the completion path hands to every caller for a wire message.
    fn final_content(message: Value) -> Option<String> {
        let envelope: ChatResponse =
            serde_json::from_value(json!({"choices": [{"message": message}]})).unwrap();
        envelope.choices.into_iter().next()?.message.content.map(WireContent::into_final_answer)
    }

    #[test]
    fn completion_content_never_carries_reasoning_in_any_provider_shape() {
        let cases: Vec<(&str, Value, Option<&str>)> = vec![
            ("plain", json!({"content": "the answer"}), Some("the answer")),
            ("plain keeps whitespace", json!({"content": " a \n"}), Some(" a \n")),
            ("null content", json!({"content": null}), None),
            (
                "DeepSeek reasoning_content",
                json!({"content": "ok", "reasoning_content": COT}),
                Some("ok"),
            ),
            (
                "OpenRouter reasoning + reasoning_details",
                json!({"content": "ok", "reasoning": COT,
                       "reasoning_details": [{"type": "reasoning.text", "text": COT}]}),
                Some("ok"),
            ),
            (
                "thinking blocks",
                json!({"content": [
                    {"type": "thinking", "thinking": COT},
                    {"type": "redacted_thinking", "data": COT},
                    {"type": "text", "text": "ok"}
                ]}),
                Some("ok"),
            ),
            (
                "inline <think>",
                json!({"content": format!("<think>{COT}</think>\n\nok")}),
                Some("ok"),
            ),
            (
                "inline <thinking> upper case",
                json!({"content": format!("<THINKING>{COT}</THINKING>ok")}),
                Some("ok"),
            ),
            (
                "several blocks",
                json!({"content": format!("<think>{COT}</think>a<think>{COT}</think>b")}),
                Some("ab"),
            ),
            (
                "unterminated leading block is all thought",
                json!({"content": format!("<think>{COT} and then the budget ran out")}),
                Some(""),
            ),
            (
                "closer without opener drops what came before",
                json!({"content": format!("{COT}</think>\nok")}),
                Some("ok"),
            ),
            (
                "inline think inside a text block",
                json!({"content": [{"type": "text", "text": format!("<think>{COT}</think>ok")}]}),
                Some("ok"),
            ),
        ];
        for (name, message, expected) in cases {
            let actual = final_content(message);
            assert_eq!(actual.as_deref(), expected, "{name}");
            assert!(!actual.unwrap_or_default().contains(COT), "{name} leaked reasoning");
        }
    }

    #[test]
    fn a_non_text_content_shape_is_still_an_invalid_envelope() {
        let invalid: Result<ChatResponse, _> =
            serde_json::from_value(json!({"choices": [{"message": {"content": 123}}]}));
        assert!(invalid.is_err());
    }

    #[test]
    fn usage_reports_the_reasoning_share_without_changing_the_totals() {
        for (usage, expected) in [
            (json!({"prompt_tokens": 10, "completion_tokens": 40,
                    "completion_tokens_details": {"reasoning_tokens": 30}}), 30),
            (json!({"prompt_tokens": 10, "completion_tokens": 40}), 0),
            (json!({"prompt_tokens": 10, "completion_tokens": 40,
                    "completion_tokens_details": "unexpected"}), 0),
        ] {
            let usage = token_usage(serde_json::from_value::<ChatUsage>(usage).unwrap());
            assert_eq!((usage.input_tokens, usage.output_tokens), (10, 40));
            assert_eq!(usage.reasoning_tokens, expected);
        }
    }

    #[tokio::test]
    async fn gateway_returns_clean_content_and_reasoning_token_usage() {
        let body = format!(
            r#"{{"model":"deepseek-reasoner","usage":{{"prompt_tokens":10,"completion_tokens":40,"completion_tokens_details":{{"reasoning_tokens":30}}}},"choices":[{{"message":{{"content":"<think>{COT}</think>{{\"ok\":true}}","reasoning_content":"{COT}"}}}}]}}"#
        );
        let body: &'static str = Box::leak(body.into_boxed_str());
        let (runtime, server) = http_fixture(vec![(200, body, false)]);
        let (response, _) = runtime.complete_with_trace(fixture_completion_request()).await.unwrap();
        server.join().unwrap();
        assert_eq!(response.content, r#"{"ok":true}"#);
        assert_eq!(response.usage.as_ref().unwrap().reasoning_tokens, 30);
        assert!(!serde_json::to_string(&response).unwrap().contains(COT));
    }

    fn agent_response(message: Value) -> AgentModelResponse {
        let envelope: AgentChatResponse =
            serde_json::from_value(json!({"choices": [{"message": message}]})).unwrap();
        parse_agent_response(envelope, "m", 1, 0, None).unwrap()
    }

    fn tool_call_wire() -> Value {
        json!([{"id": "call-1", "type": "function",
                "function": {"name": "read_file", "arguments": "{}"}}])
    }

    #[test]
    fn tool_intents_come_only_from_structured_tool_calls() {
        // A tool call written in prose, or smuggled into reasoning, is not a call.
        let fake = r#"{"name":"read_file","arguments":{"path":"/etc/passwd"}}"#;
        let response = agent_response(json!({
            "content": format!("<think>I should call {fake}</think>done"),
            "reasoning_content": format!("call {fake}"),
        }));
        assert!(response.tool_calls.is_empty());
        assert_eq!(response.content.as_deref(), Some("done"));
        assert!(response.reasoning.is_none(), "a final answer carries no echo");

        let response = agent_response(json!({"content": null, "tool_calls": tool_call_wire()}));
        assert_eq!(response.tool_calls.len(), 1);
        assert!(response.reasoning.is_none(), "no provider reasoning, nothing to echo");
    }

    #[test]
    fn tool_calling_replies_keep_provider_reasoning_for_in_loop_echo_only() {
        for (name, extra, echoed) in [
            ("DeepSeek", json!({"reasoning_content": COT}), "reasoning_content"),
            ("OpenRouter", json!({"reasoning_details": [{"type": "reasoning.text", "text": COT}]}),
                "reasoning_details"),
        ] {
            let mut message = json!({"content": null, "tool_calls": tool_call_wire()});
            message.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            let response = agent_response(message);
            let echo = response.reasoning.clone().unwrap_or_else(|| panic!("{name}: echo missing"));
            assert!(echo.0.contains_key(echoed), "{name}");
            // Never serializable or debug-printable, so it cannot be persisted or logged.
            assert!(!serde_json::to_string(&response).unwrap().contains(COT), "{name}");
            assert!(!format!("{response:?}").contains(COT), "{name}");

            let request = AgentModelRequest {
                messages: vec![
                    AgentMessage::User { content: "go".into() },
                    AgentMessage::Assistant {
                        content: response.content.clone(),
                        tool_calls: response.tool_calls.clone(),
                        reasoning: response.reasoning.clone(),
                    },
                    AgentMessage::ToolResult {
                        tool_call_id: "call-1".into(), content: "ok".into(), is_error: false,
                    },
                ],
                tools: vec![],
                temperature: 0.0,
                max_tokens: 16,
                cache_key: None,
            };
            let body = agent_request_body("deepseek-reasoner", "https://example.test/v1", &request);
            assert!(body["messages"][1][echoed].to_string().contains(COT), "{name} must echo in-turn");
            assert_eq!(body["messages"][1]["tool_calls"][0]["id"], "call-1");
            // The output ceiling rule is untouched by the echo.
            assert_eq!(body["max_tokens"], json!(16));
            assert_eq!(agent_request_body("gpt-5", "https://example.test/v1", &request)["max_completion_tokens"], json!(1024));

            // The same turn without an echo (a final answer, or a provider that
            // sent none) serializes no reasoning field at all.
            let mut stripped = request.clone();
            if let AgentMessage::Assistant { reasoning, .. } = &mut stripped.messages[1] {
                *reasoning = None;
            }
            let body = agent_request_body("deepseek-reasoner", "https://example.test/v1", &stripped);
            for field in ["reasoning_content", "reasoning", "reasoning_details"] {
                assert!(body["messages"][1].get(field).is_none(), "{name}: {field}");
            }
            assert!(!body.to_string().contains(COT), "{name}");
        }
    }

    #[tokio::test]
    async fn zero_transport_retries_make_a_single_provider_attempt() {
        let (runtime, server) = http_fixture(vec![(503, "{}", false)]);
        let runtime = runtime.with_transport_retries(0);
        let failure = runtime.complete_with_trace(fixture_completion_request()).await.unwrap_err();
        server.join().unwrap();
        assert_eq!(failure.retry_count, 0);
        assert!(failure.error.retryable, "still reported retryable to the caller that owns retry");
    }

    #[test]
    fn parses_null_content_and_multiple_tool_calls() {
        let envelope: AgentChatResponse = serde_json::from_value(json!({
            "id":"request-1",
            "model":"provider-model",
            "choices":[{"message":{
                "content":null,
                "tool_calls":[
                    {"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"a.txt\"}"}},
                    {"id":"call-2","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"b.txt\"}"}}
                ]
            }}],
            "usage":{"prompt_tokens":3,"completion_tokens":4}
        }))
        .unwrap();
        let response = parse_agent_response(envelope, "fallback", 5, 2, None).unwrap();
        assert!(response.content.is_none());
        assert_eq!(response.tool_calls.len(), 2);
        assert_eq!(response.tool_calls[1].name, "read_file");
        assert_eq!(response.model, "provider-model");
        assert_eq!(response.retry_count, 2);
        assert_eq!(response.usage.unwrap().output_tokens, 4);
    }

    #[test]
    fn rejects_agent_response_without_choices() {
        let envelope: AgentChatResponse = serde_json::from_value(json!({
            "choices":[]
        }))
        .unwrap();
        let error = parse_agent_response(envelope, "fallback", 7, 2, Some("header-request".into()))
            .unwrap_err();
        assert!(error.error.message.contains("no choices"));
        assert_eq!(error.model.as_deref(), Some("fallback"));
        assert_eq!(error.latency_ms, 7);
        assert_eq!(error.retry_count, 2);
        assert_eq!(error.provider_request_id.as_deref(), Some("header-request"));
    }

    #[test]
    fn provider_request_header_takes_precedence_over_body_completion_id() {
        assert_eq!(
            prefer_provider_request_id(
                Some("provider-request".into()),
                Some("chatcmpl-body-id".into())
            )
            .as_deref(),
            Some("provider-request")
        );
    }

    #[test]
    fn ledger_usage_keeps_each_provider_cache_and_reasoning_shape() {
        let ledger_usage = |raw: Value| {
            let usage = token_usage(serde_json::from_value::<ChatUsage>(raw).unwrap());
            provider_usage_json(&usage)
        };
        let openai = ledger_usage(json!({"prompt_tokens": 100, "completion_tokens": 40,
            "prompt_tokens_details": {"cached_tokens": 64},
            "completion_tokens_details": {"reasoning_tokens": 30}}));
        assert_eq!(openai, json!({"promptTokens": 100, "completionTokens": 40, "totalTokens": 140,
            "cachedInputTokens": 64, "reasoningTokens": 30}));
        let deepseek = ledger_usage(json!({"prompt_tokens": 100, "completion_tokens": 5,
            "prompt_cache_hit_tokens": 80, "prompt_cache_miss_tokens": 20}));
        assert_eq!(deepseek["cachedInputTokens"], json!(80));
        assert!(deepseek.get("reasoningTokens").is_none());
        let anthropic = ledger_usage(json!({"prompt_tokens": 100, "completion_tokens": 5,
            "cache_read_input_tokens": 50}));
        assert_eq!(anthropic["cachedInputTokens"], json!(50));
        assert!(anthropic.get("estimated").is_none());
    }

    #[test]
    fn ledger_estimates_only_a_successful_call_without_provider_usage() {
        let request = json!({"model": "m", "messages": [{"role": "user", "content": "x".repeat(400)}]});
        let estimate = estimated_usage_json(&request, &"y".repeat(40));
        assert_eq!(estimate["estimated"], json!(true));
        assert_eq!(estimate["promptTokens"], json!(u64::from(estimate_tokens(&request.to_string()))));
        assert_eq!(estimate["completionTokens"], json!(10));
        assert_eq!(estimate["totalTokens"], json!(estimate["promptTokens"].as_u64().unwrap() + 10));

        let error = model_error("boom", true);
        let failed = LedgerCall {
            model: "m",
            latency_ms: 3,
            usage: None,
            provider_request_id: None,
            outcome: Err(&error),
            finish_reason: None,
            admission: Admission::default(),
        };
        let row = ledger_record("p", &request, failed);
        assert_eq!(row.usage_json, None);
        assert_eq!(row.response_hash, None);
        assert_eq!(row.request_hash, UNLINKED_REQUEST_HASH, "a ledger row stores no content hash");
        let error: Value = serde_json::from_str(&row.error_json.unwrap()).unwrap();
        assert_eq!(error, json!({"status": null, "class": "provider_error", "retryable": true}));
    }

    #[tokio::test]
    async fn gateway_ledgers_each_plain_call_once_and_not_the_traced_coach_call() {
        use std::sync::Mutex;
        let rows = Arc::new(Mutex::new(Vec::<ielts_db::LlmInvocationRecord>::new()));
        let sink_rows = Arc::clone(&rows);
        let sink: LedgerSink = Arc::new(move |row| sink_rows.lock().unwrap().push(row));
        let (runtime, server) = http_fixture(vec![
            (200, r#"{"id":"traced","model":"actual-v2","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#, false),
            (200, r#"{"id":"plain-request","model":"actual-v2","usage":{"prompt_tokens":100,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":60},"completion_tokens_details":{"reasoning_tokens":2}},"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#, false),
            (200, r#"{"id":"agent-request","model":"actual-v2","choices":[{"message":{"content":"{\"ok\":true}"}}]}"#, false),
            (401, r#"{"error":{"message":"bad key"}}"#, false),
        ]);
        let runtime = runtime.with_ledger(sink);

        runtime.complete_with_trace(fixture_completion_request()).await.unwrap();
        assert!(rows.lock().unwrap().is_empty(), "the coach trace owns its own row");

        runtime.complete(fixture_completion_request()).await.unwrap();
        runtime.respond(fixture_agent_request()).await.unwrap();
        runtime.complete(fixture_completion_request()).await.unwrap_err();
        server.join().unwrap();

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 3, "one row per plain or agent call");
        let plain: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(plain["promptTokens"], json!(100));
        assert_eq!(plain["cachedInputTokens"], json!(60));
        assert_eq!(plain["reasoningTokens"], json!(2));
        assert_eq!(rows[0].provider_request_id.as_deref(), Some("plain-request"));
        assert_eq!(rows[0].model, "actual-v2");
        assert!(rows[0].error_json.is_none() && rows[0].response_hash.is_none());
        assert_eq!(rows[0].request_hash, UNLINKED_REQUEST_HASH);
        let agent: Value = serde_json::from_str(rows[1].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(agent["estimated"], json!(true));
        assert!(rows[2].usage_json.is_none() && rows[2].response_hash.is_none());
        // The provider's own words and any URL stay out of the ledger: status and class only.
        let error = rows[2].error_json.as_deref().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(error).unwrap(),
            json!({"status": 401, "class": "http_4xx", "retryable": false})
        );
        assert!(!error.contains("bad key") && !error.contains("https://"));
        assert_ne!(rows[0].id, rows[1].id);
    }


    #[test]
    fn provider_counts_are_bounded_at_write_time_and_never_overflow() {
        let usage = TokenUsage {
            input_tokens: u64::MAX,
            output_tokens: u64::MAX,
            reasoning_tokens: u64::MAX,
            cached_input_tokens: u64::MAX,
        };
        let value = provider_usage_json(&usage);
        assert_eq!(value["promptTokens"], json!(MAX_USAGE_COUNT));
        assert_eq!(value["completionTokens"], json!(MAX_USAGE_COUNT));
        assert_eq!(value["totalTokens"], json!(MAX_USAGE_COUNT * 2));
        assert_eq!(value["cachedInputTokens"], json!(MAX_USAGE_COUNT));
        assert_eq!(value["reasoningTokens"], json!(MAX_USAGE_COUNT));
        assert!(MAX_USAGE_COUNT <= i64::MAX as u64 / 4);
    }

    #[test]
    fn finish_reason_is_read_from_the_openai_or_anthropic_shape() {
        let reason = |raw: Value| serde_json::from_value::<ChatResponse>(raw).unwrap().finish_reason();
        let choice = |finish: Value| json!({"choices":[{"message":{"content":"x"}, "finish_reason": finish}]});
        assert_eq!(reason(choice(json!("length"))).as_deref(), Some("length"));
        assert_eq!(reason(choice(json!("stop"))).as_deref(), Some("stop"));
        assert_eq!(reason(json!({"choices":[{"message":{"content":"x"}}]})), None);
        // A non-string value is treated as absent, never as an envelope error.
        assert_eq!(reason(choice(json!(5))), None);
        assert_eq!(
            reason(json!({"stop_reason":"max_tokens","choices":[{"message":{"content":"x"}}]})).as_deref(),
            Some("max_tokens"),
        );
        assert!(is_truncated(Some("length")) && is_truncated(Some("max_tokens")));
        assert!(!is_truncated(Some("stop")) && !is_truncated(Some("tool_calls")) && !is_truncated(None));
    }

    #[tokio::test]
    async fn truncated_replies_are_typed_errors_and_ledgered_with_their_finish_reason() {
        use std::sync::Mutex;
        let rows = Arc::new(Mutex::new(Vec::<ielts_db::LlmInvocationRecord>::new()));
        let sink_rows = Arc::clone(&rows);
        let sink: LedgerSink = Arc::new(move |row| sink_rows.lock().unwrap().push(row));
        let (runtime, server) = http_fixture(vec![
            // 1. plain call cut off at the ceiling: typed error, not content.
            (200, r#"{"id":"cut","model":"m","usage":{"prompt_tokens":12,"completion_tokens":2000},"choices":[{"message":{"content":"{\"ok\":"},"finish_reason":"length"}]}"#, false),
            // 2. ordinary stop: content, finishReason stop.
            (200, r#"{"id":"stop","model":"m","usage":{"prompt_tokens":5,"completion_tokens":3},"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#, false),
            // 3. no finish reason at all: content, and the ledger says nothing about it.
            (200, r#"{"id":"missing","model":"m","usage":{"prompt_tokens":5,"completion_tokens":3},"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#, false),
            // 4. agent reply with an Anthropic-style top-level stop_reason: content kept, reason ledgered.
            (200, r#"{"id":"agent","model":"m","usage":{"prompt_tokens":5,"completion_tokens":3},"stop_reason":"max_tokens","choices":[{"message":{"content":"partial answer"}}]}"#, false),
            // 5. traced coach call cut off: typed error, no ledger row of its own.
            (200, r#"{"id":"traced","model":"m","choices":[{"message":{"content":null},"finish_reason":"length"}]}"#, false),
        ]);
        let runtime = runtime.with_ledger(sink);

        let error = runtime.complete(fixture_completion_request()).await.unwrap_err();
        assert_eq!(error.message, "model output truncated at max_tokens");
        assert!(error.truncated && !error.retryable);
        assert_eq!(runtime.complete(fixture_completion_request()).await.unwrap().content, r#"{"ok":true}"#);
        runtime.complete(fixture_completion_request()).await.unwrap();
        // 4. an agent round cut off at the ceiling is a typed error, never a partial answer.
        let agent = runtime.respond(fixture_agent_request()).await.unwrap_err();
        assert!(agent.error.truncated && !agent.error.retryable);
        let traced = runtime.complete_with_trace(fixture_completion_request()).await.unwrap_err();
        assert!(traced.error.truncated);
        server.join().unwrap();

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 4, "the traced coach call is not ledgered here");
        let usage = |row: &ielts_db::LlmInvocationRecord| -> Value {
            serde_json::from_str(row.usage_json.as_deref().unwrap()).unwrap()
        };
        assert_eq!(usage(&rows[0])["finishReason"], json!("length"));
        assert_eq!(usage(&rows[0])["completionTokens"], json!(2000));
        assert!(rows[0].response_hash.is_none());
        let error: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(error, json!({"status": null, "class": "truncated", "retryable": false}));
        assert_eq!(usage(&rows[1])["finishReason"], json!("stop"));
        assert!(rows[1].response_hash.is_none() && rows[1].error_json.is_none());
        assert!(usage(&rows[2]).get("finishReason").is_none());
        assert_eq!(usage(&rows[2])["promptTokens"], json!(5));
        assert_eq!(usage(&rows[3])["finishReason"], json!("max_tokens"));
        let agent_error: Value = serde_json::from_str(rows[3].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(agent_error, json!({"status": null, "class": "truncated", "retryable": false}));
        assert!(rows[3].response_hash.is_none());
    }

    #[tokio::test]
    async fn a_truncated_agent_text_reply_fails_the_round_with_a_failed_ledger_row() {
        let reply = r#"{"id":"cut-agent","model":"m","usage":{"prompt_tokens":12,"completion_tokens":2000},"choices":[{"message":{"content":"The answer is hal"},"finish_reason":"length"}]}"#;
        let (runtime, server) = scripted_fixture(vec![(200, "application/json", reply)]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        let failure = runtime.respond(fixture_agent_request()).await.unwrap_err();
        let bodies = server.join().unwrap();
        assert_eq!(bodies.len(), 1, "a truncated round is never retried");
        assert!(failure.error.truncated && !failure.error.retryable);
        assert_eq!(failure.error.class, "truncated");
        assert_eq!(failure.model.as_deref(), Some("m"), "the trace still names the served model");
        assert_eq!(failure.usage.as_ref().map(|usage| usage.output_tokens), Some(2_000));

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider_request_id.as_deref(), Some("cut-agent"));
        let usage: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["finishReason"], json!("length"));
        assert_eq!(usage["completionTokens"], json!(2000));
        let error: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(error, json!({"status": null, "class": "truncated", "retryable": false}));
        assert!(rows[0].response_hash.is_none());
    }

    #[tokio::test]
    async fn a_truncated_agent_tool_call_is_never_returned_with_its_arguments() {
        // The arguments cut off mid-object: returning this as a tool call would
        // hand the agent service half a call.
        let reply = r#"{"id":"cut-tool","model":"m","usage":{"prompt_tokens":12,"completion_tokens":2000},"choices":[{"message":{"content":null,"tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{\"path\":\"/tm"}}]},"finish_reason":"length"}]}"#;
        let (runtime, server) = scripted_fixture(vec![(200, "application/json", reply)]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        let failure = runtime.respond(fixture_agent_request()).await.unwrap_err();
        server.join().unwrap();
        assert!(failure.error.truncated && !failure.error.retryable);

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 1);
        let error: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(error, json!({"status": null, "class": "truncated", "retryable": false}));
        let usage: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["finishReason"], json!("length"));
    }

    #[tokio::test]
    async fn a_normal_stop_agent_reply_with_a_tool_call_is_unchanged() {
        let reply = r#"{"id":"stop-tool","model":"m","usage":{"prompt_tokens":12,"completion_tokens":20},"choices":[{"message":{"content":null,"tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{\"path\":\"/tmp/a\"}"}}]},"finish_reason":"tool_calls"}]}"#;
        let stop = r#"{"id":"stop-text","model":"m","usage":{"prompt_tokens":5,"completion_tokens":3},"choices":[{"message":{"content":"Done."},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture(vec![
            (200, "application/json", reply),
            (200, "application/json", stop),
        ]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        let tool_round = runtime.respond(fixture_agent_request()).await.unwrap();
        let text_round = runtime.respond(fixture_agent_request()).await.unwrap();
        server.join().unwrap();
        assert_eq!(tool_round.tool_calls.len(), 1);
        assert_eq!(tool_round.tool_calls[0].name, "read_file");
        assert_eq!(tool_round.tool_calls[0].arguments_json, r#"{"path":"/tmp/a"}"#);
        assert_eq!(text_round.content.as_deref(), Some("Done."));

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2);
        for row in rows.iter() {
            assert!(row.error_json.is_none(), "a stop reply is a success row");
        }
        let usage: Value = serde_json::from_str(rows[1].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["finishReason"], json!("stop"));
    }

    #[tokio::test]
    async fn a_truncated_sidecar_completion_returns_the_partial_text_and_truncated_true() {
        let (runtime, server) = http_fixture(vec![(
            200,
            r#"{"id":"cut","model":"m","usage":{"prompt_tokens":12,"completion_tokens":2000},"choices":[{"message":{"content":"{\"digest\":"},"finish_reason":"length"}]}"#,
            false,
        )]);
        let completion = runtime.complete_partial(fixture_completion_request()).await.unwrap();
        server.join().unwrap();
        assert!(completion.truncated);
        assert_eq!(completion.response.content, r#"{"digest":"#);
    }

    #[test]
    fn finish_reason_lands_in_ledger_usage_even_without_provider_counts() {
        let request = json!({"model": "m", "messages": []});
        let row = ledger_record("p", &request, LedgerCall {
            model: "m",
            latency_ms: 1,
            usage: None,
            provider_request_id: None,
            outcome: Ok("text"),
            finish_reason: Some("stop"),
            admission: Admission::default(),
        });
        let usage: Value = serde_json::from_str(row.usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["finishReason"], json!("stop"));
        assert_eq!(usage["estimated"], json!(true));
    }

    #[test]
    fn agent_body_carries_the_cache_key_only_where_documented() {
        let request = |system: &str, user: &str| AgentModelRequest {
            messages: vec![
                AgentMessage::System { content: system.into() },
                AgentMessage::User { content: user.into() },
            ],
            tools: vec![],
            temperature: 0.1,
            max_tokens: 1_500,
            cache_key: Some(ielts_application::prompt_cache_key("agent-workspace", system)),
        };
        let first = agent_request_body("m", "https://api.openai.com/v1", &request("sys", "one"));
        let second = agent_request_body("m", "https://api.openai.com/v1", &request("sys", "two"));
        let other = agent_request_body("m", "https://api.openai.com/v1", &request("sys 2", "one"));
        assert!(first["prompt_cache_key"].is_string());
        assert_eq!(first["prompt_cache_key"], second["prompt_cache_key"]);
        assert_ne!(first["prompt_cache_key"], other["prompt_cache_key"]);
        assert_eq!(
            agent_request_body("m", "https://openrouter.ai/api/v1", &request("sys", "one"))["session_id"],
            first["prompt_cache_key"],
        );
        let plain = AgentModelRequest { cache_key: None, ..request("sys", "one") };
        assert!(agent_request_body("m", "https://api.openai.com/v1", &plain).get("prompt_cache_key").is_none());
    }


    /// One `data:` event per payload, the way a streaming provider writes them.
    fn sse(events: &[&str]) -> String {
        events.iter().map(|event| format!("data: {event}\n\n")).collect()
    }

    /// Runs the fold over `chunks`, returning the forwarded deltas and the reply.
    fn fold_stream(chunks: &[&[u8]]) -> (Vec<String>, Result<CompletionReply, AgentModelFailure>) {
        fold_stream_with(StreamFold::new(), chunks)
    }

    /// As `fold_stream`, with the fold the runtime would pick for `model`.
    fn fold_stream_for(model: &str, chunks: &[&[u8]]) -> (Vec<String>, Result<CompletionReply, AgentModelFailure>) {
        let fold = if may_carry_inline_reasoning(model) { StreamFold::buffered() } else { StreamFold::new() };
        fold_stream_with(fold, chunks)
    }

    fn fold_stream_with(
        mut fold: StreamFold,
        chunks: &[&[u8]],
    ) -> (Vec<String>, Result<CompletionReply, AgentModelFailure>) {
        let mut deltas = Vec::new();
        let reply = {
            let mut sink = |delta: &str| deltas.push(delta.to_owned());
            for chunk in chunks {
                fold.push(chunk, &mut sink).unwrap();
            }
            fold.finish(&mut sink).unwrap();
            fold.into_reply("configured-model", 7, 0, None)
        };
        (deltas, reply)
    }

    const CONTENT_EVENTS: [&str; 6] = [
        r#"{"id":"chatcmpl-1","model":"served-model","choices":[{"index":0,"delta":{"role":"assistant","content":"{\"ans"},"finish_reason":null}]}"#,
        r#"{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"wer\":\"Hi 你"},"finish_reason":null}]}"#,
        r#"{"choices":[{"index":0,"delta":{"content":"好\"}"},"finish_reason":null}]}"#,
        r#"{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#,
        r#"{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14,"prompt_tokens_details":{"cached_tokens":2}}}"#,
        "[DONE]",
    ];

    #[test]
    fn sse_content_deltas_arrive_in_order_and_fold_to_the_plain_reply() {
        let body = sse(&CONTENT_EVENTS);
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        let reply = reply.unwrap();
        assert_eq!(deltas, [r#"{"ans"#, "wer\":\"Hi 你", "好\"}"]);
        assert_eq!(reply.response.content, deltas.concat());
        assert_eq!(reply.response.model, "served-model");
        assert_eq!(reply.response.provider_request_id.as_deref(), Some("chatcmpl-1"));
        assert_eq!(reply.finish_reason.as_deref(), Some("stop"));
        let usage = reply.response.usage.unwrap();
        assert_eq!((usage.input_tokens, usage.output_tokens, usage.cached_input_tokens), (10, 4, 2));
    }

    #[test]
    fn sse_folds_the_same_however_the_bytes_are_split() {
        let body = sse(&CONTENT_EVENTS);
        let bytes = body.as_bytes();
        let (whole_deltas, whole) = fold_stream(&[bytes]);
        let byte_chunks: Vec<&[u8]> = bytes.chunks(1).collect();
        let (split_deltas, split) = fold_stream(&byte_chunks);
        assert_eq!(split_deltas.concat(), whole_deltas.concat());
        assert_eq!(split.unwrap().response.content, whole.unwrap().response.content);
    }

    #[test]
    fn sse_comments_crlf_line_endings_and_data_after_done_are_handled() {
        let body = format!(
            ": keep-alive\r\n\r\ndata: {}\r\n\r\ndata: [DONE]\r\n\r\ndata: {}\r\n\r\ndata: {}\r\n\r\n",
            r#"{"choices":[{"delta":{"content":"{\"answer\":\"ok\"}"},"finish_reason":"stop"}]}"#,
            r#"{"choices":[{"delta":{"content":" late"}}]}"#,
            r#"{"choices":[{"delta":{"content":" later"}}]}"#,
        );
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        assert_eq!(deltas, [r#"{"answer":"ok"}"#]);
        assert_eq!(reply.unwrap().response.content, r#"{"answer":"ok"}"#);
    }

    #[test]
    fn reasoning_fields_are_never_forwarded_or_kept() {
        let body = sse(&[
            r#"{"choices":[{"delta":{"reasoning_content":"private plan"}}]}"#,
            r#"{"choices":[{"delta":{"reasoning":"more plan"}}]}"#,
            r#"{"choices":[{"delta":{"content":"{\"answer\":\"A\"}"},"finish_reason":"stop"}]}"#,
            "[DONE]",
        ]);
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        assert_eq!(deltas, [r#"{"answer":"A"}"#]);
        let content = reply.unwrap().response.content;
        assert_eq!(content, r#"{"answer":"A"}"#);
        assert!(!content.contains("private plan"));
    }

    #[test]
    fn inline_reasoning_is_stripped_from_the_answer_and_never_streamed() {
        // Reasoning before the JSON: nothing is forwarded, the final answer is clean.
        let body = sse(&[
            r#"{"choices":[{"delta":{"content":"<think>plan {\"answer\":\"no\"}"}}]}"#,
            r#"{"choices":[{"delta":{"content":"</think>{\"answer\":\"yes\"}"},"finish_reason":"stop"}]}"#,
            "[DONE]",
        ]);
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        assert!(deltas.is_empty(), "reasoning must not stream: {deltas:?}");
        assert_eq!(reply.unwrap().response.content, r#"{"answer":"yes"}"#);
    }

    #[test]
    fn an_answer_shaped_reasoning_prefix_is_never_streamed_on_a_reasoning_model() {
        // The prefix opens as JSON and has no tag, so an incremental fold would
        // forward it before the bare closer arrives. A buffered fold must not.
        let body = sse(&[
            r#"{"choices":[{"delta":{"content":"{\"answer\":\"PRIVATE PLAN\"}"}}]}"#,
            r#"{"choices":[{"delta":{"content":"</think>{\"answer\":\"Final answer\"}"},"finish_reason":"stop"}]}"#,
            "[DONE]",
        ]);
        let (deltas, reply) = fold_stream_for("deepseek-r1", &[body.as_bytes()]);
        assert_eq!(deltas, [r#"{"answer":"Final answer"}"#], "only the sanitized answer may be shown");
        assert!(deltas.iter().all(|delta| !delta.contains("PRIVATE")));
        assert_eq!(reply.unwrap().response.content, r#"{"answer":"Final answer"}"#);
    }

    #[test]
    fn a_buffered_stream_that_is_cut_off_or_incomplete_shows_nothing() {
        let truncated = sse(&[
            r#"{"choices":[{"delta":{"content":"{\"answer\":\"Half"},"finish_reason":"length"}]}"#,
            "[DONE]",
        ]);
        let (deltas, reply) = fold_stream_for("qwq-32b", &[truncated.as_bytes()]);
        assert!(deltas.is_empty(), "a cut-off reply is never shown: {deltas:?}");
        assert!(reply.and_then(CompletionReply::into_result).unwrap_err().error.truncated);

        let incomplete = sse(&[r#"{"choices":[{"delta":{"content":"{\"answer\":\"cut"}}]}"#]);
        let (deltas, reply) = fold_stream_for("qwq-32b", &[incomplete.as_bytes()]);
        assert!(deltas.is_empty());
        assert!(reply.err().unwrap().error.retryable);
    }

    #[test]
    fn only_inline_reasoning_families_are_buffered() {
        for model in [
            "deepseek-r1",
            "deepseek/deepseek-r1:free",
            "deepseek-reasoner",
            "qwq-32b",
            "qwen3-235b-a22b",
            "openrouter/qwen/qwen3-32b",
            "glm-z1-air",
            "acme-r1-large",
            "kimi-k2-thinking",
            "some-reasoning-model",
        ] {
            assert!(may_carry_inline_reasoning(model), "{model} must be buffered");
        }
        // Unknown and ordinary ids stream incrementally.
        for model in ["gpt-4o", "claude-sonnet-4.6", "deepseek-chat", "configured-model", "o3-mini"] {
            assert!(!may_carry_inline_reasoning(model), "{model} streams");
        }
    }

    #[tokio::test]
    async fn a_reasoning_model_stream_never_forwards_an_answer_shaped_prefix() {
        let body: &'static str = Box::leak(
            sse(&[
                r#"{"choices":[{"delta":{"content":"{\"answer\":\"PRIVATE PLAN\"}"}}]}"#,
                r#"{"choices":[{"delta":{"content":"</think>{\"answer\":\"Final answer\"}"},"finish_reason":"stop"}]}"#,
                "[DONE]",
            ])
            .into_boxed_str(),
        );
        let (runtime, server) = scripted_fixture_for("deepseek-r1", vec![(200, "text/event-stream", body)]);
        let mut deltas = Vec::new();
        let (response, _) = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0]["stream"], json!(true), "the request is still streamed");
        assert!(deltas.iter().all(|delta| !delta.contains("PRIVATE")), "prefix leaked: {deltas:?}");
        assert_eq!(deltas, [r#"{"answer":"Final answer"}"#]);
        assert_eq!(response.content, r#"{"answer":"Final answer"}"#);
    }

    #[test]
    fn truncation_is_the_typed_error_after_the_partial_text_was_sent() {
        let body = sse(&[
            r#"{"choices":[{"delta":{"content":"{\"answer\":\"Half"},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
            "[DONE]",
        ]);
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        assert_eq!(deltas, [r#"{"answer":"Half"#]);
        let failure = reply.and_then(CompletionReply::into_result).unwrap_err();
        assert!(failure.error.truncated, "a cut-off reply is the typed truncation error");
        assert_eq!(failure.model.as_deref(), Some("configured-model"));
    }

    #[test]
    fn a_stream_with_no_choices_is_an_error_unless_truncated() {
        let body = sse(&[r#"{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":0}}"#, "[DONE]"]);
        let (_, reply) = fold_stream(&[body.as_bytes()]);
        let failure = reply.err().unwrap();
        assert_eq!(failure.error.message, "AI response contained no choices");
        assert_eq!(failure.usage.unwrap().input_tokens, 3);

        let body = sse(&[r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#, "[DONE]"]);
        let (_, reply) = fold_stream(&[body.as_bytes()]);
        assert!(reply.and_then(CompletionReply::into_result).unwrap_err().error.truncated);
    }

    #[test]
    fn a_stream_that_ends_without_done_or_a_finish_reason_is_retryable() {
        let body = sse(&[r#"{"choices":[{"delta":{"content":"{\"answer\":\"cut"}}]}"#]);
        let (deltas, reply) = fold_stream(&[body.as_bytes()]);
        assert_eq!(deltas, [r#"{"answer":"cut"#]);
        let failure = reply.err().unwrap();
        assert!(failure.error.retryable);
        assert!(failure.error.message.contains("ended before"));
    }

    #[test]
    fn crlf_and_bare_cr_line_endings_split_across_chunks_fold_to_one_reply() {
        let (deltas, reply) = fold_stream(&[
            b"data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"a\\\":1}\"},\"finish_reason\":\"stop\"}]}\r",
            b"\n\rdata: [DONE]\r\n\r\n",
        ]);
        let reply = reply.unwrap_or_else(|_| panic!("a CR-split stream must fold"));
        assert_eq!(reply.response.content, r#"{"a":1}"#);
        assert_eq!(deltas.concat(), r#"{"a":1}"#);
    }

    #[test]
    fn an_error_event_fails_with_its_detail_and_is_not_retryable() {
        let mut fold = StreamFold::new();
        let mut deltas = Vec::new();
        let error = fold
            .push(
                b"event: error\ndata: {\"error\":{\"message\":\"overloaded\"}}\n\n",
                &mut |delta: &str| deltas.push(delta.to_owned()),
            )
            .unwrap_err();
        assert_eq!(error, "AI provider stream failed: overloaded");
        assert!(deltas.is_empty());
        // The caller maps any fold error to a non-retryable stream error.
        let failure = stream_error(error, false);
        assert!(!failure.retryable);
        assert_eq!(failure.class, "stream_error");
    }

    #[test]
    fn stream_lines_events_and_content_are_capped() {
        let mut fold = StreamFold::new();
        let long_line = vec![b'a'; MAX_STREAM_LINE_BYTES + 1];
        let error = fold.push(&long_line, &mut |_| {}).unwrap_err();
        assert_eq!(error, "AI stream line too long");

        let mut fold = StreamFold::new();
        let filler = "a".repeat(900_000);
        let mut failed = None;
        for _ in 0..10 {
            let event = format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"{{{filler}\"}}}}]}}\n\n");
            if let Err(error) = fold.push(event.as_bytes(), &mut |_| {}) {
                failed = Some(error);
                break;
            }
        }
        assert_eq!(failed.as_deref(), Some("AI stream content too large"));
    }

    #[test]
    fn a_partial_reasoning_tag_is_held_back_and_never_forwarded() {
        let (deltas, _) = fold_stream(&[
            br#"data: {"choices":[{"delta":{"content":"{\"answer\":\"x <"}}]}

"#,
            br#"data: {"choices":[{"delta":{"content":"th"}}]}

"#,
            br#"data: {"choices":[{"delta":{"content":"ink>hidden"}}]}

"#,
        ]);
        let forwarded = deltas.concat();
        assert_eq!(forwarded, r#"{"answer":"x "#);
        assert!(!forwarded.contains("<th") && !forwarded.contains("hidden"));
    }

    #[test]
    fn a_later_unparseable_usage_keeps_the_earlier_counts() {
        let (_, reply) = fold_stream(&[
            br#"data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}

"#,
            br#"data: {"choices":[],"usage":{"prompt_tokens":"oops"}}

"#,
            b"data: [DONE]\n\n",
        ]);
        let usage = reply.unwrap().response.usage.unwrap();
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 2);
    }

    #[tokio::test]
    async fn only_a_stream_refusal_falls_back_and_the_refusal_is_remembered() {
        let plain = r#"{"model":"m","choices":[{"message":{"content":"{\"answer\":\"plain\"}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture(vec![
            (400, "application/json", r#"{"error":{"message":"stream_options is not supported"}}"#),
            (200, "application/json", plain),
            (200, "application/json", plain),
        ]);
        let mut deltas = Vec::new();
        runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies.len(), 3, "after one refusal the runtime sends plain requests only");
        assert_eq!(bodies[0]["stream"], json!(true));
        assert!(bodies[1].get("stream").is_none());
        assert!(bodies[2].get("stream").is_none());
        assert_eq!(deltas.len(), 2);
    }

    #[tokio::test]
    async fn a_client_error_that_does_not_name_the_stream_is_a_typed_error_not_a_fallback() {
        let (runtime, server) = scripted_fixture(vec![(422, "application/json", r#"{"error":{"message":"bad temperature"}}"#)]);
        let failure = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |_: &str| {})
            .await
            .unwrap_err();
        let bodies = server.join().unwrap();
        assert_eq!(bodies.len(), 1, "no plain retry for an unrelated rejection");
        assert!(failure.error.message.contains("HTTP 422"), "{}", failure.error.message);
        assert_eq!(failure.error.status, Some(422));
        assert_eq!(failure.error.class, "http_4xx");
    }

    #[test]
    fn stream_errors_and_bad_chunks_are_reported_without_echoing_content() {
        let mut fold = StreamFold::new();
        let error = fold
            .push(sse(&[r#"{"error":{"message":"quota exhausted"}}"#]).as_bytes(), &mut |_| {})
            .unwrap_err();
        assert!(error.contains("quota exhausted"), "{error}");

        let mut fold = StreamFold::new();
        let error = fold.push(b"data: secret-text-not-json\n\n", &mut |_| {}).unwrap_err();
        assert_eq!(error, "AI stream chunk invalid");
    }

    #[test]
    fn streamed_request_asks_for_usage_and_plain_request_does_not() {
        let body = fixture_completion_request();
        let plain = completion_body("m", "https://api.example.com/v1", &body);
        assert!(plain.get("stream").is_none());
        assert!(plain.get("stream_options").is_none());
    }

    /// Scripted provider: one response per request, each with its own content
    /// type. Returns the request bodies it received, in order.
    fn scripted_fixture(
        responses: Vec<(u16, &'static str, &'static str)>,
    ) -> (AiRuntime, thread::JoinHandle<Vec<Value>>) {
        scripted_fixture_for("configured-model", responses)
    }

    /// As `scripted_fixture`, configured with `model` (its window decides admission).
    fn scripted_fixture_for(
        model: &str,
        responses: Vec<(u16, &'static str, &'static str)>,
    ) -> (AiRuntime, thread::JoinHandle<Vec<Value>>) {
        let model = model.to_owned();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let mut bodies = Vec::new();
            for (status, content_type, body) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "fixture request timed out");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 1024];
                let headers_end = loop {
                    let read = stream.read(&mut chunk).unwrap();
                    assert!(read > 0, "request ended before headers");
                    request.extend_from_slice(&chunk[..read]);
                    if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                        break end;
                    }
                };
                let headers = std::str::from_utf8(&request[..headers_end]).unwrap().to_owned();
                assert!(headers.starts_with("POST /chat/completions HTTP/1.1"));
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
                    })
                    .unwrap();
                let body_start = headers_end + 4;
                while request.len() < body_start + length {
                    let read = stream.read(&mut chunk).unwrap();
                    assert!(read > 0, "request ended before body");
                    request.extend_from_slice(&chunk[..read]);
                }
                bodies.push(serde_json::from_slice(&request[body_start..body_start + length]).unwrap());
                write!(
                    stream,
                    "HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                )
                .unwrap();
            }
            bodies
        });
        let runtime = AiRuntime::new(
            AiProviderConfig {
                provider: "loopback".into(),
                base_url: format!("http://{address}"),
                model,
                secret_name: "fixture".into(),
                timeout: Duration::from_secs(5),
            },
            "fixture-key".into(),
        )
        .unwrap();
        (runtime, server)
    }

    fn sse_body() -> String {
        sse(&CONTENT_EVENTS)
    }

    #[tokio::test]
    async fn loopback_stream_emits_deltas_in_order_and_matches_the_plain_result() {
        let body: &'static str = Box::leak(sse_body().into_boxed_str());
        let (runtime, server) = scripted_fixture(vec![(200, "text/event-stream", body)]);
        let rows = Arc::new(std::sync::Mutex::new(Vec::<ielts_db::LlmInvocationRecord>::new()));
        let sink_rows = Arc::clone(&rows);
        let runtime = runtime.with_ledger(Arc::new(move |row| sink_rows.lock().unwrap().push(row)));

        let mut deltas = Vec::new();
        let (response, _) = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        let bodies = server.join().unwrap();

        assert_eq!(deltas, [r#"{"ans"#, "wer\":\"Hi 你", "好\"}"]);
        assert_eq!(response.content, deltas.concat());
        assert_eq!(response.usage.as_ref().unwrap().input_tokens, 10);
        // One provider call, streamed, with usage requested in the stream.
        assert_eq!(bodies.len(), 1);
        assert_eq!(bodies[0]["stream"], json!(true));
        assert_eq!(bodies[0]["stream_options"], json!({"include_usage": true}));
        // Traced calls keep their own trace: the gateway ledgers nothing here.
        assert!(rows.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn loopback_truncated_stream_is_the_typed_error() {
        let body: &'static str = Box::leak(
            sse(&[
                r#"{"choices":[{"delta":{"content":"{\"answer\":\"Cut"}}]}"#,
                r#"{"choices":[{"delta":{},"finish_reason":"length"}]}"#,
                "[DONE]",
            ])
            .into_boxed_str(),
        );
        let (runtime, server) = scripted_fixture(vec![(200, "text/event-stream", body)]);
        let mut deltas = Vec::new();
        let failure = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(failure.error.truncated);
        assert_eq!(deltas, [r#"{"answer":"Cut"#]);
    }

    #[tokio::test]
    async fn a_provider_refusing_streaming_gets_the_plain_request_instead() {
        let plain = r#"{"model":"m","choices":[{"message":{"content":"{\"answer\":\"plain\"}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture(vec![
            (400, "application/json", r#"{"error":{"message":"stream_options is not supported"}}"#),
            (200, "application/json", plain),
        ]);
        let mut deltas = Vec::new();
        let (response, _) = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(response.content, r#"{"answer":"plain"}"#);
        assert_eq!(deltas, [r#"{"answer":"plain"}"#]);
        assert_eq!(bodies.len(), 2);
        assert_eq!(bodies[0]["stream"], json!(true));
        assert!(bodies[1].get("stream").is_none());
        assert!(bodies[1].get("stream_options").is_none());
    }

    #[tokio::test]
    async fn a_plain_json_answer_to_a_streamed_request_is_read_without_a_second_call() {
        let plain = r#"{"model":"m","usage":{"prompt_tokens":4,"completion_tokens":2},"choices":[{"message":{"content":"{\"answer\":\"json\"}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture(vec![(200, "application/json", plain)]);
        let mut deltas = Vec::new();
        let (response, _) = runtime
            .complete_with_trace_streaming(fixture_completion_request(), &mut |delta: &str| {
                deltas.push(delta.to_owned());
            })
            .await
            .unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies.len(), 1, "a provider that answers in JSON is billed once");
        assert_eq!(response.content, r#"{"answer":"json"}"#);
        assert_eq!(deltas, [r#"{"answer":"json"}"#]);
    }

    // Pre-send context guard. A refused request must never reach the endpoint.

    /// A runtime pointed at a listener that is never accepted from. A request
    /// that reached it would connect and stay pending, so `accept` would succeed.
    fn uncalled_endpoint(model: &str) -> (AiRuntime, TcpListener) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let runtime = AiRuntime::new(AiProviderConfig {
            provider: "loopback".into(),
            base_url: format!("http://{address}"),
            model: model.into(),
            secret_name: "fixture".into(),
            timeout: Duration::from_secs(5),
        }, "fixture-key".into()).unwrap();
        (runtime, listener)
    }

    fn no_request_reached(listener: &TcpListener) -> bool {
        listener.accept().is_err_and(|error| error.kind() == std::io::ErrorKind::WouldBlock)
    }

    fn ledger_rows() -> (LedgerSink, Arc<std::sync::Mutex<Vec<ielts_db::LlmInvocationRecord>>>) {
        let rows = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink_rows = Arc::clone(&rows);
        (Arc::new(move |row| sink_rows.lock().unwrap().push(row)), rows)
    }

    /// ASCII text the estimator counts as exactly `tokens` (chars / 4).
    fn ascii_tokens(tokens: u32) -> String {
        "a".repeat(4 * tokens as usize)
    }

    fn completion_of(text: String, max_tokens: u32) -> CompletionRequest {
        CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", text)],
            temperature: 0.2,
            max_tokens,
            cache_key: None,
        }
    }

    fn agent_of(text: String, max_tokens: u32) -> AgentModelRequest {
        AgentModelRequest {
            messages: vec![AgentMessage::User { content: text }],
            tools: vec![],
            temperature: 0.2,
            max_tokens,
            cache_key: None,
        }
    }

    #[tokio::test]
    async fn oversize_prompt_is_refused_before_any_http_request_and_ledgered() {
        // gpt-4o is a confident 128,000-token row: an input that fills it is refused.
        let (runtime, listener) = uncalled_endpoint("gpt-4o");
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        // Each message adds four framing tokens, so 127,996 tokens of text is 128,000 of input.
        let error = runtime.complete(completion_of(ascii_tokens(127_996), 2_000)).await.unwrap_err();
        assert!(error.context_exceeded);
        assert!(!error.retryable && !error.truncated);
        assert_eq!(error.message, "prompt exceeds model context: ~128000 tokens of 128000");

        let traced = runtime.complete_with_trace(completion_of(ascii_tokens(127_996), 2_000)).await.unwrap_err();
        assert!(traced.error.context_exceeded);
        let agent = runtime.respond(agent_of(ascii_tokens(127_996), 100)).await.unwrap_err();
        assert!(agent.error.context_exceeded);

        assert!(no_request_reached(&listener), "a refused request must make no HTTP call");
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2, "plain and agent calls are ledgered; the traced call is the coach's row");
        assert_eq!(rows[0].model, "gpt-4o");
        assert!(rows[0].usage_json.is_none() && rows[0].response_hash.is_none());
        let error_json: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(error_json, json!({"status": null, "class": "context_exceeded", "retryable": false}));
    }

    #[tokio::test]
    async fn a_prompt_with_less_room_than_the_minimum_is_refused_before_any_http_request() {
        // gpt-4o: 127,999 input tokens (127,995 of text plus framing) leave one token,
        // below the 256-token minimum output room, so nothing is sent.
        let (runtime, listener) = uncalled_endpoint("gpt-4o");
        let error = runtime.complete(completion_of(ascii_tokens(127_995), 2_000)).await.unwrap_err();
        assert!(error.context_exceeded && !error.retryable);
        assert!(no_request_reached(&listener), "a refused request must make no HTTP call");
    }

    #[tokio::test]
    async fn an_o3_request_with_500_tokens_of_room_is_refused_before_any_http_call() {
        // o3: 200,000 window. 199,496 tokens of text plus framing leave 500 tokens,
        // below the 1,024 floor the provider is always sent, so nothing goes out.
        let (runtime, listener) = uncalled_endpoint("o3");
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        let error = runtime.complete(completion_of(ascii_tokens(199_496), 4_000)).await.unwrap_err();
        assert!(error.context_exceeded && !error.retryable && !error.truncated);
        assert_eq!(error.message, "prompt exceeds model context: ~200524 tokens of 200000");
        assert!(no_request_reached(&listener), "a refused o3 request must make no HTTP call");

        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 1);
        let error_json: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
        assert_eq!(error_json, json!({"status": null, "class": "context_exceeded", "retryable": false}));
    }

    #[tokio::test]
    async fn an_o3_request_with_1500_tokens_of_room_is_sent_clamped_to_the_room_not_raised_to_the_floor() {
        // o3: 198,496 tokens of text plus framing leave 1,500 tokens of room. The
        // 4,000 request is clamped to 1,500, which is above the 1,024 floor, so the
        // wire value is exactly the clamp and never overflows the room.
        let reply = r#"{"model":"o3","choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture_for("o3", vec![(200, "application/json", reply)]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        runtime.complete(completion_of(ascii_tokens(198_496), 4_000)).await.unwrap();
        let bodies = server.join().unwrap();
        let sent = bodies[0]["max_completion_tokens"].as_u64().unwrap();
        assert_eq!(sent, 1_500);
        assert!(sent >= 1_024, "the o-series floor still holds");
        assert!(bodies[0].get("max_tokens").is_none());

        let rows = rows.lock().unwrap();
        let usage: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["maxTokensClamped"], json!(1_500));
    }

    #[tokio::test]
    async fn a_prompt_with_some_room_is_sent_with_the_output_clamped_and_ledgered() {
        // gpt-4o: 127,004 estimated input tokens leave 996 of 128,000: 2,000 is clamped to 996.
        let plain = r#"{"id":"clamped","model":"gpt-4o","usage":{"prompt_tokens":127004,"completion_tokens":40},"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#;
        let agent = r#"{"model":"gpt-4o","choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}"#;
        let small = r#"{"id":"small","model":"gpt-4o","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#;
        let (runtime, server) = scripted_fixture_for("gpt-4o", vec![
            (200, "application/json", plain),
            (200, "application/json", agent),
            (200, "application/json", small),
        ]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        runtime.complete(completion_of(ascii_tokens(127_000), 2_000)).await.unwrap();
        runtime.respond(agent_of(ascii_tokens(127_000), 2_000)).await.unwrap();
        runtime.complete(completion_of("hello".into(), 2_000)).await.unwrap();
        let bodies = server.join().unwrap();

        assert_eq!(bodies[0]["max_tokens"], json!(996));
        assert_eq!(bodies[1]["max_tokens"], json!(996));
        assert_eq!(bodies[2]["max_tokens"], json!(2_000), "a request that fits is sent unchanged");

        let rows = rows.lock().unwrap();
        let clamped: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(clamped["maxTokensClamped"], json!(996));
        assert_eq!(clamped["promptTokens"], json!(127_004));
        assert!(rows[0].error_json.is_none());

        let agent_row: Value = serde_json::from_str(rows[1].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(agent_row["maxTokensClamped"], json!(996));
        assert_eq!(agent_row["estimated"], json!(true));

        let unclamped: Value = serde_json::from_str(rows[2].usage_json.as_deref().unwrap()).unwrap();
        assert!(unclamped.get("maxTokensClamped").is_none());
        assert!(unclamped.get("contextWarning").is_none());
    }

    #[tokio::test]
    async fn an_unknown_model_with_a_60k_prompt_is_sent_unchanged_with_a_warning() {
        let plain = r#"{"model":"some-unknown-model","usage":{"prompt_tokens":60000,"completion_tokens":4},"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture_for("some-unknown-model", vec![
            (200, "application/json", plain),
        ]);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);
        runtime.complete(completion_of(ascii_tokens(60_000), 2_000)).await.unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0]["max_tokens"], json!(2_000), "advisory rows never clamp");

        let rows = rows.lock().unwrap();
        let usage: Value = serde_json::from_str(rows[0].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["contextWarning"], json!(true));
        assert!(usage.get("maxTokensClamped").is_none());
        assert!(rows[0].error_json.is_none());
    }

    #[tokio::test]
    async fn an_uncertain_row_is_sent_as_asked_even_when_the_input_exceeds_its_window() {
        // qwen3 is an advisory 32,768 row: a 40k-token prompt goes out unchanged.
        let (runtime, server) = scripted_fixture_for("qwen3-235b", vec![(
            200,
            "application/json",
            r#"{"model":"qwen3-235b","choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#,
        )]);
        runtime.complete(completion_of(ascii_tokens(40_000), 2_000)).await.unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0]["max_tokens"], json!(2_000));
    }

    #[tokio::test]
    async fn a_provider_context_length_400_is_a_typed_context_error_without_a_retry() {
        let body = r#"{"error":{"message":"This model's maximum context length is 128000 tokens.","code":"context_length_exceeded"}}"#;
        let (runtime, server) = scripted_fixture(vec![(400, "application/json", body)]);
        let error = runtime.complete(completion_of("hello".into(), 100)).await.unwrap_err();
        let bodies = server.join().unwrap();
        assert_eq!(bodies.len(), 1, "a context rejection is never retried");
        assert!(error.context_exceeded);
        assert!(!error.retryable && !error.truncated);
        assert!(error.message.contains("maximum context length"));
    }

    #[test]
    fn a_context_window_stop_reason_is_a_truncation() {
        assert!(is_truncated(Some("model_context_window_exceeded")));
        assert!(!is_truncated(Some("stop")));
    }

    /// Reads one chat request off `stream` and returns its JSON body.
    fn read_chat_request(stream: &mut std::net::TcpStream) -> Value {
        let mut request = Vec::new();
        let mut chunk = [0; 1024];
        let headers_end = loop {
            let read = stream.read(&mut chunk).unwrap();
            assert!(read > 0, "request ended before headers");
            request.extend_from_slice(&chunk[..read]);
            if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                break end;
            }
        };
        let headers = std::str::from_utf8(&request[..headers_end]).unwrap().to_owned();
        let length: usize = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
            })
            .unwrap();
        let body_start = headers_end + 4;
        while request.len() < body_start + length {
            let read = stream.read(&mut chunk).unwrap();
            assert!(read > 0, "request ended before body");
            request.extend_from_slice(&chunk[..read]);
        }
        serde_json::from_slice(&request[body_start..body_start + length]).unwrap()
    }

    /// Reads the first request, reports it on `seen`, and never answers it. The
    /// next request is answered with `answer`.
    fn stall_then_answer_fixture(
        seen: tokio::sync::oneshot::Sender<()>,
        answer: &'static str,
    ) -> (AiRuntime, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stalled, _) = listener.accept().unwrap();
            read_chat_request(&mut stalled);
            let _ = seen.send(());
            thread::sleep(Duration::from_millis(200));
            drop(stalled);
            let (mut stream, _) = listener.accept().unwrap();
            read_chat_request(&mut stream);
            write!(
                stream,
                "HTTP/1.1 200 Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
                answer.len(),
            )
            .unwrap();
        });
        let runtime = AiRuntime::new(
            AiProviderConfig {
                provider: "loopback".into(),
                base_url: format!("http://{address}"),
                model: "configured-model".into(),
                secret_name: "fixture".into(),
                timeout: Duration::from_secs(5),
            },
            "fixture-key".into(),
        )
        .unwrap();
        (runtime, server)
    }

    fn interrupted_error() -> Value {
        json!({"status": null, "class": "interrupted", "retryable": true})
    }

    #[tokio::test]
    async fn a_cancelled_completion_writes_one_interrupted_row_and_a_normal_call_one_more() {
        let answer = r#"{"id":"normal","model":"configured-model","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#;
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (runtime, server) = stall_then_answer_fixture(seen_tx, answer);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        // Cancel only once the fixture has the request: the send is mid-flight.
        tokio::select! {
            _ = runtime.complete(fixture_completion_request()) => panic!("a stalled call cannot return"),
            _ = seen_rx => {}
        }
        {
            let rows = rows.lock().unwrap();
            assert_eq!(rows.len(), 1, "the cancelled call writes its row when it is dropped");
            let error: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
            assert_eq!(error, interrupted_error());
            assert!(rows[0].usage_json.is_none(), "an interrupted call has no usage and no estimate");
        }

        runtime.complete(fixture_completion_request()).await.unwrap();
        server.join().unwrap();
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2, "the normal call adds exactly one row");
        assert!(rows[1].error_json.is_none());
        assert_eq!(rows[1].provider_request_id.as_deref(), Some("normal"));
        let usage: Value = serde_json::from_str(rows[1].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(usage["promptTokens"], json!(10));
    }

    #[tokio::test]
    async fn a_cancelled_agent_round_writes_one_interrupted_row_and_a_normal_call_one_more() {
        let answer = r#"{"id":"normal","model":"configured-model","usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[{"message":{"content":"done"},"finish_reason":"stop"}]}"#;
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (runtime, server) = stall_then_answer_fixture(seen_tx, answer);
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        tokio::select! {
            _ = runtime.respond(fixture_agent_request()) => panic!("a stalled round cannot return"),
            _ = seen_rx => {}
        }
        {
            let rows = rows.lock().unwrap();
            assert_eq!(rows.len(), 1);
            let error: Value = serde_json::from_str(rows[0].error_json.as_deref().unwrap()).unwrap();
            assert_eq!(error, interrupted_error());
        }

        runtime.complete(fixture_completion_request()).await.unwrap();
        server.join().unwrap();
        let rows = rows.lock().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows[1].error_json.is_none());
    }

    #[tokio::test]
    async fn the_coach_trace_is_not_ledgered_even_when_it_is_cancelled() {
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let (runtime, server) = stall_then_answer_fixture(seen_tx, "{}");
        let (sink, rows) = ledger_rows();
        let runtime = runtime.with_ledger(sink);

        tokio::select! {
            _ = runtime.complete_with_trace(fixture_completion_request()) => panic!("a stalled call cannot return"),
            _ = seen_rx => {}
        }
        // The fixture's second accept is never reached, so its thread is not joined.
        drop(server);
        assert!(rows.lock().unwrap().is_empty(), "the coach trace owns its own record");
    }

    #[tokio::test]
    async fn cjk_prompt_is_budgeted_at_one_token_per_character_on_the_wire() {
        // 120,000 CJK characters are 120,000 tokens, not 30,000. With framing that
        // leaves 7,996 of 128,000, so a 10,000 request is clamped to 7,996.
        let cjk_reply = r#"{"model":"gpt-4o","choices":[{"message":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}"#;
        let (runtime, server) = scripted_fixture_for("gpt-4o", vec![(200, "application/json", cjk_reply)]);
        runtime.complete(completion_of("中".repeat(120_000), 10_000)).await.unwrap();
        let bodies = server.join().unwrap();
        assert_eq!(bodies[0]["max_tokens"], json!(7_996));
    }
}
