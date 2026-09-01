//! M5-07 Typed Context Plan + M5-08 Context Materializer contracts.
//!
//! Python emits a `ContextPlan` (IDs + inclusion reasons, never prompt text).
//! The Rust Materializer re-validates, re-authorizes, re-fetches canonical
//! text, injects the immutable Soul/policy section, enforces the hard token
//! ceiling, and returns a `ContextPack`. Python never sees DB paths or
//! canonical source handles.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Schema version of the ContextPlan wire contract (M5-07).
pub const CONTEXT_PLAN_SCHEMA_VERSION: u32 = 1;

/// Planner capability pin. Bumped only on a wire-breaking plan change.
/// The Rust materializer rejects plans whose `planner_version` it does not
/// recognize as authorized.
pub const CONTEXT_PLANNER_VERSION: &str = "m5-retrieval-v1";

/// Hard upper bound on rendered context tokens. Exceeding this fails closed;
/// the materializer truncates by section priority rather than returning a
/// partial, un-audited context.
pub const CONTEXT_HARD_TOKEN_CEILING: u32 = 32_000;

/// Token estimate: ~4 chars per token. Conservative and deterministic so the
/// rendered_hash is stable across runs with identical input.
const TOKEN_CHARS_PER_UNIT: u32 = 4;

/// Fixed ContextPlan section taxonomy (M5-07). Rust injects SOUL_POLICY; the
/// planner cannot remove it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextSection {
    SoulPolicy,
    CurrentTask,
    ExplicitUser,
    LearnerState,
    ActiveMemory,
    RecentRelevantEvidence,
    RetrievedCorpus,
    RecentJournal,
    ToolReserve,
}

impl ContextSection {
    /// Truncation priority when the rendered context exceeds the hard ceiling
    /// (M5-09): CURRENT_TASK > SOUL > explicit user > verified learner/memory >
    /// retrieved evidence > journal > tool reserve. Lower number = higher
    /// priority (kept longest).
    pub fn truncation_rank(self) -> u8 {
        match self {
            Self::CurrentTask => 0,
            Self::SoulPolicy => 1,
            Self::ExplicitUser => 2,
            Self::LearnerState => 3,
            Self::ActiveMemory => 4,
            Self::RecentRelevantEvidence => 5,
            Self::RetrievedCorpus => 6,
            Self::RecentJournal => 7,
            Self::ToolReserve => 8,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SoulPolicy => "SOUL_POLICY",
            Self::CurrentTask => "CURRENT_TASK",
            Self::ExplicitUser => "EXPLICIT_USER",
            Self::LearnerState => "LEARNER_STATE",
            Self::ActiveMemory => "ACTIVE_MEMORY",
            Self::RecentRelevantEvidence => "RECENT_RELEVANT_EVIDENCE",
            Self::RetrievedCorpus => "RETRIEVED_CORPUS",
            Self::RecentJournal => "RECENT_JOURNAL",
            Self::ToolReserve => "TOOL_RESERVE",
        }
    }
}

/// A single section allocation emitted by the Python planner (M5-07).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSectionPlan {
    pub section: ContextSection,
    #[serde(default)]
    pub item_ids: Vec<String>,
    #[serde(default)]
    pub requested_token_budget: u32,
    #[serde(default)]
    pub inclusion_reasons: Vec<String>,
}

/// M5-07 typed plan. Python emits IDs + reasons; the Rust materializer re-fetches
/// canonical text and re-authorizes before any model.invoke.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextPlan {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_planner_version")]
    pub planner_version: String,
    pub task_kind: String,
    pub sections: Vec<ContextSectionPlan>,
    #[serde(default)]
    pub ranked_item_ids: Vec<String>,
    #[serde(default)]
    pub inclusion_reasons: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub requested_token_budget: u32,
    #[serde(default)]
    pub retrieval_run_ids: Vec<String>,
}

fn default_schema_version() -> u32 {
    CONTEXT_PLAN_SCHEMA_VERSION
}

