use std::time::{Duration, Instant};

use async_trait::async_trait;
use ielts_application::{
    AgentMessage, AgentModel, AgentModelFailure, AgentModelRequest, AgentModelResponse,
    AgentToolCall, CompletionRequest, CompletionResponse, LanguageModel, ModelError, TokenUsage,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

const MAX_RETRIES: u32 = 2;

struct ChatCompletionFailure {
    error: ModelError,
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
            latency_ms,
            retry_count,
            provider_request_id,
        }
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

// The runtime owns the API key. Do not derive Debug/Clone: formatting or
// copying this value would make accidental credential exposure easy.
pub(crate) struct AiRuntime {
    pub config: AiProviderConfig,
    api_key: String,
    client: reqwest::Client,
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
        })
    }
}

#[async_trait]
impl LanguageModel for AiRuntime {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        let body = completion_body(&self.config.model, &request);
        let (envelope, latency_ms, _retry_count, header_request_id): (ChatResponse, _, _, _) = self
            .post_chat_completion(&body, "AI response envelope invalid")
            .await
            .map_err(|failure| failure.error)?;
        let content = envelope
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .ok_or_else(|| model_error("AI response contained no choices", false))?;
        Ok(CompletionResponse {
            content,
            model: envelope.model.unwrap_or_else(|| self.config.model.clone()),
            latency_ms,
            usage: envelope.usage.map(token_usage),
            provider_request_id: prefer_provider_request_id(header_request_id, envelope.id),
        })
    }
}

#[async_trait]
impl AgentModel for AiRuntime {
    async fn respond(
        &self,
        request: AgentModelRequest,
    ) -> Result<AgentModelResponse, AgentModelFailure> {
        let body = agent_request_body(&self.config.model, &request);
        let (envelope, latency_ms, retry_count, header_request_id): (AgentChatResponse, _, _, _) =
            self.post_chat_completion(&body, "AI agent response envelope invalid")
                .await
                .map_err(|failure| {
                    AgentModelFailure::with_trace(
                        failure.error,
                        None,
                        failure.latency_ms,
                        None,
                        failure.provider_request_id,
                        failure.retry_count,
                    )
                })?;
        parse_agent_response(
            envelope,
            &self.config.model,
            latency_ms,
            retry_count,
            header_request_id,
        )
    }
}

impl AiRuntime {
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
        for attempt in 0..=MAX_RETRIES {
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
                    let envelope = response.json().await.map_err(|error| {
                        ChatCompletionFailure::new(
                            model_error(format!("{invalid_envelope}: {error}"), false),
                            elapsed_ms(started),
                            attempt,
                            provider_request_id.clone(),
                        )
                    })?;
                    return Ok((envelope, elapsed_ms(started), attempt, provider_request_id));
                }
                Ok(response) => {
                    let status = response.status();
                    let provider_request_id = provider_request_id_from_headers(response.headers());
                    let retryable = status.is_server_error() || status.as_u16() == 429;
                    if retryable && attempt < MAX_RETRIES {
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
                    if retryable && attempt < MAX_RETRIES {
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
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
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
}

#[derive(Deserialize)]
struct AgentChoice {
    message: AgentResponseMessage,
}

#[derive(Deserialize)]
struct AgentResponseMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<WireToolCall>,
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
}

/// Round-3 audit (7.8): build the chat-completion body, forwarding the optional
/// output ceiling. `max_tokens` is inserted only when `Some`, so a request
/// without a ceiling keeps the historical body byte-identical and providers that
/// reject an explicit null are unaffected.
fn completion_body(model: &str, request: &CompletionRequest) -> Value {
    let mut body = json!({
        "model": model,
        "temperature": request.temperature,
        "response_format": { "type": "json_object" },
        "messages": request.messages
    });
    if let Some(max_tokens) = request.max_tokens {
        body["max_tokens"] = json!(max_tokens);
    }
    body
}

fn agent_request_body(model: &str, request: &AgentModelRequest) -> Value {
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
    json!({
        "model": model,
        "temperature": request.temperature,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    })
}

fn agent_message_json(message: &AgentMessage) -> Value {
    match message {
        AgentMessage::System { content } => json!({"role":"system","content":content}),
        AgentMessage::User { content } => json!({"role":"user","content":content}),
        AgentMessage::Assistant {
            content,
            tool_calls,
        } => json!({
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
        }),
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
    let message = envelope
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
    Ok(AgentModelResponse {
        content: message.content,
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
    })
}

fn token_usage(usage: ChatUsage) -> TokenUsage {
    TokenUsage {
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
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

    #[test]
    fn model_error_does_not_expose_credentials() {
        let error = model_error("AI provider returned HTTP 401", false);
        assert_eq!(error.message, "AI provider returned HTTP 401");
    }

    #[test]
    fn existing_completion_body_keeps_json_response_format() {
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: None,
        };
        // Assert against the production builder, not a hand-rolled copy.
        let body = completion_body("fake-model", &request);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert!(body.get("tools").is_none());
        assert!(
            body.get("max_tokens").is_none(),
            "a request without a ceiling must keep the historical body shape"
        );
    }

    #[test]
    fn completion_body_forwards_output_ceiling_when_set() {
        let request = CompletionRequest {
            messages: vec![ielts_application::ChatMessage::new("user", "hello")],
            temperature: 0.2,
            max_tokens: Some(2_000),
        };
        let body = completion_body("fake-model", &request);
        assert_eq!(body["max_tokens"], json!(2_000));
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
        };
        let body = agent_request_body("fake-model", &request);
        assert!(body.get("response_format").is_none());
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
}
