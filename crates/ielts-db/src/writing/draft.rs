//! Writing draft repository + idempotent submit tokens (Phase 5).

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, WritingTaskType};
use ielts_domain::dto::{
    AttemptRecord, CloneWritingDraftCommand, SaveDraftCommand, SubmitAttemptCommand,
};
use uuid::Uuid;

use crate::attempts::{parse_writing_task_type, upsert_attempt, writing_task_type_str};
use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDraft {
    pub attempt_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// Durable attempt identity: retry/resume must never infer this from a
    /// missing asset id or a prompt string. It is absent only for a malformed
    /// legacy orphan, which remains readable but cannot be retried blindly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<AttemptMode>,
    pub content_text: String,
    pub prompt_snapshot: Option<String>,
    pub task_type: Option<WritingTaskType>,
    pub word_count: u32,
    pub idempotency_key: Option<String>,
    pub updated_at: String,
}

pub fn save_writing_draft(conn: &Connection, cmd: &SaveDraftCommand) -> DbResult<WritingDraft> {
    if cmd.activity != Activity::Writing {
        return Err(DbError::Validation(
            "save_writing_draft requires activity=writing".into(),
        ));
    }
    if !matches!(cmd.mode, AttemptMode::Freeform | AttemptMode::Bank) {
        return Err(DbError::Validation(
            "writing drafts require mode=freeform or mode=bank".into(),
        ));
    }
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    let task_type = cmd.task_type.ok_or_else(|| {
        DbError::Validation("writing drafts require an explicit task_type (task1 or task2)".into())
    })?;
    validate_topic_task_type(conn, cmd.asset_id.as_deref(), task_type)?;

    // Take the write lock before inspecting an existing attempt.  A stale
    // autosave must either see the newer terminal state and fail, or lose the
    // write race; it must never overwrite that state with `draft`.
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let existing_open_status = ensure_open_writing_draft_scope(&tx, cmd)?;

    let now = chrono::Utc::now().to_rfc3339();
    let content = cmd.content_text.clone().unwrap_or_default();
    let word_count = count_words(&content);
    let title_snapshot = title_from_prompt(cmd.prompt_snapshot.as_deref());

    // A new attempt begins as a draft.  An already-active attempt stays
    // active: autosave changes its content, never its lifecycle direction.
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: Activity::Writing,
        asset_id: cmd.asset_id.clone(),
        mode: cmd.mode,
        suite_id: None,
        status: existing_open_status.unwrap_or(AttemptStatus::Draft),
        started_at: now.clone(),
        submitted_at: None,
        completed_at: None,
        duration_ms: 0,
        score_value: None,
        score_scale: None,
        correct_count: None,
        question_count: None,
        title_snapshot,
        prompt_snapshot: cmd.prompt_snapshot.clone(),
        content_text: Some(content.clone()),
        task_type: Some(task_type),
        answers: vec![],
        annotations: vec![],
    };
    upsert_attempt(&tx, &attempt)?;

    tx.execute(
        "INSERT INTO writing_drafts (
            attempt_id, content_text, prompt_snapshot, task_type, word_count, idempotency_key, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(attempt_id) DO UPDATE SET
            content_text = excluded.content_text,
            prompt_snapshot = excluded.prompt_snapshot,
            task_type = excluded.task_type,
            word_count = excluded.word_count,
            idempotency_key = excluded.idempotency_key,
            updated_at = excluded.updated_at",
        params![
            cmd.attempt_id,
            content,
            cmd.prompt_snapshot,
            writing_task_type_str(task_type),
            word_count as i64,
            cmd.idempotency_key,
            now,
        ],
    )?;

    // Record draft idempotency (latest wins for same key scope).
    tx.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('writing.draft', ?1, ?2, NULL, NULL, ?3)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET
            attempt_id = excluded.attempt_id,
            created_at = excluded.created_at",
        params![cmd.idempotency_key, cmd.attempt_id, now],
    )?;

    tx.commit()?;

    Ok(WritingDraft {
        attempt_id: cmd.attempt_id.clone(),
        asset_id: cmd.asset_id.clone(),
        mode: Some(cmd.mode),
        content_text: content,
        prompt_snapshot: cmd.prompt_snapshot.clone(),
        task_type: Some(task_type),
        word_count,
        idempotency_key: Some(cmd.idempotency_key.clone()),
        updated_at: now,
    })
}

