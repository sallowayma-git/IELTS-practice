//! Weekly report v2: typed blocks instead of three lists of prose.
//!
//! A weekly report is a list of [`ReportBlock`]s, each produced by one
//! deterministic Rust skill from the week's practice records. The block's
//! `data` carries every number the page shows (and the chart it draws); the
//! model never computes a number. One model call at the end of the week may add
//! a title and one sentence per block, and every number in those sentences must
//! already be in that block's data ([`numbers_whitelisted`]), or the sentence is
//! dropped.
//!
//! Midweek the same blocks are computed live, without any sentence
//! ([`WeeklyReportState::Live`]).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WEEKLY_REPORT_SCHEMA_VERSION: u32 = 2;

/// At most this many characters in the title the model may write.
pub const WEEKLY_TITLE_CHARS: usize = 40;
/// At most this many characters in one block sentence.
pub const WEEKLY_SENTENCE_CHARS: usize = 120;

/// How far a report got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeeklyReportState {
    /// Midweek: the blocks of the week so far, computed on read, no narrative.
    Live,
    /// The week's run completed and the model wrote its narrative.
    Final,
    /// The week's run completed without a model (none configured, or too little
    /// practice to be worth a call): the blocks are final, there is no narrative.
    FinalNoAi,
    /// The week's run failed (provider / sidecar). The blocks are final; the
    /// narrative is retried on a later day.
    NarrativeFailed,
}

/// The eight deterministic block skills. Which ones appear is decided by the
/// shape of the week's data, never by the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    /// Attempts, essays, active days, minutes, per-day series, vs last week.
    Volume,
    /// Reading correct / answered (blanks apart), per-day series, vs last week.
    Accuracy,
    /// Wrong / answered per question type, with the passages they came from.
    QuestionTypes,
    /// Question types missed in two or more passages; questions missed again.
    RepeatedMisses,
    /// Redone passages: earlier misses fixed, still wrong, newly wrong.
    RedoProgress,
    /// Essay bands and their lowest criteria.
    WritingBands,
    /// Coach feedback kinds and re-asks.
    CoachSignals,
    /// Next week's practice, from the learner model's review schedule.
    NextWeekPlan,
}

impl BlockKind {
    pub const ALL: [BlockKind; 8] = [
        BlockKind::Volume,
        BlockKind::Accuracy,
        BlockKind::QuestionTypes,
        BlockKind::RepeatedMisses,
        BlockKind::RedoProgress,
        BlockKind::WritingBands,
        BlockKind::CoachSignals,
        BlockKind::NextWeekPlan,
    ];

    /// Stable id of the block of this kind (one block per kind per report).
    pub const fn id(self) -> &'static str {
        match self {
            BlockKind::Volume => "volume",
            BlockKind::Accuracy => "accuracy",
            BlockKind::QuestionTypes => "question_types",
            BlockKind::RepeatedMisses => "repeated_misses",
            BlockKind::RedoProgress => "redo_progress",
            BlockKind::WritingBands => "writing_bands",
            BlockKind::CoachSignals => "coach_signals",
            BlockKind::NextWeekPlan => "next_week_plan",
        }
    }
}

/// A route the page can open: a vue-router location `{name, params}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeLink {
    pub name: String,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub params: std::collections::BTreeMap<String, String>,
}

impl PracticeLink {
    /// Open the review of one finished reading attempt.
    pub fn reading_review(asset_id: &str, attempt_id: &str) -> Self {
        Self::new("PracticeReadingReview", &[("assetId", asset_id), ("sessionId", attempt_id)])
    }

    /// Open a reading passage to practise it again.
    pub fn reading(asset_id: &str) -> Self {
        Self::new("PracticeReading", &[("assetId", asset_id)])
    }

    /// Open the result page of one writing evaluation.
    pub fn writing_result(session_id: &str) -> Self {
        Self::new("Result", &[("sessionId", session_id)])
    }

    /// The writing composer.
    pub fn writing() -> Self {
        Self::new("Compose", &[])
    }

    /// The reading library.
    pub fn library() -> Self {
        Self::new("PracticeLibrary", &[])
    }

    fn new(name: &str, params: &[(&str, &str)]) -> Self {
        Self {
            name: name.to_owned(),
            params: params.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect(),
        }
    }
}

/// A concrete practice record behind a block: "P3 q5", with a link to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockExample {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub link: PracticeLink,
}

/// One typed block of a weekly report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportBlock {
    pub id: String,
    pub kind: BlockKind,
    /// Kind-specific data (see each skill). Every number shown comes from here.
    pub data: Value,
    #[serde(default)]
    pub examples: Vec<BlockExample>,
    /// Active memories this block's data speaks to.
    #[serde(default)]
    pub memory_ids: Vec<String>,
    /// The model's one sentence for this block, after the number whitelist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narrative: Option<String>,
}

impl ReportBlock {
    pub fn new(kind: BlockKind, data: Value) -> Self {
        Self { id: kind.id().to_owned(), kind, data, examples: Vec::new(), memory_ids: Vec::new(), narrative: None }
    }

    pub fn with_examples(mut self, examples: Vec<BlockExample>) -> Self {
        self.examples = examples;
        self
    }
}

/// What the weekly pass changed in memory, as the page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyMemoryChange {
    pub action: String,
    pub memory_id: String,
    #[serde(default)]
    pub statement: String,
}

/// One weekly report, live or persisted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReport {
    pub schema_version: u32,
    /// ISO week of the weekend the report belongs to (`2026-W41`).
    pub window: String,
    /// RFC3339 UTC, start exclusive.
    pub window_start: String,
    pub window_end: String,
    pub state: WeeklyReportState,
    pub generated_at: String,
    /// Deterministic default, replaced by the model's title when it passes.
    pub title: String,
    pub blocks: Vec<ReportBlock>,
    #[serde(default)]
    pub memory_changes: Vec<WeeklyMemoryChange>,
}

