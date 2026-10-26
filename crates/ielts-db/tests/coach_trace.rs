//! Actual SQLite receipts and write-failure/restart boundaries; no provider I/O.
use ielts_db::*;
use rusqlite::Connection;
use serde_json::{json, Value};

fn fixture() -> (tempfile::TempDir, Connection, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("trace.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: None,
            asset_id: None,
            kind: "chat".into(),
        },
    )
    .unwrap();
    let message = append_coach_message(
        &conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "user".into(),
            content: "why".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap();
    (dir, conn, thread.id, message.id)
}
fn begin(conn: &Connection, thread: &str, user: &str) -> String {
    begin_coach_trace(
        conn,
        thread,
        user,
        &json!({"messages":[{"role":"user","content":"why"}]}),
        "fake-provider",
        "requested-model",
        30_000,
    )
    .unwrap()
}
fn response() -> Value {
    json!({"content":"{\"answer\":\"because\"}","model":"actual-model","latencyMs":42,"retryCount":2,"usage":{"inputTokens":10,"outputTokens":4},"providerRequestId":"request-42"})
}

#[test]
fn failed_attempt_thread_survives_refresh_and_returns_to_active_after_success() {
    let (_dir, conn, _, _) = fixture();
    conn.execute("INSERT INTO attempts (id,activity,mode,status,started_at,duration_ms,schema_version,created_at,updated_at)
        VALUES ('attempt-1','reading','single','in_progress','2026-01-01T00:00:00Z',0,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", []).unwrap();
    let command = EnsureCoachThreadCommand {
        thread_id: None,
        attempt_id: Some("attempt-1".into()),
        asset_id: Some("asset-1".into()),
        kind: "review".into(),
    };
    let thread = ensure_coach_thread(&conn, &command).unwrap();
    let user = append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: thread.id.clone(), role: "user".into(), content: "first question".into(),
        structured_payload: None, status: "completed".into(),
    }).unwrap();
    let failed_run = begin(&conn, &thread.id, &user.id);
    fail_coach_trace(&conn, &failed_run, &json!({"code":"provider.failed","message":"unavailable"}), None).unwrap();
    assert_eq!(get_thread(&conn, &thread.id).unwrap().status, "degraded");

    let refreshed = ensure_coach_thread(&conn, &command).unwrap();
    assert_eq!(refreshed.id, thread.id);
    let messages = list_coach_messages(&conn, &refreshed.id, None, 10).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1].status, "failed");
    assert_eq!(messages[1].structured_payload.as_ref().unwrap()["runId"], failed_run);

    let retry = append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: refreshed.id.clone(), role: "user".into(), content: "try again".into(),
        structured_payload: None, status: "completed".into(),
    }).unwrap();
    let successful_run = begin(&conn, &refreshed.id, &retry.id);
    complete_traced_coach(&conn, &successful_run, &refreshed.id, "because", json!({}), &response()).unwrap();
    assert_eq!(get_thread(&conn, &thread.id).unwrap().status, "active");
    assert_eq!(ensure_coach_thread(&conn, &command).unwrap().id, thread.id);
    let messages = list_coach_messages(&conn, &thread.id, None, 10).unwrap();
    assert_eq!(messages.len(), 4);
    assert_eq!(messages[1].status, "failed");
    assert_eq!(messages[3].status, "completed");
}

