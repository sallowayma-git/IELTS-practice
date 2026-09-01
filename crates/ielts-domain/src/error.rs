//! Unified error envelope for commands and adapters.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "ts-export")]
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct ErrorEnvelope {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause_id: Option<String>,
}

impl ErrorEnvelope {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            context: None,
            cause_id: None,
        }
    }

    pub fn with_context(mut self, context: serde_json::Value) -> Self {
        self.context = Some(context);
        self
    }

    pub fn with_cause_id(mut self, cause_id: impl Into<String>) -> Self {
        self.cause_id = Some(cause_id.into());
        self
    }
}

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("{0}")]
    Message(String),
    #[error("invalid payload: {0}")]
    InvalidPayload(String),
    #[error("unsupported schema version: {0}")]
    UnsupportedSchema(String),
}

impl DomainError {
    pub fn envelope(&self) -> ErrorEnvelope {
        match self {
            Self::Message(message) => ErrorEnvelope::new("domain.message", message, false),
            Self::InvalidPayload(message) => {
                ErrorEnvelope::new("domain.invalid_payload", message, false)
            }
            Self::UnsupportedSchema(version) => ErrorEnvelope::new(
                "domain.unsupported_schema",
                format!("unsupported schema version: {version}"),
                false,
            ),
        }
    }
}

pub type DomainResult<T> = Result<T, DomainError>;
