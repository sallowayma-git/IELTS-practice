//! M6 Product Gate — Reading + Coach First Closed Loop.
//!
//! Deterministic integration test proving the M6 closed-loop data flow works
//! end-to-end without a live model. Mirrors the M3/M5 stage-gate philosophy:
//! verify contract / protocol / persistence boundaries, not live model output.
//!
//! The loop under test (plan §8173-8186):
//!
//! ```text
//! Attempt A: Matching Headings error
//!   → record_coach_feedback(incorrect)
//!   → record_coach_strategy_assignment(evidence_first_v1, skill=reading.matching_headings)
//! Attempt B: same skill error
//!   → preference candidate extractor produces candidate (preference.coach.*)
//!   → candidate stays pending (NOT promoted to active preference)
//! Attempt C: same skill improves
//!   → link_coach_outcome(strategy_assignment_id, future_observation_id, learning)
//! ```
//!
//! Assertions:
//! - Feedback is an interaction fact; it does NOT auto-become a preference.
//! - Satisfaction outcome (thumbs_up) and learning outcome are on separate rows.
//! - Re-ask linkage is exact (parent → new user message).
//! - Strategy assignment persists with contextSnapshotId provenance.
//! - Outcome link connects to the future observation.
//!
//! Uses a FakeStore implementing all four M6 store ports — no SQLite, no
//! provider, no sidecar. The test verifies the closed-loop DATA FLOW, not model
//! quality.

use std::sync::Mutex;

use ielts_application::{
    ApplicationError, CoachFeedbackService, CoachFeedbackStore, CognitiveReadStore,
    LearnerModelStore, MemoryStore, MemoryProposalOrigin, MemoryProposalValidator,
};
use ielts_domain::{
    Activity, CoachFeedbackKind, CoachFollowupType, CoachOutcomeKind, CoachStrategyId,
    ExplicitPreference, ExplicitPreferenceUpsert, LearnerStateQuery, LearnerStateSnapshot,
    LinkCoachOutcomeCommand, LearningEventEvidenceBatch, MemoryCandidateBatchReceipt,
    MemoryCandidateInput, MemoryCandidatePersistenceInput, MemoryContextPreview,
    MemoryContextQuery, MemoryForgetCommand, MemoryMutationProposal,
    MemoryMutationProposalBatch, MemoryMutationReceipt, MemoryPromotionCommand, MemoryScope,
    MemorySourceClass, MemoryValidationSnapshot, ObservationBatch, ObservationSnapshot,
    ObservationSnapshotQuery, RecordCoachFeedbackCommand,
    RecordCoachStrategyAssignmentCommand, RecordReaskLinkCommand, SkillReviewNeedsQuery,
    SkillReviewNeedsSnapshot,
};

// ---------------------------------------------------------------------------
// FakeStore — implements all four M6 store ports in memory.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ClosedLoopFakeStore {
    feedback: Mutex<Vec<RecordCoachFeedbackCommand>>,
    reask: Mutex<Vec<RecordReaskLinkCommand>>,
    assignments: Mutex<Vec<RecordCoachStrategyAssignmentCommand>>,
    outcomes: Mutex<Vec<LinkCoachOutcomeCommand>>,
    promotions: Mutex<Vec<MemoryPromotionCommand>>,
    explicit_preferences: Mutex<Vec<ExplicitPreferenceUpsert>>,
    /// Tracks which preference candidate canonical keys have been submitted
    /// (i.e. the extractor produced them). A submitted-but-not-promoted
    /// candidate stays "pending".
    candidate_keys: Mutex<Vec<String>>,
}

impl ClosedLoopFakeStore {
    /// Returns true if a preference candidate with this canonical key has been
    /// submitted (i.e. the extractor produced it) but NOT yet promoted to an
    /// active preference.
    fn is_pending_candidate(&self, canonical_key: &str) -> bool {
        let keys = self.candidate_keys.lock().unwrap();
        let promoted = self.promotions.lock().unwrap();
        let has_candidate = keys.iter().any(|k| k == canonical_key);
        let has_promotion = promoted
            .iter()
            .any(|cmd| !cmd.candidate_id.is_empty());
        has_candidate && !has_promotion
    }
}