#[test]
fn ensure_attempt_thread_respects_status_attempt_and_kind() {
    let (_dir, conn, _, _) = fixture();
    let command = EnsureCoachThreadCommand {
        thread_id: None, attempt_id: Some("attempt-1".into()),
        asset_id: Some("asset-1".into()), kind: "review".into(),
    };
    let old = ensure_coach_thread(&conn, &command).unwrap();
    conn.execute("INSERT INTO coach_threads
        (id,attempt_id,asset_id,status,created_at,updated_at,kind)
        VALUES ('newer-review','attempt-1','asset-1','degraded','2099-01-01T00:00:00Z','2099-01-01T00:00:00Z','review')", []).unwrap();
    let newer = get_thread(&conn, "newer-review").unwrap();
    conn.execute("UPDATE coach_threads SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1", [&old.id]).unwrap();
    assert_eq!(ensure_coach_thread(&conn, &command).unwrap().id, newer.id);

    let other_attempt = EnsureCoachThreadCommand { attempt_id: Some("attempt-2".into()), ..command.clone() };
    let other_kind = EnsureCoachThreadCommand { kind: "chat".into(), ..command.clone() };
    assert_ne!(ensure_coach_thread(&conn, &other_attempt).unwrap().id, newer.id);
    assert_ne!(ensure_coach_thread(&conn, &other_kind).unwrap().id, newer.id);
    for scope in [other_attempt, other_kind] {
        assert!(ensure_coach_thread(&conn, &EnsureCoachThreadCommand {
            thread_id: Some(newer.id.clone()), ..scope
        }).is_err());
    }

    conn.execute("UPDATE coach_threads SET status='archived' WHERE id=?1", [&newer.id]).unwrap();
    assert!(ensure_coach_thread(&conn, &EnsureCoachThreadCommand {
        thread_id: Some(newer.id.clone()), ..command.clone()
    }).is_err());
    assert_eq!(ensure_coach_thread(&conn, &command).unwrap().id, old.id);
}

#[test]
fn exact_snapshot_invocation_message_and_terminal_run_reopen() {
    let (dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    let message = complete_traced_coach(
        &conn,
        &run,
        &thread,
        "because",
        json!({"answer":"because"}),
        &response(),
    )
    .unwrap();
    drop(conn);
    let conn = open_connection(&DbOpenOptions::create(dir.path().join("trace.db"))).unwrap();
    let record = load_agent_run(&conn, &run).unwrap().unwrap();
    assert_eq!(record.status, StoredAgentRunStatus::Completed);
    assert_eq!(record.run_kind, ielts_domain::AgentRunKind::Coach);
    let receipt = record.result.unwrap();
    assert_eq!(receipt["assistantMessageId"], message.id);
    assert_eq!(receipt["userMessageId"], user);
    assert_eq!(receipt["strategyId"], "evidence_first_v1");
    assert_eq!(receipt["actualModel"], "actual-model");
    assert_eq!(receipt["retryCount"], 2);
    let snapshot = load_context_snapshot(&conn, receipt["snapshotId"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.0.run_id.as_deref(), Some(run.as_str()));
    let (assignment_id, strategy, skills, memories, bound_snapshot): (String, String, String, String, String) = conn.query_row(
        "SELECT id,strategy_id,skills_addressed_json,memory_ids_used_json,context_snapshot_id FROM coach_strategy_assignments_v0 WHERE coach_message_id=?1",
        [&message.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).unwrap();
    assert_eq!(strategy, "evidence_first_v1");
    assert_eq!(skills, "[]");
    assert_eq!(memories, "[]");
    assert_eq!(bound_snapshot, receipt["snapshotId"]);
    let persisted = list_coach_messages(&conn, &thread, None, 10).unwrap();
    let assistant = persisted[1].structured_payload.as_ref().unwrap();
    assert_eq!(assistant["userMessageId"], user);
    assert_eq!(assistant["strategyAssignmentId"], assignment_id);
    let (request_hash,response_hash,model,usage,latency,id):(String,String,String,String,u64,String) = conn.query_row(
        "SELECT request_hash,response_hash,model,usage_json,latency_ms,provider_request_id FROM llm_invocations WHERE run_id=?1",[&run],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).unwrap();
    assert_eq!(request_hash, ielts_domain::rendered_hash(&snapshot.1));
    assert_eq!(
        response_hash,
        ielts_domain::rendered_hash(response()["content"].as_str().unwrap())
    );
    assert_eq!(
        (model, latency, id),
        ("actual-model".into(), 42, "request-42".into())
    );
    assert_eq!(
        serde_json::from_str::<Value>(&usage).unwrap()["inputTokens"],
        10
    );
    assert!(complete_traced_coach(&conn, &run, &thread, "again", json!({}), &response()).is_err());
}

#[test]
fn invocation_write_failure_rolls_back_success_message_and_can_record_failure() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    conn.execute_batch("CREATE TRIGGER reject_invocation BEFORE UPDATE ON llm_invocations BEGIN SELECT RAISE(ABORT,'receipt failed'); END;").unwrap();
    assert!(
        complete_traced_coach(&conn, &run, &thread, "because", json!({}), &response()).is_err()
    );
    assert_eq!(
        list_coach_messages(&conn, &thread, None, 10).unwrap().len(),
        1
    );
    let assignments: i64 = conn.query_row("SELECT COUNT(*) FROM coach_strategy_assignments_v0", [], |row| row.get(0)).unwrap();
    assert_eq!(assignments, 0);
    assert_eq!(
        load_agent_run(&conn, &run).unwrap().unwrap().status,
        StoredAgentRunStatus::Running
    );
    conn.execute_batch("DROP TRIGGER reject_invocation")
        .unwrap();
    fail_coach_trace(
        &conn,
        &run,
        &json!({"code":"persist_failed"}),
        Some(&response()),
    )
    .unwrap();
    assert_eq!(
        load_agent_run(&conn, &run).unwrap().unwrap().status,
        StoredAgentRunStatus::Failed
    );
}

#[test]
fn begin_receipt_failure_leaves_no_partial_run_or_snapshot() {
    let (_dir, conn, thread, user) = fixture();
    conn.execute_batch("CREATE TRIGGER reject_invocation BEFORE INSERT ON llm_invocations BEGIN SELECT RAISE(ABORT,'receipt failed'); END;").unwrap();
    assert!(begin_coach_trace(&conn, &thread, &user, &json!({}), "fake", "fake", 30_000).is_err());
    for table in [
        "agent_runs",
        "agent_context_snapshots",
        "agent_context_items",
        "llm_invocations",
    ] {
        let count: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn restart_marks_run_and_invocation_interrupted_without_response_fabrication() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    recover_interrupted_agent_runs(&conn).unwrap();
    let (hash, error): (Option<String>, String) = conn
        .query_row(
            "SELECT response_hash,error_json FROM llm_invocations WHERE run_id=?1",
            [&run],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(hash.is_none());
    assert_eq!(
        serde_json::from_str::<Value>(&error).unwrap()["code"],
        "agent.interrupted"
    );
    assert_eq!(
        load_agent_run(&conn, &run).unwrap().unwrap().status,
        StoredAgentRunStatus::Interrupted
    );
}

#[test]
fn cannot_finish_another_threads_run() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    let other = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: None,
            asset_id: None,
            kind: "chat".into(),
        },
    )
    .unwrap();
    assert!(complete_traced_coach(&conn, &run, &other.id, "bad", json!({}), &response()).is_err());
    assert!(list_coach_messages(&conn, &other.id, None, 10)
        .unwrap()
        .is_empty());
}

#[test]
fn failure_message_and_failed_receipt_are_one_transaction() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    conn.execute_batch("CREATE TRIGGER reject_failed_message BEFORE INSERT ON coach_messages WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'message failed'); END;").unwrap();
    let error = json!({"code":"provider.failed","message":"unavailable"});
    assert!(fail_coach_trace(&conn, &run, &error, None).is_err());
    assert_eq!(
        load_agent_run(&conn, &run).unwrap().unwrap().status,
        StoredAgentRunStatus::Running
    );
    conn.execute_batch("DROP TRIGGER reject_failed_message")
        .unwrap();
    fail_coach_trace(&conn, &run, &error, None).unwrap();
    let receipt = load_agent_run(&conn, &run)
        .unwrap()
        .unwrap()
        .result
        .unwrap();
    let messages = list_coach_messages(&conn, &thread, None, 10).unwrap();
    assert_eq!(receipt["failureMessageId"], messages[1].id);
    assert_eq!(messages[1].structured_payload.as_ref().unwrap()["userMessageId"], user);
    assert_eq!(
        messages[1].structured_payload.as_ref().unwrap()["runId"],
        run
    );
}

#[test]
fn assignment_failure_rolls_back_assistant_and_trace() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    conn.execute_batch("CREATE TRIGGER reject_assignment BEFORE INSERT ON coach_strategy_assignments_v0 BEGIN SELECT RAISE(ABORT,'assignment failed'); END;").unwrap();
    assert!(complete_traced_coach(&conn, &run, &thread, "because", json!({}), &response()).is_err());
    assert_eq!(list_coach_messages(&conn, &thread, None, 10).unwrap().len(), 1);
    assert_eq!(load_agent_run(&conn, &run).unwrap().unwrap().status, StoredAgentRunStatus::Running);
    conn.execute_batch("DROP TRIGGER reject_assignment").unwrap();
    fail_coach_trace(&conn, &run, &json!({"code":"persist_failed"}), None).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM coach_strategy_assignments_v0", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn provider_payload_cannot_claim_strategy_or_memory_provenance() {
    let (_dir, conn, thread, user) = fixture();
    let run = begin(&conn, &thread, &user);
    let message = complete_traced_coach(&conn, &run, &thread, "because", json!({
        "answer":"because", "strategyId":"contrastive_v1", "strategyAssignmentId":"fake",
        "userMessageId":"other", "memoryIdsUsed":["fake-memory"], "skillsAddressed":["unknown.skill"],
        "contextSnapshotId":"fake"
    }), &response()).unwrap();
    let payload = message.structured_payload.unwrap();
    assert_eq!(payload["strategyId"], "evidence_first_v1");
    assert_eq!(payload["userMessageId"], user);
    assert_ne!(payload["strategyAssignmentId"], "fake");
    for field in ["memoryIdsUsed", "skillsAddressed", "contextSnapshotId"] {
        assert!(payload.get(field).is_none());
    }
}

fn run_result(conn: &Connection, run: &str) -> Value {
    let raw: String = conn
        .query_row("SELECT result_json FROM agent_runs WHERE id=?1", [run], |row| row.get(0))
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn teaching_notes_rejected_is_on_the_run_only_when_some_notes_were_rejected() {
    let (_dir, conn, thread, user) = fixture();
    let clean = begin(&conn, &thread, &user);
    complete_traced_coach(&conn, &clean, &thread, "because", json!({"answer":"because"}), &response()).unwrap();
    assert!(run_result(&conn, &clean).get("teachingNotesRejected").is_none());

    let second_user = append_coach_message(&conn, &AppendCoachMessageCommand {
        thread_id: thread.clone(), role: "user".into(), content: "again".into(),
        structured_payload: None, status: "completed".into(),
    }).unwrap();
    let mut with_rejects = response();
    with_rejects["teachingNotesRejected"] = json!(2);
    let rejected = begin(&conn, &thread, &second_user.id);
    complete_traced_coach(&conn, &rejected, &thread, "because", json!({"answer":"because"}), &with_rejects).unwrap();
    assert_eq!(run_result(&conn, &rejected)["teachingNotesRejected"], 2);
}
