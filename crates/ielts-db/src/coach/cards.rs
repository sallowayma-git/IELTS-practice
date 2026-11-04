//! Preference-card eligibility: whether a coach answer's teaching notes earn the
//! learner a "remember this about me?" card. Pure host logic over the stored
//! notes, no model call.
//!
//! A card is offered for the first kept `preference` or `difficulty` note that
//! either carries `remember: true` (the learner explicitly asked to be
//! remembered) or is a `difficulty` whose `skillKey` has now been reported on at
//! least [`CARD_DIFFICULTY_THRESHOLD`] answers within [`CARD_WINDOW_DAYS`],
//! counting this one. Either way a card is never offered when the same text is
//! already an active memory, or when the answer's card was already confirmed or
//! dismissed (`memoryCardState` on the message payload, written elsewhere).

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sqlite::DbResult;

/// How far back earlier difficulty notes still count toward a card.
pub const CARD_WINDOW_DAYS: i64 = 30;
/// Difficulty notes on one skill (this one included) that make a card.
pub const CARD_DIFFICULTY_THRESHOLD: i64 = 2;

const MEMORY_USER_ID: &str = "local";

/// What the assistant message payload stores under `memoryCard`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachMemoryCard {
    /// Index into the same payload's `teachingNotes`.
    pub note_index: usize,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_key: Option<String>,
}

/// How the learner handled a card; stored as `memoryCardState` on the payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoachMemoryCardState {
    Confirmed,
    Dismissed,
}

/// The payload's `memoryCardState`, if it holds a known value.
pub fn coach_memory_card_state(payload: &Value) -> Option<CoachMemoryCardState> {
    match payload["memoryCardState"].as_str()? {
        "confirmed" => Some(CoachMemoryCardState::Confirmed),
        "dismissed" => Some(CoachMemoryCardState::Dismissed),
        _ => None,
    }
}

/// True once the learner confirmed or dismissed this message's card.
pub fn coach_memory_card_handled(payload: &Value) -> bool {
    coach_memory_card_state(payload).is_some()
}

/// The card `payload` earns, or `None`. `message_id` names the stored message
/// the payload belongs to, so it is not counted twice; pass `None` for a
/// payload that is not stored yet. Reads only; writes nothing.
pub fn evaluate_coach_memory_card(
    conn: &Connection,
    payload: &Value,
    message_id: Option<&str>,
    now: DateTime<Utc>,
) -> DbResult<Option<CoachMemoryCard>> {
    if coach_memory_card_handled(payload) {
        return Ok(None);
    }
    let Some(notes) = payload["teachingNotes"].as_array() else {
        return Ok(None);
    };
    let since = (now - Duration::days(CARD_WINDOW_DAYS)).to_rfc3339();
    for (note_index, note) in notes.iter().enumerate() {
        let Some(text) = note["text"].as_str().map(str::trim).filter(|text| !text.is_empty()) else {
            continue;
        };
        if !earns_card(conn, note, message_id, &since)? || is_active_memory(conn, text)? {
            continue;
        }
        return Ok(Some(CoachMemoryCard {
            note_index,
            text: text.to_owned(),
            skill_key: skill_key(note).map(str::to_owned),
        }));
    }
    Ok(None)
}

fn earns_card(conn: &Connection, note: &Value, message_id: Option<&str>, since: &str) -> DbResult<bool> {
    let remembered = note["remember"].as_bool() == Some(true);
    match note["kind"].as_str() {
        Some("preference") => Ok(remembered),
        Some("difficulty") if remembered => Ok(true),
        Some("difficulty") => match skill_key(note) {
            Some(skill) => Ok(earlier_difficulties(conn, skill, message_id, since)? + 1 >= CARD_DIFFICULTY_THRESHOLD),
            None => Ok(false),
        },
        _ => Ok(false),
    }
}

fn skill_key(note: &Value) -> Option<&str> {
    note["skillKey"].as_str().map(str::trim).filter(|skill| !skill.is_empty())
}

/// Stored answers (any thread, other than `message_id`) since `since` that kept
/// a `difficulty` note on `skill`. One answer counts once however many such
/// notes it carries.
fn earlier_difficulties(conn: &Connection, skill: &str, message_id: Option<&str>, since: &str) -> DbResult<i64> {
    // json_each over a payload that is not JSON, or a notes value that is not
    // an array of objects, must contribute nothing instead of failing the query.
    let count = conn.query_row(
        "SELECT COUNT(DISTINCT m.id)
         FROM coach_messages m,
              json_each(CASE WHEN json_valid(m.structured_payload) THEN m.structured_payload ELSE '{}' END, '$.teachingNotes') n
         WHERE m.role = 'assistant' AND m.status = 'completed'
           AND julianday(m.created_at) >= julianday(?1)
           AND (?2 IS NULL OR m.id != ?2)
           AND n.type = 'object'
           AND CASE WHEN n.type = 'object' THEN json_extract(n.value, '$.kind') END = 'difficulty'
           AND CASE WHEN n.type = 'object' THEN trim(json_extract(n.value, '$.skillKey')) END = ?3",
        params![since, message_id, skill],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// Whether an active memory of this learner already says the same thing.
fn is_active_memory(conn: &Connection, text: &str) -> DbResult<bool> {
    let wanted = normalize(text);
    if wanted.is_empty() {
        return Ok(true);
    }
    let mut statement = conn.prepare("SELECT content FROM memory_items WHERE user_id = ?1 AND status = 'active'")?;
    let mut rows = statement.query([MEMORY_USER_ID])?;
    while let Some(row) = rows.next()? {
        let content: String = row.get(0)?;
        if normalize(&content) == wanted {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Letters and digits only, lower-cased: case, spacing and punctuation do not
/// make a different statement.
fn normalize(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn normalization_ignores_case_spacing_and_punctuation() {
        assert_eq!(normalize("  Prefers: SHORT examples! "), normalize("prefers short examples"));
        assert_eq!(normalize("先讲结论，再讲证据。"), normalize("先讲结论 再讲证据"));
        assert_eq!(normalize("?!"), "");
    }

    #[test]
    fn only_confirmed_and_dismissed_count_as_handled() {
        assert_eq!(coach_memory_card_state(&json!({"memoryCardState": "confirmed"})), Some(CoachMemoryCardState::Confirmed));
        assert_eq!(coach_memory_card_state(&json!({"memoryCardState": "dismissed"})), Some(CoachMemoryCardState::Dismissed));
        for open in [json!({}), json!({"memoryCardState": "pending"}), json!({"memoryCardState": 1}), json!(null)] {
            assert!(!coach_memory_card_handled(&open), "{open}");
        }
    }
}
