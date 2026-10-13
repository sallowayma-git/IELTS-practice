//! The weekly dream's input: the learner's real practice records inside one
//! window, as compact deterministic lines plus an aggregate header.
//!
//! Everything here is a pure function of the database. There is no model, no
//! passage text, and no table of its own: lines are read from the M2
//! observation projection (attempt scores, wrong questions, redo transitions,
//! writing bands) and from canonical rows the projection does not cover (the
//! learner's answer, the answer key, coach feedback). Each line carries the
//! `obs-*` ids a memory mutation may cite; the host accepts a mutation only if
//! every id it cites is an id in this pack.
//!
//! Size is bounded by `WEEKLY_PACK_TOKEN_CAP`. When the lines do not fit, every
//! line of a question type missed in two or more different passages is kept,
//! then the most recent lines, and the rest is replaced by one "omitted" note.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, SecondsFormat, Utc};
use ielts_domain::estimate_tokens;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::cognitive_read::ensure_observations_fresh;
use crate::learning_observations::{
    LEARNING_OBSERVATION_PROJECTOR_KEY, LEARNING_OBSERVATION_PROJECTOR_VERSION,
};
use crate::reading::scoring::normalize_question_id;
use crate::sqlite::DbResult;

pub const WEEKLY_PACK_SCHEMA_VERSION: u32 = 2;
/// Upper bound of the whole serialized pack, in `estimate_tokens` units.
pub const WEEKLY_PACK_TOKEN_CAP: u32 = 6_000;
/// Fewer scored observations than this in a window is not worth a model call.
pub const WEEKLY_MIN_OBSERVATIONS: usize = 8;

const MAX_MEMORIES: usize = 30;
const MAX_PREFERENCES: usize = 20;
const MAX_COACH_LINES: usize = 20;
const MEMORY_CHARS: usize = 160;
const PREFERENCE_CHARS: usize = 200;
const ANSWER_CHARS: usize = 40;
const MAX_LINE_IDS: usize = 3;
const HEADER_LIST: usize = 5;

/// Observation types the pack reads. Order is irrelevant; membership is the contract.
const PACK_OBSERVATION_TYPES: &str = "'reading.attempt.score','reading.question.outcome',\
    'reading.repeat.corrected','reading.repeat.still_wrong','reading.repeat.newly_wrong',\
    'reading.repeat.still_correct','writing.evaluation.overall_band',\
    'writing.evaluation.criterion_score'";

#[derive(Debug, Clone, PartialEq, Eq)]
enum Facet {
    Attempt,
    Miss { qtype: String, asset: String, attempt: String, qid: String },
    Redo { fixed: u32, still: u32, newly: u32 },
    Writing { lowest: Vec<String> },
    Coach { kinds: BTreeMap<String, u32>, reasks: u32 },
    Review,
}

