//! What the learner did with the coach in one window, as plain facts.
//!
//! One module owns every coach input of the report: feedback, explicit re-asks,
//! the questions the learner asked (so a week of chatting without a single
//! thumbs-up still counts as coach use), the coach's teaching notes (its own
//! generalised reading of a session: a wish about how to be taught, a recurring
//! difficulty, or a strategy that did or did not help), how each teaching
//! strategy was received, and what became of the questions the coach was asked
//! about once the learner redid the passage.
//!
//! The last one is the only learning-outcome signal: satisfaction (feedback)
//! and learning (the redo) stay in separate fields and are never merged, and
//! nothing here claims the coach caused the result. Everything is a pure
//! function of the database and the window.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use ielts_domain::{CoachStrategyId, TEACHING_NOTE_STRATEGY_CHARS};
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::coach_signal_digest::{read_coach_notes, CoachNote, NoteContent, NoteKind, NoteRange, SIGNAL_TEXT_CHARS};
use crate::reading::scoring::normalize_question_id;
use crate::sqlite::DbResult;
use crate::weekly_pack::{field, note_field, note_text, Obs};

use super::facts::local_day;

/// The automatic whole-attempt review is a host request, not a learner question.
const REVIEW_ACTION: &str = "review_set";

/// What a teaching note says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum NoteVerdict {
    /// The learner asked for a way of explaining.
    Wished,
    /// The coach saw a difficulty that keeps coming back.
    Difficulty,
    /// The learner said an explanation strategy helped.
    Helped,
    /// The learner said it did not help.
    NotHelped,
}

/// One teaching note. The strategy is the coach's own label (a catalog id for
/// current notes), sanitized exactly as the weekly pack sanitizes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteFact {
    pub verdict: NoteVerdict,
    pub strategy: Option<String>,
}

/// A stored note as the weekly pack and the report both read it: the one
/// acceptance rule, so the two never disagree about what the coach recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReadNote {
    pub fact: NoteFact,
    /// Skill key the coach tied the note to, sanitized.
    pub skill: Option<String>,
    /// The coach's generalised rule, sanitized and clipped for the prompt.
    pub text: String,
}

/// Longest note text that reaches the prompt, in characters.
pub(crate) const NOTE_TEXT_CHARS: usize = SIGNAL_TEXT_CHARS;
const NOTE_SKILL_CHARS: usize = 80;

/// The weekly reading of one stored note (the stored notes themselves are read
/// by [`read_coach_notes`], which already left out malformed notes and those
/// whose `scope` is `question`: about one question, not about the learner, so
/// the pack and the report never see them). `None` when the text is unsafe, or a
/// `strategy_outcome` does not say `helped` or `not_helped`. Unlike a signal, a
/// long text is clipped here, not skipped.
///
/// Old messages (a `preference` or `strategy_outcome` with a verified
/// `evidence` quote) and current ones (any of the three kinds, `evidence`
/// optional) are read by the same rule: `evidence` plays no part, and the
/// coach's `text` is the content either way.
pub(crate) fn read_note(note: &NoteContent) -> Option<ReadNote> {
    let text = note_text(&note.text, NOTE_TEXT_CHARS)?;
    let verdict = match (note.kind, note.outcome.as_deref()) {
        (NoteKind::Preference, _) => NoteVerdict::Wished,
        (NoteKind::Difficulty, _) => NoteVerdict::Difficulty,
        (NoteKind::StrategyOutcome, Some("helped")) => NoteVerdict::Helped,
        (NoteKind::StrategyOutcome, Some("not_helped")) => NoteVerdict::NotHelped,
        _ => return None,
    };
    let reported = matches!(verdict, NoteVerdict::Helped | NoteVerdict::NotHelped);
    let strategy = note.strategy.as_deref().and_then(|raw| note_field(raw, TEACHING_NOTE_STRATEGY_CHARS)).filter(|_| reported);
    let skill = note.skill_key.as_deref().and_then(|raw| note_field(raw, NOTE_SKILL_CHARS));
    Some(ReadNote { fact: NoteFact { verdict, strategy }, skill, text })
}

/// The readable notes of the window `(from, to]`, oldest answer first, each with
/// the weekly reading and where it was stored.
pub(crate) fn read_window_notes(conn: &Connection, from: &str, to: &str) -> DbResult<Vec<(CoachNote, ReadNote)>> {
    let notes = read_coach_notes(conn, NoteRange::between(from, to))?;
    Ok(notes.into_iter().filter_map(|note| read_note(&note.content).map(|read| (note, read))).collect())
}

