//! Convert legacy reading archive / inflated submission records into AttemptRecord.

use serde_json::{Map, Value};

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptAnnotationDto, AttemptAnswer, AttemptRecord};
use ielts_domain::error::{DomainError, DomainResult};

/// Convert one reading-archive v1 record (or similar inflated submission) into AttemptRecord.
pub fn reading_submission_to_attempt(raw: &Value) -> DomainResult<AttemptRecord> {
    if !raw.is_object() {
        return Err(DomainError::InvalidPayload(
            "reading submission must be an object".into(),
        ));
    }

    let id = first_string(raw, &["id", "sessionId", "session_id"])
        .unwrap_or_else(|| "unknown-attempt".into());

    let asset_id = first_string(raw, &["assetId", "asset_id", "examId", "exam_id"]);
    let title = first_string(raw, &["title"])
        .or_else(|| {
            raw.get("metadata")
                .and_then(|m| first_string(m, &["examTitle", "title"]))
        })
        .unwrap_or_else(|| "Untitled reading".into());

    let submitted_at = first_string(raw, &["submittedAt", "submitted_at", "endTime", "ended_at"]);
    let started_at = first_string(raw, &["startedAt", "started_at", "startTime"])
        .or_else(|| submitted_at.clone())
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".into());

    let duration_ms = extract_duration_ms(raw);
    let (correct_count, question_count, score_value) = extract_score_fields(raw);

    let mode = parse_mode(
        raw.get("metadata")
            .and_then(|m| first_string(m, &["practiceMode", "mode"]))
            .or_else(|| first_string(raw, &["mode", "practiceMode"]))
            .as_deref(),
    );

    let answers = extract_answers(raw);
    let annotations = extract_highlights(raw, &id, asset_id.as_deref());

    // Merge marked questions into answers.
    let marked = extract_marked(raw);
    let mut answers = answers;
    for qid in marked {
        if let Some(answer) = answers.iter_mut().find(|a| a.question_id == qid) {
            answer.marked = true;
        } else {
            answers.push(AttemptAnswer {
                question_id: qid,
                answer: Value::Null,
                is_correct: None,
                weight: 1.0,
                question_kind: None,
                change_count: 0,
                visit_count: 0,
                elapsed_ms: 0,
                marked: true,
                answered_at: None,
            });
        }
    }

    Ok(AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id,
        activity: Activity::Reading,
        asset_id,
        mode,
        suite_id: first_string(raw, &["suiteId", "suite_id"]),
        status: AttemptStatus::Completed,
        started_at,
        submitted_at,
        completed_at: first_string(raw, &["completedAt", "completed_at"]),
        duration_ms,
        score_value,
        score_scale: Some(ScoreScale::Ratio),
        correct_count,
        question_count,
        title_snapshot: Some(title),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations,
    })
}

/// Convert a reading-archive document (`{ records: [...] }`) into attempts.
pub fn reading_archive_to_attempts(doc: &Value) -> DomainResult<Vec<AttemptRecord>> {
    let records = doc
        .get("records")
        .and_then(|v| v.as_array())
        .ok_or_else(|| DomainError::InvalidPayload("archive missing records[]".into()))?;

    records.iter().map(reading_submission_to_attempt).collect()
}

fn extract_duration_ms(raw: &Value) -> u64 {
    if let Some(v) = num(raw.get("duration_ms")).or_else(|| num(raw.get("durationMs"))) {
        return v.max(0.0) as u64;
    }
    if let Some(v) = num(raw.get("duration")) {
        // Heuristic: values < 100000 treated as seconds-or-ms ambiguous.
        // Archive fixtures store seconds-like durations already in ms-ish numbers (1400).
        // Prefer as milliseconds when already large enough for a reading session,
        // otherwise treat as seconds.
        if v >= 1000.0 {
            return v as u64;
        }
        return (v * 1000.0) as u64;
    }
    if let Some(score_info) = raw.get("scoreInfo") {
        if let Some(v) = num(score_info.get("duration")) {
            if v >= 1000.0 {
                return v as u64;
            }
            return (v * 1000.0) as u64;
        }
    }
    0
}

