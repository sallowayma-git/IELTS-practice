//! The week's practice as plain facts: the one input every block skill reads.
//!
//! Built from the same sources as the weekly pack (the M2 observation
//! projection plus the canonical rows it does not cover), so the report and the
//! model's pack never disagree. Days are the learner's local days: `offset` is
//! the local UTC offset the caller resolved for this window.

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::cognitive_read::ensure_observations_fresh;
use crate::reading::scoring::normalize_question_id;
use crate::sqlite::DbResult;
use crate::weekly_pack::{field, instant, window_observations, AssetBook, Obs};

/// One finished reading attempt.
#[derive(Debug, Clone, PartialEq)]
pub struct ReadingAttemptFact {
    pub obs_id: String,
    pub attempt_id: String,
    pub asset_id: String,
    pub title: String,
    pub day: NaiveDate,
    /// Questions of the passage.
    pub total: u32,
    /// Questions answered right / wrong. Blank answers are neither.
    pub correct: u32,
    pub wrong: u32,
    pub duration_ms: i64,
    /// 1 for a first attempt of the passage, 2+ for a redo.
    pub ordinal: u32,
}

impl ReadingAttemptFact {
    pub fn answered(&self) -> u32 {
        self.correct + self.wrong
    }

    pub fn blank(&self) -> u32 {
        self.total.saturating_sub(self.answered())
    }
}

/// One wrong answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissFact {
    pub obs_id: String,
    pub attempt_id: String,
    pub asset_id: String,
    pub title: String,
    pub question_id: String,
    /// "q5" when the passage numbers its questions, else the normalized id.
    pub label: String,
    /// Question type key (`tfng`, `matching_headings`, …).
    pub qtype: String,
    pub day: NaiveDate,
}

/// One redo of an earlier passage and what it did to the earlier misses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedoFact {
    pub attempt_id: String,
    pub asset_id: String,
    pub title: String,
    pub day: NaiveDate,
    pub fixed: Vec<String>,
    pub still_wrong: Vec<String>,
    pub newly_wrong: Vec<String>,
    pub obs_ids: Vec<String>,
}

/// One evaluated essay.
#[derive(Debug, Clone, PartialEq)]
pub struct WritingFact {
    pub obs_id: String,
    pub attempt_id: String,
    /// Evaluation session, for the result page link.
    pub session_id: Option<String>,
    pub task_type: String,
    pub band: f64,
    /// Criterion scores, lowest first.
    pub criteria: Vec<(String, f64)>,
    pub day: NaiveDate,
}

/// Coach use on one attempt on one day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoachFact {
    pub attempt_id: String,
    pub asset_id: String,
    pub day: NaiveDate,
    pub feedback: BTreeMap<String, u32>,
    pub reasks: u32,
}

/// Everything the block skills read about one window.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WeekFacts {
    /// Local days the window covers, oldest first.
    pub days: Vec<NaiveDate>,
    pub reading: Vec<ReadingAttemptFact>,
    pub misses: Vec<MissFact>,
    pub redos: Vec<RedoFact>,
    pub writing: Vec<WritingFact>,
    pub coach: Vec<CoachFact>,
    /// Per question type: (answered right, answered wrong). Blanks are neither.
    pub type_totals: BTreeMap<String, (u32, u32)>,
}

impl WeekFacts {
    pub fn is_empty(&self) -> bool {
        self.reading.is_empty() && self.writing.is_empty() && self.coach.is_empty()
    }

    /// Local days with any reading or writing practice.
    pub fn active_days(&self) -> usize {
        let mut days: Vec<NaiveDate> =
            self.reading.iter().map(|r| r.day).chain(self.writing.iter().map(|w| w.day)).collect();
        days.sort();
        days.dedup();
        days.len()
    }
}

/// Display label of a reading question type, shared by every block (and the
/// model, which writes about types by these names).
pub fn question_type_label(qtype: &str) -> String {
    match qtype {
        "classification" => "分类题",
        "diagram_completion" => "图示填空",
        "flow_chart_completion" => "流程图填空",
        "matching_headings" => "段落大意配对",
        "matching_information" => "信息配对",
        "matching_features" => "特征配对",
        "matching_sentence_endings" => "句尾配对",
        "matching" => "配对题",
        "multi_choice" => "多选题",
        "notes_completion" => "笔记填空",
        "sentence_completion" => "句子填空",
        "short_answer" => "简答题",
        "single_choice" => "单选题",
        "summary_completion" => "摘要填空",
        "table_completion" => "表格填空",
        "tfng" | "true_false_not_given" => "判断题",
        "yng" | "yes_no_not_given" => "是非题",
        _ => "其他题型",
    }
    .to_owned()
}

