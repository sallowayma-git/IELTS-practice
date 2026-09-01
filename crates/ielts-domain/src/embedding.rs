//! M5-04 Model Gateway embedding capability contracts.
//!
//! Rust owns the embedding provider secret and the request/response envelope.
//! Python asks for a batch through `model.embed.batch`; the Rust host resolves
//! the provider, returns vectors, and reports usage/latency for the
//! `llm_invocations` trace (kind = 'embedding').
//!
//! The contract is intentionally narrow: only texts in, vectors out, plus a
//! signature describing the model that produced them. Python persists that
//! signature in its derived index so any provider/model/dimension drift
//! invalidates every cached vector — stale vectors can never silently match.

use serde::{Deserialize, Serialize};

/// Schema version of the embedding wire contract (M5-04). Bumped only on a
/// wire-breaking change to the request/response envelope.
pub const EMBEDDING_SCHEMA_VERSION: u32 = 1;

/// Embedding batch request. Python sends plain texts; the Rust host owns the
/// provider, model, and dimension. Empty inputs are rejected by the host so a
/// caller can never probe the gateway with a zero-cost empty batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddingRequest {
    pub texts: Vec<String>,
}

impl EmbeddingRequest {
    pub fn new(texts: Vec<String>) -> Self {
        Self { texts }
    }
}

/// Token/latency accounting returned to the caller and mirrored into the
/// `llm_invocations` trace row. Mirrors `CompletionResponse` accounting so the
/// trace stays uniform across completion + embedding calls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddingUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Embedding batch response. `dimension` is the vector length the provider
/// returned for this batch; `vectors.len()` always equals `texts.len()` on
/// success. `usage`/`provider_request_id` mirror the completion contract so
/// the trace row stays uniform across `completion` and `embedding` kinds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddingResponse {
    pub request_id: String,
    pub model: String,
    pub dimension: u32,
    pub vectors: Vec<Vec<f32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<EmbeddingUsage>,
    pub latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
}

/// Embedding model signature. Python caches this in its derived index; any
/// change to provider/model/dimension/schema_version/config_hash invalidates
/// every cached vector so a stale model can never silently match a query.
///
/// `config_hash` lets the host pin a normalized provider configuration (e.g.
/// truncation/normalization knobs) without leaking secret material — it is a
/// opaque hash the host derives, never a raw credential.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmbeddingSignature {
    pub provider: String,
    pub model: String,
    pub dimension: u32,
    pub schema_version: u32,
    pub config_hash: String,
}

impl EmbeddingSignature {
    pub fn new(
        provider: impl Into<String>,
        model: impl Into<String>,
        dimension: u32,
        config_hash: impl Into<String>,
    ) -> Self {
        Self {
            provider: provider.into(),
            model: model.into(),
            dimension,
            schema_version: EMBEDDING_SCHEMA_VERSION,
            config_hash: config_hash.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trips_camel_case() {
        let request = EmbeddingRequest::new(vec!["hello".into(), "world".into()]);
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"texts\""));
        let back: EmbeddingRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back, request);
    }

    #[test]
    fn request_rejects_unknown_fields() {
        let json = r#"{"texts":["a"],"extra":1}"#;
        assert!(serde_json::from_str::<EmbeddingRequest>(json).is_err());
    }

    #[test]
    fn response_round_trips_with_optional_fields_absent() {
        let response = EmbeddingResponse {
            request_id: "req-1".into(),
            model: "embed-1".into(),
            dimension: 8,
            vectors: vec![vec![0.1, 0.2], vec![0.3, 0.4]],
            usage: None,
            latency_ms: 12,
            provider_request_id: None,
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"requestId\""));
        assert!(json.contains("\"latencyMs\""));
        assert!(!json.contains("usage"));
        assert!(!json.contains("providerRequestId"));
        let back: EmbeddingResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back, response);
    }

    #[test]
    fn signature_pins_schema_version() {
        let signature = EmbeddingSignature::new("openai", "text-embedding-3-small", 1536, "cfg-1");
        assert_eq!(signature.schema_version, EMBEDDING_SCHEMA_VERSION);
        let json = serde_json::to_string(&signature).unwrap();
        assert!(json.contains("\"configHash\""));
        assert!(json.contains("\"schemaVersion\""));
    }

    #[test]
    fn signature_rejects_unknown_fields() {
        let json = r#"{"provider":"p","model":"m","dimension":8,"schemaVersion":1,"configHash":"c","x":1}"#;
        assert!(serde_json::from_str::<EmbeddingSignature>(json).is_err());
    }
}