impl WeeklyReport {
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }
}

/// The model's narrative for one week: a title and one sentence per block id.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyNarrative {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub sentences: std::collections::BTreeMap<String, String>,
}

/// Every number written in `text`: Arabic numerals (`12`, `0.5`, `6.5`), and
/// Chinese numerals used as counts (`三次`, `两篇`, `十二道`). Percent signs and
/// fractions are read number by number (`3/5` is 3 and 5).
pub fn numbers_in_text(text: &str) -> Vec<f64> {
    let chars: Vec<char> = text.chars().collect();
    let mut numbers = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < chars.len() && chars[i] == '.' && chars[i + 1].is_ascii_digit() {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let literal: String = chars[start..i].iter().collect();
            if let Ok(value) = literal.parse::<f64>() {
                numbers.push(value);
            }
            continue;
        }
        if chinese_digit(chars[i]).is_some() {
            let start = i;
            while i < chars.len() && chinese_digit(chars[i]).is_some() {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            let counted = chars.get(i).is_some_and(|next| CHINESE_MEASURE_WORDS.contains(*next));
            if counted {
                if let Some(value) = chinese_number(&run) {
                    numbers.push(value);
                }
            }
            continue;
        }
        i += 1;
    }
    numbers
}

/// A Chinese numeral is only a number when a measure word follows it: "一些",
/// "一直", "一致" are words, "三次", "两篇" are counts.
const CHINESE_MEASURE_WORDS: &str = "次道篇题天个周项处组分倍成段套";

fn chinese_digit(ch: char) -> Option<u32> {
    Some(match ch {
        '零' => 0,
        '一' => 1,
        '二' | '两' => 2,
        '三' => 3,
        '四' => 4,
        '五' => 5,
        '六' => 6,
        '七' => 7,
        '八' => 8,
        '九' => 9,
        '十' => 10,
        '百' => 100,
        _ => return None,
    })
}

/// Chinese numerals up to 999 (`十二`, `二十`, `一百零五`).
fn chinese_number(run: &str) -> Option<f64> {
    let mut total = 0u32;
    let mut pending = 0u32;
    for ch in run.chars() {
        let digit = chinese_digit(ch)?;
        match digit {
            10 | 100 => {
                total += pending.max(1) * digit;
                pending = 0;
            }
            _ => pending = digit,
        }
    }
    Some(f64::from(total + pending))
}

/// Every number anywhere in a JSON value (keys excluded), as written by the
/// host. Strings are scanned too, so "q5" and "P3" allow 5 and 3.
pub fn numbers_in_value(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::Number(number) => {
            if let Some(float) = number.as_f64() {
                out.insert(number_key(float));
                // A ratio in data may be written as a percentage in prose.
                if (0.0..=1.0).contains(&float) && float.fract() != 0.0 {
                    out.insert(number_key((float * 100.0).round()));
                }
            }
        }
        Value::String(text) => {
            for number in numbers_in_text(text) {
                out.insert(number_key(number));
            }
        }
        Value::Array(items) => items.iter().for_each(|item| numbers_in_value(item, out)),
        Value::Object(map) => map.values().for_each(|item| numbers_in_value(item, out)),
        Value::Bool(_) | Value::Null => {}
    }
}

fn number_key(value: f64) -> String {
    // 6.50 and 6.5 are the same number; 3.0 and 3 too.
    let rounded = (value * 100.0).round() / 100.0;
    format!("{rounded}")
}

/// Whether every number in `text` is one of `allowed` (built with
/// [`numbers_in_value`]). A sentence that states a number the host never
/// computed is the model inventing data.
pub fn numbers_whitelisted(text: &str, allowed: &BTreeSet<String>) -> bool {
    numbers_in_text(text).into_iter().all(|number| allowed.contains(&number_key(number)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allowed(value: Value) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        numbers_in_value(&value, &mut out);
        out
    }

    #[test]
    fn reads_arabic_and_counted_chinese_numbers() {
        assert_eq!(numbers_in_text("本周练了 12 篇，正确率 0.75，写作 6.5 分"), vec![12.0, 0.75, 6.5]);
        assert_eq!(numbers_in_text("错了三次，两篇文章，十二道题，二十天"), vec![3.0, 2.0, 12.0, 20.0]);
        assert_eq!(numbers_in_text("一直在进步，一些题目一致"), Vec::<f64>::new());
        assert_eq!(numbers_in_text("3/5 道"), vec![3.0, 5.0]);
    }

    #[test]
    fn a_sentence_passes_only_with_numbers_from_the_block() {
        let data = allowed(json!({"attempts": 4, "accuracy": 0.75, "labels": ["P8 q7"], "band": 6.5}));
        assert!(numbers_whitelisted("这周做了 4 篇，正确率 75%。", &data));
        assert!(numbers_whitelisted("P8 第7题又错了", &data));
        assert!(numbers_whitelisted("写作 6.50 分", &data));
        assert!(numbers_whitelisted("没有数字的句子", &data));
        assert!(!numbers_whitelisted("这周做了 5 篇", &data));
        assert!(!numbers_whitelisted("错了三次", &data));
    }

    #[test]
    fn block_ids_are_stable_and_unique() {
        let ids: BTreeSet<_> = BlockKind::ALL.iter().map(|kind| kind.id()).collect();
        assert_eq!(ids.len(), BlockKind::ALL.len());
        assert_eq!(serde_json::to_value(BlockKind::QuestionTypes).unwrap(), json!("question_types"));
        assert_eq!(serde_json::to_value(WeeklyReportState::FinalNoAi).unwrap(), json!("final_no_ai"));
    }
}