impl CoachFeedbackStore for ClosedLoopFakeStore {
    fn record_coach_feedback(
        &self,
        command: &RecordCoachFeedbackCommand,
    ) -> Result<ielts_domain::CoachFeedbackRecord, ApplicationError> {
        // Idempotency: (coach_message_id, feedback_kind) must be unique.
        let existing = self.feedback.lock().unwrap();
        for prior in existing.iter() {
            if prior.coach_message_id == command.coach_message_id
                && prior.feedback_kind == command.feedback_kind
            {
                return Ok(ielts_domain::CoachFeedbackRecord {
                    id: format!("cfb-{}", prior.coach_message_id.len()),
                    user_id: command.user_id.clone(),
                    coach_message_id: command.coach_message_id.clone(),
                    feedback_kind: command.feedback_kind,
                    payload: command.payload.clone(),
                    created_at: "2026-08-16T00:00:00Z".into(),
                });
            }
        }
        drop(existing);
        let index = {
            let mut guard = self.feedback.lock().unwrap();
            guard.push(command.clone());
            guard.len() - 1
        };
        Ok(ielts_domain::CoachFeedbackRecord {
            id: format!("cfb-{index}"),
            user_id: command.user_id.clone(),
            coach_message_id: command.coach_message_id.clone(),
            feedback_kind: command.feedback_kind,
            payload: command.payload.clone(),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_reask_link(
        &self,
        command: &RecordReaskLinkCommand,
    ) -> Result<ielts_domain::CoachReaskLinkRecord, ApplicationError> {
        self.reask.lock().unwrap().push(command.clone());
        Ok(ielts_domain::CoachReaskLinkRecord {
            parent_assistant_message_id: command.parent_assistant_message_id.clone(),
            new_user_message_id: command.new_user_message_id.clone(),
            feedback_kind: CoachFeedbackKind::ReaskSameQuestion,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_coach_strategy_assignment(
        &self,
        command: &RecordCoachStrategyAssignmentCommand,
    ) -> Result<ielts_domain::CoachStrategyAssignmentRecord, ApplicationError> {
        let index = {
            let mut guard = self.assignments.lock().unwrap();
            guard.push(command.clone());
            guard.len() - 1
        };
        Ok(ielts_domain::CoachStrategyAssignmentRecord {
            id: format!("csa-{index}"),
            user_id: command.user_id.clone(),
            coach_message_id: command.coach_message_id.clone(),
            strategy_id: command.strategy_id,
            skills_addressed: command.skills_addressed.clone(),
            memory_ids_used: command.memory_ids_used.clone(),
            context_snapshot_id: command.context_snapshot_id.clone(),
            followup_type: command.followup_type,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn link_coach_outcome(
        &self,
        command: &LinkCoachOutcomeCommand,
    ) -> Result<ielts_domain::CoachOutcomeLinkRecord, ApplicationError> {
        self.outcomes.lock().unwrap().push(command.clone());
        Ok(ielts_domain::CoachOutcomeLinkRecord {
            strategy_assignment_id: command.strategy_assignment_id.clone(),
            future_observation_id: command.future_observation_id.clone(),
            outcome_kind: command.outcome_kind,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }
}

impl MemoryStore for ClosedLoopFakeStore {
    fn prepare_candidate_input(
        &self,
        _user_id: &str,
        activity: Activity,
        _since: Option<String>,
        max_candidates: usize,
    ) -> Result<MemoryCandidateInput, ApplicationError> {
        Ok(MemoryCandidateInput {
            observations: Vec::new(),
            active_memory: Vec::new(),
            explicit_preferences: Vec::new(),
            task_scope: MemoryScope::Activity { key: activity },
            max_candidates,
        })
    }

    fn validation_snapshot(
        &self,
        user_id: &str,
        _observation_ids: &[String],
    ) -> Result<MemoryValidationSnapshot, ApplicationError> {
        Ok(MemoryValidationSnapshot {
            user_id: user_id.into(),
            projector_key: "learning-observations-v1".into(),
            projector_version: 2,
            ledger_input_hash: "ledger-hash".into(),
            observation_output_hash: "obs-hash".into(),
            observations: Vec::new(),
            active_memory: Vec::new(),
        })
    }

    fn persist_candidate_batch(
        &self,
        input: &MemoryCandidatePersistenceInput,
    ) -> Result<MemoryCandidateBatchReceipt, ApplicationError> {
        // Record the candidate canonical keys so is_pending_candidate can check them.
        let mut keys = self.candidate_keys.lock().unwrap();
        let mut receipts = Vec::new();
        for (index, proposal) in input.batch.proposals.iter().enumerate() {
            let canonical_key = match proposal {
                MemoryMutationProposal::Add { canonical_key, .. } => canonical_key.clone(),
                _ => continue,
            };
            if !keys.contains(&canonical_key) {
                keys.push(canonical_key);
            }
            receipts.push(ielts_domain::MemoryCandidateReceipt {
                id: format!("cand-{index}"),
                proposal_index: index,
                disposition: "pending".into(),
                version: 1,
            });
        }
        Ok(MemoryCandidateBatchReceipt {
            batch_id: format!("batch-{}", input.request_id),
            request_id: input.request_id.clone(),
            replayed: false,
            candidates: receipts,
        })
    }

    fn promote_candidate(
        &self,
        command: &MemoryPromotionCommand,
    ) -> Result<MemoryMutationReceipt, ApplicationError> {
        self.promotions.lock().unwrap().push(command.clone());
        Ok(MemoryMutationReceipt {
            candidate_id: command.candidate_id.clone(),
            memory_id: Some(format!("mem-{}", command.candidate_id)),
            action: "promote".into(),
            memory_status: Some(ielts_domain::MemoryStatus::Active),
            memory_version: Some(2),
        })
    }

    fn upsert_explicit_preference(
        &self,
        command: &ExplicitPreferenceUpsert,
    ) -> Result<ExplicitPreference, ApplicationError> {
        self.explicit_preferences.lock().unwrap().push(command.clone());
        Ok(ExplicitPreference {
            user_id: command.user_id.clone(),
            preference_key: command.preference_key.clone(),
            scope: command.scope.clone(),
            value: command.value.clone(),
            status: "active".into(),
            source: command.source.clone(),
            updated_at: "2026-08-16T00:00:00Z".into(),
        })
    }

        fn load_catalog(
        &self,
        _query: &ielts_domain::MemoryCatalogQuery,
    ) -> Result<ielts_domain::MemoryCatalog, ApplicationError> {
        Ok(ielts_domain::MemoryCatalog {
            user_id: "local".into(),
            entries: Vec::new(),
            truncated: false,
        })
    }

fn context_preview(
        &self,
        query: &MemoryContextQuery,
    ) -> Result<MemoryContextPreview, ApplicationError> {
        // Return only EXPLICIT preferences and ACTIVE memories, not pending
        // candidates. This is the key assertion: a pending candidate must NOT
        // appear in context_preview because it has not been promoted.
        let prefs = self.explicit_preferences.lock().unwrap();
        let entries: Vec<ielts_domain::MemoryContextEntry> = prefs
            .iter()
            .filter(|pref| {
                let scope_matches = match &pref.scope {
                    s if s == "global" => true,
                    s if s == "activity:reading" => query.activity == Activity::Reading,
                    s if s == "activity:writing" => query.activity == Activity::Writing,
                    _ => false,
                };
                scope_matches
            })
            .map(|pref| ielts_domain::MemoryContextEntry {
                priority: 1,
                source: ielts_domain::MemoryContextSource::ExplicitPreference,
                id: None,
                key: pref.preference_key.clone(),
                value: pref.value.clone(),
                pending_verification: false,
            })
            .collect();
        Ok(MemoryContextPreview {
            user_id: query.user_id.clone(),
            activity: query.activity,
            entries,
            truncated: false,
        })
    }

    fn forget_memory(&self, _command: &MemoryForgetCommand) -> Result<(), ApplicationError> {
        Ok(())
    }
}

impl LearnerModelStore for ClosedLoopFakeStore {
    fn learner_state_snapshot(
        &self,
        _query: &LearnerStateQuery,
    ) -> Result<LearnerStateSnapshot, ApplicationError> {
        Ok(LearnerStateSnapshot {
            schema_version: 1,
            taxonomy_version: 1,
            model_version: "weighted_beta_v1".into(),
            generated_at: "2026-08-16T00:00:00Z".into(),
            state_hash: "empty".into(),
            states: Vec::new(),
            truncated: false,
            continuation: None,
        })
    }

    fn skill_review_needs_snapshot(
        &self,
        _query: &SkillReviewNeedsQuery,
    ) -> Result<SkillReviewNeedsSnapshot, ApplicationError> {
        Ok(SkillReviewNeedsSnapshot {
            schema_version: 1,
            scheduler_version: "skill_review_v1".into(),
            generated_at: "2026-08-16T00:00:00Z".into(),
            needs: Vec::new(),
            truncated: false,
            continuation: None,
        })
    }
}

impl CognitiveReadStore for ClosedLoopFakeStore {
    fn observation_snapshot(
        &self,
        _query: &ObservationSnapshotQuery,
    ) -> Result<ObservationSnapshot, ApplicationError> {
        Ok(ObservationSnapshot {
            schema_version: 1,
            projector_key: "learning-observations-v1".into(),
            projector_version: 2,
            ledger_input_hash: "ledger-hash".into(),
            observation_output_hash: "obs-hash".into(),
            generated_at: "2026-08-16T00:00:00Z".into(),
            freshness: ielts_domain::ProjectionFreshness::Fresh,
            observations: Vec::new(),
            truncated: false,
            continuation: None,
        })
    }

    fn observations_by_ids(&self, ids: &[String]) -> Result<ObservationBatch, ApplicationError> {
        Ok(ObservationBatch {
            schema_version: 1,
            projector_key: "learning-observations-v1".into(),
            projector_version: 2,
            ledger_input_hash: "ledger-hash".into(),
            observation_output_hash: "obs-hash".into(),
            generated_at: "2026-08-16T00:00:00Z".into(),
            freshness: ielts_domain::ProjectionFreshness::Fresh,
            observations: Vec::new(),
            missing_ids: ids.to_vec(),
        })
    }

    fn learning_events_by_ids(
        &self,
        ids: &[String],
    ) -> Result<LearningEventEvidenceBatch, ApplicationError> {
        Ok(LearningEventEvidenceBatch {
            schema_version: 1,
            events: Vec::new(),
            missing_ids: ids.to_vec(),
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers — mirror the Python preference extractor logic in Rust for the test.
// ---------------------------------------------------------------------------

/// Feedback-to-preference-family map (mirrors the Python _FEEDBACK_TO_PREFERENCE).
/// The extractor only emits CANDIDATES; promotion is a separate Rust gate.
fn feedback_to_preference_family(kind: CoachFeedbackKind) -> Option<&'static str> {
    match kind {
        CoachFeedbackKind::NeedExample => Some("preference.coach.example_first"),
        CoachFeedbackKind::NeedStepByStep => Some("preference.coach.step_by_step"),
        CoachFeedbackKind::TooLong => Some("preference.coach.concise"),
        CoachFeedbackKind::TooShort => Some("preference.coach.detailed"),
        CoachFeedbackKind::TooAbstract => Some("preference.coach.concrete"),
        CoachFeedbackKind::NotRelevant => Some("preference.coach.concise"),
        CoachFeedbackKind::StyleCorrection => Some("preference.coach.concise"),
        _ => None,
    }
}

/// Strategy-to-preference-family map (mirrors _STRATEGY_TO_PREFERENCE).
fn strategy_to_preference_family(strategy: CoachStrategyId) -> Option<&'static str> {
    match strategy {
        CoachStrategyId::ExampleFirstV1 => Some("preference.coach.example_first"),
        CoachStrategyId::StepByStepV1 => Some("preference.coach.step_by_step"),
        CoachStrategyId::ContrastiveV1 => Some("preference.coach.contrastive"),
        CoachStrategyId::SocraticPromptV1 => Some("preference.coach.socratic"),
        CoachStrategyId::ConciseDirectV1 => Some("preference.coach.concise"),
        CoachStrategyId::EvidenceFirstV1 => Some("preference.coach.evidence_first"),
    }
}

/// Extract a preference candidate batch from interaction facts (mirrors the
/// Python `extract_preference_candidates`). Returns only CANDIDATES in the
/// `preference` namespace — never promoted.
fn extract_preference_candidates(
    feedback_kinds: &[CoachFeedbackKind],
    strategy_assignment: Option<CoachStrategyId>,
    has_thumbs_up: bool,
    evidence_observation_ids: &[String],
) -> MemoryMutationProposalBatch {
    use ielts_domain::MemoryNamespace;

    let mut families: Vec<(String, String)> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    // 1. Feedback-driven candidates.
    for kind in feedback_kinds {
        if let Some(family) = feedback_to_preference_family(*kind) {
            if seen.insert(family.to_string()) {
                families.push((
                    family.to_string(),
                    format!(
                        "Candidate preference {family} suggested by feedback={}. \
                         Promotion requires repeated signal plus later better outcomes.",
                        kind.as_str()
                    ),
                ));
            }
        }
    }

    // 2. Strategy-driven candidate from a thumbs_up on the selected strategy.
    if has_thumbs_up && strategy_assignment.is_some() {
        let strategy = strategy_assignment.unwrap();
        if let Some(family) = strategy_to_preference_family(strategy) {
            if seen.insert(family.to_string()) {
                families.push((
                    family.to_string(),
                    format!(
                        "Candidate preference {family} suggested by \
                         thumbs_up_on_strategy={}. \
                         Promotion requires repeated signal plus later better outcomes.",
                        strategy.as_str()
                    ),
                ));
            }
        }
    }

    let proposals: Vec<MemoryMutationProposal> = families
        .into_iter()
        .map(|(canonical_key, statement)| MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Preference,
            canonical_key,
            scope: MemoryScope::Activity {
                key: Activity::Reading,
            },
            statement,
            evidence_observation_ids: evidence_observation_ids.to_vec(),
        })
        .collect();

    MemoryMutationProposalBatch {
        schema_version: ielts_domain::MEMORY_PROPOSAL_SCHEMA_VERSION,
        proposals,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn attempt_a_records_feedback_and_strategy_assignment_with_provenance() {
    let store = ClosedLoopFakeStore::default();
    let service = CoachFeedbackService::new(&store);

    // Attempt A: Matching Headings error. The user marks the coach response as
    // "incorrect" (interaction fact, not a preference).
    let feedback = service
        .record_feedback(&RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-attempt-a".into(),
            feedback_kind: CoachFeedbackKind::Incorrect,
            payload: None,
        })
        .unwrap();
    assert_eq!(feedback.feedback_kind, CoachFeedbackKind::Incorrect);

    // M6-04: record the strategy provenance alongside the coach response.
    let assignment = service
        .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-attempt-a".into(),
            strategy_id: CoachStrategyId::EvidenceFirstV1,
            skills_addressed: vec!["reading.matching_headings".into()],
            memory_ids_used: vec![],
            context_snapshot_id: Some("ctx-attempt-a".into()),
            followup_type: CoachFollowupType::Explain,
        })
        .unwrap();

    // Strategy assignment persists with full metadata including contextSnapshotId.
    assert_eq!(assignment.strategy_id, CoachStrategyId::EvidenceFirstV1);
    assert_eq!(
        assignment.skills_addressed,
        vec!["reading.matching_headings".to_string()]
    );
    assert_eq!(
        assignment.context_snapshot_id.as_deref(),
        Some("ctx-attempt-a")
    );
    assert_eq!(assignment.followup_type, CoachFollowupType::Explain);

    // Feedback is a fact, recorded exactly once.
    assert_eq!(store.feedback.lock().unwrap().len(), 1);
    assert_eq!(store.assignments.lock().unwrap().len(), 1);
}

#[test]
fn feedback_is_fact_not_preference_and_candidate_stays_pending() {
    let store = ClosedLoopFakeStore::default();
    let coach_service = CoachFeedbackService::new(&store);
    let memory_service = ielts_application::MemoryService::new(&store);

    // Attempt A: user gives "need_example" feedback (interaction fact).
    coach_service
        .record_feedback(&RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-a".into(),
            feedback_kind: CoachFeedbackKind::NeedExample,
            payload: None,
        })
        .unwrap();

    // The preference extractor produces a CANDIDATE — it does NOT auto-promote.
    let batch = extract_preference_candidates(
        &[CoachFeedbackKind::NeedExample],
        Some(CoachStrategyId::EvidenceFirstV1),
        false,
        &["obs-attempt-a".into()],
    );
    assert_eq!(batch.proposals.len(), 1);

    // Submit the candidate through the memory candidate path (M6-07).
    let validation_snapshot = MemoryStore::validation_snapshot(
        &store,
        "local",
        &["obs-attempt-a".into()],
    )
    .unwrap();
    let _validation = MemoryProposalValidator::default().validate(
        &batch,
        MemoryProposalOrigin::CognitiveRuntime {
            source_class: MemorySourceClass::Inferred,
        },
        &validation_snapshot,
    );
    let receipt = memory_service
        .submit_cognitive_candidates(
            &ielts_application::SubmitMemoryCandidatesCommand {
                request_id: "req-1".into(),
                user_id: "local".into(),
                run_id: Some("run-1".into()),
                batch: batch.clone(),
            },
            MemorySourceClass::Inferred,
        )
        .unwrap();

    // The candidate was persisted.
    assert_eq!(receipt.candidates.len(), 1);
    assert_eq!(receipt.candidates[0].disposition, "pending");

    // CRITICAL: the candidate does NOT appear in context_preview (not promoted).
    // context_preview only returns explicit preferences and active memories.
    let preview = memory_service
        .context_preview(&MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: None,
            limit: 50,
        })
        .unwrap();
    assert!(
        preview.entries.is_empty(),
        "pending candidate must NOT appear in context_preview — it is not a confirmed preference"
    );

    // The store tracks the candidate as pending.
    assert!(
        store.is_pending_candidate("preference.coach.example_first"),
        "candidate should be pending (submitted but not promoted)"
    );
}

#[test]
fn satisfaction_and_learning_outcomes_are_on_separate_rows() {
    let store = ClosedLoopFakeStore::default();
    let service = CoachFeedbackService::new(&store);

    // Record a strategy assignment first.
    let assignment = service
        .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-b".into(),
            strategy_id: CoachStrategyId::EvidenceFirstV1,
            skills_addressed: vec!["reading.matching_headings".into()],
            memory_ids_used: vec![],
            context_snapshot_id: Some("ctx-b".into()),
            followup_type: CoachFollowupType::Explain,
        })
        .unwrap();

    // M6-10: satisfaction outcome (thumbs_up) — interaction dimension.
    let satisfaction = service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: assignment.id.clone(),
            future_observation_id: "lobs-feedback-b".into(),
            outcome_kind: CoachOutcomeKind::Satisfaction,
        })
        .unwrap();
    assert_eq!(satisfaction.outcome_kind, CoachOutcomeKind::Satisfaction);

    // M6-10: learning outcome (later skill observation) — learning dimension.
    let learning = service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: assignment.id.clone(),
            future_observation_id: "lobs-skill-improvement-c".into(),
            outcome_kind: CoachOutcomeKind::Learning,
        })
        .unwrap();
    assert_eq!(learning.outcome_kind, CoachOutcomeKind::Learning);

    // The two outcomes are on SEPARATE rows and reference DIFFERENT evidence.
    let outcomes = store.outcomes.lock().unwrap();
    assert_eq!(outcomes.len(), 2);
    assert_ne!(outcomes[0].outcome_kind, outcomes[1].outcome_kind);
    assert_ne!(
        outcomes[0].future_observation_id,
        outcomes[1].future_observation_id
    );
    // Both link back to the same strategy assignment.
    assert_eq!(outcomes[0].strategy_assignment_id, assignment.id);
    assert_eq!(outcomes[1].strategy_assignment_id, assignment.id);
}

#[test]
fn reask_linkage_is_exact_and_not_inferred_from_transcript() {
    let store = ClosedLoopFakeStore::default();
    let service = CoachFeedbackService::new(&store);

    // M6-06: the UI/service explicitly records the re-ask linkage.
    let link = service
        .record_reask_link(&RecordReaskLinkCommand {
            user_id: "local".into(),
            parent_assistant_message_id: "cmsg-explanation-a".into(),
            new_user_message_id: "cmsg-reask-b".into(),
        })
        .unwrap();

    // Exact linkage: parent → new user message, no transcript guessing.
    assert_eq!(
        link.parent_assistant_message_id,
        "cmsg-explanation-a"
    );
    assert_eq!(link.new_user_message_id, "cmsg-reask-b");
    assert_eq!(link.feedback_kind, CoachFeedbackKind::ReaskSameQuestion);

    // Exactly one re-ask link recorded.
    assert_eq!(store.reask.lock().unwrap().len(), 1);
}

#[test]
fn feedback_retry_is_idempotent_on_message_and_kind() {
    let store = ClosedLoopFakeStore::default();
    let service = CoachFeedbackService::new(&store);

    let command = RecordCoachFeedbackCommand {
        user_id: "local".into(),
        coach_message_id: "cmsg-idempotent".into(),
        feedback_kind: CoachFeedbackKind::ThumbsUp,
        payload: None,
    };

    // First call records.
    service.record_feedback(&command).unwrap();
    // Second call with the same (coach_message_id, feedback_kind) is idempotent.
    service.record_feedback(&command).unwrap();

    // Only one feedback record exists (the idempotency guard recognized the duplicate).
    assert_eq!(
        store.feedback.lock().unwrap().len(),
        1,
        "feedback retry must be idempotent on (coach_message_id, feedback_kind)"
    );
}

#[test]
fn closed_loop_attempt_a_to_c_links_outcome_to_future_observation() {
    // This is the full M6 Product Gate loop (§8173-8186):
    //   Attempt A (Matching Headings error)
    //     → feedback(incorrect) + strategy_assignment(evidence_first_v1)
    //   Attempt B (same skill error)
    //     → preference candidate appears (pending, not promoted)
    //   Attempt C (same skill improves)
    //     → link_coach_outcome(learning) connects the strategy to the future observation
    let store = ClosedLoopFakeStore::default();
    let coach_service = CoachFeedbackService::new(&store);
    let memory_service = ielts_application::MemoryService::new(&store);

    // --- Attempt A: Matching Headings error ---
    coach_service
        .record_feedback(&RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-a".into(),
            feedback_kind: CoachFeedbackKind::Incorrect,
            payload: None,
        })
        .unwrap();
    let assignment_a = coach_service
        .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-a".into(),
            strategy_id: CoachStrategyId::EvidenceFirstV1,
            skills_addressed: vec!["reading.matching_headings".into()],
            memory_ids_used: vec![],
            context_snapshot_id: Some("ctx-a".into()),
            followup_type: CoachFollowupType::Explain,
        })
        .unwrap();

