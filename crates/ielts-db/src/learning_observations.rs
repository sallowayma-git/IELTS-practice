//! Deterministic M2 projection from the immutable learning-event ledger.
//!
//! This module deliberately has no model, network, Coach, or business-record
//! write path. The three observation tables are derived state: they can be
//! deleted and rebuilt from `learning_events` at any time.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};
use ielts_domain::{question_transition_state, LearningEventType};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::sqlite::{DbError, DbResult};

pub const LEARNING_OBSERVATION_PROJECTOR_KEY: &str = "learning_observation_v1";
pub const LEARNING_OBSERVATION_PROJECTOR_VERSION: i64 = 2;
const SHORT_REPEAT_GAP_HOURS: f64 = 24.0;
const PROJECTION_SUCCESS_RETENTION: i64 = 20;
const PROJECTION_ERROR_RETENTION: i64 = 5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerObservation {
    pub id: String,
    pub user_id: String,
    pub observation_type: String,
    pub namespace: String,
    pub scope_kind: String,
    pub scope_key: String,
    pub polarity: Option<String>,
    pub value_num: Option<f64>,
    pub value_text: Option<String>,
    pub payload: Value,
    pub confidence: f64,
    pub evidence_strength: f64,
    pub observed_at: String,
    pub projector_key: String,
    pub projector_version: i64,
    pub source_fingerprint: String,
    pub evidence: Vec<ObservationEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationEvidence {
    pub event_id: String,
    pub evidence_role: String,
    pub ordinal: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningObservationsRebuildReport {
    pub projector_key: String,
    pub projector_version: i64,
    pub run_id: String,
    pub status: String,
    pub input_count: u64,
    pub output_count: u64,
    pub skipped_sensitive: u64,
    pub quarantined: u64,
    pub quarantined_event_ids: Vec<String>,
    pub input_hash: String,
    pub output_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningObservationsVerifyReport {
    pub projector_key: String,
    pub projector_version: i64,
    pub consistent: bool,
    pub input_count: u64,
    pub stored_count: u64,
    pub expected_count: u64,
    pub skipped_sensitive: u64,
    pub quarantined: u64,
    pub input_hash: String,
    pub stored_output_hash: String,
    pub expected_output_hash: String,
    pub mismatches: Vec<String>,
}

#[derive(Debug, Clone)]
struct LedgerEvent {
    id: String,
    user_id: String,
    event_type: Option<LearningEventType>,
    event_type_raw: String,
    source_id: Option<String>,
    activity: Option<String>,
    asset_id: Option<String>,
    attempt_id: Option<String>,
    question_id: Option<String>,
    occurred_at: String,
    payload: Value,
    payload_valid: bool,
    content_hash: String,
    schema_version: i64,
    sensitivity: String,
}

#[derive(Debug, Clone)]
struct RawLedgerEvent {
    id: String,
    user_id: String,
    event_type_raw: String,
    source_id: Option<String>,
    activity: Option<String>,
    asset_id: Option<String>,
    attempt_id: Option<String>,
    question_id: Option<String>,
    occurred_at: String,
    payload_json: String,
    content_hash: String,
    schema_version: i64,
    sensitivity: String,
}

#[derive(Debug, Clone)]
struct ObservationRecord {
    id: String,
    user_id: String,
    observation_type: String,
    namespace: String,
    scope_kind: String,
    scope_key: String,
    polarity: Option<String>,
    value_num: Option<f64>,
    value_text: Option<String>,
    payload: Value,
    confidence: f64,
    evidence_strength: f64,
    observed_at: String,
    source_fingerprint: String,
    evidence: Vec<ObservationEvidence>,
}

#[derive(Debug, Clone)]
struct ObservationCandidate {
    user_id: String,
    observation_type: String,
    namespace: String,
    scope_kind: String,
    scope_key: String,
    polarity: Option<String>,
    value_num: Option<f64>,
    value_text: Option<String>,
    payload: Value,
    confidence: f64,
    evidence_strength: f64,
    observed_at: String,
    evidence_ids: Vec<String>,
}

#[derive(Debug, Default)]
struct ProjectionBuild {
    records: Vec<ObservationRecord>,
    skipped_sensitive: u64,
    quarantined_event_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct ReadingQuestionEvent {
    event: LedgerEvent,
    attempt_id: String,
    asset_id: String,
    question_id: String,
    is_correct: Option<bool>,
    attempt_ordinal: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingAttemptPayload {
    attempt_id: String,
    asset_id: String,
    attempt_ordinal: u64,
    #[serde(default)]
    correct_count: Option<f64>,
    #[serde(default)]
    question_count: Option<u32>,
    score_value: Option<f64>,
    duration_ms: u64,
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingQuestionPayload {
    attempt_id: String,
    asset_id: String,
    question_id: String,
    attempt_ordinal: u64,
    #[serde(default)]
    is_correct: Option<bool>,
    #[serde(default)]
    question_kind: Option<String>,
    change_count: u64,
    visit_count: u64,
    elapsed_ms: u64,
    #[serde(default)]
    first_try_correct: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingScorePayload {
    overall: f64,
    task_response: f64,
    coherence: f64,
    lexical: f64,
    grammar: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingDegradationPayload {
    stage: String,
    reason: String,
    missing: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingEvaluationPayload {
    evaluation_id: String,
    attempt_id: String,
    status: String,
    stage: String,
    #[serde(default)]
    task_type: Option<String>,
    #[serde(default)]
    score: Option<WritingScorePayload>,
    #[serde(default)]
    degradation: Option<WritingDegradationPayload>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoachPayload {
    message_id: String,
    thread_id: String,
    role: String,
    sequence: u64,
    #[serde(default)]
    question_context: Option<String>,
}

/// Rebuild all M2 observations from the ledger in one transaction.
pub fn learning_observations_rebuild(
    conn: &Connection,
) -> DbResult<LearningObservationsRebuildReport> {
    let started_at = Utc::now().to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let result = learning_observations_rebuild_in_transaction(&tx);
    match result {
        Ok(report) => {
            if let Err(error) = tx.commit() {
                let error = DbError::from(error);
                let _ = record_failed_projection_run(conn, &started_at, &error);
                return Err(error);
            }
            Ok(report)
        }
        Err(error) => {
            drop(tx);
            let _ = record_failed_projection_run(conn, &started_at, &error);
            Err(error)
        }
    }
}

/// Rebuild the derived rows inside a caller-owned transaction.
///
/// History deletion uses this boundary so deleting a middle attempt can
/// rebuild the now-adjacent repeat transition before the business transaction
/// commits.
pub(crate) fn learning_observations_rebuild_in_transaction(
    conn: &Connection,
) -> DbResult<LearningObservationsRebuildReport> {
    let events = load_ledger_events(conn)?;
    let input_hash = input_hash(&events);
    let build = build_projection(&events);

    // This projector owns only its versioned rows. Delete the parent first so
    // SQLite cascades its evidence, then clear legacy orphan evidence without
    // touching rows owned by another projector.
    conn.execute(
        "DELETE FROM learner_observations WHERE projector_key = ?1",
        params![LEARNING_OBSERVATION_PROJECTOR_KEY],
    )?;
    conn.execute(
        "DELETE FROM learner_observation_evidence
         WHERE NOT EXISTS (
           SELECT 1 FROM learner_observations o
           WHERE o.id = learner_observation_evidence.observation_id
         )",
        [],
    )?;
    insert_records(conn, &build.records)?;

    let output_hash = output_hash(&build.records);
    let run_id = format!("lpr-{}", uuid::Uuid::new_v4());
    let started_at = Utc::now().to_rfc3339();
    let finished_at = Utc::now().to_rfc3339();
    let error_json = issue_json(&build);
    conn.execute(
        "INSERT INTO learning_projection_runs
         (id, projector_key, projector_version, status, input_count, output_count,
          input_hash, output_hash, started_at, finished_at, error_json)
         VALUES (?1, ?2, ?3, 'completed', ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run_id,
            LEARNING_OBSERVATION_PROJECTOR_KEY,
            LEARNING_OBSERVATION_PROJECTOR_VERSION,
            events.len() as i64,
            build.records.len() as i64,
            input_hash,
            output_hash,
            started_at,
            finished_at,
            error_json,
        ],
    )?;
    prune_projection_runs(conn)?;
    Ok(LearningObservationsRebuildReport {
        projector_key: LEARNING_OBSERVATION_PROJECTOR_KEY.into(),
        projector_version: LEARNING_OBSERVATION_PROJECTOR_VERSION,
        run_id,
        status: "completed".into(),
        input_count: events.len() as u64,
        output_count: build.records.len() as u64,
        skipped_sensitive: build.skipped_sensitive,
        quarantined: build.quarantined_event_ids.len() as u64,
        quarantined_event_ids: build.quarantined_event_ids,
        input_hash,
        output_hash,
    })
}

/// Verify the current derived rows against a fresh deterministic projection.
pub fn learning_observations_verify(
    conn: &Connection,
) -> DbResult<LearningObservationsVerifyReport> {
    let events = load_ledger_events(conn)?;
    let input_hash = input_hash(&events);
    let build = build_projection(&events);
    let stored = load_stored_records(conn)?;
    let expected_output_hash = output_hash(&build.records);
    let stored_output_hash = output_hash(&stored);
    let mut mismatches = Vec::new();

    if stored.len() != build.records.len() {
        mismatches.push(format!(
            "count mismatch: stored={}, expected={}",
            stored.len(),
            build.records.len()
        ));
    }
    if stored_output_hash != expected_output_hash {
        mismatches.push("output hash mismatch".into());
    }

    let expected_ids = build
        .records
        .iter()
        .map(|record| record.id.as_str())
        .collect::<BTreeSet<_>>();
    let stored_ids = stored
        .iter()
        .map(|record| record.id.as_str())
        .collect::<BTreeSet<_>>();
    for id in expected_ids.difference(&stored_ids).take(20) {
        mismatches.push(format!("missing observation: {id}"));
    }
    for id in stored_ids.difference(&expected_ids).take(20) {
        mismatches.push(format!("unexpected observation: {id}"));
    }

    Ok(LearningObservationsVerifyReport {
        projector_key: LEARNING_OBSERVATION_PROJECTOR_KEY.into(),
        projector_version: LEARNING_OBSERVATION_PROJECTOR_VERSION,
        consistent: mismatches.is_empty(),
        input_count: events.len() as u64,
        stored_count: stored.len() as u64,
        expected_count: build.records.len() as u64,
        skipped_sensitive: build.skipped_sensitive,
        quarantined: build.quarantined_event_ids.len() as u64,
        input_hash,
        stored_output_hash,
        expected_output_hash,
        mismatches,
    })
}

fn load_ledger_events(conn: &Connection) -> DbResult<Vec<LedgerEvent>> {
    let mut statement = conn.prepare(
        "SELECT id, user_id, event_type, source_id, activity, asset_id, attempt_id, question_id,
                occurred_at, payload_json, content_hash, schema_version, sensitivity
         FROM learning_events
         ORDER BY occurred_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(RawLedgerEvent {
            id: row.get(0)?,
            user_id: row.get(1)?,
            event_type_raw: row.get(2)?,
            source_id: row.get(3)?,
            activity: row.get(4)?,
            asset_id: row.get(5)?,
            attempt_id: row.get(6)?,
            question_id: row.get(7)?,
            occurred_at: row.get(8)?,
            payload_json: row.get(9)?,
            content_hash: row.get(10)?,
            schema_version: row.get(11)?,
            sensitivity: row.get(12)?,
        })
    })?;
    let raw = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(raw
        .into_iter()
        .map(|event| {
            let (payload, parsed) = match serde_json::from_str::<Value>(&event.payload_json) {
                Ok(payload) => (payload, true),
                Err(_) => (Value::Null, false),
            };
            let payload_valid = parsed && sha256_hex(&event.payload_json) == event.content_hash;
            LedgerEvent {
                id: event.id,
                user_id: event.user_id,
                event_type: parse_event_type(&event.event_type_raw),
                event_type_raw: event.event_type_raw,
                source_id: event.source_id,
                activity: event.activity,
                asset_id: event.asset_id,
                attempt_id: event.attempt_id,
                question_id: event.question_id,
                occurred_at: event.occurred_at,
                payload,
                payload_valid,
                content_hash: event.content_hash,
                schema_version: event.schema_version,
                sensitivity: event.sensitivity,
            }
        })
        .collect())
}

fn build_projection(events: &[LedgerEvent]) -> ProjectionBuild {
    let mut candidates = Vec::new();
    let mut reading_events = Vec::new();
    let mut quarantined = BTreeSet::new();
    let mut skipped_sensitive = 0;

    for event in events {
        if event.sensitivity != "normal" {
            skipped_sensitive += 1;
            continue;
        }
        let projected_event = matches!(
            event.event_type,
            Some(LearningEventType::AttemptCompleted)
                | Some(LearningEventType::ReadingQuestionOutcome)
                | Some(LearningEventType::WritingEvaluationCompleted)
                | Some(LearningEventType::CoachQuestionAsked)
                | Some(LearningEventType::CoachResponseGenerated)
        );
        if projected_event && event.schema_version != LearningEventType::SCHEMA_VERSION {
            quarantined.insert(event.id.clone());
            continue;
        }
        let result = match event.event_type {
            Some(LearningEventType::AttemptCompleted) => project_reading_attempt(event),
            Some(LearningEventType::ReadingQuestionOutcome) => {
                let result = project_reading_question(event);
                if result.is_ok() {
                    if let Ok(payload) = decode_payload::<ReadingQuestionPayload>(event) {
                        reading_events.push(ReadingQuestionEvent {
                            event: event.clone(),
                            attempt_id: payload.attempt_id,
                            asset_id: payload.asset_id,
                            question_id: payload.question_id,
                            is_correct: payload.is_correct,
                            attempt_ordinal: payload.attempt_ordinal,
                        });
                    }
                }
                result
            }
            Some(LearningEventType::WritingEvaluationCompleted) => project_writing(event),
            Some(LearningEventType::CoachQuestionAsked)
            | Some(LearningEventType::CoachResponseGenerated) => project_coach(event),
            _ => Ok(Vec::new()),
        };
        match result {
            Ok(mut values) => candidates.append(&mut values),
            Err(_) => {
                quarantined.insert(event.id.clone());
            }
        }
    }

    candidates.extend(project_reading_repeats(&reading_events));
    let mut records = BTreeMap::new();
    for candidate in candidates {
        let record = materialize(candidate);
        records.entry(record.id.clone()).or_insert(record);
    }

    ProjectionBuild {
        records: records.into_values().collect(),
        skipped_sensitive,
        quarantined_event_ids: quarantined.into_iter().collect(),
    }
}

fn project_reading_attempt(event: &LedgerEvent) -> Result<Vec<ObservationCandidate>, String> {
    if event.activity.as_deref() != Some("reading") {
        return Ok(Vec::new());
    }
    let payload: ReadingAttemptPayload = decode_payload(event)?;
    validate_reading_attempt_payload(event, &payload)?;
    let Some(score) = payload.score_value else {
        return Ok(Vec::new());
    };
    let asset_id = payload.asset_id.clone();
    let attempt_id = payload.attempt_id.clone();
    Ok(vec![candidate(
        event,
        vec![event.id.clone()],
        "reading.attempt.score",
        "reading",
        "asset",
        asset_id.clone(),
        None,
        Some(score),
        None,
        json!({
            "attemptId": attempt_id,
            "assetId": asset_id,
            "attemptOrdinal": payload.attempt_ordinal,
            "correctCount": payload.correct_count,
            "questionCount": payload.question_count,
            "durationMs": payload.duration_ms,
            "mode": payload.mode,
        }),
    )])
}

fn project_reading_question(event: &LedgerEvent) -> Result<Vec<ObservationCandidate>, String> {
    let payload: ReadingQuestionPayload = decode_payload(event)?;
    validate_reading_question_payload(event, &payload)?;
    let asset_id = payload.asset_id.clone();
    let question_id = payload.question_id.clone();
    let is_correct = payload.is_correct;
    let question_kind = payload.question_kind.clone();
    let change_count = payload.change_count;
    let visit_count = payload.visit_count;
    let elapsed_ms = payload.elapsed_ms;
    let first_try_correct = payload.first_try_correct;
    let scope_key = format!("{asset_id}:{question_id}");
    let base_payload = json!({
        "eventId": event.id,
        "attemptId": payload.attempt_id,
        "assetId": asset_id,
        "questionId": question_id,
        "attemptOrdinal": payload.attempt_ordinal,
        "questionKind": question_kind,
        "isCorrect": is_correct,
        "firstTryCorrect": first_try_correct,
    });
    let outcome = match is_correct {
        Some(true) => (Some("positive".into()), Some(1.0), "correct"),
        Some(false) => (Some("negative".into()), Some(0.0), "incorrect"),
        None => (None, None, "unscored"),
    };
    Ok(vec![
        candidate(
            event,
            vec![event.id.clone()],
            "reading.question.outcome",
            "reading",
            "question",
            scope_key.clone(),
            outcome.0,
            outcome.1,
            Some(outcome.2.into()),
            base_payload.clone(),
        ),
        candidate(
            event,
            vec![event.id.clone()],
            "reading.question.answer_change_count",
            "reading",
            "question",
            scope_key.clone(),
            None,
            Some(change_count as f64),
            None,
            json!({"eventId": event.id, "questionId": question_id, "changeCount": change_count}),
        ),
        candidate(
            event,
            vec![event.id.clone()],
            "reading.question.visit_count",
            "reading",
            "question",
            scope_key.clone(),
            None,
            Some(visit_count as f64),
            None,
            json!({"eventId": event.id, "questionId": question_id, "visitCount": visit_count}),
        ),
        candidate(
            event,
            vec![event.id.clone()],
            "reading.question.elapsed_ms",
            "reading",
            "question",
            scope_key,
            None,
            Some(elapsed_ms as f64),
            None,
            json!({"eventId": event.id, "questionId": question_id, "elapsedMs": elapsed_ms}),
        ),
    ])
}

fn project_writing(event: &LedgerEvent) -> Result<Vec<ObservationCandidate>, String> {
    let payload: WritingEvaluationPayload = decode_payload(event)?;
    validate_writing_payload(event, &payload)?;
    let status = payload.status.to_ascii_lowercase();
    let attempt_id = payload.attempt_id.clone();
    let task_type = payload.task_type.clone();
    let stage = payload.stage.to_ascii_lowercase();
    let provider_id = payload.provider_id.clone();
    let model = payload.model.clone();
    let status_payload = json!({
        "eventId": event.id,
        "evaluationId": payload.evaluation_id,
        "attemptId": attempt_id,
        "status": status,
        "stage": stage,
        "taskType": task_type,
        "providerId": provider_id,
        "model": model,
    });
    let mut output = vec![candidate(
        event,
        vec![event.id.clone()],
        "writing.evaluation.status",
        "writing",
        "attempt",
        attempt_id.clone(),
        None,
        None,
        Some(status.clone()),
        status_payload,
    )];

    if matches!(status.as_str(), "completed" | "degraded") {
        if let Some(score) = payload.score.as_ref() {
            for (field, observation_type) in [
                ("overall", "writing.evaluation.overall_band"),
                ("taskResponse", "writing.evaluation.criterion_score"),
                ("coherence", "writing.evaluation.criterion_score"),
                ("lexical", "writing.evaluation.criterion_score"),
                ("grammar", "writing.evaluation.criterion_score"),
            ] {
                let value = writing_score_value(score, field);
                let scope_kind = if field == "overall" {
                    "attempt"
                } else {
                    "criterion"
                };
                let scope_key = if field == "overall" {
                    attempt_id.clone()
                } else {
                    format!("{attempt_id}:{field}")
                };
                output.push(candidate(
                    event,
                    vec![event.id.clone()],
                    observation_type,
                    "writing",
                    scope_kind,
                    scope_key,
                    None,
                    Some(value),
                    Some(field.into()),
                    json!({"eventId": event.id, "attemptId": attempt_id, "criterion": field, "taskType": task_type}),
                ));
            }
        }
    }

    if status == "degraded" {
        let degradation = payload
            .degradation
            .as_ref()
            .ok_or_else(|| "degraded writing evaluation has no degradation object".to_string())?;
        let category = degradation_category(degradation)?;
        output.push(candidate(
            event,
            vec![event.id.clone()],
            "writing.evaluation.degraded",
            "writing",
            "attempt",
            attempt_id,
            Some("degraded".into()),
            None,
            Some(category.to_string()),
            json!({
                "eventId": event.id,
                "category": category,
                "stage": degradation.stage,
                "taskType": task_type,
            }),
        ));
    }
    Ok(output)
}

fn project_coach(event: &LedgerEvent) -> Result<Vec<ObservationCandidate>, String> {
    let payload: CoachPayload = decode_payload(event)?;
    validate_coach_payload(event, &payload)?;
    let thread_id = payload.thread_id.clone();
    let observation_type = match event.event_type {
        Some(LearningEventType::CoachQuestionAsked) => "coach.question.asked",
        Some(LearningEventType::CoachResponseGenerated) => "coach.response.generated",
        _ => return Ok(Vec::new()),
    };
    Ok(vec![candidate(
        event,
        vec![event.id.clone()],
        observation_type,
        "coach",
        "thread",
        thread_id.clone(),
        None,
        Some(1.0),
        None,
        json!({
            "eventId": event.id,
            "messageId": payload.message_id,
            "threadId": thread_id,
            "attemptId": event.attempt_id,
            "assetId": event.asset_id,
            "questionId": payload.question_context,
            "sequence": payload.sequence,
        }),
    )])
}

fn project_reading_repeats(events: &[ReadingQuestionEvent]) -> Vec<ObservationCandidate> {
    let mut grouped: BTreeMap<(String, String, String), Vec<ReadingQuestionEvent>> =
        BTreeMap::new();
    for question in events {
        grouped
            .entry((
                question.event.user_id.clone(),
                question.asset_id.clone(),
                question.question_id.clone(),
            ))
            .or_default()
            .push(question.clone());
    }

    let mut output = Vec::new();
    for ((_user_id, asset_id, question_id), mut observations) in grouped {
        observations.sort_by(|left, right| {
            left.attempt_ordinal
                .cmp(&right.attempt_ordinal)
                .then_with(|| left.attempt_id.cmp(&right.attempt_id))
                .then_with(|| left.event.occurred_at.cmp(&right.event.occurred_at))
                .then_with(|| left.event.id.cmp(&right.event.id))
        });
        let mut last_scored: Option<ReadingQuestionEvent> = None;
        for current in observations {
            let Some(current_is_correct) = current.is_correct else {
                // Keep the unscored observation in the base stream, but never
                // let it replace the last scored state used for transitions.
                continue;
            };
            let previous = last_scored.clone();
            let state = question_transition_state(
                previous.as_ref().and_then(|event| event.is_correct),
                Some(current_is_correct),
            );
            last_scored = Some(current.clone());
            let Some(previous) = previous else {
                continue;
            };
            let Some(observation_type) = (match state {
                "corrected" => Some("reading.repeat.corrected"),
                "still_wrong" => Some("reading.repeat.still_wrong"),
                "newly_wrong" => Some("reading.repeat.newly_wrong"),
                "still_correct" => Some("reading.repeat.still_correct"),
                _ => None,
            }) else {
                continue;
            };
            let gap_hours = gap_hours(&previous.event.occurred_at, &current.event.occurred_at);
            let familiarity_risk =
                gap_hours.is_some_and(|gap| gap >= 0.0 && gap < SHORT_REPEAT_GAP_HOURS);
            let polarity = if matches!(state, "corrected" | "still_correct") {
                Some("positive".into())
            } else {
                Some("negative".into())
            };
            output.push(candidate(
                &current.event,
                vec![previous.event.id.clone(), current.event.id.clone()],
                observation_type,
                "reading",
                "question",
                format!("{asset_id}:{question_id}"),
                polarity,
                None,
                Some(state.into()),
                json!({
                    "previousEventId": previous.event.id,
                    "currentEventId": current.event.id,
                    "previousAttemptId": previous.attempt_id,
                    "currentAttemptId": current.attempt_id,
                    "assetId": asset_id,
                    "questionId": question_id,
                    "previousCorrect": previous.is_correct,
                    "currentCorrect": current.is_correct,
                    "gapHours": gap_hours,
                    "familiarityRisk": familiarity_risk,
                }),
            ));
        }
    }
    output
}

fn candidate(
    event: &LedgerEvent,
    evidence_ids: Vec<String>,
    observation_type: &str,
    namespace: &str,
    scope_kind: &str,
    scope_key: String,
    polarity: Option<String>,
    value_num: Option<f64>,
    value_text: Option<String>,
    payload: Value,
) -> ObservationCandidate {
    let mut seen = BTreeSet::new();
    let evidence_ids = evidence_ids
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect();
    ObservationCandidate {
        user_id: event.user_id.clone(),
        observation_type: observation_type.into(),
        namespace: namespace.into(),
        scope_kind: scope_kind.into(),
        scope_key,
        polarity,
        value_num,
        value_text,
        payload,
        confidence: 1.0,
        evidence_strength: 1.0,
        observed_at: event.occurred_at.clone(),
        evidence_ids,
    }
}

fn materialize(candidate: ObservationCandidate) -> ObservationRecord {
    let observation_key = canonical_json(&json!({
        "userId": candidate.user_id,
        "observationType": candidate.observation_type,
        "namespace": candidate.namespace,
        "scopeKind": candidate.scope_kind,
        "scopeKey": candidate.scope_key,
        "polarity": candidate.polarity,
        "valueNum": candidate.value_num,
        "valueText": candidate.value_text,
    }));
    let evidence_key = candidate
        .evidence_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(",");
    let source_fingerprint = sha256_hex(&format!(
        "{}|v{}|{}|{}",
        LEARNING_OBSERVATION_PROJECTOR_KEY,
        LEARNING_OBSERVATION_PROJECTOR_VERSION,
        evidence_key,
        observation_key
    ));
    let id = format!("obs-{source_fingerprint}");
    let evidence = candidate
        .evidence_ids
        .into_iter()
        .enumerate()
        .map(|(ordinal, event_id)| ObservationEvidence {
            event_id,
            evidence_role: "support".into(),
            ordinal: ordinal as i64,
        })
        .collect();
    ObservationRecord {
        id,
        user_id: candidate.user_id,
        observation_type: candidate.observation_type,
        namespace: candidate.namespace,
        scope_kind: candidate.scope_kind,
        scope_key: candidate.scope_key,
        polarity: candidate.polarity,
        value_num: candidate.value_num,
        value_text: candidate.value_text,
        payload: candidate.payload,
        confidence: candidate.confidence,
        evidence_strength: candidate.evidence_strength,
        observed_at: candidate.observed_at,
        source_fingerprint,
        evidence,
    }
}

fn insert_records(conn: &Connection, records: &[ObservationRecord]) -> DbResult<()> {
    let created_at = Utc::now().to_rfc3339();
    let mut observation_statement = conn.prepare(
        "INSERT INTO learner_observations
         (id, user_id, observation_type, namespace, scope_kind, scope_key, polarity,
          value_num, value_text, payload_json, confidence, evidence_strength, observed_at,
          projector_key, projector_version, source_fingerprint, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(projector_key, projector_version, source_fingerprint) DO UPDATE SET
           user_id = excluded.user_id,
           observation_type = excluded.observation_type,
           namespace = excluded.namespace,
           scope_kind = excluded.scope_kind,
           scope_key = excluded.scope_key,
           polarity = excluded.polarity,
           value_num = excluded.value_num,
           value_text = excluded.value_text,
           payload_json = excluded.payload_json,
           confidence = excluded.confidence,
           evidence_strength = excluded.evidence_strength,
           observed_at = excluded.observed_at",
    )?;
    let mut evidence_statement = conn.prepare(
        "INSERT OR IGNORE INTO learner_observation_evidence
         (observation_id, event_id, evidence_role, ordinal)
         VALUES (?1, ?2, ?3, ?4)",
    )?;
    for record in records {
        observation_statement.execute(
            params![
                record.id,
                record.user_id,
                record.observation_type,
                record.namespace,
                record.scope_kind,
                record.scope_key,
                record.polarity,
                record.value_num,
                record.value_text,
                canonical_json(&record.payload),
                record.confidence,
                record.evidence_strength,
                record.observed_at,
                LEARNING_OBSERVATION_PROJECTOR_KEY,
                LEARNING_OBSERVATION_PROJECTOR_VERSION,
                record.source_fingerprint,
                created_at,
            ],
        )?;
        for evidence in &record.evidence {
            evidence_statement.execute(
                params![
                    record.id,
                    evidence.event_id,
                    evidence.evidence_role,
                    evidence.ordinal,
                ],
            )?;
        }
    }
    Ok(())
}

fn load_stored_records(conn: &Connection) -> DbResult<Vec<ObservationRecord>> {
    let mut records = {
        let mut statement = conn.prepare(
            "SELECT id, user_id, observation_type, namespace, scope_kind, scope_key, polarity,
                    value_num, value_text, payload_json, confidence, evidence_strength, observed_at,
                    source_fingerprint
             FROM learner_observations
             WHERE projector_key = ?1
             ORDER BY id",
        )?;
        let rows = statement.query_map(params![LEARNING_OBSERVATION_PROJECTOR_KEY], |row| {
            let payload_json: String = row.get(9)?;
            Ok(ObservationRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                observation_type: row.get(2)?,
                namespace: row.get(3)?,
                scope_kind: row.get(4)?,
                scope_key: row.get(5)?,
                polarity: row.get(6)?,
                value_num: row.get(7)?,
                value_text: row.get(8)?,
                payload: serde_json::from_str(&payload_json)
                    .unwrap_or_else(|_| Value::String(payload_json)),
                confidence: row.get(10)?,
                evidence_strength: row.get(11)?,
                observed_at: row.get(12)?,
                source_fingerprint: row.get(13)?,
                evidence: Vec::new(),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let mut statement = conn.prepare(
        "SELECT evidence.observation_id, evidence.event_id, evidence.evidence_role, evidence.ordinal
         FROM learner_observation_evidence AS evidence
         INNER JOIN learner_observations AS observation
           ON observation.id = evidence.observation_id
         WHERE observation.projector_key = ?1
         ORDER BY evidence.observation_id, evidence.ordinal, evidence.event_id, evidence.evidence_role",
    )?;
    let rows = statement.query_map(params![LEARNING_OBSERVATION_PROJECTOR_KEY], |row| {
        Ok((
            row.get::<_, String>(0)?,
            ObservationEvidence {
                event_id: row.get(1)?,
                evidence_role: row.get(2)?,
                ordinal: row.get(3)?,
            },
        ))
    })?;
    let mut record_index = 0_usize;
    for row in rows {
        let (observation_id, evidence) = row?;
        while record_index < records.len() && records[record_index].id < observation_id {
            record_index += 1;
        }
        let Some(record) = records.get_mut(record_index) else {
            return Err(DbError::Message(format!(
                "evidence references unowned observation {observation_id}"
            )));
        };
        if record.id != observation_id {
            return Err(DbError::Message(format!(
                "evidence references missing observation {observation_id}"
            )));
        }
        record.evidence.push(evidence);
    }
    Ok(records)
}

fn input_hash(events: &[LedgerEvent]) -> String {
    let mut rows = events
        .iter()
        .map(|event| {
            json!({
                "id": event.id,
                "userId": event.user_id,
                "eventType": event.event_type_raw,
                "sourceId": event.source_id,
                "activity": event.activity,
                "assetId": event.asset_id,
                "attemptId": event.attempt_id,
                "questionId": event.question_id,
                "occurredAt": event.occurred_at,
                "contentHash": event.content_hash,
                "schemaVersion": event.schema_version,
                "sensitivity": event.sensitivity,
            })
        })
        .map(|value| canonical_json(&value))
        .collect::<Vec<_>>();
    rows.sort();
    sha256_hex(&rows.join("\n"))
}

fn output_hash(records: &[ObservationRecord]) -> String {
    let mut rows = records
        .iter()
        .map(|record| {
            json!({
                "id": record.id,
                "userId": record.user_id,
                "observationType": record.observation_type,
                "namespace": record.namespace,
                "scopeKind": record.scope_kind,
                "scopeKey": record.scope_key,
                "polarity": record.polarity,
                "valueNum": record.value_num,
                "valueText": record.value_text,
                "payload": record.payload,
                "confidence": record.confidence,
                "evidenceStrength": record.evidence_strength,
                "observedAt": record.observed_at,
                "sourceFingerprint": record.source_fingerprint,
                "evidence": record.evidence,
            })
        })
        .map(|value| canonical_json(&value))
        .collect::<Vec<_>>();
    rows.sort();
    sha256_hex(&rows.join("\n"))
}

fn issue_json(build: &ProjectionBuild) -> Option<String> {
    if build.skipped_sensitive == 0 && build.quarantined_event_ids.is_empty() {
        return None;
    }
    Some(canonical_json(&json!({
        "skippedSensitive": build.skipped_sensitive,
        "quarantinedEventIds": build.quarantined_event_ids,
    })))
}

fn decode_payload<T: DeserializeOwned>(event: &LedgerEvent) -> Result<T, String> {
    if !event.payload_valid {
        return Err("payload is not valid JSON".into());
    }
    serde_json::from_value(event.payload.clone())
        .map_err(|error| format!("payload schema mismatch: {error}"))
}

fn validate_reading_attempt_payload(
    event: &LedgerEvent,
    payload: &ReadingAttemptPayload,
) -> Result<(), String> {
    require_text(&payload.attempt_id, "attemptId")?;
    require_text(&payload.asset_id, "assetId")?;
    require_text(&payload.mode, "mode")?;
    require_event_reference(
        event.attempt_id.as_deref(),
        &payload.attempt_id,
        "attemptId",
    )?;
    require_event_reference(event.asset_id.as_deref(), &payload.asset_id, "assetId")?;
    if payload.attempt_ordinal == 0 {
        return Err("attemptOrdinal must be positive".into());
    }
    validate_ratio(payload.score_value, "scoreValue")?;
    validate_nonnegative_finite(payload.correct_count, "correctCount")?;
    Ok(())
}

fn validate_reading_question_payload(
    event: &LedgerEvent,
    payload: &ReadingQuestionPayload,
) -> Result<(), String> {
    require_text(&payload.attempt_id, "attemptId")?;
    require_text(&payload.asset_id, "assetId")?;
    require_text(&payload.question_id, "questionId")?;
    require_event_reference(
        event.attempt_id.as_deref(),
        &payload.attempt_id,
        "attemptId",
    )?;
    require_event_reference(event.asset_id.as_deref(), &payload.asset_id, "assetId")?;
    require_event_reference(
        event.question_id.as_deref(),
        &payload.question_id,
        "questionId",
    )?;
    if payload.attempt_ordinal == 0 {
        return Err("attemptOrdinal must be positive".into());
    }
    if let Some(question_kind) = payload.question_kind.as_deref() {
        require_text(question_kind, "questionKind")?;
    }
    Ok(())
}

fn validate_writing_payload(
    event: &LedgerEvent,
    payload: &WritingEvaluationPayload,
) -> Result<(), String> {
    if event.activity.as_deref() != Some("writing") {
        return Err("writing evaluation event has non-writing activity".into());
    }
    require_text(&payload.evaluation_id, "evaluationId")?;
    require_text(&payload.attempt_id, "attemptId")?;
    require_source_reference(
        event.source_id.as_deref(),
        &payload.evaluation_id,
        "evaluationId",
    )?;
    require_event_reference(
        event.attempt_id.as_deref(),
        &payload.attempt_id,
        "attemptId",
    )?;
    let status = payload.status.to_ascii_lowercase();
    if !matches!(status.as_str(), "completed" | "degraded" | "failed") {
        return Err(format!("non-terminal writing status: {}", payload.status));
    }
    validate_stage(&payload.stage, "stage")?;
    validate_optional_text(payload.task_type.as_deref(), "taskType")?;
    validate_optional_text(payload.provider_id.as_deref(), "providerId")?;
    validate_optional_text(payload.model.as_deref(), "model")?;
    if let Some(score) = payload.score.as_ref() {
        validate_writing_score(score)?;
    }
    if let Some(degradation) = payload.degradation.as_ref() {
        validate_degradation(degradation)?;
    }
    if status == "degraded" && payload.degradation.is_none() {
        return Err("degraded writing evaluation has no degradation object".into());
    }
    Ok(())
}

fn validate_coach_payload(event: &LedgerEvent, payload: &CoachPayload) -> Result<(), String> {
    require_text(&payload.message_id, "messageId")?;
    require_text(&payload.thread_id, "threadId")?;
    require_source_reference(event.source_id.as_deref(), &payload.message_id, "messageId")?;
    if payload.sequence == 0 {
        return Err("coach sequence must be positive".into());
    }
    let expected_role = match event.event_type {
        Some(LearningEventType::CoachQuestionAsked) => "user",
        Some(LearningEventType::CoachResponseGenerated) => "assistant",
        _ => return Err("unsupported Coach event type".into()),
    };
    if payload.role != expected_role {
        return Err(format!(
            "Coach role does not match event type: expected {expected_role}, got {}",
            payload.role
        ));
    }
    validate_optional_text(payload.question_context.as_deref(), "questionContext")?;
    Ok(())
}

fn validate_writing_score(score: &WritingScorePayload) -> Result<(), String> {
    for (field, value) in [
        ("overall", score.overall),
        ("taskResponse", score.task_response),
        ("coherence", score.coherence),
        ("lexical", score.lexical),
        ("grammar", score.grammar),
    ] {
        if !value.is_finite() || !(0.0..=9.0).contains(&value) {
            return Err(format!("writing score field is outside 0..=9: {field}"));
        }
    }
    Ok(())
}

fn writing_score_value(score: &WritingScorePayload, field: &str) -> f64 {
    match field {
        "overall" => score.overall,
        "taskResponse" => score.task_response,
        "coherence" => score.coherence,
        "lexical" => score.lexical,
        "grammar" => score.grammar,
        _ => unreachable!("validated writing score field"),
    }
}

fn validate_degradation(degradation: &WritingDegradationPayload) -> Result<(), String> {
    validate_stage(&degradation.stage, "degradation.stage")?;
    require_text(&degradation.reason, "degradation.reason")?;
    for missing in &degradation.missing {
        require_text(missing, "degradation.missing")?;
    }
    Ok(())
}

fn degradation_category(degradation: &WritingDegradationPayload) -> Result<&'static str, String> {
    validate_degradation(degradation)?;
    let stage = degradation.stage.to_ascii_lowercase();
    let has_feedback_gap = degradation.missing.iter().any(|field| {
        let field = field.to_ascii_lowercase();
        field == "feedback"
            || field == "sentences"
            || field.starts_with("feedback.")
            || field.starts_with("sentences.")
    });
    Ok(match (stage.as_str(), has_feedback_gap) {
        ("reviewing", true) => "review_feedback_missing",
        ("preparing", _) => "preparation_incomplete",
        ("scoring", _) => "scoring_output_missing",
        ("finalizing", _) => "finalization_incomplete",
        _ => "evaluation_degraded",
    })
}

fn validate_stage(value: &str, field: &str) -> Result<(), String> {
    let stage = value.to_ascii_lowercase();
    if matches!(
        stage.as_str(),
        "preparing" | "scoring" | "reviewing" | "finalizing"
    ) {
        Ok(())
    } else {
        Err(format!("invalid {field}: {value}"))
    }
}

fn require_text(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} is empty"))
    } else {
        Ok(())
    }
}

fn validate_optional_text(value: Option<&str>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        require_text(value, field)?;
    }
    Ok(())
}

fn require_event_reference(
    event_value: Option<&str>,
    payload_value: &str,
    field: &str,
) -> Result<(), String> {
    if let Some(event_value) = event_value {
        if event_value != payload_value {
            return Err(format!("event/payload {field} mismatch"));
        }
    }
    Ok(())
}

fn require_source_reference(
    source_id: Option<&str>,
    payload_value: &str,
    field: &str,
) -> Result<(), String> {
    if let Some(source_id) = source_id {
        if source_id != payload_value {
            return Err(format!("event/payload {field} mismatch"));
        }
    }
    Ok(())
}

fn validate_nonnegative_finite(value: Option<f64>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        if !value.is_finite() || value < 0.0 {
            return Err(format!("{field} must be a finite nonnegative number"));
        }
    }
    Ok(())
}

fn validate_ratio(value: Option<f64>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(format!("{field} must be a finite ratio in 0..=1"));
        }
    }
    Ok(())
}

fn prune_projection_runs(conn: &Connection) -> DbResult<()> {
    conn.execute(
        "DELETE FROM learning_projection_runs
         WHERE projector_key = ?1
           AND status = 'completed'
           AND id NOT IN (
             SELECT id
             FROM learning_projection_runs
             WHERE projector_key = ?1 AND status = 'completed'
             ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
             LIMIT ?2
           )",
        params![LEARNING_OBSERVATION_PROJECTOR_KEY, PROJECTION_SUCCESS_RETENTION],
    )?;
    conn.execute(
        "DELETE FROM learning_projection_runs
         WHERE projector_key = ?1
           AND status <> 'completed'
           AND id NOT IN (
             SELECT id FROM learning_projection_runs
             WHERE projector_key = ?1 AND status <> 'completed'
             ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
             LIMIT ?2
           )",
        params![LEARNING_OBSERVATION_PROJECTOR_KEY, PROJECTION_ERROR_RETENTION],
    )?;
    Ok(())
}

fn record_failed_projection_run(
    conn: &Connection,
    started_at: &str,
    error: &DbError,
) -> DbResult<()> {
    let finished_at = Utc::now().to_rfc3339();
    let run_id = format!("lpr-{}", uuid::Uuid::new_v4());
    let error_json = serde_json::to_string(&json!({
        "code": "projection.rebuild_failed",
        "message": error.to_string(),
        "retryable": true,
    }))
    .map_err(|serialization| DbError::Message(serialization.to_string()))?;
    let input_hash = load_ledger_events(conn)
        .map(|events| input_hash(&events))
        .unwrap_or_else(|_| "unavailable".into());
    conn.execute(
        "INSERT INTO learning_projection_runs
         (id, projector_key, projector_version, status, input_count, output_count,
          input_hash, output_hash, started_at, finished_at, error_json)
         VALUES (?1, ?2, ?3, 'failed', 0, 0, ?4, NULL, ?5, ?6, ?7)",
        params![
            run_id,
            LEARNING_OBSERVATION_PROJECTOR_KEY,
            LEARNING_OBSERVATION_PROJECTOR_VERSION,
            input_hash,
            started_at,
            finished_at,
            error_json,
        ],
    )?;
    prune_projection_runs(conn)
}

fn gap_hours(previous: &str, current: &str) -> Option<f64> {
    let previous = DateTime::parse_from_rfc3339(previous).ok()?;
    let current = DateTime::parse_from_rfc3339(current).ok()?;
    Some((current - previous).num_seconds() as f64 / 3600.0)
}

fn parse_event_type(raw: &str) -> Option<LearningEventType> {
    match raw {
        "attempt_started" => Some(LearningEventType::AttemptStarted),
        "answer_changed" => Some(LearningEventType::AnswerChanged),
        "attempt_submitted" => Some(LearningEventType::AttemptSubmitted),
        "attempt_completed" => Some(LearningEventType::AttemptCompleted),
        "reading_question_outcome" => Some(LearningEventType::ReadingQuestionOutcome),
        "writing_evaluation_completed" => Some(LearningEventType::WritingEvaluationCompleted),
        "coach_question_asked" => Some(LearningEventType::CoachQuestionAsked),
        "coach_response_generated" => Some(LearningEventType::CoachResponseGenerated),
        "coach_feedback_provided" => Some(LearningEventType::CoachFeedbackProvided),
        "vocabulary_review_completed" => Some(LearningEventType::VocabularyReviewCompleted),
        "annotation_created" => Some(LearningEventType::AnnotationCreated),
        _ => None,
    }
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("JSON string serialization"),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| {
                        format!(
                            "{}:{}",
                            serde_json::to_string(key).expect("JSON key serialization"),
                            canonical_json(&values[key])
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn sha256_hex(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    hex::encode(digest.finalize())
}
