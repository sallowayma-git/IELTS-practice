//! Listening drafts and idempotent submit with scoring.
//!
//! The wire shape is the reading shape: a listening client sends exactly the
//! same `ReadingDraftCommand` / `ReadingSubmitCommand` fields, so the two
//! activities can never drift into different request contracts. Persistence is
//! independent: this module never touches the reading submit transaction.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptAnswer, AttemptRecord, PracticeAssetV2Payload};

use crate::attempts::upsert_attempt;
use crate::history::prune_terminal_attempts_in_transaction;
use crate::attempts::persist_completed_attempt;
use crate::listening::assets::load_listening_payload;
use crate::listening::question_kinds::load_kinds;
use crate::reading::assets::load_answer_key;
use crate::reading::attempt::{
    answers_to_vec, progress_by_question, value_to_map, ReadingDraftCommand,
    ReadingQuestionProgress, ReadingSubmitCommand,
};
use crate::reading::scoring::{compare_answer, normalize_question_id, question_weight};
use crate::sqlite::{DbError, DbResult};

pub type ListeningDraftCommand = ReadingDraftCommand;
pub type ListeningSubmitCommand = ReadingSubmitCommand;
pub type ListeningQuestionProgress = ReadingQuestionProgress;

const DRAFT_POSITION_NS: &str = "listening_draft";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListeningDraftPosition {
    pub part: u8,
    pub question_id: Option<String>,
    pub audio_position_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenListeningDraft {
    #[serde(flatten)]
    pub attempt: AttemptRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_position: Option<ListeningDraftPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSubmitResult {
    pub attempt: AttemptRecord,
    pub score_value: f64,
    pub correct_count: f64,
    pub question_count: u32,
    pub idempotent_replay: bool,
}

pub fn save_listening_draft(
    conn: &Connection,
    cmd: &ListeningDraftCommand,
) -> DbResult<AttemptRecord> {
    save_listening_draft_with_position(conn, cmd, None)
}

pub fn save_listening_draft_with_position(
    conn: &Connection,
    cmd: &ListeningDraftCommand,
    position: Option<&ListeningDraftPosition>,
) -> DbResult<AttemptRecord> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    let tx = conn.unchecked_transaction()?;
    let attempt = save_listening_draft_in_transaction(&tx, cmd, position)?;
    tx.commit()?;
    Ok(attempt)
}

fn save_listening_draft_in_transaction(
    conn: &Connection,
    cmd: &ListeningDraftCommand,
    position: Option<&ListeningDraftPosition>,
) -> DbResult<AttemptRecord> {
    ensure_open_listening_attempt(conn, &cmd.attempt_id, &cmd.asset_id)?;
    let loaded = load_answerable_listening_asset(
        conn,
        &cmd.asset_id,
        cmd.asset_revision,
        cmd.asset_fingerprint.as_deref(),
    )?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let now = chrono::DateTime::from_timestamp_millis(now_ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339();
    let previous: Option<(String, u64)> = conn
        .query_row(
            "SELECT started_at, duration_ms FROM attempts WHERE id = ?1",
            params![cmd.attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let duration_ms = cmd
        .timer_snapshot
        .as_ref()
        .map(|timer| timer.elapsed_ms(now_ms))
        .unwrap_or_else(|| previous.as_ref().map_or(0, |(_, duration)| *duration));
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: Activity::Listening,
        asset_id: Some(cmd.asset_id.clone()),
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Draft,
        started_at: previous.map_or_else(|| now.clone(), |(started_at, _)| started_at),
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
        answers: answers_to_vec(&cmd.answers, &cmd.marked_questions, &cmd.question_timeline),
        annotations: vec![],
    };
    upsert_attempt(conn, &attempt)?;
    if let Some(position) = position {
        if !(1..=4).contains(&position.part) || position.audio_position_ms > 86_400_000
            || !loaded.payload["questionGroups"].as_array().is_some_and(|groups| {
                groups.iter().any(|group| {
                    group["section"].as_u64() == Some(u64::from(position.part))
                        && position.question_id.as_ref().is_none_or(|id| {
                            group["questionIds"].as_array().is_some_and(|ids| ids.iter().any(|q| q.as_str() == Some(id)))
                        })
                })
            })
        {
            return Err(DbError::Validation("听力草稿位置与试题不匹配".into()));
        }
        crate::settings::upsert_setting(conn, DRAFT_POSITION_NS, &attempt.id, &serde_json::json!(position))?;
    }
    conn.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('listening.draft', ?1, ?2, NULL, NULL, ?3)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET attempt_id = excluded.attempt_id, created_at = excluded.created_at",
        params![cmd.idempotency_key, cmd.attempt_id, now],
    )?;
    Ok(attempt)
}

pub fn get_open_listening_draft_with_position(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<Option<OpenListeningDraft>> {
    let Some(attempt) = get_open_listening_draft(conn, asset_id)? else {
        return Ok(None);
    };
    let resume_position = crate::settings::get_setting(conn, DRAFT_POSITION_NS, &attempt.id)?
        .and_then(|row| serde_json::from_value(row.value).ok());
    Ok(Some(OpenListeningDraft { attempt, resume_position }))
}

pub fn finish_listening_draft(
    conn: &Connection,
    attempt_id: &str,
    replacement: Option<&str>,
) -> DbResult<()> {
    if let Some(id) = replacement {
        if let Some(row) = crate::settings::get_setting(conn, DRAFT_POSITION_NS, attempt_id)? {
            crate::settings::upsert_setting(conn, DRAFT_POSITION_NS, id, &row.value)?;
        }
    }
    crate::settings::delete_setting(conn, DRAFT_POSITION_NS, attempt_id)?;
    Ok(())
}

pub fn get_open_listening_draft(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<Option<AttemptRecord>> {
    let asset_id = asset_id.trim();
    if asset_id.is_empty() {
        return Err(DbError::Validation("asset_id required".into()));
    }
    // `active` counts as open: an in-progress attempt may have been promoted.
    let attempt_id: Option<String> = conn
        .query_row(
            "SELECT id FROM attempts
             WHERE activity = 'listening' AND asset_id = ?1
               AND lower(status) IN ('draft', 'active')
               AND mode = 'single' AND suite_id IS NULL
             ORDER BY CASE WHEN asset_id LIKE 'jiufen-native-%' THEN updated_at ELSE started_at END DESC,
                      started_at DESC, id DESC
             LIMIT 1",
            params![asset_id],
            |row| row.get(0),
        )
        .optional()?;
    match attempt_id {
        Some(attempt_id) => crate::history::load_attempt(conn, &attempt_id).map(Some),
        None => Ok(None),
    }
}

pub fn submit_listening_attempt(
    conn: &Connection,
    cmd: &ListeningSubmitCommand,
) -> DbResult<ListeningSubmitResult> {
    let tx = conn.unchecked_transaction()?;
    let result = submit_listening_attempt_in_transaction(&tx, cmd)?;
    if !result.idempotent_replay {
        // The terminal attempt, its ledger events and retention cleanup are one
        // fact; a failed prune rolls the submission back with it.
        prune_terminal_attempts_in_transaction(&tx)?;
    }
    tx.commit()?;
    Ok(result)
}

fn submit_listening_attempt_in_transaction(
    conn: &Connection,
    cmd: &ListeningSubmitCommand,
) -> DbResult<ListeningSubmitResult> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    if let Some(previous) =
        lookup_submit_response(conn, &cmd.idempotency_key, &cmd.attempt_id, &cmd.asset_id)?
    {
        return Ok(previous);
    }
    // A completed listening attempt is terminal: it cannot be re-submitted even
    // under a fresh idempotency key.
    ensure_open_listening_attempt(conn, &cmd.attempt_id, &cmd.asset_id)?;

    let loaded = load_answerable_listening_asset(
        conn,
        &cmd.asset_id,
        cmd.asset_revision,
        cmd.asset_fingerprint.as_deref(),
    )?;
    let answer_key = load_answer_key(&loaded.payload);
    if answer_key.is_empty() {
        return Err(DbError::Validation(format!(
            "listening asset is not answerable: {}",
            cmd.asset_id
        )));
    }
    let kinds = load_kinds(&loaded.payload);
    let question_order = question_order(&loaded.payload)?;
    let user_map = value_to_map(&cmd.answers);
    let progress = progress_by_question(&cmd.question_timeline);
    let now = chrono::Utc::now().to_rfc3339();

    let mut answers = Vec::with_capacity(question_order.len());
    let mut correct = 0.0;
    let mut total = 0.0;
    for question_id in &question_order {
        let kind = kinds
            .get(question_id)
            .and_then(Value::as_str)
            .ok_or_else(|| {
                DbError::Validation(format!(
                    "listening question has no question kind: {question_id}"
                ))
            })?;
        let correct_answer = answer_key.get(question_id).cloned().ok_or_else(|| {
            DbError::Validation(format!(
                "listening question has no answer key entry: {question_id}"
            ))
        })?;
        let user_answer = user_map
            .get(question_id)
            .cloned()
            .unwrap_or(Value::String(String::new()));
        let control = match_control(kind);
        let (is_correct, _, _, _) = compare_answer(&user_answer, &correct_answer, control);
        let weight = question_weight(&correct_answer, control);
        total += weight;
        if is_correct == Some(true) {
            correct += weight;
        }
        let timeline = progress.get(question_id);
        answers.push(AttemptAnswer {
            question_id: question_id.clone(),
            answer: user_answer,
            is_correct,
            weight,
            question_kind: Some(kind.to_string()),
            change_count: timeline.map(|entry| entry.change_count).unwrap_or(0),
            visit_count: timeline.map(|entry| entry.visit_count).unwrap_or(0),
            elapsed_ms: timeline.map(|entry| entry.elapsed_ms).unwrap_or(0),
            marked: cmd
                .marked_questions
                .iter()
                .any(|marked| normalize_question_id(marked) == *question_id),
            answered_at: timeline
                .and_then(|entry| entry.answered_at.clone())
                .or_else(|| Some(now.clone())),
        });
    }

    let score_value = if total > 0.0 { correct / total } else { 0.0 };
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: Activity::Listening,
        asset_id: Some(cmd.asset_id.clone()),
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: now.clone(),
        submitted_at: Some(now.clone()),
        completed_at: Some(now.clone()),
        duration_ms: cmd.duration_ms.unwrap_or(0),
        score_value: Some(score_value),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(correct),
        question_count: Some(total as u32),
        title_snapshot: Some(loaded.asset.title),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations: vec![],
    };
    persist_completed_attempt(conn, &attempt, &loaded.asset.fingerprint)?;
    finish_listening_draft(conn, &attempt.id, None)?;

    let result = ListeningSubmitResult {
        attempt: attempt.clone(),
        score_value,
        correct_count: correct,
        question_count: total as u32,
        idempotent_replay: false,
    };
    let response_json =
        serde_json::to_string(&result).map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO attempt_idempotency (scope, idempotency_key, attempt_id, evaluation_id, response_json, created_at)
         VALUES ('listening.submit', ?1, ?2, NULL, ?3, ?4)",
        params![cmd.idempotency_key, cmd.attempt_id, response_json, now],
    )?;
    // Same transaction as the attempt: the ledger can never describe a submit
    // that rolled back, and a failed append rolls the attempt back with it.
    Ok(result)
}

/// How a listening question kind is compared.
///
/// IELTS Listening awards one mark per correct letter in a multiple-answer
/// question (partial credit). This scorer deliberately mirrors Reading instead:
/// a multiple-choice set is all-or-nothing and carries the weight of the number
/// of required answers, so listening and reading accuracy stay comparable in
/// the same progress views. Completion, short answer, single choice, matching
/// and the three labelling kinds are single-mark answers (an array in the
/// answer key is an alternatives list, never a set).
fn match_control(kind: &str) -> Option<&'static str> {
    match kind {
        "multi_choice" => Some("checkbox"),
        _ => None,
    }
}

