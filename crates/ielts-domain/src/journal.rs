//! M7 Daily Journal domain contracts.
//!
//! The journal is a versioned canonical projection of canonical truth
//! (events/observations/memory/learner), never the source of truth itself.
//! `JournalFacts` is the deterministic, LLM-free aggregate; `rendered_markdown`
//! is an export view, not the canonical record. Same-day rerun produces a new
//! version and supersedes the previous row (M7-05).

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

pub const JOURNAL_SCHEMA_VERSION: u32 = 1;
pub const MAX_JOURNAL_FACTS_BYTES: usize = 64 * 1024;
pub const MAX_JOURNAL_RENDERED_BYTES: usize = 256 * 1024;
pub const MAX_JOURNAL_SOURCES: usize = 500;

/// Deterministic daily journal facts (§23.14). LLM enrichment may only operate
/// on a bounded view of this struct; it can never change the numeric facts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct JournalFacts {
    pub journal_date: String,
    pub attempts_count: u64,
    pub writing_eval_summary: WritingEvalSummary,
    pub skill_deltas: Vec<SkillDelta>,
    pub memory_changes: MemoryChangeSummary,
    pub coach_feedback_count: u64,
    pub coach_reask_count: u64,
    pub time_spent_ms: u64,
    pub source_hash: String,
    /// Today-scoped observation IDs for Dream evidence (M7-06). Empty on
    /// journals persisted before this field existed.
    #[serde(default)]
    pub today_observation_ids: Vec<String>,
    /// Per-memory mutation events for Dream proposals. The count summary in
    /// `memory_changes` stays the compact projection; this list is the
    /// bounded identity-bearing view Python actually needs.
    #[serde(default)]
    pub memory_events: Vec<JournalMemoryEvent>,
}

/// One memory mutation observed today. Private content is never copied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct JournalMemoryEvent {
    pub memory_id: String,
    pub namespace: String,
    pub canonical_key: String,
    pub change_kind: String,
}

/// Bounded writing-evaluation summary for a day. Only aggregate scores and
/// counts leave the projection; the full evaluation text stays canonical.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingEvalSummary {
    pub completed: u64,
    pub degraded: u64,
    pub average_band: Option<f64>,
}

/// Learner skill delta for a single skill over the day. Private memory redaction
/// is applied before any value leaves the host; only the skill_key and signed
/// delta are exposed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct SkillDelta {
    pub skill_key: String,
    pub delta: f64,
    pub evidence_count: u64,
}

/// Memory mutation summary for a day. Private memory content is never copied;
/// only counts by operation and namespace leave the projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct MemoryChangeSummary {
    pub new_candidates: u64,
    pub promoted: u64,
    pub reinforced: u64,
    pub refined: u64,
    pub improved: u64,
    pub regressed: u64,
    pub contradicted: u64,
    pub superseded: u64,
}

impl Default for MemoryChangeSummary {
    fn default() -> Self {
        Self {
            new_candidates: 0,
            promoted: 0,
            reinforced: 0,
            refined: 0,
            improved: 0,
            regressed: 0,
            contradicted: 0,
            superseded: 0,
        }
    }
}

impl Default for WritingEvalSummary {
    fn default() -> Self {
        Self {
            completed: 0,
            degraded: 0,
            average_band: None,
        }
    }
}

/// Status of a daily journal row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DailyJournalStatus {
    Draft,
    Published,
    Superseded,
}

impl DailyJournalStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Published => "published",
            Self::Superseded => "superseded",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "published" => Some(Self::Published),
            "superseded" => Some(Self::Superseded),
            _ => None,
        }
    }
}

/// Canonical daily journal row (M7-05). The `facts_json` column is the
/// authoritative derived projection; `rendered_markdown` is an export view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DailyJournal {
    pub id: String,
    pub user_id: String,
    pub journal_date: String,
    pub version: u32,
    pub status: DailyJournalStatus,
    pub facts: JournalFacts,
    pub source_hash: String,
    pub rendered_markdown: Option<String>,
    pub superseded_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Bounded query for building/looking up a daily journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyJournalQuery {
    pub user_id: String,
    pub journal_date: String,
}