pub fn get_writing_draft(conn: &Connection, attempt_id: &str) -> DbResult<Option<WritingDraft>> {
    let mut stmt = conn.prepare(
        "SELECT d.attempt_id, a.asset_id, a.mode, d.content_text, d.prompt_snapshot,
                a.task_type, d.task_type, d.word_count, d.idempotency_key, d.updated_at
         FROM writing_drafts d
         LEFT JOIN attempts a ON a.id = d.attempt_id
         WHERE d.attempt_id = ?1",
    )?;
    let mut rows = stmt.query(params![attempt_id])?;
    if let Some(row) = rows.next()? {
        let persisted_task_type: Option<String> = row.get(5)?;
        let legacy_task_type: Option<String> = row.get(6)?;
        Ok(Some(WritingDraft {
            attempt_id: row.get(0)?,
            asset_id: row.get(1)?,
            mode: row
                .get::<_, Option<String>>(2)?
                .as_deref()
                .map(parse_attempt_mode),
            content_text: row.get(3)?,
            prompt_snapshot: row.get(4)?,
            task_type: parse_writing_task_type(persisted_task_type)
                .or_else(|| parse_writing_task_type(legacy_task_type)),
            word_count: row.get::<_, i64>(7)? as u32,
            idempotency_key: row.get(8)?,
            updated_at: row.get(9)?,
        }))
    } else {
        Ok(None)
    }
}

/// A submitted/evaluated writing attempt is a historical input snapshot. When a
/// learner chooses “return and edit”, copy that snapshot into a brand-new open
/// draft rather than weakening the terminal-state guard used by autosave and
/// submit.
pub fn clone_writing_draft(
    conn: &Connection,
    cmd: &CloneWritingDraftCommand,
) -> DbResult<WritingDraft> {
    if cmd.source_attempt_id.trim().is_empty() || cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation(
            "source_attempt_id and idempotency_key are required".into(),
        ));
    }

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    if let Some(existing) = lookup_idempotency(&tx, "writing.clone", &cmd.idempotency_key)? {
        let draft = get_writing_draft(&tx, &existing.attempt_id)?.ok_or_else(|| {
            DbError::Message("writing clone idempotency points to a missing draft".into())
        })?;
        tx.commit()?;
        return Ok(draft);
    }

    let source = load_existing_writing_attempt(&tx, &cmd.source_attempt_id)?.ok_or_else(|| {
        DbError::Validation(format!(
            "writing attempt does not exist: {}",
            cmd.source_attempt_id
        ))
    })?;
    if source.activity != "writing" {
        return Err(DbError::Validation(
            "only a writing attempt may be cloned to a draft".into(),
        ));
    }
    if matches!(source.status.as_str(), "draft" | "active") {
        return Err(DbError::Validation(
            "open writing attempts should be edited directly, not cloned".into(),
        ));
    }
    if source.suite_id.is_some() {
        return Err(DbError::Validation(
            "suite writing attempts cannot be cloned as a standalone draft".into(),
        ));
    }

    let source_draft = get_writing_draft(&tx, &cmd.source_attempt_id)?.ok_or_else(|| {
        DbError::Validation("source writing attempt has no durable draft snapshot".into())
    })?;
    let mode = source_draft
        .mode
        .ok_or_else(|| DbError::Validation("source writing attempt has no durable mode".into()))?;
    if !matches!(mode, AttemptMode::Freeform | AttemptMode::Bank) {
        return Err(DbError::Validation(
            "source writing attempt has an unsupported editable mode".into(),
        ));
    }
    let task_type = source_draft.task_type.ok_or_else(|| {
        DbError::Validation("source writing attempt has no durable task type".into())
    })?;

    let attempt_id = format!("attempt-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: attempt_id.clone(),
        activity: Activity::Writing,
        asset_id: source_draft.asset_id.clone(),
        mode,
        suite_id: None,
        status: AttemptStatus::Draft,
        started_at: now.clone(),
        submitted_at: None,
        completed_at: None,
        duration_ms: 0,
        score_value: None,
        score_scale: None,
        correct_count: None,
        question_count: None,
        title_snapshot: title_from_prompt(source_draft.prompt_snapshot.as_deref()),
        prompt_snapshot: source_draft.prompt_snapshot.clone(),
        content_text: Some(source_draft.content_text.clone()),
        task_type: Some(task_type),
        answers: vec![],
        annotations: vec![],
    };
    upsert_attempt(&tx, &attempt)?;
    tx.execute(
        "INSERT INTO writing_drafts (
            attempt_id, content_text, prompt_snapshot, task_type, word_count, idempotency_key, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            attempt_id,
            source_draft.content_text,
            source_draft.prompt_snapshot,
            writing_task_type_str(task_type),
            source_draft.word_count as i64,
            cmd.idempotency_key,
            now,
        ],
    )?;
    tx.execute(
        "INSERT INTO attempt_idempotency (
            scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at
         ) VALUES ('writing.clone', ?1, ?2, NULL, ?3, ?4)",
        params![
            cmd.idempotency_key,
            attempt.id,
            serde_json::json!({ "attemptId": attempt.id }).to_string(),
            now,
        ],
    )?;
    tx.commit()?;

    Ok(WritingDraft {
        attempt_id,
        asset_id: source_draft.asset_id,
        mode: Some(mode),
        content_text: source_draft.content_text,
        prompt_snapshot: source_draft.prompt_snapshot,
        task_type: Some(task_type),
        word_count: source_draft.word_count,
        idempotency_key: Some(cmd.idempotency_key.clone()),
        updated_at: now,
    })
}