/// Coach use on one attempt on one day.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoachFact {
    pub attempt_id: String,
    pub asset_id: String,
    pub day: NaiveDate,
    pub feedback: BTreeMap<String, u32>,
    pub reasks: u32,
    /// Messages the learner sent to the coach (the automatic review excluded).
    pub asks: u32,
    pub notes: Vec<NoteFact>,
}

/// One time the learner asked the coach about one question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskedQuestion {
    pub attempt_id: String,
    pub asset_id: String,
    /// Normalized question id.
    pub question_id: String,
    pub message_id: String,
}

/// An earlier miss the learner redid in the window: fixed or still wrong, and
/// whether the learner had asked the coach about that question before redoing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedoQuestion {
    pub asset_id: String,
    pub question_id: String,
    pub fixed: bool,
    pub explained: bool,
}

/// How often, and on how many different passages, one signal was given.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tally {
    pub count: u32,
    pub assets: BTreeSet<String>,
}

/// Everything the learner signalled about one teaching strategy in the window:
/// feedback on answers the coach gave with it (`need_example`, `too_long`, ...)
/// and the learner's reports that it `helped` or `not_helped`. Counts only: the
/// strategy is the coach's choice, so nothing here says it caused anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyFeedback {
    /// A catalog id (`example_first_v1`, ...).
    pub strategy: String,
    pub signals: BTreeMap<String, Tally>,
}

impl StrategyFeedback {
    pub fn total(&self) -> u32 {
        self.signals.values().map(|tally| tally.count).sum()
    }

    /// The different passages any signal came from.
    pub fn articles(&self) -> BTreeSet<&str> {
        self.signals.values().flat_map(|tally| tally.assets.iter().map(String::as_str)).collect()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoachWeek {
    pub days: Vec<CoachFact>,
    pub asked: Vec<AskedQuestion>,
    pub redone: Vec<RedoQuestion>,
    pub strategies: Vec<StrategyFeedback>,
}

type DayKey = (String, NaiveDate);

fn day_entry(days: &mut BTreeMap<DayKey, CoachFact>, attempt: String, asset: String, day: NaiveDate) -> &mut CoachFact {
    days.entry((attempt.clone(), day))
        .or_insert_with(|| CoachFact { attempt_id: attempt, asset_id: asset, day, ..CoachFact::default() })
}

/// The coach facts of the window `(from, to]`, days in the local `offset`.
pub(super) fn coach_week(
    conn: &Connection,
    user_id: &str,
    window: &[Obs],
    from: &str,
    to: &str,
    offset: FixedOffset,
) -> DbResult<CoachWeek> {
    let mut days = BTreeMap::new();
    add_feedback(conn, user_id, &mut days, from, to, offset)?;
    add_reasks(conn, &mut days, from, to, offset)?;
    let asked = add_asks(conn, &mut days, from, to, offset)?;
    add_notes(conn, &mut days, from, to, offset)?;
    let strategies = strategy_feedback(conn, user_id, &days, from, to)?;
    Ok(CoachWeek { days: days.into_values().collect(), asked, redone: redone_questions(conn, window)?, strategies })
}

/// What a strategy's name is, ignoring case, hyphens, underscores and spacing.
pub(crate) fn strategy_key(label: &str) -> String {
    label.to_lowercase().replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The catalog id a strategy label names, if it names one.
fn catalog_strategy(label: &str) -> Option<&'static str> {
    let key = strategy_key(label);
    CoachStrategyId::ALL.into_iter().map(CoachStrategyId::as_str).find(|id| strategy_key(id) == key)
}

type Signals = BTreeMap<String, BTreeMap<String, Tally>>;

fn signal(signals: &mut Signals, strategy: &str, kind: &str, asset: &str, times: u32) {
    let tally = signals.entry(strategy.to_owned()).or_default().entry(kind.to_owned()).or_default();
    tally.count += times;
    if !asset.is_empty() {
        tally.assets.insert(asset.to_owned());
    }
}

/// Per teaching strategy: the feedback given on the answers the coach wrote with
/// it (joined on the coach message, so a strategy is credited only with its own
/// answers) plus the `helped` / `not_helped` reports of the notes. Notes naming
/// something outside the strategy catalog are left to the free-form tally.
fn strategy_feedback(
    conn: &Connection,
    user_id: &str,
    days: &BTreeMap<DayKey, CoachFact>,
    from: &str,
    to: &str,
) -> DbResult<Vec<StrategyFeedback>> {
    let mut signals = Signals::new();
    let mut query = conn.prepare(
        "SELECT s.strategy_id, f.feedback_kind, COALESCE(t.asset_id, a.asset_id, ''), COUNT(*)
           FROM coach_feedback f
           JOIN coach_strategy_assignments_v0 s ON s.coach_message_id = f.coach_message_id
           JOIN coach_messages m ON m.id = f.coach_message_id
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE f.user_id = ?1 AND f.feedback_kind != 'reask_same_question'
            AND julianday(f.created_at) > julianday(?2) AND julianday(f.created_at) <= julianday(?3)
          GROUP BY s.strategy_id, f.feedback_kind, COALESCE(t.asset_id, a.asset_id, '')",
    )?;
    let rows = query.query_map(params![user_id, from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, u32>(3)?))
    })?;
    for row in rows {
        let (strategy, kind, asset, times) = row?;
        signal(&mut signals, &strategy, &kind, &asset, times);
    }
    for fact in days.values() {
        for note in &fact.notes {
            let reported = match note.verdict {
                NoteVerdict::Helped => "helped",
                NoteVerdict::NotHelped => "not_helped",
                _ => continue,
            };
            if let Some(strategy) = note.strategy.as_deref().and_then(catalog_strategy) {
                signal(&mut signals, strategy, reported, &fact.asset_id, 1);
            }
        }
    }
    Ok(signals.into_iter().map(|(strategy, signals)| StrategyFeedback { strategy, signals }).collect())
}