/// One compact record: what happened on `date`, and the observations it cites.
#[derive(Debug, Clone, Serialize)]
pub struct WeeklyLine {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
    pub date: String,
    pub kind: &'static str,
    pub text: String,
    #[serde(skip)]
    facet: Facet,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMemory {
    pub memory_id: String,
    pub namespace: String,
    pub scope: String,
    pub canonical_key: String,
    pub statement: String,
    pub version: u64,
    pub last_observed: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackPreference {
    pub key: String,
    pub scope: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct WeeklyPack {
    pub start: String,
    pub end: String,
    /// Scored question outcomes plus writing bands in the window.
    pub observation_count: usize,
    pub header: Value,
    pub lines: Vec<WeeklyLine>,
    pub omitted: usize,
    pub memories: Vec<PackMemory>,
    pub preferences: Vec<PackPreference>,
}

impl WeeklyPack {
    pub fn to_value(&self) -> Value {
        let mut pack = json!({
            "schemaVersion": WEEKLY_PACK_SCHEMA_VERSION,
            "window": {"start": self.start, "end": self.end},
            "observationCount": self.observation_count,
            "header": self.header,
            "lines": self.lines,
            "memories": self.memories,
            "preferences": self.preferences,
        });
        if self.omitted > 0 {
            pack["omitted"] = json!(format!("omitted {} older items", self.omitted));
        }
        pack
    }

    pub fn estimated_tokens(&self) -> u32 {
        estimate_tokens(&self.to_value().to_string())
    }

    /// Every observation id a memory mutation may cite.
    pub fn evidence_ids(&self) -> BTreeSet<String> {
        self.lines.iter().flat_map(|line| line.ids.iter().cloned()).collect()
    }

    /// Every memory a mutation may target.
    pub fn memory_ids(&self) -> BTreeSet<String> {
        self.memories.iter().map(|memory| memory.memory_id.clone()).collect()
    }
}

pub(crate) fn instant(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn day(at: &str) -> String {
    at.chars().take(10).collect()
}

fn clip(text: &str, chars: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= chars {
        flat
    } else {
        format!("{}…", flat.chars().take(chars).collect::<String>())
    }
}

pub(crate) fn field<'a>(payload: &'a Value, key: &str) -> &'a str {
    payload.get(key).and_then(Value::as_str).unwrap_or("")
}

pub(crate) struct Obs {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) polarity: Option<String>,
    pub(crate) value_num: Option<f64>,
    pub(crate) value_text: Option<String>,
    pub(crate) payload: Value,
    pub(crate) at: String,
}

pub(crate) fn window_observations(conn: &Connection, user_id: &str, from: &str, to: &str) -> DbResult<Vec<Obs>> {
    let mut statement = conn.prepare(&format!(
        "SELECT id, observation_type, polarity, value_num, value_text, payload_json, observed_at
           FROM learner_observations
          WHERE user_id = ?1 AND projector_key = ?2 AND projector_version = ?3
            AND observation_type IN ({PACK_OBSERVATION_TYPES})
            AND julianday(observed_at) > julianday(?4) AND julianday(observed_at) <= julianday(?5)
          ORDER BY julianday(observed_at), id"
    ))?;
    let rows = statement.query_map(
        params![user_id, LEARNING_OBSERVATION_PROJECTOR_KEY, LEARNING_OBSERVATION_PROJECTOR_VERSION, from, to],
        |row| {
            let payload: String = row.get(5)?;
            Ok(Obs {
                id: row.get(0)?,
                kind: row.get(1)?,
                polarity: row.get(2)?,
                value_num: row.get(3)?,
                value_text: row.get(4)?,
                payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                at: row.get(6)?,
            })
        },
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn is_scored(observation: &Obs) -> bool {
    match observation.kind.as_str() {
        "reading.question.outcome" => observation.polarity.is_some(),
        "writing.evaluation.overall_band" => true,
        _ => false,
    }
}

/// How many scored observations the window holds: the cheap, provider-free test
/// of whether the weekly pass is worth a model call.
pub fn weekly_observation_count(
    conn: &Connection,
    user_id: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> DbResult<usize> {
    ensure_observations_fresh(conn)?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learner_observations
          WHERE user_id = ?1 AND projector_key = ?2 AND projector_version = ?3
            AND ((observation_type = 'reading.question.outcome' AND polarity IS NOT NULL)
                 OR observation_type = 'writing.evaluation.overall_band')
            AND julianday(observed_at) > julianday(?4) AND julianday(observed_at) <= julianday(?5)",
        params![
            user_id,
            LEARNING_OBSERVATION_PROJECTOR_KEY,
            LEARNING_OBSERVATION_PROJECTOR_VERSION,
            instant(start),
            instant(end)
        ],
        |row| row.get(0),
    )?;
    Ok(count as usize)
}

/// A reading passage as the learner met it: title and the answer key, never its text.
struct AssetInfo {
    title: String,
    key: BTreeMap<String, Value>,
    display: BTreeMap<String, String>,
}

pub(crate) struct AssetBook<'c> {
    conn: &'c Connection,
    cache: BTreeMap<String, AssetInfo>,
}

impl<'c> AssetBook<'c> {
    pub(crate) fn new(conn: &'c Connection) -> Self {
        Self { conn, cache: BTreeMap::new() }
    }

    fn info(&mut self, asset: &str) -> &AssetInfo {
        let conn = self.conn;
        self.cache.entry(asset.to_owned()).or_insert_with(|| load_asset_info(conn, asset))
    }

    pub(crate) fn title(&mut self, asset: &str) -> String {
        self.info(asset).title.clone()
    }

    pub(crate) fn label(&mut self, asset: &str, qid: &str) -> String {
        let normalized = normalize_question_id(qid);
        match self.info(asset).display.get(&normalized) {
            Some(number) => format!("q{number}"),
            None => normalized,
        }
    }

    fn key(&mut self, asset: &str, qid: &str) -> Option<Value> {
        self.info(asset).key.get(&normalize_question_id(qid)).cloned()
    }
}

fn load_asset_info(conn: &Connection, asset: &str) -> AssetInfo {
    let mut info = AssetInfo { title: asset.to_owned(), key: BTreeMap::new(), display: BTreeMap::new() };
    if let Ok(loaded) = crate::reading::load_practice_asset_payload(conn, asset) {
        info.title = loaded.asset.title.clone();
        let normalized = |(id, value): (&String, &Value)| (normalize_question_id(id), value.clone());
        if let Some(key) = loaded.payload.get("answerKey").and_then(Value::as_object) {
            info.key = key.iter().map(normalized).collect();
        }
        if let Some(map) = loaded.payload.get("questionDisplayMap").and_then(Value::as_object) {
            info.display = map
                .iter()
                .filter_map(|(id, value)| Some((normalize_question_id(id), value.as_str()?.to_owned())))
                .collect();
        }
    } else if let Ok(title) =
        conn.query_row("SELECT title FROM practice_assets WHERE id = ?1", [asset], |row| row.get::<_, String>(0))
    {
        info.title = title;
    }
    info
}

fn show_answer(value: &Value) -> String {
    match value {
        Value::Null => "(blank)".into(),
        Value::String(text) if text.trim().is_empty() => "(blank)".into(),
        Value::String(text) => clip(text, ANSWER_CHARS),
        Value::Array(items) => clip(&items.iter().map(show_answer).collect::<Vec<_>>().join("/"), ANSWER_CHARS),
        other => clip(&other.to_string(), ANSWER_CHARS),
    }
}

fn learner_answer(conn: &Connection, attempt: &str, qid: &str) -> Value {
    let found: Option<String> = conn
        .query_row(
            "SELECT answer_json FROM attempt_answers WHERE attempt_id = ?1 AND question_id = ?2",
            params![attempt, normalize_question_id(qid)],
            |row| row.get(0),
        )
        .ok();
    found.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or(Value::Null)
}

fn line(ids: Vec<String>, at: &str, kind: &'static str, text: String, facet: Facet) -> WeeklyLine {
    WeeklyLine { ids, date: day(at), kind, text, facet }
}

fn reading_lines(conn: &Connection, window: &[Obs], assets: &mut AssetBook<'_>) -> Vec<WeeklyLine> {
    let mut lines = Vec::new();
    for o in window.iter().filter(|o| o.kind == "reading.attempt.score") {
        let asset = field(&o.payload, "assetId");
        let correct = o.payload.get("correctCount").and_then(Value::as_f64);
        let total = o.payload.get("questionCount").and_then(Value::as_u64);
        let score = match (correct, total) {
            (Some(correct), Some(total)) => format!("correct {correct}/{total}"),
            _ => format!("score {:.2}", o.value_num.unwrap_or_default()),
        };
        let ordinal = o.payload.get("attemptOrdinal").and_then(Value::as_u64).unwrap_or(1);
        let text = format!("{asset} \"{}\" {score}, attempt #{ordinal}", assets.title(asset));
        lines.push(line(vec![o.id.clone()], &o.at, "reading", text, Facet::Attempt));
    }
    for o in window.iter().filter(|o| o.kind == "reading.question.outcome" && o.polarity.as_deref() == Some("negative")) {
        let (asset, attempt, qid) = (field(&o.payload, "assetId"), field(&o.payload, "attemptId"), field(&o.payload, "questionId"));
        let qtype = o.payload.get("questionKind").and_then(Value::as_str).unwrap_or("unknown");
        let given = show_answer(&learner_answer(conn, attempt, qid));
        let key = assets.key(asset, qid).map_or_else(|| "(key unavailable)".to_owned(), |key| show_answer(&key));
        let text = format!("{asset} {} [{qtype}] answered {given} -> key {key}", assets.label(asset, qid));
        let facet = Facet::Miss { qtype: qtype.into(), asset: asset.into(), attempt: attempt.into(), qid: normalize_question_id(qid) };
        lines.push(line(vec![o.id.clone()], &o.at, "miss", text, facet));
    }
    lines
}

/// A redo is a later attempt of a passage the learner already did: one line per
/// redo attempt says how many of the earlier misses it fixed.
fn redo_lines(window: &[Obs], assets: &mut AssetBook<'_>) -> Vec<WeeklyLine> {
    let mut redos: BTreeMap<String, Vec<&Obs>> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind.starts_with("reading.repeat.")) {
        redos.entry(field(&o.payload, "currentAttemptId").to_owned()).or_default().push(o);
    }
    let mut lines = Vec::new();
    for group in redos.values() {
        let asset = field(&group[0].payload, "assetId");
        let mut questions = |kind: &str| -> Vec<String> {
            group
                .iter()
                .filter(|o| o.kind == kind)
                .map(|o| assets.label(asset, field(&o.payload, "questionId")))
                .collect()
        };
        let (fixed, still, newly) = (
            questions("reading.repeat.corrected"),
            questions("reading.repeat.still_wrong"),
            questions("reading.repeat.newly_wrong"),
        );
        let mut text = format!(
            "redo {asset} \"{}\": fixed {} of {} earlier misses",
            assets.title(asset),
            fixed.len(),
            fixed.len() + still.len()
        );
        if !still.is_empty() {
            text += &format!("; still wrong {}", still.join(","));
        }
        if !newly.is_empty() {
            text += &format!("; newly wrong {}", newly.join(","));
        }
        // Misses first: they are the evidence a mutation about repeated errors needs.
        let mut ordered: Vec<&&Obs> = group.iter().collect();
        ordered.sort_by_key(|o| (o.kind != "reading.repeat.still_wrong", o.kind != "reading.repeat.corrected"));
        let ids = ordered.iter().take(MAX_LINE_IDS).map(|o| o.id.clone()).collect();
        let facet = Facet::Redo { fixed: fixed.len() as u32, still: still.len() as u32, newly: newly.len() as u32 };
        lines.push(line(ids, &group[0].at, "redo", text, facet));
    }
    lines
}

fn writing_lines(window: &[Obs]) -> Vec<WeeklyLine> {
    let mut criteria: BTreeMap<&str, Vec<(&str, f64)>> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind == "writing.evaluation.criterion_score") {
        if let (Some(name), Some(value)) = (o.value_text.as_deref(), o.value_num) {
            criteria.entry(field(&o.payload, "attemptId")).or_default().push((name, value));
        }
    }
    let mut lines = Vec::new();
    for o in window.iter().filter(|o| o.kind == "writing.evaluation.overall_band") {
        let mut scores = criteria.get(field(&o.payload, "attemptId")).cloned().unwrap_or_default();
        scores.sort_by(|left, right| left.1.total_cmp(&right.1).then(left.0.cmp(right.0)));
        let lowest: Vec<String> = scores.iter().take(2).map(|(name, value)| format!("{name} {value}")).collect();
        let task = o.payload.get("taskType").and_then(Value::as_str).unwrap_or("writing");
        let mut text = format!("{task} band {}", o.value_num.unwrap_or_default());
        if !lowest.is_empty() {
            text += &format!(", lowest {}", lowest.join(", "));
        }
        let names = scores.iter().take(2).map(|(name, _)| (*name).to_owned()).collect();
        lines.push(line(vec![o.id.clone()], &o.at, "writing", text, Facet::Writing { lowest: names }));
    }
    lines
}