fn parse_attempt_mode(raw: &str) -> AttemptMode {
    match raw {
        "suite" => AttemptMode::Suite,
        "endless" => AttemptMode::Endless,
        "memorize" => AttemptMode::Memorize,
        "freeform" => AttemptMode::Freeform,
        "bank" => AttemptMode::Bank,
        _ => AttemptMode::Single,
    }
}

#[derive(Debug)]
struct ExistingWritingAttempt {
    activity: String,
    asset_id: Option<String>,
    mode: String,
    suite_id: Option<String>,
    status: String,
}

/// A draft save may create an attempt, or update the same still-open writing
/// attempt.  It is never a generic upsert: submitted, evaluating and terminal
/// attempts are immutable input snapshots for evaluation/history.
fn ensure_open_writing_draft_scope(
    conn: &Connection,
    cmd: &SaveDraftCommand,
) -> DbResult<Option<AttemptStatus>> {
    let Some(existing) = load_existing_writing_attempt(conn, &cmd.attempt_id)? else {
        return Ok(None);
    };

    let status = require_open_writing_attempt(&existing, &cmd.attempt_id)?;
    if existing.asset_id.as_deref() != cmd.asset_id.as_deref()
        || existing.mode != writing_attempt_mode_name(cmd.mode)
        || existing.suite_id.is_some()
    {
        return Err(DbError::Validation(
            "writing draft belongs to another mode, session, or asset".into(),
        ));
    }
    Ok(Some(status))
}

