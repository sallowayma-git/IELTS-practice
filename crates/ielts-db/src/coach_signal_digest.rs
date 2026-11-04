//! The coach's teaching notes, read once and summarised once.
//!
//! Three readers used to parse the same stored `structured_payload.teachingNotes`
//! each with its own filters: the coach profile's recent signals, the
//! preference-card eligibility check and the weekly pack and report. This module
//! is the single place that knows what a stored note is ([`read_coach_notes`],
//! [`payload_notes`]) and the single place that turns notes into a ranked
//! summary ([`coach_signal_digest`]).
//!
//! The digest is deterministic and read-only: no model call, no table, no write.
//! It de-duplicates the notes of a window, counts how often and on how many
//! passages each signal came back, ranks them and gives each an expiry by its
//! `horizon`. It is not stored on purpose. Long-term memory is written by the
//! weekly consolidation only, and a stored "working layer" would either break
//! that rule or duplicate the notes themselves; a pure function of the notes
//! gives the same result with nothing to keep in sync.
//!
//! The weekly consolidation (stage three) reads [`SignalDigestEntry`] rows: a
//! signal with a high `repeat_count`, several `distinct_assets` and a wide
//! `first_seen`..`last_seen` span is the evidence that earns long-term memory;
//! one said once on one passage is not.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Duration, Utc};
use ielts_domain::{is_safe_for_prompt, TeachingNoteHorizon, TeachingNoteScope};
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::coach::coach_memory_card_handled;
use crate::sqlite::DbResult;

/// How long a `horizon = recent` note stays a signal.
pub const RECENT_SIGNAL_RECENT_DAYS: i64 = 2;
/// How long a `horizon = durable` note stays a signal: a stable preference ("from
/// now on...") must not vanish from the coach's view after two days, and nothing
/// promotes it to memory before the weekly consolidation.
pub const RECENT_SIGNAL_DURABLE_DAYS: i64 = 14;
/// A longer note text is not a signal (skipped, never cut).
pub const SIGNAL_TEXT_CHARS: usize = 200;
/// The most source messages one digest entry names.
pub const SIGNAL_SOURCES_MAX: usize = 3;

/// Which notes the digest summarises.
const SIGNAL_KINDS: [NoteKind; 3] = [NoteKind::Preference, NoteKind::Difficulty, NoteKind::StrategyOutcome];

/// What a note is: the only three kinds the coach may write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum NoteKind {
    Preference,
    Difficulty,
    StrategyOutcome,
}

impl NoteKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preference => "preference",
            Self::Difficulty => "difficulty",
            Self::StrategyOutcome => "strategy_outcome",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        SIGNAL_KINDS.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// What one stored note says, independent of where it was stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteContent {
    pub kind: NoteKind,
    /// The coach's generalised statement, trimmed and never empty. It is the
    /// stored text: callers that put it in a prompt apply [`Self::prompt_text`].
    pub text: String,
    /// The skill the note is tied to, trimmed; `None` when absent or blank.
    pub skill_key: Option<String>,
    /// Raw `outcome` of a `strategy_outcome` note (`helped` / `not_helped`).
    pub outcome: Option<String>,
    /// Raw teaching strategy label of a `strategy_outcome` note, trimmed.
    pub strategy: Option<String>,
    /// The learner asked to be remembered.
    pub remember: bool,
    /// Absent or unreadable means [`TeachingNoteHorizon::Recent`].
    pub horizon: TeachingNoteHorizon,
}

impl NoteContent {
    /// The text if it may enter a prompt as a signal: safe, and at most
    /// [`SIGNAL_TEXT_CHARS`] characters.
    pub fn prompt_text(&self) -> Option<&str> {
        let fits = self.text.chars().count() <= SIGNAL_TEXT_CHARS && is_safe_for_prompt(&self.text);
        fits.then_some(self.text.as_str())
    }
}

/// The notes of one stored payload, each with its index in the payload's
/// `teachingNotes`. The one acceptance rule for every reader: a payload without
/// a notes array adds nothing; an entry that is not an object, has an unknown
/// `kind` or an empty `text` is skipped; and a note whose `scope` is `question`
/// is about one question, not the learner, so it is never read (a missing or
/// unreadable `scope` is `profile`, a missing or unreadable `horizon` is
/// `recent`, as [`ielts_domain::teaching_note`] defines).
pub fn payload_notes(payload: &Value) -> Vec<(usize, NoteContent)> {
    let notes = payload["teachingNotes"].as_array().into_iter().flatten();
    notes.enumerate().filter_map(|(index, note)| content(note).map(|content| (index, content))).collect()
}

fn content(note: &Value) -> Option<NoteContent> {
    if TeachingNoteScope::of_note(note) == TeachingNoteScope::Question {
        return None;
    }
    Some(NoteContent {
        kind: NoteKind::parse(note["kind"].as_str()?)?,
        text: trimmed(note, "text")?,
        skill_key: trimmed(note, "skillKey"),
        outcome: note["outcome"].as_str().map(str::to_owned),
        strategy: trimmed(note, "strategy"),
        remember: note["remember"].as_bool() == Some(true),
        horizon: TeachingNoteHorizon::of_note(note),
    })
}