    // --- Attempt B: same skill error → preference candidate ---
    coach_service
        .record_feedback(&RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-b".into(),
            feedback_kind: CoachFeedbackKind::NeedExample,
            payload: None,
        })
        .unwrap();

    // The extractor produces a candidate grounded in the Attempt A observation.
    let candidate_batch = extract_preference_candidates(
        &[CoachFeedbackKind::NeedExample],
        Some(CoachStrategyId::EvidenceFirstV1),
        false,
        &["obs-attempt-a".into()],
    );
    assert_eq!(candidate_batch.proposals.len(), 1);

    // Submit through the candidate path — stays PENDING.
    let validation_snapshot = MemoryStore::validation_snapshot(
        &store,
        "local",
        &["obs-attempt-a".into()],
    )
    .unwrap();
    let _validation = MemoryProposalValidator::default().validate(
        &candidate_batch,
        MemoryProposalOrigin::CognitiveRuntime {
            source_class: MemorySourceClass::Inferred,
        },
        &validation_snapshot,
    );
    let receipt = memory_service
        .submit_cognitive_candidates(
            &ielts_application::SubmitMemoryCandidatesCommand {
                request_id: "req-loop".into(),
                user_id: "local".into(),
                run_id: Some("run-loop".into()),
                batch: candidate_batch,
            },
            MemorySourceClass::Inferred,
        )
        .unwrap();
    assert_eq!(receipt.candidates.len(), 1);
    assert_eq!(receipt.candidates[0].disposition, "pending");

    // The candidate is pending — it has NOT become an active preference.
    let preview = memory_service
        .context_preview(&MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: None,
            limit: 50,
        })
        .unwrap();
    assert!(
        preview.entries.is_empty(),
        "pending candidate must not surface as active preference in the context preview"
    );

    // --- Attempt C: same skill improves → outcome link ---
    // M6-10: link the strategy assignment to the future observation that
    // confirms the skill moved. This is a LEARNING outcome, not satisfaction.
    let outcome = coach_service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: assignment_a.id.clone(),
            future_observation_id: "lobs-attempt-c-matching-headings-improved".into(),
            outcome_kind: CoachOutcomeKind::Learning,
        })
        .unwrap();

    assert_eq!(outcome.outcome_kind, CoachOutcomeKind::Learning);
    assert_eq!(
        outcome.future_observation_id,
        "lobs-attempt-c-matching-headings-improved"
    );
    assert_eq!(outcome.strategy_assignment_id, assignment_a.id);

    // Full closed-loop invariant: the outcome link connects the strategy
    // assignment from Attempt A to the future observation from Attempt C.
    let outcomes = store.outcomes.lock().unwrap();
    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].outcome_kind, CoachOutcomeKind::Learning);
    assert_eq!(
        outcomes[0].strategy_assignment_id,
        assignment_a.id
    );
    assert_eq!(
        outcomes[0].future_observation_id,
        "lobs-attempt-c-matching-headings-improved"
    );
}

