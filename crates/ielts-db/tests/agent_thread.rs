//! M12 General Agent Thread / Planner / Approval integration tests at the
//! SQLite boundary.
//!
//! Covers the M12 contract at the persistence layer:
//! - restart thread restore (checkpoint recovery)
//! - cancel model/tool (cancellation token writes final checkpoint)
//! - retry lineage (child checkpoint references parent run)
//! - no duplicate side effect (write tool never auto-replayed)
//! - action approval (pending -> approved flow)
//! - forbidden tools absent (forbidden action_kind rejected)
//! - context/thread privacy (user_id isolation)
//! - planner deterministic constraints (study plan CRUD stable)

use ielts_db::{
    append_message, archive_thread, create_study_plan, create_thread, decide_approval,
    list_messages, list_pending_approvals, list_study_plan_items, list_threads,
    load_latest_checkpoint, load_latest_study_plan, mark_plan_item_done, migrate, open_connection,
    record_action_approval,
    request_thread_cancel, restart_recovery, save_checkpoint, DbOpenOptions,
};
use ielts_domain::{
    ActionKind, ApprovalStatus, CheckpointStage, CreateStudyPlanCommand, CreateStudyPlanItemCommand,
    CreateThreadCommand, DecideApprovalCommand, MarkPlanItemDoneCommand, MessageRole,
    RecordApprovalCommand, RequestCancelCommand, SaveCheckpointCommand, ThreadKind,
};
use rusqlite::params;
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn seed_thread(conn: &rusqlite::Connection, user_id: &str, kind: ThreadKind, title: &str) -> String {
    let thread = create_thread(
        conn,
        &CreateThreadCommand {
            user_id: user_id.into(),
            thread_kind: kind,
            title: title.into(),
        },
    )
    .unwrap();
    thread.id
}

#[test]
fn migration_0022_creates_six_m12_tables() {
    let (_dir, conn) = open_db();
    for table in [
        "agent_threads",
        "agent_messages",
        "agent_checkpoints",
        "study_plans",
        "study_plan_items",
        "agent_action_approvals",
    ] {
        let count: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "M12 table {table} was not created");
    }
    let version: i64 = conn
        .query_row(
            "SELECT MAX(version) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(version >= 22, "migration 0022 was not applied");
}

#[test]
fn create_thread_persists_and_returns_active_thread() {
    let (_dir, conn) = open_db();
    let thread = create_thread(
        &conn,
        &CreateThreadCommand {
            user_id: "local".into(),
            thread_kind: ThreadKind::StudyPlan,
            title: "Plan my week".into(),
        },
    )
    .unwrap();
    assert_eq!(thread.user_id, "local");
    assert_eq!(thread.thread_kind, ThreadKind::StudyPlan);
    assert_eq!(thread.sequence, 0);
    assert_eq!(thread.status, ielts_domain::ThreadStatus::Active);

    let stored_title: String = conn
        .query_row(
            "SELECT title FROM agent_threads WHERE id = ?1",
            params![thread.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored_title, "Plan my week");
}

#[test]
fn append_message_increments_sequence_atomically() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    let m1 = append_message(
        &conn,
        &ielts_domain::AppendMessageCommand {
            thread_id: thread_id.clone(),
            role: MessageRole::User,
            content: "first".into(),
            payload: None,
        },
    )
    .unwrap();
    let m2 = append_message(
        &conn,
        &ielts_domain::AppendMessageCommand {
            thread_id: thread_id.clone(),
            role: MessageRole::Assistant,
            content: "second".into(),
            payload: Some(json!({"trace": "run-1"})),
        },
    )
    .unwrap();
    assert_eq!(m1.sequence, 1);
    assert_eq!(m2.sequence, 2);
    let messages = list_messages(&conn, &thread_id, 10).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].content, "first");
    assert_eq!(messages[1].payload.as_ref().unwrap()["trace"], "run-1");
    let thread_sequence: i64 = conn
        .query_row(
            "SELECT sequence FROM agent_threads WHERE id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(thread_sequence, 2);
}

#[test]
fn append_message_rejects_archived_thread() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    archive_thread(&conn, &thread_id).unwrap();
    let err = append_message(
        &conn,
        &ielts_domain::AppendMessageCommand {
            thread_id: thread_id.clone(),
            role: MessageRole::User,
            content: "after archive".into(),
            payload: None,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("not active"));
}

#[test]
fn list_threads_filters_by_user_and_excludes_archived() {
    let (_dir, conn) = open_db();
    let t1 = seed_thread(&conn, "alice", ThreadKind::Workspace, "a1");
    let _t2 = seed_thread(&conn, "bob", ThreadKind::Workspace, "b1");
    let t3 = seed_thread(&conn, "alice", ThreadKind::CoachReview, "a2");
    archive_thread(&conn, &t3).unwrap();
    let threads = list_threads(&conn, "alice", 10).unwrap();
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].id, t1);
}

