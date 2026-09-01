use std::collections::BTreeSet;

use ielts_domain::{
    LearningEventEvidence, LearningEventEvidenceBatch, ObservationBatch, ObservationEnvelope,
    ObservationEvidenceRef, ObservationSnapshot, ObservationSnapshotQuery, ProjectionFreshness,
    COGNITIVE_READ_SCHEMA_VERSION, MAX_COGNITIVE_READ_LIMIT,
};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::Value;

use crate::learning_observations::{
    learning_observations_rebuild, learning_observations_verify,
    LearningObservationsVerifyReport, LEARNING_OBSERVATION_PROJECTOR_KEY,
    LEARNING_OBSERVATION_PROJECTOR_VERSION,
};
use crate::sqlite::{DbError, DbResult};

const MAX_PAYLOAD_BYTES: usize = 16 * 1024;
const MAX_EVENT_IDS: usize = 200;
const MAX_EVIDENCE_REFS: usize = 128;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

struct ProjectionHeader {
    input_hash: String,
    output_hash: String,
    generated_at: String,
}

struct RawObservation {
    id: String,
    user_id: String,
    observation_type: String,
    namespace: String,
    scope_kind: String,
    scope_key: String,
    polarity: Option<String>,
    value_num: Option<f64>,
    value_text: Option<String>,
    payload_json: String,
    confidence: f64,
    evidence_strength: f64,
    observed_at: String,
    projector_key: String,
    projector_version: i64,
    source_fingerprint: String,
}

pub fn observation_snapshot(
    conn: &Connection,
    query: &ObservationSnapshotQuery,
) -> DbResult<ObservationSnapshot> {
    let header = ensure_fresh(conn)?;
    let limit = query.limit.clamp(1, MAX_COGNITIVE_READ_LIMIT) as usize;
    let (observations, truncated, continuation) = load_observations(conn, query, limit)?;
    Ok(ObservationSnapshot {
        schema_version: COGNITIVE_READ_SCHEMA_VERSION,
        projector_key: LEARNING_OBSERVATION_PROJECTOR_KEY.into(),
        projector_version: LEARNING_OBSERVATION_PROJECTOR_VERSION,
        ledger_input_hash: header.input_hash,
        observation_output_hash: header.output_hash,
        generated_at: header.generated_at,
        freshness: ProjectionFreshness::Fresh,
        observations,
        truncated,
        continuation,
    })
}

pub fn observations_by_ids(
    conn: &Connection,
    ids: &[String],
) -> DbResult<ObservationBatch> {
    let header = ensure_fresh(conn)?;
    let requested = unique_bounded_ids(ids)?;
    let observations = load_observations_by_ids(conn, &requested)?;
    let found = observations
        .iter()
        .map(|observation| observation.id.as_str())
        .collect::<BTreeSet<_>>();
    let missing_ids = requested
        .into_iter()
        .filter(|id| !found.contains(id.as_str()))
        .collect();
    Ok(ObservationBatch {
        schema_version: COGNITIVE_READ_SCHEMA_VERSION,
        projector_key: LEARNING_OBSERVATION_PROJECTOR_KEY.into(),
        projector_version: LEARNING_OBSERVATION_PROJECTOR_VERSION,
        ledger_input_hash: header.input_hash,
        observation_output_hash: header.output_hash,
        generated_at: header.generated_at,
        freshness: ProjectionFreshness::Fresh,
        observations,
        missing_ids,
    })
}

pub fn learning_events_by_ids(
    conn: &Connection,
    ids: &[String],
) -> DbResult<LearningEventEvidenceBatch> {
    let _header = ensure_fresh(conn)?;
    let requested = unique_bounded_ids(ids)?;
    let events = load_learning_events_by_ids(conn, &requested)?;
    let found = events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<BTreeSet<_>>();
    let missing_ids = requested
        .into_iter()
        .filter(|id| !found.contains(id.as_str()))
        .collect();
    Ok(LearningEventEvidenceBatch {
        schema_version: COGNITIVE_READ_SCHEMA_VERSION,
        events,
        missing_ids,
    })
}