fn add_feedback(
    conn: &Connection,
    user_id: &str,
    days: &mut BTreeMap<DayKey, CoachFact>,
    from: &str,
    to: &str,
    offset: FixedOffset,
) -> DbResult<()> {
    // A `reask_same_question` verdict row would count the same re-ask a second
    // time: the re-ask link table is the one source of re-asks.
    let mut query = conn.prepare(
        "SELECT COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), f.feedback_kind, f.created_at
           FROM coach_feedback f
           JOIN coach_messages m ON m.id = f.coach_message_id
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE f.user_id = ?1 AND f.feedback_kind != 'reask_same_question'
            AND julianday(f.created_at) > julianday(?2) AND julianday(f.created_at) <= julianday(?3)
          ORDER BY julianday(f.created_at), f.id",
    )?;
    let rows = query.query_map(params![user_id, from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?))
    })?;
    for row in rows {
        let (attempt, asset, kind, at) = row?;
        *day_entry(days, attempt, asset, local_day(&at, offset)).feedback.entry(kind).or_default() += 1;
    }
    Ok(())
}

fn add_reasks(
    conn: &Connection,
    days: &mut BTreeMap<DayKey, CoachFact>,
    from: &str,
    to: &str,
    offset: FixedOffset,
) -> DbResult<()> {
    let mut query = conn.prepare(
        "SELECT COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), r.created_at
           FROM coach_reask_links r
           JOIN coach_messages m ON m.id = r.parent_assistant_message_id
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE julianday(r.created_at) > julianday(?1) AND julianday(r.created_at) <= julianday(?2)
          ORDER BY julianday(r.created_at), r.new_user_message_id",
    )?;
    let rows = query.query_map(params![from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (attempt, asset, at) = row?;
        day_entry(days, attempt, asset, local_day(&at, offset)).reasks += 1;
    }
    Ok(())
}

/// Learner messages to the coach in the window, and the questions they named.
fn add_asks(
    conn: &Connection,
    days: &mut BTreeMap<DayKey, CoachFact>,
    from: &str,
    to: &str,
    offset: FixedOffset,
) -> DbResult<Vec<AskedQuestion>> {
    let mut query = conn.prepare(
        "SELECT COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), m.id, m.structured_payload, m.created_at
           FROM coach_messages m
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE m.role = 'user'
            AND julianday(m.created_at) > julianday(?1) AND julianday(m.created_at) <= julianday(?2)
          ORDER BY julianday(m.created_at), m.id",
    )?;
    let rows = query.query_map(params![from, to], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut asked = Vec::new();
    for row in rows {
        let (attempt, asset, message, payload, at) = row?;
        let payload = parse(payload.as_deref());
        if field(&payload, "action") == REVIEW_ACTION {
            continue;
        }
        for question in focus_questions(&payload) {
            asked.push(AskedQuestion {
                attempt_id: attempt.clone(),
                asset_id: asset.clone(),
                question_id: question,
                message_id: message.clone(),
            });
        }
        day_entry(days, attempt, asset, local_day(&at, offset)).asks += 1;
    }
    Ok(asked)
}

/// The host-validated teaching notes of the window. A note counts only if the
/// weekly pack would also show it (same acceptance rule), so the report and
/// the model's pack never disagree about what the learner said.
fn add_notes(
    conn: &Connection,
    days: &mut BTreeMap<DayKey, CoachFact>,
    from: &str,
    to: &str,
    offset: FixedOffset,
) -> DbResult<()> {
    for (note, read) in read_window_notes(conn, from, to)? {
        let day = local_day(&note.created_at, offset);
        day_entry(days, note.attempt_id, note.asset_id, day).notes.push(read.fact);
    }
    Ok(())
}

/// For every earlier miss redone in the window: fixed or still wrong, and
/// whether the learner had asked the coach about it before the redo started.
fn redone_questions(conn: &Connection, window: &[Obs]) -> DbResult<Vec<RedoQuestion>> {
    let mut asks: BTreeMap<String, Vec<(DateTime<Utc>, BTreeSet<String>)>> = BTreeMap::new();
    let mut started: BTreeMap<String, Option<DateTime<Utc>>> = BTreeMap::new();
    let mut out = Vec::new();
    for o in window {
        let fixed = match o.kind.as_str() {
            "reading.repeat.corrected" => true,
            "reading.repeat.still_wrong" => false,
            _ => continue,
        };
        let (asset, attempt) = (field(&o.payload, "assetId"), field(&o.payload, "currentAttemptId"));
        let question = normalize_question_id(field(&o.payload, "questionId"));
        if asset.is_empty() || question.is_empty() {
            continue;
        }
        if !asks.contains_key(asset) {
            asks.insert(asset.to_owned(), learner_asks(conn, asset)?);
        }
        if !started.contains_key(attempt) {
            started.insert(attempt.to_owned(), attempt_start(conn, attempt));
        }
        let before = started[attempt].or_else(|| instant_of(&o.at));
        let explained = before.is_some_and(|before| {
            asks[asset].iter().any(|(at, questions)| *at < before && questions.contains(&question))
        });
        out.push(RedoQuestion { asset_id: asset.to_owned(), question_id: question, fixed, explained });
    }
    out.sort_by(|left, right| {
        (&left.asset_id, &left.question_id, left.fixed, left.explained)
            .cmp(&(&right.asset_id, &right.question_id, right.fixed, right.explained))
    });
    Ok(out)
}

/// When the learner asked about which questions of one passage, any time.
fn learner_asks(conn: &Connection, asset: &str) -> DbResult<Vec<(DateTime<Utc>, BTreeSet<String>)>> {
    let mut query = conn.prepare(
        "SELECT m.created_at, m.structured_payload
           FROM coach_messages m
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE m.role = 'user' AND COALESCE(t.asset_id, a.asset_id, '') = ?1",
    )?;
    let rows = query.query_map([asset], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))?;
    let mut asks = Vec::new();
    for row in rows {
        let (at, payload) = row?;
        let payload = parse(payload.as_deref());
        let questions: BTreeSet<String> = focus_questions(&payload).into_iter().collect();
        if let (Some(at), false) = (instant_of(&at), field(&payload, "action") == REVIEW_ACTION) {
            asks.push((at, questions));
        }
    }
    Ok(asks)
}

fn attempt_start(conn: &Connection, attempt: &str) -> Option<DateTime<Utc>> {
    conn.query_row("SELECT started_at FROM attempts WHERE id = ?1", [attempt], |row| row.get::<_, String>(0))
        .ok()
        .and_then(|at| instant_of(&at))
}

fn instant_of(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at).ok().map(|value| value.with_timezone(&Utc))
}

fn parse(payload: Option<&str>) -> Value {
    payload.and_then(|raw| serde_json::from_str(raw).ok()).unwrap_or(Value::Null)
}

/// The host-resolved question ids a learner message was about, normalized and distinct.
fn focus_questions(payload: &Value) -> Vec<String> {
    let ids: BTreeSet<String> = payload["focusQuestionIds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(normalize_question_id)
        .filter(|id| !id.is_empty())
        .collect();
    ids.into_iter().collect()
}
