//! M7 Daily Dream domain contracts.
//!
//! A dream is a bounded LLM-side pass that reads today's deterministic facts
//! and produces pending candidates. It is fail-closed: a failed dream never
//! blocks the deterministic journal or the practice loop. Dreams only produce
//! pending candidates that must still go through M3 `promote_memory_candidate`
//! before they touch active memory (no bypass).

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

pub const DREAM_SCHEMA_VERSION: u32 = 1;
pub const MAX_DREAM_PROPOSAL_BYTES: usize = 16 * 1024;

// M7-08 capacity bounds. These are enforced by the application layer; the
// database CHECK constraints only validate enum membership.
pub const MAX_INPUT_OBSERVATIONS: usize = 64;
pub const MAX_ACTIVE_CANDIDATES: usize = 16;
pub const MAX_OUTPUT_CANDIDATES: usize = 6;
pub const MAX_TOKEN_BUDGET: u32 = 4000;
pub const MAX_LLM_RETRIES: u32 = 2;

/// Fixed M7 proposal-kind enum (M7-07). The LLM may only select from this set;
/// it cannot invent new kinds. New cross-domain high-order patterns are deferred
/// to M8 Weekly Dream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum DreamProposalKind {
    Reinforce,
    Refine,
    Improve,
    Regress,
    Contradict,
    Noop,
}

impl DreamProposalKind {
    pub const ALL: [Self; 6] = [
        Self::Reinforce,
        Self::Refine,
        Self::Improve,
        Self::Regress,
        Self::Contradict,
        Self::Noop,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reinforce => "REINFORCE",
            Self::Refine => "REFINE",
            Self::Improve => "IMPROVE",
            Self::Regress => "REGRESS",
            Self::Contradict => "CONTRADICT",
            Self::Noop => "NOOP",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }
}

/// Disposition of a dream candidate. A dream only ever produces pending
/// candidates; promotion still goes through M3 `promote_memory_candidate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DreamCandidateDisposition {
    Pending,
    Promoted,
    Rejected,
}

impl DreamCandidateDisposition {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Promoted => "promoted",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "promoted" => Some(Self::Promoted),
            "rejected" => Some(Self::Rejected),
            _ => None,
        }
    }
}

/// Status of a dream run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DreamRunStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl DreamRunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// A bounded dream proposal produced by the LLM pass. Capacity is bounded by
/// `MAX_OUTPUT_CANDIDATES`; the proposal_json carries the full LLM payload but
/// the structured fields are the authority for validation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DreamProposal {
    pub kind: DreamProposalKind,
    pub target_memory_id: Option<String>,
    #[serde(default)]
    pub evidence_observation_ids: Vec<String>,
    #[serde(default)]
    pub proposed_statement: String,
    #[serde(default)]
    pub proposal_json: serde_json::Value,
}

/// A persisted dream candidate row. A candidate is pending until M3 promotion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DreamCandidate {
    pub id: String,
    pub run_id: String,
    pub proposal: DreamProposal,
    pub kind: DreamProposalKind,
    pub target_memory_id: Option<String>,
    pub evidence_observation_ids: Vec<String>,
    pub disposition: DreamCandidateDisposition,
    pub created_at: String,
}

/// A dream run record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DreamRun {
    pub id: String,
    pub user_id: String,
    pub journal_id: String,
    pub status: DreamRunStatus,
    pub input_hash: Option<String>,
    pub output_hash: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<serde_json::Value>,
    pub attempts: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of a daily dream pass. The journal is always completed first
/// (deterministic); the dream is fail-closed and may be `failed` without
/// blocking the journal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DailyDreamResult {
    pub run: DreamRun,
    pub candidates: Vec<DreamCandidate>,
}

/// Bounded query for running a daily dream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyDreamQuery {
    pub user_id: String,
    pub journal_id: String,
}

#[cfg(test)]
mod wire_casing_tests {
    use super::*;

    /// Cross-language guard: the Python dream orchestrator emits the enum
    /// VALUE strings from ``DreamProposalKind`` (SCREAMING_SNAKE_CASE). A
    /// serde rename change here would silently reject every proposal at the
    /// dream.run_daily authority.
    #[test]
    fn proposal_kind_wire_matches_python_enum_values() {
        for kind in DreamProposalKind::ALL {
            let wire = serde_json::to_value(kind).unwrap();
            assert_eq!(wire, serde_json::Value::String(kind.as_str().to_string()));
        }
        let parsed: DreamProposalKind =
            serde_json::from_value(serde_json::Value::String("REINFORCE".into())).unwrap();
        assert_eq!(parsed, DreamProposalKind::Reinforce);
    }
}