/// Submission has no creation semantics.  An idempotency replay is handled
/// before this guard, but every new submit must target an open writing attempt.
fn require_open_writing_attempt_by_id(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<AttemptStatus> {
    let existing = load_existing_writing_attempt(conn, attempt_id)?.ok_or_else(|| {
        DbError::Validation(format!("writing attempt does not exist: {attempt_id}"))
    })?;
    require_open_writing_attempt(&existing, attempt_id)
}

fn require_open_writing_attempt(
    existing: &ExistingWritingAttempt,
    attempt_id: &str,
) -> DbResult<AttemptStatus> {
    if existing.activity != "writing" {
        return Err(DbError::Validation(format!(
            "attempt is not a writing attempt: {attempt_id}"
        )));
    }
    match existing.status.as_str() {
        "draft" => Ok(AttemptStatus::Draft),
        "active" => Ok(AttemptStatus::Active),
        _ => Err(DbError::Validation(
            "only an open writing attempt may be changed".into(),
        )),
    }
}

fn load_existing_writing_attempt(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<Option<ExistingWritingAttempt>> {
    conn.query_row(
        "SELECT activity, asset_id, mode, suite_id, status FROM attempts WHERE id = ?1",
        params![attempt_id],
        |row| {
            Ok(ExistingWritingAttempt {
                activity: row.get(0)?,
                asset_id: row.get(1)?,
                mode: row.get(2)?,
                suite_id: row.get(3)?,
                status: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn writing_attempt_mode_name(mode: AttemptMode) -> &'static str {
    match mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

/// Mark attempt submitted. Idempotent: same key returns prior attempt_id without re-mutating.
pub fn submit_writing_attempt(
    conn: &Connection,
    cmd: &SubmitAttemptCommand,
) -> DbResult<AttemptRecord> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }

    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    if let Some(existing) = lookup_idempotency(&tx, "writing.submit", &cmd.idempotency_key)? {
        let attempt = load_attempt_minimal(&tx, &existing.attempt_id)?;
        tx.commit()?;
        return Ok(attempt);
    }

    let now = chrono::Utc::now().to_rfc3339();
    require_open_writing_attempt_by_id(&tx, &cmd.attempt_id)?;
    let draft = get_writing_draft(&tx, &cmd.attempt_id)?
        .ok_or_else(|| DbError::Validation(format!("no draft for {}", cmd.attempt_id)))?;

    if draft.content_text.trim().is_empty() {
        return Err(DbError::Validation("cannot submit empty essay".into()));
    }

    let mut attempt = load_attempt_minimal(&tx, &cmd.attempt_id)?;
    attempt.status = AttemptStatus::Submitted;
    attempt.submitted_at = Some(now.clone());
    attempt.content_text = Some(draft.content_text.clone());
    attempt.prompt_snapshot = draft.prompt_snapshot.clone();
    upsert_attempt(&tx, &attempt)?;

    let response = serde_json::json!({ "attemptId": attempt.id, "status": "submitted" });
    tx.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('writing.submit', ?1, ?2, NULL, ?3, ?4)",
        params![
            cmd.idempotency_key,
            attempt.id,
            response.to_string(),
            now
        ],
    )?;

    tx.commit()?;

    Ok(attempt)
}

#[derive(Debug)]
struct IdemRow {
    attempt_id: String,
}

fn lookup_idempotency(conn: &Connection, scope: &str, key: &str) -> DbResult<Option<IdemRow>> {
    let mut stmt = conn.prepare(
        "SELECT attempt_id FROM attempt_idempotency WHERE scope = ?1 AND idempotency_key = ?2",
    )?;
    let mut rows = stmt.query(params![scope, key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(IdemRow {
            attempt_id: row.get(0)?,
        }))
    } else {
        Ok(None)
    }
}

fn load_attempt_minimal(conn: &Connection, id: &str) -> DbResult<AttemptRecord> {
    conn.query_row(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, task_type
         FROM attempts WHERE id = ?1",
        params![id],
        |row| {
            use ielts_domain::domain::ScoreScale;
            Ok(AttemptRecord {
                schema_version: row.get::<_, i64>(17)? as u32,
                id: row.get(0)?,
                activity: match row.get::<_, String>(1)?.as_str() {
                    "writing" => Activity::Writing,
                    _ => Activity::Reading,
                },
                asset_id: row.get(2)?,
                mode: match row.get::<_, String>(3)?.as_str() {
                    "suite" => AttemptMode::Suite,
                    "endless" => AttemptMode::Endless,
                    "memorize" => AttemptMode::Memorize,
                    "freeform" => AttemptMode::Freeform,
                    "bank" => AttemptMode::Bank,
                    _ => AttemptMode::Single,
                },
                suite_id: row.get(4)?,
                status: match row.get::<_, String>(5)?.as_str() {
                    "draft" => AttemptStatus::Draft,
                    "active" => AttemptStatus::Active,
                    "submitted" => AttemptStatus::Submitted,
                    "reviewing" => AttemptStatus::Reviewing,
                    "cancelled" => AttemptStatus::Cancelled,
                    "failed" => AttemptStatus::Failed,
                    "interrupted" => AttemptStatus::Interrupted,
                    _ => AttemptStatus::Completed,
                },
                started_at: row.get(6)?,
                submitted_at: row.get(7)?,
                completed_at: row.get(8)?,
                duration_ms: row.get::<_, i64>(9)? as u64,
                score_value: row.get(10)?,
                score_scale: row.get::<_, Option<String>>(11)?.and_then(|s| match s.as_str() {
                    "ratio" => Some(ScoreScale::Ratio),
                    "band9" => Some(ScoreScale::Band9),
                    _ => None,
                }),
                correct_count: row.get(12)?,
                question_count: row.get::<_, Option<i64>>(13)?.map(|v| v as u32),
                title_snapshot: row.get(14)?,
                prompt_snapshot: row.get(15)?,
                content_text: row.get(16)?,
                task_type: parse_writing_task_type(row.get(18)?),
                answers: vec![],
                annotations: vec![],
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            DbError::Validation(format!("attempt not found: {id}"))
        }
        other => other.into(),
    })
}

fn count_words(text: &str) -> u32 {
    text.split_whitespace().filter(|w| !w.is_empty()).count() as u32
}

/// History list title from the first non-empty prompt line (truncated).
fn title_from_prompt(prompt: Option<&str>) -> Option<String> {
    let line = prompt?.lines().map(str::trim).find(|s| !s.is_empty())?;
    const MAX: usize = 80;
    let count = line.chars().count();
    if count <= MAX {
        Some(line.to_string())
    } else {
        let mut out: String = line.chars().take(MAX).collect();
        out.push('…');
        Some(out)
    }
}

fn validate_topic_task_type(
    conn: &Connection,
    asset_id: Option<&str>,
    task_type: WritingTaskType,
) -> DbResult<()> {
    let Some(asset_id) = asset_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    let topic_task_type: Option<String> = conn
        .query_row(
            "SELECT task_type FROM writing_topics WHERE asset_id = ?1",
            params![asset_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(topic_task_type) = parse_writing_task_type(topic_task_type) else {
        return Ok(());
    };
    if topic_task_type == task_type {
        return Ok(());
    }
    Err(DbError::Validation(format!(
        "writing topic {asset_id} belongs to a different task type"
    )))
}