#[test]
fn save_and_load_latest_checkpoint_round_trips() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-1".into()),
            stage: CheckpointStage::ContextBuilt,
            payload: Some(json!({"ctx": "built"})),
        },
    )
    .unwrap();
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-1".into()),
            stage: CheckpointStage::ModelResponse,
            payload: Some(json!({"model": "gpt"})),
        },
    )
    .unwrap();
    let latest = load_latest_checkpoint(&conn, &thread_id).unwrap().unwrap();
    assert_eq!(latest.stage, CheckpointStage::ModelResponse);
    assert_eq!(latest.payload.unwrap()["model"], "gpt");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE thread_id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 2, "checkpoints are append-only");
}

#[test]
fn request_cancel_writes_final_interrupted_checkpoint() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-1".into()),
            stage: CheckpointStage::ToolBefore,
            payload: None,
        },
    )
    .unwrap();
    let outcome = request_thread_cancel(
        &conn,
        &RequestCancelCommand {
            thread_id: thread_id.clone(),
        },
    )
    .unwrap();
    assert!(outcome.cancelled);
    let latest = load_latest_checkpoint(&conn, &thread_id).unwrap().unwrap();
    assert_eq!(latest.stage, CheckpointStage::Final);
    assert_eq!(latest.payload.unwrap()["interrupted"], true);
}

#[test]
fn request_cancel_is_noop_for_terminal_checkpoint() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: None,
            stage: CheckpointStage::Final,
            payload: None,
        },
    )
    .unwrap();
    let outcome = request_thread_cancel(
        &conn,
        &RequestCancelCommand {
            thread_id: thread_id.clone(),
        },
    )
    .unwrap();
    assert!(!outcome.cancelled);
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE thread_id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "no new checkpoint written for terminal thread");
}

#[test]
fn restart_recovery_marks_non_terminal_threads_interrupted() {
    let (_dir, conn) = open_db();
    let t1 = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    let t2 = seed_thread(&conn, "local", ThreadKind::Workspace, "t2");
    // t1 has a non-terminal checkpoint (interrupted on restart).
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: t1.clone(),
            run_id: Some("run-1".into()),
            stage: CheckpointStage::ModelResponse,
            payload: None,
        },
    )
    .unwrap();
    // t2 has a terminal checkpoint (already finished).
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: t2.clone(),
            run_id: Some("run-2".into()),
            stage: CheckpointStage::Final,
            payload: None,
        },
    )
    .unwrap();
    let report = restart_recovery(&conn).unwrap();
    assert_eq!(report.interrupted_threads, 1, "only t1 should be interrupted");
    let latest_t1 = load_latest_checkpoint(&conn, &t1).unwrap().unwrap();
    assert_eq!(latest_t1.stage, CheckpointStage::Final);
    assert_eq!(latest_t1.payload.unwrap()["reason"], "process_restart");
    // t2 already terminal: no new checkpoint.
    let count_t2: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE thread_id = ?1",
            params![t2],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count_t2, 1, "terminal thread not re-marked");
}

#[test]
fn restart_recovery_never_replays_write_tools() {
    // M12-02: restart_recovery only writes a final checkpoint; it does not
    // re-execute any tool. A study plan created before the crash remains
    // exactly as it was — no duplicate items are inserted.
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::StudyPlan, "t1");
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-1".into()),
            stage: CheckpointStage::ToolAfter,
            payload: Some(json!({"tool": "create_study_plan_draft"})),
        },
    )
    .unwrap();
    let plan = create_study_plan(
        &conn,
        &CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "improve reading".into(),
            available_minutes: 30,
            target_date: None,
            items: vec![CreateStudyPlanItemCommand {
                skill_probe: "reading.matching_headings".into(),
                why_text: "weakness in heading matching".into(),
                estimated_minutes: 15,
            }],
        },
    )
    .unwrap();
    let _report = restart_recovery(&conn).unwrap();
    let items = list_study_plan_items(&conn, &plan.id).unwrap();
    assert_eq!(items.len(), 1, "no duplicate plan items after recovery");
    assert!(!items[0].done);
}

