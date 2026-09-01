//! M10 Teaching Strategy Evolution / Procedural Memory domain contracts.
//!
//! Separates two reward channels:
//! - **User satisfaction** (`StrategyFeedbackKind`) — interaction facts (thumbs,
//!   reask, explicit correction, abandon). These never prove a strategy
//!   improved learning.
//! - **Learning outcome** (`StrategyOutcomeKind`) — later skill observations
//!   that fall within the attribution window of an assignment, preferring a
//!   novel asset. A thumbs-up is never stored as a learning outcome.
//!
//! The strategy catalog is a developer-defined enum (M10-01/08): the LLM may
//! only select from the set, and new strategies enter only via the candidate
//! gate (`StrategyCandidateBatch`, offline eval + developer-approved
//! prompt_module; never directly executable).
//!
//! Selection is rule-priority (M10-06): explicit preference > contraindication
//! filter > proven personal strategy > default > exploration slot (only when
//! evidence is sufficient). Per-user state aggregation (M10-05) is a bounded
//! success/(success+failure) confidence; no global reinforcement learning.

use serde::{Deserialize, Serialize};

pub const TEACHING_STRATEGY_SCHEMA_VERSION: u32 = 1;
pub const MAX_STRATEGY_WHY_SELECTED_BYTES: usize = 8 * 1024;
pub const MAX_STRATEGY_MEMORY_IDS: usize = 64;
pub const MAX_STRATEGY_SKILL_KEYS: usize = 32;

/// Minimum number of evidence rows (success + failure) before a personal
/// strategy is considered "proven" for selection (M10-06 rule 3).
pub const PROVEN_STRATEGY_MIN_EVIDENCE: u32 = 3;
/// Minimum evidence before the exploration slot is enabled (M10-06 rule 5).
pub const EXPLORATION_MIN_EVIDENCE: u32 = 3;
/// Fraction of selection that explores a non-default strategy when evidence is
/// sufficient (M10-06 rule 5). Kept small to avoid churn.
pub const EXPLORATION_SLOT_RATE: f64 = 0.10;
/// Default attribution window: number of subsequent relevant skill observations
/// after an assignment within which an outcome may be attributed (M10-04).
pub const DEFAULT_OUTCOME_WINDOW: u32 = 5;

/// M10-01/08: developer-defined teaching-strategy catalog. The M6 set of six
/// plus two new strategies (`error_then_rule_v1`, `rule_then_example_v1`).
/// The LLM cannot invent ids here; new strategies enter only via the candidate
/// gate and an offline eval + developer-approved prompt_module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeachingStrategyId {
    EvidenceFirstV1,
    ExampleFirstV1,
    StepByStepV1,
    ContrastiveV1,
    SocraticPromptV1,
    ConciseDirectV1,
    ErrorThenRuleV1,
    RuleThenExampleV1,
}

impl TeachingStrategyId {
    pub const ALL: [Self; 8] = [
        Self::EvidenceFirstV1,
        Self::ExampleFirstV1,
        Self::StepByStepV1,
        Self::ContrastiveV1,
        Self::SocraticPromptV1,
        Self::ConciseDirectV1,
        Self::ErrorThenRuleV1,
        Self::RuleThenExampleV1,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EvidenceFirstV1 => "evidence_first_v1",
            Self::ExampleFirstV1 => "example_first_v1",
            Self::StepByStepV1 => "step_by_step_v1",
            Self::ContrastiveV1 => "contrastive_v1",
            Self::SocraticPromptV1 => "socratic_prompt_v1",
            Self::ConciseDirectV1 => "concise_direct_v1",
            Self::ErrorThenRuleV1 => "error_then_rule_v1",
            Self::RuleThenExampleV1 => "rule_then_example_v1",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// M10-01: a developer-defined strategy catalog row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeachingStrategyCatalogEntry {
    pub strategy_id: TeachingStrategyId,
    pub applicable_activity: String,
    pub applicable_skill_kind: String,
    pub prompt_module: String,
    pub contraindications: Vec<String>,
    pub max_verbosity: i64,
    pub version: i64,
    pub is_default: bool,
}

/// M10-03: SATISFACTION reward channel kinds. These are user-interaction
/// facts. They are stored on `teaching_strategy_feedback` and are never
/// treated as evidence that the strategy improved learning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategyFeedbackKind {
    ThumbsUp,
    ThumbsDown,
    Reask,
    ExplicitCorrection,
    Abandon,
}