/// The score observation of a reading attempt, whenever it happened: the only
/// citable id a coach or review line can carry.
fn attempt_score_id(conn: &Connection, user_id: &str, attempt: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM learner_observations
          WHERE user_id = ?1 AND projector_key = ?2 AND projector_version = ?3
            AND observation_type = 'reading.attempt.score'
            AND json_extract(payload_json, '$.attemptId') = ?4
          ORDER BY id LIMIT 1",
        params![user_id, LEARNING_OBSERVATION_PROJECTOR_KEY, LEARNING_OBSERVATION_PROJECTOR_VERSION, attempt],
        |row| row.get(0),
    )
    .ok()
}

#[derive(Default)]
struct CoachDay {
    asset: String,
    at: String,
    kinds: BTreeMap<String, u32>,
    reasks: u32,
}

fn coach_lines(conn: &Connection, user_id: &str, from: &str, to: &str, assets: &mut AssetBook<'_>) -> DbResult<Vec<WeeklyLine>> {
    let mut days: BTreeMap<(String, String), CoachDay> = BTreeMap::new();
    let mut feedback = conn.prepare(
        "SELECT COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), f.feedback_kind, f.created_at
           FROM coach_feedback f
           JOIN coach_messages m ON m.id = f.coach_message_id
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE f.user_id = ?1 AND julianday(f.created_at) > julianday(?2) AND julianday(f.created_at) <= julianday(?3)
          ORDER BY julianday(f.created_at), f.id",
    )?;
    let rows = feedback.query_map(params![user_id, from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?))
    })?;
    for row in rows {
        let (attempt, asset, kind, at) = row?;
        let entry = days.entry((attempt, day(&at))).or_default();
        (entry.asset, entry.at) = (asset, at);
        *entry.kinds.entry(kind).or_default() += 1;
    }
    let mut reasks = conn.prepare(
        "SELECT COALESCE(t.attempt_id, ''), COALESCE(t.asset_id, a.asset_id, ''), r.created_at
           FROM coach_reask_links r
           JOIN coach_messages m ON m.id = r.parent_assistant_message_id
           JOIN coach_threads t ON t.id = m.thread_id
           LEFT JOIN attempts a ON a.id = t.attempt_id
          WHERE julianday(r.created_at) > julianday(?1) AND julianday(r.created_at) <= julianday(?2)
          ORDER BY julianday(r.created_at), r.new_user_message_id",
    )?;
    let rows = reasks.query_map(params![from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (attempt, asset, at) = row?;
        let entry = days.entry((attempt, day(&at))).or_default();
        (entry.asset, entry.at) = (asset, at);
        entry.reasks += 1;
    }
    let mut lines = Vec::new();
    for ((attempt, _), entry) in days.into_iter().take(MAX_COACH_LINES) {
        let kinds: Vec<String> = entry
            .kinds
            .iter()
            .map(|(kind, count)| if *count > 1 { format!("{kind} x{count}") } else { kind.clone() })
            .collect();
        let mut parts = Vec::new();
        if !kinds.is_empty() {
            parts.push(format!("feedback {}", kinds.join(", ")));
        }
        if entry.reasks > 0 {
            parts.push(format!("re-asked {}x", entry.reasks));
        }
        let title = if entry.asset.is_empty() { "an attempt".to_owned() } else { format!("{} \"{}\"", entry.asset, assets.title(&entry.asset)) };
        let ids = attempt_score_id(conn, user_id, &attempt).into_iter().collect();
        let facet = Facet::Coach { kinds: entry.kinds, reasks: entry.reasks };
        lines.push(line(ids, &entry.at, "coach", format!("coach on {title}: {}", parts.join("; ")), facet));
    }
    Ok(lines)
}

