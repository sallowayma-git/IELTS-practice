//! M12 General Agent Thread / Planner / Approval persistence.
//!
//! The durable authority for thread-level state, checkpoints, study plans,
//! and the controlled-action approval gate. Mirrors the application port
//! trait `AgentThreadStore`. All writes are transactional; sequence numbers
//! are computed inside the transaction so concurrent appends cannot collide.
//!
//! M12-02 cancellation: `request_thread_cancel` marks the latest non-terminal
//! checkpoint as interrupted by writing a `final` checkpoint with an
//! `interrupted` payload, then the recovery path observes it. Write tools are
//! never auto-replayed: `restart_recovery` only marks threads interrupted; it
//! does not re-execute any tool.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use ielts_domain::{
    ActionKind, AgentCheckpointRecord, AgentMessageRecord, AgentThread, AppendMessageCommand,
    ApprovalStatus, CheckpointStage, CreateStudyPlanCommand, CreateStudyPlanItemCommand,
    CreateThreadCommand, DecideApprovalCommand, MarkPlanItemDoneCommand, MessageRole,
    RecordApprovalCommand, RequestCancelCommand, SaveCheckpointCommand, StudyPlan,
    StudyPlanItem, StudyPlanSnapshot, ThreadKind, ThreadRecoveryReport, ThreadStatus,
};

use crate::sqlite::{DbError, DbResult};

/// M12-06: the controlled-action approval record (db-facing alias).
pub type ActionApproval = ielts_domain::ActionApproval;
/// M12-02: the cancellation outcome (db-facing alias).
pub type CancelOutcome = ielts_domain::CancelOutcome;

