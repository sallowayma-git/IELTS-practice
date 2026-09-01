//! Memorize mode: temporary read-only attempt that never enters normal history (Phase 7).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus};
use ielts_domain::dto::AttemptRecord;

use crate::attempts::upsert_attempt;
use crate::reading::assets::{load_answer_key, load_practice_asset_payload};
use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateMemorizeCommand {
    pub asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorizeSession {
    pub attempt: AttemptRecord,
    pub read_only: bool,
    pub enters_history: bool,
}

/// Create a temporary memorize attempt. Mode is `memorize`; history list excludes it.
pub fn create_memorize_session(
    conn: &Connection,
    cmd: &CreateMemorizeCommand,
) -> DbResult<MemorizeSession> {
    if let Some(key) = cmd.idempotency_key.as_deref() {
        if !key.trim().is_empty() {
            if let Some(prev) = load_idempotent(conn, key)? {
                return Ok(prev);
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let id = format!("memorize-{}", Uuid::new_v4());
    let loaded = load_practice_asset_payload(conn, &cmd.asset_id)?;
    if loaded.asset.pdf_only || load_answer_key(&loaded.payload).is_empty() {
        return Err(DbError::Validation(format!(
            "memorize asset is not answerable: {}",
            cmd.asset_id
        )));
    }

    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: id.clone(),
        activity: Activity::Reading,
        asset_id: Some(cmd.asset_id.clone()),
        mode: AttemptMode::Memorize,
        suite_id: None,
        status: AttemptStatus::Active,
        started_at: now.clone(),
        submitted_at: None,
        completed_at: None,
        duration_ms: 0,
        score_value: None,
        score_scale: None,
        correct_count: None,
        question_count: None,
        title_snapshot: Some(
            cmd.title_snapshot
                .clone()
                .unwrap_or_else(|| loaded.asset.title.clone()),
        ),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![],
        annotations: vec![],
    };
    upsert_attempt(conn, &attempt)?;

    let session = MemorizeSession {
        attempt,
        read_only: true,
        enters_history: false,
    };
    if let Some(key) = cmd.idempotency_key.as_deref() {
        if !key.trim().is_empty() {
            store_idempotent(conn, key, &session)?;
        }
    }
    Ok(session)
}

/// Close memorize session without writing score into ordinary history semantics.
pub fn finish_memorize_session(conn: &Connection, attempt_id: &str) -> DbResult<AttemptRecord> {
    let now = chrono::Utc::now().to_rfc3339();
    let n = conn.execute(
        "UPDATE attempts SET status = 'cancelled', completed_at = ?1, updated_at = ?1
         WHERE id = ?2 AND mode = 'memorize'",
        params![now, attempt_id],
    )?;
    if n == 0 {
        return Err(DbError::Message(format!(
            "memorize not found: {attempt_id}"
        )));
    }
    // Return minimal record
    Ok(AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: attempt_id.into(),
        activity: Activity::Reading,
        asset_id: None,
        mode: AttemptMode::Memorize,
        suite_id: None,
        status: AttemptStatus::Cancelled,
        started_at: now.clone(),
        submitted_at: None,
        completed_at: Some(now),
        duration_ms: 0,
        score_value: None,
        score_scale: None,
        correct_count: None,
        question_count: None,
        title_snapshot: None,
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![],
        annotations: vec![],
    })
}

fn store_idempotent(conn: &Connection, key: &str, session: &MemorizeSession) -> DbResult<()> {
    let json = serde_json::to_string(session).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT INTO mode_idempotency (scope, idempotency_key, entity_id, response_json, created_at)
         VALUES ('memorize.create', ?1, ?2, ?3, ?4)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET response_json = excluded.response_json",
        params![
            key,
            session.attempt.id,
            json,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn load_idempotent(conn: &Connection, key: &str) -> DbResult<Option<MemorizeSession>> {
    let mut stmt = conn.prepare(
        "SELECT response_json FROM mode_idempotency WHERE scope = 'memorize.create' AND idempotency_key = ?1",
    )?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        Ok(Some(
            serde_json::from_str(&json).map_err(|e| DbError::Message(e.to_string()))?,
        ))
    } else {
        Ok(None)
    }
}
