//! Coach signals: which kinds of feedback the learner gave the coach this
//! week, how often they asked the same question again, and on how many
//! attempts they used the coach at all.

use std::collections::{BTreeMap, BTreeSet};

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::{CoachFact, WeekFacts};
use crate::weekly_report::SkillContext;

const MAX_EXAMPLES: usize = 3;

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let facts = context.current;
    if facts.coach.is_empty() {
        return None;
    }
    let reasks: u32 = facts.coach.iter().map(|fact| fact.reasks).sum();
    let attempts: BTreeSet<&str> =
        facts.coach.iter().map(|fact| fact.attempt_id.as_str()).filter(|id| !id.is_empty()).collect();
    let data = json!({
        "feedback": feedback_rows(&facts.coach),
        "reasks": reasks,
        "attempts": attempts.len() as u32,
    });
    Some(ReportBlock::new(BlockKind::CoachSignals, data).with_examples(examples(facts)))
}

/// Chinese label of a `CoachFeedbackKind` wire name.
fn feedback_label(kind: &str) -> &'static str {
    match kind {
        "thumbs_up" => "有帮助",
        "thumbs_down" => "没帮助",
        "too_long" => "太长",
        "too_short" => "太短",
        "too_abstract" => "太抽象",
        "need_example" => "需要例子",
        "need_step_by_step" => "需要分步讲",
        "incorrect" => "讲错了",
        "not_relevant" => "不相关",
        "reask_same_question" => "同一问题再问",
        "style_correction" => "风格修正",
        _ => "其他反馈",
    }
}

/// Kinds with their counts, most given first, ties by kind.
fn sorted_counts<'a>(counts: impl Iterator<Item = (&'a str, u32)>) -> Vec<(&'a str, u32)> {
    let mut totals: BTreeMap<&str, u32> = BTreeMap::new();
    for (kind, count) in counts {
        *totals.entry(kind).or_default() += count;
    }
    let mut rows: Vec<(&str, u32)> = totals.into_iter().collect();
    rows.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(right.0)));
    rows
}

fn feedback_rows(coach: &[CoachFact]) -> Vec<Value> {
    let counts = coach.iter().flat_map(|fact| fact.feedback.iter().map(|(kind, count)| (kind.as_str(), *count)));
    sorted_counts(counts)
        .into_iter()
        .map(|(kind, count)| json!({"kind": kind, "label": feedback_label(kind), "count": count}))
        .collect()
}

fn examples(facts: &WeekFacts) -> Vec<BlockExample> {
    // Per attempt with a known passage: (asset, its coach facts).
    let mut attempts: BTreeMap<&str, (&str, Vec<&CoachFact>)> = BTreeMap::new();
    for fact in facts.coach.iter().filter(|fact| !fact.attempt_id.is_empty() && !fact.asset_id.is_empty()) {
        attempts.entry(fact.attempt_id.as_str()).or_insert((fact.asset_id.as_str(), Vec::new())).1.push(fact);
    }
    let mut ranked: Vec<(&str, &str, Vec<(&str, u32)>, u32)> = attempts
        .into_iter()
        .map(|(attempt, (asset, group))| {
            let kinds = sorted_counts(group.iter().flat_map(|f| f.feedback.iter().map(|(k, c)| (k.as_str(), *c))));
            let total = kinds.iter().map(|(_, count)| count).sum();
            (attempt, asset, kinds, total)
        })
        .filter(|(_, _, _, total)| *total > 0)
        .collect();
    ranked.sort_by(|left, right| right.3.cmp(&left.3).then(left.0.cmp(right.0)));
    ranked
        .into_iter()
        .take(MAX_EXAMPLES)
        .map(|(attempt, asset, kinds, _)| BlockExample {
            label: format!("「{}」", passage_title(facts, attempt, asset)),
            detail: Some(kinds_detail(&kinds)),
            link: PracticeLink::reading_review(asset, attempt),
        })
        .collect()
}

/// The kinds given on one attempt, most given first. No counts: every number
/// the page shows must be in `data`.
fn kinds_detail(kinds: &[(&str, u32)]) -> String {
    let mut labels: Vec<&str> = Vec::new();
    for label in kinds.iter().map(|(kind, _)| feedback_label(kind)) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels.join("、")
}

