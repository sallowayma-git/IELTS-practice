//! Recent signals: what the learner told the coach in the last two days, read
//! from the coach's own teaching notes at the moment a profile is built.
//!
//! Long-term memory is written by the weekly consolidation only, so what the
//! learner says today would otherwise reach no other thread for days. This is
//! the working layer in front of that: a deterministic read-time slice of the
//! stored notes. It writes nothing, calls no model, and its output is frozen on
//! the new thread with the rest of the profile, so a thread's prompt prefix
//! stays byte-stable.
//!
//! A note qualifies when it says something about the learner (`scope` is not
//! `question`), is expected to outlive its conversation (`horizon` is not
//! `session`), is a preference, a difficulty or a strategy outcome, is safe for
//! a prompt and short, and its message card was neither dismissed (the learner
//! said do not remember) nor confirmed (it already is a real memory).
//!
//! Priority is derived here, never declared by the model: a note the learner
//! asked to be remembered first, then the (kind, skill) that came up most often
//! in the window, then the newest. The same (kind, skill) is shown once, by its
//! newest note.

use std::cmp::Reverse;
use std::collections::HashMap;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde_json::Value;

use ielts_domain::{is_safe_for_prompt, TeachingNoteHorizon, TeachingNoteScope};

use crate::coach::{coach_memory_card_handled, ProfileStatement};
use crate::sqlite::DbResult;

/// How far back a note still counts as a recent signal.
pub const RECENT_SIGNAL_WINDOW_DAYS: i64 = 2;
/// Most signals one profile carries.
pub const RECENT_SIGNAL_MAX: usize = 4;
/// A longer note is skipped, never cut.
const SIGNAL_TEXT_CHARS: usize = 200;
const SIGNAL_KINDS: [&str; 3] = ["preference", "difficulty", "strategy_outcome"];

/// What makes two signals the same one: the note kind and its skill (or, with
/// no skill, its normalized text).
type Group = (String, String);

struct Signal {
    id: String,
    group: Group,
    text: String,
    remember: bool,
}

/// The signals of the window ending at `now`, strongest first, at most
/// [`RECENT_SIGNAL_MAX`]. Ids are `signal:<messageId>:<noteIndex>`, which never
/// starts with `mem-`, so a signal is not a recalled memory.
pub fn recent_signals(conn: &Connection, now: DateTime<Utc>) -> DbResult<Vec<ProfileStatement>> {
    let ranked = rank(window_signals(conn, now)?);
    Ok(ranked.into_iter().map(|signal| ProfileStatement { id: signal.id, statement: signal.text }).collect())
}

/// Every qualifying note of the window, oldest first: by message time, then
/// message id, then note index.
fn window_signals(conn: &Connection, now: DateTime<Utc>) -> DbResult<Vec<Signal>> {
    let since = (now - Duration::days(RECENT_SIGNAL_WINDOW_DAYS)).to_rfc3339();
    let mut query = conn.prepare(
        "SELECT m.id, m.structured_payload
           FROM coach_messages m
          WHERE m.role = 'assistant' AND m.status = 'completed'
            AND CASE WHEN json_valid(m.structured_payload) THEN json_extract(m.structured_payload, '$.teachingNotes') END IS NOT NULL
            AND julianday(m.created_at) >= julianday(?1)
          ORDER BY julianday(m.created_at), m.id",
    )?;
    let rows = query.query_map(params![since], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (message_id, raw) = row?;
        let payload: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        if coach_memory_card_handled(&payload) {
            continue;
        }
        let notes = payload["teachingNotes"].as_array().into_iter().flatten();
        out.extend(notes.enumerate().filter_map(|(index, note)| signal(&message_id, index, note)));
    }
    Ok(out)
}

fn signal(message_id: &str, index: usize, note: &Value) -> Option<Signal> {
    if TeachingNoteScope::of_note(note) == TeachingNoteScope::Question
        || TeachingNoteHorizon::of_note(note) == TeachingNoteHorizon::Session
    {
        return None;
    }
    let kind = note["kind"].as_str().filter(|kind| SIGNAL_KINDS.contains(kind))?;
    let text = note["text"].as_str()?.trim();
    if text.is_empty() || text.chars().count() > SIGNAL_TEXT_CHARS || !is_safe_for_prompt(text) {
        return None;
    }
    let skill = note["skillKey"].as_str().map(normalize).filter(|skill| !skill.is_empty());
    Some(Signal {
        id: format!("signal:{message_id}:{index}"),
        group: (kind.to_owned(), skill.unwrap_or_else(|| normalize(text))),
        text: text.to_owned(),
        remember: note["remember"].as_bool() == Some(true),
    })
}

/// One signal per group (its newest), ordered remember first, then by how often
/// the group came up in the window, then newest first, cut to the maximum. The
/// input position is unique, so the order is total and deterministic.
fn rank(observed: Vec<Signal>) -> Vec<Signal> {
    let mut counts: HashMap<Group, usize> = HashMap::new();
    let mut newest: HashMap<Group, (usize, Signal)> = HashMap::new();
    for (position, signal) in observed.into_iter().enumerate() {
        *counts.entry(signal.group.clone()).or_default() += 1;
        newest.insert(signal.group.clone(), (position, signal));
    }
    let mut kept: Vec<(usize, Signal)> = newest.into_values().collect();
    kept.sort_by_key(|(position, signal)| (Reverse(signal.remember), Reverse(counts[&signal.group]), Reverse(*position)));
    kept.into_iter().take(RECENT_SIGNAL_MAX).map(|(_, signal)| signal).collect()
}

/// Case, hyphens, underscores and spacing do not make a different subject.
fn normalize(text: &str) -> String {
    text.to_lowercase().replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}
