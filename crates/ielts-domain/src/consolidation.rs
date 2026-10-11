//! M8 memory-lifecycle domain contracts (§23.16 / §23.17).
//!
//! The pattern-consolidation pipeline that once lived here (pattern proposals,
//! validators, consolidation receipts) was removed: nothing produced or consumed
//! it. What remains is the user-feedback and stale-archive vocabulary used by
//! `ConsolidationService::{record_memory_feedback, archive_stale}`.

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

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