fn default_planner_version() -> String {
    CONTEXT_PLANNER_VERSION.to_string()
}

/// A single canonical-source item resolved by the materializer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMaterializedItem {
    pub item_id: String,
    pub section: ContextSection,
    pub source_kind: String,
    pub source_id: String,
    pub content_hash: String,
    pub sensitivity: String,
    pub estimated_tokens: u32,
    pub rank: u32,
    pub score: f64,
    pub inclusion_reason: String,
}

/// Materialized section in the final ContextPack.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMaterializedSection {
    pub section: ContextSection,
    pub items: Vec<ContextMaterializedItem>,
    pub estimated_tokens: u32,
}

/// Manifest summary persisted to `agent_context_snapshots`/`agent_context_items`
/// and returned to Python as the audited context handle (M5-08 step 7-9).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifest {
    pub snapshot_id: String,
    pub run_id: Option<String>,
    pub planner_version: String,
    pub scope: String,
    pub token_budget: u32,
    pub used_tokens: u32,
    pub content_hash: String,
    pub rendered_at: String,
    pub sections: Vec<ContextMaterializedSection>,
}

/// Final audited context returned to the caller. The rendered text is included
/// only because Rust re-fetched it from canonical sources and re-authorized it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub manifest: ContextManifest,
    pub rendered_context: String,
    pub rendered_hash: String,
}

/// Deterministic SHA-256 of the rendered context. Stable for identical input
/// across runs because every contributor (section order, item order, text) is
/// canonicalized before hashing.
pub fn rendered_hash(rendered_context: &str) -> String {
    let digest = Sha256::digest(rendered_context.as_bytes());
    hex::encode(digest)
}

/// Deterministic token estimate from byte length. Conservative (4 chars/token).
pub fn estimate_tokens(text: &str) -> u32 {
    let chars = text.chars().count() as u32;
    chars.div_ceil(TOKEN_CHARS_PER_UNIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_priority_orders_current_task_above_soul() {
        assert_eq!(ContextSection::CurrentTask.truncation_rank(), 0);
        assert_eq!(ContextSection::SoulPolicy.truncation_rank(), 1);
        assert_eq!(ContextSection::ToolReserve.truncation_rank(), 8);
    }

    #[test]
    fn rendered_hash_is_stable_for_identical_input() {
        let a = rendered_hash("hello context");
        let b = rendered_hash("hello context");
        assert_eq!(a, b);
        assert_ne!(a, rendered_hash("hello context "));
    }

    #[test]
    fn estimate_tokens_uses_four_chars_per_token_rounded_up() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn plan_round_trips_through_serde_camel_case() {
        let plan = ContextPlan {
            schema_version: CONTEXT_PLAN_SCHEMA_VERSION,
            planner_version: CONTEXT_PLANNER_VERSION.into(),
            task_kind: "writing_review".into(),
            sections: vec![ContextSectionPlan {
                section: ContextSection::CurrentTask,
                item_ids: vec!["reading:p1:v1:0".into()],
                requested_token_budget: 512,
                inclusion_reasons: vec!["exact_match".into()],
            }],
            ranked_item_ids: vec!["reading:p1:v1:0".into()],
            inclusion_reasons: std::collections::BTreeMap::from([(
                "reading:p1:v1:0".into(),
                vec!["exact_match".into()],
            )]),
            requested_token_budget: 4096,
            retrieval_run_ids: vec!["run-1".into()],
        };
        let json = serde_json::to_string(&plan).unwrap();
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"plannerVersion\""));
        assert!(json.contains("\"taskKind\""));
        let back: ContextPlan = serde_json::from_str(&json).unwrap();
        assert_eq!(back, plan);
    }

    #[test]
    fn section_serializes_as_screaming_snake() {
        let json = serde_json::to_string(&ContextSection::SoulPolicy).unwrap();
        assert_eq!(json, "\"SOUL_POLICY\"");
    }
}
