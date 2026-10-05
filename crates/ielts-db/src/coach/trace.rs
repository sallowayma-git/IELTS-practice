//! One host-owned invocation and exact request snapshot per Coach run.
//! Terminal run status disambiguates an interrupted invocation; never invent a response.
use super::{append_coach_message_in_transaction, AppendCoachMessageCommand, CoachMessage};
use crate::{begin_agent_run, BeginAgentRunCommand, DbError, DbResult};
use ielts_domain::{estimate_tokens, rendered_hash, AgentRunKind};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

const HOST_COACH_STRATEGY: &str = "evidence_first_v1";

pub fn begin_coach_trace(
    conn: &Connection,
    thread_id: &str,
    user_message_id: &str,
    request: &Value,
    provider: &str,
    model: &str,
    budget: u32,
) -> DbResult<String> {
    let tx = conn.unchecked_transaction()?;
    let known: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM coach_messages WHERE id=?1 AND thread_id=?2 AND role='user' AND status='completed')",
        params![user_message_id, thread_id], |row| row.get(0))?;
    if !known {
        return Err(DbError::Validation(
            "coach trace requires its persisted user message".into(),
        ));
    }
    let rendered = request.to_string();
    let used = estimate_tokens(&rendered);
    if used > budget {
        return Err(DbError::Validation(
            "serialized coach snapshot exceeds budget".into(),
        ));
    }
    let id = format!("coach-run-{}", uuid::Uuid::new_v4());
    let snapshot = format!("context-{id}");
    let invocation = format!("invoke-{id}");
    let hash = rendered_hash(&rendered);
    let now = chrono::Utc::now().to_rfc3339();
    begin_agent_run(
        &tx,
        &BeginAgentRunCommand {
            id: id.clone(),
            provider_id: provider.into(),
            model: model.into(),
            run_kind: AgentRunKind::Coach,
        },
    )?;
    let plan = json!({"kind":"canonical_coach", "threadId":thread_id, "userMessageId":user_message_id, "invocationId":invocation, "strategyId":HOST_COACH_STRATEGY});
    tx.execute("INSERT INTO agent_context_snapshots (id,run_id,planner_version,scope,query_plan_json,token_budget,used_tokens,rendered_context,content_hash,created_at)
        VALUES (?1,?2,'canonical-coach-v1',?3,?4,?5,?6,?7,?8,?9)",
        params![snapshot,id,format!("coach:{thread_id}"),plan.to_string(),budget,used,rendered,hash,now])?;
    tx.execute("INSERT INTO agent_context_items (snapshot_id,item_type,item_id,rank,score,estimated_tokens,inclusion_reason,provenance_json)
        VALUES (?1,'CURRENT_TASK',?2,0,1,?3,'exact host assembled request',?4)",
        params![snapshot,user_message_id,used,json!({"sourceKind":"coach_request", "sourceId":user_message_id,"contentHash":hash,"sensitivity":"normal"}).to_string()])?;
    tx.execute("INSERT INTO llm_invocations (id,run_id,kind,provider,model,request_hash,created_at) VALUES (?1,?2,'completion',?3,?4,?5,?6)",
        params![invocation,id,provider,model,hash,now])?;
    tx.execute("UPDATE agent_runs SET result_json=?1 WHERE id=?2",
        params![json!({"runKind":"coach","threadId":thread_id,"userMessageId":user_message_id,"snapshotId":snapshot,"invocationId":invocation,"strategyId":HOST_COACH_STRATEGY}).to_string(),id])?;
    tx.commit()?;
    Ok(id)
}

/// Success message + invocation + run terminal receipt commit together.
pub fn complete_traced_coach(
    conn: &Connection,
    run_id: &str,
    thread_id: &str,
    answer: &str,
    mut payload: Value,
    response: &Value,
) -> DbResult<CoachMessage> {
    let tx = conn.unchecked_transaction()?;
    verify_trace_thread(&tx, run_id, thread_id)?;
    let user_message_id = trace_user_message_id(&tx, run_id)?;
    let assignment_id = format!("csa-{}", uuid::Uuid::new_v4());
    payload["runId"] = json!(run_id);
    payload["userMessageId"] = json!(user_message_id);
    payload["snapshotId"] = json!(format!("context-{run_id}"));
    payload["invocationId"] = json!(format!("invoke-{run_id}"));
    payload["strategyId"] = json!(HOST_COACH_STRATEGY);
    payload["strategyAssignmentId"] = json!(assignment_id);
    if let Some(object) = payload.as_object_mut() {
        for untrusted in ["skillsAddressed", "memoryIdsUsed", "contextSnapshotId"] {
            object.remove(untrusted);
        }
    }
    let message = append_coach_message_in_transaction(
        &tx,
        &AppendCoachMessageCommand {
            thread_id: thread_id.into(),
            role: "assistant".into(),
            content: answer.into(),
            structured_payload: Some(payload),
            status: "completed".into(),
        },
    )?;
    tx.execute(
        "INSERT INTO coach_strategy_assignments_v0
         (id,user_id,coach_message_id,strategy_id,skills_addressed_json,memory_ids_used_json,context_snapshot_id,followup_type,created_at)
         VALUES (?1,'local',?2,?3,'[]','[]',?4,'explain',?5)",
        params![assignment_id, message.id, HOST_COACH_STRATEGY,
            format!("context-{run_id}"), chrono::Utc::now().to_rfc3339()],
    )?;
    tx.execute(
        "UPDATE coach_threads SET status='active',last_error_json=NULL WHERE id=?1",
        [thread_id],
    )?;
    close_trace(&tx, run_id, Some(response), None, Some(&message.id))?;
    tx.commit()?;
    Ok(message)
}

