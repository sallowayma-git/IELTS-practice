//! Reading attempt drafts + idempotent submit with scoring (Phase 6).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptAnswer, AttemptRecord};

use crate::attempts::upsert_attempt;
use crate::history::prune_terminal_attempts_in_transaction;
use crate::learning_events::project_reading_attempt_events_if_enabled;
use crate::modes::timer::{
    load_reading_timer_state, save_reading_timer_state, TimerOwnerScope, TimerState,
};
use crate::reading::assets::{
    load_answer_key, load_controls, load_kinds, load_practice_asset_payload,
};
use crate::reading::scoring::{score_attempt, AnswerComparison, ScoreSummary};
use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadingDraftCommand {
    pub attempt_id: String,
    pub asset_id: String,
    #[serde(default)]
    pub answers: Value,
    #[serde(default)]
    pub marked_questions: Vec<String>,
    #[serde(default)]
    pub question_timeline: Vec<ReadingQuestionProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_snapshot: Option<TimerState>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadingSubmitCommand {
    pub attempt_id: String,
    pub asset_id: String,
    /// Optional optimistic-lock fields from the asset the learner opened.
    /// The answer key is never accepted from the caller.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_fingerprint: Option<String>,
    #[serde(default)]
    pub answers: Value,
    #[serde(default)]
    pub marked_questions: Vec<String>,
    #[serde(default)]
    pub question_timeline: Vec<ReadingQuestionProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadingQuestionProgress {
    pub question_id: String,
    #[serde(default)]
    pub change_count: u32,
    #[serde(default)]
    pub visit_count: u32,
    #[serde(default)]
    pub elapsed_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSubmitResult {
    pub attempt: AttemptRecord,
    pub score: ScoreSummary,
    pub comparisons: Vec<AnswerComparison>,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingOpenDraft {
    pub attempt: AttemptRecord,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer: Option<TimerState>,
}

pub fn save_reading_draft(conn: &Connection, cmd: &ReadingDraftCommand) -> DbResult<AttemptRecord> {
    let tx = conn.unchecked_transaction()?;
    let attempt = save_reading_draft_in_transaction(&tx, cmd)?;
    tx.commit()?;
    Ok(attempt)
}

pub(crate) fn save_reading_draft_in_transaction(
    conn: &Connection,
    cmd: &ReadingDraftCommand,
) -> DbResult<AttemptRecord> {
    save_reading_draft_in_scope(conn, cmd, AttemptMode::Single, None)
}

/// Internal mode adapters must name their ownership up front. They may never
/// create a generic attempt and mutate it into a suite/endless attempt later.
pub(crate) fn save_reading_draft_in_scope(
    conn: &Connection,
    cmd: &ReadingDraftCommand,
    mode: AttemptMode,
    suite_id: Option<&str>,
) -> DbResult<AttemptRecord> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    ensure_open_reading_attempt_scope(conn, &cmd.attempt_id, &cmd.asset_id, mode, suite_id)?;
    let loaded = load_answerable_asset(
        conn,
        &cmd.asset_id,
        cmd.asset_revision,
        cmd.asset_fingerprint.as_deref(),
    )?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let now = chrono::DateTime::from_timestamp_millis(now_ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let started_at: Option<String> = conn
        .query_row(
            "SELECT started_at FROM attempts WHERE id = ?1",
            params![cmd.attempt_id],
            |row| row.get(0),
        )
        .optional()?;
    let duration_ms = cmd
        .timer_snapshot
        .as_ref()
        .map(|timer| timer.elapsed_ms(now_ms))
        .unwrap_or(0);
    let answers = answers_to_vec(&cmd.answers, &cmd.marked_questions, &cmd.question_timeline);
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: Activity::Reading,
        asset_id: Some(cmd.asset_id.clone()),
        mode,
        suite_id: suite_id.map(str::to_string),
        status: AttemptStatus::Draft,
        started_at: started_at.unwrap_or_else(|| now.clone()),
        submitted_at: None,
        completed_at: None,
        duration_ms,
        score_value: None,
        score_scale: None,
        correct_count: None,
        question_count: None,
        title_snapshot: Some(
            cmd.title_snapshot
                .clone()
                .unwrap_or_else(|| loaded.asset.title.clone()),
        ),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations: vec![],
    };
    upsert_attempt(conn, &attempt)?;
    if mode == AttemptMode::Single {
        if let Some(timer) = cmd.timer_snapshot.as_ref() {
            save_reading_timer_state(conn, TimerOwnerScope::Attempt, &cmd.attempt_id, timer)?;
        }
    }
    conn.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('reading.draft', ?1, ?2, NULL, NULL, ?3)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET attempt_id = excluded.attempt_id, created_at = excluded.created_at",
        params![cmd.idempotency_key, cmd.attempt_id, now],
    )?;
    // Remove the obsolete settings mirror. Marks and timeline now live only in
    // attempt_answers, including marked-but-unanswered questions.
    conn.execute(
        "DELETE FROM settings WHERE namespace = 'reading_draft' AND key = ?1",
        params![cmd.attempt_id],
    )?;
    Ok(attempt)
}

pub fn submit_reading_attempt(
    conn: &Connection,
    cmd: &ReadingSubmitCommand,
) -> DbResult<ReadingSubmitResult> {
    let tx = conn.unchecked_transaction()?;
    let result = submit_reading_attempt_in_transaction(&tx, cmd)?;
    if !result.idempotent_replay {
        // The terminal attempt, idempotency response and retention cleanup are
        // one fact. A failed prune rolls the submission back with it.
        prune_terminal_attempts_in_transaction(&tx)?;
    }
    tx.commit()?;
    Ok(result)
}

/// Submit inside a caller-owned transaction. Mode state machines use this so
/// the scored attempt, session advance and mode idempotency record commit or
/// roll back as one fact.
pub(crate) fn submit_reading_attempt_in_transaction(
    conn: &Connection,
    cmd: &ReadingSubmitCommand,
) -> DbResult<ReadingSubmitResult> {
    submit_reading_attempt_in_scope(conn, cmd, AttemptMode::Single, None)
}

pub(crate) fn submit_reading_attempt_in_scope(
    conn: &Connection,
    cmd: &ReadingSubmitCommand,
    mode: AttemptMode,
    suite_id: Option<&str>,
) -> DbResult<ReadingSubmitResult> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }

    // Idempotent replay
    if let Some(prev) =
        lookup_submit_response(conn, &cmd.idempotency_key, &cmd.attempt_id, &cmd.asset_id)?
    {
        return Ok(prev);
    }

    ensure_open_reading_attempt_scope(conn, &cmd.attempt_id, &cmd.asset_id, mode, suite_id)?;

    let loaded = load_answerable_asset(
        conn,
        &cmd.asset_id,
        cmd.asset_revision,
        cmd.asset_fingerprint.as_deref(),
    )?;
    let answer_key = load_answer_key(&loaded.payload);
    if answer_key.is_empty() {
        return Err(DbError::Validation(format!(
            "reading asset is not answerable: {}",
            cmd.asset_id
        )));
    }
    let controls = load_controls(&loaded.payload);
    let kinds = load_kinds(&loaded.payload);
    let user_map = value_to_map(&cmd.answers);

    let (summary, comparisons) = score_attempt(&answer_key, &user_map, &controls, &kinds);
    let now = chrono::Utc::now().to_rfc3339();
    let progress = progress_by_question(&cmd.question_timeline);
    let answers = comparisons
        .iter()
        .map(|c| {
            let timeline = progress.get(&c.question_id);
            AttemptAnswer {
                question_id: c.question_id.clone(),
                answer: c.user_answer.clone(),
                is_correct: c.is_correct,
                weight: c.weight,
                question_kind: c.question_kind.clone(),
                change_count: timeline.map(|p| p.change_count).unwrap_or(0),
                visit_count: timeline.map(|p| p.visit_count).unwrap_or(0),
                elapsed_ms: timeline.map(|p| p.elapsed_ms).unwrap_or(0),
                marked: cmd
                    .marked_questions
                    .iter()
                    .any(|m| crate::reading::scoring::normalize_question_id(m) == c.question_id),
                answered_at: timeline
                    .and_then(|p| p.answered_at.clone())
                    .or_else(|| Some(now.clone())),
            }
        })
        .collect();

    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: Activity::Reading,
        asset_id: Some(cmd.asset_id.clone()),
        mode,
        suite_id: suite_id.map(str::to_string),
        status: AttemptStatus::Completed,
        started_at: now.clone(),
        submitted_at: Some(now.clone()),
        completed_at: Some(now.clone()),
        duration_ms: cmd.duration_ms.unwrap_or(0),
        score_value: Some(summary.accuracy),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(summary.correct),
        question_count: Some(summary.total as u32),
        title_snapshot: Some(loaded.asset.title),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations: vec![],
    };

    upsert_attempt(conn, &attempt)?;
    let result = ReadingSubmitResult {
        attempt: attempt.clone(),
        score: summary.clone(),
        comparisons: comparisons.clone(),
        idempotent_replay: false,
    };
    let response_json =
        serde_json::to_string(&result).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('reading.submit', ?1, ?2, NULL, ?3, ?4)",
        params![cmd.idempotency_key, cmd.attempt_id, response_json, now],
    )?;
    conn.execute(
        "DELETE FROM settings WHERE namespace = 'reading_draft' AND key = ?1",
        params![cmd.attempt_id],
    )?;
    project_reading_attempt_events_if_enabled(conn, &attempt)?;
    Ok(result)
}

