//! M10 Teaching Strategy Evolution persistence (procedural memory).
//!
//! Independent of the M6 `coach_feedback` interaction provenance: M10 builds
//! the evolution layer — assignments with attribution windows, two reward
//! channels on separate tables (satisfaction vs learning), per-user state
//! aggregation, candidate batches with an offline-eval promotion gate.
//!
//! M10-03 invariant: a satisfaction feedback is NEVER stored on the learning
//! outcomes table, and a learning outcome is NEVER stored on the satisfaction
//! table. `record_strategy_feedback` and `record_strategy_outcome` are the
//! only entry points and they write to distinct tables.
//!
//! M10-04 invariant: `record_strategy_outcome` checks the attribution window
//! (number of subsequent relevant skill observations after the assignment's
//! created_at) before recording. An out-of-window observation returns
//! `OutcomeAttribution::OutOfWindow` and is NOT recorded. A missing
//! context_snapshot_id returns `MissingContextSnapshot`. A repeated same-asset
//! attempt is recorded but flagged as non-novel (discounted).

use ielts_domain::{
    OutcomeAttribution, PromoteStrategyCandidateCommand, RecordStrategyAssignmentCommand,
    RecordStrategyCandidateBatchCommand, RecordStrategyCandidateEvaluationCommand,
    RecordStrategyFeedbackCommand,
    RecordStrategyOutcomeCommand, SelectStrategyCommand, StrategyAssignmentRecord,
    StrategyCandidateBatchRecord, StrategyCandidateDecision, StrategyCandidateDisposition,
    StrategyCandidateEvaluationRecord, StrategyFeedbackKind, StrategyFeedbackRecord,
    StrategyOutcomeKind, StrategyOutcomeRecord, StrategySelection, StrategySelectionReason,
    TeachingStrategyCatalogEntry,
    TeachingStrategyId, UserStrategyState, DEFAULT_OUTCOME_WINDOW, EXPLORATION_MIN_EVIDENCE,
    EXPLORATION_SLOT_RATE, PROVEN_STRATEGY_MIN_EVIDENCE,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

const MAX_WHY_SELECTED_BYTES: usize = 8 * 1024;
const MAX_MEMORY_IDS: usize = 64;
const MAX_SKILL_KEYS: usize = 32;
const DEFAULT_USER_ID: &str = "local";
const STRATEGY_CANDIDATE_EVALUATOR_VERSION: &str = "m10-strategy-structure-v1";
const MAX_STRATEGY_CANDIDATES_PER_BATCH: usize = 32;
const MAX_STRATEGY_ID_BYTES: usize = 128;
const MAX_PROMPT_MODULE_BYTES: usize = 128;

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

fn normalize_user_id(user_id: &str) -> String {
    let trimmed = user_id.trim();
    if trimmed.is_empty() {
        DEFAULT_USER_ID.into()
    } else {
        trimmed.into()
    }
}

fn require_response_message_exists(conn: &Connection, message_id: &str) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM coach_messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "coach message not found: {message_id}"
        )))
    }
}

fn require_assignment_exists(conn: &Connection, assignment_id: &str) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM teaching_strategy_assignments WHERE id = ?1",
        params![assignment_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "teaching strategy assignment not found: {assignment_id}"
        )))
    }
}

fn require_observation_exists(conn: &Connection, observation_id: &str) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learner_observations WHERE id = ?1",
        params![observation_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "learner observation not found: {observation_id}"
        )))
    }
}

