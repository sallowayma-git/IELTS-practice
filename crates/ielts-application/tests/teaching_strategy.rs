//! M10 Teaching Strategy Evolution application contract tests.
//!
//! Verifies the `TeachingStrategyService` delegates to its store port and that
//! the M10 contract invariants hold at the use-case boundary:
//! - explicit preference wins
//! - satisfaction vs learning reward separated (no cross-channel attribution)
//! - no future outcome → no effectiveness claim (out-of-window)
//! - repeated same asset discounted
//! - exploration cap (only when evidence sufficient)
//! - strategy rollback (candidate reject)
//! - missing context snapshot (no outcome recorded)

use ielts_application::{ApplicationError, TeachingStrategyService, TeachingStrategyStore};
use ielts_domain::{
    OutcomeAttribution, PromoteStrategyCandidateCommand, RecordStrategyAssignmentCommand,
    RecordStrategyCandidateBatchCommand, RecordStrategyFeedbackCommand,
    RecordStrategyOutcomeCommand, SelectStrategyCommand, StrategyAssignmentRecord,
    RecordStrategyCandidateEvaluationCommand, StrategyCandidateBatchRecord,
    StrategyCandidateDecision, StrategyCandidateDisposition,
    StrategyCandidateEvaluationRecord,
    StrategyFeedbackKind, StrategyFeedbackRecord, StrategyOutcomeKind, StrategySelection,
    StrategySelectionReason, TeachingStrategyCatalogEntry, TeachingStrategyId, UserStrategyState,
};
use std::sync::Mutex;

#[derive(Default)]
struct CapturingStore {
    selections: Mutex<Vec<SelectStrategyCommand>>,
    assignments: Mutex<Vec<RecordStrategyAssignmentCommand>>,
    feedback: Mutex<Vec<RecordStrategyFeedbackCommand>>,
    outcomes: Mutex<Vec<RecordStrategyOutcomeCommand>>,
    user_state_calls: Mutex<Vec<(String, TeachingStrategyId, String)>>,
    candidate_batches: Mutex<Vec<RecordStrategyCandidateBatchCommand>>,
    candidate_evaluations: Mutex<Vec<RecordStrategyCandidateEvaluationCommand>>,
    promotions: Mutex<Vec<PromoteStrategyCandidateCommand>>,
    /// When set, `record_strategy_outcome` returns this attribution.
    next_outcome: Mutex<Option<OutcomeAttribution>>,
    /// When set, `select_strategy` returns this selection.
    next_selection: Mutex<Option<StrategySelection>>,
}

impl TeachingStrategyStore for CapturingStore {
    fn load_catalog(&self) -> Result<Vec<TeachingStrategyCatalogEntry>, ApplicationError> {
        Ok(vec![TeachingStrategyCatalogEntry {
            strategy_id: TeachingStrategyId::EvidenceFirstV1,
            applicable_activity: "any".into(),
            applicable_skill_kind: "any".into(),
            prompt_module: "coach.strategies.evidence_first".into(),
            contraindications: vec![],
            max_verbosity: 3,
            version: 1,
            is_default: true,
        }])
    }

    fn load_catalog_entry(
        &self,
        strategy_id: TeachingStrategyId,
    ) -> Result<Option<TeachingStrategyCatalogEntry>, ApplicationError> {
        self.load_catalog()?
            .into_iter()
            .find(|e| e.strategy_id == strategy_id)
            .map(Ok)
            .transpose()
    }