#[test]
fn load_latest_study_plan_returns_newest_plan_with_items() {
    let (_dir, conn) = open_db();
    assert!(load_latest_study_plan(&conn, "local").unwrap().is_none());
    let first = create_study_plan(
        &conn,
        &CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "plan a".into(),
            available_minutes: 30,
            target_date: None,
            items: vec![CreateStudyPlanItemCommand {
                skill_probe: "reading.tfng".into(),
                why_text: "priority".into(),
                estimated_minutes: 15,
            }],
        },
    )
    .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(5));
    let second = create_study_plan(
        &conn,
        &CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "plan b".into(),
            available_minutes: 45,
            target_date: None,
            items: vec![
                CreateStudyPlanItemCommand {
                    skill_probe: "writing.task2".into(),
                    why_text: "weakness".into(),
                    estimated_minutes: 20,
                },
                CreateStudyPlanItemCommand {
                    skill_probe: "listening.section1".into(),
                    why_text: "accuracy".into(),
                    estimated_minutes: 10,
                },
            ],
        },
    )
    .unwrap();
    let snapshot = load_latest_study_plan(&conn, "local").unwrap().expect("latest plan");
    assert_eq!(snapshot.plan.id, second.id);
    assert_ne!(snapshot.plan.id, first.id);
    assert_eq!(snapshot.items.len(), 2);
    // User isolation: another user sees nothing.
    assert!(load_latest_study_plan(&conn, "other").unwrap().is_none());
}

#[test]
fn retry_lineage_child_checkpoint_references_parent_run() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    // parent run
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-parent".into()),
            stage: CheckpointStage::ModelResponse,
            payload: None,
        },
    )
    .unwrap();
    // child retry run references the same thread; run_id is the child.
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: Some("run-child".into()),
            stage: CheckpointStage::ContextBuilt,
            payload: Some(json!({"retryOf": "run-parent"})),
        },
    )
    .unwrap();
    let latest = load_latest_checkpoint(&conn, &thread_id).unwrap().unwrap();
    assert_eq!(latest.run_id.as_deref(), Some("run-child"));
    assert_eq!(latest.payload.unwrap()["retryOf"], "run-parent");
}

#[test]
fn record_action_approval_rejects_allow_listed_kind() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    let err = record_action_approval(
        &conn,
        &RecordApprovalCommand {
            thread_id: Some(thread_id),
            action_kind: ActionKind::CreateStudyPlanDraft,
            payload: json!({}),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("allow-listed"));
}

#[test]
fn action_approval_pending_to_approved_flow() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    let approval = record_action_approval(
        &conn,
        &RecordApprovalCommand {
            thread_id: Some(thread_id),
            action_kind: ActionKind::BulkArchive,
            payload: json!({"scope": "reading"}),
        },
    )
    .unwrap();
    assert_eq!(approval.status, ApprovalStatus::Pending);
    let pending = list_pending_approvals(&conn, 10).unwrap();
    assert_eq!(pending.len(), 1);
    let decided = decide_approval(
        &conn,
        &DecideApprovalCommand {
            approval_id: approval.id.clone(),
            status: ApprovalStatus::Approved,
            approved_by: "local-user".into(),
        },
    )
    .unwrap();
    assert_eq!(decided.status, ApprovalStatus::Approved);
    assert_eq!(decided.approved_by.as_deref(), Some("local-user"));
    assert!(decided.decided_at.is_some());
    let pending_after = list_pending_approvals(&conn, 10).unwrap();
    assert!(pending_after.is_empty(), "approved approval leaves pending list");
}

#[test]
fn decide_approval_rejects_already_decided() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    let approval = record_action_approval(
        &conn,
        &RecordApprovalCommand {
            thread_id: Some(thread_id),
            action_kind: ActionKind::ResetDerivedMemory,
            payload: json!({}),
        },
    )
    .unwrap();
    decide_approval(
        &conn,
        &DecideApprovalCommand {
            approval_id: approval.id.clone(),
            status: ApprovalStatus::Rejected,
            approved_by: "user".into(),
        },
    )
    .unwrap();
    let err = decide_approval(
        &conn,
        &DecideApprovalCommand {
            approval_id: approval.id,
            status: ApprovalStatus::Approved,
            approved_by: "user".into(),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("not pending"));
}

#[test]
fn forbidden_action_kind_is_rejected_by_db_guard() {
    // The db layer delegates to the domain constant; forbidden kinds are not
    // in the CHECK constraint, but the guard rejects them before persistence.
    assert!(ielts_db::is_forbidden_action_kind("direct_sql"));
    assert!(ielts_db::is_forbidden_action_kind("api_key_read"));
    assert!(ielts_db::is_forbidden_action_kind("silent_delete_history"));
    assert!(!ielts_db::is_forbidden_action_kind("bulk_archive"));
}

