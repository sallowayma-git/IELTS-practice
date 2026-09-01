//! Deterministic M4 Learner Model and skill-review projection.
//!
//! M2 owns the learning-event and generic-observation contracts. M4 consumes
//! those rows, materializes skill evidence, and rebuilds mastery/scheduling
//! state. No model, network call, or Python runtime is allowed in this module.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Duration, Utc};
use ielts_domain::{
    apply_skill_observation, familiarity_weights, preferred_probe, priority_band, review_priority,
    trend_direction, uncertainty_band, LearnerModelConfig, LearnerRebuildReport, LearnerStateQuery,
    LearnerStateSnapshot, LearnerVerifyReport, SkillObservation, SkillReviewNeed,
    SkillReviewNeedsQuery, SkillReviewNeedsSnapshot, SkillReviewProbe, SkillState, SkillStateView,
    TrendDirection, UncertaintyBand, LEARNER_MODEL_SCHEMA_VERSION, LEARNER_SCHEDULER_VERSION,
    LEARNER_STATE_MODEL_VERSION, LEARNER_TAXONOMY_VERSION, MAX_LEARNER_LIMIT,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::sqlite::{DbError, DbResult};

pub const LEARNER_MODEL_PROJECTOR_KEY: &str = "learner_model_v1";
const MAX_STATE_EXPLANATION_OBSERVATIONS: usize = 12;
const MAX_AVOID_ASSETS: usize = 5;
const MAX_LEARNER_RESPONSE_BYTES: usize = 1_048_576;
const EMPTY_REFERENCE_AT: &str = "1970-01-01T00:00:00Z";

#[derive(Debug, Clone)]
struct SourceObservation {
    user_id: String,
    event_id: String,
    source_fingerprint: String,
    value_num: Option<f64>,
    value_text: Option<String>,
    confidence: f64,
    evidence_strength: f64,
    observed_at: String,
    asset_id: String,
    question_id: String,
    attempt_id: Option<String>,
    question_kind: Option<String>,
    skill_key_hint: Option<String>,
    repeat_transition: Option<String>,
    intervention_id: Option<String>,
    intervention_type: Option<String>,
}

#[derive(Debug, Clone)]
struct MappingRow {
    skill_key: String,
    weight: f64,
    mapping_source: String,
    mapping_version: i64,
}

#[derive(Debug, Clone)]
struct ScheduleRecord {
    user_id: String,
    need: SkillReviewNeed,
}

#[derive(Debug)]
struct BuildResult {
    observations: Vec<SkillObservation>,
    input_count: u64,
    input_hash: String,
    reference_at: String,
}

/// Rebuild all M4 rows from the current M2 observation projection.
pub fn learner_model_rebuild(conn: &Connection) -> DbResult<LearnerRebuildReport> {
    let tx = conn.unchecked_transaction()?;
    let report = learner_model_rebuild_in_transaction(&tx)?;
    tx.commit()?;
    Ok(report)
}

fn learner_model_rebuild_in_transaction(conn: &Connection) -> DbResult<LearnerRebuildReport> {
    let built = build_skill_observations(conn, true)?;
    let (states, schedules, state_hash) = build_states_and_schedules(
        &built.observations,
        &built.reference_at,
        LearnerModelConfig::default(),
    )?;

    // These are all M4-owned derived rows. Keep taxonomy and question mapping
    // because they are versioned configuration, not replay output.
    conn.execute("DELETE FROM skill_review_schedule", [])?;
    conn.execute("DELETE FROM learner_skill_state", [])?;
    conn.execute("DELETE FROM learner_skill_observations", [])?;
    insert_skill_observations(conn, &built.observations)?;
    insert_skill_states(conn, &states)?;
    insert_skill_schedules(conn, &schedules)?;

    Ok(LearnerRebuildReport {
        taxonomy_version: LEARNER_TAXONOMY_VERSION,
        model_version: LEARNER_STATE_MODEL_VERSION.into(),
        scheduler_version: LEARNER_SCHEDULER_VERSION.into(),
        input_count: built.input_count,
        observation_count: built.observations.len() as u64,
        state_count: states.len() as u64,
        schedule_count: schedules.len() as u64,
        input_hash: built.input_hash,
        state_hash,
    })
}

/// Verify M4 derived rows against a fresh deterministic build without writes.
pub fn learner_model_verify(conn: &Connection) -> DbResult<LearnerVerifyReport> {
    let built = build_skill_observations(conn, false)?;
    let (expected_states, expected_schedules, expected_hash) = build_states_and_schedules(
        &built.observations,
        &built.reference_at,
        LearnerModelConfig::default(),
    )?;
    let stored_observations = count_rows(conn, "learner_skill_observations")?;
    let stored_states = load_stored_states(conn)?;
    let stored_schedules = load_stored_schedules(conn)?;
    let stored_hash = hash_derived(&stored_states, &stored_schedules)?;
    let mut mismatches = Vec::new();
    if stored_observations != built.observations.len() as u64 {
        mismatches.push(format!(
            "observation count mismatch: stored={}, expected={}",
            stored_observations,
            built.observations.len()
        ));
    }
    if stored_states.len() != expected_states.len() {
        mismatches.push(format!(
            "state count mismatch: stored={}, expected={}",
            stored_states.len(),
            expected_states.len()
        ));
    }
    if stored_schedules.len() != expected_schedules.len() {
        mismatches.push(format!(
            "schedule count mismatch: stored={}, expected={}",
            stored_schedules.len(),
            expected_schedules.len()
        ));
    }
    if stored_hash != expected_hash {
        mismatches.push("derived state hash mismatch".into());
    }
    Ok(LearnerVerifyReport {
        consistent: mismatches.is_empty(),
        input_count: built.input_count,
        stored_observation_count: stored_observations,
        expected_observation_count: built.observations.len() as u64,
        stored_state_count: stored_states.len() as u64,
        expected_state_count: expected_states.len() as u64,
        stored_schedule_count: stored_schedules.len() as u64,
        expected_schedule_count: expected_schedules.len() as u64,
        input_hash: built.input_hash,
        stored_state_hash: stored_hash,
        expected_state_hash: expected_hash,
        mismatches,
    })
}

pub fn learner_state_snapshot(
    conn: &Connection,
    query: &LearnerStateQuery,
) -> DbResult<LearnerStateSnapshot> {
    let limit = query.limit.clamp(1, MAX_LEARNER_LIMIT) as usize;
    let mut states = load_stored_states(conn)?;
    if !query.skill_keys.is_empty() {
        let wanted = query
            .skill_keys
            .iter()
            .take(MAX_LEARNER_LIMIT as usize)
            .collect::<BTreeSet<_>>();
        states.retain(|state| wanted.contains(&state.skill_key));
    }
    if let Some(after) = query.after_skill_key.as_deref() {
        states.retain(|state| state.skill_key.as_str() > after);
    }
    states.sort_by(|left, right| left.skill_key.cmp(&right.skill_key));
    let truncated = states.len() > limit;
    states.truncate(limit);
    let continuation = truncated
        .then(|| states.last().map(|state| state.skill_key.clone()))
        .flatten();
    let selected_skill_keys = states
        .iter()
        .map(|state| state.skill_key.as_str())
        .collect::<BTreeSet<_>>();
    let schedules = load_stored_schedules(conn)?
        .into_iter()
        .filter(|schedule| selected_skill_keys.contains(schedule.need.skill_key.as_str()))
        .collect::<Vec<_>>();
    let state_hash = hash_derived(&states, &schedules)?;
    let generated_at = states
        .iter()
        .filter_map(|state| state.last_practiced_at.as_deref())
        .max()
        .unwrap_or(EMPTY_REFERENCE_AT)
        .to_string();
    let view_states = states.iter().map(state_view).collect::<Vec<_>>();
    let response = LearnerStateSnapshot {
        schema_version: LEARNER_MODEL_SCHEMA_VERSION,
        taxonomy_version: LEARNER_TAXONOMY_VERSION,
        model_version: LEARNER_STATE_MODEL_VERSION.into(),
        generated_at,
        state_hash,
        states: view_states,
        truncated,
        continuation,
    };
    ensure_response_size(&response)?;
    Ok(response)
}

pub fn skill_review_needs_snapshot(
    conn: &Connection,
    query: &SkillReviewNeedsQuery,
) -> DbResult<SkillReviewNeedsSnapshot> {
    let limit = query.limit.clamp(1, MAX_LEARNER_LIMIT) as usize;
    let mut needs = load_stored_schedules(conn)?;
    if let Some(due_before) = query.due_before.as_deref() {
        needs.retain(|record| record.need.due_at.as_str() <= due_before);
    }
    if let Some(after) = query.after_skill_key.as_deref() {
        needs.retain(|record| record.need.skill_key.as_str() > after);
    }
    needs.sort_by(|left, right| {
        right
            .need
            .priority
            .total_cmp(&left.need.priority)
            .then_with(|| left.need.skill_key.cmp(&right.need.skill_key))
    });
    let truncated = needs.len() > limit;
    needs.truncate(limit);
    let continuation = truncated
        .then(|| needs.last().map(|record| record.need.skill_key.clone()))
        .flatten();
    let response = SkillReviewNeedsSnapshot {
        schema_version: LEARNER_MODEL_SCHEMA_VERSION,
        scheduler_version: LEARNER_SCHEDULER_VERSION.into(),
        generated_at: needs
            .iter()
            .map(|record| record.need.due_at.as_str())
            .max()
            .unwrap_or(EMPTY_REFERENCE_AT)
            .to_string(),
        needs: needs.into_iter().map(|record| record.need).collect(),
        truncated,
        continuation,
    };
    ensure_response_size(&response)?;
    Ok(response)
}

fn build_skill_observations(conn: &Connection, allow_seed_mapping: bool) -> DbResult<BuildResult> {
    let sources = load_source_observations(conn)?;
    let mut observations = Vec::new();
    let mut input_parts = Vec::new();
    let mut last_asset_at: BTreeMap<(String, String), String> = BTreeMap::new();

    for source in &sources {
        let Some(outcome) = source.value_num.filter(|value| value.is_finite()) else {
            continue;
        };
        let mappings = if allow_seed_mapping {
            ensure_mapping_for_source(conn, source)?
        } else {
            active_mappings(conn, &source.asset_id, &source.question_id)?
        };
        let asset_key = (source.user_id.clone(), source.asset_id.clone());
        let previous_asset_at = last_asset_at.get(&asset_key).cloned();
        let gap_hours = previous_asset_at
            .as_deref()
            .and_then(|previous| gap_hours(previous, &source.observed_at));
        let same_asset = previous_asset_at.is_some();
        let (novelty_weight, familiarity_weight) =
            familiarity_weights(same_asset, gap_hours, LearnerModelConfig::default());
        for mapping in mappings {
            let id = stable_skill_observation_id(
                &source.event_id,
                &mapping.skill_key,
                mapping.mapping_version,
                &source.source_fingerprint,
            );
            let context = json!({
                "eventId": source.event_id,
                "assetId": source.asset_id,
                "questionId": source.question_id,
                "attemptId": source.attempt_id,
                "questionKind": source.question_kind,
                "outcome": outcome,
                "valueText": source.value_text,
                "gapHours": gap_hours,
                "sameAsset": same_asset,
                "mappingSource": mapping.mapping_source,
                "mappingVersion": mapping.mapping_version,
                "repeatTransition": source.repeat_transition,
                "interventionId": source.intervention_id,
                "interventionType": source.intervention_type,
            });
            let observation = SkillObservation {
                id,
                user_id: source.user_id.clone(),
                event_id: source.event_id.clone(),
                skill_key: mapping.skill_key,
                outcome: outcome.clamp(0.0, 1.0),
                mapping_weight: mapping.weight,
                evidence_weight: (source.confidence * source.evidence_strength).clamp(0.0, 1.0),
                novelty_weight,
                familiarity_weight,
                time_weight: 1.0,
                error_type: (outcome < 0.5).then(|| error_type(source.question_kind.as_deref())),
                context,
                observed_at: source.observed_at.clone(),
                asset_id: source.asset_id.clone(),
                question_id: source.question_id.clone(),
                attempt_id: source.attempt_id.clone(),
                intervention_id: source.intervention_id.clone(),
                intervention_type: source.intervention_type.clone(),
            };
            input_parts.push(format!(
                "{}|{}|{}|{}|{}|{}|{}|{}|{}",
                observation.event_id,
                observation.skill_key,
                mapping.mapping_version,
                mapping.mapping_source,
                mapping.weight,
                observation.outcome,
                observation.novelty_weight,
                observation.familiarity_weight,
                observation.observed_at
            ));
            observations.push(observation);
        }
        last_asset_at.insert(asset_key, source.observed_at.clone());
    }
    observations.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    input_parts.sort();
    let reference_at = observations
        .iter()
        .map(|observation| observation.observed_at.as_str())
        .max()
        .unwrap_or(EMPTY_REFERENCE_AT)
        .to_string();
    Ok(BuildResult {
        observations,
        input_count: sources.len() as u64,
        input_hash: sha256_hex(&input_parts.join("\n")),
        reference_at,
    })
}

fn load_source_observations(conn: &Connection) -> DbResult<Vec<SourceObservation>> {
    let mut statement = conn.prepare(
        "SELECT lo.id, lo.user_id, lo.value_num, lo.value_text, lo.confidence,
                lo.evidence_strength, lo.observed_at, lo.payload_json,
                lo.source_fingerprint, e.id, e.asset_id, e.question_id,
                e.attempt_id, e.payload_json, e.occurred_at,
                (SELECT ro.value_text
                 FROM learner_observations ro
                 JOIN learner_observation_evidence roe
                   ON roe.observation_id = ro.id AND roe.evidence_role = 'support'
                 WHERE roe.event_id = e.id
                   AND ro.observation_type LIKE 'reading.repeat.%'
                 ORDER BY ro.observed_at DESC, ro.id ASC
                 LIMIT 1)
         FROM learner_observations lo
         JOIN learner_observation_evidence oe
           ON oe.observation_id = lo.id AND oe.evidence_role = 'support'
         JOIN learning_events e ON e.id = oe.event_id
         WHERE lo.observation_type = 'reading.question.outcome'
           AND lo.value_num IS NOT NULL
           AND e.sensitivity = 'normal'
         ORDER BY e.occurred_at ASC, e.id ASC, lo.id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let observation_payload: Value =
            serde_json::from_str::<Value>(&row.get::<_, String>(7)?).unwrap_or(Value::Null);
        let event_payload: Value =
            serde_json::from_str::<Value>(&row.get::<_, String>(13)?).unwrap_or(Value::Null);
        let asset_id = row
            .get::<_, Option<String>>(10)?
            .or_else(|| value_string(&observation_payload, "assetId"))
            .ok_or_else(|| {
                rusqlite::Error::InvalidColumnType(
                    10,
                    "asset_id".into(),
                    rusqlite::types::Type::Null,
                )
            })?;
        let question_id = row
            .get::<_, Option<String>>(11)?
            .or_else(|| value_string(&observation_payload, "questionId"))
            .ok_or_else(|| {
                rusqlite::Error::InvalidColumnType(
                    11,
                    "question_id".into(),
                    rusqlite::types::Type::Null,
                )
            })?;
        Ok(SourceObservation {
            user_id: row.get(1)?,
            event_id: row.get(9)?,
            source_fingerprint: row.get(8)?,
            value_num: row.get(2)?,
            value_text: row.get(3)?,
            confidence: row.get(4)?,
            evidence_strength: row.get(5)?,
            observed_at: row.get(14)?,
            asset_id,
            question_id,
            attempt_id: row
                .get::<_, Option<String>>(12)?
                .or_else(|| value_string(&event_payload, "attemptId"))
                .or_else(|| value_string(&observation_payload, "attemptId")),
            question_kind: value_string(&event_payload, "questionKind")
                .or_else(|| value_string(&observation_payload, "questionKind")),
            skill_key_hint: value_string(&event_payload, "skillKey"),
            repeat_transition: row.get(15)?,
            intervention_id: value_string(&event_payload, "interventionId")
                .or_else(|| value_string(&observation_payload, "interventionId")),
            intervention_type: value_string(&event_payload, "interventionType")
                .or_else(|| value_string(&observation_payload, "interventionType")),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn ensure_mapping_for_source(
    conn: &Connection,
    source: &SourceObservation,
) -> DbResult<Vec<MappingRow>> {
    let existing = active_mappings(conn, &source.asset_id, &source.question_id)?;
    if !existing.is_empty() {
        return Ok(existing);
    }
    let Some(skill_key) = deterministic_skill_key(conn, source) else {
        return Ok(Vec::new());
    };
    let existing_any: Option<String> = conn
        .query_row(
            "SELECT mapping_source FROM question_skill_map
             WHERE asset_id = ?1 AND question_id = ?2 AND skill_key = ?3",
            params![source.asset_id, source.question_id, skill_key],
            |row| row.get(0),
        )
        .optional()?;
    if existing_any.is_none() {
        conn.execute(
            "INSERT INTO question_skill_map
             (asset_id, question_id, skill_key, weight, mapping_source, mapping_version, active)
             VALUES (?1, ?2, ?3, 1.0, 'builtin', ?4, 1)",
            params![
                source.asset_id,
                source.question_id,
                skill_key,
                LEARNER_TAXONOMY_VERSION
            ],
        )?;
    }
    active_mappings(conn, &source.asset_id, &source.question_id)
}

fn active_mappings(
    conn: &Connection,
    asset_id: &str,
    question_id: &str,
) -> DbResult<Vec<MappingRow>> {
    let mut statement = conn.prepare(
        "SELECT q.skill_key, q.weight, q.mapping_source, q.mapping_version
         FROM question_skill_map q
         JOIN skill_catalog s ON s.skill_key = q.skill_key
         WHERE q.asset_id = ?1 AND q.question_id = ?2
           AND q.active = 1 AND s.active = 1
           AND q.mapping_source <> 'model_proposed'
         ORDER BY q.skill_key",
    )?;
    let rows = statement.query_map(params![asset_id, question_id], |row| {
        Ok(MappingRow {
            skill_key: row.get(0)?,
            weight: row.get(1)?,
            mapping_source: row.get(2)?,
            mapping_version: row.get(3)?,
        })
    })?;
    let mut mappings = rows.collect::<Result<Vec<_>, _>>()?;
    let Some(best_priority) = mappings
        .iter()
        .map(|mapping| mapping_priority(&mapping.mapping_source))
        .min()
    else {
        return Ok(Vec::new());
    };
    mappings.retain(|mapping| mapping_priority(&mapping.mapping_source) == best_priority);
    Ok(mappings)
}

fn mapping_priority(source: &str) -> u8 {
    match source {
        "content_pack" => 0,
        "builtin" => 1,
        "manual" => 2,
        "model_proposed" => 3,
        _ => u8::MAX,
    }
}

fn deterministic_skill_key(conn: &Connection, source: &SourceObservation) -> Option<String> {
    if let Some(hint) = source.skill_key_hint.as_deref() {
        if hint.starts_with("reading.")
            && conn
                .query_row(
                    "SELECT 1 FROM skill_catalog WHERE skill_key = ?1 AND active = 1",
                    params![hint],
                    |_| Ok(()),
                )
                .optional()
                .ok()
                .flatten()
                .is_some()
        {
            return Some(hint.to_string());
        }
    }
    let normalized = source
        .question_kind
        .as_deref()?
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .replace(' ', "_");
    let skill_key = match normalized.as_str() {
        "matching" | "matching_headings" | "matching_information" | "matching_features" => {
            "reading.matching_headings"
        }
        "tfng" | "true_false_not_given" => "reading.tfng",
        "yng" | "yes_no_not_given" => "reading.yng",
        "mcq" | "multi_choice" | "multiple_choice" => "reading.multi_choice",
        "single_choice" => "reading.single_choice",
        "sentence_completion" => "reading.sentence_completion",
        "summary_completion" => "reading.summary_completion",
        "notes_completion" => "reading.notes_completion",
        "table_completion" => "reading.table_completion",
        "flow_chart_completion" => "reading.flow_chart_completion",
        "diagram_completion" => "reading.diagram_completion",
        "short_answer" => "reading.short_answer",
        "classification" => "reading.classification",
        _ => return None,
    };
    conn.query_row(
        "SELECT skill_key FROM skill_catalog WHERE skill_key = ?1 AND active = 1",
        params![skill_key],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn insert_skill_observations(conn: &Connection, observations: &[SkillObservation]) -> DbResult<()> {
    for observation in observations {
        conn.execute(
            "INSERT INTO learner_skill_observations
             (id, user_id, event_id, skill_key, outcome, mapping_weight, evidence_weight,
              novelty_weight, familiarity_weight, time_weight, error_type, context_json,
              observed_at, asset_id, question_id, attempt_id, intervention_id, intervention_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(event_id, skill_key) DO UPDATE SET
               id = excluded.id,
               outcome = excluded.outcome,
               mapping_weight = excluded.mapping_weight,
               evidence_weight = excluded.evidence_weight,
               novelty_weight = excluded.novelty_weight,
               familiarity_weight = excluded.familiarity_weight,
               time_weight = excluded.time_weight,
               error_type = excluded.error_type,
               context_json = excluded.context_json,
               observed_at = excluded.observed_at,
               asset_id = excluded.asset_id,
               question_id = excluded.question_id,
               attempt_id = excluded.attempt_id,
               intervention_id = excluded.intervention_id,
               intervention_type = excluded.intervention_type",
            params![
                observation.id,
                observation.user_id,
                observation.event_id,
                observation.skill_key,
                observation.outcome,
                observation.mapping_weight,
                observation.evidence_weight,
                observation.novelty_weight,
                observation.familiarity_weight,
                observation.time_weight,
                observation.error_type,
                serde_json::to_string(&observation.context).map_err(json_error)?,
                observation.observed_at,
                observation.asset_id,
                observation.question_id,
                observation.attempt_id,
                observation.intervention_id,
                observation.intervention_type,
            ],
        )?;
    }
    Ok(())
}

fn build_states_and_schedules(
    observations: &[SkillObservation],
    reference_at: &str,
    config: LearnerModelConfig,
) -> DbResult<(Vec<SkillState>, Vec<ScheduleRecord>, String)> {
    let mut states: BTreeMap<(String, String), SkillState> = BTreeMap::new();
    let mut assets: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    let mut recent_outcomes: BTreeMap<(String, String), Vec<f64>> = BTreeMap::new();
    let mut recent_observation_ids: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    let mut recent_assets: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    let mut intervention_ids: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    let mut error_types: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    let mut repeat_transitions: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    let mut repeated_counts: BTreeMap<(String, String), u64> = BTreeMap::new();
    let mut novel_counts: BTreeMap<(String, String), u64> = BTreeMap::new();

    for observation in observations {
        let key = (observation.user_id.clone(), observation.skill_key.clone());
        let state = states.entry(key.clone()).or_insert_with(|| SkillState {
            user_id: observation.user_id.clone(),
            skill_key: observation.skill_key.clone(),
            alpha: 1.0,
            beta: 1.0,
            mastery_mean: 0.5,
            uncertainty: 1.0,
            evidence_count: 0,
            distinct_asset_count: 0,
            recent_error_rate: None,
            stability_days: None,
            last_practiced_at: None,
            next_review_at: None,
            model_version: LEARNER_STATE_MODEL_VERSION.into(),
            explanation: Value::Null,
        });
        let elapsed_days = state
            .last_practiced_at
            .as_deref()
            .and_then(|previous| gap_hours(previous, &observation.observed_at))
            .map(|hours| (hours / 24.0).max(0.0))
            .unwrap_or(0.0);
        let previous_stability = state.stability_days.unwrap_or(1.0);
        let weight = ielts_domain::effective_observation_weight(observation);
        apply_skill_observation(state, observation, elapsed_days, config);
        state.last_practiced_at = Some(observation.observed_at.clone());
        state.stability_days = Some(update_stability(
            previous_stability,
            elapsed_days,
            observation.outcome,
            weight,
        ));
        assets
            .entry(key.clone())
            .or_default()
            .insert(observation.asset_id.clone());
        state.distinct_asset_count = assets.get(&key).map_or(0, |items| items.len() as u64);
        let outcomes = recent_outcomes.entry(key.clone()).or_default();
        outcomes.push(observation.outcome.clamp(0.0, 1.0));
        if outcomes.len() > 8 {
            outcomes.remove(0);
        }
        state.recent_error_rate = Some(
            outcomes
                .iter()
                .map(|outcome| if *outcome < 0.5 { 1.0 } else { 0.0 })
                .sum::<f64>()
                / outcomes.len() as f64,
        );
        let ids = recent_observation_ids.entry(key.clone()).or_default();
        ids.push(observation.id.clone());
        if ids.len() > MAX_STATE_EXPLANATION_OBSERVATIONS {
            ids.remove(0);
        }
        let assets = recent_assets.entry(key.clone()).or_default();
        assets.push(observation.asset_id.clone());
        if assets.len() > MAX_AVOID_ASSETS * 2 {
            assets.remove(0);
        }
        if observation.novelty_weight < 0.7 {
            *repeated_counts.entry(key.clone()).or_default() += 1;
        } else {
            *novel_counts.entry(key.clone()).or_default() += 1;
        }
        if let Some(intervention_id) = observation.intervention_id.as_deref() {
            intervention_ids
                .entry(key.clone())
                .or_default()
                .insert(intervention_id.into());
        }
        if let Some(error_type) = observation.error_type.as_deref() {
            error_types
                .entry(key.clone())
                .or_default()
                .insert(error_type.into());
        }
        if let Some(transition) = observation
            .context
            .get("repeatTransition")
            .and_then(Value::as_str)
        {
            repeat_transitions
                .entry(key.clone())
                .or_default()
                .insert(transition.into());
        }
    }

    let reference =
        parse_time(reference_at).unwrap_or_else(|| parse_time(EMPTY_REFERENCE_AT).unwrap());
    let mut output_states = Vec::new();
    let mut schedules = Vec::new();
    for (key, mut state) in states {
        let outcomes = recent_outcomes.get(&key).cloned().unwrap_or_default();
        let trend = trend_direction(&outcomes);
        let delay_days = review_delay_days(&state);
        let next_review_at = state
            .last_practiced_at
            .as_deref()
            .and_then(parse_time)
            .map(|time| add_days(time, delay_days));
        state.next_review_at = next_review_at.map(|time| time.to_rfc3339());
        let recent_assets = recent_assets.get(&key).cloned().unwrap_or_default();
        let avoid_asset_ids = recent_assets
            .iter()
            .rev()
            .filter(|asset| !asset.is_empty())
            .fold(Vec::new(), |mut values, asset| {
                if !values.contains(asset) && values.len() < MAX_AVOID_ASSETS {
                    values.push(asset.clone());
                }
                values
            });
        let supporting_observation_ids = recent_observation_ids
            .get(&key)
            .cloned()
            .unwrap_or_default();
        let intervention_ids = intervention_ids
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();
        let error_type_values = error_types
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();
        let repeat_transition_values = repeat_transitions
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect::<Vec<_>>();
        state.explanation = json!({
            "uncertaintyBand": uncertainty_band(state.uncertainty),
            "trend": trend,
            "recentOutcomes": outcomes,
            "supportingObservationIds": supporting_observation_ids,
            "avoidAssetIds": avoid_asset_ids,
            "interventionIds": intervention_ids,
            "errorTypes": error_type_values,
            "repeatTransitions": repeat_transition_values,
            "repeatedEvidenceCount": repeated_counts.get(&key).copied().unwrap_or(0),
            "novelEvidenceCount": novel_counts.get(&key).copied().unwrap_or(0),
            "referenceAt": reference_at,
        });
        output_states.push(state.clone());

        let overdue_factor = state
            .next_review_at
            .as_deref()
            .and_then(parse_time)
            .map(|due| {
                let days = (reference - due).num_seconds() as f64 / 86_400.0;
                if days <= 0.0 {
                    0.0
                } else {
                    (0.5 + days / 7.0).min(1.0)
                }
            })
            .unwrap_or(0.0);
        let recency_gap_factor = state
            .last_practiced_at
            .as_deref()
            .and_then(parse_time)
            .map(|last| ((reference - last).num_seconds() as f64 / 86_400.0 / 30.0).clamp(0.0, 1.0))
            .unwrap_or(1.0);
        let priority = review_priority(&state, overdue_factor, recency_gap_factor);
        let need = SkillReviewNeed {
            skill_key: state.skill_key.clone(),
            priority,
            priority_band: priority_band(priority),
            due_at: state
                .next_review_at
                .clone()
                .unwrap_or_else(|| reference_at.to_string()),
            preferred_probe: preferred_probe(&state),
            avoid_asset_ids: avoid_asset_ids.clone(),
            reason_codes: reason_codes(&state, overdue_factor),
            uncertainty_band: uncertainty_band(state.uncertainty),
            mastery_mean: state.mastery_mean,
            evidence_count: state.evidence_count,
            distinct_asset_count: state.distinct_asset_count,
            supporting_observation_ids,
        };
        schedules.push(ScheduleRecord {
            user_id: state.user_id.clone(),
            need,
        });
    }
    output_states.sort_by(|left, right| {
        left.user_id
            .cmp(&right.user_id)
            .then_with(|| left.skill_key.cmp(&right.skill_key))
    });
    schedules.sort_by(|left, right| {
        left.user_id
            .cmp(&right.user_id)
            .then_with(|| left.need.skill_key.cmp(&right.need.skill_key))
    });
    let state_hash = hash_derived(&output_states, &schedules)?;
    Ok((output_states, schedules, state_hash))
}

fn insert_skill_states(conn: &Connection, states: &[SkillState]) -> DbResult<()> {
    for state in states {
        conn.execute(
            "INSERT INTO learner_skill_state
             (user_id, skill_key, alpha, beta, mastery_mean, uncertainty, evidence_count,
              distinct_asset_count, recent_error_rate, stability_days, last_practiced_at,
              next_review_at, model_version, explanation_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                state.user_id,
                state.skill_key,
                state.alpha,
                state.beta,
                state.mastery_mean,
                state.uncertainty,
                state.evidence_count as i64,
                state.distinct_asset_count as i64,
                state.recent_error_rate,
                state.stability_days,
                state.last_practiced_at,
                state.next_review_at,
                state.model_version,
                serde_json::to_string(&state.explanation).map_err(json_error)?,
                state
                    .last_practiced_at
                    .as_deref()
                    .unwrap_or(EMPTY_REFERENCE_AT),
            ],
        )?;
    }
    Ok(())
}

fn insert_skill_schedules(conn: &Connection, schedules: &[ScheduleRecord]) -> DbResult<()> {
    for schedule in schedules {
        let need = &schedule.need;
        conn.execute(
            "INSERT INTO skill_review_schedule
             (user_id, skill_key, due_at, priority, priority_band, preferred_probe,
              avoid_asset_ids_json, reason_codes_json, supporting_observation_ids_json,
              last_scheduled_at, source_model_version, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                schedule.user_id,
                need.skill_key,
                need.due_at,
                need.priority,
                need.priority_band,
                probe_key(&need.preferred_probe),
                serde_json::to_string(&need.avoid_asset_ids).map_err(json_error)?,
                serde_json::to_string(&need.reason_codes).map_err(json_error)?,
                serde_json::to_string(&need.supporting_observation_ids).map_err(json_error)?,
                need.due_at,
                LEARNER_STATE_MODEL_VERSION,
                need.due_at,
            ],
        )?;
    }
    Ok(())
}

fn load_stored_states(conn: &Connection) -> DbResult<Vec<SkillState>> {
    let mut statement = conn.prepare(
        "SELECT user_id, skill_key, alpha, beta, mastery_mean, uncertainty,
                evidence_count, distinct_asset_count, recent_error_rate, stability_days,
                last_practiced_at, next_review_at, model_version, explanation_json, updated_at
         FROM learner_skill_state
         ORDER BY user_id, skill_key",
    )?;
    let rows = statement.query_map([], |row| {
        let explanation: Value =
            serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or(Value::Null);
        Ok(SkillState {
            user_id: row.get(0)?,
            skill_key: row.get(1)?,
            alpha: row.get(2)?,
            beta: row.get(3)?,
            mastery_mean: row.get(4)?,
            uncertainty: row.get(5)?,
            evidence_count: row.get::<_, i64>(6)?.max(0) as u64,
            distinct_asset_count: row.get::<_, i64>(7)?.max(0) as u64,
            recent_error_rate: row.get(8)?,
            stability_days: row.get(9)?,
            last_practiced_at: row.get(10)?,
            next_review_at: row.get(11)?,
            model_version: row.get(12)?,
            explanation,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn load_stored_schedules(conn: &Connection) -> DbResult<Vec<ScheduleRecord>> {
    let mut statement = conn.prepare(
        "SELECT user_id, skill_key, due_at, priority, priority_band, preferred_probe,
                avoid_asset_ids_json, reason_codes_json, supporting_observation_ids_json
         FROM skill_review_schedule
         ORDER BY user_id, skill_key",
    )?;
    let rows = statement.query_map([], |row| {
        let preferred_probe = parse_probe(&row.get::<_, String>(5)?).map_err(to_sql_error)?;
        let avoid_asset_ids = parse_string_vec(&row.get::<_, String>(6)?).map_err(to_sql_error)?;
        let reason_codes = parse_string_vec(&row.get::<_, String>(7)?).map_err(to_sql_error)?;
        let supporting_observation_ids =
            parse_string_vec(&row.get::<_, String>(8)?).map_err(to_sql_error)?;
        Ok(ScheduleRecord {
            user_id: row.get(0)?,
            need: SkillReviewNeed {
                skill_key: row.get(1)?,
                priority: row.get(3)?,
                priority_band: row.get(4)?,
                due_at: row.get(2)?,
                preferred_probe,
                avoid_asset_ids,
                reason_codes,
                uncertainty_band: UncertaintyBand::High,
                mastery_mean: 0.0,
                evidence_count: 0,
                distinct_asset_count: 0,
                supporting_observation_ids,
            },
        })
    })?;
    let mut records = rows.collect::<Result<Vec<_>, _>>()?;
    // The schedule table intentionally stores only the scheduling projection;
    // join state for the explanatory fields exposed by the read contract.
    let states = load_stored_states(conn)?;
    let by_key = states
        .into_iter()
        .map(|state| ((state.user_id.clone(), state.skill_key.clone()), state))
        .collect::<BTreeMap<_, _>>();
    for record in &mut records {
        if let Some(state) = by_key.get(&(record.user_id.clone(), record.need.skill_key.clone())) {
            record.need.uncertainty_band = uncertainty_band(state.uncertainty);
            record.need.mastery_mean = state.mastery_mean;
            record.need.evidence_count = state.evidence_count;
            record.need.distinct_asset_count = state.distinct_asset_count;
        }
    }
    Ok(records)
}

fn state_view(state: &SkillState) -> SkillStateView {
    let trend = state
        .explanation
        .get("trend")
        .and_then(|value| serde_json::from_value::<TrendDirection>(value.clone()).ok())
        .unwrap_or(TrendDirection::InsufficientEvidence);
    SkillStateView {
        user_id: state.user_id.clone(),
        skill_key: state.skill_key.clone(),
        mastery_mean: state.mastery_mean,
        uncertainty: state.uncertainty,
        uncertainty_band: uncertainty_band(state.uncertainty),
        trend,
        evidence_count: state.evidence_count,
        distinct_asset_count: state.distinct_asset_count,
        recent_error_rate: state.recent_error_rate,
        stability_days: state.stability_days,
        last_practiced_at: state.last_practiced_at.clone(),
        next_review_at: state.next_review_at.clone(),
        model_version: state.model_version.clone(),
        explanation: state.explanation.clone(),
    }
}

fn reason_codes(state: &SkillState, overdue_factor: f64) -> Vec<String> {
    let mut reasons = Vec::new();
    if state.mastery_mean < 0.5 {
        reasons.push("low_mastery_estimate".into());
    }
    if state.uncertainty > 0.55 {
        reasons.push("high_uncertainty".into());
    }
    if state.recent_error_rate.is_some_and(|rate| rate >= 0.5) {
        reasons.push("recent_errors".into());
    }
    if state.distinct_asset_count < 2 {
        reasons.push("needs_new_asset_transfer".into());
    }
    if overdue_factor > 0.0 {
        reasons.push("review_due".into());
    }
    if reasons.is_empty() {
        reasons.push("stability_check".into());
    }
    reasons
}

fn review_delay_days(state: &SkillState) -> f64 {
    if state.mastery_mean < 0.45 {
        1.0
    } else if state.uncertainty > 0.55 {
        2.0
    } else if state.mastery_mean < 0.70 {
        3.0
    } else {
        state
            .stability_days
            .unwrap_or(3.0)
            .mul_add(1.5, 3.0)
            .clamp(7.0, 30.0)
    }
}

fn update_stability(previous: f64, elapsed_days: f64, outcome: f64, weight: f64) -> f64 {
    if outcome >= 0.5 {
        (previous + elapsed_days.max(1.0) * weight.max(0.1)).clamp(0.0, 365.0)
    } else {
        (previous * 0.5).clamp(0.0, 365.0)
    }
}

fn error_type(question_kind: Option<&str>) -> String {
    match question_kind.unwrap_or("unknown") {
        "tfng" | "true_false_not_given" => "tfng.boundary".into(),
        "yng" | "yes_no_not_given" => "yng.boundary".into(),
        "matching" | "matching_headings" => "matching.evidence_selection".into(),
        kind => format!("reading.{kind}.incorrect"),
    }
}

fn add_days(time: DateTime<Utc>, days: f64) -> DateTime<Utc> {
    time + Duration::seconds((days.max(0.0) * 86_400.0).round() as i64)
}

fn gap_hours(previous: &str, current: &str) -> Option<f64> {
    let previous = parse_time(previous)?;
    let current = parse_time(current)?;
    Some((current - previous).num_seconds() as f64 / 3_600.0)
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn stable_skill_observation_id(
    event_id: &str,
    skill_key: &str,
    mapping_version: i64,
    source_fingerprint: &str,
) -> String {
    let source = format!(
        "{LEARNER_MODEL_PROJECTOR_KEY}|{event_id}|{skill_key}|{mapping_version}|{source_fingerprint}"
    );
    format!("sobs-{}", sha256_hex(&source)[..32].to_string())
}

fn hash_derived(states: &[SkillState], schedules: &[ScheduleRecord]) -> DbResult<String> {
    let mut values = Vec::with_capacity(states.len() + schedules.len());
    for state in states {
        values.push(serde_json::to_string(state).map_err(json_error)?);
    }
    for schedule in schedules {
        values.push(
            serde_json::to_string(&json!({
                "userId": schedule.user_id,
                "need": schedule.need,
            }))
            .map_err(json_error)?,
        );
    }
    values.sort();
    Ok(sha256_hex(&values.join("\n")))
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn probe_key(probe: &SkillReviewProbe) -> &'static str {
    match probe {
        SkillReviewProbe::NovelItem => "novel_item",
        SkillReviewProbe::SameItemRetention => "same_item_retention",
        SkillReviewProbe::ContrastivePair => "contrastive_pair",
        SkillReviewProbe::CoachMicroDrill => "coach_micro_drill",
        SkillReviewProbe::WritingRewrite => "writing_rewrite",
    }
}

fn parse_probe(value: &str) -> Result<SkillReviewProbe, DbError> {
    serde_json::from_value(Value::String(value.to_string())).map_err(json_error)
}

fn count_rows(conn: &Connection, table: &str) -> DbResult<u64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    Ok(conn.query_row(&sql, [], |row| row.get::<_, i64>(0))? as u64)
}

fn parse_string_vec(value: &str) -> Result<Vec<String>, DbError> {
    serde_json::from_str(value).map_err(json_error)
}

fn json_error(error: serde_json::Error) -> DbError {
    DbError::Message(format!("learner JSON error: {error}"))
}

fn to_sql_error(error: DbError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn ensure_response_size<T: Serialize>(value: &T) -> DbResult<()> {
    let size = serde_json::to_vec(value).map_err(json_error)?.len();
    if size > MAX_LEARNER_RESPONSE_BYTES {
        return Err(DbError::Validation(format!(
            "learner response exceeds {MAX_LEARNER_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(())
}
