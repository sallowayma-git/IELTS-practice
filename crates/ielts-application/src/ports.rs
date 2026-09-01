use async_trait::async_trait;
use ielts_db::{
    AppendCoachMessageCommand, CoachMessage, EvaluationEvent, EvaluationRunResult,
    PreparedEvaluation, ProviderError, RecordCoachFailureCommand, StartEvaluationCommand,
};
use ielts_domain::dto::{WritingFeedbackV4, WritingScoreV4};
use ielts_domain::{EmbeddingRequest, EmbeddingResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    /// Round-3 audit (7.8): optional provider-side output ceiling. `None` keeps
    /// the historical request shape byte-identical, so this is additive for both
    /// the existing Rust callers and the Python sidecar, which sends only
    /// `messages` + `temperature`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
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
}

impl ModelError {
    pub fn new(message: impl Into<String>, retryable: bool) -> Self {
        Self {
            message: message.into(),
            retryable,
        }
    }
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
}