/// A coach thread opened in the window on an attempt finished before it: the
/// learner went back to an older attempt.
fn review_lines(conn: &Connection, user_id: &str, from: &str, to: &str, assets: &mut AssetBook<'_>) -> DbResult<Vec<WeeklyLine>> {
    let mut statement = conn.prepare(
        "SELECT t.attempt_id, a.asset_id, t.created_at, a.completed_at
           FROM coach_threads t JOIN attempts a ON a.id = t.attempt_id
          WHERE a.activity = 'reading' AND a.completed_at IS NOT NULL
            AND julianday(t.created_at) > julianday(?1) AND julianday(t.created_at) <= julianday(?2)
            AND julianday(a.completed_at) <= julianday(?1)
          ORDER BY julianday(t.created_at), t.id",
    )?;
    let rows = statement.query_map(params![from, to], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?))
    })?;
    let mut lines = Vec::new();
    for row in rows {
        let (attempt, asset, opened, finished) = row?;
        let asset = asset.unwrap_or_default();
        let text = format!("reviewed {asset} \"{}\", attempt of {}", assets.title(&asset), day(&finished));
        let ids = attempt_score_id(conn, user_id, &attempt).into_iter().collect();
        lines.push(line(ids, &opened, "review", text, Facet::Review));
    }
    Ok(lines)
}

