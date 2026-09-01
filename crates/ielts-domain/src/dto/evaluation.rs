use serde::{Deserialize, Serialize};

use crate::domain::{EvaluationStage, EvaluationStatus, WritingTaskType};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// Canonical writing evaluation result (v4). No legacy aliases allowed on write.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingEvaluationV4 {
    pub schema_version: u32,
    /// Stable persisted evaluation identity. Empty only for legacy payloads
    /// before they are attached to a v4 persistence row.
    #[serde(default)]
    pub id: String,
    pub status: EvaluationStatus,
    pub stage: EvaluationStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_type: Option<WritingTaskType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<WritingScoreV4>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnosis: Option<WritingDiagnosisV4>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feedback: Option<WritingFeedbackV4>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degradation: Option<EvaluationDegradation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<crate::error::ErrorEnvelope>,
}

impl WritingEvaluationV4 {
    pub const SCHEMA_VERSION: u32 = 4;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingScoreV4 {
    pub overall: f64,
    pub task_response: f64,
    pub coherence: f64,
    pub lexical: f64,
    pub grammar: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingDiagnosisV4 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingFeedbackV4 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overall: Option<String>,
    #[serde(default)]
    pub plan: Vec<String>,
    #[serde(default)]
    pub paragraphs: Vec<ParagraphFeedback>,
    #[serde(default)]
    pub sentences: Vec<SentenceFeedback>,
    #[serde(default)]
    pub rewrites: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ParagraphFeedback {
    pub paragraph_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default)]
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct SentenceFeedback {
    pub sentence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct EvaluationDegradation {
    pub stage: EvaluationStage,
    pub reason: String,
    #[serde(default)]
    pub missing: Vec<String>,
}

/// Persistence row for writing_evaluations (not the full AI raw dump).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingEvaluationRecord {
    pub id: String,
    pub attempt_id: String,
    pub status: EvaluationStatus,
    pub stage: EvaluationStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub rubric_version: String,
    pub prompt_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<WritingEvaluationV4>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub degradation: Option<EvaluationDegradation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<crate::error::ErrorEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub updated_at: String,
}
