//! M8 Weekly Dream consolidation domain contracts (§23.16 / §23.17).
//!
//! These types describe the cross-scope pattern proposal that the Python
//! Weekly Dream orchestration produces, and the Rust-side validator that
//! re-checks every proposed pattern against the durable store before any
//! consolidation touches active memory.
//!
//! The validator is the authority: the LLM proposes patterns with stable
//! memory IDs, Rust re-loads those IDs from the DB (never trusting the LLM
//! index), runs the four TechSpar Stage 3 gates plus the IELTS-specific
//! falsifiability / predicted-only / forbidden-kind gates, and only then
//! promotes a `ValidatedPattern`. Empty output is success: better zero
//! patterns than a wrong pattern (M8-01).

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

pub const CONSOLIDATION_SCHEMA_VERSION: u32 = 1;

/// Minimum supported counts. These are conservative defaults; the
/// application layer may override them through `ConsolidationConfig`.
pub const DEFAULT_MIN_SUPPORTS: usize = 3;
pub const DEFAULT_MIN_NEW_EVIDENCE: usize = 3;
pub const DEFAULT_MIN_DISTINCT_ASSETS: usize = 2;
pub const DEFAULT_MIN_DISTINCT_SCOPES: usize = 2;
pub const DEFAULT_COOLDOWN_DAYS: i64 = 6;
pub const MAX_PATTERN_STATEMENT_BYTES: usize = 4 * 1024;
pub const MAX_PATTERN_SUPPORT_IDS: usize = 32;
pub const MIN_PATTERN_SUPPORT_IDS: usize = 1;

/// Fixed M8 pattern-kind enum (M8-05). The LLM may only select from this set;
/// it cannot invent new kinds. Medical / personality / intelligence /
/// mental-health patterns are rejected both here (enum membership) and in the
/// Rust validator (statement scan) so a model that returns a forbidden kind as
/// a free-text statement is still blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum PatternKind {
    CrossSkillStrategy,
    MetacognitivePattern,
    BehaviorPattern,
    StableLearningPreference,
    RecurrentLanguagePattern,
}

impl PatternKind {
    pub const ALL: [Self; 5] = [
        Self::CrossSkillStrategy,
        Self::MetacognitivePattern,
        Self::BehaviorPattern,
        Self::StableLearningPreference,
        Self::RecurrentLanguagePattern,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CrossSkillStrategy => "cross_skill_strategy",
            Self::MetacognitivePattern => "metacognitive_pattern",
            Self::BehaviorPattern => "behavior_pattern",
            Self::StableLearningPreference => "stable_learning_preference",
            Self::RecurrentLanguagePattern => "recurrent_language_pattern",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }

    /// Cross-cutting patterns require ≥2 independent skill scopes (M8-03).
    pub const fn is_cross_cutting(self) -> bool {
        matches!(
            self,
            Self::CrossSkillStrategy | Self::MetacognitivePattern
        )
    }
}

/// Stable-ID pattern proposal produced by the Python Weekly Dream. The LLM is
/// given stable `mem-*` IDs and returns `supportingMemoryIds`; the Rust
/// validator re-loads those IDs from the DB (M8-02 — never trust the LLM
/// index). `confidence_proposal` is the LLM's self-reported confidence; the
/// Rust validator may downgrade or reject it based on evidence thresholds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct PatternProposal {
    pub statement: String,
    pub supporting_memory_ids: Vec<String>,
    pub pattern_kind: PatternKind,
    pub confidence_proposal: f64,
}

/// A pattern that passed all Rust-side gates and is ready for consolidation
/// apply. `support_ids` is the Rust-verified subset of the proposal's
/// `supporting_memory_ids` that actually exist, are active, and are not
/// predicted-only. The validator never invents supports the LLM did not
/// return — it only filters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct ValidatedPattern {
    pub statement: String,
    pub support_ids: Vec<String>,
    pub pattern_kind: PatternKind,
    pub confidence: f64,
    pub distinct_asset_count: usize,
    pub distinct_scope_count: usize,
}