fn question_order(payload: &Value) -> DbResult<Vec<String>> {
    let items = payload
        .get("questionOrder")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            DbError::Validation("listening payload has no questionOrder".into())
        })?;
    let mut order = Vec::with_capacity(items.len());
    for item in items {
        let raw = item.as_str().ok_or_else(|| {
            DbError::Validation("listening questionOrder contains a non-string id".into())
        })?;
        let question_id = normalize_question_id(raw);
        if question_id.is_empty() {
            return Err(DbError::Validation(
                "listening questionOrder contains an empty id".into(),
            ));
        }
        order.push(question_id);
    }
    if order.is_empty() {
        return Err(DbError::Validation(
            "listening payload has no questions".into(),
        ));
    }
    Ok(order)
}

fn load_answerable_listening_asset(
    conn: &Connection,
    asset_id: &str,
    expected_revision: Option<u32>,
    expected_fingerprint: Option<&str>,
) -> DbResult<PracticeAssetV2Payload> {
    let loaded = load_listening_payload(conn, asset_id)?;
    if loaded.asset.pdf_only {
        return Err(DbError::Validation(format!(
            "listening asset is not answerable: {asset_id}"
        )));
    }
    if let Some(revision) = expected_revision {
        if revision != loaded.asset.schema_version {
            return Err(DbError::Validation(format!(
                "listening asset revision mismatch: {asset_id}"
            )));
        }
    }
    if let Some(fingerprint) = expected_fingerprint {
        if fingerprint.trim() != loaded.asset.fingerprint {
            return Err(DbError::Validation(format!(
                "listening asset fingerprint mismatch: {asset_id}"
            )));
        }
    }
    if load_answer_key(&loaded.payload).is_empty()
        && !(loaded.asset.id.starts_with("jiufen-native-") && loaded.asset.metadata.as_ref().and_then(|m| m["jiufenOwner"].as_str()).is_some())
    {
        return Err(DbError::Validation(format!(
            "listening asset is not answerable: {asset_id}"
        )));
    }
    Ok(loaded)
}

