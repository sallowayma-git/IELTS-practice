//! M8 Weekly Dream consolidation application service (§23.16/§23.17).
//!
//! Thin service over the db authority. The Python Weekly Dream proposes
//! cross-scope patterns with stable `mem-*` IDs; Rust re-validates (M8-02),
//! applies consolidation as relations + supersede (M8-06, never deletes), and
//! exposes user feedback (M8-09). Rust is the promotion gate; Python only
//! proposes.

use ielts_domain::{
    ConsolidationConfig, ConsolidationReceipt, MemoryFeedbackKind, MemoryFeedbackRecord,
    PatternProposal, PatternValidationReport, StaleArchiveReport, SupportChangeOutcome,
    WeeklyDreamQuery,
};
use ielts_db::SupportMemory;

use crate::ApplicationError;

/// Persistence port for the M8 consolidation authority.
pub trait ConsolidationStore {
    fn load_support_memories(
        &self,
        ids: &[String],
        user_id: &str,
    ) -> Result<Vec<SupportMemory>, ApplicationError>;
    fn validate_patterns(
        &self,
        proposals: &[PatternProposal],
        user_id: &str,
        config: &ConsolidationConfig,
    ) -> Result<PatternValidationReport, ApplicationError>;
    fn apply_consolidation(
        &self,
        pattern: &ielts_domain::ValidatedPattern,
        user_id: &str,
        now: &str,
    ) -> Result<ConsolidationReceipt, ApplicationError>;
    fn propagate_support_change(
        &self,
        memory_id: &str,
        new_status: &str,
        now: &str,
    ) -> Result<SupportChangeOutcome, ApplicationError>;
    fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError>;
    fn record_memory_feedback(
        &self,
        memory_id: &str,
        kind: MemoryFeedbackKind,
        user_id: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError>;
}

pub struct ConsolidationService<'a> {
    store: &'a dyn ConsolidationStore,
    config: ConsolidationConfig,
}

impl<'a> ConsolidationService<'a> {
    pub fn new(store: &'a dyn ConsolidationStore) -> Self {
        Self {
            store,
            config: ConsolidationConfig::default(),
        }
    }

    pub fn with_config(store: &'a dyn ConsolidationStore, config: ConsolidationConfig) -> Self {
        Self { store, config }
    }

    pub fn config(&self) -> &ConsolidationConfig {
        &self.config
    }

    /// M8-02: re-validate Python-proposed patterns by stable ID. Empty validated
    /// is success (M8-01: better zero than a wrong pattern).
    pub fn validate_patterns(
        &self,
        proposals: &[PatternProposal],
        user_id: &str,
    ) -> Result<PatternValidationReport, ApplicationError> {
        self.store.validate_patterns(proposals, user_id, &self.config)
    }

    /// M8-06: apply consolidation for each validated pattern. Old supports are
    /// marked superseded (not deleted); relations preserve lineage + reversibility.
    ///
    /// Round-3 audit (A1): each `apply_consolidation` commits its own
    /// transaction, so a batch that fails on pattern 3 has already committed
    /// patterns 1 and 2. This used to `.collect()` into `Result<Vec<_>, _>`,
    /// which short-circuits and drops the receipts for the writes that DID
    /// land - leaving the caller to record a wholly-failed run over a database
    /// that was partially mutated. Returning [`PartialConsolidation`] makes the
    /// committed prefix visible so the run ledger can record what happened.
    pub fn apply_consolidations(
        &self,
        patterns: &[ielts_domain::ValidatedPattern],
        user_id: &str,
        now: &str,
    ) -> Result<Vec<ConsolidationReceipt>, PartialConsolidation> {
        let mut applied = Vec::with_capacity(patterns.len());
        for pattern in patterns {
            match self.store.apply_consolidation(pattern, user_id, now) {
                Ok(receipt) => applied.push(receipt),
                Err(error) => {
                    return Err(PartialConsolidation {
                        applied,
                        failed_statement: pattern.statement.clone(),
                        error,
                    })
                }
            }
        }
        Ok(applied)
    }

    /// M8-07: propagate a support status change to the patterns it feeds.
    pub fn propagate_support_change(
        &self,
        memory_id: &str,
        new_status: &str,
        now: &str,
    ) -> Result<SupportChangeOutcome, ApplicationError> {
        self.store.propagate_support_change(memory_id, new_status, now)
    }

    /// M8-08: stale archive sweep (per-kind policy; archive not delete).
    pub fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError> {
        self.store.archive_stale(now)
    }

    /// M8-09: record user feedback against a stable memory_id.
    pub fn record_memory_feedback(
        &self,
        memory_id: &str,
        kind: MemoryFeedbackKind,
        user_id: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError> {
        self.store
            .record_memory_feedback(memory_id, kind, user_id, payload, now)
    }
}

/// A consolidation batch that failed partway through, carrying the receipts for
/// the patterns that were already committed before the failure.
///
/// `apply_consolidation` commits per pattern, so a mid-batch error leaves the
/// database mutated. The caller must record `applied` in the run ledger rather
/// than reporting a clean failure over a dirty database.
#[derive(Debug)]
pub struct PartialConsolidation {
    /// Receipts for the patterns that committed before the failure.
    pub applied: Vec<ConsolidationReceipt>,
    /// The statement of the pattern that failed, for the audit payload.
    pub failed_statement: String,
    pub error: ApplicationError,
}

impl PartialConsolidation {
    /// True when nothing was committed, so the caller may report a clean
    /// failure without qualification.
    pub fn is_clean(&self) -> bool {
        self.applied.is_empty()
    }
}

impl From<PartialConsolidation> for ApplicationError {
    fn from(value: PartialConsolidation) -> Self {
        value.error
    }
}

impl std::fmt::Display for PartialConsolidation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.is_clean() {
            write!(formatter, "{}", self.error)
        } else {
            write!(
                formatter,
                "{} (after {} pattern(s) already committed)",
                self.error,
                self.applied.len()
            )
        }
    }
}

/// Result of the weekly dream run: validated patterns + the receipts for the
/// ones Rust promoted. `rejected` carries machine-readable reasons (M8-01).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyDreamResult {
    pub run_id: String,
    pub query: WeeklyDreamQuery,
    pub report: PatternValidationReport,
    pub receipts: Vec<ConsolidationReceipt>,
}