fn passage_title(facts: &WeekFacts, attempt_id: &str, asset_id: &str) -> String {
    let from_attempt = facts.reading.iter().find(|r| r.attempt_id == attempt_id).map(|r| r.title.as_str());
    let from_asset = || facts.reading.iter().find(|r| r.asset_id == asset_id).map(|r| r.title.as_str());
    let from_miss = || facts.misses.iter().find(|m| m.asset_id == asset_id).map(|m| m.title.as_str());
    from_attempt
        .or_else(from_asset)
        .or_else(from_miss)
        .filter(|title| !title.is_empty())
        .unwrap_or(asset_id)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weekly_report::facts::ReadingAttemptFact;
    use chrono::NaiveDate;

    fn day(n: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, n).unwrap()
    }

    fn coach(attempt: &str, asset: &str, d: u32, feedback: &[(&str, u32)], reasks: u32) -> CoachFact {
        CoachFact {
            attempt_id: attempt.into(),
            asset_id: asset.into(),
            day: day(d),
            feedback: feedback.iter().map(|(k, c)| ((*k).to_owned(), *c)).collect(),
            reasks,
        }
    }

    fn reading(attempt: &str, asset: &str, title: &str) -> ReadingAttemptFact {
        ReadingAttemptFact {
            obs_id: format!("obs-{attempt}"),
            attempt_id: attempt.into(),
            asset_id: asset.into(),
            title: title.into(),
            day: day(5),
            total: 13,
            correct: 10,
            wrong: 3,
            duration_ms: 0,
            ordinal: 1,
        }
    }

    fn run(facts: &WeekFacts) -> Option<ReportBlock> {
        let previous = WeekFacts::default();
        build(&SkillContext { current: facts, previous: &previous, review_needs: &[], memories: &[] })
    }

    #[test]
    fn hidden_without_coach_use() {
        let facts = WeekFacts { reading: vec![reading("a1", "p1", "Bees")], ..WeekFacts::default() };
        assert!(run(&facts).is_none());
    }

    #[test]
    fn feedback_is_aggregated_across_days_and_attempts_and_sorted() {
        let facts = WeekFacts {
            coach: vec![
                coach("a1", "p1", 5, &[("too_long", 1), ("thumbs_up", 1)], 0),
                coach("a1", "p1", 6, &[("too_long", 1), ("need_example", 2)], 0),
                coach("a2", "p2", 6, &[("thumbs_up", 1), ("incorrect", 1)], 0),
            ],
            ..WeekFacts::default()
        };
        let block = run(&facts).unwrap();
        assert_eq!(block.kind, BlockKind::CoachSignals);
        assert_eq!(block.id, "coach_signals");
        assert_eq!(
            block.data["feedback"],
            json!([
                {"kind": "need_example", "label": "需要例子", "count": 2},
                {"kind": "thumbs_up", "label": "有帮助", "count": 2},
                {"kind": "too_long", "label": "太长", "count": 2},
                {"kind": "incorrect", "label": "讲错了", "count": 1},
            ])
        );
        assert!(block.memory_ids.is_empty());
    }

    #[test]
    fn unknown_kind_gets_the_fallback_label() {
        let facts = WeekFacts { coach: vec![coach("a1", "p1", 5, &[("brand_new_kind", 1)], 0)], ..WeekFacts::default() };
        let block = run(&facts).unwrap();
        assert_eq!(block.data["feedback"], json!([{"kind": "brand_new_kind", "label": "其他反馈", "count": 1}]));
    }

    #[test]
    fn reasks_are_summed_and_attempts_counted_once() {
        let facts = WeekFacts {
            coach: vec![
                coach("a1", "p1", 5, &[], 2),
                coach("a1", "p1", 6, &[], 1),
                coach("a2", "p2", 6, &[], 1),
                coach("", "", 7, &[("thumbs_up", 1)], 0),
            ],
            ..WeekFacts::default()
        };
        let block = run(&facts).unwrap();
        assert_eq!(block.data["reasks"], json!(4));
        assert_eq!(block.data["attempts"], json!(2));
        // No feedback on a1/a2, and the third has no attempt: no examples.
        assert!(block.examples.is_empty());
    }

    #[test]
    fn examples_skip_entries_without_asset_or_attempt() {
        let facts = WeekFacts {
            reading: vec![reading("a1", "p1", "Bees"), reading("a3", "p3", "Glaciers")],
            coach: vec![
                coach("", "p9", 5, &[("too_long", 9)], 0),
                coach("a9", "", 5, &[("too_long", 8)], 0),
                coach("a1", "p1", 5, &[("too_long", 1)], 0),
                coach("a1", "p1", 6, &[("need_example", 2)], 0),
                coach("a2", "p2", 6, &[("thumbs_up", 1)], 0),
                coach("a3", "p3", 6, &[("incorrect", 3)], 0),
                coach("a4", "p4", 7, &[("thumbs_down", 1)], 0),
            ],
            ..WeekFacts::default()
        };
        let block = run(&facts).unwrap();
        let labels: Vec<&str> = block.examples.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(labels, vec!["「Bees」", "「Glaciers」", "「p2」"]);
        assert_eq!(block.examples[0].detail.as_deref(), Some("需要例子、太长"));
        assert_eq!(block.examples[0].link, PracticeLink::reading_review("p1", "a1"));
        assert_eq!(block.examples[2].link, PracticeLink::reading_review("p2", "a2"));
    }
}
