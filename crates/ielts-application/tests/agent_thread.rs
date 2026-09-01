//! M12 General Agent Thread application contract tests.
//!
//! Verifies the `AgentThreadService` delegates to its store port and that
//! the M12 contract invariants hold at the use-case boundary. These tests
//! wire the service to the real `ielts_db` persistence (via a thin store
//! adapter) so the contract is exercised end-to-end at the application
//! layer, not just the SQLite boundary:
//! - allow-listed action rejected (M12-06)
//! - approval-gated action pending -> approved (M12-06)
//! - forbidden action kind rejected by the authority guard (M12-06)
//! - cancel writes final checkpoint (M12-02)
//! - restart recovery marks interrupted threads (M12-02)
//! - thread privacy scoped by user_id (M12-01)
//! - study plan CRUD stable (M12-04)

use ielts_application::{AgentThreadService, AgentThreadStore, ApplicationError};
use ielts_db::{migrate, open_connection, DbOpenOptions};
use ielts_domain::{
    ActionApproval, AgentCheckpointRecord, AgentMessageRecord, AgentThread,
    AppendMessageCommand, CancelOutcome, CheckpointStage, CreateStudyPlanCommand,
    CreateStudyPlanItemCommand, CreateThreadCommand, DecideApprovalCommand, MarkPlanItemDoneCommand,
    MessageRole, RecordApprovalCommand, RequestCancelCommand, SaveCheckpointCommand, ThreadKind,
    ThreadRecoveryReport,
};
use serde_json::json;
use tempfile::tempdir;

struct DbStore {
    conn: rusqlite::Connection,
}

impl DbStore {
    fn new(conn: rusqlite::Connection) -> Self {
        Self { conn }
    }
}

impl AgentThreadStore for DbStore {
    fn create_thread(
        &self,
        command: &CreateThreadCommand,
    ) -> Result<AgentThread, ApplicationError> {
        ielts_db::create_thread(&self.conn, command).map_err(db_error)
    }

    fn append_message(
        &self,
        command: &AppendMessageCommand,
    ) -> Result<AgentMessageRecord, ApplicationError> {
        ielts_db::append_message(&self.conn, command).map_err(db_error)
    }