#[derive(Debug)]
struct ExistingReadingAttempt {
    activity: String,
    asset_id: Option<String>,
    mode: String,
    suite_id: Option<String>,
    status: String,
}

fn ensure_open_reading_attempt_scope(
    conn: &Connection,
    attempt_id: &str,
    asset_id: &str,
    mode: AttemptMode,
    suite_id: Option<&str>,
) -> DbResult<()> {
    let Some(existing) = load_existing_reading_attempt(conn, attempt_id)? else {
        return Ok(());
    };
    validate_open_reading_attempt_scope(&existing, asset_id, mode, suite_id)
}

fn require_open_standalone_reading_attempt(conn: &Connection, attempt_id: &str) -> DbResult<()> {
    let existing = load_existing_reading_attempt(conn, attempt_id)?.ok_or_else(|| {
        DbError::Validation(format!("reading attempt does not exist: {attempt_id}"))
    })?;
    let asset_id = existing.asset_id.clone().ok_or_else(|| {
        DbError::Validation(format!("reading attempt has no asset: {attempt_id}"))
    })?;
    validate_open_reading_attempt_scope(&existing, &asset_id, AttemptMode::Single, None)
}

fn load_existing_reading_attempt(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<Option<ExistingReadingAttempt>> {
    conn.query_row(
        "SELECT activity, asset_id, mode, suite_id, status FROM attempts WHERE id = ?1",
        params![attempt_id],
        |row| {
            Ok(ExistingReadingAttempt {
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

fn validate_open_reading_attempt_scope(
    existing: &ExistingReadingAttempt,
    asset_id: &str,
    mode: AttemptMode,
    suite_id: Option<&str>,
) -> DbResult<()> {
    let expected_mode = attempt_mode_name(mode);
    let expected_suite_id = suite_id.map(str::trim).filter(|id| !id.is_empty());
    if existing.activity != "reading"
        || existing.asset_id.as_deref() != Some(asset_id)
        || existing.mode != expected_mode
        || existing.suite_id.as_deref() != expected_suite_id
    {
        return Err(DbError::Validation(
            "reading attempt belongs to another mode, session, or asset".into(),
        ));
    }
    if !matches!(existing.status.as_str(), "draft" | "active") {
        return Err(DbError::Validation(
            "only an open reading attempt may be changed".into(),
        ));
    }
    Ok(())
}

fn attempt_mode_name(mode: AttemptMode) -> &'static str {
    match mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

/// Latest draft attempt for an asset, with answers hydrated.
pub fn get_open_reading_draft(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<Option<AttemptRecord>> {
    get_open_reading_draft_for_identity(conn, asset_id, AttemptMode::Single, None)
}

/// Latest open draft for an asset within one practice scope.
/// `None` means a standalone single-passage attempt; a suite id selects only
/// that suite's draft and can never fall through to another session.
pub fn get_open_reading_draft_for_scope(
    conn: &Connection,
    asset_id: &str,
    suite_id: Option<&str>,
) -> DbResult<Option<AttemptRecord>> {
    let suite_id = suite_id.map(str::trim).filter(|value| !value.is_empty());
    let mode = if suite_id.is_some() {
        AttemptMode::Suite
    } else {
        AttemptMode::Single
    };
    get_open_reading_draft_for_identity(conn, asset_id, mode, suite_id)
}

pub fn get_open_reading_draft_with_timer(
    conn: &Connection,
    asset_id: &str,
    suite_id: Option<&str>,
    endless_session_id: Option<&str>,
) -> DbResult<Option<ReadingOpenDraft>> {
    let endless_session_id = endless_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let suite_id = suite_id.map(str::trim).filter(|value| !value.is_empty());
    if suite_id.is_some() && endless_session_id.is_some() {
        return Err(DbError::Validation(
            "reading draft cannot belong to suite and endless simultaneously".into(),
        ));
    }
    let (mode, owner_id) = if let Some(id) = endless_session_id {
        (AttemptMode::Endless, Some(id))
    } else if let Some(id) = suite_id {
        (AttemptMode::Suite, Some(id))
    } else {
        (AttemptMode::Single, None)
    };
    let Some(attempt) = get_open_reading_draft_for_identity(conn, asset_id, mode, owner_id)? else {
        return Ok(None);
    };
    let timer = match mode {
        AttemptMode::Single => {
            load_reading_timer_state(conn, TimerOwnerScope::Attempt, &attempt.id)?
        }
        AttemptMode::Endless => load_reading_timer_state(
            conn,
            TimerOwnerScope::Endless,
            owner_id.expect("endless owner checked"),
        )?,
        _ => None,
    };
    Ok(Some(ReadingOpenDraft { attempt, timer }))
}

fn get_open_reading_draft_for_identity(
    conn: &Connection,
    asset_id: &str,
    mode: AttemptMode,
    owner_id: Option<&str>,
) -> DbResult<Option<AttemptRecord>> {
    let asset_id = asset_id.trim();
    if asset_id.is_empty() {
        return Err(DbError::Validation("asset_id required".into()));
    }
    let owner_id = owner_id.map(str::trim).filter(|value| !value.is_empty());
    let mode_name = match mode {
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        _ => "single",
    };
    // Open drafts include both `draft` and `active`: patch_reading_answer may promote
    // an in-progress attempt to active, and callers must still resume it.
    let attempt_id: Option<String> = conn
        .query_row(
            "SELECT id FROM attempts
             WHERE activity = 'reading' AND asset_id = ?1
               AND lower(status) IN ('draft', 'active')
               AND mode = ?2
               AND ((?3 IS NULL AND suite_id IS NULL) OR suite_id = ?3)
             ORDER BY started_at DESC
             LIMIT 1",
            params![asset_id, mode_name, owner_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(attempt_id) = attempt_id else {
        return Ok(None);
    };

    let mut attempt = conn.query_row(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version
         FROM attempts WHERE id = ?1",
        params![attempt_id],
        |row| {
            let activity = match row.get::<_, String>(1)?.as_str() {
                "writing" => Activity::Writing,
                _ => Activity::Reading,
            };
            let mode = match row.get::<_, String>(3)?.as_str() {
                "suite" => AttemptMode::Suite,
                "endless" => AttemptMode::Endless,
                "memorize" => AttemptMode::Memorize,
                "freeform" => AttemptMode::Freeform,
                "bank" => AttemptMode::Bank,
                _ => AttemptMode::Single,
            };
            let status = match row.get::<_, String>(5)?.as_str() {
                "submitted" => AttemptStatus::Submitted,
                "completed" => AttemptStatus::Completed,
                "cancelled" => AttemptStatus::Cancelled,
                "failed" => AttemptStatus::Failed,
                "active" => AttemptStatus::Active,
                "reviewing" => AttemptStatus::Reviewing,
                "interrupted" => AttemptStatus::Interrupted,
                _ => AttemptStatus::Draft,
            };
            let score_scale = match row.get::<_, Option<String>>(11)? {
                Some(ref s) if s == "band9" => Some(ScoreScale::Band9),
                Some(ref s) if s == "ratio" => Some(ScoreScale::Ratio),
                _ => None,
            };
            Ok(AttemptRecord {
                schema_version: row.get::<_, i64>(17)? as u32,
                id: row.get(0)?,
                activity,
                asset_id: row.get(2)?,
                mode,
                suite_id: row.get(4)?,
                status,
                started_at: row.get(6)?,
                submitted_at: row.get(7)?,
                completed_at: row.get(8)?,
                duration_ms: row.get::<_, i64>(9)? as u64,
                score_value: row.get(10)?,
                score_scale,
                correct_count: row.get(12)?,
                question_count: row.get::<_, Option<i64>>(13)?.map(|v| v as u32),
                title_snapshot: row.get(14)?,
                prompt_snapshot: row.get(15)?,
                content_text: row.get(16)?,
                task_type: None,
                answers: vec![],
                annotations: vec![],
            })
        },
    )?;

    let mut stmt = conn.prepare(
        "SELECT question_id, answer_json, is_correct, weight, question_kind, change_count, visit_count,
                elapsed_ms, marked, answered_at
         FROM attempt_answers WHERE attempt_id = ?1 ORDER BY question_id",
    )?;
    let rows = stmt.query_map(params![attempt.id], |row| {
        let answer_json: String = row.get(1)?;
        let answer = serde_json::from_str(&answer_json).unwrap_or(Value::Null);
        Ok(AttemptAnswer {
            question_id: row.get(0)?,
            answer,
            is_correct: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
            weight: row.get(3)?,
            question_kind: row.get(4)?,
            change_count: row.get::<_, i64>(5)? as u32,
            visit_count: row.get::<_, i64>(6)? as u32,
            elapsed_ms: row.get::<_, i64>(7)? as u64,
            marked: row.get::<_, i64>(8)? != 0,
            answered_at: row.get(9)?,
        })
    })?;
    for row in rows {
        attempt.answers.push(row?);
    }
    Ok(Some(attempt))
}

fn lookup_submit_response(
    conn: &Connection,
    key: &str,
    attempt_id: &str,
    asset_id: &str,
) -> DbResult<Option<ReadingSubmitResult>> {
    let mut stmt = conn.prepare(
        "SELECT response_json FROM attempt_idempotency WHERE scope = 'reading.submit' AND idempotency_key = ?1",
    )?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let mut result: ReadingSubmitResult = serde_json::from_str(&json)
            .map_err(|e| DbError::Message(format!("idempotency parse: {e}")))?;
        if result.attempt.id != attempt_id || result.attempt.asset_id.as_deref() != Some(asset_id) {
            return Err(DbError::Validation(
                "idempotency key belongs to another reading submission".into(),
            ));
        }
        result.idempotent_replay = true;
        Ok(Some(result))
    } else {
        Ok(None)
    }
}

fn value_to_map(v: &Value) -> serde_json::Map<String, Value> {
    match v {
        Value::Object(m) => m
            .iter()
            .map(|(k, val)| {
                (
                    crate::reading::scoring::normalize_question_id(k),
                    val.clone(),
                )
            })
            .collect(),
        _ => serde_json::Map::new(),
    }
}

fn answers_to_vec(
    answers: &Value,
    marked: &[String],
    timeline: &[ReadingQuestionProgress],
) -> Vec<AttemptAnswer> {
    let mut map = value_to_map(answers);
    let progress = progress_by_question(timeline);
    for question_id in marked {
        map.entry(crate::reading::scoring::normalize_question_id(question_id))
            .or_insert(Value::Null);
    }
    for question_id in progress.keys() {
        map.entry(question_id.clone()).or_insert(Value::Null);
    }
    let mut out = Vec::with_capacity(map.len());
    for (qid, ans) in map {
        let timeline = progress.get(&qid);
        let marked_flag = marked
            .iter()
            .any(|x| crate::reading::scoring::normalize_question_id(x) == qid);
        out.push(AttemptAnswer {
            question_id: qid,
            answer: ans,
            is_correct: None,
            weight: 1.0,
            question_kind: None,
            change_count: timeline.map(|p| p.change_count).unwrap_or(0),
            visit_count: timeline.map(|p| p.visit_count).unwrap_or(0),
            elapsed_ms: timeline.map(|p| p.elapsed_ms).unwrap_or(0),
            marked: marked_flag,
            answered_at: timeline.and_then(|p| p.answered_at.clone()),
        });
    }
    out
}

fn progress_by_question(
    timeline: &[ReadingQuestionProgress],
) -> std::collections::HashMap<String, &ReadingQuestionProgress> {
    timeline
        .iter()
        .filter_map(|entry| {
            let qid = crate::reading::scoring::normalize_question_id(&entry.question_id);
            (!qid.is_empty()).then_some((qid, entry))
        })
        .collect()
}

fn load_answerable_asset(
    conn: &Connection,
    asset_id: &str,
    expected_revision: Option<u32>,
    expected_fingerprint: Option<&str>,
) -> DbResult<ielts_domain::dto::PracticeAssetV2Payload> {
    let loaded = load_practice_asset_payload(conn, asset_id)?;
    if loaded.asset.pdf_only {
        return Err(DbError::Validation(format!(
            "reading asset is not answerable: {asset_id}"
        )));
    }
    if let Some(revision) = expected_revision {
        if revision != loaded.asset.schema_version {
            return Err(DbError::Validation(format!(
                "reading asset revision mismatch: {asset_id}"
            )));
        }
    }
    if let Some(fingerprint) = expected_fingerprint {
        if fingerprint.trim() != loaded.asset.fingerprint {
            return Err(DbError::Validation(format!(
                "reading asset fingerprint mismatch: {asset_id}"
            )));
        }
    }
    if load_answer_key(&loaded.payload).is_empty() {
        return Err(DbError::Validation(format!(
            "reading asset is not answerable: {asset_id}"
        )));
    }
    Ok(loaded)
}

/// Incremental answer save without full resubmit.
pub fn patch_reading_answer(
    conn: &Connection,
    attempt_id: &str,
    question_id: &str,
    answer: &Value,
    marked: bool,
) -> DbResult<()> {
    require_open_standalone_reading_attempt(conn, attempt_id)?;
    let qid = crate::reading::scoring::normalize_question_id(question_id);
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attempt_answers (
            attempt_id, question_id, answer_json, is_correct, weight, question_kind,
            change_count, visit_count, elapsed_ms, marked, answered_at
         ) VALUES (?1, ?2, ?3, NULL, 1, NULL, 1, 1, 0, ?4, ?5)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET
            answer_json = excluded.answer_json,
            change_count = attempt_answers.change_count + 1,
            marked = excluded.marked,
            answered_at = excluded.answered_at",
        params![
            attempt_id,
            qid,
            answer.to_string(),
            if marked { 1 } else { 0 },
            now
        ],
    )?;
    // Touch attempt without stranding open drafts:
    // - terminal statuses stay terminal
    // - `draft` stays `draft` so get_open_reading_draft still finds it
    // - other non-terminal statuses become/remain `active`
    conn.execute(
        "UPDATE attempts SET updated_at = ?1,
            status = CASE
                WHEN lower(status) IN ('completed', 'submitted', 'cancelled', 'failed', 'reviewing') THEN status
                WHEN lower(status) = 'draft' THEN 'draft'
                ELSE 'active'
            END
         WHERE id = ?2",
        params![now, attempt_id],
    )?;
    Ok(())
}

pub fn new_attempt_id() -> String {
    format!("reading-{}", Uuid::new_v4())
}

#[allow(dead_code)]
fn _json_touch() -> Value {
    json!({})
}
