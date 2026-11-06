//! The reads and the one small write behind a coach preference card.
//!
//! A card is the coach asking "should I remember this about you?" under one of
//! its teaching notes. Nothing new is stored for it: the card itself is the
//! assistant message's own `memoryCard` payload, its outcome is the message's
//! `memoryCardState` (`confirmed` | `dismissed`), and a confirmed card is an
//! ordinary `user_explicit` memory (see `MemoryService::create_learner_memory`).
//!
//! This module only answers the questions that flow needs from the database: which
//! learner message did this answer reply to (the observation the memory will cite),
//! is there already a memory for this card, and what did the learner decide.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::cognitive_read::ensure_observations_fresh;
use crate::sqlite::{DbError, DbResult};
use crate::weekly_pack::answered_learner_observation;

/// What the learner decided about a card; the value stored in `memoryCardState`.
pub const CARD_CONFIRMED: &str = "confirmed";
pub const CARD_DISMISSED: &str = "dismissed";

/// A card's note, as far as the confirm flow needs to know it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryCardSource {
    /// `memoryCardState` of the message, if the learner already decided.
    pub state: Option<String>,
    /// The `coach.question.asked` observation of the learner message this answer
    /// replied to: the evidence a memory built on the card cites, and the way back
    /// to the original message (`memory_coach_sources`).
    pub evidence_observation_id: Option<String>,
}

/// The identity of the memory a card becomes: one card, one memory, whatever the
/// learner edits the text to. The hash keeps message ids out of the key's alphabet.
pub fn memory_card_key(message_id: &str, note_index: usize) -> String {
    let digest = Sha256::digest(format!("{message_id}:{note_index}").as_bytes());
    format!("preference.reading.card_{}", hex::encode(&digest[..8]))
}

/// The card under note `note_index` of an assistant message; `None` when there is
/// no such completed assistant message, it has no such note, it has no `memoryCard`,
/// or its `memoryCard` belongs to another note.
pub fn load_memory_card(conn: &Connection, user_id: &str, message_id: &str, note_index: usize) -> DbResult<Option<MemoryCardSource>> {
    let payload: Option<Option<String>> = conn
        .query_row(
            "SELECT structured_payload FROM coach_messages WHERE id = ?1 AND role = 'assistant' AND status = 'completed'",
            [message_id],
            |row| row.get(0),
        )
        .optional()?;
    let payload: Value = payload.flatten().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or(Value::Null);
    let has_note = payload["teachingNotes"].as_array().is_some_and(|notes| note_index < notes.len());
    // Only a card the host actually issued for this note can be confirmed: a message
    // that merely carries a note, or a card for another note, is not a request the
    // learner was ever shown.
    let card_note = payload["memoryCard"]["noteIndex"].as_u64();
    if !has_note || card_note != Some(note_index as u64) {
        return Ok(None);
    }
    ensure_observations_fresh(conn)?;
    Ok(Some(MemoryCardSource {
        state: payload["memoryCardState"].as_str().map(str::to_owned),
        evidence_observation_id: answered_learner_observation(conn, user_id, message_id),
    }))
}

/// The active `user_explicit` reading memory with this key, if the learner already has it.
pub fn active_card_memory(conn: &Connection, user_id: &str, canonical_key: &str) -> DbResult<Option<String>> {
    conn.query_row(
        "SELECT id FROM memory_items
          WHERE user_id = ?1 AND canonical_key = ?2 AND scope = 'activity:reading'
            AND source_class = 'user_explicit' AND status = 'active'
          ORDER BY id LIMIT 1",
        params![user_id, canonical_key],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// Record the learner's decision in the message's payload: the one key
/// `memoryCardState`, the rest of the payload untouched.
pub fn set_memory_card_state(conn: &Connection, message_id: &str, state: &str) -> DbResult<()> {
    if state != CARD_CONFIRMED && state != CARD_DISMISSED {
        return Err(DbError::Validation(format!("unknown memory card state {state}")));
    }
    let changed = conn.execute(
        "UPDATE coach_messages SET structured_payload = json_set(structured_payload, '$.memoryCardState', ?2)
          WHERE id = ?1 AND role = 'assistant' AND json_valid(structured_payload)",
        params![message_id, state],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        Err(DbError::Validation("coach message has no payload to record the decision in".into()))
    }
}
