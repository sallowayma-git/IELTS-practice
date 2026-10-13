//! Weekly report v2: the week as typed blocks, each built by one deterministic
//! skill from [`WeekFacts`].
//!
//! The skills are plain functions chosen by the shape of the data (a skill
//! that has nothing to show returns `None`), never by the model. The report is
//! computed live midweek and persisted when the weekend run finishes, together
//! with the model's whitelisted narrative (see `narrative`).

pub mod facts;
pub mod narrative;
pub mod store;
mod skills;

use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use ielts_domain::{
    BlockKind, ReportBlock, SkillReviewNeed, SkillReviewNeedsQuery, WeeklyReport, WeeklyReportState,
    WEEKLY_REPORT_SCHEMA_VERSION,
};
use rusqlite::Connection;

pub use facts::{criterion_label, question_type_label, week_facts, WeekFacts};
pub use narrative::apply_narrative;
pub use store::{list_weekly_reports, put_weekly_report};

use crate::dream::WeeklyWindow;
use crate::sqlite::DbResult;
use crate::weekly_pack::PackMemory;

/// Everything a block skill may read.
pub struct SkillContext<'a> {
    /// This window.
    pub current: &'a WeekFacts,
    /// The window of the same length just before it, for "vs last week".
    pub previous: &'a WeekFacts,
    /// The learner model's review schedule as of the window end, highest priority first.
    pub review_needs: &'a [SkillReviewNeed],
    /// Active reading/writing memories, newest first.
    pub memories: &'a [PackMemory],
}

type Skill = fn(&SkillContext<'_>) -> Option<ReportBlock>;

/// The eight skills, in page order.
const SKILLS: [(BlockKind, Skill); 8] = [
    (BlockKind::Volume, skills::volume::build),
    (BlockKind::Accuracy, skills::accuracy::build),
    (BlockKind::QuestionTypes, skills::question_types::build),
    (BlockKind::RepeatedMisses, skills::repeated_misses::build),
    (BlockKind::RedoProgress, skills::redo_progress::build),
    (BlockKind::WritingBands, skills::writing_bands::build),
    (BlockKind::CoachSignals, skills::coach_signals::build),
    (BlockKind::NextWeekPlan, skills::next_week_plan::build),
];

/// Run every skill; keep the blocks that have something to show. A week
/// without any practice has no blocks at all.
pub fn build_blocks(context: &SkillContext<'_>) -> Vec<ReportBlock> {
    if context.current.is_empty() {
        return Vec::new();
    }
    SKILLS
        .iter()
        .filter_map(|(kind, skill)| {
            let block = skill(context)?;
            debug_assert_eq!(block.kind, *kind);
            Some(block)
        })
        .collect()
}

/// The title a report carries before (or without) the model's: what the week
/// was, in counts the blocks show.
pub fn default_title(facts: &WeekFacts) -> String {
    match (facts.reading.len(), facts.writing.len()) {
        (0, 0) => "这一周还没有练习".to_owned(),
        (reading, 0) => format!("这一周读了 {reading} 篇"),
        (0, writing) => format!("这一周写了 {writing} 篇"),
        (reading, writing) => format!("这一周读了 {reading} 篇，写了 {writing} 篇"),
    }
}

fn review_needs(conn: &Connection, as_of: DateTime<Utc>) -> Vec<SkillReviewNeed> {
    let query = SkillReviewNeedsQuery { limit: 8, ..SkillReviewNeedsQuery::default() };
    // The plan block is an addition: a learner model that cannot be read only
    // means there is no plan block.
    crate::learner::skill_review_needs_snapshot_as_of(conn, &query, as_of)
        .map(|snapshot| snapshot.needs)
        .unwrap_or_default()
}

/// The report of `window` in `state`, computed now from the database.
pub fn build_weekly_report(
    conn: &Connection,
    user_id: &str,
    window: &WeeklyWindow,
    offset: FixedOffset,
    state: WeeklyReportState,
    now: DateTime<Utc>,
) -> DbResult<WeeklyReport> {
    let current = week_facts(conn, user_id, window.start, window.end, offset)?;
    let span = window.end - window.start;
    let previous = week_facts(conn, user_id, window.start - span, window.start, offset)?;
    let needs = review_needs(conn, window.end);
    let memories = crate::weekly_pack::active_memories(conn, user_id)?;
    let context = SkillContext { current: &current, previous: &previous, review_needs: &needs, memories: &memories };
    Ok(WeeklyReport {
        schema_version: WEEKLY_REPORT_SCHEMA_VERSION,
        window: window.key.clone(),
        window_start: rfc3339(window.start),
        window_end: rfc3339(window.end),
        state,
        generated_at: rfc3339(now),
        title: default_title(&current),
        blocks: build_blocks(&context),
        memory_changes: Vec::new(),
    })
}

pub(crate) fn rfc3339(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}
