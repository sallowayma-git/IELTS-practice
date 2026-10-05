//! Baseline Coach reads canonical evidence; clients only propose bounded selectors.

use std::collections::BTreeSet;

use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};

use super::get_thread;
use crate::sqlite::{DbError, DbResult};
use crate::{history::load_attempt, load_practice_asset_payload};

#[derive(Debug, Clone)]
pub struct ResolvedCoachContext {
    /// Stable evidence: byte-identical for every turn of one attempt
    /// (`identity`, `result`, `source`, `evidenceLimitations`). Prompt builders
    /// put it first so the provider can cache the prefix.
    pub evidence: Value,
    /// Volatile per-turn controls (`controls`, `selectionQuote`,
    /// `selectionIsEvidence`). Never part of the cacheable prefix.
    pub request: Value,
    /// Only bounded request controls + host-resolved identity, never client scores.
    pub message_metadata: Value,
}

// Legacy questionContext had arbitrary evidence fields. Deliberately ignore
// those at this compatibility boundary; the internal evidence DTO is host-only.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selector {
    activity: Option<String>,
    session_id: Option<String>,
    asset_id: Option<String>,
    mode: Option<String>,
    locale: Option<String>,
    surface: Option<String>,
    action: Option<String>,
    prompt_kind: Option<String>,
    #[serde(default)]
    focus_question_ids: Vec<String>,
    #[serde(default)]
    focus_question_numbers: Vec<String>,
    #[serde(default)]
    selected_text: String,
    selected_context: Option<Selection>,
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    #[serde(default)]
    text: String,
    #[serde(default)]
    question_ids: Vec<String>,
    #[serde(default)]
    question_numbers: Vec<String>,
}

fn invalid(message: impl Into<String>) -> DbError {
    DbError::Validation(format!("coach.context_invalid: {}", message.into()))
}

