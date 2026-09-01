//! M6 Coach closed-loop domain contracts.
//!
//! These types describe canonical coach feedback facts (user interaction), the
//! teaching-strategy provenance recorded alongside a coach response, re-ask
//! linkage, and outcome links between a strategy assignment and a future
//! observation. They are interaction facts, not long-term preferences: M6-07
//! only promotes repeated patterns to memory candidates after later evidence.
//!
//! The Rust `CoachService` baseline remains the fallback path; these tables
//! record the provenance that PythonPersonalizedCoach / Slice 3 AttemptReview
//! consume. The strategy catalog is a fixed M6 enum (no LLM-invented strategies).

use serde::{Deserialize, Serialize};

pub const COACH_FEEDBACK_SCHEMA_VERSION: u32 = 1;
pub const MAX_COACH_FEEDBACK_PAYLOAD_BYTES: usize = 8 * 1024;
pub const MAX_COACH_STRATEGY_SKILLS: usize = 32;
pub const MAX_COACH_STRATEGY_MEMORY_IDS: usize = 64;

/// Canonical user-interaction feedback kinds for a coach message.
///
/// M6-05: these are interaction facts. They are not long-term preferences on
/// their own; M6-07 promotes repeated patterns to memory candidates after
/// later outcomes confirm a stable preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachFeedbackKind {
    ThumbsUp,
    ThumbsDown,
    TooLong,
    TooShort,
    TooAbstract,
    NeedExample,
    NeedStepByStep,
    Incorrect,
    NotRelevant,
    ReaskSameQuestion,
    StyleCorrection,
}

impl CoachFeedbackKind {
    pub const ALL: [Self; 11] = [
        Self::ThumbsUp,
        Self::ThumbsDown,
        Self::TooLong,
        Self::TooShort,
        Self::TooAbstract,
        Self::NeedExample,
        Self::NeedStepByStep,
        Self::Incorrect,
        Self::NotRelevant,
        Self::ReaskSameQuestion,
        Self::StyleCorrection,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ThumbsUp => "thumbs_up",
            Self::ThumbsDown => "thumbs_down",
            Self::TooLong => "too_long",
            Self::TooShort => "too_short",
            Self::TooAbstract => "too_abstract",
            Self::NeedExample => "need_example",
            Self::NeedStepByStep => "need_step_by_step",
            Self::Incorrect => "incorrect",
            Self::NotRelevant => "not_relevant",
            Self::ReaskSameQuestion => "reask_same_question",
            Self::StyleCorrection => "style_correction",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }
}

/// M6-09: fixed M6 teaching-strategy catalog. The LLM may only select from
/// this set; it cannot invent new strategy ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachStrategyId {
    EvidenceFirstV1,
    ExampleFirstV1,
    StepByStepV1,
    ContrastiveV1,
    SocraticPromptV1,
    ConciseDirectV1,
}

impl CoachStrategyId {
    pub const ALL: [Self; 6] = [
        Self::EvidenceFirstV1,
        Self::ExampleFirstV1,
        Self::StepByStepV1,
        Self::ContrastiveV1,
        Self::SocraticPromptV1,
        Self::ConciseDirectV1,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EvidenceFirstV1 => "evidence_first_v1",
            Self::ExampleFirstV1 => "example_first_v1",
            Self::StepByStepV1 => "step_by_step_v1",
            Self::ContrastiveV1 => "contrastive_v1",
            Self::SocraticPromptV1 => "socratic_prompt_v1",
            Self::ConciseDirectV1 => "concise_direct_v1",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// Coach follow-up intent recorded alongside the strategy assignment.
///
/// M6-04 records this provenance so M10 can attribute later outcomes to the
/// chosen strategy; the LLM does not learn weights in M6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachFollowupType {
    Explain,
    Example,
    StepByStep,
    Contrast,
    SocraticPrompt,
    ConciseDirect,
    None,
}

impl CoachFollowupType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Explain => "explain",
            Self::Example => "example",
            Self::StepByStep => "step_by_step",
            Self::Contrast => "contrast",
            Self::SocraticPrompt => "socratic_prompt",
            Self::ConciseDirect => "concise_direct",
            Self::None => "none",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "explain" => Some(Self::Explain),
            "example" => Some(Self::Example),
            "step_by_step" => Some(Self::StepByStep),
            "contrast" => Some(Self::Contrast),
            "socratic_prompt" => Some(Self::SocraticPrompt),
            "concise_direct" => Some(Self::ConciseDirect),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// M6-10: outcome dimension for a strategy assignment. Satisfaction (user
/// feedback) and learning (later skill observation) are recorded on separate
/// rows; a thumbs-up is never treated as a learning outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoachOutcomeKind {
    Satisfaction,
    Learning,
}

impl CoachOutcomeKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Satisfaction => "satisfaction",
            Self::Learning => "learning",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "satisfaction" => Some(Self::Satisfaction),
            "learning" => Some(Self::Learning),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordCoachFeedbackCommand {
    pub user_id: String,
    pub coach_message_id: String,
    pub feedback_kind: CoachFeedbackKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachFeedbackRecord {
    pub id: String,
    pub user_id: String,
    pub coach_message_id: String,
    pub feedback_kind: CoachFeedbackKind,
    pub payload: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordReaskLinkCommand {
    pub user_id: String,
    pub parent_assistant_message_id: String,
    pub new_user_message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachReaskLinkRecord {
    pub parent_assistant_message_id: String,
    pub new_user_message_id: String,
    pub feedback_kind: CoachFeedbackKind,
    pub created_at: String,
}

/// M6-04: strategy assignment provenance for a coach response. The body text
/// remains natural language; this metadata records what teaching form was used
/// and which context/memory fed the response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordCoachStrategyAssignmentCommand {
    pub user_id: String,
    pub coach_message_id: String,
    pub strategy_id: CoachStrategyId,
    #[serde(default)]
    pub skills_addressed: Vec<String>,
    #[serde(default)]
    pub memory_ids_used: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_snapshot_id: Option<String>,
    pub followup_type: CoachFollowupType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachStrategyAssignmentRecord {
    pub id: String,
    pub user_id: String,
    pub coach_message_id: String,
    pub strategy_id: CoachStrategyId,
    pub skills_addressed: Vec<String>,
    pub memory_ids_used: Vec<String>,
    pub context_snapshot_id: Option<String>,
    pub followup_type: CoachFollowupType,
    pub created_at: String,
}

/// M6-10: link a strategy assignment to a future observation. Satisfaction and
/// learning outcomes are recorded on separate rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkCoachOutcomeCommand {
    pub strategy_assignment_id: String,
    pub future_observation_id: String,
    pub outcome_kind: CoachOutcomeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachOutcomeLinkRecord {
    pub strategy_assignment_id: String,
    pub future_observation_id: String,
    pub outcome_kind: CoachOutcomeKind,
    pub created_at: String,
}
