//! Weekly report v3: the week as typed blocks, each built by one deterministic
//! skill from [`WeekFacts`], plus the fact map the narrative layer writes
//! against.
//!
//! The skills are plain functions chosen by the shape of the data (a skill
//! that has nothing to show returns `None`), never by the model. The report is
//! computed live midweek and persisted when the weekend run finishes, together
//! with the model's validated narrative and Soul edits (see `narrative`).

pub mod facts;
pub mod narrative;
pub mod project;
pub mod store;
mod skills;

use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use ielts_domain::{
    display_title, BlockKind, ReportBlock, SkillReviewNeed, SkillReviewNeedsQuery, WeeklyReport,
    WeeklyReportState, WEEKLY_REPORT_SCHEMA_VERSION,
};
use rusqlite::Connection;

pub use facts::{criterion_label, question_type_label, week_facts, WeekFacts};
pub use narrative::{has_usable_body, validate_narrative, NarrativeOutcome};
pub use project::project_weekly_facts;
pub use store::{list_legacy_weekly_digests, list_weekly_reports, previous_weekly_digest, put_weekly_report, LegacyWeeklyDigest, weekly_memory_changes, weekly_mutation_request_id};

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

/// The title a report carries before (or without) the model's is
/// [`ielts_domain::derive_title`]; there is no second derivation here.

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
    let blocks = build_blocks(&context);
    let exam_date = crate::soul::soul_exam_date(conn, user_id)?;
    let facts = project_weekly_facts(&blocks, exam_date, now.with_timezone(&offset).date_naive());
    Ok(WeeklyReport {
        schema_version: WEEKLY_REPORT_SCHEMA_VERSION,
        window: window.key.clone(),
        window_start: rfc3339(window.start),
        window_end: rfc3339(window.end),
        state,
        generated_at: rfc3339(now),
        display_title: display_title(None, &blocks),
        blocks,
        facts,
        narrative: None,
        profile_edits: Vec::new(),
        memory_changes: Vec::new(),
    })
}

pub(crate) fn rfc3339(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}
