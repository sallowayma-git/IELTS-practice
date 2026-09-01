use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use ielts_domain::{
    Activity, AttemptRecord, AttemptStatus, LearningEvent, LearningEventType,
    SearchLearningEventsQuery,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::sqlite::{DbError, DbResult};

const DEFAULT_USER_ID: &str = "local";
const DEFAULT_SENSITIVITY: &str = "normal";
const DEFAULT_STATE: &str = "pending";

#[derive(Debug, Clone)]
pub struct NewLearningEvent {
    pub event_type: LearningEventType,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub activity: Option<String>,
    pub asset_id: Option<String>,
    pub attempt_id: Option<String>,
    pub question_id: Option<String>,
    pub skill_key: Option<String>,
    pub occurred_at: String,
    pub payload: Value,
    pub schema_version: i64,
    pub sensitivity: String,
}

impl NewLearningEvent {
    pub fn reading_attempt_completed(
        attempt_id: &str,
        asset_id: &str,
        payload: Value,
        occurred_at: String,
    ) -> Self {
        Self {
            event_type: LearningEventType::AttemptCompleted,
            source_kind: "reading_attempt".into(),
            source_id: Some(attempt_id.into()),
            activity: Some("reading".into()),
            asset_id: Some(asset_id.into()),
            attempt_id: Some(attempt_id.into()),
            question_id: None,
            skill_key: None,
            occurred_at,
            payload,
            schema_version: LearningEventType::SCHEMA_VERSION,
            sensitivity: DEFAULT_SENSITIVITY.into(),
        }
    }

    pub fn reading_question_outcome(
        attempt_id: &str,
        asset_id: &str,
        question_id: &str,
        payload: Value,
        occurred_at: String,
    ) -> Self {
        Self {
            event_type: LearningEventType::ReadingQuestionOutcome,
            source_kind: "reading_question".into(),
            source_id: Some(format!("{attempt_id}:{question_id}")),
            activity: Some("reading".into()),
            asset_id: Some(asset_id.into()),
            attempt_id: Some(attempt_id.into()),
            question_id: Some(question_id.into()),
            skill_key: None,
            occurred_at,
            payload,
            schema_version: LearningEventType::SCHEMA_VERSION,
            sensitivity: DEFAULT_SENSITIVITY.into(),
        }
    }

    pub fn writing_evaluation_completed(
        evaluation_id: &str,
        attempt_id: &str,
        status: &str,
        stage: &str,
        task_type: Option<&str>,
        score: Option<&serde_json::Value>,
        degradation: Option<&serde_json::Value>,
        error: Option<&serde_json::Value>,
        provider_id: Option<&str>,
        model: Option<&str>,
        occurred_at: String,
    ) -> Self {
        Self {
            event_type: LearningEventType::WritingEvaluationCompleted,
            source_kind: "writing_evaluation".into(),
            source_id: Some(evaluation_id.into()),
            activity: Some("writing".into()),
            asset_id: None,
            attempt_id: Some(attempt_id.into()),
            question_id: None,
            skill_key: None,
            occurred_at,
            payload: json!({
                "evaluationId": evaluation_id,
                "attemptId": attempt_id,
                "status": status,
                "stage": stage,
                "taskType": task_type,
                "score": score,
                "degradation": degradation,
                "error": error,
                "providerId": provider_id,
                "model": model,
            }),
            schema_version: LearningEventType::SCHEMA_VERSION,
            sensitivity: DEFAULT_SENSITIVITY.into(),
        }
    }
}

pub fn event_key(
    event_type: LearningEventType,
    source_id: Option<&str>,
    schema_version: i64,
) -> String {
    let source = source_id.unwrap_or("");
    sha256_hex(&format!(
        "{}|{}|v{}",
        event_type.as_str(),
        source,
        schema_version
    ))
}

pub fn append_learning_event(
    conn: &Connection,
    event: NewLearningEvent,
) -> DbResult<LearningEvent> {
    Ok(append_learning_event_with_status(conn, event)?.event)
}

#[derive(Debug, Clone, PartialEq)]
struct AppendLearningEventResult {
    event: LearningEvent,
    inserted: bool,
}

fn append_learning_event_with_status(
    conn: &Connection,
    event: NewLearningEvent,
) -> DbResult<AppendLearningEventResult> {
    if event.source_kind.trim().is_empty()
        || event
            .source_id
            .as_deref()
            .is_none_or(|source_id| source_id.trim().is_empty())
        || event.occurred_at.trim().is_empty()
    {
        return Err(DbError::Validation(
            "learning event source kind, source id, and occurred_at are required".into(),
        ));
    }
    let payload_json = serde_json::to_string(&event.payload)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let content_hash = sha256_hex(&payload_json);
    let idempotency_key = event_key(
        event.event_type,
        event.source_id.as_deref(),
        event.schema_version,
    );
    let id = format!("lev-{}", uuid::Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let inserted = conn.execute(
        "INSERT INTO learning_events (id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,attempt_id,question_id,skill_key,occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)
         ON CONFLICT(idempotency_key) DO NOTHING",
        params![id, DEFAULT_USER_ID, event.event_type.as_str(), event.source_kind, event.source_id, idempotency_key, event.activity, event.asset_id, event.attempt_id, event.question_id, event.skill_key, event.occurred_at, payload_json, content_hash, event.schema_version, DEFAULT_STATE, event.sensitivity, now],
    )? == 1;
    let stored = load_by_key(conn, &idempotency_key)?
        .ok_or_else(|| DbError::Message("learning event insert did not hydrate".into()))?;
    if stored.event_type != event.event_type
        || stored.source_kind != event.source_kind
        || stored.source_id != event.source_id
        || stored.content_hash != content_hash
        || stored.schema_version != event.schema_version
    {
        return Err(DbError::Validation(format!(
            "learning event idempotency conflict: {idempotency_key}"
        )));
    }
    Ok(AppendLearningEventResult {
        event: stored,
        inserted,
    })
}

pub const fn learning_event_generation_enabled() -> bool {
    cfg!(feature = "learning-event-ledger-v1")
}

pub fn append_learning_event_if_enabled(
    conn: &Connection,
    event: NewLearningEvent,
) -> DbResult<Option<LearningEvent>> {
    if !learning_event_generation_enabled() {
        return Ok(None);
    }
    append_learning_event(conn, event).map(Some)
}

pub fn project_reading_attempt_events_if_enabled(
    conn: &Connection,
    attempt: &AttemptRecord,
) -> DbResult<LearningEventProjectionReport> {
    if !learning_event_generation_enabled() {
        return Ok(LearningEventProjectionReport::default());
    }
    project_reading_attempt_events(conn, attempt)
}

pub fn project_reading_attempt_events(
    conn: &Connection,
    attempt: &AttemptRecord,
) -> DbResult<LearningEventProjectionReport> {
    let events = reading_projection_events(conn, attempt)?;
    let mut report = LearningEventProjectionReport {
        expected: events.len() as u32,
        ..Default::default()
    };
    for event in events {
        let outcome = append_learning_event_with_status(conn, event)?;
        if outcome.inserted {
            report.inserted += 1;
        } else {
            report.existing += 1;
        }
    }
    Ok(report)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventProjectionReport {
    pub expected: u32,
    pub inserted: u32,
    pub existing: u32,
}

pub fn list_learning_events(
    conn: &Connection,
    asset_id: Option<&str>,
    attempt_id: Option<&str>,
    limit: u32,
) -> DbResult<Vec<LearningEvent>> {
    let limit = i64::from(limit.clamp(1, 200));
    let mut sql = String::from("SELECT id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,attempt_id,question_id,skill_key,occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at FROM learning_events WHERE 1=1");
    let mut values: Vec<String> = Vec::new();
    if let Some(asset_id) = asset_id {
        sql.push_str(" AND asset_id = ?");
        values.push(asset_id.into());
    }
    if let Some(attempt_id) = attempt_id {
        sql.push_str(" AND attempt_id = ?");
        values.push(attempt_id.into());
    }
    sql.push_str(" ORDER BY occurred_at ASC, id ASC LIMIT ?");
    let mut params: Vec<&dyn rusqlite::ToSql> = values
        .iter()
        .map(|value| value as &dyn rusqlite::ToSql)
        .collect();
    params.push(&limit);
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(params), map_event)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn list_learning_events_filtered(
    conn: &Connection,
    query: &SearchLearningEventsQuery,
) -> DbResult<Vec<LearningEvent>> {
    let limit = i64::from(query.limit.clamp(1, 101));
    let mut statement = conn.prepare(
        "SELECT id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,attempt_id,question_id,skill_key,occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at
         FROM learning_events
         WHERE (?1 IS NULL OR event_type = ?1)
           AND (?2 IS NULL OR skill_key = ?2)
           AND (?3 IS NULL OR activity = ?3)
           AND (?4 IS NULL OR occurred_at >= ?4)
           AND (?5 IS NULL OR occurred_at <= ?5)
           AND (?6 IS NULL OR asset_id = ?6)
           AND (?7 IS NULL OR attempt_id = ?7)
           AND sensitivity = 'normal'
         ORDER BY occurred_at DESC, id DESC LIMIT ?8",
    )?;
    let rows = statement.query_map(
        params![
            query.event_type,
            query.skill_key,
            query.activity,
            query.occurred_after,
            query.occurred_before,
            query.asset_id,
            query.attempt_id,
            limit,
        ],
        map_event,
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn learning_events_verify(conn: &Connection) -> DbResult<LearningEventsVerifyReport> {
    let total: u32 = conn
        .query_row("SELECT COUNT(*) FROM learning_events", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|v| v as u32)?;
    let mut bad_hashes = 0_u32;
    let mut keys = BTreeSet::new();
    let mut stmt =
        conn.prepare("SELECT id,idempotency_key,payload_json,content_hash FROM learning_events")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, key, payload, hash) = row?;
        if sha256_hex(&payload) != hash {
            bad_hashes += 1;
        }
        if !keys.insert(key) {
            return Err(DbError::Validation(format!(
                "duplicate learning event idempotency key: {id}"
            )));
        }
    }
    let expected = expected_reading_events(conn, u32::MAX)?;
    let expected_keys = expected.keys().cloned().collect::<BTreeSet<_>>();
    let mut actual = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT idempotency_key,content_hash FROM learning_events
         WHERE activity = 'reading' AND event_type IN ('attempt_completed','reading_question_outcome')",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (key, hash) = row?;
        actual.insert(key, hash);
    }
    let missing = expected
        .keys()
        .filter(|key| !actual.contains_key(*key))
        .count() as u32;
    let mismatched = expected
        .iter()
        .filter(|(key, hash)| actual.get(*key).is_some_and(|actual| actual != *hash))
        .count() as u32;
    let orphaned = actual
        .keys()
        .filter(|key| !expected_keys.contains(*key))
        .count() as u32;
    Ok(LearningEventsVerifyReport {
        total,
        bad_hashes,
        expected: expected.len() as u32,
        missing,
        mismatched,
        orphaned,
        consistent: bad_hashes == 0 && missing == 0 && mismatched == 0 && orphaned == 0,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventsVerifyReport {
    pub total: u32,
    pub bad_hashes: u32,
    pub expected: u32,
    pub missing: u32,
    pub mismatched: u32,
    pub orphaned: u32,
    pub consistent: bool,
}

pub fn learning_events_rebuild(
    conn: &Connection,
    limit: u32,
) -> DbResult<LearningEventsRebuildReport> {
    let attempt_ids = completed_reading_attempt_ids(conn, limit)?;
    let mut report = LearningEventsRebuildReport {
        scanned_attempts: attempt_ids.len() as u32,
        ..Default::default()
    };
    for attempt_id in attempt_ids {
        let attempt = crate::history::load_attempt(conn, &attempt_id)?;
        let projection = project_reading_attempt_events(conn, &attempt)?;
        report.expected_events += projection.expected;
        report.inserted_events += projection.inserted;
        report.existing_events += projection.existing;
    }
    Ok(report)
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningEventsRebuildReport {
    pub scanned_attempts: u32,
    pub expected_events: u32,
    pub inserted_events: u32,
    pub existing_events: u32,
}

fn reading_projection_events(
    conn: &Connection,
    attempt: &AttemptRecord,
) -> DbResult<Vec<NewLearningEvent>> {
    if attempt.activity != Activity::Reading || attempt.status != AttemptStatus::Completed {
        return Err(DbError::Validation(
            "learning event projection requires a completed reading attempt".into(),
        ));
    }
    let asset_id = attempt
        .asset_id
        .as_deref()
        .filter(|asset_id| !asset_id.trim().is_empty())
        .ok_or_else(|| DbError::Validation("completed reading attempt has no asset".into()))?;
    let occurred_at = attempt
        .completed_at
        .as_deref()
        .or(attempt.submitted_at.as_deref())
        .ok_or_else(|| {
            DbError::Validation("completed reading attempt has no terminal time".into())
        })?;
    let (ordinal, gap_hours) = attempt_ordinal_and_gap(conn, attempt)?;
    let timeline = json!({
        "answeredCount": attempt.answers.len(),
        "markedCount": attempt.answers.iter().filter(|answer| answer.marked).count(),
        "changeCount": attempt.answers.iter().map(|answer| answer.change_count).sum::<u32>(),
        "visitCount": attempt.answers.iter().map(|answer| answer.visit_count).sum::<u32>(),
        "questionElapsedMs": attempt.answers.iter().map(|answer| answer.elapsed_ms).sum::<u64>(),
    });
    let mut events = Vec::with_capacity(attempt.answers.len() + 1);
    events.push(NewLearningEvent::reading_attempt_completed(
        &attempt.id,
        asset_id,
        json!({
            "attemptId": attempt.id,
            "assetId": asset_id,
            "attemptOrdinal": ordinal,
            "gapHours": gap_hours,
            "correctCount": attempt.correct_count,
            "questionCount": attempt.question_count,
            "scoreValue": attempt.score_value,
            "durationMs": attempt.duration_ms,
            "mode": reading_mode(attempt),
            "timelineSummary": timeline,
        }),
        occurred_at.to_string(),
    ));
    for answer in &attempt.answers {
        events.push(NewLearningEvent::reading_question_outcome(
            &attempt.id,
            asset_id,
            &answer.question_id,
            json!({
                "attemptId": attempt.id,
                "assetId": asset_id,
                "questionId": answer.question_id,
                "skillKey": Value::Null,
                "attemptOrdinal": ordinal,
                "isCorrect": answer.is_correct,
                "questionKind": answer.question_kind,
                "changeCount": answer.change_count,
                "visitCount": answer.visit_count,
                "elapsedMs": answer.elapsed_ms,
                "marked": answer.marked,
                "firstTryCorrect": answer.is_correct.map(|correct| correct && answer.change_count == 0),
            }),
            occurred_at.to_string(),
        ));
    }
    Ok(events)
}

fn completed_reading_attempt_ids(conn: &Connection, limit: u32) -> DbResult<Vec<String>> {
    let limit = i64::from(limit.clamp(1, 10_000));
    let mut statement = conn.prepare(
        "SELECT id FROM attempts
         WHERE activity = 'reading' AND status = 'completed'
         ORDER BY COALESCE(completed_at, submitted_at, started_at), id LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn expected_reading_events(conn: &Connection, limit: u32) -> DbResult<BTreeMap<String, String>> {
    let mut expected = BTreeMap::new();
    for attempt_id in completed_reading_attempt_ids(conn, limit)? {
        let attempt = crate::history::load_attempt(conn, &attempt_id)?;
        for event in reading_projection_events(conn, &attempt)? {
            let payload_json = serde_json::to_string(&event.payload)
                .map_err(|error| DbError::Message(error.to_string()))?;
            expected.insert(
                event_key(
                    event.event_type,
                    event.source_id.as_deref(),
                    event.schema_version,
                ),
                sha256_hex(&payload_json),
            );
        }
    }
    Ok(expected)
}

fn attempt_ordinal_and_gap(
    conn: &Connection,
    attempt: &AttemptRecord,
) -> DbResult<(u32, Option<f64>)> {
    let asset_id = attempt.asset_id.as_deref().unwrap_or_default();
    let terminal_at = attempt
        .completed_at
        .as_deref()
        .or(attempt.submitted_at.as_deref())
        .unwrap_or(&attempt.started_at);
    let ordinal = conn.query_row(
        "SELECT COUNT(*) FROM attempts
         WHERE activity = 'reading' AND status = 'completed' AND asset_id = ?1
           AND (COALESCE(completed_at,submitted_at,started_at) < ?2
                OR (COALESCE(completed_at,submitted_at,started_at) = ?2 AND id <= ?3))",
        params![asset_id, terminal_at, attempt.id],
        |row| row.get::<_, i64>(0),
    )?;
    let previous: Option<String> = conn
        .query_row(
            "SELECT COALESCE(completed_at,submitted_at,started_at) FROM attempts
             WHERE activity = 'reading' AND status = 'completed' AND asset_id = ?1 AND id != ?2
               AND (COALESCE(completed_at,submitted_at,started_at) < ?3
                    OR (COALESCE(completed_at,submitted_at,started_at) = ?3 AND id < ?2))
             ORDER BY COALESCE(completed_at,submitted_at,started_at) DESC,id DESC LIMIT 1",
            params![asset_id, attempt.id, terminal_at],
            |row| row.get(0),
        )
        .optional()?;
    let gap_hours = previous.as_deref().and_then(|previous| {
        let previous = chrono::DateTime::parse_from_rfc3339(previous).ok()?;
        let current = chrono::DateTime::parse_from_rfc3339(terminal_at).ok()?;
        Some((current - previous).num_seconds() as f64 / 3600.0)
    });
    Ok((ordinal.max(0) as u32, gap_hours))
}

fn reading_mode(attempt: &AttemptRecord) -> &'static str {
    use ielts_domain::AttemptMode;
    match attempt.mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

fn load_by_key(conn: &Connection, key: &str) -> DbResult<Option<LearningEvent>> {
    conn.query_row("SELECT id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,attempt_id,question_id,skill_key,occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at FROM learning_events WHERE idempotency_key = ?1", params![key], map_event).optional().map_err(Into::into)
}

fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearningEvent> {
    let event_type: String = row.get(2)?;
    let payload: String = row.get(12)?;
    Ok(LearningEvent {
        id: row.get(0)?,
        user_id: row.get(1)?,
        event_type: parse_event_type(&event_type).map_err(to_sql_error)?,
        source_kind: row.get(3)?,
        source_id: row.get(4)?,
        idempotency_key: row.get(5)?,
        activity: row.get(6)?,
        asset_id: row.get(7)?,
        attempt_id: row.get(8)?,
        question_id: row.get(9)?,
        skill_key: row.get(10)?,
        occurred_at: row.get(11)?,
        payload: serde_json::from_str(&payload)
            .map_err(|error| to_sql_error(DbError::Message(error.to_string())))?,
        content_hash: row.get(13)?,
        schema_version: row.get(14)?,
        consolidation_state: row.get(15)?,
        sensitivity: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

fn parse_event_type(value: &str) -> DbResult<LearningEventType> {
    match value {
        "attempt_started" => Ok(LearningEventType::AttemptStarted),
        "answer_changed" => Ok(LearningEventType::AnswerChanged),
        "attempt_submitted" => Ok(LearningEventType::AttemptSubmitted),
        "attempt_completed" => Ok(LearningEventType::AttemptCompleted),
        "reading_question_outcome" => Ok(LearningEventType::ReadingQuestionOutcome),
        "writing_evaluation_completed" => Ok(LearningEventType::WritingEvaluationCompleted),
        "coach_question_asked" => Ok(LearningEventType::CoachQuestionAsked),
        "coach_response_generated" => Ok(LearningEventType::CoachResponseGenerated),
        "coach_feedback_provided" => Ok(LearningEventType::CoachFeedbackProvided),
        "vocabulary_review_completed" => Ok(LearningEventType::VocabularyReviewCompleted),
        "annotation_created" => Ok(LearningEventType::AnnotationCreated),
        other => Err(DbError::Message(format!(
            "unknown learning event type: {other}"
        ))),
    }
}

fn to_sql_error(error: DbError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
