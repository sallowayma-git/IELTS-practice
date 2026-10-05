use ielts_db::{
    begin_agent_run, begin_agent_tool_call, finish_agent_run, finish_agent_tool_call,
    load_agent_run, migrate, open_connection, recover_interrupted_agent_runs, BeginAgentRunCommand,
    BeginAgentToolCallCommand, DbOpenOptions, FinishAgentRunCommand, FinishAgentToolCallCommand,
    StoredAgentRunStatus, StoredAgentToolStatus,
};
use serde_json::json;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let directory = tempfile::tempdir().unwrap();
    let mut connection =
        open_connection(&DbOpenOptions::create(directory.path().join("agent.db"))).unwrap();
    migrate(&mut connection).unwrap();
    (directory, connection)
}

#[test]
fn persists_run_and_ordered_tool_audit() {
    let (_directory, connection) = open_db();
    begin_agent_run(&connection, &begin_run("run-1")).unwrap();
    begin_agent_tool_call(&connection, &begin_call("run-1", "call-1", 1)).unwrap();
    finish_agent_tool_call(
        &connection,
        &FinishAgentToolCallCommand {
            run_id: "run-1".into(),
            call_id: "call-1".into(),
            sequence: 1,
            status: StoredAgentToolStatus::Succeeded,
            result: json!({"path":"note.txt","bytes":5,"sha256":"abc"}),
            error: None,
        },
    )
    .unwrap();
    finish_agent_run(
        &connection,
        &FinishAgentRunCommand {
            id: "run-1".into(),
            status: StoredAgentRunStatus::Completed,
            rounds: 2,
            tool_call_count: 1,
            result: Some(json!({"model":"fake-model","hasContent":true})),
            error: None,
        },
    )
    .unwrap();

    let run = load_agent_run(&connection, "run-1").unwrap().unwrap();
    assert_eq!(run.status, StoredAgentRunStatus::Completed);
    assert_eq!(run.rounds, 2);
    assert_eq!(run.tool_calls.len(), 1);
    assert_eq!(run.tool_calls[0].sequence, 1);
    assert_eq!(run.tool_calls[0].arguments["path"], "note.txt");
    assert_eq!(run.tool_calls[0].result.as_ref().unwrap()["bytes"], 5);
}

#[test]
fn dream_run_kind_survives_completion_failure_and_cancellation() {
    let (_directory, connection) = open_db();
    for (id, status, result, error) in [
        (
            "dream-completed",
            StoredAgentRunStatus::Completed,
            Some(json!({"summary": "done", "details": {"count": 2}})),
            None,
        ),
        (
            "dream-failed",
            StoredAgentRunStatus::Failed,
            None,
            Some(json!({"code": "agent.failed"})),
        ),
        (
            "dream-cancelled",
            StoredAgentRunStatus::Failed,
            None,
            Some(json!({"code": "agent.cancelled"})),
        ),
    ] {
        let mut begin = begin_run(id);
        begin.run_kind = ielts_domain::AgentRunKind::Dream;
        begin_agent_run(&connection, &begin).unwrap();
        finish_agent_run(
            &connection,
            &FinishAgentRunCommand {
                id: id.into(),
                status,
                rounds: 2,
                tool_call_count: 0,
                result: result.clone(),
                error: error.clone(),
            },
        )
        .unwrap();

        let run = load_agent_run(&connection, id).unwrap().unwrap();
        let mut expected_result = result.unwrap_or_else(|| json!({}));
        expected_result["runKind"] = json!("dream");
        assert_eq!(run.run_kind, ielts_domain::AgentRunKind::Dream);
        assert_eq!(run.status, status);
        assert_eq!(run.result, Some(expected_result));
        assert_eq!(run.error, error);
        assert!(run.completed_at.is_some());
    }
}

#[test]
fn caller_cannot_override_original_run_kind() {
    let (_directory, connection) = open_db();
    for kind in [
        ielts_domain::AgentRunKind::Dream,
        ielts_domain::AgentRunKind::Workspace,
    ] {
        let id = format!("conflict-{kind:?}");
        let mut begin = begin_run(&id);
        begin.run_kind = kind;
        begin_agent_run(&connection, &begin).unwrap();
        let mut result = json!({
            "runKind": "coach",
            "summary": "done",
            "details": {"count": 2},
            "items": [1, 2],
            "optional": null,
        });
        finish_agent_run(
            &connection,
            &FinishAgentRunCommand {
                id: id.clone(),
                status: StoredAgentRunStatus::Completed,
                rounds: 1,
                tool_call_count: 0,
                result: Some(result.clone()),
                error: None,
            },
        )
        .unwrap();

        result["runKind"] = json!(kind);
        let run = load_agent_run(&connection, &id).unwrap().unwrap();
        assert_eq!(run.run_kind, kind);
        assert_eq!(run.result, Some(result));
    }
}