/// Display label of a writing criterion.
pub fn criterion_label(criterion: &str) -> String {
    match criterion {
        "taskResponse" => "任务回应",
        "coherence" => "连贯与衔接",
        "lexical" => "词汇资源",
        "grammar" => "语法",
        _ => "其他维度",
    }
    .to_owned()
}

fn local_day(at: &str, offset: FixedOffset) -> NaiveDate {
    DateTime::parse_from_rfc3339(at)
        .map(|instant| instant.with_timezone(&offset).date_naive())
        .unwrap_or_else(|_| NaiveDate::parse_from_str(at.get(..10).unwrap_or(""), "%Y-%m-%d").unwrap_or_default())
}

fn window_days(start: DateTime<Utc>, end: DateTime<Utc>, offset: FixedOffset) -> Vec<NaiveDate> {
    let first = (start + chrono::Duration::seconds(1)).with_timezone(&offset).date_naive();
    let last = end.with_timezone(&offset).date_naive();
    first.iter_days().take_while(|day| *day <= last).collect()
}

fn count(value: Option<&Value>) -> u32 {
    value.and_then(Value::as_f64).map_or(0, |number| number.max(0.0).round() as u32)
}

fn attempt_duration(conn: &Connection, attempt: &str) -> i64 {
    conn.query_row("SELECT duration_ms FROM attempts WHERE id = ?1", [attempt], |row| row.get(0)).unwrap_or(0)
}

/// The session that produced `evaluation`, the one the example opens.
fn writing_session(conn: &Connection, evaluation: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM evaluation_sessions WHERE evaluation_id = ?1
          ORDER BY started_at DESC, id DESC LIMIT 1",
        [evaluation],
        |row| row.get(0),
    )
    .ok()
}

/// The evaluation a writing ledger event reports on.
fn evaluation_of(conn: &Connection, event: &str) -> String {
    conn.query_row(
        "SELECT COALESCE(json_extract(payload_json, '$.evaluationId'), '') FROM learning_events WHERE id = ?1",
        [event],
        |row| row.get(0),
    )
    .unwrap_or_default()
}

/// Creation order of the attempt's evaluations, oldest first: the order
/// `load_evaluation_for_attempt` picks the canonical one by. A retry outranks
/// the call it retried even when that older call finishes last.
fn evaluation_ranks(conn: &Connection, attempt: &str) -> BTreeMap<String, usize> {
    let ids = conn
        .prepare(
            "SELECT id FROM writing_evaluations WHERE attempt_id = ?1
              ORDER BY COALESCE(started_at, updated_at), rowid, id",
        )
        .and_then(|mut statement| {
            statement.query_map([attempt], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default();
    ids.into_iter().enumerate().map(|(rank, id)| (id, rank)).collect()
}

fn reading_facts(conn: &Connection, window: &[Obs], assets: &mut AssetBook<'_>, offset: FixedOffset) -> Vec<ReadingAttemptFact> {
    let mut outcomes: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind == "reading.question.outcome") {
        let entry = outcomes.entry(field(&o.payload, "attemptId")).or_default();
        match o.polarity.as_deref() {
            Some("positive") => entry.0 += 1,
            Some("negative") => entry.1 += 1,
            _ => {}
        }
    }
    window
        .iter()
        .filter(|o| o.kind == "reading.attempt.score")
        .map(|o| {
            let attempt = field(&o.payload, "attemptId");
            let asset = field(&o.payload, "assetId");
            let total = count(o.payload.get("questionCount"));
            let (correct, wrong) = outcomes
                .get(attempt)
                .copied()
                .unwrap_or_else(|| {
                    let correct = count(o.payload.get("correctCount"));
                    (correct, total.saturating_sub(correct))
                });
            ReadingAttemptFact {
                obs_id: o.id.clone(),
                attempt_id: attempt.to_owned(),
                asset_id: asset.to_owned(),
                title: assets.title(asset),
                day: local_day(&o.at, offset),
                total: total.max(correct + wrong),
                correct,
                wrong,
                duration_ms: attempt_duration(conn, attempt),
                ordinal: count(o.payload.get("attemptOrdinal")).max(1),
            }
        })
        .collect()
}

fn type_totals(window: &[Obs]) -> BTreeMap<String, (u32, u32)> {
    let mut totals: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind == "reading.question.outcome") {
        let qtype = o.payload.get("questionKind").and_then(Value::as_str).unwrap_or("unknown");
        match o.polarity.as_deref() {
            Some("positive") => totals.entry(qtype.to_owned()).or_default().0 += 1,
            Some("negative") => totals.entry(qtype.to_owned()).or_default().1 += 1,
            _ => {}
        }
    }
    totals
}

fn miss_facts(window: &[Obs], assets: &mut AssetBook<'_>, offset: FixedOffset) -> Vec<MissFact> {
    window
        .iter()
        .filter(|o| o.kind == "reading.question.outcome" && o.polarity.as_deref() == Some("negative"))
        .map(|o| {
            let (asset, qid) = (field(&o.payload, "assetId"), field(&o.payload, "questionId"));
            MissFact {
                obs_id: o.id.clone(),
                attempt_id: field(&o.payload, "attemptId").to_owned(),
                asset_id: asset.to_owned(),
                title: assets.title(asset),
                question_id: normalize_question_id(qid),
                label: assets.label(asset, qid),
                qtype: o.payload.get("questionKind").and_then(Value::as_str).unwrap_or("unknown").to_owned(),
                day: local_day(&o.at, offset),
            }
        })
        .collect()
}

fn redo_facts(window: &[Obs], assets: &mut AssetBook<'_>, offset: FixedOffset) -> Vec<RedoFact> {
    let mut groups: BTreeMap<&str, Vec<&Obs>> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind.starts_with("reading.repeat.")) {
        groups.entry(field(&o.payload, "currentAttemptId")).or_default().push(o);
    }
    groups
        .into_iter()
        .map(|(attempt, group)| {
            let asset = field(&group[0].payload, "assetId");
            let labels = |assets: &mut AssetBook<'_>, kind: &str| -> Vec<String> {
                group
                    .iter()
                    .filter(|o| o.kind == kind)
                    .map(|o| assets.label(asset, field(&o.payload, "questionId")))
                    .collect()
            };
            let fixed = labels(assets, "reading.repeat.corrected");
            let still_wrong = labels(assets, "reading.repeat.still_wrong");
            let newly_wrong = labels(assets, "reading.repeat.newly_wrong");
            RedoFact {
                attempt_id: attempt.to_owned(),
                asset_id: asset.to_owned(),
                title: assets.title(asset),
                day: local_day(&group[0].at, offset),
                fixed,
                still_wrong,
                newly_wrong,
                obs_ids: group.iter().map(|o| o.id.clone()).collect(),
            }
        })
        .collect()
}