fn trimmed(note: &Value, key: &str) -> Option<String> {
    note[key].as_str().map(str::trim).filter(|text| !text.is_empty()).map(str::to_owned)
}

/// A stored note with where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoachNote {
    /// The assistant message that carries the note.
    pub message_id: String,
    /// Index into that message's `teachingNotes`.
    pub note_index: usize,
    /// The passage: the thread's asset, else the asset of the thread's attempt;
    /// empty when the thread belongs to neither.
    pub asset_id: String,
    /// The thread's attempt; empty when it has none.
    pub attempt_id: String,
    /// The message's `created_at`, exactly as stored.
    pub created_at: String,
    /// The learner already confirmed or dismissed this message's memory card.
    pub card_handled: bool,
    pub content: NoteContent,
}

/// A span of message times: after (or from) `from`, up to and including `to`.
#[derive(Debug, Clone, Copy)]
pub struct NoteRange<'a> {
    from: &'a str,
    from_included: bool,
    to: Option<&'a str>,
}

impl<'a> NoteRange<'a> {
    /// Every message at or after `from` (an RFC 3339 instant), however new.
    pub fn since(from: &'a str) -> Self {
        Self { from, from_included: true, to: None }
    }

    /// The messages after `from` up to and including `to`: a report window.
    pub fn between(from: &'a str, to: &'a str) -> Self {
        Self { from, from_included: false, to: Some(to) }
    }
}

/// Every readable note of the completed assistant answers in `range`, oldest
/// answer first (by time, then message id), notes in payload order. A payload
/// that is not JSON, or whose `teachingNotes` is not an array of objects,
/// contributes nothing instead of failing the read. Reads only.
pub fn read_coach_notes(conn: &Connection, range: NoteRange<'_>) -> DbResult<Vec<CoachNote>> {
    let from_op = if range.from_included { ">=" } else { ">" };
    let mut query = conn.prepare(&format!(
        "SELECT m.id, COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), m.created_at, m.structured_payload
           FROM coach_messages m
           LEFT JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE m.role = 'assistant' AND m.status = 'completed'
            AND CASE WHEN json_valid(m.structured_payload) THEN json_extract(m.structured_payload, '$.teachingNotes') END IS NOT NULL
            AND julianday(m.created_at) {from_op} julianday(?1)
            AND (?2 IS NULL OR julianday(m.created_at) <= julianday(?2))
          ORDER BY julianday(m.created_at), m.id"
    ))?;
    let rows = query.query_map(params![range.from, range.to], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (message_id, attempt_id, asset_id, created_at, raw) = row?;
        let payload: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        let card_handled = coach_memory_card_handled(&payload);
        out.extend(payload_notes(&payload).into_iter().map(|(note_index, content)| CoachNote {
            message_id: message_id.clone(),
            note_index,
            asset_id: asset_id.clone(),
            attempt_id: attempt_id.clone(),
            created_at: created_at.clone(),
            card_handled,
            content,
        }));
    }
    Ok(out)
}

/// How long each horizon keeps a note a signal. `session` notes never are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignalWindows {
    /// Days a `recent` note (the default horizon) stays.
    pub recent_days: i64,
    /// Days a `durable` note stays.
    pub durable_days: i64,
}

/// The windows of the coach profile's recent signals.
pub const COACH_SIGNAL_WINDOWS: SignalWindows =
    SignalWindows { recent_days: RECENT_SIGNAL_RECENT_DAYS, durable_days: RECENT_SIGNAL_DURABLE_DAYS };

impl SignalWindows {
    fn days(self, horizon: TeachingNoteHorizon) -> Option<i64> {
        match horizon {
            TeachingNoteHorizon::Session => None,
            TeachingNoteHorizon::Recent => Some(self.recent_days),
            TeachingNoteHorizon::Durable => Some(self.durable_days),
        }
    }

    fn widest(self) -> i64 {
        self.recent_days.max(self.durable_days)
    }
}

/// One signal: every in-window note of the same subject, merged.
///
/// The subject is the note `kind` plus its `skillKey` (or, with no skill, its
/// text), compared ignoring case, hyphens, underscores and spacing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignalDigestEntry {
    pub kind: NoteKind,
    /// The skill of the newest note, as stored (trimmed).
    pub skill_key: Option<String>,
    /// The newest note's text, already safe and short enough for a prompt.
    pub text: String,
    /// At least one of the notes asked to be remembered.
    pub remember: bool,
    /// The longest horizon among the notes: `Durable` beats `Recent`. Never `Session`.
    pub horizon: TeachingNoteHorizon,
    /// In how many different assistant answers the signal appeared (one answer
    /// counts once however many of its notes say it).
    pub repeat_count: usize,
    /// On how many different passages. Answers in a thread with no passage add none.
    pub distinct_assets: usize,
    /// When the oldest and the newest of those answers were stored.
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    /// Up to [`SIGNAL_SOURCES_MAX`] answers that carry it, newest first.
    pub source_message_ids: Vec<String>,
    /// The newest note: its answer and its index in that answer's `teachingNotes`.
    pub best_message_id: String,
    pub best_note_index: usize,
}