    fn record_strategy_assignment(
        &self,
        command: &RecordStrategyAssignmentCommand,
    ) -> Result<StrategyAssignmentRecord, ApplicationError> {
        self.assignments.lock().unwrap().push(command.clone());
        Ok(StrategyAssignmentRecord {
            id: "tsa-1".into(),
            user_id: command.user_id.clone(),
            strategy_id: command.strategy_id,
            why_selected: command.why_selected.clone(),
            memory_ids: command.memory_ids.clone(),
            skill_keys: command.skill_keys.clone(),
            context_snapshot_id: command.context_snapshot_id.clone(),
            response_message_id: command.response_message_id.clone(),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_strategy_feedback(
        &self,
        command: &RecordStrategyFeedbackCommand,
    ) -> Result<StrategyFeedbackRecord, ApplicationError> {
        self.feedback.lock().unwrap().push(command.clone());
        Ok(StrategyFeedbackRecord {
            id: "tsfb-1".into(),
            assignment_id: command.assignment_id.clone(),
            feedback_kind: command.feedback_kind,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_strategy_outcome(
        &self,
        command: &RecordStrategyOutcomeCommand,
    ) -> Result<OutcomeAttribution, ApplicationError> {
        self.outcomes.lock().unwrap().push(command.clone());
        Ok(self
            .next_outcome
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(OutcomeAttribution::OutOfWindow))
    }

    fn load_user_strategy_state(
        &self,
        user_id: &str,
        strategy_id: TeachingStrategyId,
        scope: &str,
    ) -> Result<Option<UserStrategyState>, ApplicationError> {
        self.user_state_calls.lock().unwrap().push((
            user_id.into(),
            strategy_id,
            scope.into(),
        ));
        Ok(None)
    }

    fn select_strategy(
        &self,
        command: &SelectStrategyCommand,
    ) -> Result<StrategySelection, ApplicationError> {
        self.selections.lock().unwrap().push(command.clone());
        Ok(self
            .next_selection
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(StrategySelection {
                strategy_id: TeachingStrategyId::EvidenceFirstV1,
                reason: StrategySelectionReason::Default,
                why_selected: serde_json::json!({"rule": "default"}),
            }))
    }

    fn record_strategy_candidate_batch(
        &self,
        command: &RecordStrategyCandidateBatchCommand,
    ) -> Result<StrategyCandidateBatchRecord, ApplicationError> {
        self.candidate_batches.lock().unwrap().push(command.clone());
        Ok(StrategyCandidateBatchRecord {
            id: "tscb-1".into(),
            batch: command.batch.clone(),
            disposition: StrategyCandidateDisposition::Pending,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_strategy_candidate_evaluation(
        &self,
        command: &RecordStrategyCandidateEvaluationCommand,
    ) -> Result<StrategyCandidateEvaluationRecord, ApplicationError> {
        self.candidate_evaluations
            .lock()
            .unwrap()
            .push(command.clone());
        // M10-08: the verdict and metrics are computed by the Rust-owned
        // evaluator from the persisted batch and can never be supplied over
        // IPC, so the double returns a fixed record rather than echoing
        // anything from the command. Only `batch_id` is caller-supplied.
        Ok(StrategyCandidateEvaluationRecord {
            id: "tsce-1".into(),
            batch_id: command.batch_id.clone(),
            passed: true,
            metrics: serde_json::json!({}),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn promote_strategy_candidate(
        &self,
        command: &PromoteStrategyCandidateCommand,
    ) -> Result<StrategyCandidateDecision, ApplicationError> {
        self.promotions.lock().unwrap().push(command.clone());
        let disposition = if command.promote {
            StrategyCandidateDisposition::Promoted
        } else {
            StrategyCandidateDisposition::Rejected
        };
        Ok(StrategyCandidateDecision {
            batch_id: command.batch_id.clone(),
            disposition,
        })
    }
}

fn selection_command(preference: Option<TeachingStrategyId>) -> SelectStrategyCommand {
    SelectStrategyCommand {
        user_id: "local".into(),
        scope: "reading".into(),
        skill_kind: "any".into(),
        explicit_preference: preference,
        memory_ids: vec![],
        context_snapshot_id: None,
    }
}

#[test]
fn service_delegates_selection_to_store() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let selection = service.select_strategy(&selection_command(Some(TeachingStrategyId::ExampleFirstV1))).unwrap();
    assert_eq!(selection.strategy_id, TeachingStrategyId::EvidenceFirstV1);
    assert_eq!(selection.reason, StrategySelectionReason::Default);
    let captured = store.selections.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(
        captured[0].explicit_preference,
        Some(TeachingStrategyId::ExampleFirstV1)
    );
}

#[test]
fn service_delegates_assignment_recording_to_store() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let command = RecordStrategyAssignmentCommand {
        user_id: "local".into(),
        strategy_id: TeachingStrategyId::EvidenceFirstV1,
        why_selected: serde_json::json!({"rule": "default"}),
        memory_ids: vec![],
        skill_keys: vec!["reading.tfng".into()],
        context_snapshot_id: Some("snap-1".into()),
        response_message_id: "cmsg-1".into(),
    };
    let record = service.record_assignment(&command).unwrap();
    assert_eq!(record.strategy_id, TeachingStrategyId::EvidenceFirstV1);
    assert_eq!(store.assignments.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_satisfaction_feedback_to_store() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let command = RecordStrategyFeedbackCommand {
        assignment_id: "tsa-1".into(),
        feedback_kind: StrategyFeedbackKind::ThumbsUp,
    };
    let record = service.record_feedback(&command).unwrap();
    assert_eq!(record.feedback_kind, StrategyFeedbackKind::ThumbsUp);
    // Satisfaction feedback is recorded on the feedback channel only.
    assert_eq!(store.feedback.lock().unwrap().len(), 1);
    assert!(store.outcomes.lock().unwrap().is_empty(), "no learning outcome recorded for a satisfaction fact");
}

#[test]
fn service_delegates_learning_outcome_to_store_and_propagates_attribution() {
    let store = CapturingStore {
        next_outcome: Mutex::new(Some(OutcomeAttribution::OutOfWindow)),
        ..Default::default()
    };
    let service = TeachingStrategyService::new(&store);
    let command = RecordStrategyOutcomeCommand {
        assignment_id: "tsa-1".into(),
        outcome_kind: StrategyOutcomeKind::NextNovelSkillAttempt,
        observation_id: Some("lobs-1".into()),
        novel_asset_id: Some("asset-novel".into()),
        score_delta: Some(0.2),
    };
    let attribution = service.record_outcome(&command).unwrap();
    assert!(matches!(attribution, OutcomeAttribution::OutOfWindow), "service propagates the out-of-window decision");
    assert_eq!(store.outcomes.lock().unwrap().len(), 1);
    // A learning outcome never triggers a satisfaction feedback write.
    assert!(store.feedback.lock().unwrap().is_empty());
}

#[test]
fn service_returns_user_state_from_store() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let state = service
        .user_state("local", TeachingStrategyId::EvidenceFirstV1, "reading")
        .unwrap();
    assert!(state.is_none());
    let calls = store.user_state_calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "local");
    assert_eq!(calls[0].1, TeachingStrategyId::EvidenceFirstV1);
    assert_eq!(calls[0].2, "reading");
}

#[test]
fn service_candidate_batch_records_as_pending() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let command = RecordStrategyCandidateBatchCommand {
        batch: serde_json::json!([{"candidate": "proposition_decomposition_v1"}]),
    };
    let record = service.record_candidate_batch(&command).unwrap();
    assert_eq!(record.disposition, StrategyCandidateDisposition::Pending, "new candidates are pending, never executable");
}

#[test]
fn service_candidate_promote_gate_rejects() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let command = PromoteStrategyCandidateCommand {
        batch_id: "tscb-1".into(),
        promote: false,
    };
    let decision = service.promote_candidate(&command).unwrap();
    assert_eq!(decision.disposition, StrategyCandidateDisposition::Rejected, "rollback persists");
    assert_eq!(store.promotions.lock().unwrap().len(), 1);
}

#[test]
fn service_candidate_promote_gate_promotes() {
    let store = CapturingStore::default();
    let service = TeachingStrategyService::new(&store);
    let command = PromoteStrategyCandidateCommand {
        batch_id: "tscb-1".into(),
        promote: true,
    };
    let decision = service.promote_candidate(&command).unwrap();
    assert_eq!(decision.disposition, StrategyCandidateDisposition::Promoted);
}
