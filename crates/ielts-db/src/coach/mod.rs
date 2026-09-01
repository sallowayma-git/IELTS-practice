//! Coach thread/message incremental persistence (Phase 8).
//! Auto-review failures never mutate attempt scores.

use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::LearningEventType;

use crate::learning_events::{append_learning_event_if_enabled, NewLearningEvent};
use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoachThread {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    pub status: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoachMessage {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_payload: Option<Value>,
    pub status: String,
    pub sequence: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureCoachThreadCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "chat".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendCoachMessageCommand {
    pub thread_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_payload: Option<Value>,
    #[serde(default = "default_msg_status")]
    pub status: String,
}

fn default_msg_status() -> String {
    "completed".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCoachFailureCommand {
    pub thread_id: String,
    pub error: Value,
    /// When true, only records error on thread — never touches attempts/scores.
    #[serde(default = "default_true")]
    pub preserve_scores: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCoachCommand {
    pub thread_id: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachRunResult {
    pub user_message: CoachMessage,
    pub assistant_message: CoachMessage,
}

fn default_true() -> bool {
    true
}

pub fn ensure_coach_thread(
    conn: &Connection,
    cmd: &EnsureCoachThreadCommand,
) -> DbResult<CoachThread> {
    if let Some(id) = cmd.thread_id.as_deref() {
        if !id.trim().is_empty() {
            if let Ok(existing) = get_thread(conn, id) {
                return Ok(existing);
            }
        }
    }
    // reuse open thread for attempt if present
    if let Some(attempt_id) = cmd.attempt_id.as_deref() {
        if let Ok(Some(existing)) = find_thread_for_attempt(conn, attempt_id, &cmd.kind) {
            return Ok(existing);
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    let id = cmd
        .thread_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("coach-{}", Uuid::new_v4()));
    let kind = if cmd.kind.trim().is_empty() {
        "chat".into()
    } else {
        cmd.kind.trim().to_ascii_lowercase()
    };
    conn.execute(
        "INSERT INTO coach_threads (id, attempt_id, asset_id, status, created_at, updated_at, kind, last_error_json)
         VALUES (?1, ?2, ?3, 'active', ?4, ?4, ?5, NULL)",
        params![id, cmd.attempt_id, cmd.asset_id, now, kind],
    )?;
    get_thread(conn, &id)
}

pub fn get_thread(conn: &Connection, id: &str) -> DbResult<CoachThread> {
    conn.query_row(
        "SELECT id, attempt_id, asset_id, status, created_at, updated_at,
                COALESCE(kind, 'chat'), last_error_json
         FROM coach_threads WHERE id = ?1",
        params![id],
        |r| {
            let err_json: Option<String> = r.get(7)?;
            Ok(CoachThread {
                id: r.get(0)?,
                attempt_id: r.get(1)?,
                asset_id: r.get(2)?,
                status: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                kind: r.get(6)?,
                last_error: err_json.and_then(|s| serde_json::from_str(&s).ok()),
            })
        },
    )
    .map_err(|_| DbError::Message(format!("coach thread not found: {id}")))
}

fn find_thread_for_attempt(
    conn: &Connection,
    attempt_id: &str,
    kind: &str,
) -> DbResult<Option<CoachThread>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM coach_threads WHERE attempt_id = ?1 AND COALESCE(kind,'chat') = ?2 AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1",
    )?;
    let mut rows = stmt.query(params![attempt_id, kind])?;
    if let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        Ok(Some(get_thread(conn, &id)?))
    } else {
        Ok(None)
    }
}

pub fn append_coach_message(
    conn: &Connection,
    cmd: &AppendCoachMessageCommand,
) -> DbResult<CoachMessage> {
    let tx = conn.unchecked_transaction()?;
    let message = append_coach_message_in_transaction(&tx, cmd)?;
    tx.commit()?;
    Ok(message)
}

fn append_coach_message_in_transaction(
    conn: &Transaction<'_>,
    cmd: &AppendCoachMessageCommand,
) -> DbResult<CoachMessage> {
    if cmd.content.trim().is_empty() {
        return Err(DbError::Validation("content required".into()));
    }
    // ensure thread exists
    let thread = get_thread(conn, &cmd.thread_id)?;
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM coach_messages WHERE thread_id = ?1",
        params![cmd.thread_id],
        |r| r.get(0),
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("cmsg-{}", Uuid::new_v4());
    let role = match cmd.role.trim().to_ascii_lowercase().as_str() {
        "assistant" | "system" => cmd.role.trim().to_ascii_lowercase(),
        _ => "user".into(),
    };
    let structured = cmd.structured_payload.as_ref().map(|v| v.to_string());
    conn.execute(
        "INSERT INTO coach_messages (id, thread_id, role, content, structured_payload, status, created_at, sequence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            cmd.thread_id,
            role,
            cmd.content.trim(),
            structured,
            cmd.status,
            now,
            next
        ],
    )?;
    conn.execute(
        "UPDATE coach_threads SET updated_at = ?1, last_error_json = NULL WHERE id = ?2",
        params![now, cmd.thread_id],
    )?;
    let message = CoachMessage {
        id,
        thread_id: cmd.thread_id.clone(),
        role,
        content: cmd.content.trim().into(),
        structured_payload: cmd.structured_payload.clone(),
        status: cmd.status.clone(),
        sequence: next as u32,
        created_at: now,
    };
    let event_type = match message.role.as_str() {
        "user" => Some(LearningEventType::CoachQuestionAsked),
        "assistant" => Some(LearningEventType::CoachResponseGenerated),
        _ => None,
    };
    if let Some(event_type) = event_type {
        append_learning_event_if_enabled(
            conn,
            NewLearningEvent {
                event_type,
                source_kind: "coach_message".into(),
                source_id: Some(message.id.clone()),
                activity: Some("reading".into()),
                asset_id: thread.asset_id,
                attempt_id: thread.attempt_id,
                question_id: None,
                skill_key: None,
                occurred_at: message.created_at.clone(),
                payload: json!({
                    "messageId": message.id,
                    "threadId": message.thread_id,
                    "role": message.role,
                    "sequence": message.sequence,
                    "questionContext": message.structured_payload.as_ref().and_then(|value| value.get("questionId").cloned()),
                }),
                schema_version: LearningEventType::SCHEMA_VERSION,
                sensitivity: "normal".into(),
            },
        )?;
    }
    Ok(message)
}

pub fn list_coach_messages(
    conn: &Connection,
    thread_id: &str,
    after_sequence: Option<u32>,
    limit: u32,
) -> DbResult<Vec<CoachMessage>> {
    let after = after_sequence.unwrap_or(0) as i64;
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content, structured_payload, status, created_at, sequence
         FROM coach_messages
         WHERE thread_id = ?1 AND sequence > ?2
         ORDER BY sequence ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![thread_id, after, limit.min(500) as i64], |r| {
        let structured: Option<String> = r.get(4)?;
        Ok(CoachMessage {
            id: r.get(0)?,
            thread_id: r.get(1)?,
            role: r.get(2)?,
            content: r.get(3)?,
            structured_payload: structured.and_then(|s| serde_json::from_str(&s).ok()),
            status: r.get(5)?,
            created_at: r.get(6)?,
            sequence: r.get::<_, i64>(7)? as u32,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Round-3 audit (7.8): the NEWEST `limit` messages, returned in chronological
/// order.
///
/// `list_coach_messages` is an ASC + `after_sequence` pagination cursor and must
/// stay that way for the UI; asking it for "the last N" silently returns the
/// OLDEST N instead, which dropped the user's current question out of the coach
/// prompt on any thread past the limit. This sibling selects DESC and reverses,
/// so it is correct regardless of gaps in the sequence.
pub fn list_recent_coach_messages(
    conn: &Connection,
    thread_id: &str,
    limit: u32,
) -> DbResult<Vec<CoachMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content, structured_payload, status, created_at, sequence
         FROM coach_messages
         WHERE thread_id = ?1
         ORDER BY sequence DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![thread_id, limit.min(500) as i64], |r| {
        let structured: Option<String> = r.get(4)?;
        Ok(CoachMessage {
            id: r.get(0)?,
            thread_id: r.get(1)?,
            role: r.get(2)?,
            content: r.get(3)?,
            structured_payload: structured.and_then(|s| serde_json::from_str(&s).ok()),
            status: r.get(5)?,
            created_at: r.get(6)?,
            sequence: r.get::<_, i64>(7)? as u32,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    out.reverse();
    Ok(out)
}

/// Record coach failure. Intentionally does **not** update attempt score/status.
pub fn record_coach_failure(
    conn: &Connection,
    cmd: &RecordCoachFailureCommand,
) -> DbResult<CoachThread> {
    let _ = cmd.preserve_scores; // documented invariant
    let _ = get_thread(conn, &cmd.thread_id)?;
    append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: cmd.thread_id.clone(),
            role: "system".into(),
            content: cmd
                .error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("coach failure")
                .to_string(),
            structured_payload: Some(cmd.error.clone()),
            status: "failed".into(),
        },
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    let err_json =
        serde_json::to_string(&cmd.error).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "UPDATE coach_threads SET last_error_json = ?1, updated_at = ?2, status = 'degraded'
         WHERE id = ?3",
        params![err_json, now, cmd.thread_id],
    )?;
    get_thread(conn, &cmd.thread_id)
}

pub fn complete_coach_run(
    conn: &Connection,
    thread_id: &str,
    content: &str,
    structured_payload: Option<Value>,
) -> DbResult<CoachMessage> {
    let message = append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread_id.to_string(),
            role: "assistant".into(),
            content: content.to_string(),
            structured_payload,
            status: "completed".into(),
        },
    )?;
    conn.execute(
        "UPDATE coach_threads SET status = 'active', last_error_json = NULL WHERE id = ?1",
        params![thread_id],
    )?;
    Ok(message)
}

/// Safety check used by tests: attempt score columns unchanged after coach failure.
pub fn attempt_score_snapshot(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<(Option<f64>, Option<String>)> {
    conn.query_row(
        "SELECT score_value, status FROM attempts WHERE id = ?1",
        params![attempt_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|_| DbError::Message(format!("attempt not found: {attempt_id}")))
}