/// The signals of the notes stored in the windows ending at `now`, strongest
/// first: asked to be remembered, then repeated in more answers, then seen more
/// recently, then by `(best_message_id, best_note_index)` so the order is total.
///
/// A note counts when it is a preference, difficulty or strategy outcome about
/// the learner (never `scope = question`), its `horizon` is not `session` and
/// its age is within that horizon's window, its text is safe for a prompt and at
/// most [`SIGNAL_TEXT_CHARS`] characters, and its answer's memory card was
/// neither dismissed (the learner said do not remember) nor confirmed (it already
/// is a real memory). Reads only; the same store and `now` give the same result.
pub fn coach_signal_digest(conn: &Connection, now: DateTime<Utc>, windows: SignalWindows) -> DbResult<Vec<SignalDigestEntry>> {
    let since = (now - Duration::days(windows.widest())).to_rfc3339();
    let notes = read_coach_notes(conn, NoteRange::since(&since))?;
    Ok(digest_notes(&notes, now, windows))
}

/// A note that qualifies, with its parsed time.
struct Hit<'a> {
    at: DateTime<Utc>,
    note: &'a CoachNote,
}

impl Hit<'_> {
    /// Oldest first; message id and note index make equal times total.
    fn order(&self) -> (DateTime<Utc>, &str, usize) {
        (self.at, self.note.message_id.as_str(), self.note.note_index)
    }
}

fn hit<'a>(note: &'a CoachNote, now: DateTime<Utc>, windows: SignalWindows) -> Option<Hit<'a>> {
    let days = windows.days(note.content.horizon)?;
    if note.card_handled || note.content.prompt_text().is_none() {
        return None;
    }
    let at = DateTime::parse_from_rfc3339(&note.created_at).ok()?.with_timezone(&Utc);
    (at >= now - Duration::days(days)).then_some(Hit { at, note })
}

/// [`coach_signal_digest`] over notes already read.
pub fn digest_notes(notes: &[CoachNote], now: DateTime<Utc>, windows: SignalWindows) -> Vec<SignalDigestEntry> {
    let mut groups: BTreeMap<(NoteKind, String), Vec<Hit<'_>>> = BTreeMap::new();
    for hit in notes.iter().filter_map(|note| hit(note, now, windows)) {
        groups.entry(subject(&hit.note.content)).or_default().push(hit);
    }
    let mut entries: Vec<SignalDigestEntry> = groups.into_values().map(entry).collect();
    entries.sort_by_key(|entry| {
        (
            Reverse(entry.remember),
            Reverse(entry.repeat_count),
            Reverse(entry.last_seen),
            entry.best_message_id.clone(),
            entry.best_note_index,
        )
    });
    entries
}

/// What makes two notes the same signal.
fn subject(content: &NoteContent) -> (NoteKind, String) {
    let skill = content.skill_key.as_deref().map(normalize).filter(|skill| !skill.is_empty());
    (content.kind, skill.unwrap_or_else(|| normalize(&content.text)))
}

fn entry(mut hits: Vec<Hit<'_>>) -> SignalDigestEntry {
    hits.sort_by(|left, right| left.order().cmp(&right.order()));
    let (first, last) = (&hits[0], &hits[hits.len() - 1]);
    let mut answers: Vec<&str> = Vec::new();
    for hit in hits.iter().rev() {
        if !answers.contains(&hit.note.message_id.as_str()) {
            answers.push(&hit.note.message_id);
        }
    }
    let assets: BTreeSet<&str> =
        hits.iter().map(|hit| hit.note.asset_id.as_str()).filter(|asset| !asset.is_empty()).collect();
    let durable = hits.iter().any(|hit| hit.note.content.horizon == TeachingNoteHorizon::Durable);
    SignalDigestEntry {
        kind: last.note.content.kind,
        skill_key: last.note.content.skill_key.clone(),
        text: last.note.content.text.clone(),
        remember: hits.iter().any(|hit| hit.note.content.remember),
        horizon: if durable { TeachingNoteHorizon::Durable } else { TeachingNoteHorizon::Recent },
        repeat_count: answers.len(),
        distinct_assets: assets.len(),
        first_seen: first.at,
        last_seen: last.at,
        source_message_ids: answers.iter().take(SIGNAL_SOURCES_MAX).map(|id| (*id).to_owned()).collect(),
        best_message_id: last.note.message_id.clone(),
        best_note_index: last.note.note_index,
    }
}

/// Case, hyphens, underscores and spacing do not make a different subject.
fn normalize(text: &str) -> String {
    text.to_lowercase().replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}
