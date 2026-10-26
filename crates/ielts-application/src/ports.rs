use async_trait::async_trait;
use ielts_db::{
    AppendCoachMessageCommand, CoachMessage, EvaluationEvent, EvaluationRunResult,
    PreparedEvaluation, ProviderError, RecordCoachFailureCommand, StartEvaluationCommand,
};
use ielts_domain::dto::{WritingFeedbackV4, WritingScoreV4};
use ielts_domain::{EmbeddingRequest, EmbeddingResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::ApplicationError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    /// Provider-side output ceiling. Required: every completion declares its
    /// own ceiling, so no call site can ship an unbounded request by omission.
    pub max_tokens: u32,
    /// Stable routing key for provider-side prompt caching (one per coach
    /// thread). The gateway sends it only to providers that document a routing
    /// parameter for it; everywhere else it is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_key: Option<String>,
}

/// Per-call-site output ceilings (tokens). The Coach (2000) and the sidecar
/// jobs (memory candidates 2000, weekly dream 2500) keep their own constants
/// next to the code that builds the prompt.
pub const WRITING_EVALUATION_MAX_TOKENS: u32 = 6_144;
pub const AGENT_ROUND_MAX_TOKENS: u32 = 1_500;
pub const PROVIDER_PROBE_MAX_TOKENS: u32 = 16;

/// Provider-reported token counts. `output_tokens` is the provider's completion
/// total, which already INCLUDES hidden reasoning; `reasoning_tokens` is that
/// reasoning share when the provider reports it separately
/// (`completion_tokens_details.reasoning_tokens`), otherwise 0. Counts only:
/// reasoning text is never part of this structure.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub reasoning_tokens: u64,
    /// The part of `input_tokens` the provider served from its prompt cache,
    /// when it reports one (0 otherwise). Counts only.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cached_input_tokens: u64,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResponse {
    pub content: String,
    pub model: String,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelError {
    pub message: String,
    pub retryable: bool,
    /// True when the provider stopped at the output ceiling (`finish_reason`
    /// `length` / `max_tokens`). The reply is cut off, so a JSON caller cannot
    /// use it; the gateway never retries it with a larger ceiling.
    pub truncated: bool,
    /// True when the gateway refused to send the request because the prompt
    /// (plus the output room it needs) does not fit the model's context window.
    /// Refused before any HTTP call, so it is never retryable.
    pub context_exceeded: bool,
}

impl ModelError {
    pub fn new(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            message: message.into(),
            retryable,
            truncated: false,
            context_exceeded: false,
        }
    }

    /// The typed error for a reply cut off at its output ceiling.
    pub fn output_truncated() -> Self {
        Self {
            message: "model output truncated at max_tokens".into(),
            retryable: false,
            truncated: true,
            context_exceeded: false,
        }
    }

    /// The typed refusal for a prompt that cannot fit the context window.
    /// `total_tokens` is the estimated input plus the requested output ceiling.
    pub fn prompt_exceeds_context(total_tokens: u32, window: u32) -> Self {
        Self {
            message: format!("prompt exceeds model context: ~{total_tokens} tokens of {window}"),
            retryable: false,
            truncated: false,
            context_exceeded: true,
        }
    }
}

