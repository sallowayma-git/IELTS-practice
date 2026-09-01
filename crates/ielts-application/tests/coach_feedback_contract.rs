//! M6 coach closed-loop application contract tests.
//!
//! Verifies the CoachFeedbackService delegates to its store port and that the
//! contract remains read/write-strict across the Tauri-bound store.

use ielts_application::{ApplicationError, CoachFeedbackService, CoachFeedbackStore};
use ielts_domain::{
    CoachFeedbackKind, CoachFeedbackRecord, CoachFollowupType, CoachOutcomeKind,
    CoachOutcomeLinkRecord, CoachReaskLinkRecord, CoachStrategyAssignmentRecord, CoachStrategyId,
    LinkCoachOutcomeCommand, RecordCoachFeedbackCommand, RecordCoachStrategyAssignmentCommand,
    RecordReaskLinkCommand,
};
use std::sync::Mutex;

#[derive(Default)]
struct CapturingStore {
    feedback: Mutex<Vec<RecordCoachFeedbackCommand>>,
    reask: Mutex<Vec<RecordReaskLinkCommand>>,
    assignments: Mutex<Vec<RecordCoachStrategyAssignmentCommand>>,
    outcomes: Mutex<Vec<LinkCoachOutcomeCommand>>,
}

impl CoachFeedbackStore for CapturingStore {
    fn record_coach_feedback(
        &self,
        command: &RecordCoachFeedbackCommand,
    ) -> Result<CoachFeedbackRecord, ApplicationError> {
        self.feedback.lock().unwrap().push(command.clone());
        Ok(CoachFeedbackRecord {
            id: "cfb-1".into(),
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
    ) -> Result<CoachReaskLinkRecord, ApplicationError> {
        self.reask.lock().unwrap().push(command.clone());
        Ok(CoachReaskLinkRecord {
            parent_assistant_message_id: command.parent_assistant_message_id.clone(),
            new_user_message_id: command.new_user_message_id.clone(),
            feedback_kind: CoachFeedbackKind::ReaskSameQuestion,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn record_coach_strategy_assignment(
        &self,
        command: &RecordCoachStrategyAssignmentCommand,
    ) -> Result<CoachStrategyAssignmentRecord, ApplicationError> {
        self.assignments.lock().unwrap().push(command.clone());
        Ok(CoachStrategyAssignmentRecord {
            id: "csa-1".into(),
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
    ) -> Result<CoachOutcomeLinkRecord, ApplicationError> {
        self.outcomes.lock().unwrap().push(command.clone());
        Ok(CoachOutcomeLinkRecord {
            strategy_assignment_id: command.strategy_assignment_id.clone(),
            future_observation_id: command.future_observation_id.clone(),
            outcome_kind: command.outcome_kind,
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }
}

#[test]
fn service_delegates_feedback_and_preserves_kind() {
    let store = CapturingStore::default();
    let service = CoachFeedbackService::new(&store);
    let record = service
        .record_feedback(&RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-1".into(),
            feedback_kind: CoachFeedbackKind::NeedExample,
            payload: None,
        })
        .unwrap();
    assert_eq!(record.feedback_kind, CoachFeedbackKind::NeedExample);
    assert_eq!(store.feedback.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_reask_link() {
    let store = CapturingStore::default();
    let service = CoachFeedbackService::new(&store);
    let record = service
        .record_reask_link(&RecordReaskLinkCommand {
            user_id: "local".into(),
            parent_assistant_message_id: "cmsg-parent".into(),
            new_user_message_id: "cmsg-user".into(),
        })
        .unwrap();
    assert_eq!(record.feedback_kind, CoachFeedbackKind::ReaskSameQuestion);
    assert_eq!(store.reask.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_strategy_assignment_with_full_metadata() {
    let store = CapturingStore::default();
    let service = CoachFeedbackService::new(&store);
    let record = service
        .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-1".into(),
            strategy_id: CoachStrategyId::SocraticPromptV1,
            skills_addressed: vec!["reading.tfng".into()],
            memory_ids_used: vec!["mem-1".into(), "mem-2".into()],
            context_snapshot_id: Some("ctx-1".into()),
            followup_type: CoachFollowupType::SocraticPrompt,
        })
        .unwrap();
    assert_eq!(record.strategy_id, CoachStrategyId::SocraticPromptV1);
    assert_eq!(record.skills_addressed, vec!["reading.tfng".to_string()]);
    assert_eq!(record.memory_ids_used.len(), 2);
    assert_eq!(record.context_snapshot_id.as_deref(), Some("ctx-1"));
}

#[test]
fn service_delegates_outcome_link_and_keeps_kinds_distinct() {
    let store = CapturingStore::default();
    let service = CoachFeedbackService::new(&store);
    let satisfaction = service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: "csa-1".into(),
            future_observation_id: "lobs-1".into(),
            outcome_kind: CoachOutcomeKind::Satisfaction,
        })
        .unwrap();
    let learning = service
        .link_outcome(&LinkCoachOutcomeCommand {
            strategy_assignment_id: "csa-1".into(),
            future_observation_id: "lobs-1".into(),
            outcome_kind: CoachOutcomeKind::Learning,
        })
        .unwrap();
    assert_ne!(satisfaction.outcome_kind, learning.outcome_kind);
    assert_eq!(store.outcomes.lock().unwrap().len(), 2);
}
