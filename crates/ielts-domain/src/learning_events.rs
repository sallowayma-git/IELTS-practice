use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts-export", derive(TS), ts(export))]
pub enum LearningEventType {
    AttemptStarted,
    AnswerChanged,
    AttemptSubmitted,
    AttemptCompleted,
    ReadingQuestionOutcome,
    WritingEvaluationCompleted,
    CoachQuestionAsked,
    CoachResponseGenerated,
    CoachFeedbackProvided,
    VocabularyReviewCompleted,
    AnnotationCreated,
}

impl LearningEventType {
    pub const SCHEMA_VERSION: i64 = 1;

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AttemptStarted => "attempt_started",
            Self::AnswerChanged => "answer_changed",
            Self::AttemptSubmitted => "attempt_submitted",
            Self::AttemptCompleted => "attempt_completed",
            Self::ReadingQuestionOutcome => "reading_question_outcome",
            Self::WritingEvaluationCompleted => "writing_evaluation_completed",
            Self::CoachQuestionAsked => "coach_question_asked",
            Self::CoachResponseGenerated => "coach_response_generated",
            Self::CoachFeedbackProvided => "coach_feedback_provided",
            Self::VocabularyReviewCompleted => "vocabulary_review_completed",
            Self::AnnotationCreated => "annotation_created",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct LearningEvent {
    pub id: String,
    pub user_id: String,
    pub event_type: LearningEventType,
    pub source_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    pub idempotency_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_key: Option<String>,
    pub occurred_at: String,
    pub payload: serde_json::Value,
    pub content_hash: String,
    pub schema_version: i64,
    pub consolidation_state: String,
    pub sensitivity: String,
    pub created_at: String,
    pub updated_at: String,
}