/// One fact per essay. A re-evaluated attempt emits a fresh overall band and four
/// criterion scores per evaluation, all keyed by the same attempt. Only its
/// canonical evaluation counts: the newest by creation, as the history view
/// shows it, not the one that finished last. Its criteria are matched by
/// `eventId` and its session by evaluation id, so a retried essay is neither
/// counted twice nor given a mix of two evaluations' scores.
fn writing_facts(conn: &Connection, window: &[Obs], offset: FixedOffset) -> Vec<WritingFact> {
    let mut criteria: BTreeMap<&str, Vec<(String, f64)>> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind == "writing.evaluation.criterion_score") {
        if let (Some(name), Some(value)) = (o.value_text.as_deref(), o.value_num) {
            criteria.entry(field(&o.payload, "eventId")).or_default().push((name.to_owned(), value));
        }
    }
    let mut by_attempt: BTreeMap<&str, Vec<&Obs>> = BTreeMap::new();
    for o in window.iter().filter(|o| o.kind == "writing.evaluation.overall_band") {
        by_attempt.entry(field(&o.payload, "attemptId")).or_default().push(o);
    }
    let mut essays: Vec<(&Obs, String)> = by_attempt
        .into_iter()
        .filter_map(|(attempt, bands)| {
            let ranks = evaluation_ranks(conn, attempt);
            let ranked = bands.into_iter().map(|o| (evaluation_of(conn, field(&o.payload, "eventId")), o));
            let order = |(evaluation, o): &(String, &Obs)| (ranks.get(evaluation).copied(), o.at.clone(), o.id.clone());
            let (evaluation, band) = ranked.max_by_key(order)?;
            Some((band, evaluation))
        })
        .collect();
    essays.sort_by(|left, right| left.0.at.cmp(&right.0.at).then(left.0.id.cmp(&right.0.id)));
    essays
        .into_iter()
        .map(|(o, evaluation)| {
            let mut scores = criteria.get(field(&o.payload, "eventId")).cloned().unwrap_or_default();
            scores.sort_by(|left, right| left.1.total_cmp(&right.1).then(left.0.cmp(&right.0)));
            WritingFact {
                obs_id: o.id.clone(),
                attempt_id: field(&o.payload, "attemptId").to_owned(),
                session_id: writing_session(conn, &evaluation),
                task_type: o.payload.get("taskType").and_then(Value::as_str).unwrap_or("writing").to_owned(),
                band: o.value_num.unwrap_or_default(),
                criteria: scores,
                day: local_day(&o.at, offset),
            }
        })
        .collect()
}