fn extract_score_fields(raw: &Value) -> (Option<f64>, Option<u32>, Option<f64>) {
    let score_info = raw.get("scoreInfo");
    let correct = num(raw.get("correct_count"))
        .or_else(|| num(raw.get("correctAnswers")))
        .or_else(|| score_info.and_then(|s| num(s.get("correct"))));
    let total = num(raw.get("question_count"))
        .or_else(|| num(raw.get("totalQuestions")))
        .or_else(|| score_info.and_then(|s| num(s.get("totalQuestions"))))
        .or_else(|| score_info.and_then(|s| num(s.get("total"))));
    let accuracy = num(raw.get("accuracy"))
        .or_else(|| score_info.and_then(|s| num(s.get("accuracy"))))
        .or_else(|| {
            score_info
                .and_then(|s| num(s.get("percentage")))
                .map(|p| p / 100.0)
        })
        .or_else(|| match (correct, total) {
            (Some(c), Some(t)) if t > 0.0 => Some(c / t),
            _ => None,
        });

    (correct, total.map(|t| t as u32), accuracy)
}

fn extract_answers(raw: &Value) -> Vec<AttemptAnswer> {
    let Some(map) = raw.get("answers").and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    let correct = raw
        .get("correctAnswers")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    map.iter()
        .map(|(qid, answer)| {
            let is_correct = correct
                .get(qid)
                .map(|expected| answers_equal(answer, expected));
            AttemptAnswer {
                question_id: qid.clone(),
                answer: answer.clone(),
                is_correct,
                weight: 1.0,
                question_kind: None,
                change_count: 0,
                visit_count: 0,
                elapsed_ms: 0,
                marked: false,
                answered_at: None,
            }
        })
        .collect()
}

fn extract_marked(raw: &Value) -> Vec<String> {
    raw.get("markedQuestions")
        .or_else(|| raw.get("marked_questions"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn extract_highlights(
    raw: &Value,
    attempt_id: &str,
    asset_id: Option<&str>,
) -> Vec<AttemptAnnotationDto> {
    let asset = asset_id.unwrap_or("unknown-asset");
    raw.get("highlights")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(idx, item)| {
                    let text = item.get("text")?.as_str()?.to_string();
                    let mut anchor = Map::new();
                    anchor.insert("quote".into(), Value::String(text));
                    if let Some(color) = item.get("color") {
                        anchor.insert("color".into(), color.clone());
                    }
                    Some(AttemptAnnotationDto {
                        id: format!("{attempt_id}-hl-{idx}"),
                        attempt_id: Some(attempt_id.to_string()),
                        asset_id: asset.to_string(),
                        scope: "passage".into(),
                        question_id: None,
                        kind: "highlight".into(),
                        anchor: Value::Object(anchor),
                        note_text: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_mode(raw: Option<&str>) -> AttemptMode {
    match raw.map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("suite") => AttemptMode::Suite,
        Some("endless") => AttemptMode::Endless,
        Some("memorize") | Some("memorise") => AttemptMode::Memorize,
        Some("freeform") => AttemptMode::Freeform,
        Some("bank") => AttemptMode::Bank,
        _ => AttemptMode::Single,
    }
}

fn answers_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::String(x), Value::String(y)) => x.trim().eq_ignore_ascii_case(y.trim()),
        _ => a == b,
    }
}

fn first_string(raw: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = raw.get(*key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn num(value: Option<&Value>) -> Option<f64> {
    value.and_then(|v| {
        v.as_f64()
            .or_else(|| v.as_i64().map(|i| i as f64))
            .or_else(|| v.as_u64().map(|u| u as f64))
            .or_else(|| v.as_str()?.parse().ok())
    })
}