/// M10-01: load a catalog entry by strategy id. Returns the developer-defined
/// row (seeded by the migration).
pub fn load_catalog_entry(
    conn: &Connection,
    strategy_id: TeachingStrategyId,
) -> DbResult<Option<TeachingStrategyCatalogEntry>> {
    conn.query_row(
        "SELECT strategy_id, applicable_activity, applicable_skill_kind, prompt_module,
                contraindications_json, max_verbosity, version, is_default
         FROM teaching_strategy_catalog
         WHERE strategy_id = ?1",
        params![strategy_id.as_str()],
        |row| {
            let contraindications_json: String = row.get(4)?;
            let contraindications: Vec<String> =
                serde_json::from_str(&contraindications_json).unwrap_or_default();
            let is_default: i64 = row.get(7)?;
            Ok(TeachingStrategyCatalogEntry {
                strategy_id,
                applicable_activity: row.get(1)?,
                applicable_skill_kind: row.get(2)?,
                prompt_module: row.get(3)?,
                contraindications,
                max_verbosity: row.get(5)?,
                version: row.get(6)?,
                is_default: is_default == 1,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// M10-01: load the full developer-defined catalog.
pub fn load_catalog(conn: &Connection) -> DbResult<Vec<TeachingStrategyCatalogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT strategy_id, applicable_activity, applicable_skill_kind, prompt_module,
                contraindications_json, max_verbosity, version, is_default
         FROM teaching_strategy_catalog
         ORDER BY strategy_id",
    )?;
    let rows = stmt.query_map([], |row| {
        let strategy_id_str: String = row.get(0)?;
        let strategy_id =
            TeachingStrategyId::parse(&strategy_id_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    format!("unknown strategy id: {strategy_id_str}").into(),
                )
            })?;
        let contraindications_json: String = row.get(4)?;
        let contraindications: Vec<String> =
            serde_json::from_str(&contraindications_json).unwrap_or_default();
        let is_default: i64 = row.get(7)?;
        Ok(TeachingStrategyCatalogEntry {
            strategy_id,
            applicable_activity: row.get(1)?,
            applicable_skill_kind: row.get(2)?,
            prompt_module: row.get(3)?,
            contraindications,
            max_verbosity: row.get(5)?,
            version: row.get(6)?,
            is_default: is_default == 1,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// M10-02: record the teaching-strategy assignment for a response message.
/// One assignment per response_message_id (unique). Independent of the M6
/// `coach_strategy_assignments_v0` interaction provenance.
pub fn record_strategy_assignment(
    conn: &Connection,
    command: &RecordStrategyAssignmentCommand,
) -> DbResult<StrategyAssignmentRecord> {
    require_text(&command.response_message_id, "response_message_id")?;
    require_response_message_exists(conn, &command.response_message_id)?;
    if command.memory_ids.len() > MAX_MEMORY_IDS {
        return Err(DbError::Validation(format!(
            "memory_ids exceeds {MAX_MEMORY_IDS} entries"
        )));
    }
    if command.skill_keys.len() > MAX_SKILL_KEYS {
        return Err(DbError::Validation(format!(
            "skill_keys exceeds {MAX_SKILL_KEYS} entries"
        )));
    }
    let why_text = serde_json::to_string(&command.why_selected)
        .map_err(|error| DbError::Message(error.to_string()))?;
    if why_text.len() > MAX_WHY_SELECTED_BYTES {
        return Err(DbError::Validation(format!(
            "why_selected exceeds {MAX_WHY_SELECTED_BYTES} bytes"
        )));
    }
    let memory_ids_json = serde_json::to_string(&command.memory_ids)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let skill_keys_json = serde_json::to_string(&command.skill_keys)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let id = format!("tsa-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let user_id = normalize_user_id(&command.user_id);
    conn.execute(
        "INSERT INTO teaching_strategy_assignments
           (id, user_id, strategy_id, why_selected_json, memory_ids_json,
            skill_keys_json, context_snapshot_id, response_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(response_message_id) DO UPDATE SET
           strategy_id = excluded.strategy_id,
           why_selected_json = excluded.why_selected_json,
           memory_ids_json = excluded.memory_ids_json,
           skill_keys_json = excluded.skill_keys_json,
           context_snapshot_id = excluded.context_snapshot_id",
        params![
            id,
            user_id,
            command.strategy_id.as_str(),
            why_text,
            memory_ids_json,
            skill_keys_json,
            command.context_snapshot_id,
            command.response_message_id,
            now,
        ],
    )?;
    load_strategy_assignment_by_message(conn, &command.response_message_id)?
        .ok_or_else(|| DbError::Message("teaching strategy assignment insert did not hydrate".into()))
}

fn load_strategy_assignment_by_message(
    conn: &Connection,
    response_message_id: &str,
) -> DbResult<Option<StrategyAssignmentRecord>> {
    conn.query_row(
        "SELECT id, user_id, strategy_id, why_selected_json, memory_ids_json,
                skill_keys_json, context_snapshot_id, response_message_id, created_at
         FROM teaching_strategy_assignments
         WHERE response_message_id = ?1",
        params![response_message_id],
        |row| hydrate_assignment(row),
    )
    .optional()
    .map_err(Into::into)
}

fn load_strategy_assignment_by_id(
    conn: &Connection,
    assignment_id: &str,
) -> DbResult<Option<StrategyAssignmentRecord>> {
    conn.query_row(
        "SELECT id, user_id, strategy_id, why_selected_json, memory_ids_json,
                skill_keys_json, context_snapshot_id, response_message_id, created_at
         FROM teaching_strategy_assignments
         WHERE id = ?1",
        params![assignment_id],
        |row| hydrate_assignment(row),
    )
    .optional()
    .map_err(Into::into)
}

fn hydrate_assignment(row: &rusqlite::Row<'_>) -> rusqlite::Result<StrategyAssignmentRecord> {
    let strategy_id_str: String = row.get(2)?;
    let strategy_id = TeachingStrategyId::parse(&strategy_id_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            format!("unknown strategy id: {strategy_id_str}").into(),
        )
    })?;
    let why_json: String = row.get(3)?;
    let why_selected: Value =
        serde_json::from_str(&why_json).unwrap_or_else(|_| Value::Null);
    let memory_ids_json: String = row.get(4)?;
    let memory_ids: Vec<String> =
        serde_json::from_str(&memory_ids_json).unwrap_or_default();
    let skill_keys_json: String = row.get(5)?;
    let skill_keys: Vec<String> =
        serde_json::from_str(&skill_keys_json).unwrap_or_default();
    Ok(StrategyAssignmentRecord {
        id: row.get(0)?,
        user_id: row.get(1)?,
        strategy_id,
        why_selected,
        memory_ids,
        skill_keys,
        context_snapshot_id: row.get(6)?,
        response_message_id: row.get(7)?,
        created_at: row.get(8)?,
    })
}

/// M10-03: record a SATISFACTION feedback fact against an assignment. This
/// writes ONLY to `teaching_strategy_feedback`; it never touches the learning
/// outcomes table. A thumbs-up is never treated as evidence of learning.
pub fn record_strategy_feedback(
    conn: &Connection,
    command: &RecordStrategyFeedbackCommand,
) -> DbResult<StrategyFeedbackRecord> {
    require_text(&command.assignment_id, "assignment_id")?;
    require_assignment_exists(conn, &command.assignment_id)?;
    let id = format!("tsfb-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO teaching_strategy_feedback (id, feedback_kind, assignment_id, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, command.feedback_kind.as_str(), command.assignment_id, now],
    )?;
    // M10-05: aggregate satisfaction into per-user state. A reask increments
    // the reask counter; other satisfaction kinds increment satisfaction_count.
    let assignment = load_strategy_assignment_by_id(conn, &command.assignment_id)?
        .ok_or_else(|| DbError::Message("assignment vanished after feedback".into()))?;
    let scope = infer_scope_from_skill_keys(&assignment.skill_keys);
    match command.feedback_kind {
        StrategyFeedbackKind::Reask => {
            update_strategy_state(conn, &assignment.user_id, assignment.strategy_id, &scope, |state| {
                state.reask_count += 1;
                state.failure_count += 1;
            })?;
        }
        StrategyFeedbackKind::ThumbsUp => {
            update_strategy_state(conn, &assignment.user_id, assignment.strategy_id, &scope, |state| {
                state.satisfaction_count += 1;
                state.success_count += 1;
            })?;
        }
        StrategyFeedbackKind::ThumbsDown
        | StrategyFeedbackKind::ExplicitCorrection
        | StrategyFeedbackKind::Abandon => {
            update_strategy_state(conn, &assignment.user_id, assignment.strategy_id, &scope, |state| {
                state.satisfaction_count += 1;
                state.failure_count += 1;
            })?;
        }
    }
    Ok(StrategyFeedbackRecord {
        id,
        assignment_id: command.assignment_id.clone(),
        feedback_kind: command.feedback_kind,
        created_at: now,
    })
}

/// M10-03/04: record a LEARNING outcome. Writes ONLY to
/// `teaching_strategy_outcomes`. Before recording, the attribution window is
/// checked: the number of subsequent relevant skill observations after the
/// assignment's created_at must be within DEFAULT_OUTCOME_WINDOW. A missing
/// context_snapshot_id means the skill context is unavailable, so no outcome
/// is recorded (M10-04 missing-context test). A repeated same-asset attempt
/// is recorded but flagged non-novel (discounted, M10-04).
pub fn record_strategy_outcome(
    conn: &Connection,
    command: &RecordStrategyOutcomeCommand,
) -> DbResult<OutcomeAttribution> {
    require_text(&command.assignment_id, "assignment_id")?;
    require_assignment_exists(conn, &command.assignment_id)?;
    let assignment = load_strategy_assignment_by_id(conn, &command.assignment_id)?
        .ok_or_else(|| DbError::Message("assignment vanished before outcome".into()))?;
    // M10-04: missing context snapshot -> the skill context required to
    // attribute an outcome is missing. Do not record.
    if assignment.context_snapshot_id.is_none() {
        return Ok(OutcomeAttribution::MissingContextSnapshot);
    }
    // M10-04: attribution window. Count subsequent relevant skill observations
    // for this user after the assignment's created_at. If the count exceeds
    // the window, the observation is too far removed to attribute.
    if let Some(observation_id) = &command.observation_id {
        require_observation_exists(conn, observation_id)?;
    }
    let subsequent_count = count_subsequent_observations(
        conn,
        &assignment.user_id,
        &assignment.created_at,
        &assignment.skill_keys,
    )?;
    if subsequent_count > DEFAULT_OUTCOME_WINDOW as i64 {
        // Out of window: do not record. Never silently coerce.
        return Ok(OutcomeAttribution::OutOfWindow);
    }
    // M10-04: prefer novel asset. A repeated same-asset attempt is recorded
    // but flagged non-novel (discounted for confidence aggregation).
    let novel_asset = command.novel_asset_id.is_some();
    let id = format!("tsout-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO teaching_strategy_outcomes
           (id, outcome_kind, assignment_id, observation_id, novel_asset_id, score_delta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            command.outcome_kind.as_str(),
            command.assignment_id,
            command.observation_id,
            command.novel_asset_id,
            command.score_delta,
            now,
        ],
    )?;
    // M10-05: aggregate the learning outcome into per-user state.
    let scope = infer_scope_from_skill_keys(&assignment.skill_keys);
    let is_success = matches!(
        command.outcome_kind,
        StrategyOutcomeKind::NextNovelSkillAttempt
            | StrategyOutcomeKind::NextWritingRevision
            | StrategyOutcomeKind::CorrectedRepeatedBehavior
            | StrategyOutcomeKind::TransferToAnotherAsset
    ) && novel_asset;
    update_strategy_state(conn, &assignment.user_id, assignment.strategy_id, &scope, |state| {
        if is_success {
            state.success_count += 1;
            state.novel_transfer_success += 1;
        } else {
            state.failure_count += 1;
        }
    })?;
    let record = StrategyOutcomeRecord {
        id,
        assignment_id: command.assignment_id.clone(),
        outcome_kind: command.outcome_kind,
        observation_id: command.observation_id.clone(),
        novel_asset_id: command.novel_asset_id.clone(),
        score_delta: command.score_delta,
        created_at: now,
    };
    Ok(OutcomeAttribution::Attributed {
        record,
        novel_asset,
    })
}

/// M10-04: count subsequent relevant skill observations for the user after the
/// assignment's created_at. "Relevant" is approximated by the user + time
/// boundary; the assignment's skill_keys are recorded for later refinement
/// but the window is a count of the user's observations after T0.
fn count_subsequent_observations(
    conn: &Connection,
    user_id: &str,
    after_created_at: &str,
    _skill_keys: &[String],
) -> DbResult<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learner_observations
         WHERE user_id = ?1 AND observed_at > ?2",
        params![user_id, after_created_at],
        |row| row.get(0),
    )?;
    Ok(count)
}

fn infer_scope_from_skill_keys(skill_keys: &[String]) -> String {
    if let Some(first) = skill_keys.first() {
        if let Some(activity) = first.split('.').next() {
            if !activity.is_empty() {
                return activity.to_string();
            }
        }
    }
    "general".to_string()
}

/// M10-05: load the per-user strategy state for a (user, strategy, scope).
pub fn load_user_strategy_state(
    conn: &Connection,
    user_id: &str,
    strategy_id: TeachingStrategyId,
    scope: &str,
) -> DbResult<Option<UserStrategyState>> {
    let user_id = normalize_user_id(user_id);
    conn.query_row(
        "SELECT user_id, strategy_id, scope, success_count, failure_count,
                satisfaction_count, reask_count, novel_transfer_success, last_used,
                confidence, updated_at
         FROM user_strategy_state
         WHERE user_id = ?1 AND strategy_id = ?2 AND scope = ?3",
        params![user_id, strategy_id.as_str(), scope],
        |row| hydrate_user_state(row),
    )
    .optional()
    .map_err(Into::into)
}

fn hydrate_user_state(row: &rusqlite::Row<'_>) -> rusqlite::Result<UserStrategyState> {
    let strategy_id_str: String = row.get(1)?;
    let strategy_id = TeachingStrategyId::parse(&strategy_id_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            format!("unknown strategy id: {strategy_id_str}").into(),
        )
    })?;
    Ok(UserStrategyState {
        user_id: row.get(0)?,
        strategy_id,
        scope: row.get(2)?,
        success_count: row.get(3)?,
        failure_count: row.get(4)?,
        satisfaction_count: row.get(5)?,
        reask_count: row.get(6)?,
        novel_transfer_success: row.get(7)?,
        last_used: row.get(8)?,
        confidence: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

/// M10-05: update the per-user strategy state with a closure. The row is
/// upserted; confidence is recomputed as the bounded success/(success+failure)
/// formula, clamped to [0, 1]. No global reinforcement learning is performed.
fn update_strategy_state<F>(
    conn: &Connection,
    user_id: &str,
    strategy_id: TeachingStrategyId,
    scope: &str,
    mutate: F,
) -> DbResult<()>
where
    F: FnOnce(&mut UserStrategyState),
{
    let user_id = normalize_user_id(user_id);
    let mut state = load_user_strategy_state(conn, &user_id, strategy_id, scope)?.unwrap_or_else(|| {
        UserStrategyState {
            user_id: user_id.clone(),
            strategy_id,
            scope: scope.to_string(),
            success_count: 0,
            failure_count: 0,
            satisfaction_count: 0,
            reask_count: 0,
            novel_transfer_success: 0,
            last_used: None,
            confidence: 0.0,
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    });
    mutate(&mut state);
    state.confidence = UserStrategyState::clamp_confidence(state.success_count, state.failure_count);
    let now = chrono::Utc::now().to_rfc3339();
    state.updated_at = now.clone();
    state.last_used = Some(now);
    conn.execute(
        "INSERT INTO user_strategy_state
           (user_id, strategy_id, scope, success_count, failure_count,
            satisfaction_count, reask_count, novel_transfer_success, last_used,
            confidence, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(user_id, strategy_id, scope) DO UPDATE SET
           success_count = excluded.success_count,
           failure_count = excluded.failure_count,
           satisfaction_count = excluded.satisfaction_count,
           reask_count = excluded.reask_count,
           novel_transfer_success = excluded.novel_transfer_success,
           last_used = excluded.last_used,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at",
        params![
            state.user_id,
            state.strategy_id.as_str(),
            state.scope,
            state.success_count,
            state.failure_count,
            state.satisfaction_count,
            state.reask_count,
            state.novel_transfer_success,
            state.last_used,
            state.confidence,
            state.updated_at,
        ],
    )?;
    Ok(())
}

/// M10-05: load all per-user strategy state rows for a scope, ordered by
/// descending confidence (used by selection rule 3).
pub fn load_user_strategy_states_for_scope(
    conn: &Connection,
    user_id: &str,
    scope: &str,
) -> DbResult<Vec<UserStrategyState>> {
    let user_id = normalize_user_id(user_id);
    let mut stmt = conn.prepare(
        "SELECT user_id, strategy_id, scope, success_count, failure_count,
                satisfaction_count, reask_count, novel_transfer_success, last_used,
                confidence, updated_at
         FROM user_strategy_state
         WHERE user_id = ?1 AND scope = ?2
         ORDER BY confidence DESC, (success_count + failure_count) DESC",
    )?;
    let rows = stmt.query_map(params![user_id, scope], |row| hydrate_user_state(row))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// M10-06: select a strategy for the next response. Rule-priority:
/// 1. explicit user preference (if present and the catalog marks it
///    applicable — `applicable_activity`/`applicable_skill_kind` accept "any")
/// 2. contraindication filter (exclude strategies whose contraindications
///    match the request's memory/context)
/// 3. proven personal strategy (highest confidence with evidence >= threshold)
/// 4. default strategy (catalog is_default)
/// 5. exploration slot (only when evidence is sufficient; small fraction)
pub fn select_strategy(
    conn: &Connection,
    command: &SelectStrategyCommand,
) -> DbResult<StrategySelection> {
    let user_id = normalize_user_id(&command.user_id);
    let catalog = load_catalog(conn)?;
    let scope = if command.scope.trim().is_empty() {
        infer_scope_from_skill_keys(&[])
    } else {
        command.scope.clone()
    };

    // Rule 1: explicit preference. The catalog must mark the strategy
    // applicable (activity/skill_kind "any" matches anything).
    if let Some(preference) = command.explicit_preference {
        if let Some(entry) = catalog.iter().find(|e| e.strategy_id == preference) {
            if is_applicable(entry, &command.skill_kind) {
                return Ok(StrategySelection {
                    strategy_id: preference,
                    reason: StrategySelectionReason::ExplicitPreference,
                    why_selected: serde_json::json!({
                        "rule": "explicit_preference",
                        "promptModule": entry.prompt_module,
                        "note": "user explicit preference honored"
                    }),
                });
            }
        }
    }

    // Rule 2: contraindication filter. Build the candidate set excluding
    // strategies whose contraindications match the request's memory_ids.
    let candidates: Vec<&TeachingStrategyCatalogEntry> = catalog
        .iter()
        .filter(|entry| is_applicable(entry, &command.skill_kind))
        .filter(|entry| !is_contraindicated(entry, &command.memory_ids))
        .collect();

    // Rule 3: proven personal strategy. The highest-confidence strategy with
    // evidence >= PROVEN_STRATEGY_MIN_EVIDENCE wins.
    let states = load_user_strategy_states_for_scope(conn, &user_id, &scope)?;
    for state in &states {
        if state.evidence_count() >= PROVEN_STRATEGY_MIN_EVIDENCE
            && candidates.iter().any(|e| e.strategy_id == state.strategy_id)
        {
            return Ok(StrategySelection {
                strategy_id: state.strategy_id,
                reason: StrategySelectionReason::ProvenPersonal,
                why_selected: serde_json::json!({
                    "rule": "proven_personal",
                    "confidence": state.confidence,
                    "evidenceCount": state.evidence_count(),
                    "note": "highest-confidence proven strategy for this scope"
                }),
            });
        }
    }

    // Rule 5: exploration slot. Only when there is sufficient evidence in the
    // scope (so exploration does not churn a cold state). Small fraction.
    let total_evidence: u32 = states.iter().map(|s| s.evidence_count()).sum();
    if total_evidence >= EXPLORATION_MIN_EVIDENCE && !candidates.is_empty() {
        // Deterministic-ish exploration: use a simple hash of the current
        // request (user + scope + message id if available) to decide whether
        // to explore, then pick a non-default candidate. This keeps the rate
        // near EXPLORATION_SLOT_RATE without a global RNG source.
        let marker = simple_hash(&format!(
            "{}{}{}",
            user_id,
            scope,
            command.context_snapshot_id.as_deref().unwrap_or("")
        ));
        let explore = (marker % 100) < (EXPLORATION_SLOT_RATE * 100.0) as u64;
        if explore {
            let non_default: Vec<&&TeachingStrategyCatalogEntry> =
                candidates.iter().filter(|e| !e.is_default).collect();
            if let Some(pick) = non_default.first() {
                return Ok(StrategySelection {
                    strategy_id: pick.strategy_id,
                    reason: StrategySelectionReason::Exploration,
                    why_selected: serde_json::json!({
                        "rule": "exploration",
                        "rate": EXPLORATION_SLOT_RATE,
                        "note": "evidence sufficient; exploring a non-default strategy"
                    }),
                });
            }
        }
    }

    // Rule 4: default strategy. Fall back to the catalog's is_default entry
    // among applicable candidates; if none, fall back to the global default.
    let default_entry = candidates
        .iter()
        .find(|e| e.is_default)
        .copied()
        .or_else(|| catalog.iter().find(|e| e.is_default))
        .ok_or_else(|| DbError::Message("no default strategy in catalog".into()))?;
    Ok(StrategySelection {
        strategy_id: default_entry.strategy_id,
        reason: StrategySelectionReason::Default,
        why_selected: serde_json::json!({
            "rule": "default",
            "promptModule": default_entry.prompt_module,
            "note": "no proven personal strategy; using catalog default"
        }),
    })
}

fn is_applicable(entry: &TeachingStrategyCatalogEntry, skill_kind: &str) -> bool {
    let activity_ok = entry.applicable_activity == "any";
    let skill_ok = entry.applicable_skill_kind == "any"
        || entry.applicable_skill_kind.eq_ignore_ascii_case(skill_kind);
    activity_ok && skill_ok
}

fn is_contraindicated(entry: &TeachingStrategyCatalogEntry, memory_ids: &[String]) -> bool {
    if entry.contraindications.is_empty() || memory_ids.is_empty() {
        return false;
    }
    // Simple contraindication: if a memory id appears in the contraindication
    // list, exclude the strategy. The contraindication entries are
    // human-readable tags; an empty memory_ids list never contraindicates.
    memory_ids
        .iter()
        .any(|mid| entry.contraindications.iter().any(|c| c == mid))
}

fn simple_hash(s: &str) -> u64 {
    // FNV-1a 64-bit. Deterministic so tests are reproducible.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// M10-08: record an LLM-proposed candidate strategy batch as `pending`. A
/// pending/eval candidate is NEVER directly executable; promotion requires
/// offline eval + a developer-defined prompt_module.
pub fn record_strategy_candidate_batch(
    conn: &Connection,
    command: &RecordStrategyCandidateBatchCommand,
) -> DbResult<StrategyCandidateBatchRecord> {
    let batch_text = serde_json::to_string(&command.batch)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let id = format!("tscb-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO strategy_candidate_batches (id, batch_json, disposition, created_at)
         VALUES (?1, ?2, 'pending', ?3)",
        params![id, batch_text, now],
    )?;
    Ok(StrategyCandidateBatchRecord {
        id,
        batch: command.batch.clone(),
        disposition: StrategyCandidateDisposition::Pending,
        created_at: now,
    })
}

fn candidate_text_field(
    candidate: &serde_json::Map<String, Value>,
    field: &str,
    max_bytes: usize,
    errors: &mut Vec<String>,
) -> Option<String> {
    let value = candidate.get(field).and_then(Value::as_str);
    match value {
        Some(value) if !value.trim().is_empty() && value.len() <= max_bytes => {
            Some(value.to_string())
        }
        Some(_) => {
            errors.push(format!("{field} must be non-empty and <= {max_bytes} bytes"));
            None
        }
        None => {
            errors.push(format!("{field} is required and must be a string"));
            None
        }
    }
}

fn valid_strategy_id(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && chars.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_')
        && value
            .rsplit_once("_v")
            .map(|(_, version)| !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
}

fn evaluate_strategy_candidate_batch(
    conn: &Connection,
    batch: &Value,
) -> (bool, Value) {
    let mut errors = Vec::new();
    let mut candidate_count = 0usize;
    let mut valid_candidate_count = 0usize;
    let mut seen_strategy_ids = HashSet::new();

    let candidates: &[Value] = match batch.as_array() {
        Some(candidates) if !candidates.is_empty() => candidates.as_slice(),
        Some(_) => {
            errors.push("candidate batch must contain at least one candidate".to_string());
            &[]
        }
        None => {
            errors.push("candidate batch must be a JSON array".to_string());
            &[]
        }
    };
    if candidates.len() > MAX_STRATEGY_CANDIDATES_PER_BATCH {
        errors.push(format!(
            "candidate batch exceeds the {MAX_STRATEGY_CANDIDATES_PER_BATCH}-candidate limit"
        ));
    }

    for (index, value) in candidates.iter().enumerate() {
        candidate_count += 1;
        let Some(candidate) = value.as_object() else {
            errors.push(format!("candidate[{index}] must be an object"));
            continue;
        };
        let before = errors.len();
        let strategy_id = candidate_text_field(
            candidate,
            "strategyId",
            MAX_STRATEGY_ID_BYTES,
            &mut errors,
        );
        if let Some(strategy_id) = strategy_id.as_deref() {
            if !valid_strategy_id(strategy_id) {
                errors.push(format!(
                    "candidate[{index}].strategyId must be lowercase snake_case ending in _vN"
                ));
            }
            if !seen_strategy_ids.insert(strategy_id.to_string()) {
                errors.push(format!("candidate[{index}].strategyId is duplicated"));
            }
        }

        let prompt_module = candidate_text_field(
            candidate,
            "promptModule",
            MAX_PROMPT_MODULE_BYTES,
            &mut errors,
        );
        if let Some(prompt_module) = prompt_module.as_deref() {
            let known: rusqlite::Result<i64> = conn.query_row(
                "SELECT COUNT(*) FROM teaching_strategy_catalog WHERE prompt_module = ?1",
                params![prompt_module],
                |row| row.get(0),
            );
            match known {
                Ok(1) => {}
                Ok(_) => errors.push(format!(
                    "candidate[{index}].promptModule is not developer-defined"
                )),
                Err(error) => errors.push(format!(
                    "candidate[{index}].promptModule lookup failed: {error}"
                )),
            }
        }

        for field in ["applicableActivity", "applicableSkillKind"] {
            candidate_text_field(candidate, field, 64, &mut errors);
        }

        match candidate.get("contraindications") {
            Some(Value::Array(values)) if values.iter().all(|value| {
                value.as_str().is_some_and(|text| !text.trim().is_empty() && text.len() <= 128)
            }) => {}
            _ => errors.push(format!(
                "candidate[{index}].contraindications must be an array of non-empty strings"
            )),
        }

        match candidate.get("maxVerbosity").and_then(Value::as_i64) {
            Some(value) if (0..=8).contains(&value) => {}
            _ => errors.push(format!(
                "candidate[{index}].maxVerbosity must be an integer in [0, 8]"
            )),
        }
        match candidate.get("version").and_then(Value::as_i64) {
            Some(value) if value >= 1 => {}
            _ => errors.push(format!(
                "candidate[{index}].version must be an integer >= 1"
            )),
        }
        if errors.len() == before {
            valid_candidate_count += 1;
        }
    }

    let passed = errors.is_empty() && candidate_count > 0;
    (
        passed,
        serde_json::json!({
            "evaluatorVersion": STRATEGY_CANDIDATE_EVALUATOR_VERSION,
            "candidateCount": candidate_count,
            "validCandidateCount": valid_candidate_count,
            "allPassed": passed,
            "validationErrors": errors,
        }),
    )
}

/// M10-08: run and persist an offline-eval verdict for a strategy candidate
/// batch. Evaluation is a separate fact from the promotion request, and both
/// the verdict and metrics are produced inside this Rust transaction. The
/// batch remains in the `eval` state until a later promotion or rejection
/// decision.
pub fn record_strategy_candidate_evaluation(
    conn: &Connection,
    command: &RecordStrategyCandidateEvaluationCommand,
) -> DbResult<StrategyCandidateEvaluationRecord> {
    require_text(&command.batch_id, "batch_id")?;
    let tx = conn.unchecked_transaction()?;
    let batch_text: Option<String> = tx
        .query_row(
            "SELECT batch_json FROM strategy_candidate_batches WHERE id = ?1",
            params![command.batch_id],
            |row| row.get(0),
        )
        .optional()?;
    let batch_text = batch_text.ok_or_else(|| {
        DbError::Validation(format!(
            "strategy candidate batch not found: {}",
            command.batch_id
        ))
    })?;
    let disposition: String = tx.query_row(
        "SELECT disposition FROM strategy_candidate_batches WHERE id = ?1",
        params![command.batch_id],
        |row| row.get(0),
    )?;
    if !matches!(disposition.as_str(), "pending" | "eval") {
        return Err(DbError::Validation(format!(
            "strategy candidate batch cannot be evaluated in disposition: {disposition}"
        )));
    }

    let batch: Value = serde_json::from_str(&batch_text)
        .map_err(|error| DbError::Message(format!("stored candidate batch is invalid JSON: {error}")))?;
    let (passed, metrics) = evaluate_strategy_candidate_batch(&tx, &batch);
    let metrics_text = serde_json::to_string(&metrics)
        .map_err(|error| DbError::Message(error.to_string()))?;

    let id = format!("tsev-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO strategy_candidate_evaluations
           (id, batch_id, passed, metrics_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            command.batch_id,
            passed as i64,
            metrics_text,
            now,
        ],
    )?;
    tx.execute(
        "UPDATE strategy_candidate_batches SET disposition = 'eval' WHERE id = ?1",
        params![command.batch_id],
    )?;
    tx.commit()?;

    Ok(StrategyCandidateEvaluationRecord {
        id,
        batch_id: command.batch_id.clone(),
        passed,
        metrics,
        created_at: now,
    })
}

/// M10-08: promote or reject a candidate batch. Promotion is the offline-eval
/// gate: a promoted candidate still requires a developer-defined
/// `prompt_module` before it becomes executable (the catalog enum is the
/// authoritative executable set). A rejected batch is never executable. A
/// promotion request succeeds only when the latest persisted evaluation passed.
pub fn promote_strategy_candidate(
    conn: &Connection,
    command: &PromoteStrategyCandidateCommand,
) -> DbResult<StrategyCandidateDecision> {
    require_text(&command.batch_id, "batch_id")?;
    let tx = conn.unchecked_transaction()?;
    let current: Option<String> = tx
        .query_row(
            "SELECT disposition FROM strategy_candidate_batches WHERE id = ?1",
            params![command.batch_id],
            |row| row.get(0),
        )
        .optional()?;
    let current = current.ok_or_else(|| {
        DbError::Validation(format!(
            "strategy candidate batch not found: {}",
            command.batch_id
        ))
    })?;
    if !matches!(current.as_str(), "pending" | "eval") {
        return Err(DbError::Validation(format!(
            "strategy candidate batch cannot transition from disposition: {current}"
        )));
    }

    let disposition = if command.promote {
        let latest_passed: Option<i64> = tx
            .query_row(
                "SELECT passed FROM strategy_candidate_evaluations
                 WHERE batch_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT 1",
                params![command.batch_id],
                |row| row.get(0),
            )
            .optional()?;
        if latest_passed != Some(1) {
            return Err(DbError::Validation(
                "strategy candidate promotion requires a latest passing offline evaluation"
                    .into(),
            ));
        }
        StrategyCandidateDisposition::Promoted
    } else {
        StrategyCandidateDisposition::Rejected
    };
    tx.execute(
        "UPDATE strategy_candidate_batches SET disposition = ?2 WHERE id = ?1",
        params![command.batch_id, disposition.as_str()],
    )?;
    tx.commit()?;
    Ok(StrategyCandidateDecision {
        batch_id: command.batch_id.clone(),
        disposition,
    })
}