fn ensure_fresh(conn: &Connection) -> DbResult<ProjectionHeader> {
    let verify = learning_observations_verify(conn)?;
    if !projection_run_matches(conn, &verify)? {
        // This is deliberately outside any caller-owned business transaction:
        // a cognitive read may repair derived state, but never blocks a submit.
        learning_observations_rebuild(conn)?;
    }

    let verify = learning_observations_verify(conn)?;
    if !verify.consistent || !projection_run_matches(conn, &verify)? {
        return Err(DbError::Validation(
            "learning observation projection is not fresh after rebuild".into(),
        ));
    }
    Ok(ProjectionHeader {
        input_hash: verify.input_hash,
        output_hash: verify.expected_output_hash,
        generated_at: projection_generated_at(conn)?,
    })
}

fn latest_projection_run(
    conn: &Connection,
) -> DbResult<Option<(String, Option<String>, String, i64, Option<String>)>> {
    conn.query_row(
        "SELECT input_hash, output_hash, status, projector_version, finished_at
         FROM learning_projection_runs
         WHERE projector_key = ?1
         ORDER BY COALESCE(finished_at, started_at) DESC, id DESC
         LIMIT 1",
        params![LEARNING_OBSERVATION_PROJECTOR_KEY],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .optional()
    .map_err(Into::into)
}

fn projection_generated_at(conn: &Connection) -> DbResult<String> {
    let Some((_, _, status, version, Some(finished_at))) = latest_projection_run(conn)? else {
        return Err(DbError::Validation(
            "completed learning observation projection has no finishedAt".into(),
        ));
    };
    if status != "completed" || version != LEARNING_OBSERVATION_PROJECTOR_VERSION {
        return Err(DbError::Validation(
            "latest learning observation projection run is not current".into(),
        ));
    }
    require_text(&finished_at, "projection.finishedAt")?;
    Ok(finished_at)
}

fn projection_run_matches(
    conn: &Connection,
    verify: &LearningObservationsVerifyReport,
) -> DbResult<bool> {
    let Some((input_hash, output_hash, status, projector_version, _finished_at)) =
        latest_projection_run(conn)?
    else {
        return Ok(false);
    };
    Ok(status == "completed"
        && projector_version == LEARNING_OBSERVATION_PROJECTOR_VERSION
        && input_hash == verify.input_hash
        && output_hash.as_deref() == Some(verify.expected_output_hash.as_str())
        && verify.stored_output_hash == verify.expected_output_hash)
}

fn load_observations(
    conn: &Connection,
    query: &ObservationSnapshotQuery,
    limit: usize,
) -> DbResult<(Vec<ObservationEnvelope>, bool, Option<String>)> {
    if let Some(scope) = &query.scope {
        require_text(&scope.kind, "scope.kind")?;
        require_text(&scope.key, "scope.key")?;
    }
    let mut sql = String::from(
        "SELECT id,user_id,observation_type,namespace,scope_kind,scope_key,polarity,
                value_num,value_text,payload_json,confidence,evidence_strength,observed_at,
                projector_key,projector_version,source_fingerprint
         FROM learner_observations
         WHERE projector_key = ? AND projector_version = ?",
    );
    let mut bindings = vec![
        SqlValue::Text(LEARNING_OBSERVATION_PROJECTOR_KEY.into()),
        SqlValue::Integer(LEARNING_OBSERVATION_PROJECTOR_VERSION),
    ];
    if !query.namespaces.is_empty() {
        let placeholders = std::iter::repeat_n("?", query.namespaces.len())
            .collect::<Vec<_>>()
            .join(",");
        sql.push_str(&format!(" AND namespace IN ({placeholders})"));
        for namespace in &query.namespaces {
            require_text(namespace, "namespace")?;
            bindings.push(SqlValue::Text(namespace.clone()));
        }
    }
    if let Some(scope) = &query.scope {
        sql.push_str(" AND scope_kind = ? AND scope_key = ?");
        bindings.push(SqlValue::Text(scope.kind.clone()));
        bindings.push(SqlValue::Text(scope.key.clone()));
    }
    if let Some(since) = &query.since {
        require_text(since, "since")?;
        sql.push_str(" AND observed_at >= ?");
        bindings.push(SqlValue::Text(since.clone()));
    }
    if let Some(after_id) = &query.after_id {
        require_text(after_id, "afterId")?;
        sql.push_str(" AND id > ?");
        bindings.push(SqlValue::Text(after_id.clone()));
    }
    sql.push_str(" ORDER BY id LIMIT ?");
    bindings.push(SqlValue::Integer((limit + 1) as i64));

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(bindings.iter()), |row| {
        Ok(RawObservation {
            id: row.get(0)?,
            user_id: row.get(1)?,
            observation_type: row.get(2)?,
            namespace: row.get(3)?,
            scope_kind: row.get(4)?,
            scope_key: row.get(5)?,
            polarity: row.get(6)?,
            value_num: row.get(7)?,
            value_text: row.get(8)?,
            payload_json: row.get(9)?,
            confidence: row.get(10)?,
            evidence_strength: row.get(11)?,
            observed_at: row.get(12)?,
            projector_key: row.get(13)?,
            projector_version: row.get(14)?,
            source_fingerprint: row.get(15)?,
        })
    })?;
    let mut raw = rows.collect::<Result<Vec<_>, _>>()?;
    let truncated = raw.len() > limit;
    if truncated {
        raw.truncate(limit);
    }
    let continuation = truncated
        .then(|| raw.last().map(|observation| observation.id.clone()))
        .flatten();
    let observations = raw
        .into_iter()
        .map(|observation| materialize_observation(conn, observation))
        .collect::<DbResult<Vec<_>>>()?;
    validate_response_size(&observations, "observation snapshot")?;
    Ok((observations, truncated, continuation))
}