/// One SQLite read snapshot, plus fingerprint-verified asset payload. No write
/// and no search for "another attempt of the same asset" if evidence was pruned.
pub fn resolve_reading_coach_context(
    conn: &Connection,
    thread_id: &str,
    raw: Option<&Value>,
) -> DbResult<ResolvedCoachContext> {
    let selector = parse_selector(raw)?;
    let tx = conn.unchecked_transaction()?;
    let thread = get_thread(&tx, thread_id)?;
    let attempt_id = thread
        .attempt_id
        .as_deref()
        .ok_or_else(|| invalid("thread has no retained attempt evidence"))?;
    let (activity, mode, status, fingerprint): (String, String, String, Option<String>) = tx
        .query_row(
            "SELECT activity, mode, status, submitted_asset_fingerprint FROM attempts WHERE id=?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    if activity != "reading"
        || status != "completed"
        || !matches!(mode.as_str(), "single" | "suite" | "endless")
    {
        return Err(invalid(
            "reading review requires a completed reading attempt with a supported mode",
        ));
    }
    let attempt = load_attempt(&tx, attempt_id)?;
    let asset_id = attempt
        .asset_id
        .as_deref()
        .ok_or_else(|| invalid("attempt has no asset"))?;
    if thread.asset_id.as_deref().is_some_and(|id| id != asset_id) {
        return Err(invalid("thread asset conflicts with its bound attempt"));
    }
    validate_identity(&selector, attempt_id, asset_id, &mode)?;
    let (source, focus, limitations) = if let Some(fingerprint) = fingerprint.as_deref() {
        let source = load_practice_asset_payload(&tx, asset_id)?;
        if source.asset.fingerprint != fingerprint {
            return Err(invalid(
                "submitted asset fingerprint mismatch: resource was replaced after submission",
            ));
        }
        if source.payload.get("examId").and_then(Value::as_str) != Some(asset_id) {
            return Err(invalid("canonical payload identity mismatch"));
        }
        let focus = resolve_focus(&selector, &source.payload)?;
        (
            json!({"passage": source.payload.get("passage"),
            "questionGroups": source.payload.get("questionGroups"),
            "questionDisplayMap": source.payload.get("questionDisplayMap")}),
            focus,
            json!([]),
        )
    } else {
        // Never pair retained grades with today's text for unversioned history.
        // Older UI sends display numbers by default. Preserve the conversation,
        // but never guess their mapping from today's replacement resource.
        let mut retained_selector = selector.clone();
        if retained_selector.focus_question_numbers.len() > 40
            || retained_selector
                .selected_context
                .as_ref()
                .is_some_and(|value| value.question_numbers.len() > 40)
        {
            return Err(invalid("too many focus questions"));
        }
        retained_selector.focus_question_numbers.clear();
        if let Some(selection) = retained_selector.selected_context.as_mut() {
            selection.question_numbers.clear();
        }
        let key: serde_json::Map<String, Value> = attempt
            .answers
            .iter()
            .map(|answer| (answer.question_id.clone(), Value::Null))
            .collect();
        let focus = resolve_focus(&retained_selector, &json!({"answerKey": key}))?;
        (
            Value::Null,
            focus,
            json!([{
                "code": "submission_asset_revision_unavailable",
                "message": "Legacy attempt has no submission asset revision. Only retained answers and scores are evidence; passage, questions and display mapping are unavailable."
            }]),
        )
    };
    let selection = selector.selected_context.as_ref();
    let quote = if selector.selected_text.is_empty() {
        selection
            .map(|selected| selected.text.as_str())
            .unwrap_or("")
    } else {
        &selector.selected_text
    };
    if quote.chars().count() > 500 {
        return Err(invalid("selection quote exceeds 500 characters"));
    }
    let metadata = json!({
        "activity": "reading", "sessionId": attempt.id, "assetId": asset_id,
        "mode": mode, "locale": selector.locale, "surface": selector.surface,
        "action": selector.action, "promptKind": selector.prompt_kind,
        "focusQuestionIds": focus,
    });
    // Explicit fields only: no annotations/private notes, raw client evidence,
    // answer key or arbitrary root payload attributes. A selection quote is a
    // user request, NOT source evidence, and remains marked as unverified data.
    let evidence = json!({
        "identity": {"attemptId": attempt.id, "assetId": asset_id, "mode": mode,
            "sessionOwnerId": attempt.suite_id, "assetFingerprint": fingerprint},
        "source": source,
        "evidenceLimitations": limitations,
        "result": {"status": "completed", "score": attempt.score_value,
            "scoreScale": attempt.score_scale, "correctCount": attempt.correct_count,
            "questionCount": attempt.question_count, "answers": attempt.answers},
    });
    let request = json!({"controls": metadata, "selectionQuote": quote, "selectionIsEvidence": false});
    if evidence.to_string().len() + request.to_string().len() > 64 * 1024 {
        return Err(invalid("canonical context exceeds 64 KiB"));
    }
    tx.commit()?;
    Ok(ResolvedCoachContext {
        evidence,
        request,
        message_metadata: metadata,
    })
}

fn parse_selector(raw: Option<&Value>) -> DbResult<Selector> {
    let selector: Selector = match raw.filter(|value| !value.is_null()) {
        Some(raw) => {
            if raw.to_string().len() > 64 * 1024 {
                return Err(invalid("request metadata exceeds 64 KiB"));
            }
            serde_json::from_value(raw.clone()).map_err(|error| invalid(error.to_string()))?
        }
        None => Selector::default(),
    };
    for field in [
        &selector.activity,
        &selector.session_id,
        &selector.asset_id,
        &selector.mode,
        &selector.locale,
        &selector.surface,
        &selector.action,
        &selector.prompt_kind,
    ] {
        if field.as_ref().is_some_and(|text| text.len() > 160) {
            return Err(invalid("selector field exceeds 160 bytes"));
        }
    }
    Ok(selector)
}

fn validate_identity(
    selector: &Selector,
    attempt_id: &str,
    asset_id: &str,
    mode: &str,
) -> DbResult<()> {
    for (requested, expected) in [
        (&selector.activity, "reading"),
        (&selector.session_id, attempt_id),
        (&selector.asset_id, asset_id),
    ] {
        if requested
            .as_deref()
            .is_some_and(|value| !value.is_empty() && value != expected)
        {
            return Err(invalid("request identity conflicts with bound attempt"));
        }
    }
    if selector
        .mode
        .as_deref()
        .is_some_and(|value| value != "review" && value != mode)
    {
        return Err(invalid("request mode conflicts with bound attempt"));
    }
    Ok(())
}

fn resolve_focus(selector: &Selector, payload: &Value) -> DbResult<Vec<String>> {
    let allowed: BTreeSet<&str> = payload
        .get("answerKey")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("canonical question IDs unavailable"))?
        .keys()
        .map(String::as_str)
        .collect();
    let selection = selector.selected_context.as_ref();
    let ids = if !selector.focus_question_ids.is_empty() {
        &selector.focus_question_ids
    } else {
        selection
            .map(|value| &value.question_ids)
            .unwrap_or(&selector.focus_question_ids)
    };
    let numbers = if !selector.focus_question_numbers.is_empty() {
        &selector.focus_question_numbers
    } else {
        selection
            .map(|value| &value.question_numbers)
            .unwrap_or(&selector.focus_question_numbers)
    };
    if ids.len() > 40 || numbers.len() > 40 {
        return Err(invalid("too many focus questions"));
    }
    let requested = if !ids.is_empty() {
        ids.clone()
    } else {
        numbers
            .iter()
            .map(|number| display_to_id(number, payload, &allowed))
            .collect::<DbResult<Vec<_>>>()?
    };
    if requested.iter().any(|id| !allowed.contains(id.as_str())) {
        return Err(invalid("unknown focus question ID"));
    }
    let mut seen = BTreeSet::new();
    Ok(requested
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect())
}

fn display_to_id(number: &str, payload: &Value, allowed: &BTreeSet<&str>) -> DbResult<String> {
    let map = payload.get("questionDisplayMap").and_then(Value::as_object);
    let matches: Vec<_> = allowed
        .iter()
        .filter(|id| {
            let display = map
                .and_then(|map| map.get(**id))
                .and_then(Value::as_str)
                .unwrap_or_else(|| id.strip_prefix('q').unwrap_or(id));
            display == number
        })
        .collect();
    if matches.len() != 1 {
        return Err(invalid(format!(
            "unknown or ambiguous display question number {number}"
        )));
    }
    Ok((*matches[0]).to_string())
}