impl StrategyFeedbackKind {
    pub const ALL: [Self; 5] = [
        Self::ThumbsUp,
        Self::ThumbsDown,
        Self::Reask,
        Self::ExplicitCorrection,
        Self::Abandon,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ThumbsUp => "thumbs_up",
            Self::ThumbsDown => "thumbs_down",
            Self::Reask => "reask",
            Self::ExplicitCorrection => "explicit_correction",
            Self::Abandon => "abandon",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// M10-03: LEARNING reward channel kinds. Recorded on
/// `teaching_strategy_outcomes` only when a later skill observation falls
/// within the attribution window, preferring a novel asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategyOutcomeKind {
    NextNovelSkillAttempt,
    NextWritingRevision,
    CorrectedRepeatedBehavior,
    TransferToAnotherAsset,
}

impl StrategyOutcomeKind {
    pub const ALL: [Self; 4] = [
        Self::NextNovelSkillAttempt,
        Self::NextWritingRevision,
        Self::CorrectedRepeatedBehavior,
        Self::TransferToAnotherAsset,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NextNovelSkillAttempt => "next_novel_skill_attempt",
            Self::NextWritingRevision => "next_writing_revision",
            Self::CorrectedRepeatedBehavior => "corrected_repeated_behavior",
            Self::TransferToAnotherAsset => "transfer_to_another_asset",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// M10-08: disposition of an LLM-proposed candidate strategy batch. Only a
/// `pending` or `eval` candidate may move to `promoted`; a `rejected` batch is
/// never executable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategyCandidateDisposition {
    Pending,
    Eval,
    Rejected,
    Promoted,
}

impl StrategyCandidateDisposition {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Eval => "eval",
            Self::Rejected => "rejected",
            Self::Promoted => "promoted",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "eval" => Some(Self::Eval),
            "rejected" => Some(Self::Rejected),
            "promoted" => Some(Self::Promoted),
            _ => None,
        }
    }
}

/// M10-02: record the teaching-strategy assignment for a response message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStrategyAssignmentCommand {
    pub user_id: String,
    pub strategy_id: TeachingStrategyId,
    pub why_selected: serde_json::Value,
    #[serde(default)]
    pub memory_ids: Vec<String>,
    #[serde(default)]
    pub skill_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_snapshot_id: Option<String>,
    pub response_message_id: String,
}

/// M10-02: the persisted assignment record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyAssignmentRecord {
    pub id: String,
    pub user_id: String,
    pub strategy_id: TeachingStrategyId,
    pub why_selected: serde_json::Value,
    pub memory_ids: Vec<String>,
    pub skill_keys: Vec<String>,
    pub context_snapshot_id: Option<String>,
    pub response_message_id: String,
    pub created_at: String,
}

/// M10-03: record a SATISFACTION feedback fact against an assignment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStrategyFeedbackCommand {
    pub assignment_id: String,
    pub feedback_kind: StrategyFeedbackKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyFeedbackRecord {
    pub id: String,
    pub assignment_id: String,
    pub feedback_kind: StrategyFeedbackKind,
    pub created_at: String,
}

/// M10-03/04: record a LEARNING outcome. This is only accepted when the
/// outcome falls within the attribution window of the assignment and (for
/// repeated-asset outcomes) prefers a novel asset. A satisfaction feedback on
/// the same assignment is never stored here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStrategyOutcomeCommand {
    pub assignment_id: String,
    pub outcome_kind: StrategyOutcomeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub novel_asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score_delta: Option<f64>,
}

/// M10-04: the attribution decision returned by `record_strategy_outcome`. The
/// service never silently coerces an out-of-window or same-asset observation
/// into a learning outcome.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum OutcomeAttribution {
    /// The outcome was recorded on the learning channel.
    Attributed {
        record: StrategyOutcomeRecord,
        /// Whether the outcome used a novel asset (true) or was a discounted
        /// repeated-asset attempt (false). M10-04 prefers novel assets.
        novel_asset: bool,
    },
    /// The observation fell outside the attribution window (too many
    /// subsequent relevant skill observations elapsed). No outcome is recorded.
    OutOfWindow,
    /// The assignment has no context snapshot, so the skill context required
    /// to attribute an outcome is missing. No outcome is recorded.
    MissingContextSnapshot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyOutcomeRecord {
    pub id: String,
    pub assignment_id: String,
    pub outcome_kind: StrategyOutcomeKind,
    pub observation_id: Option<String>,
    pub novel_asset_id: Option<String>,
    pub score_delta: Option<f64>,
    pub created_at: String,
}

