//! M12 General Agent Thread application service.
//!
//! Thin persistence-backed service over the db authority. Owns the use-case
//! boundary: thread lifecycle (M12-01), checkpoint/cancellation (M12-02),
//! study plan CRUD (M12-04), and the controlled-action approval gate
//! (M12-06). Rust is the authority for controlled actions; Python owns the
//! planner orchestration. The service never re-executes write tools on
//! recovery (M12-02).

use ielts_domain::{
    ActionApproval, AgentCheckpointRecord, AgentMessageRecord, AgentThread, AppendMessageCommand,
    CancelOutcome, CreateStudyPlanCommand, CreateThreadCommand,
    DecideApprovalCommand, MarkPlanItemDoneCommand, RecordApprovalCommand, RequestCancelCommand,
    SaveCheckpointCommand, StudyPlan, StudyPlanItem, StudyPlanSnapshot,
    ThreadRecoveryReport,
};

use crate::ApplicationError;

/// Persistence port for the M12 agent thread layer. The Tauri adapter
/// implements this against `ielts_db::agent_thread`; tests use a capturing
/// fake. Each method maps 1:1 to a db function.
pub trait AgentThreadStore {
    fn create_thread(&self, command: &CreateThreadCommand) -> Result<AgentThread, ApplicationError>;
    fn append_message(
        &self,
        command: &AppendMessageCommand,
    ) -> Result<AgentMessageRecord, ApplicationError>;
    fn list_threads(
        &self,
        user_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentThread>, ApplicationError>;
    fn archive_thread(&self, thread_id: &str) -> Result<bool, ApplicationError>;
    fn list_messages(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentMessageRecord>, ApplicationError>;
    fn save_checkpoint(
        &self,
        command: &SaveCheckpointCommand,
    ) -> Result<AgentCheckpointRecord, ApplicationError>;
    fn load_latest_checkpoint(
        &self,
        thread_id: &str,
    ) -> Result<Option<AgentCheckpointRecord>, ApplicationError>;
    fn request_cancel(&self, command: &RequestCancelCommand)
        -> Result<CancelOutcome, ApplicationError>;
    fn restart_recovery(&self) -> Result<ThreadRecoveryReport, ApplicationError>;
    fn create_study_plan(
        &self,
        command: &CreateStudyPlanCommand,
    ) -> Result<StudyPlan, ApplicationError>;
    fn list_study_plan_items(&self, plan_id: &str) -> Result<Vec<StudyPlanItem>, ApplicationError>;
    fn load_latest_plan(&self, user_id: &str)
        -> Result<Option<StudyPlanSnapshot>, ApplicationError>;
    fn mark_plan_item_done(
        &self,
        command: &MarkPlanItemDoneCommand,
    ) -> Result<bool, ApplicationError>;
    fn record_action_approval(
        &self,
        command: &RecordApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError>;
    fn list_pending_approvals(&self, limit: u32) -> Result<Vec<ActionApproval>, ApplicationError>;
    fn decide_approval(
        &self,
        command: &DecideApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError>;
}

pub struct AgentThreadService<'a> {
    store: &'a dyn AgentThreadStore,
}

impl<'a> AgentThreadService<'a> {
    pub fn new(store: &'a dyn AgentThreadStore) -> Self {
        Self { store }
    }

    /// M12-01: create a thread.
    pub fn create_thread(
        &self,
        command: &CreateThreadCommand,
    ) -> Result<AgentThread, ApplicationError> {
        validate_user_id(&command.user_id)?;
        validate_title(&command.title)?;
        self.store.create_thread(command)
    }

    /// M12-01: append a message to a thread (sequence auto-increments).
    pub fn append_message(
        &self,
        command: &AppendMessageCommand,
    ) -> Result<AgentMessageRecord, ApplicationError> {
        validate_thread_id(&command.thread_id)?;
        if command.content.trim().is_empty() {
            return Err(ApplicationError::new(
                "agent_thread.invalid_request",
                "message content is required",
                false,
            ));
        }
        self.store.append_message(command)
    }

    /// M12-01: list threads for a user.
    pub fn list_threads(
        &self,
        user_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentThread>, ApplicationError> {
        validate_user_id(user_id)?;
        self.store.list_threads(user_id, limit)
    }

    /// M12-01: archive a thread.
    pub fn archive_thread(&self, thread_id: &str) -> Result<bool, ApplicationError> {
        validate_thread_id(thread_id)?;
        self.store.archive_thread(thread_id)
    }

    /// M12-01: list messages for a thread in sequence order.
    pub fn list_messages(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentMessageRecord>, ApplicationError> {
        validate_thread_id(thread_id)?;
        self.store.list_messages(thread_id, limit)
    }

    /// M12-02: save a checkpoint.
    pub fn save_checkpoint(
        &self,
        command: &SaveCheckpointCommand,
    ) -> Result<AgentCheckpointRecord, ApplicationError> {
        validate_thread_id(&command.thread_id)?;
        self.store.save_checkpoint(command)
    }

    /// M12-02: load the latest checkpoint for a thread.
    pub fn load_latest_checkpoint(
        &self,
        thread_id: &str,
    ) -> Result<Option<AgentCheckpointRecord>, ApplicationError> {
        validate_thread_id(thread_id)?;
        self.store.load_latest_checkpoint(thread_id)
    }

    /// M12-02: request cancellation of a thread run. Returns whether a
    /// non-terminal checkpoint was interrupted.
    pub fn request_cancel(
        &self,
        command: &RequestCancelCommand,
    ) -> Result<CancelOutcome, ApplicationError> {
        validate_thread_id(&command.thread_id)?;
        self.store.request_cancel(command)
    }

    /// M12-02: startup recovery. Marks interrupted threads; never replays
    /// write tools.
    pub fn restart_recovery(&self) -> Result<ThreadRecoveryReport, ApplicationError> {
        self.store.restart_recovery()
    }

    /// M12-04: create a study plan with its items.
    pub fn create_study_plan(
        &self,
        command: &CreateStudyPlanCommand,
    ) -> Result<StudyPlan, ApplicationError> {
        validate_user_id(&command.user_id)?;
        if command.goal.trim().is_empty() {
            return Err(ApplicationError::new(
                "agent_thread.invalid_request",
                "study plan goal is required",
                false,
            ));
        }
        for item in &command.items {
            if item.skill_probe.trim().is_empty() || item.why_text.trim().is_empty() {
                return Err(ApplicationError::new(
                    "agent_thread.invalid_request",
                    "study plan item skill_probe and why_text are required",
                    false,
                ));
            }
        }
        self.store.create_study_plan(command)
    }

    /// Latest plan + items for the console plan panel (plan ids are not
    /// thread ids; the host hands the real snapshot to the product).
    pub fn load_latest_plan(
        &self,
        user_id: &str,
    ) -> Result<Option<StudyPlanSnapshot>, ApplicationError> {
        validate_user_id(user_id)?;
        self.store.load_latest_plan(user_id)
    }

    /// M12-04: list study plan items.
    pub fn list_study_plan_items(
        &self,
        plan_id: &str,
    ) -> Result<Vec<StudyPlanItem>, ApplicationError> {
        if plan_id.trim().is_empty() {
            return Err(ApplicationError::new(
                "agent_thread.invalid_request",
                "plan_id is required",
                false,
            ));
        }
        self.store.list_study_plan_items(plan_id)
    }

    /// M12-04: mark a plan item done (or not done).
    pub fn mark_plan_item_done(
        &self,
        command: &MarkPlanItemDoneCommand,
    ) -> Result<bool, ApplicationError> {
        if command.item_id.trim().is_empty() {
            return Err(ApplicationError::new(
                "agent_thread.invalid_request",
                "item_id is required",
                false,
            ));
        }
        self.store.mark_plan_item_done(command)
    }

    /// M12-06: record a controlled action as pending. Allow-list kinds are
    /// rejected here (they should be executed directly, not recorded). The
    /// reverse-RPC dispatcher rejects forbidden kinds before reaching this
    /// method.
    pub fn record_action_approval(
        &self,
        command: &RecordApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError> {
        if command.action_kind.gate() == ielts_domain::ActionGate::Allow {
            return Err(ApplicationError::new(
                "agent_thread.allow_listed_action",
                format!(
                    "action_kind {} is allow-listed and does not require approval",
                    command.action_kind.as_str()
                ),
                false,
            ));
        }
        self.store.record_action_approval(command)
    }

    /// M12-06: list pending approvals.
    pub fn list_pending_approvals(
        &self,
        limit: u32,
    ) -> Result<Vec<ActionApproval>, ApplicationError> {
        self.store.list_pending_approvals(limit)
    }

    /// M12-06: decide a pending approval (approve or reject).
    pub fn decide_approval(
        &self,
        command: &DecideApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError> {
        if command.approval_id.trim().is_empty() || command.approved_by.trim().is_empty() {
            return Err(ApplicationError::new(
                "agent_thread.invalid_request",
                "approval_id and approved_by are required",
                false,
            ));
        }
        self.store.decide_approval(command)
    }
}

fn validate_user_id(user_id: &str) -> Result<(), ApplicationError> {
    if user_id.trim().is_empty() {
        return Err(ApplicationError::new(
            "agent_thread.invalid_request",
            "user_id is required",
            false,
        ));
    }
    Ok(())
}

fn validate_thread_id(thread_id: &str) -> Result<(), ApplicationError> {
    if thread_id.trim().is_empty() {
        return Err(ApplicationError::new(
            "agent_thread.invalid_request",
            "thread_id is required",
            false,
        ));
    }
    Ok(())
}

fn validate_title(title: &str) -> Result<(), ApplicationError> {
    if title.trim().is_empty() {
        return Err(ApplicationError::new(
            "agent_thread.invalid_request",
            "title is required",
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ielts_domain::{
        ActionKind, ApprovalStatus, CheckpointStage, DecideApprovalCommand, MessageRole,
        RecordApprovalCommand, RequestCancelCommand, SaveCheckpointCommand, ThreadKind,
    };
    use serde_json::json;
    use std::sync::Mutex;

    #[derive(Default)]
    struct CapturingStore {
        threads: Mutex<Vec<AgentThread>>,
        messages: Mutex<Vec<AgentMessageRecord>>,
        checkpoints: Mutex<Vec<AgentCheckpointRecord>>,
        approvals: Mutex<Vec<ActionApproval>>,
        cancel_calls: Mutex<Vec<RequestCancelCommand>>,
        recovery: Mutex<Option<ThreadRecoveryReport>>,
    }

    impl AgentThreadStore for CapturingStore {
        fn create_thread(
            &self,
            command: &CreateThreadCommand,
        ) -> Result<AgentThread, ApplicationError> {
            let thread = AgentThread {
                id: "at-1".into(),
                user_id: command.user_id.clone(),
                thread_kind: command.thread_kind,
                title: command.title.clone(),
                summary: None,
                sequence: 0,
                last_message_at: None,
                status: ielts_domain::ThreadStatus::Active,
                created_at: "2026-08-16T00:00:00Z".into(),
                updated_at: "2026-08-16T00:00:00Z".into(),
            };
            self.threads.lock().unwrap().push(thread.clone());
            Ok(thread)
        }

        fn append_message(
            &self,
            command: &AppendMessageCommand,
        ) -> Result<AgentMessageRecord, ApplicationError> {
            let message = AgentMessageRecord {
                id: "am-1".into(),
                thread_id: command.thread_id.clone(),
                role: command.role,
                sequence: 1,
                content: command.content.clone(),
                payload: command.payload.clone(),
                created_at: "2026-08-16T00:00:00Z".into(),
            };
            self.messages.lock().unwrap().push(message.clone());
            Ok(message)
        }

        fn list_threads(
            &self,
            _user_id: &str,
            _limit: u32,
        ) -> Result<Vec<AgentThread>, ApplicationError> {
            Ok(self.threads.lock().unwrap().clone())
        }

        fn archive_thread(&self, _thread_id: &str) -> Result<bool, ApplicationError> {
            Ok(true)
        }

        fn list_messages(
            &self,
            _thread_id: &str,
            _limit: u32,
        ) -> Result<Vec<AgentMessageRecord>, ApplicationError> {
            Ok(self.messages.lock().unwrap().clone())
        }

        fn save_checkpoint(
            &self,
            command: &SaveCheckpointCommand,
        ) -> Result<AgentCheckpointRecord, ApplicationError> {
            let checkpoint = AgentCheckpointRecord {
                id: "acp-1".into(),
                thread_id: command.thread_id.clone(),
                run_id: command.run_id.clone(),
                stage: command.stage,
                payload: command.payload.clone(),
                created_at: "2026-08-16T00:00:00Z".into(),
            };
            self.checkpoints.lock().unwrap().push(checkpoint.clone());
            Ok(checkpoint)
        }

        fn load_latest_checkpoint(
            &self,
            _thread_id: &str,
        ) -> Result<Option<AgentCheckpointRecord>, ApplicationError> {
            Ok(self.checkpoints.lock().unwrap().last().cloned())
        }

        fn request_cancel(
            &self,
            command: &RequestCancelCommand,
        ) -> Result<CancelOutcome, ApplicationError> {
            self.cancel_calls.lock().unwrap().push(command.clone());
            Ok(CancelOutcome {
                thread_id: command.thread_id.clone(),
                cancelled: true,
            })
        }

        fn restart_recovery(&self) -> Result<ThreadRecoveryReport, ApplicationError> {
            Ok(self.recovery.lock().unwrap().clone().unwrap_or(ThreadRecoveryReport {
                interrupted_threads: 0,
                interrupted_checkpoints: 0,
            }))
        }

        fn create_study_plan(
            &self,
            _command: &CreateStudyPlanCommand,
        ) -> Result<StudyPlan, ApplicationError> {
            Ok(StudyPlan {
                id: "sp-1".into(),
                user_id: "local".into(),
                goal: "goal".into(),
                available_minutes: 30,
                target_date: None,
                created_at: "2026-08-16T00:00:00Z".into(),
                updated_at: "2026-08-16T00:00:00Z".into(),
            })
        }

        fn list_study_plan_items(
            &self,
            _plan_id: &str,
        ) -> Result<Vec<StudyPlanItem>, ApplicationError> {
            Ok(vec![])
        }

        fn load_latest_plan(
            &self,
            _user_id: &str,
        ) -> Result<Option<StudyPlanSnapshot>, ApplicationError> {
            Ok(None)
        }

        fn mark_plan_item_done(
            &self,
            _command: &MarkPlanItemDoneCommand,
        ) -> Result<bool, ApplicationError> {
            Ok(true)
        }

        fn record_action_approval(
            &self,
            command: &RecordApprovalCommand,
        ) -> Result<ActionApproval, ApplicationError> {
            let approval = ActionApproval {
                id: "aaa-1".into(),
                thread_id: command.thread_id.clone(),
                action_kind: command.action_kind,
                payload: command.payload.clone(),
                status: ApprovalStatus::Pending,
                approved_by: None,
                created_at: "2026-08-16T00:00:00Z".into(),
                decided_at: None,
            };
            self.approvals.lock().unwrap().push(approval.clone());
            Ok(approval)
        }

        fn list_pending_approvals(
            &self,
            _limit: u32,
        ) -> Result<Vec<ActionApproval>, ApplicationError> {
            Ok(self.approvals.lock().unwrap().clone())
        }

        fn decide_approval(
            &self,
            command: &DecideApprovalCommand,
        ) -> Result<ActionApproval, ApplicationError> {
            let mut approvals = self.approvals.lock().unwrap();
            let approval = approvals.first_mut().unwrap();
            approval.status = command.status;
            approval.approved_by = Some(command.approved_by.clone());
            approval.decided_at = Some("2026-08-16T00:00:01Z".into());
            Ok(approval.clone())
        }
    }

    #[test]
    fn create_thread_validates_required_fields() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let err = service
            .create_thread(&CreateThreadCommand {
                user_id: "".into(),
                thread_kind: ThreadKind::Workspace,
                title: "t".into(),
            })
            .unwrap_err();
        assert_eq!(err.code, "agent_thread.invalid_request");
    }

    #[test]
    fn append_message_rejects_empty_content() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let err = service
            .append_message(&AppendMessageCommand {
                thread_id: "at-1".into(),
                role: MessageRole::User,
                content: "  ".into(),
                payload: None,
            })
            .unwrap_err();
        assert_eq!(err.code, "agent_thread.invalid_request");
    }

    #[test]
    fn record_action_approval_rejects_allow_listed_kind() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let err = service
            .record_action_approval(&RecordApprovalCommand {
                thread_id: Some("at-1".into()),
                action_kind: ActionKind::CreateStudyPlanDraft,
                payload: json!({}),
            })
            .unwrap_err();
        assert_eq!(err.code, "agent_thread.allow_listed_action");
    }

    #[test]
    fn record_action_approval_accepts_approval_gated_kind() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let approval = service
            .record_action_approval(&RecordApprovalCommand {
                thread_id: Some("at-1".into()),
                action_kind: ActionKind::BulkArchive,
                payload: json!({"scope": "reading"}),
            })
            .unwrap();
        assert_eq!(approval.action_kind, ActionKind::BulkArchive);
        assert_eq!(approval.status, ApprovalStatus::Pending);
    }

    #[test]
    fn decide_approval_validates_required_fields() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let err = service
            .decide_approval(&DecideApprovalCommand {
                approval_id: "".into(),
                status: ApprovalStatus::Approved,
                approved_by: "user".into(),
            })
            .unwrap_err();
        assert_eq!(err.code, "agent_thread.invalid_request");
    }

    #[test]
    fn request_cancel_delegates_to_store() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let outcome = service
            .request_cancel(&RequestCancelCommand {
                thread_id: "at-1".into(),
            })
            .unwrap();
        assert!(outcome.cancelled);
        assert_eq!(store.cancel_calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn save_checkpoint_delegates_to_store() {
        let store = CapturingStore::default();
        let service = AgentThreadService::new(&store);
        let checkpoint = service
            .save_checkpoint(&SaveCheckpointCommand {
                thread_id: "at-1".into(),
                run_id: Some("run-1".into()),
                stage: CheckpointStage::ContextBuilt,
                payload: Some(json!({"ctx": "built"})),
            })
            .unwrap();
        assert_eq!(checkpoint.stage, CheckpointStage::ContextBuilt);
    }
}