    fn list_threads(
        &self,
        user_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentThread>, ApplicationError> {
        ielts_db::list_threads(&self.conn, user_id, limit).map_err(db_error)
    }

    fn archive_thread(&self, thread_id: &str) -> Result<bool, ApplicationError> {
        ielts_db::archive_thread(&self.conn, thread_id).map_err(db_error)
    }

    fn list_messages(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentMessageRecord>, ApplicationError> {
        ielts_db::list_messages(&self.conn, thread_id, limit).map_err(db_error)
    }

    fn save_checkpoint(
        &self,
        command: &SaveCheckpointCommand,
    ) -> Result<AgentCheckpointRecord, ApplicationError> {
        ielts_db::save_checkpoint(&self.conn, command).map_err(db_error)
    }

    fn load_latest_checkpoint(
        &self,
        thread_id: &str,
    ) -> Result<Option<AgentCheckpointRecord>, ApplicationError> {
        ielts_db::load_latest_checkpoint(&self.conn, thread_id).map_err(db_error)
    }

    fn request_cancel(
        &self,
        command: &RequestCancelCommand,
    ) -> Result<CancelOutcome, ApplicationError> {
        ielts_db::request_thread_cancel(&self.conn, command).map_err(db_error)
    }

    fn restart_recovery(&self) -> Result<ThreadRecoveryReport, ApplicationError> {
        ielts_db::restart_recovery(&self.conn).map_err(db_error)
    }

    fn create_study_plan(
        &self,
        command: &CreateStudyPlanCommand,
    ) -> Result<ielts_domain::StudyPlan, ApplicationError> {
        ielts_db::create_study_plan(&self.conn, command).map_err(db_error)
    }

    fn list_study_plan_items(
        &self,
        plan_id: &str,
    ) -> Result<Vec<ielts_domain::StudyPlanItem>, ApplicationError> {
        ielts_db::list_study_plan_items(&self.conn, plan_id).map_err(db_error)
    }

    fn load_latest_plan(
        &self,
        user_id: &str,
    ) -> Result<Option<ielts_domain::StudyPlanSnapshot>, ApplicationError> {
        ielts_db::load_latest_study_plan(&self.conn, user_id).map_err(db_error)
    }

    fn mark_plan_item_done(
        &self,
        command: &MarkPlanItemDoneCommand,
    ) -> Result<bool, ApplicationError> {
        ielts_db::mark_plan_item_done(&self.conn, command).map_err(db_error)
    }

    fn record_action_approval(
        &self,
        command: &RecordApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError> {
        ielts_db::record_action_approval(&self.conn, command).map_err(db_error)
    }

    fn list_pending_approvals(&self, limit: u32) -> Result<Vec<ActionApproval>, ApplicationError> {
        ielts_db::list_pending_approvals(&self.conn, limit).map_err(db_error)
    }

    fn decide_approval(
        &self,
        command: &DecideApprovalCommand,
    ) -> Result<ActionApproval, ApplicationError> {
        ielts_db::decide_approval(&self.conn, command).map_err(db_error)
    }
}

fn db_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("agent_thread.persistence_failed", error.to_string(), false)
}

fn open_store() -> DbStore {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    // Keep the tempdir alive for the test by leaking it (test process exits).
    std::mem::forget(dir);
    DbStore::new(conn)
}

fn service(store: &DbStore) -> AgentThreadService<'_> {
    AgentThreadService::new(store)
}

fn seed_thread(store: &DbStore, user_id: &str, kind: ThreadKind, title: &str) -> String {
    service(store)
        .create_thread(&CreateThreadCommand {
            user_id: user_id.into(),
            thread_kind: kind,
            title: title.into(),
        })
        .unwrap()
        .id
}

#[test]
fn create_thread_validates_user_id() {
    let store = open_store();
    let err = service(&store)
        .create_thread(&CreateThreadCommand {
            user_id: "  ".into(),
            thread_kind: ThreadKind::Workspace,
            title: "t".into(),
        })
        .unwrap_err();
    assert_eq!(err.code, "agent_thread.invalid_request");
}

#[test]
fn append_message_validates_content() {
    let store = open_store();
    let thread_id = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let err = service(&store)
        .append_message(&AppendMessageCommand {
            thread_id,
            role: MessageRole::User,
            content: "".into(),
            payload: None,
        })
        .unwrap_err();
    assert_eq!(err.code, "agent_thread.invalid_request");
}

#[test]
fn record_approval_rejects_allow_listed_kind() {
    let store = open_store();
    let thread_id = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let err = service(&store)
        .record_action_approval(&RecordApprovalCommand {
            thread_id: Some(thread_id),
            action_kind: ielts_domain::ActionKind::MarkPlanItemDone,
            payload: json!({}),
        })
        .unwrap_err();
    assert_eq!(err.code, "agent_thread.allow_listed_action");
}

#[test]
fn approval_gated_action_pending_to_approved() {
    let store = open_store();
    let thread_id = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let svc = service(&store);
    let approval = svc
        .record_action_approval(&RecordApprovalCommand {
            thread_id: Some(thread_id),
            action_kind: ielts_domain::ActionKind::ChangePersonalizationSettings,
            payload: json!({"key": "teaching.verbosity"}),
        })
        .unwrap();
    assert_eq!(approval.status, ielts_domain::ApprovalStatus::Pending);
    let pending = svc.list_pending_approvals(10).unwrap();
    assert_eq!(pending.len(), 1);
    let decided = svc
        .decide_approval(&DecideApprovalCommand {
            approval_id: approval.id,
            status: ielts_domain::ApprovalStatus::Approved,
            approved_by: "user".into(),
        })
        .unwrap();
    assert_eq!(decided.status, ielts_domain::ApprovalStatus::Approved);
    assert!(svc.list_pending_approvals(10).unwrap().is_empty());
}

#[test]
fn forbidden_action_kind_is_rejected_by_authority() {
    assert!(ielts_domain::is_forbidden_action_kind("direct_sql"));
    assert!(ielts_domain::is_forbidden_action_kind("schema_migration"));
    assert!(!ielts_domain::is_forbidden_action_kind("bulk_archive"));
}

#[test]
fn cancel_writes_final_checkpoint_via_service() {
    let store = open_store();
    let thread_id = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let svc = service(&store);
    svc.save_checkpoint(&SaveCheckpointCommand {
        thread_id: thread_id.clone(),
        run_id: Some("run-1".into()),
        stage: CheckpointStage::ToolBefore,
        payload: None,
    })
    .unwrap();
    let outcome = svc
        .request_cancel(&RequestCancelCommand {
            thread_id: thread_id.clone(),
        })
        .unwrap();
    assert!(outcome.cancelled);
    let latest = svc.load_latest_checkpoint(&thread_id).unwrap().unwrap();
    assert_eq!(latest.stage, CheckpointStage::Final);
}

#[test]
fn restart_recovery_marks_interrupted_via_service() {
    let store = open_store();
    let t1 = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let t2 = seed_thread(&store, "local", ThreadKind::Workspace, "t2");
    let svc = service(&store);
    svc.save_checkpoint(&SaveCheckpointCommand {
        thread_id: t1.clone(),
        run_id: Some("run-1".into()),
        stage: CheckpointStage::ModelResponse,
        payload: None,
    })
    .unwrap();
    svc.save_checkpoint(&SaveCheckpointCommand {
        thread_id: t2.clone(),
        run_id: Some("run-2".into()),
        stage: CheckpointStage::Final,
        payload: None,
    })
    .unwrap();
    let report = svc.restart_recovery().unwrap();
    assert_eq!(report.interrupted_threads, 1);
    let latest_t1 = svc.load_latest_checkpoint(&t1).unwrap().unwrap();
    assert_eq!(latest_t1.stage, CheckpointStage::Final);
}

#[test]
fn thread_privacy_scoped_by_user() {
    let store = open_store();
    let _alice = seed_thread(&store, "alice", ThreadKind::Workspace, "a1");
    let bob = seed_thread(&store, "bob", ThreadKind::Workspace, "b1");
    let svc = service(&store);
    let alice_threads = svc.list_threads("alice", 10).unwrap();
    assert_eq!(alice_threads.len(), 1);
    let bob_threads = svc.list_threads("bob", 10).unwrap();
    assert_eq!(bob_threads.len(), 1);
    assert_eq!(bob_threads[0].id, bob);
}

#[test]
fn study_plan_crud_via_service() {
    let store = open_store();
    let svc = service(&store);
    let plan = svc
        .create_study_plan(&CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "reading speed".into(),
            available_minutes: 30,
            target_date: None,
            items: vec![CreateStudyPlanItemCommand {
                skill_probe: "reading.skimming".into(),
                why_text: "slow on long passages".into(),
                estimated_minutes: 15,
            }],
        })
        .unwrap();
    let items = svc.list_study_plan_items(&plan.id).unwrap();
    assert_eq!(items.len(), 1);
    svc.mark_plan_item_done(&MarkPlanItemDoneCommand {
        item_id: items[0].id.clone(),
        done: true,
    })
    .unwrap();
    let items_after = svc.list_study_plan_items(&plan.id).unwrap();
    assert!(items_after[0].done);
}