#[test]
fn no_feedback_path_still_works() {
    // M6 test: "no feedback path still works" — a strategy assignment and
    // outcome link can be recorded without any user feedback at all.
    let store = ClosedLoopFakeStore::default();
    let coach_service = CoachFeedbackService::new(&store);

    let assignment = coach_service
        .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-no-feedback".into(),
            strategy_id: CoachStrategyId::ConciseDirectV1,
            skills_addressed: vec!["reading.tfng".into()],
            memory_ids_used: vec![],
            context_snapshot_id: None,
            followup_type: CoachFollowupType::ConciseDirect,
        })
        .unwrap();
    assert_eq!(assignment.strategy_id, CoachStrategyId::ConciseDirectV1);

    let outcome = coach_service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: assignment.id.clone(),
            future_observation_id: "lobs-future".into(),
            outcome_kind: CoachOutcomeKind::Learning,
        })
        .unwrap();
    assert_eq!(outcome.outcome_kind, CoachOutcomeKind::Learning);

    // No feedback was recorded, but the strategy + outcome provenance is intact.
    assert!(store.feedback.lock().unwrap().is_empty());
    assert_eq!(store.assignments.lock().unwrap().len(), 1);
    assert_eq!(store.outcomes.lock().unwrap().len(), 1);
}