/// Machine-readable reason a proposal was rejected. Carried in the
/// validator report so Python can log it without parsing free text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "code", rename_all_fields = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum RejectReason {
    // Two variants below are deliberately never constructed by the Rust
    // validator, and that is the correct state rather than a gap:
    //
    // - `ForbiddenPatternKind` is the enum-membership half of M8-05. Because
    //   `PatternKind` is a closed serde enum, a forbidden kind fails to
    //   deserialize before a `PatternProposal` ever exists, so the validator
    //   cannot receive one to reject. The free-text half of that contract IS
    //   enforced, as `ForbiddenStatementContent` (see
    //   `text_guard::contains_forbidden_inference_domain`).
    // - `NotFalsifiable` requires a semantic judgement about whether a claim
    //   could be contradicted by future practice evidence. No deterministic
    //   predicate decides that honestly, and inventing a keyword heuristic
    //   would reject valid patterns while passing invalid ones. It is reserved
    //   for the M11 LLM trace-grader path, which fails closed.
    //
    // Both stay in the vocabulary so the wire contract is stable and a future
    // grader has a reason code to report.
    BelowMinSupports { provided: usize, required: usize },
    InsufficientDistinctAssets { provided: usize, required: usize },
    InsufficientDistinctScopes { provided: usize, required: usize },
    PredictedOnlySupport { support_id: String },
    SupersededSupport { support_id: String },
    StatementTooShort,
    StatementTooLong { provided: usize, max: usize },
    NotFalsifiable,
    ForbiddenPatternKind,
    ForbiddenStatementContent,
    HallucinatedSupportId { support_id: String },
    TooManySupportIds { provided: usize, max: usize },
}

impl RejectReason {
    pub fn code(&self) -> &'static str {
        match self {
            Self::BelowMinSupports { .. } => "below_min_supports",
            Self::InsufficientDistinctAssets { .. } => "insufficient_distinct_assets",
            Self::InsufficientDistinctScopes { .. } => "insufficient_distinct_scopes",
            Self::PredictedOnlySupport { .. } => "predicted_only_support",
            Self::SupersededSupport { .. } => "superseded_support",
            Self::StatementTooShort => "statement_too_short",
            Self::StatementTooLong { .. } => "statement_too_long",
            Self::NotFalsifiable => "not_falsifiable",
            Self::ForbiddenPatternKind => "forbidden_pattern_kind",
            Self::ForbiddenStatementContent => "forbidden_statement_content",
            Self::HallucinatedSupportId { .. } => "hallucinated_support_id",
            Self::TooManySupportIds { .. } => "too_many_support_ids",
        }
    }
}

/// Per-pattern validator outcome. Empty `validated` is success (M8-01: better
/// zero patterns than a wrong pattern).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct PatternValidationReport {
    pub schema_version: u32,
    pub validated: Vec<ValidatedPattern>,
    pub rejected: Vec<PatternRejection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct PatternRejection {
    pub statement: String,
    pub reason: RejectReason,
}

/// Tunable thresholds for the validator. All fields are config so longitudinal
/// fixtures can adjust them without code changes (M8-03).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsolidationConfig {
    pub min_supports: usize,
    pub min_new_evidence: usize,
    pub min_distinct_assets: usize,
    pub min_distinct_scopes: usize,
    pub cooldown_days: i64,
}

impl Default for ConsolidationConfig {
    fn default() -> Self {
        Self {
            min_supports: DEFAULT_MIN_SUPPORTS,
            min_new_evidence: DEFAULT_MIN_NEW_EVIDENCE,
            min_distinct_assets: DEFAULT_MIN_DISTINCT_ASSETS,
            min_distinct_scopes: DEFAULT_MIN_DISTINCT_SCOPES,
            cooldown_days: DEFAULT_COOLDOWN_DAYS,
        }
    }
}

/// M8-06 consolidation apply receipt: the new consolidated memory id plus the
/// relations created. Old supports are NOT physically deleted; they are marked
/// `superseded` per policy and a `supports_consolidation` relation preserves
/// the lineage so the consolidation is reversible.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct ConsolidationReceipt {
    pub consolidated_memory_id: String,
    pub support_ids: Vec<String>,
    pub relations_created: usize,
}

/// M8-07 propagation outcome for a single support change. The consolidated
/// pattern's confidence is decayed (not deleted) when a support improves; if
/// all supports are refuted/improved the pattern is archived (not deleted).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum SupportChangeOutcome {
    NoPatternAffected,
    ConfidenceDecayed,
    PatternArchived,
}

