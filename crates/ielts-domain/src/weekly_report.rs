//! Weekly report v3: the remote data layer (typed blocks) plus the local
//! narrative layer (facts, prose written through fact placeholders, Soul edits).
//!
//! A report is a list of [`ReportBlock`]s, each produced by one deterministic
//! Rust skill from the week's practice records. The block's `data` carries every
//! number the page shows (and the chart it draws); the model never computes a
//! number. The report also carries the projected [`WeeklyFact`] map the model
//! writes against, and the model's validated [`WeeklyNarrative`].
//!
//! The v2 shape (a title plus one sentence per block, no facts) is still read
//! for historical display, but never written: one current schema, one writer.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WEEKLY_REPORT_SCHEMA_VERSION: u32 = 3;
/// The remote typed-block shape written before the narrative layer merged.
/// Read-only: parsed for display, never produced.
pub const LEGACY_WEEKLY_REPORT_SCHEMA_VERSION: u32 = 2;

/// At most this many characters in the narrative's title.
pub const WEEKLY_TITLE_CHARS: usize = 16;

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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
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
    /// A v2 per-block sentence. Filled only when parsing a historical v2
    /// report; v3 never writes it.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "narrative")]
    pub legacy_narrative: Option<String>,
}

impl ReportBlock {
    pub fn new(kind: BlockKind, data: Value) -> Self {
        Self {
            id: kind.id().to_owned(),
            kind,
            data,
            examples: Vec::new(),
            memory_ids: Vec::new(),
            legacy_narrative: None,
        }
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

/// The display unit of one projected number. The page renders it; the model
/// never decides it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactFormat {
    Number,
    Percent,
    Minutes,
    Band,
}

/// Where a fact can be traced for Soul evidence: the passages behind it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactProvenance {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub asset_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memory_ids: Vec<String>,
}

/// One stable fact the narrative may cite as `{{f:ID}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyFact {
    /// A number, or (for quote facts) a string.
    pub value: Value,
    /// The Chinese name the model must match when it cites the fact.
    pub label: String,
    pub format: FactFormat,
    /// The block id the fact was projected from (`soul` for the exam fact).
    pub source: String,
    #[serde(default)]
    pub provenance: FactProvenance,
}

/// A route an actionable narrative line proposes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeTarget {
    #[serde(rename = "type")]
    pub kind: String,
    pub key: String,
}

/// One actionable line of the narrative groups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeItem {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<NarrativeTarget>,
}

/// A question the narrative asks because the profile lacks an answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyQuestion {
    pub key: String,
    pub question: String,
}

/// One refused sentence in the final validation pass.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeViolation {
    pub path: String,
    pub sentence: usize,
    pub code: String,
}

/// The validator's final report. Preflight/repair reports live on the run
/// record and in logs, never in the user's report.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeValidationReport {
    pub dropped_sentences: usize,
    pub needs_repair: bool,
    pub violations: Vec<NarrativeViolation>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrativeValidation {
    #[serde(rename = "final")]
    pub final_report: NarrativeValidationReport,
}

/// The model's validated narrative for one week.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyNarrative {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: Vec<String>,
    #[serde(default)]
    pub changes: Vec<NarrativeItem>,
    #[serde(default)]
    pub next_steps: Vec<NarrativeItem>,
    #[serde(default)]
    pub strengths: Vec<NarrativeItem>,
    #[serde(default)]
    pub weaknesses: Vec<NarrativeItem>,
    #[serde(default)]
    pub ask_user: Option<WeeklyQuestion>,
    #[serde(default)]
    pub validation: NarrativeValidation,
}

/// A Soul edit a weekly run applied, with its audit revision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedProfileEdit {
    pub key: String,
    pub value: Value,
    pub evidence_ids: Vec<String>,
    pub reason: String,
    pub revision_id: String,
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
    /// The one title the page shows: the narrative's, else derived from blocks.
    /// Historical v2 rows carry it under `title`.
    #[serde(default, alias = "title")]
    pub display_title: String,
    pub blocks: Vec<ReportBlock>,
    /// The facts projected from the blocks and the Soul profile. The model may
    /// only cite these; a v3 write must equal a fresh projection exactly.
    #[serde(default)]
    pub facts: BTreeMap<String, WeeklyFact>,
    #[serde(default)]
    pub narrative: Option<WeeklyNarrative>,
    /// Soul revisions this run applied (audit references, newest last).
    #[serde(default)]
    pub profile_edits: Vec<AppliedProfileEdit>,
    #[serde(default)]
    pub memory_changes: Vec<WeeklyMemoryChange>,
}

impl WeeklyReport {
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }
}