/// M12-01: create a thread. Returns the persisted row with server-assigned
/// id/timestamps. The caller provides the user_id, kind, and title.
pub fn create_thread(conn: &Connection, command: &CreateThreadCommand) -> DbResult<AgentThread> {
    require_text(&command.user_id, "userId")?;
    require_text(&command.title, "title")?;
    let id = format!("at-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO agent_threads (
            id, user_id, thread_kind, title, summary, sequence, last_message_at,
            status, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, NULL, 0, NULL, 'active', ?5, ?5)",
        params![id, command.user_id, command.thread_kind.as_str(), command.title, now],
    )?;
    Ok(AgentThread {
        id,
        user_id: command.user_id.clone(),
        thread_kind: command.thread_kind,
        title: command.title.clone(),
        summary: None,
        sequence: 0,
        last_message_at: None,
        status: ThreadStatus::Active,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// M12-01: append a message to a thread. The sequence is computed inside the
/// transaction (current thread.sequence + 1) and the thread's last_message_at
/// + sequence are advanced atomically. Returns the persisted message.
pub fn append_message(
    conn: &Connection,
    command: &AppendMessageCommand,
) -> DbResult<AgentMessageRecord> {
    require_text(&command.thread_id, "threadId")?;
    require_text(&command.content, "content")?;
    let tx = conn.unchecked_transaction()?;
    let thread: Option<(i64,)> = tx
        .query_row(
            "SELECT sequence FROM agent_threads WHERE id = ?1 AND status = 'active'",
            params![command.thread_id],
            |row| Ok((row.get::<_, i64>(0)?,)),
        )
        .optional()?;
    let Some((current_sequence,)) = thread else {
        return Err(DbError::Validation(format!(
            "agent thread is not active: {}",
            command.thread_id
        )));
    };
    let next_sequence = current_sequence + 1;
    let id = format!("am-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let payload_json = command
        .payload
        .as_ref()
        .map(serialize_json)
        .transpose()?;
    tx.execute(
        "INSERT INTO agent_messages (
            id, thread_id, role, sequence, content, payload_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            command.thread_id,
            command.role.as_str(),
            next_sequence,
            command.content,
            payload_json,
            now,
        ],
    )?;
    tx.execute(
        "UPDATE agent_threads
         SET sequence = ?1, last_message_at = ?2, updated_at = ?2
         WHERE id = ?3",
        params![next_sequence, now, command.thread_id],
    )?;
    tx.commit()?;
    Ok(AgentMessageRecord {
        id,
        thread_id: command.thread_id.clone(),
        role: command.role,
        sequence: next_sequence as u32,
        content: command.content.clone(),
        payload: command.payload.clone(),
        created_at: now,
    })
}

/// M12-01: list threads for a user, newest message first, bounded by `limit`.
/// Only active threads are returned by default; archived threads are
/// excluded.
pub fn list_threads(conn: &Connection, user_id: &str, limit: u32) -> DbResult<Vec<AgentThread>> {
    require_text(user_id, "userId")?;
    let bounded = limit.clamp(1, 200) as i64;
    let mut statement = conn.prepare(
        "SELECT id, user_id, thread_kind, title, summary, sequence, last_message_at,
                status, created_at, updated_at
         FROM agent_threads
         WHERE user_id = ?1 AND status = 'active'
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT ?2",
    )?;
    let rows = statement.query_map(params![user_id, bounded], map_thread)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// M12-01: archive a thread. Returns true when the thread was active and is
/// now archived.
pub fn archive_thread(conn: &Connection, thread_id: &str) -> DbResult<bool> {
    require_text(thread_id, "threadId")?;
    let now = chrono::Utc::now().to_rfc3339();
    let updated = conn.execute(
        "UPDATE agent_threads SET status = 'archived', updated_at = ?1 WHERE id = ?2 AND status = 'active'",
        params![now, thread_id],
    )?;
    Ok(updated == 1)
}

/// M12-01: list messages for a thread in sequence order, bounded by `limit`.
pub fn list_messages(
    conn: &Connection,
    thread_id: &str,
    limit: u32,
) -> DbResult<Vec<AgentMessageRecord>> {
    require_text(thread_id, "threadId")?;
    let bounded = limit.clamp(1, 500) as i64;
    let mut statement = conn.prepare(
        "SELECT id, thread_id, role, sequence, content, payload_json, created_at
         FROM agent_messages
         WHERE thread_id = ?1
         ORDER BY sequence ASC
         LIMIT ?2",
    )?;
    let rows = statement.query_map(params![thread_id, bounded], map_message)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// M12-02: save a checkpoint. Each checkpoint is an immutable row; the latest
/// by created_at is the recovery point.
pub fn save_checkpoint(
    conn: &Connection,
    command: &SaveCheckpointCommand,
) -> DbResult<AgentCheckpointRecord> {
    require_text(&command.thread_id, "threadId")?;
    let id = format!("acp-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let payload_json = command
        .payload
        .as_ref()
        .map(serialize_json)
        .transpose()?;
    conn.execute(
        "INSERT INTO agent_checkpoints (id, thread_id, run_id, stage, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            command.thread_id,
            command.run_id,
            command.stage.as_str(),
            payload_json,
            now,
        ],
    )?;
    Ok(AgentCheckpointRecord {
        id,
        thread_id: command.thread_id.clone(),
        run_id: command.run_id.clone(),
        stage: command.stage,
        payload: command.payload.clone(),
        created_at: now,
    })
}

/// M12-02: load the latest checkpoint for a thread. Returns None when the
/// thread has no checkpoints (a fresh run).
pub fn load_latest_checkpoint(
    conn: &Connection,
    thread_id: &str,
) -> DbResult<Option<AgentCheckpointRecord>> {
    require_text(thread_id, "threadId")?;
    let row = conn
        .query_row(
            "SELECT id, thread_id, run_id, stage, payload_json, created_at
             FROM agent_checkpoints
             WHERE thread_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![thread_id],
            map_checkpoint,
        )
        .optional()?;
    Ok(row)
}

/// M12-02: request cancellation of a thread run. Writes a `final` checkpoint
/// with a `{"interrupted": true}` payload so the recovery path can observe
/// the cancellation. Returns `cancelled: true` when the latest checkpoint was
/// non-terminal.
pub fn request_thread_cancel(conn: &Connection, command: &RequestCancelCommand) -> DbResult<CancelOutcome> {
    require_text(&command.thread_id, "threadId")?;
    let latest = load_latest_checkpoint(conn, &command.thread_id)?;
    let Some(checkpoint) = latest else {
        return Ok(CancelOutcome {
            thread_id: command.thread_id.clone(),
            cancelled: false,
        });
    };
    if checkpoint.stage.is_terminal() {
        return Ok(CancelOutcome {
            thread_id: command.thread_id.clone(),
            cancelled: false,
        });
    }
    save_checkpoint(
        conn,
        &SaveCheckpointCommand {
            thread_id: command.thread_id.clone(),
            run_id: checkpoint.run_id.clone(),
            stage: CheckpointStage::Final,
            payload: Some(serde_json::json!({"interrupted": true, "reason": "user_cancel"})),
        },
    )?;
    Ok(CancelOutcome {
        thread_id: command.thread_id.clone(),
        cancelled: true,
    })
}

/// M12-02: startup recovery. Marks threads whose latest checkpoint is
/// non-terminal as interrupted by writing a `final` checkpoint with an
/// `interrupted` payload. Write tools are never auto-replayed: this only
/// records the interrupted state so the UI can surface it and the user can
/// retry explicitly.
pub fn restart_recovery(conn: &Connection) -> DbResult<ThreadRecoveryReport> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    // Find threads whose latest checkpoint is non-terminal. A thread may have
    // multiple checkpoints; the latest is the recovery point. We select the
    // latest checkpoint per thread and filter non-terminal.
    let mut statement = tx.prepare(
        "SELECT c.thread_id, c.run_id, c.stage, c.id
         FROM agent_checkpoints c
         INNER JOIN (
            SELECT thread_id, MAX(created_at) AS max_created
            FROM agent_checkpoints
            GROUP BY thread_id
         ) latest ON c.thread_id = latest.thread_id AND c.created_at = latest.max_created
         WHERE c.stage <> 'final'",
    )?;
    let interrupted: Vec<(String, Option<String>)> = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let checkpoint_count = interrupted.len() as u32;
    let thread_count = interrupted
        .iter()
        .map(|(thread_id, _)| thread_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .len() as u32;
    for (thread_id, run_id) in &interrupted {
        let id = format!("acp-{}", Uuid::new_v4());
        let payload = serde_json::json!({"interrupted": true, "reason": "process_restart"});
        let payload_json = serde_json::to_string(&payload)
            .map_err(|error| DbError::Message(error.to_string()))?;
        tx.execute(
            "INSERT INTO agent_checkpoints (id, thread_id, run_id, stage, payload_json, created_at)
             VALUES (?1, ?2, ?3, 'final', ?4, ?5)",
            params![id, thread_id, run_id, payload_json, now],
        )?;
    }
    tx.commit()?;
    Ok(ThreadRecoveryReport {
        interrupted_threads: thread_count,
        interrupted_checkpoints: checkpoint_count,
    })
}

/// M12-04: create a study plan with its items in a single transaction.
pub fn create_study_plan(
    conn: &Connection,
    command: &CreateStudyPlanCommand,
) -> DbResult<StudyPlan> {
    require_text(&command.user_id, "userId")?;
    require_text(&command.goal, "goal")?;
    let tx = conn.unchecked_transaction()?;
    let id = format!("sp-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO study_plans (id, user_id, goal, available_minutes, target_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            command.user_id,
            command.goal,
            command.available_minutes as i64,
            command.target_date,
            now,
        ],
    )?;
    for item in &command.items {
        create_study_plan_item_inner(&tx, &id, item, &now)?;
    }
    tx.commit()?;
    Ok(StudyPlan {
        id,
        user_id: command.user_id.clone(),
        goal: command.goal.clone(),
        available_minutes: command.available_minutes,
        target_date: command.target_date.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

fn create_study_plan_item_inner(
    tx: &rusqlite::Transaction<'_>,
    plan_id: &str,
    item: &CreateStudyPlanItemCommand,
    now: &str,
) -> DbResult<String> {
    require_text(&item.skill_probe, "skillProbe")?;
    require_text(&item.why_text, "whyText")?;
    let id = format!("spi-{}", Uuid::new_v4());
    tx.execute(
        "INSERT INTO study_plan_items (id, plan_id, skill_probe, why_text, estimated_minutes, done, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        params![
            id,
            plan_id,
            item.skill_probe,
            item.why_text,
            item.estimated_minutes as i64,
            now,
        ],
    )?;
    Ok(id)
}

/// M12-04: list study plan items for a plan.
pub fn list_study_plan_items(
    conn: &Connection,
    plan_id: &str,
) -> DbResult<Vec<StudyPlanItem>> {
    require_text(plan_id, "planId")?;
    let mut statement = conn.prepare(
        "SELECT id, plan_id, skill_probe, why_text, estimated_minutes, done, created_at
         FROM study_plan_items
         WHERE plan_id = ?1
         ORDER BY created_at ASC",
    )?;
    let rows = statement.query_map(params![plan_id], |row| {
        let done: i64 = row.get(5)?;
        Ok(StudyPlanItem {
            id: row.get(0)?,
            plan_id: row.get(1)?,
            skill_probe: row.get(2)?,
            why_text: row.get(3)?,
            estimated_minutes: row.get::<_, i64>(4)? as u32,
            done: done != 0,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Latest plan (highest created_at) for a user with its items — the product
/// read surface for the console plan panel. Plan IDs are not thread IDs, so
/// the host exposes the snapshot explicitly instead of letting the UI guess.
pub fn load_latest_study_plan(
    conn: &Connection,
    user_id: &str,
) -> DbResult<Option<StudyPlanSnapshot>> {
    require_text(user_id, "userId")?;
    let plan = conn
        .query_row(
            "SELECT id, user_id, goal, available_minutes, target_date, created_at, updated_at
             FROM study_plans
             WHERE user_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![user_id],
            |row| {
                Ok(StudyPlan {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    goal: row.get(2)?,
                    available_minutes: row.get::<_, i64>(3)? as u32,
                    target_date: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()?;
    let Some(plan) = plan else {
        return Ok(None);
    };
    let items = list_study_plan_items(conn, &plan.id)?;
    Ok(Some(StudyPlanSnapshot { plan, items }))
}

/// M12-04: mark a plan item done (or not done).
pub fn mark_plan_item_done(
    conn: &Connection,
    command: &MarkPlanItemDoneCommand,
) -> DbResult<bool> {
    require_text(&command.item_id, "itemId")?;
    let done_value: i64 = if command.done { 1 } else { 0 };
    let updated = conn.execute(
        "UPDATE study_plan_items SET done = ?1 WHERE id = ?2",
        params![done_value, command.item_id],
    )?;
    Ok(updated == 1)
}

/// M12-06: record a controlled action as pending. Only approval-gated kinds
/// should reach here; allow-list kinds are executed directly without a row.
/// Returns the persisted approval.
pub fn record_action_approval(
    conn: &Connection,
    command: &RecordApprovalCommand,
) -> DbResult<ActionApproval> {
    let gate = command.action_kind.gate();
    if gate == ielts_domain::ActionGate::Allow {
        return Err(DbError::Validation(format!(
            "action_kind {} is allow-listed and does not require an approval record",
            command.action_kind.as_str()
        )));
    }
    let id = format!("aaa-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let payload_json = serialize_json(&command.payload)?;
    conn.execute(
        "INSERT INTO agent_action_approvals (
            id, thread_id, action_kind, payload_json, status, approved_by, created_at, decided_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, NULL)",
        params![
            id,
            command.thread_id,
            command.action_kind.as_str(),
            payload_json,
            now,
        ],
    )?;
    Ok(ActionApproval {
        id,
        thread_id: command.thread_id.clone(),
        action_kind: command.action_kind,
        payload: command.payload.clone(),
        status: ApprovalStatus::Pending,
        approved_by: None,
        created_at: now,
        decided_at: None,
    })
}

/// M12-06: list pending approvals, oldest first, bounded by `limit`.
pub fn list_pending_approvals(conn: &Connection, limit: u32) -> DbResult<Vec<ActionApproval>> {
    let bounded = limit.clamp(1, 200) as i64;
    let mut statement = conn.prepare(
        "SELECT id, thread_id, action_kind, payload_json, status, approved_by, created_at, decided_at
         FROM agent_action_approvals
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![bounded], map_approval)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// M12-06: decide a pending approval. Only pending approvals can be decided.
/// Returns the updated approval.
pub fn decide_approval(
    conn: &Connection,
    command: &DecideApprovalCommand,
) -> DbResult<ActionApproval> {
    require_text(&command.approval_id, "approvalId")?;
    require_text(&command.approved_by, "approvedBy")?;
    if command.status == ApprovalStatus::Pending {
        return Err(DbError::Validation(
            "approval decision must be approved or rejected, not pending".into(),
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let row = tx
        .query_row(
            "SELECT id, thread_id, action_kind, payload_json, status, approved_by, created_at, decided_at
             FROM agent_action_approvals
             WHERE id = ?1 AND status = 'pending'",
            params![command.approval_id],
            map_approval,
        )
        .optional()?;
    let Some(mut approval) = row else {
        return Err(DbError::Validation(format!(
            "approval is not pending: {}",
            command.approval_id
        )));
    };
    let updated = tx.execute(
        "UPDATE agent_action_approvals
         SET status = ?1, approved_by = ?2, decided_at = ?3
         WHERE id = ?4 AND status = 'pending'",
        params![command.status.as_str(), command.approved_by, now, command.approval_id],
    )?;
    if updated != 1 {
        return Err(DbError::Validation(format!(
            "approval could not be decided: {}",
            command.approval_id
        )));
    }
    tx.commit()?;
    approval.status = command.status;
    approval.approved_by = Some(command.approved_by.clone());
    approval.decided_at = Some(now);
    Ok(approval)
}

/// M12-06: returns true when an action kind name is forbidden (never offered
/// to the agent). Delegates to the domain constant.
pub fn is_forbidden_action_kind(name: &str) -> bool {
    ielts_domain::is_forbidden_action_kind(name)
}

fn map_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentThread> {
    let kind_str: String = row.get(2)?;
    let status_str: String = row.get(7)?;
    let thread_kind = parse_enum(&kind_str, "thread_kind").map_err(to_sql_error)?;
    let status = parse_enum(&status_str, "thread_status").map_err(to_sql_error)?;
    let summary: Option<String> = row.get(4)?;
    let last_message_at: Option<String> = row.get(6)?;
    Ok(AgentThread {
        id: row.get(0)?,
        user_id: row.get(1)?,
        thread_kind,
        title: row.get(3)?,
        summary,
        sequence: row.get::<_, i64>(5)? as u32,
        last_message_at,
        status,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn map_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentMessageRecord> {
    let role_str: String = row.get(2)?;
    let role = parse_enum(&role_str, "message_role").map_err(to_sql_error)?;
    let payload_json: Option<String> = row.get(5)?;
    let payload = payload_json
        .as_deref()
        .map(|raw| parse_json(raw, "agent message payload"))
        .transpose()
        .map_err(to_sql_error)?;
    Ok(AgentMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role,
        sequence: row.get::<_, i64>(3)? as u32,
        content: row.get(4)?,
        payload,
        created_at: row.get(6)?,
    })
}

fn map_checkpoint(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentCheckpointRecord> {
    let stage_str: String = row.get(3)?;
    let stage = parse_enum(&stage_str, "checkpoint_stage").map_err(to_sql_error)?;
    let payload_json: Option<String> = row.get(4)?;
    let payload = payload_json
        .as_deref()
        .map(|raw| parse_json(raw, "agent checkpoint payload"))
        .transpose()
        .map_err(to_sql_error)?;
    Ok(AgentCheckpointRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        run_id: row.get(2)?,
        stage,
        payload,
        created_at: row.get(5)?,
    })
}

fn map_approval(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActionApproval> {
    let kind_str: String = row.get(2)?;
    let action_kind = parse_enum(&kind_str, "action_kind").map_err(to_sql_error)?;
    let status_str: String = row.get(4)?;
    let status = parse_enum(&status_str, "approval_status").map_err(to_sql_error)?;
    let payload_json: String = row.get(3)?;
    let payload = parse_json(&payload_json, "agent approval payload").map_err(to_sql_error)?;
    Ok(ActionApproval {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        action_kind,
        payload,
        status,
        approved_by: row.get(5)?,
        created_at: row.get(6)?,
        decided_at: row.get(7)?,
    })
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

/// Parse a persisted enum string into its domain variant. Each branch matches
/// the enum's own `parse` function; an unknown value is a data integrity
/// error, not a silent default.
fn parse_enum<T>(value: &str, enum_name: &str) -> DbResult<T>
where
    T: EnumParse,
{
    T::parse(value).ok_or_else(|| DbError::Message(format!("invalid {enum_name}: {value}")))
}

trait EnumParse: Sized {
    fn parse(value: &str) -> Option<Self>;
}

impl EnumParse for ThreadKind {
    fn parse(value: &str) -> Option<Self> {
        ThreadKind::parse(value)
    }
}

impl EnumParse for ThreadStatus {
    fn parse(value: &str) -> Option<Self> {
        ThreadStatus::parse(value)
    }
}

impl EnumParse for MessageRole {
    fn parse(value: &str) -> Option<Self> {
        MessageRole::parse(value)
    }
}

impl EnumParse for CheckpointStage {
    fn parse(value: &str) -> Option<Self> {
        CheckpointStage::parse(value)
    }
}

impl EnumParse for ActionKind {
    fn parse(value: &str) -> Option<Self> {
        ActionKind::parse(value)
    }
}

impl EnumParse for ApprovalStatus {
    fn parse(value: &str) -> Option<Self> {
        ApprovalStatus::parse(value)
    }
}

fn serialize_json(value: &Value) -> DbResult<String> {
    serde_json::to_string(value).map_err(|error| DbError::Message(error.to_string()))
}

fn parse_json(raw: &str, field: &str) -> DbResult<Value> {
    serde_json::from_str(raw).map_err(|error| DbError::Message(format!("{field}: {error}")))
}

fn to_sql_error(error: DbError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