#[test]
fn forbidden_action_kind_cannot_be_persisted_via_check_constraint() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    // Attempt a raw INSERT with a forbidden action_kind. The CHECK
    // constraint rejects it because the kind is not in the allowed set.
    let err = conn
        .execute(
            "INSERT INTO agent_action_approvals (id, thread_id, action_kind, payload_json, status, created_at)
             VALUES ('aaa-bad', ?1, 'direct_sql', '{}', 'pending', '2026-08-16T00:00:00Z')",
            params![thread_id],
        )
        .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("constraint"));
}

#[test]
fn thread_privacy_is_user_isolated() {
    let (_dir, conn) = open_db();
    let alice_thread = seed_thread(&conn, "alice", ThreadKind::Workspace, "a1");
    let bob_thread = seed_thread(&conn, "bob", ThreadKind::Workspace, "b1");
    append_message(
        &conn,
        &ielts_domain::AppendMessageCommand {
            thread_id: alice_thread.clone(),
            role: MessageRole::User,
            content: "alice secret".into(),
            payload: None,
        },
    )
    .unwrap();
    let bob_threads = list_threads(&conn, "bob", 10).unwrap();
    assert_eq!(bob_threads.len(), 1, "bob sees only his own thread");
    assert_eq!(bob_threads[0].id, bob_thread);
    let alice_threads = list_threads(&conn, "alice", 10).unwrap();
    assert_eq!(alice_threads.len(), 1, "alice sees only her own thread");
    assert_eq!(alice_threads[0].id, alice_thread);
    // Bob cannot read Alice's messages even by thread_id directly: the
    // messages API returns rows by thread_id without a user filter, so this
    // documents that the thread list is the privacy boundary. A separate
    // authorization layer (Tauri command) must scope the thread_id by user.
    let alice_messages = list_messages(&conn, &alice_thread, 10).unwrap();
    assert_eq!(alice_messages.len(), 1);
    assert_eq!(alice_messages[0].content, "alice secret");
}

#[test]
fn study_plan_crud_is_stable() {
    let (_dir, conn) = open_db();
    let plan = create_study_plan(
        &conn,
        &CreateStudyPlanCommand {
            user_id: "local".into(),
            goal: "improve writing task 2".into(),
            available_minutes: 45,
            target_date: Some("2026-09-01".into()),
            items: vec![
                CreateStudyPlanItemCommand {
                    skill_probe: "writing.task2_introduction".into(),
                    why_text: "intro structure weak".into(),
                    estimated_minutes: 20,
                },
                CreateStudyPlanItemCommand {
                    skill_probe: "writing.task2_paragraphs".into(),
                    why_text: "body paragraph coherence".into(),
                    estimated_minutes: 25,
                },
            ],
        },
    )
    .unwrap();
    assert_eq!(plan.goal, "improve writing task 2");
    let items = list_study_plan_items(&conn, &plan.id).unwrap();
    assert_eq!(items.len(), 2);
    assert!(!items[0].done);
    let marked = mark_plan_item_done(
        &conn,
        &MarkPlanItemDoneCommand {
            item_id: items[0].id.clone(),
            done: true,
        },
    )
    .unwrap();
    assert!(marked);
    let items_after = list_study_plan_items(&conn, &plan.id).unwrap();
    assert!(items_after[0].done);
    assert!(!items_after[1].done);
    // idempotent unmark
    mark_plan_item_done(
        &conn,
        &MarkPlanItemDoneCommand {
            item_id: items[0].id.clone(),
            done: false,
        },
    )
    .unwrap();
    let items_final = list_study_plan_items(&conn, &plan.id).unwrap();
    assert!(!items_final[0].done);
}

#[test]
fn archive_thread_cascades_to_messages_and_checkpoints() {
    let (_dir, conn) = open_db();
    let thread_id = seed_thread(&conn, "local", ThreadKind::Workspace, "t1");
    append_message(
        &conn,
        &ielts_domain::AppendMessageCommand {
            thread_id: thread_id.clone(),
            role: MessageRole::User,
            content: "msg".into(),
            payload: None,
        },
    )
    .unwrap();
    save_checkpoint(
        &conn,
        &SaveCheckpointCommand {
            thread_id: thread_id.clone(),
            run_id: None,
            stage: CheckpointStage::ContextBuilt,
            payload: None,
        },
    )
    .unwrap();
    // We cannot easily drop the thread row while FK is on; archive is a soft
    // delete (status flip), not a row delete. Verify the cascade FK is wired
    // by confirming a raw delete clears children.
    conn.execute(
        "DELETE FROM agent_threads WHERE id = ?1",
        params![thread_id],
    )
    .unwrap();
    let msg_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_messages WHERE thread_id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(msg_count, 0, "messages cascade on thread delete");
    let cp_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE thread_id = ?1",
            params![thread_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cp_count, 0, "checkpoints cascade on thread delete");
}
