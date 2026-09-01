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