fn load_observations_by_ids(
    conn: &Connection,
    ids: &[String],
) -> DbResult<Vec<ObservationEnvelope>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id,user_id,observation_type,namespace,scope_kind,scope_key,polarity,
                value_num,value_text,payload_json,confidence,evidence_strength,observed_at,
                projector_key,projector_version,source_fingerprint
         FROM learner_observations
         WHERE projector_key = ? AND projector_version = ? AND id IN ({placeholders})
         ORDER BY id"
    );
    let mut bindings = vec![
        SqlValue::Text(LEARNING_OBSERVATION_PROJECTOR_KEY.into()),
        SqlValue::Integer(LEARNING_OBSERVATION_PROJECTOR_VERSION),
    ];
    bindings.extend(ids.iter().cloned().map(SqlValue::Text));
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(bindings.iter()), |row| {
        Ok(RawObservation {
            id: row.get(0)?,
            user_id: row.get(1)?,
            observation_type: row.get(2)?,
            namespace: row.get(3)?,
            scope_kind: row.get(4)?,
            scope_key: row.get(5)?,
            polarity: row.get(6)?,
            value_num: row.get(7)?,
            value_text: row.get(8)?,
            payload_json: row.get(9)?,
            confidence: row.get(10)?,
            evidence_strength: row.get(11)?,
            observed_at: row.get(12)?,
            projector_key: row.get(13)?,
            projector_version: row.get(14)?,
            source_fingerprint: row.get(15)?,
        })
    })?;
    let observations = rows
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(|observation| materialize_observation(conn, observation))
        .collect::<DbResult<Vec<_>>>()?;
    validate_response_size(&observations, "observation batch")?;
    Ok(observations)
}