#[test]
fn non_object_result_is_rejected_without_changing_running_run() {
    let (_directory, connection) = open_db();
    let mut begin = begin_run("dream-invalid");
    begin.run_kind = ielts_domain::AgentRunKind::Dream;
    begin_agent_run(&connection, &begin).unwrap();
    let original = load_agent_run(&connection, &begin.id).unwrap().unwrap();

    for result in [json!(null), json!([]), json!("done"), json!(42), json!(true)] {
        let error = finish_agent_run(
            &connection,
            &FinishAgentRunCommand {
                id: begin.id.clone(),
                status: StoredAgentRunStatus::Completed,
                rounds: 2,
                tool_call_count: 3,
                result: Some(result),
                error: Some(json!({"code": "agent.failed"})),
            },
        )
        .unwrap_err();
        assert!(matches!(error, ielts_db::sqlite::DbError::Validation(_)));
        assert!(error.to_string().contains("result must be a JSON object"));
        assert_eq!(
            load_agent_run(&connection, &begin.id).unwrap().unwrap(),
            original
        );
    }
}

#[test]
fn rejects_duplicate_sequence_and_terminal_reopen() {
    let (_directory, connection) = open_db();
    begin_agent_run(&connection, &begin_run("run-1")).unwrap();
    begin_agent_tool_call(&connection, &begin_call("run-1", "call-1", 1)).unwrap();
    assert!(begin_agent_tool_call(&connection, &begin_call("run-1", "call-2", 1)).is_err());

    finish_agent_tool_call(
        &connection,
        &FinishAgentToolCallCommand {
            run_id: "run-1".into(),
            call_id: "call-1".into(),
            sequence: 1,
            status: StoredAgentToolStatus::Rejected,
            result: json!({"known":false}),
            error: Some(json!({"code":"agent.unknown_tool"})),
        },
    )
    .unwrap();
    let finish = FinishAgentRunCommand {
        id: "run-1".into(),
        status: StoredAgentRunStatus::Failed,
        rounds: 1,
        tool_call_count: 1,
        result: None,
        error: Some(json!({"code":"agent.failed"})),
    };
    finish_agent_run(&connection, &finish).unwrap();
    assert!(finish_agent_run(&connection, &finish).is_err());
    assert!(begin_agent_tool_call(&connection, &begin_call("run-1", "call-3", 2)).is_err());
}

#[test]
fn refuses_to_finish_run_with_active_tool_call() {
    let (_directory, connection) = open_db();
    begin_agent_run(&connection, &begin_run("run-1")).unwrap();
    begin_agent_tool_call(&connection, &begin_call("run-1", "call-1", 1)).unwrap();
    let error = finish_agent_run(
        &connection,
        &FinishAgentRunCommand {
            id: "run-1".into(),
            status: StoredAgentRunStatus::Completed,
            rounds: 1,
            tool_call_count: 1,
            result: None,
            error: None,
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("active tool call"));
    assert_eq!(
        load_agent_run(&connection, "run-1")
            .unwrap()
            .unwrap()
            .status,
        StoredAgentRunStatus::Running
    );
}

#[test]
fn recovers_running_calls_and_runs_as_interrupted() {
    let (_directory, connection) = open_db();
    begin_agent_run(&connection, &begin_run("run-1")).unwrap();
    begin_agent_tool_call(&connection, &begin_call("run-1", "call-1", 1)).unwrap();

    let report = recover_interrupted_agent_runs(&connection).unwrap();
    assert_eq!(report.runs, 1);
    assert_eq!(report.tool_calls, 1);
    let run = load_agent_run(&connection, "run-1").unwrap().unwrap();
    assert_eq!(run.status, StoredAgentRunStatus::Interrupted);
    assert_eq!(run.tool_calls[0].status, StoredAgentToolStatus::Interrupted);
    assert_eq!(run.error.as_ref().unwrap()["code"], "agent.interrupted");
}

#[test]
fn deleting_run_cascades_tool_calls() {
    let (_directory, connection) = open_db();
    begin_agent_run(&connection, &begin_run("run-1")).unwrap();
    begin_agent_tool_call(&connection, &begin_call("run-1", "call-1", 1)).unwrap();
    connection
        .execute("DELETE FROM agent_runs WHERE id = 'run-1'", [])
        .unwrap();
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM agent_tool_calls", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
}

fn begin_run(id: &str) -> BeginAgentRunCommand {
    BeginAgentRunCommand {
        id: id.into(),
        provider_id: "openai-compatible".into(),
        model: "fake-model".into(),
        run_kind: ielts_domain::AgentRunKind::Workspace,
    }
}

fn begin_call(run_id: &str, call_id: &str, sequence: u32) -> BeginAgentToolCallCommand {
    BeginAgentToolCallCommand {
        run_id: run_id.into(),
        call_id: call_id.into(),
        sequence,
        round: 1,
        tool_name: "read_file".into(),
        arguments: json!({"path":"note.txt"}),
    }
}
