//! Durable, content-minimized audit trail for Agent runs and tool calls.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use ielts_domain::AgentRunKind;

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredAgentRunStatus {
    Running,
    Completed,
    Failed,
    LimitExceeded,
    Interrupted,
}

impl StoredAgentRunStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::LimitExceeded => "limit_exceeded",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> DbResult<Self> {
        match value {
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "limit_exceeded" => Ok(Self::LimitExceeded),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(DbError::Message(format!(
                "invalid stored agent run status: {other}"
            ))),
        }
    }

    fn is_terminal(self) -> bool {
        self != Self::Running
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredAgentToolStatus {
    Running,
    Succeeded,
    Rejected,
    Failed,
    Interrupted,
}

impl StoredAgentToolStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Rejected => "rejected",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> DbResult<Self> {
        match value {
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "rejected" => Ok(Self::Rejected),
            "failed" => Ok(Self::Failed),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(DbError::Message(format!(
                "invalid stored agent tool status: {other}"
            ))),
        }
    }

    fn is_terminal(self) -> bool {
        self != Self::Running
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub id: String,
    pub provider_id: String,
    pub model: String,
    pub run_kind: AgentRunKind,
    pub status: StoredAgentRunStatus,
    pub rounds: u32,
    pub tool_call_count: u32,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub tool_calls: Vec<AgentToolCallRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCallRecord {
    pub run_id: String,
    pub call_id: String,
    pub sequence: u32,
    pub round: u32,
    pub tool_name: String,
    pub status: StoredAgentToolStatus,
    pub arguments: Value,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginAgentRunCommand {
    pub id: String,
    pub provider_id: String,
    pub model: String,
    #[serde(default)]
    pub run_kind: AgentRunKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginAgentToolCallCommand {
    pub run_id: String,
    pub call_id: String,
    pub sequence: u32,
    pub round: u32,
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishAgentToolCallCommand {
    pub run_id: String,
    pub call_id: String,
    pub sequence: u32,
    pub status: StoredAgentToolStatus,
    pub result: Value,
    pub error: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishAgentRunCommand {
    pub id: String,
    pub status: StoredAgentRunStatus,
    pub rounds: u32,
    pub tool_call_count: u32,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecoveryReport {
    pub runs: u32,
    pub tool_calls: u32,
}

pub fn begin_agent_run(conn: &Connection, command: &BeginAgentRunCommand) -> DbResult<()> {
    require_text(&command.id, "agent run id")?;
    require_text(&command.provider_id, "agent provider id")?;
    require_text(&command.model, "agent model")?;
    let now = chrono::Utc::now().to_rfc3339();
    let result_json = serde_json::to_string(&json!({"runKind": command.run_kind}))
        .map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO agent_runs (
            id, provider_id, model, status, rounds, tool_call_count,
            result_json, error_json, created_at, updated_at, completed_at
         ) VALUES (?1, ?2, ?3, 'running', 0, 0, ?4, NULL, ?5, ?5, NULL)",
        params![
            command.id,
            command.provider_id,
            command.model,
            result_json,
            now
        ],
    )?;
    Ok(())
}

pub fn begin_agent_tool_call(
    conn: &Connection,
    command: &BeginAgentToolCallCommand,
) -> DbResult<()> {
    require_text(&command.run_id, "agent run id")?;
    require_text(&command.call_id, "agent tool call id")?;
    require_text(&command.tool_name, "agent tool name")?;
    if command.sequence == 0 || command.round == 0 {
        return Err(DbError::Validation(
            "agent tool sequence and round must be greater than zero".into(),
        ));
    }
    let arguments = serialize_audit_json(&command.arguments)?;
    let now = chrono::Utc::now().to_rfc3339();
    let inserted = conn.execute(
        "INSERT INTO agent_tool_calls (
            run_id, call_id, sequence, round_index, tool_name, status,
            arguments_json, result_json, error_json, started_at, completed_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, 'running', ?6, NULL, NULL, ?7, NULL
         WHERE EXISTS (
            SELECT 1 FROM agent_runs WHERE id = ?1 AND status = 'running'
         )",
        params![
            command.run_id,
            command.call_id,
            command.sequence as i64,
            command.round as i64,
            command.tool_name,
            arguments,
            now,
        ],
    )?;
    if inserted != 1 {
        return Err(DbError::Validation(format!(
            "agent run is not active: {}",
            command.run_id
        )));
    }
    Ok(())
}

pub fn finish_agent_tool_call(
    conn: &Connection,
    command: &FinishAgentToolCallCommand,
) -> DbResult<()> {
    if !command.status.is_terminal() {
        return Err(DbError::Validation(
            "agent tool call requires a terminal status".into(),
        ));
    }
    if command.sequence == 0 {
        return Err(DbError::Validation(
            "agent tool sequence must be greater than zero".into(),
        ));
    }
    let result = serialize_audit_json(&command.result)?;
    let error = serialize_optional_audit_json(command.error.as_ref())?;
    let now = chrono::Utc::now().to_rfc3339();
    let updated = conn.execute(
        "UPDATE agent_tool_calls
         SET status = ?1, result_json = ?2, error_json = ?3, completed_at = ?4
         WHERE run_id = ?5 AND sequence = ?6 AND call_id = ?7 AND status = 'running'",
        params![
            command.status.as_str(),
            result,
            error,
            now,
            command.run_id,
            command.sequence as i64,
            command.call_id,
        ],
    )?;
    if updated != 1 {
        return Err(DbError::Validation(format!(
            "agent tool call is not active: {}/{}",
            command.run_id, command.sequence
        )));
    }
    Ok(())
}

pub fn finish_agent_run(conn: &Connection, command: &FinishAgentRunCommand) -> DbResult<()> {
    if !command.status.is_terminal() {
        return Err(DbError::Validation(
            "agent run requires a terminal status".into(),
        ));
    }
    let result = serialize_optional_audit_json(command.result.as_ref())?;
    let error = serialize_optional_audit_json(command.error.as_ref())?;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let active_calls: i64 = tx.query_row(
        "SELECT COUNT(*) FROM agent_tool_calls WHERE run_id = ?1 AND status = 'running'",
        params![command.id],
        |row| row.get(0),
    )?;
    if active_calls != 0 {
        return Err(DbError::Validation(format!(
            "agent run has {active_calls} active tool call(s): {}",
            command.id
        )));
    }
    let updated = tx.execute(
        "UPDATE agent_runs
         SET status = ?1, rounds = ?2, tool_call_count = ?3, result_json = ?4,
             error_json = ?5, updated_at = ?6, completed_at = ?6
         WHERE id = ?7 AND status = 'running'",
        params![
            command.status.as_str(),
            command.rounds as i64,
            command.tool_call_count as i64,
            result,
            error,
            now,
            command.id,
        ],
    )?;
    if updated != 1 {
        return Err(DbError::Validation(format!(
            "agent run is not active: {}",
            command.id
        )));
    }
    tx.commit()?;
    Ok(())
}

pub fn load_agent_run(conn: &Connection, run_id: &str) -> DbResult<Option<AgentRunRecord>> {
    let mut run = match conn.query_row(
        "SELECT id, provider_id, model, status, rounds, tool_call_count,
                result_json, error_json, created_at, updated_at, completed_at
         FROM agent_runs WHERE id = ?1",
        params![run_id],
        map_run,
    ) {
        Ok(run) => run,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    run.tool_calls = list_agent_tool_calls(conn, run_id)?;
    Ok(Some(run))
}

pub fn recover_interrupted_agent_runs(conn: &Connection) -> DbResult<AgentRecoveryReport> {
    let now = chrono::Utc::now().to_rfc3339();
    let error = json!({
        "code": "agent.interrupted",
        "message": "agent run interrupted by process restart",
        "retryable": true,
    });
    let error_json = serde_json::to_string(&error)
        .map_err(|serialization| DbError::Message(serialization.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    let tool_calls = tx.execute(
        "UPDATE agent_tool_calls
         SET status = 'interrupted', error_json = ?1, completed_at = ?2
         WHERE status = 'running'",
        params![error_json, now],
    )?;
    let runs = tx.execute(
        "UPDATE agent_runs
         SET status = 'interrupted', error_json = ?1, updated_at = ?2, completed_at = ?2
         WHERE status = 'running'",
        params![error_json, now],
    )?;
    tx.commit()?;
    Ok(AgentRecoveryReport {
        runs: runs as u32,
        tool_calls: tool_calls as u32,
    })
}

fn list_agent_tool_calls(conn: &Connection, run_id: &str) -> DbResult<Vec<AgentToolCallRecord>> {
    let mut statement = conn.prepare(
        "SELECT run_id, call_id, sequence, round_index, tool_name, status,
                arguments_json, result_json, error_json, started_at, completed_at
         FROM agent_tool_calls WHERE run_id = ?1 ORDER BY sequence ASC",
    )?;
    let rows = statement.query_map(params![run_id], |row| {
        let status: String = row.get(5)?;
        let arguments: String = row.get(6)?;
        let result: Option<String> = row.get(7)?;
        let error: Option<String> = row.get(8)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            status,
            arguments,
            result,
            error,
            row.get::<_, String>(9)?,
            row.get::<_, Option<String>>(10)?,
        ))
    })?;
    let mut calls = Vec::new();
    for row in rows {
        let (
            run_id,
            call_id,
            sequence,
            round,
            tool_name,
            status,
            arguments,
            result,
            error,
            started_at,
            completed_at,
        ) = row?;
        calls.push(AgentToolCallRecord {
            run_id,
            call_id,
            sequence: sequence as u32,
            round: round as u32,
            tool_name,
            status: StoredAgentToolStatus::parse(&status)?,
            arguments: parse_json(&arguments, "agent tool arguments")?,
            result: parse_optional_json(result.as_deref(), "agent tool result")?,
            error: parse_optional_json(error.as_deref(), "agent tool error")?,
            started_at,
            completed_at,
        });
    }
    Ok(calls)
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRunRecord> {
    let status: String = row.get(3)?;
    let result: Option<String> = row.get(6)?;
    let error: Option<String> = row.get(7)?;
    let status = StoredAgentRunStatus::parse(&status).map_err(to_sql_error)?;
    let result =
        parse_optional_json(result.as_deref(), "agent run result").map_err(to_sql_error)?;
    let error = parse_optional_json(error.as_deref(), "agent run error").map_err(to_sql_error)?;
    let run_kind = result
        .as_ref()
        .and_then(|value| value.get("runKind"))
        .and_then(Value::as_str)
        .map(parse_run_kind)
        .transpose()
        .map_err(to_sql_error)?
        .unwrap_or_default();
    Ok(AgentRunRecord {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        model: row.get(2)?,
        run_kind,
        status,
        rounds: row.get::<_, i64>(4)? as u32,
        tool_call_count: row.get::<_, i64>(5)? as u32,
        result,
        error,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        completed_at: row.get(10)?,
        tool_calls: Vec::new(),
    })
}

fn parse_run_kind(value: &str) -> DbResult<AgentRunKind> {
    match value {
        "workspace" => Ok(AgentRunKind::Workspace),
        "attempt_review" => Ok(AgentRunKind::AttemptReview),
        "memory_manager" => Ok(AgentRunKind::MemoryManager),
        "dream" => Ok(AgentRunKind::Dream),
        "study_plan" => Ok(AgentRunKind::StudyPlan),
        other => Err(DbError::Message(format!(
            "invalid stored agent run kind: {other}"
        ))),
    }
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

fn serialize_audit_json(value: &Value) -> DbResult<String> {
    serde_json::to_string(value).map_err(|error| DbError::Message(error.to_string()))
}

fn serialize_optional_audit_json(value: Option<&Value>) -> DbResult<Option<String>> {
    value.map(serialize_audit_json).transpose()
}

fn parse_json(raw: &str, field: &str) -> DbResult<Value> {
    serde_json::from_str(raw).map_err(|error| DbError::Message(format!("{field}: {error}")))
}

fn parse_optional_json(raw: Option<&str>, field: &str) -> DbResult<Option<Value>> {
    raw.map(|raw| parse_json(raw, field)).transpose()
}

fn to_sql_error(error: DbError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