fn materialize_observation(
    conn: &Connection,
    observation: RawObservation,
) -> DbResult<ObservationEnvelope> {
    let payload = bounded_json(&observation.payload_json, "observation payload")?;
    let mut statement = conn.prepare(
        "SELECT event_id,evidence_role,ordinal
         FROM learner_observation_evidence
         WHERE observation_id = ?1
         ORDER BY ordinal,event_id,evidence_role",
    )?;
    let evidence = statement
        .query_map(params![observation.id], |row| {
            Ok(ObservationEvidenceRef {
                event_id: row.get(0)?,
                evidence_role: row.get(1)?,
                ordinal: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if evidence.len() > MAX_EVIDENCE_REFS {
        return Err(DbError::Validation(format!(
            "observation evidence exceeds {MAX_EVIDENCE_REFS} references"
        )));
    }
    Ok(ObservationEnvelope {
        id: observation.id,
        user_id: observation.user_id,
        observation_type: observation.observation_type,
        namespace: observation.namespace,
        scope_kind: observation.scope_kind,
        scope_key: observation.scope_key,
        polarity: observation.polarity,
        value_num: observation.value_num,
        value_text: observation.value_text,
        payload,
        confidence: observation.confidence,
        evidence_strength: observation.evidence_strength,
        observed_at: observation.observed_at,
        projector_key: observation.projector_key,
        projector_version: observation.projector_version,
        source_fingerprint: observation.source_fingerprint,
        sensitivity: "normal".into(),
        trust: "deterministic_projection".into(),
        evidence,
    })
}

fn load_learning_events_by_ids(
    conn: &Connection,
    ids: &[String],
) -> DbResult<Vec<LearningEventEvidence>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id,user_id,event_type,source_kind,source_id,activity,asset_id,attempt_id,
                question_id,skill_key,occurred_at,payload_json,content_hash,schema_version,sensitivity
         FROM learning_events
         WHERE sensitivity = 'normal' AND id IN ({placeholders})
         ORDER BY id"
    );
    let bindings = ids.iter().cloned().map(SqlValue::Text).collect::<Vec<_>>();
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(bindings.iter()), |row| {
        let payload_json: String = row.get(11)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            payload_json,
            row.get::<_, String>(12)?,
            row.get::<_, i64>(13)?,
            row.get::<_, String>(14)?,
        ))
    })?;
    rows.collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .map(
            |(
                id,
                user_id,
                event_type,
                source_kind,
                source_id,
                activity,
                asset_id,
                attempt_id,
                question_id,
                skill_key,
                occurred_at,
                payload_json,
                content_hash,
                schema_version,
                sensitivity,
            )| {
                Ok(LearningEventEvidence {
                    id,
                    user_id,
                    event_type,
                    source_kind,
                    source_id,
                    activity,
                    asset_id,
                    attempt_id,
                    question_id,
                    skill_key,
                    occurred_at,
                    payload: bounded_json(&payload_json, "learning event payload")?,
                    content_hash,
                    schema_version,
                    sensitivity,
                    trust: "canonical_learning_truth".into(),
                })
            },
        )
        .collect()
}

fn unique_bounded_ids(ids: &[String]) -> DbResult<Vec<String>> {
    if ids.len() > MAX_EVENT_IDS {
        return Err(DbError::Validation(format!(
            "cognitive read accepts at most {MAX_EVENT_IDS} IDs"
        )));
    }
    let mut seen = BTreeSet::new();
    let mut unique = Vec::with_capacity(ids.len());
    for id in ids {
        require_text(id, "id")?;
        if seen.insert(id.clone()) {
            unique.push(id.clone());
        }
    }
    Ok(unique)
}

fn bounded_json(payload_json: &str, field: &str) -> DbResult<Value> {
    if payload_json.len() > MAX_PAYLOAD_BYTES {
        return Err(DbError::Validation(format!(
            "{field} exceeds {MAX_PAYLOAD_BYTES} bytes"
        )));
    }
    serde_json::from_str(payload_json)
        .map_err(|error| DbError::Validation(format!("{field} is invalid JSON: {error}")))
}

fn validate_response_size<T: serde::Serialize>(value: &T, field: &str) -> DbResult<()> {
    let size = serde_json::to_vec(value)
        .map_err(|error| DbError::Validation(format!("{field} is not serializable: {error}")))?
        .len();
    if size > MAX_RESPONSE_BYTES {
        return Err(DbError::Validation(format!(
            "{field} exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(())
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}
