//! M10 Teaching Strategy Evolution application service.
//!
//! Thin persistence-backed service over the db authority. Owns the use-case
//! boundary: selection (M10-06), assignment recording (M10-02), the two
//! reward channels (M10-03: satisfaction vs learning on separate tables),
//! the delayed outcome window (M10-04), per-user state aggregation (M10-05),
//! and the candidate promotion gate (M10-08). Rust is the evolution
//! authority; the LLM may propose candidates but never execute them directly.

use ielts_domain::{
    OutcomeAttribution, PromoteStrategyCandidateCommand, RecordStrategyAssignmentCommand,
    RecordStrategyCandidateBatchCommand, RecordStrategyCandidateEvaluationCommand,
    RecordStrategyFeedbackCommand,
    RecordStrategyOutcomeCommand, SelectStrategyCommand, StrategyAssignmentRecord,
    StrategyCandidateBatchRecord, StrategyCandidateDecision, StrategyCandidateEvaluationRecord,
    StrategyFeedbackRecord, StrategySelection, TeachingStrategyCatalogEntry, TeachingStrategyId,
    UserStrategyState,
};

use crate::ApplicationError;

/// Persistence port for the M10 teaching strategy evolution layer.
pub trait TeachingStrategyStore {
    fn load_catalog(&self) -> Result<Vec<TeachingStrategyCatalogEntry>, ApplicationError>;
    fn load_catalog_entry(
        &self,
        strategy_id: TeachingStrategyId,
    ) -> Result<Option<TeachingStrategyCatalogEntry>, ApplicationError>;
    fn record_strategy_assignment(
        &self,
        command: &RecordStrategyAssignmentCommand,
    ) -> Result<StrategyAssignmentRecord, ApplicationError>;
    fn record_strategy_feedback(
        &self,
        command: &RecordStrategyFeedbackCommand,
    ) -> Result<StrategyFeedbackRecord, ApplicationError>;
    fn record_strategy_outcome(
        &self,
        command: &RecordStrategyOutcomeCommand,
    ) -> Result<OutcomeAttribution, ApplicationError>;
    fn load_user_strategy_state(
        &self,
        user_id: &str,
        strategy_id: TeachingStrategyId,
        scope: &str,
    ) -> Result<Option<UserStrategyState>, ApplicationError>;
    fn select_strategy(
        &self,
        command: &SelectStrategyCommand,
    ) -> Result<StrategySelection, ApplicationError>;
    fn record_strategy_candidate_batch(
        &self,
        command: &RecordStrategyCandidateBatchCommand,
    ) -> Result<StrategyCandidateBatchRecord, ApplicationError>;
    fn record_strategy_candidate_evaluation(
        &self,
        command: &RecordStrategyCandidateEvaluationCommand,
    ) -> Result<StrategyCandidateEvaluationRecord, ApplicationError>;
    fn promote_strategy_candidate(
        &self,
        command: &PromoteStrategyCandidateCommand,
    ) -> Result<StrategyCandidateDecision, ApplicationError>;
}

pub struct TeachingStrategyService<'a> {
    store: &'a dyn TeachingStrategyStore,
}

impl<'a> TeachingStrategyService<'a> {
    pub fn new(store: &'a dyn TeachingStrategyStore) -> Self {
        Self { store }
    }

    /// M10-01: load the developer-defined strategy catalog.
    pub fn catalog(&self) -> Result<Vec<TeachingStrategyCatalogEntry>, ApplicationError> {
        self.store.load_catalog()
    }

    /// M10-06: select a strategy for the next response (rule-priority).
    pub fn select_strategy(
        &self,
        command: &SelectStrategyCommand,
    ) -> Result<StrategySelection, ApplicationError> {
        self.store.select_strategy(command)
    }

    /// M10-02: record the teaching-strategy assignment for a response message.
    pub fn record_assignment(
        &self,
        command: &RecordStrategyAssignmentCommand,
    ) -> Result<StrategyAssignmentRecord, ApplicationError> {
        self.store.record_strategy_assignment(command)
    }

    /// M10-03: record a SATISFACTION feedback fact. Writes only to the
    /// satisfaction table; never to the learning outcomes table.
    pub fn record_feedback(
        &self,
        command: &RecordStrategyFeedbackCommand,
    ) -> Result<StrategyFeedbackRecord, ApplicationError> {
        self.store.record_strategy_feedback(command)
    }

    /// M10-03/04: record a LEARNING outcome. Checks the attribution window
    /// before recording; an out-of-window or missing-context observation is
    /// not recorded (returns the reason).
    pub fn record_outcome(
        &self,
        command: &RecordStrategyOutcomeCommand,
    ) -> Result<OutcomeAttribution, ApplicationError> {
        self.store.record_strategy_outcome(command)
    }

    /// M10-05: load the per-user strategy state for a (user, strategy, scope).
    pub fn user_state(
        &self,
        user_id: &str,
        strategy_id: TeachingStrategyId,
        scope: &str,
    ) -> Result<Option<UserStrategyState>, ApplicationError> {
        self.store.load_user_strategy_state(user_id, strategy_id, scope)
    }

    /// M10-08: record an LLM-proposed candidate strategy batch as pending.
    /// Never directly executable.
    pub fn record_candidate_batch(
        &self,
        command: &RecordStrategyCandidateBatchCommand,
    ) -> Result<StrategyCandidateBatchRecord, ApplicationError> {
        self.store.record_strategy_candidate_batch(command)
    }

    /// M10-08: run the Rust-owned evaluator for a candidate batch.
    /// Promotion consumes this Rust-owned record instead of a request boolean.
    pub fn record_candidate_evaluation(
        &self,
        command: &RecordStrategyCandidateEvaluationCommand,
    ) -> Result<StrategyCandidateEvaluationRecord, ApplicationError> {
        self.store.record_strategy_candidate_evaluation(command)
    }

    /// M10-08: promote or reject a candidate batch (offline-eval gate).
    pub fn promote_candidate(
        &self,
        command: &PromoteStrategyCandidateCommand,
    ) -> Result<StrategyCandidateDecision, ApplicationError> {
        self.store.promote_strategy_candidate(command)
    }
}