/// Stable prompt-cache routing key for one call path: a fixed per-purpose label
/// plus a digest of its byte-stable system prefix. Calls whose prefix is
/// identical share a key; the user content never enters it. Callers opt in by
/// setting `CompletionRequest::cache_key` (or the agent request's key) to this.
pub fn prompt_cache_key(purpose: &str, stable_prefix: &str) -> String {
    let digest = Sha256::digest(stable_prefix.as_bytes());
    let hex: String = digest.iter().take(16).map(|byte| format!("{byte:02x}")).collect();
    format!("{purpose}-{hex}")
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for ModelError {}

impl From<ModelError> for ProviderError {
    fn from(error: ModelError) -> Self {
        Self {
            message: error.message,
            retryable: error.retryable,
        }
    }
}

#[async_trait]
pub trait LanguageModel: Send + Sync {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError>;

    fn identity(&self) -> (&str, &str) { ("unknown", "unknown") }

    async fn complete_with_trace(&self, request: CompletionRequest) -> Result<(CompletionResponse, u32), crate::AgentModelFailure> {
        self.complete(request).await.map(|response| (response, 0)).map_err(Into::into)
    }

    /// Same result as [`complete_with_trace`], while forwarding the raw content
    /// deltas of the reply as they arrive. A model that cannot stream ignores
    /// `on_delta` and answers as `complete_with_trace` does.
    async fn complete_with_trace_streaming(
        &self,
        request: CompletionRequest,
        on_delta: &mut (dyn for<'a> FnMut(&'a str) + Send),
    ) -> Result<(CompletionResponse, u32), crate::AgentModelFailure> {
        let _ = on_delta;
        self.complete_with_trace(request).await
    }

    /// M5-04: request an embedding batch through the Rust Model Gateway.
    ///
    /// The default implementation returns a non-retryable `embedding_not_supported`
    /// error. This keeps embedding opt-in: a provider only advertises
    /// `model.embed.batch` once the M5-11 eval gate proves lexical retrieval is
    /// insufficient — the plan forbids defaulting to vectorization. Implementors
    /// that have a real embedding endpoint override this with a provider call.
    async fn embed(&self, _request: EmbeddingRequest) -> Result<EmbeddingResponse, ModelError> {
        Err(ModelError::new("embedding_not_supported: this provider does not expose an embedding endpoint", false))
    }
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: EvaluationEvent);
}

pub trait WritingEvaluationStore: Send + Sync {
    fn prepare(
        &self,
        command: &StartEvaluationCommand,
        provider_id: &str,
        model: &str,
    ) -> Result<PreparedEvaluation, ApplicationError>;

    fn list_events(
        &self,
        evaluation_id: &str,
        after_sequence: u32,
    ) -> Result<Vec<EvaluationEvent>, ApplicationError>;

    fn finish(
        &self,
        prepared: &PreparedEvaluation,
        score: Result<WritingScoreV4, ProviderError>,
        feedback: Option<WritingFeedbackV4>,
        review_error: Option<ProviderError>,
    ) -> Result<EvaluationRunResult, ApplicationError>;

    fn request_cancel(&self, evaluation_id: &str) -> Result<bool, ApplicationError>;
}

pub trait CoachStore: Send + Sync {
    fn begin_trace(&self, thread: &str, user_message: &str, request: &Value, provider: &str, model: &str, budget: u32) -> Result<String, ApplicationError>;
    fn complete_trace(&self, run: &str, thread: &str, answer: &str, payload: Value, response: &Value) -> Result<CoachMessage, ApplicationError>;
    fn fail_trace(&self, run: &str, error: &Value, response: Option<&Value>) -> Result<(), ApplicationError>;
    fn resolve_context(
        &self,
        thread_id: &str,
        selector: Option<&Value>,
    ) -> Result<ielts_db::ResolvedCoachContext, ApplicationError>;

    /// Newest completed automatic review (`review_set`) on the thread, if any.
    fn find_completed_review(
        &self,
        thread_id: &str,
    ) -> Result<Option<ielts_db::CoachRunResult>, ApplicationError>;

    fn append_message(
        &self,
        command: &AppendCoachMessageCommand,
    ) -> Result<CoachMessage, ApplicationError>;

    fn load_history(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<CoachMessage>, ApplicationError>;

    fn complete_run(
        &self,
        thread_id: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<CoachMessage, ApplicationError>;

    fn record_failure(&self, command: &RecordCoachFailureCommand) -> Result<(), ApplicationError>;

    /// The thread's learner profile, frozen on its first coach run and
    /// returned verbatim afterwards.
    fn learner_profile(
        &self,
        thread_id: &str,
    ) -> Result<ielts_db::LearnerProfileSnapshot, ApplicationError>;
}

#[cfg(test)]
mod tests {
    use super::prompt_cache_key;

    #[test]
    fn prompt_cache_key_is_stable_for_one_prefix_and_differs_across_prefixes() {
        let key = prompt_cache_key("dream-weekly", "system prompt");
        assert_eq!(key, prompt_cache_key("dream-weekly", "system prompt"));
        assert!(key.starts_with("dream-weekly-") && key.len() == "dream-weekly-".len() + 32);
        assert_ne!(key, prompt_cache_key("dream-weekly", "system prompt 2"));
        assert_ne!(key, prompt_cache_key("memory-candidate", "system prompt"));
    }
}
