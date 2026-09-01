//! Legacy import helpers (cold path).
//! Hot-path attempt writes live in `crate::attempts`.

use rusqlite::{params, Connection};
use serde_json::Value;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptRecord, WritingEvaluationV4};

use crate::attempts::{
    ensure_asset_stub, parse_writing_task_type, upsert_attempt, writing_task_type_str,
};
use crate::import::convert::{evaluation_v3_to_v4, reading_submission_to_attempt};
use crate::sqlite::{DbError, DbResult};

pub fn upsert_writing_evaluation(
    conn: &Connection,
    attempt_id: &str,
    evaluation: &WritingEvaluationV4,
) -> DbResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut stored_evaluation = evaluation.clone();
    stored_evaluation.id = id.clone();
    let result_json =
        serde_json::to_string(&stored_evaluation).map_err(|e| DbError::Import(e.to_string()))?;
    let degradation_json = evaluation
        .degradation
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| DbError::Import(e.to_string()))?;
    let error_json = evaluation
        .error
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| DbError::Import(e.to_string()))?;

    conn.execute(
        "DELETE FROM writing_evaluations WHERE attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "INSERT INTO writing_evaluations (
            id, attempt_id, status, stage, provider_id, model, rubric_version, prompt_version,
            result_json, degradation_json, error_json, started_at, completed_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, NULL, NULL, 'ielts-v1', 'default',
            ?5, ?6, ?7, NULL, NULL, ?8
        )",
        params![
            id,
            attempt_id,
            format!("{:?}", evaluation.status).to_ascii_lowercase(),
            format!("{:?}", evaluation.stage).to_ascii_lowercase(),
            result_json,
            degradation_json,
            error_json,
            now,
        ],
    )?;
    if let Some(task_type) = evaluation.task_type {
        // Import data may predate the attempt-level column.  An explicit V4
        // evaluation is a trustworthy source, but it must never overwrite an
        // already persisted conflicting classification.
        let updated = conn.execute(
            "UPDATE attempts
             SET task_type = ?1, updated_at = ?2
             WHERE id = ?3
               AND activity = 'writing'
               AND (task_type IS NULL OR task_type = ?1)",
            params![
                writing_task_type_str(task_type),
                chrono::Utc::now().to_rfc3339(),
                attempt_id
            ],
        )?;
        if updated == 0 {
            return Err(DbError::Import(format!(
                "evaluation task_type conflicts with writing attempt {attempt_id}"
            )));
        }
    }
    Ok(())
}

pub fn list_history_view_models(
    conn: &Connection,
) -> DbResult<Vec<ielts_domain::HistoryListItemVm>> {
    let mut stmt = conn.prepare(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, task_type
         FROM attempts
         ORDER BY COALESCE(submitted_at, started_at) DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AttemptRecord {
            schema_version: row.get::<_, i64>(17)? as u32,
            id: row.get(0)?,
            activity: parse_activity(&row.get::<_, String>(1)?),
            asset_id: row.get(2)?,
            mode: parse_mode(&row.get::<_, String>(3)?),
            suite_id: row.get(4)?,
            status: parse_status(&row.get::<_, String>(5)?),
            started_at: row.get(6)?,
            submitted_at: row.get(7)?,
            completed_at: row.get(8)?,
            duration_ms: row.get::<_, i64>(9)? as u64,
            score_value: row.get(10)?,
            score_scale: row
                .get::<_, Option<String>>(11)?
                .and_then(|s| match s.as_str() {
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
    })?;

    let mut out = Vec::new();
    for row in rows {
        let attempt = row?;
        out.push(ielts_domain::history_item_from_attempt(&attempt));
    }
    Ok(out)
}

pub fn import_evaluation_json(conn: &Connection, attempt_id: &str, raw: &Value) -> DbResult<()> {
    let v4 = evaluation_v3_to_v4(raw).map_err(|e| DbError::Import(e.to_string()))?;
    upsert_writing_evaluation(conn, attempt_id, &v4)
}

pub fn import_reading_submission_json(conn: &Connection, raw: &Value) -> DbResult<String> {
    let attempt = reading_submission_to_attempt(raw).map_err(|e| DbError::Import(e.to_string()))?;
    if let Some(asset_id) = attempt.asset_id.as_deref() {
        ensure_asset_stub(
            conn,
            asset_id,
            Activity::Reading,
            attempt
                .title_snapshot
                .as_deref()
                .unwrap_or("Imported reading"),
            Some(asset_id),
        )?;
    }
    let id = attempt.id.clone();
    upsert_attempt(conn, &attempt)?;
    Ok(id)
}

fn parse_activity(raw: &str) -> Activity {
    match raw {
        "writing" => Activity::Writing,
        _ => Activity::Reading,
    }
}

fn parse_mode(raw: &str) -> AttemptMode {
    match raw {
        "suite" => AttemptMode::Suite,
        "endless" => AttemptMode::Endless,
        "memorize" => AttemptMode::Memorize,
        "freeform" => AttemptMode::Freeform,
        "bank" => AttemptMode::Bank,
        _ => AttemptMode::Single,
    }
}

fn parse_status(raw: &str) -> AttemptStatus {
    match raw {
        "draft" => AttemptStatus::Draft,
        "active" => AttemptStatus::Active,
        "submitted" => AttemptStatus::Submitted,
        "reviewing" => AttemptStatus::Reviewing,
        "cancelled" => AttemptStatus::Cancelled,
        "failed" => AttemptStatus::Failed,
        "interrupted" => AttemptStatus::Interrupted,
        _ => AttemptStatus::Completed,
    }
}
