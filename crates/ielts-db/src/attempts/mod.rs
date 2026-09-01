//! Canonical attempt persistence (hot path).
//!
//! Lives outside `import/` — product writes must not go through "legacy import".

use rusqlite::{params, Connection, OptionalExtension};

use ielts_domain::domain::{Activity, AttemptMode, ScoreScale, WritingTaskType};
use ielts_domain::dto::AttemptRecord;

use crate::sqlite::{DbError, DbResult};

pub fn upsert_attempt(conn: &Connection, attempt: &AttemptRecord) -> DbResult<()> {
    ensure_attempt_identity(conn, attempt)?;
    ensure_task_type_scope(attempt)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attempts (
            id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
            duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
            prompt_snapshot, content_text, task_type, schema_version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14, ?15,
            ?16, ?17, ?18, ?19, ?20, ?21
        )
        ON CONFLICT(id) DO UPDATE SET
            status=excluded.status,
            submitted_at=excluded.submitted_at,
            completed_at=excluded.completed_at,
            duration_ms=excluded.duration_ms,
            score_value=excluded.score_value,
            score_scale=excluded.score_scale,
            correct_count=excluded.correct_count,
            question_count=excluded.question_count,
            title_snapshot=excluded.title_snapshot,
            prompt_snapshot=excluded.prompt_snapshot,
            content_text=excluded.content_text,
            -- A compatibility import may not know the task type.  It must
            -- never erase a classification already established by a modern
            -- writing write; explicit Task 1/2 updates still replace it.
            task_type=COALESCE(excluded.task_type, attempts.task_type),
            updated_at=excluded.updated_at
        ",
        params![
            attempt.id,
            activity_str(attempt.activity),
            attempt.asset_id,
            mode_str(attempt.mode),
            attempt.suite_id,
            format!("{:?}", attempt.status).to_ascii_lowercase(),
            attempt.started_at,
            attempt.submitted_at,
            attempt.completed_at,
            attempt.duration_ms as i64,
            attempt.score_value,
            attempt.score_scale.map(|s| match s {
                ScoreScale::Ratio => "ratio",
                ScoreScale::Band9 => "band9",
            }),
            attempt.correct_count,
            attempt.question_count.map(|v| v as i64),
            attempt.title_snapshot,
            attempt.prompt_snapshot,
            attempt.content_text,
            attempt.task_type.map(writing_task_type_str),
            attempt.schema_version as i64,
            now,
            now,
        ],
    )?;

    conn.execute(
        "DELETE FROM attempt_answers WHERE attempt_id = ?1",
        params![attempt.id],
    )?;
    for answer in &attempt.answers {
        conn.execute(
            "INSERT INTO attempt_answers (
                attempt_id, question_id, answer_json, is_correct, weight, question_kind,
                change_count, visit_count, elapsed_ms, marked, answered_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                attempt.id,
                answer.question_id,
                answer.answer.to_string(),
                answer.is_correct.map(|b| if b { 1 } else { 0 }),
                answer.weight,
                answer.question_kind,
                answer.change_count as i64,
                answer.visit_count as i64,
                answer.elapsed_ms as i64,
                if answer.marked { 1 } else { 0 },
                answer.answered_at,
            ],
        )?;
    }

    for ann in &attempt.annotations {
        conn.execute(
            "INSERT OR REPLACE INTO attempt_annotations (
                id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                ann.id,
                ann.attempt_id,
                ann.asset_id,
                ann.scope,
                ann.question_id,
                ann.kind,
                ann.anchor.to_string(),
                ann.note_text,
                now,
                now,
            ],
        )?;
    }

    Ok(())
}

fn ensure_task_type_scope(attempt: &AttemptRecord) -> DbResult<()> {
    if attempt.activity == Activity::Reading && attempt.task_type.is_some() {
        return Err(DbError::Validation(
            "reading attempts cannot carry a writing task_type".into(),
        ));
    }
    Ok(())
}

fn ensure_attempt_identity(conn: &Connection, attempt: &AttemptRecord) -> DbResult<()> {
    let existing: Option<(String, Option<String>, String, Option<String>)> = conn
        .query_row(
            "SELECT activity, asset_id, mode, suite_id FROM attempts WHERE id = ?1",
            params![attempt.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((activity, asset_id, mode, suite_id)) = existing else {
        return Ok(());
    };
    if activity == activity_str(attempt.activity)
        && asset_id == attempt.asset_id
        && mode == mode_str(attempt.mode)
        && suite_id == attempt.suite_id
    {
        return Ok(());
    }
    Err(DbError::Validation(format!(
        "attempt identity is immutable: {}",
        attempt.id
    )))
}

pub fn ensure_asset_stub(
    conn: &Connection,
    asset_id: &str,
    activity: Activity,
    title: &str,
    source_key: Option<&str>,
) -> DbResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
        ) VALUES (
            ?1, ?2, 'imported', ?3, ?4, NULL, NULL, NULL,
            NULL, 2, ?5, 0, NULL, ?6, ?7
        )",
        params![
            asset_id,
            activity_str(activity),
            source_key,
            title,
            format!("import:{asset_id}"),
            now,
            now,
        ],
    )?;
    Ok(())
}

pub fn count_attempts(conn: &Connection) -> DbResult<i64> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM attempts", [], |r| r.get(0))?;
    Ok(n)
}

fn activity_str(activity: Activity) -> &'static str {
    match activity {
        Activity::Reading => "reading",
        Activity::Writing => "writing",
    }
}

fn mode_str(mode: AttemptMode) -> &'static str {
    match mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

pub(crate) fn writing_task_type_str(task_type: WritingTaskType) -> &'static str {
    match task_type {
        WritingTaskType::Task1 => "task1",
        WritingTaskType::Task2 => "task2",
    }
}

pub(crate) fn parse_writing_task_type(raw: Option<String>) -> Option<WritingTaskType> {
    raw.as_deref().and_then(WritingTaskType::parse_loose)
}
