use serde::{Deserialize, Serialize};

use crate::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct AttemptRecord {
    pub schema_version: u32,
    pub id: String,
    pub activity: Activity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub mode: AttemptMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suite_id: Option<String>,
    pub status: AttemptStatus,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score_value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score_scale: Option<ScoreScale>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correct_count: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_text: Option<String>,
    /// Canonical writing task classification. Reading attempts never set this;
    /// legacy writing attempts can remain unlabelled when the source did not
    /// preserve a trustworthy task type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_type: Option<WritingTaskType>,
    #[serde(default)]
    pub answers: Vec<AttemptAnswer>,
    #[serde(default)]
    pub annotations: Vec<AttemptAnnotationDto>,
}

impl AttemptRecord {
    pub const SCHEMA_VERSION: u32 = 1;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct AttemptAnswer {
    pub question_id: String,
    pub answer: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_correct: Option<bool>,
    #[serde(default = "default_weight")]
    pub weight: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_kind: Option<String>,
    #[serde(default)]
    pub change_count: u32,
    #[serde(default)]
    pub visit_count: u32,
    #[serde(default)]
    pub elapsed_ms: u64,
    #[serde(default)]
    pub marked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answered_at: Option<String>,
}

fn default_weight() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct AttemptAnnotationDto {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    pub asset_id: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    pub kind: String,
    pub anchor: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_text: Option<String>,
}
