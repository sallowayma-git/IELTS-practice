//! M3 proposal-only Memory contracts.
//!
//! These types describe untrusted model proposals and validator decisions.
//! They are deliberately not persistence commands and contain no activation,
//! confidence, or source-authority fields controlled by the model.

use serde::{Deserialize, Serialize};

use crate::Activity;

pub const MEMORY_PROPOSAL_SCHEMA_VERSION: u32 = 1;
pub const MAX_MEMORY_PROPOSALS: usize = 32;
pub const MAX_MEMORY_EVIDENCE_IDS: usize = 32;
pub const MAX_MEMORY_KEY_BYTES: usize = 160;
pub const MAX_MEMORY_STATEMENT_BYTES: usize = 4 * 1024;
pub const MAX_ACTIVE_MEMORY_PER_SCOPE: usize = 128;
pub const MAX_MEMORY_CONTEXT_ITEMS: u32 = 100;
pub const MAX_MEMORY_CATALOG_ITEMS: u32 = 200;
pub const MAX_MEMORY_CANDIDATE_OBSERVATIONS: u32 = 200;
pub const MAX_EXPLICIT_PREFERENCES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidateObservationSummary {
    pub id: String,
    pub namespace: MemoryNamespace,
    pub activity: Activity,
    pub normalized_label: String,
    pub statement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidateActiveSummary {
    pub id: String,
    pub namespace: MemoryNamespace,
    pub canonical_key: String,
    pub normalized_label: String,
    pub scope: MemoryScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidatePreferenceSummary {
    pub preference_key: String,
    pub scope: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidateInput {
    pub observations: Vec<MemoryCandidateObservationSummary>,
    pub active_memory: Vec<MemoryCandidateActiveSummary>,
    pub explicit_preferences: Vec<MemoryCandidatePreferenceSummary>,
    pub task_scope: MemoryScope,
    pub max_candidates: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryNamespace {
    Knowledge,
    Language,
    Strategy,
    Behavior,
    Metacognition,
    Preference,
    Goal,
}

impl MemoryNamespace {
    pub const ALL: [Self; 7] = [
        Self::Knowledge,
        Self::Language,
        Self::Strategy,
        Self::Behavior,
        Self::Metacognition,
        Self::Preference,
        Self::Goal,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Knowledge => "knowledge",
            Self::Language => "language",
            Self::Strategy => "strategy",
            Self::Behavior => "behavior",
            Self::Metacognition => "metacognition",
            Self::Preference => "preference",
            Self::Goal => "goal",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|namespace| namespace.as_str() == value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorySourceClass {
    UserExplicit,
    Observed,
    Inferred,
    Predicted,
    Consolidated,
    SystemPolicy,
}

impl MemorySourceClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UserExplicit => "user_explicit",
            Self::Observed => "observed",
            Self::Inferred => "inferred",
            Self::Predicted => "predicted",
            Self::Consolidated => "consolidated",
            Self::SystemPolicy => "system_policy",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::UserExplicit,
            Self::Observed,
            Self::Inferred,
            Self::Predicted,
            Self::Consolidated,
            Self::SystemPolicy,
        ]
        .into_iter()
        .find(|source| source.as_str() == value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryStatus {
    Candidate,
    PendingReview,
    Active,
    Superseded,
    Archived,
    Quarantined,
    Rejected,
    Deleted,
}

impl MemoryStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::PendingReview => "pending_review",
            Self::Active => "active",
            Self::Superseded => "superseded",
            Self::Archived => "archived",
            Self::Quarantined => "quarantined",
            Self::Rejected => "rejected",
            Self::Deleted => "deleted",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Candidate,
            Self::PendingReview,
            Self::Active,
            Self::Superseded,
            Self::Archived,
            Self::Quarantined,
            Self::Rejected,
            Self::Deleted,
        ]
        .into_iter()
        .find(|status| status.as_str() == value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryProposalDisposition {
    Pending,
    Duplicate,
    Rejected,
    Quarantined,
    Noop,
}

impl MemoryProposalDisposition {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Duplicate => "duplicate",
            Self::Rejected => "rejected",
            Self::Quarantined => "quarantined",
            Self::Noop => "noop",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum MemoryScope {
    Activity { key: Activity },
}

impl MemoryScope {
    pub const fn activity(self) -> Activity {
        match self {
            Self::Activity { key } => key,
        }
    }

    pub const fn storage_key(self) -> &'static str {
        match self {
            Self::Activity {
                key: Activity::Reading,
            } => "activity:reading",
            Self::Activity {
                key: Activity::Writing,
            } => "activity:writing",
        }
    }

    pub fn parse_storage_key(value: &str) -> Option<Self> {
        match value {
            "activity:reading" => Some(Self::Activity {
                key: Activity::Reading,
            }),
            "activity:writing" => Some(Self::Activity {
                key: Activity::Writing,
            }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryObservationEvidence {
    pub id: String,
    pub user_id: String,
    pub activity: Activity,
    pub sensitivity: String,
    pub trust: String,
    pub text: String,
    pub source_fingerprint: String,
    pub projector_key: String,
    pub projector_version: i64,
    pub event_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveMemorySummary {
    pub id: String,
    pub user_id: String,
    pub namespace: MemoryNamespace,
    pub canonical_key: String,
    pub scope: MemoryScope,
    pub status: MemoryStatus,
    pub version: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryValidationSnapshot {
    pub user_id: String,
    pub projector_key: String,
    pub projector_version: i64,
    pub ledger_input_hash: String,
    pub observation_output_hash: String,
    pub observations: Vec<MemoryObservationEvidence>,
    pub active_memory: Vec<ActiveMemorySummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryMutationProposalBatch {
    pub schema_version: u32,
    pub proposals: Vec<MemoryMutationProposal>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryMutationProposal {
    Add {
        namespace: MemoryNamespace,
        canonical_key: String,
        scope: MemoryScope,
        statement: String,
        evidence_observation_ids: Vec<String>,
    },
    Reinforce {
        target_memory_id: String,
        evidence_observation_ids: Vec<String>,
    },
    Refine {
        target_memory_id: String,
        proposed_statement: String,
        evidence_observation_ids: Vec<String>,
    },
    Improve {
        target_memory_id: String,
        evidence_observation_ids: Vec<String>,
    },
    Regress {
        target_memory_id: String,
        evidence_observation_ids: Vec<String>,
    },
    Contradict {
        target_memory_id: String,
        evidence_observation_ids: Vec<String>,
    },
    Supersede {
        target_memory_id: String,
        namespace: MemoryNamespace,
        canonical_key: String,
        scope: MemoryScope,
        proposed_statement: String,
        evidence_observation_ids: Vec<String>,
    },
    Archive {
        target_memory_id: String,
        evidence_observation_ids: Vec<String>,
    },
    Noop {},
}

impl MemoryMutationProposal {
    pub const fn action(&self) -> &'static str {
        match self {
            Self::Add { .. } => "ADD",
            Self::Reinforce { .. } => "REINFORCE",
            Self::Refine { .. } => "REFINE",
            Self::Improve { .. } => "IMPROVE",
            Self::Regress { .. } => "REGRESS",
            Self::Contradict { .. } => "CONTRADICT",
            Self::Supersede { .. } => "SUPERSEDE",
            Self::Archive { .. } => "ARCHIVE",
            Self::Noop {} => "NOOP",
        }
    }

    pub fn evidence_observation_ids(&self) -> &[String] {
        match self {
            Self::Add {
                evidence_observation_ids,
                ..
            }
            | Self::Reinforce {
                evidence_observation_ids,
                ..
            }
            | Self::Refine {
                evidence_observation_ids,
                ..
            }
            | Self::Improve {
                evidence_observation_ids,
                ..
            }
            | Self::Regress {
                evidence_observation_ids,
                ..
            }
            | Self::Contradict {
                evidence_observation_ids,
                ..
            }
            | Self::Supersede {
                evidence_observation_ids,
                ..
            }
            | Self::Archive {
                evidence_observation_ids,
                ..
            } => evidence_observation_ids,
            Self::Noop {} => &[],
        }
    }

    pub fn target_memory_id(&self) -> Option<&str> {
        match self {
            Self::Reinforce {
                target_memory_id, ..
            }
            | Self::Refine {
                target_memory_id, ..
            }
            | Self::Improve {
                target_memory_id, ..
            }
            | Self::Regress {
                target_memory_id, ..
            }
            | Self::Contradict {
                target_memory_id, ..
            }
            | Self::Supersede {
                target_memory_id, ..
            }
            | Self::Archive {
                target_memory_id, ..
            } => Some(target_memory_id),
            Self::Add { .. } | Self::Noop {} => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProposalIssue {
    pub code: String,
    pub field: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProposalDecision {
    pub proposal_index: usize,
    pub disposition: MemoryProposalDisposition,
    pub source_class: Option<MemorySourceClass>,
    pub issues: Vec<MemoryProposalIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProposalValidationReport {
    pub schema_version: u32,
    pub batch_issues: Vec<MemoryProposalIssue>,
    pub decisions: Vec<MemoryProposalDecision>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCandidatePersistenceInput {
    pub request_id: String,
    pub user_id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    pub source_class: MemorySourceClass,
    pub batch: MemoryMutationProposalBatch,
    pub validation: MemoryProposalValidationReport,
    pub snapshot: MemoryValidationSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCandidateReceipt {
    pub id: String,
    pub proposal_index: usize,
    pub disposition: String,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCandidateBatchReceipt {
    pub batch_id: String,
    pub request_id: String,
    pub replayed: bool,
    pub candidates: Vec<MemoryCandidateReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryPromotionCommand {
    pub candidate_id: String,
    pub expected_candidate_version: u64,
    pub actor_type: String,
    #[serde(default)]
    pub actor_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMutationReceipt {
    pub candidate_id: String,
    pub memory_id: Option<String>,
    pub action: String,
    pub memory_status: Option<MemoryStatus>,
    pub memory_version: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExplicitPreferenceUpsert {
    #[serde(default = "default_local_user")]
    pub user_id: String,
    pub preference_key: String,
    #[serde(default = "default_global_scope")]
    pub scope: String,
    pub value: serde_json::Value,
    #[serde(default = "default_preference_source")]
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplicitPreference {
    pub user_id: String,
    pub preference_key: String,
    pub scope: String,
    pub value: serde_json::Value,
    pub status: String,
    pub source: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextQuery {
    #[serde(default = "default_local_user")]
    pub user_id: String,
    pub activity: Activity,
    #[serde(default)]
    pub current_instruction: Option<String>,
    #[serde(default = "default_context_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryContextSource {
    CurrentInstruction,
    ExplicitPreference,
    ActiveMemory,
    InferredCandidate,
    PredictedHypothesis,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextEntry {
    pub priority: u8,
    pub source: MemoryContextSource,
    pub id: Option<String>,
    pub key: String,
    pub value: serde_json::Value,
    pub pending_verification: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryContextPreview {
    pub user_id: String,
    pub activity: Activity,
    pub entries: Vec<MemoryContextEntry>,
    pub truncated: bool,
}

/// Product-host catalog query. This is NOT a Context Pack: it lists
/// governable memory items, pending candidates, and explicit preferences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryCatalogQuery {
    #[serde(default = "default_local_user")]
    pub user_id: String,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default = "default_catalog_limit")]
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryConfidenceBand {
    Low,
    Medium,
    High,
}

impl MemoryConfidenceBand {
    pub fn from_score(confidence: f64) -> Self {
        if confidence < 0.34 {
            Self::Low
        } else if confidence < 0.67 {
            Self::Medium
        } else {
            Self::High
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCatalogEntry {
    pub id: String,
    pub statement: String,
    pub namespace: String,
    pub scope: String,
    pub canonical_key: String,
    pub status: String,
    pub source_class: String,
    pub confidence_band: MemoryConfidenceBand,
    pub support_count: u64,
    pub contradiction_count: u64,
    pub version: u64,
    pub first_seen: String,
    pub last_seen: String,
    #[serde(default)]
    pub evidence_observation_ids: Vec<String>,
    pub pending_verification: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCatalog {
    pub user_id: String,
    pub entries: Vec<MemoryCatalogEntry>,
    pub truncated: bool,
}

fn default_catalog_limit() -> u32 {
    100
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryForgetCommand {
    pub memory_id: String,
    pub expected_version: u64,
    pub actor_type: String,
    #[serde(default)]
    pub actor_id: Option<String>,
    pub reason: String,
}

fn default_local_user() -> String {
    "local".into()
}

fn default_global_scope() -> String {
    "global".into()
}

fn default_preference_source() -> String {
    "user".into()
}

fn default_context_limit() -> u32 {
    50
}