/// M8-08 per-kind stale-archive policy. `NeverAuto` kinds are skipped by the
/// automatic sweep; they only archive on explicit user/policy action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum ArchivePolicy {
    Fast,
    Medium,
    Slow,
    NeverAuto,
    ValidityDriven,
}

impl ArchivePolicy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Medium => "medium",
            Self::Slow => "slow",
            Self::NeverAuto => "never_auto",
            Self::ValidityDriven => "validity_driven",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "fast" => Some(Self::Fast),
            "medium" => Some(Self::Medium),
            "slow" => Some(Self::Slow),
            "never_auto" => Some(Self::NeverAuto),
            "validity_driven" => Some(Self::ValidityDriven),
            _ => None,
        }
    }

    /// Default archive-after-days for each policy. `None` means the kind is
    /// never auto-archived by the stale sweep.
    pub const fn archive_after_days(self) -> Option<i64> {
        match self {
            Self::Fast => Some(21),
            Self::Medium => Some(60),
            Self::Slow => Some(120),
            Self::NeverAuto | Self::ValidityDriven => None,
        }
    }
}

/// M8-09 user feedback verdict against a stable memory_id. `Inaccurate` is
/// strong contradiction evidence but does NOT delete the underlying learning
/// facts — it only records a feedback row and triggers M8-07 contradiction
/// propagation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum MemoryFeedbackKind {
    Accurate,
    Inaccurate,
    PartiallyAccurate,
    Outdated,
    NotAboutMe,
    Acknowledged,
}

impl MemoryFeedbackKind {
    pub const ALL: [Self; 6] = [
        Self::Accurate,
        Self::Inaccurate,
        Self::PartiallyAccurate,
        Self::Outdated,
        Self::NotAboutMe,
        Self::Acknowledged,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Accurate => "accurate",
            Self::Inaccurate => "inaccurate",
            Self::PartiallyAccurate => "partially_accurate",
            Self::Outdated => "outdated",
            Self::NotAboutMe => "not_about_me",
            Self::Acknowledged => "acknowledged",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }

    /// `inaccurate` is the strong contradiction verdict that triggers M8-07
    /// decay propagation on the affected memory and any pattern it supports.
    pub const fn is_contradiction(self) -> bool {
        matches!(self, Self::Inaccurate)
    }

    /// `outdated` and `not_about_me` archive the memory without deleting it.
    pub const fn archives_memory(self) -> bool {
        matches!(self, Self::Outdated | Self::NotAboutMe)
    }
}

/// M8-06 relation kinds stored in `memory_relations`. The most common edge is
/// `SupportsConsolidation` (a lower-level support feeds a higher-level
/// pattern). `Supersedes` mirrors `memory_items.supersedes_id` so the relation
/// graph is queryable without a self-join.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum MemoryRelationKind {
    SupportsConsolidation,
    Supersedes,
    Contradicts,
    DecaysInto,
}

impl MemoryRelationKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SupportsConsolidation => "supports_consolidation",
            Self::Supersedes => "supersedes",
            Self::Contradicts => "contradicts",
            Self::DecaysInto => "decays_into",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "supports_consolidation" => Some(Self::SupportsConsolidation),
            "supersedes" => Some(Self::Supersedes),
            "contradicts" => Some(Self::Contradicts),
            "decays_into" => Some(Self::DecaysInto),
            _ => None,
        }
    }
}

/// M8-08 stale-archive sweep report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct StaleArchiveReport {
    pub archived_count: usize,
    pub skipped_kinds: Vec<String>,
    pub policy_by_kind: Vec<(String, String)>,
}

/// M8-09 recorded feedback row (serialize-only DTO; the DB row uses stable
/// memory_id + feedback_kind strings).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct MemoryFeedbackRecord {
    pub id: String,
    pub memory_id: String,
    pub feedback_kind: MemoryFeedbackKind,
    pub user_id: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

/// Bounded query for the Weekly Dream reverse-RPC. The Python sidecar passes
/// the journal window and the proposals it produced; Rust re-validates and
/// applies consolidation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WeeklyDreamQuery {
    pub user_id: String,
    pub journal_id: String,
}