fn coach_facts(conn: &Connection, user_id: &str, from: &str, to: &str, offset: FixedOffset) -> DbResult<Vec<CoachFact>> {
    let mut days: BTreeMap<(String, NaiveDate), CoachFact> = BTreeMap::new();
    fn entry(
        days: &mut BTreeMap<(String, NaiveDate), CoachFact>,
        attempt: String,
        asset: String,
        day: NaiveDate,
    ) -> &mut CoachFact {
        days.entry((attempt.clone(), day)).or_insert_with(|| CoachFact {
            attempt_id: attempt,
            asset_id: asset,
            day,
            feedback: BTreeMap::new(),
            reasks: 0,
        })
    }
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
        *entry(&mut days, attempt, asset, local_day(&at, offset)).feedback.entry(kind).or_default() += 1;
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
        entry(&mut days, attempt, asset, local_day(&at, offset)).reasks += 1;
    }
    Ok(days.into_values().collect())
}

/// The facts of the window `(start, end]`, with days in the local `offset`.
/// Deterministic: the same database and window give the same facts.
pub fn week_facts(
    conn: &Connection,
    user_id: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    offset: FixedOffset,
) -> DbResult<WeekFacts> {
    ensure_observations_fresh(conn)?;
    let (from, to) = (instant(start), instant(end));
    let window = window_observations(conn, user_id, &from, &to)?;
    let mut assets = AssetBook::new(conn);
    Ok(WeekFacts {
        days: window_days(start, end, offset),
        reading: reading_facts(conn, &window, &mut assets, offset),
        misses: miss_facts(&window, &mut assets, offset),
        redos: redo_facts(&window, &mut assets, offset),
        writing: writing_facts(conn, &window, offset),
        coach: coach_facts(conn, user_id, &from, &to, offset)?,
        type_totals: type_totals(&window),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn days_are_local_days() {
        let beijing = FixedOffset::east_opt(8 * 3600).unwrap();
        // 2026-10-12 23:30 UTC is already the 13th in Beijing.
        assert_eq!(local_day("2026-10-12T23:30:00Z", beijing), NaiveDate::from_ymd_opt(2026, 10, 13).unwrap());
        let days = window_days(utc("2026-10-03T16:00:00Z"), utc("2026-10-10T15:59:59Z"), beijing);
        assert_eq!(days.first(), NaiveDate::from_ymd_opt(2026, 10, 4).as_ref());
        assert_eq!(days.last(), NaiveDate::from_ymd_opt(2026, 10, 10).as_ref());
        assert_eq!(days.len(), 7);
    }

    fn writing_obs(id: &str, kind: &str, event: &str, attempt: &str, at: &str, criterion: Option<&str>, value: f64) -> Obs {
        Obs {
            id: id.into(),
            kind: kind.into(),
            polarity: None,
            value_num: Some(value),
            value_text: criterion.map(str::to_owned),
            payload: serde_json::json!({"eventId": event, "attemptId": attempt, "taskType": "task2"}),
            at: at.into(),
        }
    }

    /// Review on #243: a completed retry of the same essay emits another overall
    /// band and four criterion scores under the same attempt.
    #[test]
    fn a_re_evaluated_essay_counts_once_with_its_latest_scores() {
        let conn = Connection::open_in_memory().unwrap();
        let band = "writing.evaluation.overall_band";
        let score = "writing.evaluation.criterion_score";
        let mut window = Vec::new();
        for (event, at, overall, lexical) in [("ev-1", "2026-10-06T10:00:00Z", 5.5, 5.0), ("ev-2", "2026-10-07T10:00:00Z", 6.5, 7.0)] {
            window.push(writing_obs(&format!("{event}-band"), band, event, "essay", at, None, overall));
            window.push(writing_obs(&format!("{event}-lex"), score, event, "essay", at, Some("lexical"), lexical));
            window.push(writing_obs(&format!("{event}-gra"), score, event, "essay", at, Some("grammar"), 6.0));
        }
        let facts = writing_facts(&conn, &window, FixedOffset::east_opt(0).unwrap());
        assert_eq!(facts.len(), 1, "one essay, evaluated twice");
        assert_eq!(facts[0].band, 6.5);
        assert_eq!(facts[0].criteria, vec![("grammar".to_owned(), 6.0), ("lexical".to_owned(), 7.0)]);
        assert_eq!(facts[0].day, NaiveDate::from_ymd_opt(2026, 10, 7).unwrap());
    }

    #[test]
    fn blanks_are_neither_right_nor_wrong() {
        let fact = ReadingAttemptFact {
            obs_id: "obs".into(),
            attempt_id: "a".into(),
            asset_id: "p".into(),
            title: "t".into(),
            day: NaiveDate::default(),
            total: 13,
            correct: 8,
            wrong: 2,
            duration_ms: 0,
            ordinal: 1,
        };
        assert_eq!((fact.answered(), fact.blank()), (10, 3));
    }
}