pub fn fail_coach_trace(
    conn: &Connection,
    run_id: &str,
    error: &Value,
    response: Option<&Value>,
) -> DbResult<()> {
    let tx = conn.unchecked_transaction()?;
    let (thread, user_message_id): (String, String) = tx.query_row(
        "SELECT json_extract(result_json,'$.threadId'),json_extract(result_json,'$.userMessageId') FROM agent_runs WHERE id=?1 AND status='running'",
        [run_id], |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let mut payload = error.clone();
    payload["runId"] = json!(run_id);
    payload["userMessageId"] = json!(user_message_id);
    payload["snapshotId"] = json!(format!("context-{run_id}"));
    payload["invocationId"] = json!(format!("invoke-{run_id}"));
    let message = append_coach_message_in_transaction(
        &tx,
        &AppendCoachMessageCommand {
            thread_id: thread.clone(),
            role: "system".into(),
            content: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Coach execution failed")
                .into(),
            structured_payload: Some(payload),
            status: "failed".into(),
        },
    )?;
    tx.execute(
        "UPDATE coach_threads SET status='degraded',last_error_json=?1 WHERE id=?2",
        params![error.to_string(), thread],
    )?;
    close_trace(&tx, run_id, response, Some(error), None)?;
    tx.execute("UPDATE agent_runs SET result_json=json_set(result_json,'$.failureMessageId',?1) WHERE id=?2",params![message.id,run_id])?;
    tx.commit()?;
    Ok(())
}

fn verify_trace_thread(conn: &Connection, run_id: &str, thread_id: &str) -> DbResult<()> {
    let valid: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_runs WHERE id=?1 AND status='running' AND json_extract(result_json,'$.threadId')=?2)",
        params![run_id,thread_id], |row| row.get(0))?;
    if !valid {
        return Err(DbError::Validation(
            "coach trace is not active for this thread".into(),
        ));
    }
    Ok(())
}

fn trace_user_message_id(conn: &Connection, run_id: &str) -> DbResult<String> {
    conn.query_row(
        "SELECT json_extract(result_json,'$.userMessageId') FROM agent_runs WHERE id=?1 AND status='running'",
        [run_id], |row| row.get(0),
    ).map_err(Into::into)
}

fn close_trace(
    conn: &Connection,
    run_id: &str,
    response: Option<&Value>,
    error: Option<&Value>,
    assistant: Option<&str>,
) -> DbResult<()> {
    let response_hash = response
        .and_then(|r| r.get("content"))
        .and_then(Value::as_str)
        .map(rendered_hash);
    let usage = response
        .and_then(|r| r.get("usage"))
        .filter(|v| !v.is_null())
        .map(Value::to_string);
    let model = response
        .and_then(|r| r.get("model"))
        .and_then(Value::as_str);
    let latency = response
        .and_then(|r| r.get("latencyMs"))
        .and_then(Value::as_u64);
    let request_id = response
        .and_then(|r| r.get("providerRequestId"))
        .and_then(Value::as_str);
    let retries = response
        .and_then(|r| r.get("retryCount"))
        .and_then(Value::as_u64);
    let error_json = error.map(Value::to_string);
    let changed = conn.execute("UPDATE llm_invocations SET response_hash=?1,usage_json=?2,model=COALESCE(?3,model),latency_ms=?4,provider_request_id=?5,error_json=?6
        WHERE id=?7 AND response_hash IS NULL AND error_json IS NULL AND run_id IN (SELECT id FROM agent_runs WHERE status='running')",
        params![response_hash,usage,model,latency,request_id,error_json,format!("invoke-{run_id}")])?;
    if changed != 1 {
        return Err(DbError::Validation("coach invocation is not active".into()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let changed = conn.execute("UPDATE agent_runs SET status=?1,rounds=1,error_json=?2,updated_at=?3,completed_at=?3,
        result_json=json_set(result_json,'$.assistantMessageId',?4,'$.actualModel',?5,'$.usage',json(?6),'$.latencyMs',?7,'$.providerRequestId',?8,'$.retryCount',?9)
        WHERE id=?10 AND status='running'",
        params![if error.is_some(){"failed"}else{"completed"},error_json,now,assistant,model,usage.unwrap_or_else(||"null".into()),latency,request_id,retries,run_id])?;
    if changed != 1 {
        return Err(DbError::Validation("coach run is not active".into()));
    }
    Ok(())
}
