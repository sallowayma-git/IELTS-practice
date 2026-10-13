//! Deterministic (zero-LLM) post-submit reading review analysis.
//!
//! These DTOs are derived from persisted attempt data on every read; they are
//! never stored as a separate source of truth. The generator lives in
//! `ielts-db::reading::analysis`.

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// Behaviour counters shown in the review strip. A metric is `None` when the
/// underlying signal was never recorded (e.g. no question timeline) so the UI
/// can hide it instead of showing an invented zero.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingAnalysisSignals {
    pub question_count: u32,
    pub answered_count: u32,
    pub unanswered_count: u32,
    pub correct_count: u32,
    pub incorrect_count: u32,
    pub marked_question_count: u32,
    #[serde(default)]
    pub changed_answer_count: Option<u32>,
    /// Recorded question visits + answer changes per minute of practice.
    #[serde(default)]
    pub interaction_density: Option<f64>,
    pub timeline_available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingAnalysisSummary {
    pub accuracy: f64,
    pub duration_sec: u64,
    pub unanswered_rate: f64,
    #[serde(default)]
    pub changed_answer_rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingKindPerformance {
    pub kind: String,
    pub label: String,
    pub total: u32,
    pub correct: u32,
    pub incorrect: u32,
    pub unanswered: u32,
    pub accuracy: f64,
    #[serde(default)]
    pub avg_elapsed_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingAnalysisRadar {
    pub by_question_kind: Vec<ReadingKindPerformance>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingDiagnosisItem {
    #[serde(rename = "type")]
    pub kind: String,
    /// `high` | `medium` | `low`
    pub severity: String,
    pub message: String,
    #[serde(default)]
    pub question_ids: Vec<String>,
    #[serde(default)]
    pub question_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ReadingNextAction {
    #[serde(rename = "type")]
    pub kind: String,
    pub target: String,
    pub instruction: String,
    #[serde(default)]
    pub question_ids: Vec<String>,
    #[serde(default)]
    pub question_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct SingleAttemptAnalysis {
    pub summary: ReadingAnalysisSummary,
    pub radar: ReadingAnalysisRadar,
    pub diagnosis: Vec<ReadingDiagnosisItem>,
    pub next_actions: Vec<ReadingNextAction>,
}