/// Aggregates computed from the lines, before any are omitted.
fn header(lines: &[WeeklyLine]) -> Value {
    let mut by_type: BTreeMap<&str, (u32, BTreeSet<&str>)> = BTreeMap::new();
    let mut by_error: BTreeMap<String, u32> = BTreeMap::new();
    let mut by_question: BTreeMap<(&str, &str), BTreeSet<&str>> = BTreeMap::new();
    let (mut attempts, mut misses, mut writing) = (0u32, 0u32, 0u32);
    let (mut fixed, mut still, mut newly, mut reasks, mut reviews) = (0u32, 0u32, 0u32, 0u32, 0u32);
    let mut lowest: BTreeMap<&str, u32> = BTreeMap::new();
    let mut feedback: BTreeMap<&str, u32> = BTreeMap::new();
    for line in lines {
        match &line.facet {
            Facet::Attempt => attempts += 1,
            Facet::Miss { qtype, asset, attempt, qid } => {
                misses += 1;
                let entry = by_type.entry(qtype).or_default();
                entry.0 += 1;
                entry.1.insert(asset);
                *by_error.entry(crate::learner::error_type(Some(qtype))).or_default() += 1;
                by_question.entry((asset.as_str(), qid.as_str())).or_default().insert(attempt);
            }
            Facet::Redo { fixed: f, still: s, newly: n } => (fixed, still, newly) = (fixed + f, still + s, newly + n),
            Facet::Writing { lowest: names } => {
                writing += 1;
                names.iter().for_each(|name| *lowest.entry(name).or_default() += 1);
            }
            Facet::Coach { kinds, reasks: r } => {
                reasks += r;
                kinds.iter().for_each(|(kind, count)| *feedback.entry(kind).or_default() += count);
            }
            Facet::Review => reviews += 1,
        }
    }
    let across: Vec<String> = by_type
        .iter()
        .filter(|(_, (_, assets))| assets.len() >= 2)
        .map(|(qtype, (_, assets))| format!("{qtype} ({} passages)", assets.len()))
        .collect();
    let same: Vec<String> = by_question
        .iter()
        .filter(|(_, attempts)| attempts.len() >= 2)
        .take(HEADER_LIST)
        .map(|((asset, qid), attempts)| format!("{asset} {qid} ({} attempts)", attempts.len()))
        .collect();
    json!({
        "reading": {
            "attempts": attempts,
            "wrongQuestions": misses,
            "byQuestionType": by_type.iter()
                .map(|(qtype, (wrong, assets))| ((*qtype).to_owned(), json!({"wrong": wrong, "passages": assets.len()})))
                .collect::<Map<_, _>>(),
            "byErrorType": by_error,
            "missedAcrossPassages": across,
            "missedAgainInSamePassage": same,
        },
        "redo": {"fixed": fixed, "stillWrong": still, "newlyWrong": newly},
        "writing": {"attempts": writing, "lowestCriteria": lowest},
        "coach": {"feedback": feedback, "reasks": reasks, "reviewedOlderAttempts": reviews},
    })
}