/// The title when the model wrote none: what the week was, in the counts the
/// volume block shows. This is the only title derivation in the product.
pub fn derive_title(blocks: &[ReportBlock]) -> String {
    let volume = blocks.iter().find(|block| block.kind == BlockKind::Volume);
    let count = |key: &str| {
        volume
            .and_then(|block| block.data.get(key))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    match (count("readingAttempts"), count("writingEssays")) {
        (0, 0) => "这一周的练习".to_owned(),
        (reading, 0) => format!("这一周读了 {reading} 篇"),
        (0, writing) => format!("这一周写了 {writing} 篇"),
        (reading, writing) => format!("这一周读了 {reading} 篇，写了 {writing} 篇"),
    }
}

/// The one title the page displays: the narrative's when it has one, otherwise
/// the derived title. Both the live and the persisted report use this function.
pub fn display_title(narrative: Option<&WeeklyNarrative>, blocks: &[ReportBlock]) -> String {
    narrative
        .map(|narrative| narrative.title.trim())
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| derive_title(blocks))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn block_ids_are_stable_and_unique() {
        let ids: std::collections::BTreeSet<_> = BlockKind::ALL.iter().map(|kind| kind.id()).collect();
        assert_eq!(ids.len(), BlockKind::ALL.len());
        assert_eq!(serde_json::to_value(BlockKind::QuestionTypes).unwrap(), json!("question_types"));
        assert_eq!(serde_json::to_value(WeeklyReportState::FinalNoAi).unwrap(), json!("final_no_ai"));
    }

    #[test]
    fn the_derived_title_reads_the_volume_block() {
        let volume = ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 4, "writingEssays": 2}));
        assert_eq!(derive_title(&[volume.clone()]), "这一周读了 4 篇，写了 2 篇");
        let reading = ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 4, "writingEssays": 0}));
        assert_eq!(derive_title(&[reading]), "这一周读了 4 篇");
        let writing = ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 0, "writingEssays": 3}));
        assert_eq!(derive_title(&[writing]), "这一周写了 3 篇");
        assert_eq!(derive_title(&[]), "这一周的练习");
    }

    #[test]
    fn the_narrative_title_wins_but_an_empty_one_falls_back() {
        let volume = ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 4, "writingEssays": 2}));
        let mut narrative = WeeklyNarrative { title: " 把错题读慢一点 ".to_owned(), ..WeeklyNarrative::default() };
        assert_eq!(display_title(Some(&narrative), &[volume.clone()]), "把错题读慢一点");
        narrative.title = "   ".to_owned();
        assert_eq!(display_title(Some(&narrative), &[volume.clone()]), "这一周读了 4 篇，写了 2 篇");
        assert_eq!(display_title(None, &[volume]), "这一周读了 4 篇，写了 2 篇");
    }

    #[test]
    fn a_legacy_v2_report_reads_its_title_and_block_sentences() {
        let raw = json!({
            "schemaVersion": 2,
            "window": "2026-W41",
            "windowStart": "2026-10-04T16:00:00Z",
            "windowEnd": "2026-10-11T16:00:00Z",
            "state": "final",
            "generatedAt": "2026-10-11T16:00:00Z",
            "title": "本周练习",
            "blocks": [{
                "id": "accuracy", "kind": "accuracy",
                "data": {"correct": 9, "answered": 12},
                "examples": [], "memoryIds": [], "narrative": "正确率不错。"
            }],
            "memoryChanges": []
        });
        let report: WeeklyReport = serde_json::from_value(raw).unwrap();
        assert_eq!(report.schema_version, LEGACY_WEEKLY_REPORT_SCHEMA_VERSION);
        assert_eq!(report.display_title, "本周练习");
        assert_eq!(report.blocks[0].legacy_narrative.as_deref(), Some("正确率不错。"));
        assert!(report.narrative.is_none());
        assert!(report.facts.is_empty());
    }

    #[test]
    fn v3_serializes_one_title_and_never_a_legacy_sentence() {
        let report = WeeklyReport {
            schema_version: WEEKLY_REPORT_SCHEMA_VERSION,
            window: "2026-W41".to_owned(),
            window_start: "2026-10-04T16:00:00Z".to_owned(),
            window_end: "2026-10-11T16:00:00Z".to_owned(),
            state: WeeklyReportState::Final,
            generated_at: "2026-10-11T16:00:00Z".to_owned(),
            display_title: "这一周读了 4 篇".to_owned(),
            blocks: vec![ReportBlock::new(BlockKind::Volume, json!({"readingAttempts": 4, "writingEssays": 0}))],
            facts: BTreeMap::new(),
            narrative: None,
            profile_edits: Vec::new(),
            memory_changes: Vec::new(),
        };
        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(value["schemaVersion"], json!(3));
        assert_eq!(value["displayTitle"], json!("这一周读了 4 篇"));
        assert!(value.get("title").is_none());
        assert!(value["blocks"][0].get("narrative").is_none());
    }
}
