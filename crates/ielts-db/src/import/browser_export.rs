use std::path::Path;

use rusqlite::Connection;
use serde_json::Value;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType};
use ielts_domain::dto::AttemptRecord;

use crate::attempts::{ensure_asset_stub, upsert_attempt};
use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Default)]
pub struct BrowserImportReport {
    pub practice_records: usize,
    pub settings: usize,
    pub errors: Vec<String>,
}

pub fn import_browser_export_value(
    conn: &Connection,
    doc: &Value,
) -> DbResult<BrowserImportReport> {
    let mut report = BrowserImportReport::default();
    let data = doc.get("data").cloned().unwrap_or_else(|| doc.clone());

    if let Some(records) = data.get("practice_records").and_then(|v| v.as_array()) {
        for record in records {
            match import_practice_record(conn, record) {
                Ok(()) => report.practice_records += 1,
                Err(err) => report.errors.push(err.to_string()),
            }
        }
    }

    if let Some(settings) = data.get("settings").and_then(|v| v.as_object()) {
        let now = chrono::Utc::now().to_rfc3339();
        for (key, value) in settings {
            conn.execute(
                "INSERT INTO settings(namespace, key, value_json, updated_at)
                 VALUES ('legacy_browser', ?1, ?2, ?3)
                 ON CONFLICT(namespace, key) DO UPDATE SET
                    value_json=excluded.value_json,
                    updated_at=excluded.updated_at",
                rusqlite::params![key, value.to_string(), now],
            )?;
            report.settings += 1;
        }
    }

    Ok(report)
}

pub fn import_browser_export_file(conn: &Connection, path: &Path) -> DbResult<BrowserImportReport> {
    let text = std::fs::read_to_string(path)?;
    let doc: Value = serde_json::from_str(&text).map_err(|e| DbError::Import(e.to_string()))?;
    import_browser_export_value(conn, &doc)
}

fn import_practice_record(conn: &Connection, raw: &Value) -> DbResult<()> {
    let activity = match raw
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("reading")
    {
        "writing" => Activity::Writing,
        _ => Activity::Reading,
    };

    let id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("legacy-record")
        .to_string();
    let title = raw
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Legacy record")
        .to_string();
    let exam_id = raw
        .get("examId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let duration = raw.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
    let correct = raw.get("correctAnswers").and_then(|v| v.as_f64());
    let total = raw
        .get("totalQuestions")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    let score = raw.get("score").and_then(|v| v.as_f64());
    let submitted = raw
        .get("endTime")
        .or_else(|| raw.get("date"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let started = raw
        .get("startTime")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| submitted.clone())
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".into());

    if let Some(asset_id) = exam_id.as_deref() {
        ensure_asset_stub(conn, asset_id, activity, &title, Some(asset_id))?;
    }

    let mut answers = Vec::new();
    if let Some(map) = raw.pointer("/realData/answers").and_then(|v| v.as_object()) {
        for (qid, value) in map {
            answers.push(ielts_domain::AttemptAnswer {
                question_id: qid.clone(),
                answer: value.clone(),
                is_correct: None,
                weight: 1.0,
                question_kind: None,
                change_count: 0,
                visit_count: 0,
                elapsed_ms: 0,
                marked: false,
                answered_at: None,
            });
        }
    }

    let score_value = match activity {
        Activity::Reading => match (correct, total) {
            (Some(c), Some(t)) if t > 0 => Some(c / f64::from(t)),
            _ => score.map(|s| if s > 1.0 { s / 100.0 } else { s }),
        },
        Activity::Writing => score,
    };

    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id,
        activity,
        asset_id: exam_id,
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: started,
        submitted_at: submitted,
        completed_at: None,
        // Browser export historically stored duration in seconds.
        duration_ms: duration.saturating_mul(1000),
        score_value,
        score_scale: Some(match activity {
            Activity::Reading => ScoreScale::Ratio,
            Activity::Writing => ScoreScale::Band9,
        }),
        correct_count: correct,
        question_count: total,
        title_snapshot: Some(title),
        prompt_snapshot: None,
        content_text: None,
        task_type: writing_task_type_from_record(raw, activity),
        answers,
        annotations: vec![],
    };
    upsert_attempt(conn, &attempt)
}

fn writing_task_type_from_record(raw: &Value, activity: Activity) -> Option<WritingTaskType> {
    if activity != Activity::Writing {
        return None;
    }
    raw.get("taskType")
        .or_else(|| raw.get("task_type"))
        .and_then(Value::as_str)
        .and_then(WritingTaskType::parse_loose)
}