/// Chronological, then by kind, then by text: independent of row or id order.
fn line_order(line: &WeeklyLine) -> (&str, usize, &str) {
    const KINDS: [&str; 6] = ["reading", "miss", "redo", "writing", "coach", "review"];
    (&line.date, KINDS.iter().position(|kind| *kind == line.kind).unwrap_or(KINDS.len()), &line.text)
}

fn line_tokens(line: &WeeklyLine) -> u32 {
    // +1: the separating comma and rounding, so the sum never undershoots the array.
    estimate_tokens(&serde_json::to_string(line).unwrap_or_default()) + 1
}

/// Question types missed in two or more different passages.
fn repeated_question_types(lines: &[WeeklyLine]) -> BTreeSet<String> {
    let mut passages: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for line in lines {
        if let Facet::Miss { qtype, asset, .. } = &line.facet {
            passages.entry(qtype).or_default().insert(asset);
        }
    }
    passages.into_iter().filter(|(_, assets)| assets.len() >= 2).map(|(qtype, _)| qtype.to_owned()).collect()
}

/// Fit the (chronological) lines into `budget` tokens. Lines of repeatedly missed
/// question types stay; then the newest lines, newest first, until the first one
/// that does not fit. If the protected lines alone overflow, the oldest of them go.
/// Returns the survivors in their original order and how many were dropped.
fn cap_lines(lines: Vec<WeeklyLine>, budget: u32) -> (Vec<WeeklyLine>, usize) {
    let repeated = repeated_question_types(&lines);
    let cost: Vec<u32> = lines.iter().map(line_tokens).collect();
    let protected: Vec<bool> = lines
        .iter()
        .map(|line| matches!(&line.facet, Facet::Miss { qtype, .. } if repeated.contains(qtype)))
        .collect();
    let mut keep = protected.clone();
    let mut used: u32 = (0..lines.len()).filter(|i| keep[*i]).map(|i| cost[i]).sum();
    for i in (0..lines.len()).rev().filter(|i| !protected[*i]) {
        if used + cost[i] > budget {
            break;
        }
        keep[i] = true;
        used += cost[i];
    }
    for i in (0..lines.len()).filter(|i| protected[*i]) {
        if used <= budget {
            break;
        }
        keep[i] = false;
        used -= cost[i];
    }
    let total = lines.len();
    let kept: Vec<WeeklyLine> = lines.into_iter().zip(keep).filter_map(|(line, keep)| keep.then_some(line)).collect();
    let omitted = total - kept.len();
    (kept, omitted)
}

