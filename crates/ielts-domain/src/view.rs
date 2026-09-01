//! Presentation view models derived from canonical domain records.
//! These are the only shapes the Vue UI should consume after migration.

use serde::{Deserialize, Serialize};

use crate::domain::{
    Activity, AttemptMode, AttemptStatus, EvaluationStatus, ScoreScale, WritingTaskType,
};
use crate::dto::{AttemptRecord, WritingEvaluationV4, WritingScoreV4};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct HistoryListItemVm {
    pub id: String,
    pub activity: Activity,
    pub title: String,
    pub status: AttemptStatus,
    pub mode: AttemptMode,
    pub submitted_at: Option<String>,
    pub duration_ms: u64,
    /// Display score number (accuracy 0-1 or band 0-9).
    pub score_value: Option<f64>,
    pub score_scale: Option<ScoreScale>,
    /// Human label: "Accuracy" or "Overall Band".
    pub score_label: String,
    pub score_display: String,
    /// Reading/writing asset id when known (field contraction OK if absent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// Session/attempt id used by review routes (same as `id` for current store).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Suite session id when this attempt is part of a reading suite.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suite_id: Option<String>,
    /// Persisted writing classification. `None` means a legacy writing record
    /// cannot be classified safely; clients must display it as unlabelled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_type: Option<WritingTaskType>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingResultVm {
    pub attempt_id: String,
    pub title: String,
    pub task_type: Option<String>,
    pub status: EvaluationStatus,
    pub score: Option<WritingScoreV4>,
    pub overall_feedback: Option<String>,
    pub plan: Vec<String>,
    pub paragraph_count: usize,
    pub sentence_count: usize,
    pub degraded: bool,
    pub degradation_reason: Option<String>,
    pub error_message: Option<String>,
}

pub fn history_item_from_attempt(attempt: &AttemptRecord) -> HistoryListItemVm {
    let (score_label, score_display) =
        match (attempt.activity, attempt.score_value, attempt.score_scale) {
            (Activity::Reading, Some(v), _) => {
                let pct = (v * 100.0).round();
                ("Accuracy".to_string(), format!("{pct:.0}%"))
            }
            (Activity::Writing, Some(v), _) => ("Overall Band".to_string(), format!("{v:.1}")),
            (Activity::Reading, None, _) => ("Accuracy".to_string(), "—".to_string()),
            (Activity::Writing, None, _) => ("Overall Band".to_string(), "—".to_string()),
        };

    HistoryListItemVm {
        id: attempt.id.clone(),
        activity: attempt.activity,
        title: attempt
            .title_snapshot
            .clone()
            .unwrap_or_else(|| "Untitled".to_string()),
        status: attempt.status,
        mode: attempt.mode,
        submitted_at: attempt.submitted_at.clone(),
        duration_ms: attempt.duration_ms,
        score_value: attempt.score_value,
        score_scale: attempt.score_scale,
        score_label,
        score_display,
        asset_id: attempt.asset_id.clone(),
        session_id: Some(attempt.id.clone()),
        suite_id: attempt.suite_id.clone(),
        task_type: attempt.task_type,
    }
}

pub fn writing_result_from_evaluation(
    attempt_id: impl Into<String>,
    title: impl Into<String>,
    evaluation: &WritingEvaluationV4,
) -> WritingResultVm {
    WritingResultVm {
        attempt_id: attempt_id.into(),
        title: title.into(),
        task_type: evaluation
            .task_type
            .map(|t| format!("{t:?}").to_ascii_lowercase()),
        status: evaluation.status,
        score: evaluation.score.clone(),
        overall_feedback: evaluation.feedback.as_ref().and_then(|f| f.overall.clone()),
        plan: evaluation
            .feedback
            .as_ref()
            .map(|f| f.plan.clone())
            .unwrap_or_default(),
        paragraph_count: evaluation
            .feedback
            .as_ref()
            .map(|f| f.paragraphs.len())
            .unwrap_or(0),
        sentence_count: evaluation
            .feedback
            .as_ref()
            .map(|f| f.sentences.len())
            .unwrap_or(0),
        degraded: evaluation.degradation.is_some()
            || matches!(evaluation.status, EvaluationStatus::Degraded),
        degradation_reason: evaluation.degradation.as_ref().map(|d| d.reason.clone()),
        error_message: evaluation.error.as_ref().map(|e| e.message.clone()),
    }
}
