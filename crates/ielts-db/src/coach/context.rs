//! Baseline Coach reads canonical evidence; clients only propose bounded selectors.

use std::collections::BTreeSet;

use ielts_domain::{
    Activity, AttemptMode, AttemptRecord, AttemptStatus, EvaluationStatus, WritingFeedbackV4,
    WritingTaskType,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::get_thread;
use crate::reading::scoring::normalize_question_id;
use crate::sqlite::{DbError, DbResult};
use crate::{history::load_attempt, load_answer_key, load_practice_asset_payload};

#[derive(Debug, Clone)]
pub struct ResolvedCoachContext {
    /// The scene that owns this evidence and this thread. It decides the task
    /// rules and which activity-scoped memories the frozen profile may carry.
    pub activity: Activity,
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
    #[serde(default)]
    paragraph_labels: Vec<String>,
}

const MAX_PARAGRAPH_LABELS: usize = 8;
const MAX_PARAGRAPH_LABEL_CHARS: usize = 16;

/// Trim, drop empty or over-long labels, then cap the count.
fn sanitize_paragraph_labels(raw: &[String]) -> Vec<String> {
    raw.iter()
        .map(|label| label.trim())
        .filter(|label| !label.is_empty() && label.chars().count() <= MAX_PARAGRAPH_LABEL_CHARS)
        .take(MAX_PARAGRAPH_LABELS)
        .map(str::to_string)
        .collect()
}

/// Paragraph labels are only meaningful alongside a quote they describe.
fn selection_paragraphs(quote: &str, selection: Option<&Selection>) -> Option<Vec<String>> {
    let labels = sanitize_paragraph_labels(&selection?.paragraph_labels);
    (!quote.is_empty() && !labels.is_empty()).then_some(labels)
}

fn invalid(message: impl Into<String>) -> DbError {
    DbError::Validation(format!("coach.context_invalid: {}", message.into()))
}

/// Parse the client selector once, then hand the exact same selector to the
/// scene it names. Anything that does not explicitly say "writing" keeps the
/// reading gate: a writing-bound thread can never silently borrow reading
/// evidence, and a reading-bound thread cannot borrow writing evidence.
pub fn resolve_coach_context(
    conn: &Connection,
    thread_id: &str,
    raw: Option<&Value>,
) -> DbResult<ResolvedCoachContext> {
    let selector = parse_selector(raw)?;
    if selector.activity.as_deref() == Some("writing") {
        resolve_writing_selector(conn, thread_id, selector)
    } else {
        resolve_reading_selector(conn, thread_id, selector)
    }
}

/// One SQLite read snapshot, plus fingerprint-verified asset payload. No write
/// and no search for "another attempt of the same asset" if evidence was pruned.
pub fn resolve_reading_coach_context(
    conn: &Connection,
    thread_id: &str,
    raw: Option<&Value>,
) -> DbResult<ResolvedCoachContext> {
    resolve_reading_selector(conn, thread_id, parse_selector(raw)?)
}

fn resolve_reading_selector(
    conn: &Connection,
    thread_id: &str,
    selector: Selector,
) -> DbResult<ResolvedCoachContext> {
    resolve_practice_selector(conn, thread_id, selector, None)
}

/// Host-only provider adapter. The caller authenticates and verifies the remote receipt.
/// This function still owns thread identity, local scores, selectors and context limits.
pub fn resolve_provider_coach_context(
    conn: &Connection,
    thread_id: &str,
    raw: Option<&Value>,
    payload: &Value,
    fingerprint: &str,
) -> DbResult<ResolvedCoachContext> {
    resolve_practice_selector(
        conn,
        thread_id,
        parse_selector(raw)?,
        Some((payload, fingerprint)),
    )
}

fn resolve_practice_selector(
    conn: &Connection,
    thread_id: &str,
    selector: Selector,
    provider: Option<(&Value, &str)>,
) -> DbResult<ResolvedCoachContext> {
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
    if (activity != "reading" && !(provider.is_some() && activity == "listening"))
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
    validate_identity(&selector, attempt_id, asset_id, &mode, &activity)?;
    let (source, focus, limitations, correct_answers) = if let Some((payload, revision)) = provider
    {
        let asset = crate::get_practice_asset(&tx, asset_id)?;
        if asset
            .metadata
            .as_ref()
            .is_none_or(|m| m["remoteProvider"] != "jiufen")
            || fingerprint.as_deref() != Some(revision)
            || asset.fingerprint != revision
            || payload["examId"] != asset_id
        {
            return Err(invalid(
                "provider evidence revision conflicts with bound attempt",
            ));
        }
        let key = load_answer_key(payload);
        if key.len() != attempt.answers.len()
            || attempt
                .answers
                .iter()
                .any(|a| !key.contains_key(&a.question_id))
        {
            return Err(invalid("provider evidence is missing official answers"));
        }
        let source = json!({"passage":payload["passage"],"questionGroups":payload["questionGroups"],
            "questionDisplayMap":payload["questionDisplayMap"],"reviewExplanations":payload["reviewExplanations"],
            "transcript": provider_transcript(payload, &activity),
            "answerLocations": payload["studyMaterial"]["questions"]});
        (
            source,
            resolve_focus(&selector, payload)?,
            json!([]),
            Some(key),
        )
    } else if let Some(fingerprint) = fingerprint.as_deref() {
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
        // The fingerprint-verified payload is the exact revision the attempt was
        // scored against, so its answerKey is the key the review page shows.
        (
            json!({"passage": source.payload.get("passage"),
            "questionGroups": source.payload.get("questionGroups"),
            "questionDisplayMap": source.payload.get("questionDisplayMap")}),
            focus,
            if source.payload["idictation"]["subject"] == "reading" {
                json!(["Imported official answers may lack per-question interaction history. Do not infer first-try correctness or speed for questions without recorded interactions."])
            } else {
                json!([])
            },
            Some(load_answer_key(&source.payload)),
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
        // Only correct answers persisted with this attempt's own scoring result
        // are evidence; today's (possibly replaced) answer key never is.
        let retained = retained_correct_answers(&tx, attempt_id)?;
        let mut limitations = vec![json!({
            "code": "submission_asset_revision_unavailable",
            "message": "Legacy attempt has no submission asset revision. Only retained answers and scores are evidence; passage, questions and display mapping are unavailable."
        })];
        if retained.is_none() {
            limitations.push(json!({
                "code": "correct_answers_unavailable",
                "message": "No correct answers were retained with this legacy attempt. Use only the recorded isCorrect flags; do not state what the correct answer was."
            }));
        }
        (Value::Null, focus, Value::Array(limitations), retained)
    };
    let answers = evidence_answers(&attempt.answers, correct_answers.as_ref())?;
    let selection = selector.selected_context.as_ref();
    let quote = selection_quote(&selector)?;
    let metadata = json!({
        "activity": activity, "sessionId": attempt.id, "assetId": asset_id,
        "mode": mode, "locale": selector.locale, "surface": selector.surface,
        "action": selector.action, "promptKind": selector.prompt_kind,
        "focusQuestionIds": focus,
    });
    // Explicit fields only: no annotations/private notes, raw client evidence
    // or arbitrary root payload attributes. Each answer carries the official
    // `correctAnswer` the attempt was scored against (coach only runs on
    // completed attempts, whose review already shows it); the whole raw
    // answerKey map is never forwarded. A selection quote is a user request,
    // NOT source evidence, and remains marked as unverified data.
    let evidence = json!({
        "identity": {"attemptId": attempt.id, "assetId": asset_id, "mode": mode,
            "sessionOwnerId": attempt.suite_id, "assetFingerprint": fingerprint},
        "source": source,
        "evidenceLimitations": limitations,
        "result": {"status": "completed", "score": attempt.score_value,
            "scoreScale": attempt.score_scale, "correctCount": attempt.correct_count,
            "questionCount": attempt.question_count, "answers": answers},
    });
    let mut request =
        json!({"controls": metadata, "selectionQuote": quote, "selectionIsEvidence": false});
    if let Some(labels) = selection_paragraphs(quote, selection) {
        request["selectionParagraphs"] = json!(labels);
    }
    ensure_context_bounded(&evidence, &request)?;
    tx.commit()?;
    Ok(ResolvedCoachContext {
        activity: attempt.activity,
        evidence,
        request,
        message_metadata: metadata,
    })
}

fn provider_transcript(payload: &Value, activity: &str) -> Value {
    if activity != "listening" {
        return Value::Null;
    }
    let mut parts = payload["studyMaterial"]["parts"].clone();
    for part in parts.as_array_mut().into_iter().flatten() {
        for paragraph in part["paragraphs"].as_array_mut().into_iter().flatten() {
            for sentence in paragraph["sentences"].as_array_mut().into_iter().flatten() {
                if let Some(row) = sentence.as_object_mut() {
                    row.remove("words");
                }
            }
        }
    }
    parts
}

/// A writing thread replays the canonical attempt plus its persisted
/// evaluation. Selectors may narrow identity and carry a quote; they can never
/// supply scores, raw evaluation JSON or annotations.
fn resolve_writing_selector(
    conn: &Connection,
    thread_id: &str,
    selector: Selector,
) -> DbResult<ResolvedCoachContext> {
    let tx = conn.unchecked_transaction()?;
    let thread = get_thread(&tx, thread_id)?;
    let attempt_id = thread
        .attempt_id
        .as_deref()
        .ok_or_else(|| invalid("thread has no retained attempt evidence"))?;
    let attempt = load_attempt(&tx, attempt_id)?;
    if attempt.activity != Activity::Writing || attempt.status != AttemptStatus::Completed {
        return Err(invalid(
            "writing coach requires a completed writing attempt",
        ));
    }
    if let (Some(thread_asset), Some(attempt_asset)) = (&thread.asset_id, &attempt.asset_id) {
        if thread_asset != attempt_asset {
            return Err(invalid("thread asset conflicts with its bound attempt"));
        }
    }
    let mode = attempt_mode_str(attempt.mode);
    validate_writing_identity(&selector, &attempt, mode)?;
    let evaluation = crate::writing::load_evaluation_for_attempt(&tx, attempt_id)?
        .ok_or_else(|| invalid("writing coach requires a completed evaluation with band scores"))?;
    if !matches!(
        evaluation.status,
        EvaluationStatus::Completed | EvaluationStatus::Degraded
    ) {
        return Err(invalid(
            "writing coach requires a completed evaluation with band scores",
        ));
    }
    let score = evaluation
        .score
        .as_ref()
        .ok_or_else(|| invalid("writing coach requires a completed evaluation with band scores"))?;
    let Some(essay) = attempt
        .content_text
        .as_deref()
        .filter(|text| !text.trim().is_empty())
    else {
        return Err(invalid("writing attempt has no retained essay text"));
    };
    let task_type = attempt.task_type.map(writing_task_type_str);
    let feedback = evaluation.feedback.as_ref();
    let limitations = if evaluation.status == EvaluationStatus::Degraded {
        json!([{
            "code": "evaluation_degraded",
            "message": "The evaluation was degraded; use only the persisted scores and essay."
        }])
    } else {
        json!([])
    };
    let evidence = json!({
        "identity": {"attemptId": attempt.id, "assetId": attempt.asset_id,
            "activity": "writing", "taskType": task_type, "mode": mode,
            "sessionOwnerId": attempt.suite_id},
        "source": {"title": attempt.title_snapshot, "prompt": attempt.prompt_snapshot,
            "essay": essay, "taskType": task_type},
        "result": {"status": "completed",
            "score": {"overall": score.overall, "taskResponse": score.task_response,
                "coherence": score.coherence, "lexical": score.lexical,
                "grammar": score.grammar},
            "feedback": {"overall": feedback.and_then(|value| value.overall.clone()),
                "sentences": capped_sentences(feedback)}},
        "evidenceLimitations": limitations,
    });
    let quote = selection_quote(&selector)?;
    let metadata = json!({
        "activity": "writing", "sessionId": attempt.id, "assetId": attempt.asset_id,
        "mode": mode, "locale": selector.locale, "surface": selector.surface,
        "action": selector.action, "promptKind": selector.prompt_kind,
    });
    let request =
        json!({"controls": metadata, "selectionQuote": quote, "selectionIsEvidence": false});
    ensure_context_bounded(&evidence, &request)?;
    tx.commit()?;
    Ok(ResolvedCoachContext {
        activity: Activity::Writing,
        evidence,
        request,
        message_metadata: metadata,
    })
}

fn validate_writing_identity(
    selector: &Selector,
    attempt: &AttemptRecord,
    mode: &str,
) -> DbResult<()> {
    if selector
        .activity
        .as_deref()
        .is_some_and(|value| value != "writing")
    {
        return Err(invalid("request identity conflicts with bound attempt"));
    }
    if selector
        .session_id
        .as_deref()
        .is_some_and(|value| value != attempt.id)
    {
        return Err(invalid("request identity conflicts with bound attempt"));
    }
    if let Some(requested) = selector.asset_id.as_deref().filter(|id| !id.is_empty()) {
        if attempt.asset_id.as_deref() != Some(requested) {
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

fn attempt_mode_str(mode: AttemptMode) -> &'static str {
    match mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

fn writing_task_type_str(task_type: WritingTaskType) -> &'static str {
    match task_type {
        WritingTaskType::Task1 => "task1",
        WritingTaskType::Task2 => "task2",
    }
}

/// At most 12 sentence notes keep the stable evidence prefix bounded; feedback
/// serialization failure degrades to no sentences, never to raw JSON.
fn capped_sentences(feedback: Option<&WritingFeedbackV4>) -> Value {
    let Some(feedback) = feedback else {
        return json!([]);
    };
    match serde_json::to_value(&feedback.sentences) {
        Ok(Value::Array(items)) => Value::Array(items.into_iter().take(12).collect()),
        _ => json!([]),
    }
}

/// One rule for both scenes: explicit quote first, then the selection payload.
fn selection_quote(selector: &Selector) -> DbResult<&str> {
    let quote = if selector.selected_text.is_empty() {
        selector
            .selected_context
            .as_ref()
            .map(|selected| selected.text.as_str())
            .unwrap_or("")
    } else {
        &selector.selected_text
    };
    if quote.chars().count() > 500 {
        return Err(invalid("selection quote exceeds 500 characters"));
    }
    Ok(quote)
}

fn ensure_context_bounded(evidence: &Value, request: &Value) -> DbResult<()> {
    if evidence.to_string().len() + request.to_string().len() > 64 * 1024 {
        return Err(invalid("canonical context exceeds 64 KiB"));
    }
    Ok(())
}

/// Retained answers plus, when known, the official `correctAnswer` per question.
/// Deterministic for one attempt so the evidence stays a byte-stable prefix.
fn evidence_answers(
    answers: &[ielts_domain::AttemptAnswer],
    correct: Option<&serde_json::Map<String, Value>>,
) -> DbResult<Vec<Value>> {
    answers
        .iter()
        .map(|answer| {
            let mut value = serde_json::to_value(answer)
                .map_err(|error| DbError::Message(error.to_string()))?;
            if let (Some(correct), Some(object)) = (correct, value.as_object_mut()) {
                let expected = correct
                    .get(&normalize_question_id(&answer.question_id))
                    .cloned()
                    .unwrap_or(Value::Null);
                object.insert("correctAnswer".into(), expected);
            }
            Ok(value)
        })
        .collect()
}

/// Correct answers persisted by the scoring path itself (the submit response's
/// comparisons), for attempts whose asset revision was not recorded.
fn retained_correct_answers(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<Option<serde_json::Map<String, Value>>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT response_json FROM attempt_idempotency
             WHERE scope='reading.submit' AND attempt_id=?1 AND response_json IS NOT NULL
             ORDER BY created_at, idempotency_key LIMIT 1",
            params![attempt_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(comparisons) = raw
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.get("comparisons").cloned())
        .and_then(|value| value.as_array().cloned())
    else {
        return Ok(None);
    };
    let map: serde_json::Map<String, Value> = comparisons
        .iter()
        .filter_map(|entry| {
            let id = entry.get("questionId")?.as_str()?;
            let correct = entry.get("correctAnswer")?.clone();
            Some((normalize_question_id(id), correct))
        })
        .collect();
    Ok((!map.is_empty()).then_some(map))
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
    activity: &str,
) -> DbResult<()> {
    for (requested, expected) in [
        (&selector.activity, activity),
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

#[cfg(test)]
mod paragraph_label_tests {
    use super::*;

    fn selection_from(value: Value) -> Selection {
        serde_json::from_value(value).expect("selection parses")
    }

    #[test]
    fn paragraph_labels_pass_through_when_quote_present() {
        let selection = selection_from(json!({"text": "A quote", "paragraphLabels": ["B", "C"]}));
        assert_eq!(
            selection_paragraphs("A quote", Some(&selection)),
            Some(vec!["B".to_string(), "C".to_string()])
        );
    }

    #[test]
    fn paragraph_labels_are_truncated_to_eight() {
        let labels: Vec<String> = (0..10).map(|index| format!("P{index}")).collect();
        let selection = selection_from(json!({"text": "q", "paragraphLabels": labels}));
        let kept = selection_paragraphs("q", Some(&selection)).expect("labels kept");
        assert_eq!(kept.len(), MAX_PARAGRAPH_LABELS);
        assert_eq!(kept[0], "P0");
        assert_eq!(kept[7], "P7");
    }

    #[test]
    fn empty_and_over_long_paragraph_labels_are_dropped() {
        let long = "x".repeat(MAX_PARAGRAPH_LABEL_CHARS + 1);
        let exact = "y".repeat(MAX_PARAGRAPH_LABEL_CHARS);
        let selection = selection_from(json!({
            "text": "q",
            "paragraphLabels": ["  ", "", long, "  D  ", exact.clone()]
        }));
        assert_eq!(
            selection_paragraphs("q", Some(&selection)),
            Some(vec!["D".to_string(), exact])
        );
    }

    #[test]
    fn no_paragraphs_emitted_without_quote_or_labels() {
        let with_labels = selection_from(json!({"paragraphLabels": ["A"]}));
        assert_eq!(selection_paragraphs("", Some(&with_labels)), None);
        let without = selection_from(json!({"text": "q"}));
        assert_eq!(selection_paragraphs("q", Some(&without)), None);
        assert_eq!(selection_paragraphs("q", None), None);
    }

    #[test]
    fn absent_paragraph_field_still_parses() {
        let selection = selection_from(json!({"text": "q", "questionNumbers": ["3"]}));
        assert!(selection.paragraph_labels.is_empty());
        assert_eq!(selection.question_numbers, vec!["3".to_string()]);
    }
}
