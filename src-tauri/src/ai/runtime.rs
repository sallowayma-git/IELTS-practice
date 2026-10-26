use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use ielts_application::{
    AgentMessage, AgentModel, AgentModelFailure, AgentModelRequest, AgentModelResponse,
    AgentToolCall, CompletionRequest, CompletionResponse, LanguageModel, ModelError,
    ReasoningEcho, TokenUsage,
};
use serde::de::DeserializeOwned;
use ielts_domain::{estimate_tokens, rendered_hash};
use serde::Deserialize;
use serde_json::{json, Value};

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

    fn record_completion(&self, body: &Value, result: &Result<CompletionReply, AgentModelFailure>) {
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
                }
            }
            Err(failure) => LedgerCall::failed(failure, &self.config.model),
        };
        sink(ledger_record(&self.config.provider, body, call));
    }

    fn record_agent(&self, body: &Value, result: &Result<AgentReply, AgentModelFailure>) {
        let Some(sink) = &self.ledger else { return };
        let call = match result {
            Ok(reply) => LedgerCall {
                model: &reply.response.model,
                latency_ms: reply.response.latency_ms,
                usage: reply.response.usage.as_ref(),
                provider_request_id: reply.response.provider_request_id.as_deref(),
                outcome: Ok(reply.response.content.as_deref().unwrap_or("")),
                finish_reason: reply.finish_reason.as_deref(),
            },
            Err(failure) => LedgerCall::failed(failure, &self.config.model),
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

/// One gateway call as the ledger sees it: the provider's facts or the failure.
struct LedgerCall<'a> {
    model: &'a str,
    latency_ms: u64,
    usage: Option<&'a TokenUsage>,
    provider_request_id: Option<&'a str>,
    outcome: Result<&'a str, &'a ModelError>,
    /// The provider's finish reason, when the reply carried one.
    finish_reason: Option<&'a str>,
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
    ielts_db::LlmInvocationRecord {
        id: format!("llm-{}", uuid::Uuid::new_v4()),
        provider: provider.into(),
        model: call.model.into(),
        request_hash: rendered_hash(&request.to_string()),
        response_hash: call.outcome.ok().map(rendered_hash),
        usage_json: usage.map(|value| value.to_string()),
        latency_ms: call.latency_ms,
        provider_request_id: call.provider_request_id.map(str::to_string),
        error_json: call.outcome.err().map(|error| {
            json!({"message": error.message, "retryable": error.retryable}).to_string()
        }),
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

/// Provider-reported counts. Cache and reasoning keys appear only when non-zero:
/// the parsed `TokenUsage` cannot tell "reported as 0" from "not reported".
fn provider_usage_json(usage: &TokenUsage) -> Value {
    let mut value = json!({
        "promptTokens": usage.input_tokens,
        "completionTokens": usage.output_tokens,
        "totalTokens": usage.input_tokens + usage.output_tokens,
    });
    if usage.cached_input_tokens > 0 {
        value["cachedInputTokens"] = json!(usage.cached_input_tokens);
    }
    if usage.reasoning_tokens > 0 {
        value["reasoningTokens"] = json!(usage.reasoning_tokens);
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
        "totalTokens": prompt + completion,
        "estimated": true,
    })
}

#[async_trait]
impl LanguageModel for AiRuntime {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        let reply = self.send_completion(&body).await;
        self.record_completion(&body, &reply);
        reply
            .and_then(CompletionReply::into_result)
            .map(|(response, _)| response)
            .map_err(|failure| failure.error)
    }

    fn identity(&self) -> (&str, &str) { (&self.config.provider, &self.config.model) }

    async fn complete_with_trace(&self, request: CompletionRequest) -> Result<(CompletionResponse, u32), AgentModelFailure> {
        let body = completion_body(&self.config.model, &self.config.base_url, &request);
        self.send_completion(&body).await.and_then(CompletionReply::into_result)
    }
}

#[async_trait]
impl AgentModel for AiRuntime {
    async fn respond(
        &self,
        request: AgentModelRequest,
    ) -> Result<AgentModelResponse, AgentModelFailure> {
        let body = agent_request_body(&self.config.model, &self.config.base_url, &request);
        let result = self.send_agent(&body).await;
        self.record_agent(&body, &result);
        result.map(|reply| reply.response)
    }
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

/// A tool-calling or plain agent reply plus its finish reason (ledger only).
struct AgentReply {
    response: AgentModelResponse,
    finish_reason: Option<String>,
}

/// Whether a provider finish reason means the output hit the ceiling.
/// `length` is OpenAI-style; `max_tokens` is Anthropic-style `stop_reason`.
fn is_truncated(finish_reason: Option<&str>) -> bool {
    matches!(finish_reason, Some("length" | "max_tokens"))
}

impl AiRuntime {
    async fn send_completion(&self, body: &Value) -> Result<CompletionReply, AgentModelFailure> {
        let (envelope, latency_ms, retry_count, header_request_id): (ChatResponse, _, _, _) = self
            .post_chat_completion(body, "AI response envelope invalid")
            .await
            .map_err(ChatCompletionFailure::into_trace)?;
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
            None => return Err(AgentModelFailure::with_trace(model_error("AI response contained no choices", false), Some(model), latency_ms, usage, provider_request_id, retry_count)),
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
                            model_error(format!("{invalid_envelope}: {error}"), false),
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
                            error: model_error(invalid_envelope, false),
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
                    let detail = provider_error_detail(response).await;
                    let message = match detail {
                        Some(detail) => format!(
                            "AI provider returned HTTP {}: {detail}",
                            status.as_u16()
                        ),
                        None => format!("AI provider returned HTTP {}", status.as_u16()),
                    };
                    return Err(ChatCompletionFailure::new(
                        model_error(message, retryable),
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
                        model_error(format!("AI request failed: {error}"), retryable),
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

/// Longest provider error excerpt kept in a user-facing message. Enough for the
/// real explanation ("Incorrect API key provided", "model not found"), short
/// enough that a provider echoing a large payload cannot flood the UI.
const MAX_PROVIDER_ERROR_DETAIL: usize = 300;

/// Pull a short, human-readable reason out of a provider error response.
///
/// Prefers the OpenAI-compatible `{"error":{"message":...}}` shape, falls back
/// to `{"error":"..."}`, then to the raw body. Returns `None` when the body is
/// empty or unreadable, so the caller keeps its status-only message.
async fn provider_error_detail(response: reqwest::Response) -> Option<String> {
    extract_provider_error_detail(&response.text().await.ok()?)
}

/// The body-parsing half of [`provider_error_detail`], split out so it is
/// testable without standing up an HTTP server.
fn extract_provider_error_detail(body: &str) -> Option<String> {
    let body = body.trim();
    if body.is_empty() {
        return None;
    }
    let extracted = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            let error = value.get("error")?;
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
// Streaming is not used by this gateway (every call is one JSON response); if it
// ever is, deltas must pass the same filter before they are forwarded.
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

/// `(field, value)` for the output ceiling of `model`, matched on the name after
/// any `vendor/` routing prefix (e.g. `openai/o3-mini`).
fn output_limit(model: &str, requested: u32) -> (&'static str, u32) {
    let name = model.rsplit('/').next().unwrap_or(model).to_ascii_lowercase();
    OUTPUT_LIMIT_RULES
        .iter()
        .find(|(prefix, _, _)| name.starts_with(prefix))
        .map_or(("max_tokens", requested), |(_, field, floor)| (*field, requested.max(*floor)))
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
                model_error("AI agent response contained no choices", false),
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
        };
        let row = ledger_record("p", &request, failed);
        assert_eq!(row.usage_json, None);
        assert_eq!(row.response_hash, None);
        assert_eq!(row.request_hash, rendered_hash(&request.to_string()));
        assert!(row.error_json.unwrap().contains("\"retryable\":true"));
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
        assert!(rows[0].error_json.is_none() && rows[0].response_hash.is_some());
        let agent: Value = serde_json::from_str(rows[1].usage_json.as_deref().unwrap()).unwrap();
        assert_eq!(agent["estimated"], json!(true));
        assert!(rows[2].usage_json.is_none() && rows[2].response_hash.is_none());
        assert!(rows[2].error_json.as_deref().unwrap().contains("bad key"));
        assert_ne!(rows[0].id, rows[1].id);
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
        let agent = runtime.respond(fixture_agent_request()).await.unwrap();
        assert_eq!(agent.content.as_deref(), Some("partial answer"));
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
        assert!(rows[0].error_json.as_deref().unwrap().contains("truncated at max_tokens"));
        assert_eq!(usage(&rows[1])["finishReason"], json!("stop"));
        assert!(rows[1].response_hash.is_some() && rows[1].error_json.is_none());
        assert!(usage(&rows[2]).get("finishReason").is_none());
        assert_eq!(usage(&rows[2])["promptTokens"], json!(5));
        assert_eq!(usage(&rows[3])["finishReason"], json!("max_tokens"));
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
}