pub(crate) fn active_memories(conn: &Connection, user_id: &str) -> DbResult<Vec<PackMemory>> {
    let mut statement = conn.prepare(
        "SELECT id, namespace, scope, canonical_key, content, version, COALESCE(last_observed_at, updated_at)
           FROM memory_items
          WHERE user_id = ?1 AND status = 'active' AND sensitivity = 'normal'
            AND source_class NOT IN ('user_explicit','system_policy','predicted')
            AND scope IN ('activity:reading','activity:writing') AND trim(content) != ''
          ORDER BY julianday(COALESCE(last_observed_at, updated_at)) DESC, id
          LIMIT ?2",
    )?;
    let rows = statement.query_map(params![user_id, MAX_MEMORIES as i64], |row| {
        Ok(PackMemory {
            memory_id: row.get(0)?,
            namespace: row.get(1)?,
            scope: row.get(2)?,
            canonical_key: row.get(3)?,
            statement: clip(&row.get::<_, String>(4)?, MEMORY_CHARS),
            version: row.get::<_, i64>(5)? as u64,
            last_observed: day(&row.get::<_, String>(6)?),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn explicit_preferences(conn: &Connection, user_id: &str) -> DbResult<Vec<PackPreference>> {
    let mut statement = conn.prepare(
        "SELECT preference_key, scope, value_json FROM explicit_user_preferences
          WHERE user_id = ?1 AND status = 'active' ORDER BY preference_key, scope LIMIT ?2",
    )?;
    let rows = statement.query_map(params![user_id, MAX_PREFERENCES as i64], |row| {
        Ok(PackPreference {
            key: row.get(0)?,
            scope: row.get(1)?,
            value: clip(&row.get::<_, String>(2)?, PREFERENCE_CHARS),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Build the weekly pack for the window `(start, end]`. Deterministic: the same
/// database and window always give the same bytes.
pub fn weekly_pack(conn: &Connection, user_id: &str, start: DateTime<Utc>, end: DateTime<Utc>) -> DbResult<WeeklyPack> {
    ensure_observations_fresh(conn)?;
    let (from, to) = (instant(start), instant(end));
    let window = window_observations(conn, user_id, &from, &to)?;
    let mut assets = AssetBook::new(conn);
    let mut lines = reading_lines(conn, &window, &mut assets);
    lines.extend(redo_lines(&window, &mut assets));
    lines.extend(writing_lines(&window));
    lines.extend(coach_lines(conn, user_id, &from, &to, &mut assets)?);
    lines.extend(review_lines(conn, user_id, &from, &to, &mut assets)?);
    lines.sort_by(|left, right| line_order(left).cmp(&line_order(right)));

    let mut pack = WeeklyPack {
        observation_count: window.iter().filter(|o| is_scored(o)).count(),
        header: header(&lines),
        start: from,
        end: to,
        lines: Vec::new(),
        omitted: 0,
        memories: active_memories(conn, user_id)?,
        preferences: explicit_preferences(conn, user_id)?,
    };
    // The omitted note is part of what must fit, so reserve for it up front.
    pack.omitted = lines.len();
    let budget = WEEKLY_PACK_TOKEN_CAP.saturating_sub(pack.estimated_tokens());
    (pack.lines, pack.omitted) = cap_lines(lines, budget);
    Ok(pack)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn miss(day: &str, qtype: &str, asset: &str, qid: &str, filler: usize) -> WeeklyLine {
        line(
            vec![format!("obs-{asset}-{qid}-{day}")],
            day,
            "miss",
            format!("{asset} {qid} [{qtype}] {}", "x".repeat(filler)),
            Facet::Miss { qtype: qtype.into(), asset: asset.into(), attempt: format!("a-{asset}-{day}"), qid: qid.into() },
        )
    }

    fn attempt(day: &str, filler: usize) -> WeeklyLine {
        line(vec![format!("obs-attempt-{day}")], day, "reading", "y".repeat(filler), Facet::Attempt)
    }

    #[test]
    fn cap_keeps_repeated_question_types_then_the_newest_and_drops_the_rest() {
        let lines = vec![
            miss("2026-10-01", "tfng", "P1", "q1", 60),
            miss("2026-10-01", "matching", "P1", "q9", 60),
            attempt("2026-10-02", 60),
            miss("2026-10-03", "tfng", "P2", "q2", 60),
            attempt("2026-10-04", 60),
            attempt("2026-10-05", 60),
        ];
        // Room for the two protected tfng lines plus exactly the newest other line.
        let budget = line_tokens(&lines[0]) + line_tokens(&lines[3]) + line_tokens(&lines[5]);
        let (kept, omitted) = cap_lines(lines.clone(), budget);
        let dates: Vec<_> = kept.iter().map(|line| (line.date.as_str(), line.kind)).collect();
        assert_eq!(dates, vec![("2026-10-01", "miss"), ("2026-10-03", "miss"), ("2026-10-05", "reading")]);
        assert_eq!(omitted, 3);

        // Everything fits: nothing is dropped and order is untouched.
        let (all, none) = cap_lines(lines.clone(), 100_000);
        assert_eq!((all.len(), none), (6, 0));

        // Protected lines alone overflow: the oldest protected line goes first.
        let (tight, _) = cap_lines(lines.clone(), line_tokens(&lines[3]));
        let ids: Vec<_> = tight.iter().flat_map(|line| line.ids.clone()).collect();
        assert_eq!(ids, vec!["obs-P2-q2-2026-10-03".to_string()]);
    }

    #[test]
    fn a_question_type_missed_in_one_passage_is_not_protected() {
        let lines = vec![miss("2026-10-01", "tfng", "P1", "q1", 60), miss("2026-10-02", "tfng", "P1", "q2", 60)];
        assert!(repeated_question_types(&lines).is_empty());
    }

    #[test]
    fn the_header_separates_passages_from_repeats_of_one_passage() {
        let mut again = miss("2026-10-04", "tfng", "P1", "q1", 1);
        again.facet = Facet::Miss { qtype: "tfng".into(), asset: "P1".into(), attempt: "later".into(), qid: "q1".into() };
        let lines = vec![
            miss("2026-10-01", "tfng", "P1", "q1", 1),
            miss("2026-10-02", "tfng", "P2", "q5", 1),
            again,
            miss("2026-10-03", "matching", "P3", "q7", 1),
        ];
        let header = header(&lines);
        assert_eq!(header["reading"]["wrongQuestions"], 4);
        assert_eq!(header["reading"]["byQuestionType"]["tfng"], json!({"wrong": 3, "passages": 2}));
        assert_eq!(header["reading"]["missedAcrossPassages"], json!(["tfng (2 passages)"]));
        assert_eq!(header["reading"]["missedAgainInSamePassage"], json!(["P1 q1 (2 attempts)"]));
        assert_eq!(header["reading"]["byErrorType"]["tfng.boundary"], 3);
    }

    #[test]
    fn answers_are_shown_compactly() {
        assert_eq!(show_answer(&json!("  ")), "(blank)");
        assert_eq!(show_answer(&json!(["A", "C"])), "A/C");
        assert_eq!(show_answer(&Value::Null), "(blank)");
        assert!(show_answer(&json!("x".repeat(100))).chars().count() <= ANSWER_CHARS + 1);
    }
}