/// M10-05: per-user strategy state aggregate, scoped by activity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStrategyState {
    pub user_id: String,
    pub strategy_id: TeachingStrategyId,
    pub scope: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub satisfaction_count: i64,
    pub reask_count: i64,
    pub novel_transfer_success: i64,
    pub last_used: Option<String>,
    pub confidence: f64,
    pub updated_at: String,
}

impl UserStrategyState {
    /// Total evidence rows (success + failure) for this state.
    pub fn evidence_count(&self) -> u32 {
        (self.success_count.max(0) + self.failure_count.max(0)) as u32
    }

    /// Bounded confidence formula: success / (success + failure), clamped to
    /// [0, 1]. Returns 0 when there is no evidence. No global reinforcement
    /// learning is performed (M10-05).
    pub fn clamp_confidence(success: i64, failure: i64) -> f64 {
        let s = success.max(0) as f64;
        let f = failure.max(0) as f64;
        let denom = s + f;
        if denom <= 0.0 {
            0.0
        } else {
            (s / denom).clamp(0.0, 1.0)
        }
    }
}

/// M10-06: select a strategy for the next response. Rule-priority: explicit
/// preference > contraindication filter > proven personal strategy > default >
/// exploration slot (only when evidence is sufficient).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectStrategyCommand {
    pub user_id: String,
    pub scope: String,
    pub skill_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit_preference: Option<TeachingStrategyId>,
    #[serde(default)]
    pub memory_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_snapshot_id: Option<String>,
}

/// M10-06: the machine-readable reason a strategy was selected. This is what
/// the coach can surface to explain "why this strategy was used".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrategySelectionReason {
    ExplicitPreference,
    ProvenPersonal,
    Default,
    Exploration,
}

impl StrategySelectionReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ExplicitPreference => "explicit_preference",
            Self::ProvenPersonal => "proven_personal",
            Self::Default => "default",
            Self::Exploration => "exploration",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategySelection {
    pub strategy_id: TeachingStrategyId,
    pub reason: StrategySelectionReason,
    /// Human-readable explanation for the coach/UI (M10-07: respect explicit
    /// preference; explain the recommendation; give the user a choice).
    pub why_selected: serde_json::Value,
}

/// M10-08: record an LLM-proposed candidate strategy batch. Pending/eval
/// candidates are never directly executable; promotion requires offline eval +
/// a developer-approved prompt_module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStrategyCandidateBatchCommand {
    pub batch: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyCandidateBatchRecord {
    pub id: String,
    pub batch: serde_json::Value,
    pub disposition: StrategyCandidateDisposition,
    pub created_at: String,
}

/// M10-08: a persisted verdict from the offline evaluator for one candidate
/// batch. The promotion gate reads this record; it never trusts a promotion
/// request's boolean as evaluation evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyCandidateEvaluationRecord {
    pub id: String,
    pub batch_id: String,
    pub passed: bool,
    pub metrics: serde_json::Value,
    pub created_at: String,
}

/// M10-08: ask the Rust-owned offline evaluator to evaluate a candidate batch.
/// The caller supplies only the batch identity. The verdict and metrics are
/// computed from the persisted batch and cannot be supplied over IPC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStrategyCandidateEvaluationCommand {
    pub batch_id: String,
}

/// M10-08: promote or reject a candidate batch. Promotion is the offline-eval
/// gate: a promoted candidate still requires a developer-defined
/// `prompt_module` before it becomes executable (the catalog enum is the
/// authoritative executable set).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteStrategyCandidateCommand {
    pub batch_id: String,
    /// `true` to promote (mark for offline-eval approval); `false` to reject.
    pub promote: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyCandidateDecision {
    pub batch_id: String,
    pub disposition: StrategyCandidateDisposition,
}
