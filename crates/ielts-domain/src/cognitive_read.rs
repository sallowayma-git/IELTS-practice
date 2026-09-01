use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const COGNITIVE_READ_SCHEMA_VERSION: u32 = 1;
pub const MAX_COGNITIVE_READ_LIMIT: u32 = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionFreshness {
    Fresh,
    Stale,
    Rebuilding,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationScope {
    pub kind: String,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationSnapshotQuery {
    #[serde(default)]
    pub namespaces: Vec<String>,
    #[serde(default)]
    pub scope: Option<ObservationScope>,
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub after_id: Option<String>,
    #[serde(default = "default_read_limit")]
    pub limit: u32,
}

impl Default for ObservationSnapshotQuery {
    fn default() -> Self {
        Self {
            namespaces: Vec::new(),
            scope: None,
            since: None,
            after_id: None,
            limit: default_read_limit(),
        }
    }
}

fn default_read_limit() -> u32 {
    100
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationEvidenceRef {
    pub event_id: String,
    pub evidence_role: String,
    pub ordinal: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationEnvelope {
    pub id: String,
    pub user_id: String,
    pub observation_type: String,
    pub namespace: String,
    pub scope_kind: String,
    pub scope_key: String,
    pub polarity: Option<String>,
    pub value_num: Option<f64>,
    pub value_text: Option<String>,
    pub payload: Value,
    pub confidence: f64,
    pub evidence_strength: f64,
    pub observed_at: String,
    pub projector_key: String,
    pub projector_version: i64,
    pub source_fingerprint: String,
    pub sensitivity: String,
    pub trust: String,
    pub evidence: Vec<ObservationEvidenceRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationSnapshot {
    pub schema_version: u32,
    pub projector_key: String,
    pub projector_version: i64,
    pub ledger_input_hash: String,
    pub observation_output_hash: String,
    pub generated_at: String,
    pub freshness: ProjectionFreshness,
    pub observations: Vec<ObservationEnvelope>,
    pub truncated: bool,
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationBatch {
    pub schema_version: u32,
    pub projector_key: String,
    pub projector_version: i64,
    pub ledger_input_hash: String,
    pub observation_output_hash: String,
    pub generated_at: String,
    pub freshness: ProjectionFreshness,
    pub observations: Vec<ObservationEnvelope>,
    pub missing_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventEvidence {
    pub id: String,
    pub user_id: String,
    pub event_type: String,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub activity: Option<String>,
    pub asset_id: Option<String>,
    pub attempt_id: Option<String>,
    pub question_id: Option<String>,
    pub skill_key: Option<String>,
    pub occurred_at: String,
    pub payload: Value,
    pub content_hash: String,
    pub schema_version: i64,
    pub sensitivity: String,
    pub trust: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventEvidenceBatch {
    pub schema_version: u32,
    pub events: Vec<LearningEventEvidence>,
    pub missing_ids: Vec<String>,
}