#[test]
fn study_plan_validates_goal_and_items() {
    let store = open_store();
    let svc = service(&store);
    let err = svc
        .create_study_plan(&CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "  ".into(),
            available_minutes: 30,
            target_date: None,
            items: vec![],
        })
        .unwrap_err();
    assert_eq!(err.code, "agent_thread.invalid_request");
    let err2 = svc
        .create_study_plan(&CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "g".into(),
            available_minutes: 30,
            target_date: None,
            items: vec![CreateStudyPlanItemCommand {
                skill_probe: "".into(),
                why_text: "w".into(),
                estimated_minutes: 10,
            }],
        })
        .unwrap_err();
    assert_eq!(err2.code, "agent_thread.invalid_request");
}

#[test]
fn retry_lineage_via_service() {
    let store = open_store();
    let thread_id = seed_thread(&store, "local", ThreadKind::Workspace, "t1");
    let svc = service(&store);
    svc.save_checkpoint(&SaveCheckpointCommand {
        thread_id: thread_id.clone(),
        run_id: Some("run-parent".into()),
        stage: CheckpointStage::ModelResponse,
        payload: None,
    })
    .unwrap();
    svc.save_checkpoint(&SaveCheckpointCommand {
        thread_id: thread_id.clone(),
        run_id: Some("run-child".into()),
        stage: CheckpointStage::ContextBuilt,
        payload: Some(json!({"retryOf": "run-parent"})),
    })
    .unwrap();
    let latest = svc.load_latest_checkpoint(&thread_id).unwrap().unwrap();
    assert_eq!(latest.run_id.as_deref(), Some("run-child"));
}
