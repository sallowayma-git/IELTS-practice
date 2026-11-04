//! M6 coach closed-loop application use cases.
//!
//! Thin persistence-backed service that records canonical coach feedback,
//! re-ask linkage, and strategy assignment provenance. The
//! service owns the use-case boundary; the Tauri adapter only supplies the
//! persistence port and maps the result to an IPC envelope.
//!
//! These are user-interaction facts and teaching-strategy provenance, not
//! long-term preferences. M6-07 only promotes repeated patterns to memory
//! candidates after later evidence confirms a stable preference.

use ielts_domain::{
    CoachFeedbackRecord, CoachReaskLinkRecord, CoachStrategyAssignmentRecord,
    RecordCoachFeedbackCommand, RecordCoachStrategyAssignmentCommand, RecordReaskLinkCommand,
};

use crate::ApplicationError;

/// Persistence port for the M6 coach closed loop.
pub trait CoachFeedbackStore {
    fn record_coach_feedback(
        &self,
        command: &RecordCoachFeedbackCommand,
    ) -> Result<CoachFeedbackRecord, ApplicationError>;

    fn record_reask_link(
        &self,
        command: &RecordReaskLinkCommand,
    ) -> Result<CoachReaskLinkRecord, ApplicationError>;

    fn record_coach_strategy_assignment(
        &self,
        command: &RecordCoachStrategyAssignmentCommand,
    ) -> Result<CoachStrategyAssignmentRecord, ApplicationError>;
}

pub struct CoachFeedbackService<'a> {
    store: &'a dyn CoachFeedbackStore,
}

impl<'a> CoachFeedbackService<'a> {
    pub fn new(store: &'a dyn CoachFeedbackStore) -> Self {
        Self { store }
    }

    /// M6-05: record canonical coach feedback. Idempotent on
    /// (coach_message_id, feedback_kind).
    pub fn record_feedback(
        &self,
        command: &RecordCoachFeedbackCommand,
    ) -> Result<CoachFeedbackRecord, ApplicationError> {
        self.store.record_coach_feedback(command)
    }

    /// M6-06: record a re-ask linkage between a prior assistant message and a
    /// new user message.
    pub fn record_reask_link(
        &self,
        command: &RecordReaskLinkCommand,
    ) -> Result<CoachReaskLinkRecord, ApplicationError> {
        self.store.record_reask_link(command)
    }

    /// M6-04: record the teaching-strategy provenance for a coach response.
    pub fn record_strategy_assignment(
        &self,
        command: &RecordCoachStrategyAssignmentCommand,
    ) -> Result<CoachStrategyAssignmentRecord, ApplicationError> {
        self.store.record_coach_strategy_assignment(command)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use ielts_domain::{
        CoachFeedbackKind, CoachFollowupType, CoachStrategyId, RecordCoachFeedbackCommand,
        RecordCoachStrategyAssignmentCommand, RecordReaskLinkCommand,
    };

    use super::*;

    #[derive(Default)]
    struct FakeStore {
        feedback: Mutex<Vec<CoachFeedbackRecord>>,
        reask: Mutex<Vec<CoachReaskLinkRecord>>,
        assignments: Mutex<Vec<CoachStrategyAssignmentRecord>>,
    }

    impl CoachFeedbackStore for FakeStore {
        fn record_coach_feedback(
            &self,
            command: &RecordCoachFeedbackCommand,
        ) -> Result<CoachFeedbackRecord, ApplicationError> {
            let record = CoachFeedbackRecord {
                id: format!("cfb-{}", self.feedback.lock().unwrap().len()),
                user_id: command.user_id.clone(),
                coach_message_id: command.coach_message_id.clone(),
                feedback_kind: command.feedback_kind,
                payload: command.payload.clone(),
                created_at: "2026-08-16T00:00:00Z".into(),
            };
            self.feedback.lock().unwrap().push(record.clone());
            Ok(record)
        }

        fn record_reask_link(
            &self,
            command: &RecordReaskLinkCommand,
        ) -> Result<CoachReaskLinkRecord, ApplicationError> {
            let record = CoachReaskLinkRecord {
                parent_assistant_message_id: command.parent_assistant_message_id.clone(),
                new_user_message_id: command.new_user_message_id.clone(),
                feedback_kind: CoachFeedbackKind::ReaskSameQuestion,
                created_at: "2026-08-16T00:00:00Z".into(),
            };
            self.reask.lock().unwrap().push(record.clone());
            Ok(record)
        }

        fn record_coach_strategy_assignment(
            &self,
            command: &RecordCoachStrategyAssignmentCommand,
        ) -> Result<CoachStrategyAssignmentRecord, ApplicationError> {
            let record = CoachStrategyAssignmentRecord {
                id: format!("csa-{}", self.assignments.lock().unwrap().len()),
                user_id: command.user_id.clone(),
                coach_message_id: command.coach_message_id.clone(),
                strategy_id: command.strategy_id,
                skills_addressed: command.skills_addressed.clone(),
                memory_ids_used: command.memory_ids_used.clone(),
                context_snapshot_id: command.context_snapshot_id.clone(),
                followup_type: command.followup_type,
                created_at: "2026-08-16T00:00:00Z".into(),
            };
            self.assignments.lock().unwrap().push(record.clone());
            Ok(record)
        }
    }

    #[test]
    fn delegates_feedback_to_store() {
        let store = FakeStore::default();
        let service = CoachFeedbackService::new(&store);
        let record = service
            .record_feedback(&RecordCoachFeedbackCommand {
                user_id: "local".into(),
                coach_message_id: "cmsg-1".into(),
                feedback_kind: CoachFeedbackKind::ThumbsUp,
                payload: None,
            })
            .unwrap();
        assert_eq!(record.feedback_kind, CoachFeedbackKind::ThumbsUp);
        assert_eq!(store.feedback.lock().unwrap().len(), 1);
    }

    #[test]
    fn delegates_reask_link_to_store() {
        let store = FakeStore::default();
        let service = CoachFeedbackService::new(&store);
        let record = service
            .record_reask_link(&RecordReaskLinkCommand {
                user_id: "local".into(),
                parent_assistant_message_id: "cmsg-parent".into(),
                new_user_message_id: "cmsg-user".into(),
            })
            .unwrap();
        assert_eq!(record.feedback_kind, CoachFeedbackKind::ReaskSameQuestion);
    }

    #[test]
    fn delegates_strategy_assignment_to_store() {
        let store = FakeStore::default();
        let service = CoachFeedbackService::new(&store);
        let assignment = service
            .record_strategy_assignment(&RecordCoachStrategyAssignmentCommand {
                user_id: "local".into(),
                coach_message_id: "cmsg-1".into(),
                strategy_id: CoachStrategyId::EvidenceFirstV1,
                skills_addressed: vec!["reading.tfng".into()],
                memory_ids_used: vec![],
                context_snapshot_id: None,
                followup_type: CoachFollowupType::Explain,
            })
            .unwrap();
        assert_eq!(assignment.strategy_id, CoachStrategyId::EvidenceFirstV1);
    }
}