#[derive(Debug)]
struct ExistingListeningAttempt {
    activity: String,
    asset_id: Option<String>,
    mode: String,
    suite_id: Option<String>,
    status: String,
}

fn ensure_open_listening_attempt(
    conn: &Connection,
    attempt_id: &str,
    asset_id: &str,
) -> DbResult<()> {
    let existing = conn
        .query_row(
            "SELECT activity, asset_id, mode, suite_id, status FROM attempts WHERE id = ?1",
            params![attempt_id],
            |row| {
                Ok(ExistingListeningAttempt {
                    activity: row.get(0)?,
                    asset_id: row.get(1)?,
                    mode: row.get(2)?,
                    suite_id: row.get(3)?,
                    status: row.get(4)?,
                })
            },
        )
        .optional()?;
    let Some(existing) = existing else {
        return Ok(());
    };
    if existing.activity != "listening"
        || existing.asset_id.as_deref() != Some(asset_id)
        || existing.mode != "single"
        || existing.suite_id.is_some()
    {
        return Err(DbError::Validation(
            "listening attempt belongs to another asset or mode".into(),
        ));
    }
    if !matches!(existing.status.as_str(), "draft" | "active") {
        return Err(DbError::Validation(
            "only an open listening attempt may be changed".into(),
        ));
    }
    Ok(())
}

fn lookup_submit_response(
    conn: &Connection,
    key: &str,
    attempt_id: &str,
    asset_id: &str,
) -> DbResult<Option<ListeningSubmitResult>> {
    let mut statement = conn.prepare(
        "SELECT response_json FROM attempt_idempotency WHERE scope = 'listening.submit' AND idempotency_key = ?1",
    )?;
    let mut rows = statement.query(params![key])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let json: String = row.get(0)?;
    let mut result: ListeningSubmitResult = serde_json::from_str(&json)
        .map_err(|error| DbError::Message(format!("idempotency parse: {error}")))?;
    if result.attempt.id != attempt_id || result.attempt.asset_id.as_deref() != Some(asset_id) {
        return Err(DbError::Validation(
            "idempotency key belongs to another listening submission".into(),
        ));
    }
    result.idempotent_replay = true;
    Ok(Some(result))
}
