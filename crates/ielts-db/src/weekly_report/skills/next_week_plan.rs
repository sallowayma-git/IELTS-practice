//! Next week's practice: a deterministic port of the old study planner on top
//! of the learner model's review schedule.

use std::cmp::Ordering;

use ielts_domain::{
    BlockExample, BlockKind, PracticeLink, ReportBlock, SkillReviewNeed, SkillReviewProbe, UncertaintyBand,
};
use serde_json::{json, Value};

use crate::weekly_pack::PackMemory;
use crate::weekly_report::{criterion_label, question_type_label, SkillContext};

/// One wrong answer is not a plan item.
const MIN_EVIDENCE: u64 = 2;
const MAX_ITEMS: usize = 3;
const DEFAULT_PROBE_MINUTES: u32 = 15;
const MIN_PROBE_MINUTES: u32 = 5;
const MAX_TOTAL_MINUTES: u32 = 45;

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let mut needs = ordered_needs(context.review_needs);
    let minutes = budget_minutes(needs.len());
    needs.truncate(minutes.len());
    if needs.is_empty() {
        return None;
    }
    let items: Vec<Value> = needs.iter().zip(&minutes).map(|(need, minutes)| item(need, *minutes)).collect();
    let examples = needs.iter().map(|need| example(need)).collect();
    let data = json!({ "items": items, "totalMinutes": minutes.iter().sum::<u32>() });
    let mut block = ReportBlock::new(BlockKind::NextWeekPlan, data).with_examples(examples);
    block.memory_ids = memory_ids(context.memories, &needs);
    Some(block)
}

/// Eligible needs, priority desc, more uncertain first, then skill key; at most three.
fn ordered_needs(needs: &[SkillReviewNeed]) -> Vec<&SkillReviewNeed> {
    let mut eligible: Vec<&SkillReviewNeed> = needs.iter().filter(|need| need.evidence_count >= MIN_EVIDENCE).collect();
    eligible.sort_by(|a, b| {
        b.priority
            .partial_cmp(&a.priority)
            .unwrap_or(Ordering::Equal)
            .then_with(|| uncertainty_rank(&a.uncertainty_band).cmp(&uncertainty_rank(&b.uncertainty_band)))
            .then_with(|| a.skill_key.cmp(&b.skill_key))
    });
    eligible.truncate(MAX_ITEMS);
    eligible
}

fn uncertainty_rank(band: &UncertaintyBand) -> u8 {
    match band {
        UncertaintyBand::High => 0,
        UncertaintyBand::Medium => 1,
        UncertaintyBand::Low => 2,
    }
}

/// Minutes per item: the default each, the last one clamped to what is left of
/// the cap; an item that would get less than the minimum is dropped.
fn budget_minutes(count: usize) -> Vec<u32> {
    let mut minutes = Vec::with_capacity(count);
    let mut total = 0;
    for _ in 0..count {
        let left = MAX_TOTAL_MINUTES - total;
        if left < MIN_PROBE_MINUTES {
            break;
        }
        let estimate = DEFAULT_PROBE_MINUTES.min(left);
        minutes.push(estimate);
        total += estimate;
    }
    minutes
}

fn item(need: &SkillReviewNeed, minutes: u32) -> Value {
    json!({
        "skillKey": need.skill_key,
        "label": skill_label(&need.skill_key),
        "priorityBand": need.priority_band,
        "probe": serde_json::to_value(&need.preferred_probe).unwrap_or(Value::Null),
        "probeLabel": probe_label(&need.preferred_probe),
        "reasons": need.reason_codes,
        "minutes": minutes,
    })
}

fn example(need: &SkillReviewNeed) -> BlockExample {
    let link = if is_writing(&need.skill_key) { PracticeLink::writing() } else { PracticeLink::library() };
    BlockExample { label: skill_label(&need.skill_key), detail: None, link }
}

/// The question type (reading) or criterion (writing) a skill key is about.
fn subject(skill_key: &str) -> &str {
    let rest = skill_key.split_once('.').map_or(skill_key, |(_, rest)| rest);
    rest.split('.').next().unwrap_or(rest)
}

fn is_writing(skill_key: &str) -> bool {
    skill_key.starts_with("writing.")
}

fn skill_label(skill_key: &str) -> String {
    if is_writing(skill_key) {
        format!("写作 · {}", criterion_label(subject(skill_key)))
    } else {
        question_type_label(subject(skill_key))
    }
}

fn probe_label(probe: &SkillReviewProbe) -> &'static str {
    match probe {
        SkillReviewProbe::NovelItem => "换一篇新文章练同类题",
        SkillReviewProbe::SameItemRetention => "重做原题检查记住没有",
        SkillReviewProbe::ContrastivePair => "对比练习易混题",
        SkillReviewProbe::CoachMicroDrill => "和教练做一次小练习",
        SkillReviewProbe::WritingRewrite => "改写一段作文",
    }
}

fn memory_ids(memories: &[PackMemory], needs: &[&SkillReviewNeed]) -> Vec<String> {
    let mut ids: Vec<String> = memories
        .iter()
        .filter(|memory| needs.iter().any(|need| memory.canonical_key.contains(subject(&need.skill_key))))
        .map(|memory| memory.memory_id.clone())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weekly_report::WeekFacts;

    fn need(skill_key: &str, priority: f64, band: UncertaintyBand, evidence: u64) -> SkillReviewNeed {
        let probe =
            if skill_key.starts_with("writing.") { SkillReviewProbe::WritingRewrite } else { SkillReviewProbe::NovelItem };
        SkillReviewNeed {
            skill_key: skill_key.to_owned(),
            priority,
            priority_band: "high".to_owned(),
            due_at: "2026-10-12T00:00:00Z".to_owned(),
            preferred_probe: probe,
            avoid_asset_ids: Vec::new(),
            reason_codes: vec!["overdue".to_owned()],
            uncertainty_band: band,
            mastery_mean: 0.4,
            evidence_count: evidence,
            distinct_asset_count: 2,
            supporting_observation_ids: Vec::new(),
        }
    }

    fn run(needs: &[SkillReviewNeed]) -> Option<ReportBlock> {
        let facts = WeekFacts::default();
        build(&SkillContext { current: &facts, previous: &facts, review_needs: needs, memories: &[] })
    }

    fn keys(block: &ReportBlock) -> Vec<&str> {
        block.data["items"].as_array().unwrap().iter().map(|item| item["skillKey"].as_str().unwrap()).collect()
    }

    #[test]
    fn hidden_without_an_eligible_need() {
        assert!(run(&[]).is_none());
        assert!(run(&[need("reading.matching_headings", 0.9, UncertaintyBand::High, 1)]).is_none());
    }

    #[test]
    fn single_evidence_needs_are_not_plan_items() {
        let block = run(&[
            need("reading.matching_headings", 0.9, UncertaintyBand::High, 1),
            need("reading.tfng", 0.5, UncertaintyBand::Low, 2),
        ])
        .unwrap();
        assert_eq!(keys(&block), vec!["reading.tfng"]);
    }

    #[test]
    fn orders_by_priority_then_uncertainty_then_key_and_keeps_three() {
        let block = run(&[
            need("reading.b", 0.5, UncertaintyBand::Low, 3),
            need("reading.a", 0.5, UncertaintyBand::Low, 3),
            need("reading.c", 0.5, UncertaintyBand::High, 3),
            need("reading.d", 0.9, UncertaintyBand::Low, 3),
            need("reading.e", 0.1, UncertaintyBand::High, 3),
        ])
        .unwrap();
        assert_eq!(keys(&block), vec!["reading.d", "reading.c", "reading.a"]);
        assert_eq!(block.examples.len(), 3);
    }

    #[test]
    fn minutes_are_capped_at_forty_five() {
        let needs: Vec<_> = ["reading.a", "reading.b", "reading.c", "reading.d"]
            .iter()
            .map(|key| need(key, 0.5, UncertaintyBand::Low, 2))
            .collect();
        let block = run(&needs).unwrap();
        assert_eq!(block.data["totalMinutes"], 45);
        assert!(block.data["items"].as_array().unwrap().iter().all(|item| item["minutes"] == 15));
        assert_eq!(budget_minutes(4), vec![15, 15, 15]);
    }

    #[test]
    fn reading_and_writing_items_have_their_labels_and_links() {
        let block = run(&[
            need("reading.matching_headings.paragraph", 0.9, UncertaintyBand::Low, 2),
            need("writing.coherence", 0.8, UncertaintyBand::Low, 2),
        ])
        .unwrap();
        let items = block.data["items"].as_array().unwrap();
        assert_eq!(items[0]["label"], "段落大意配对");
        assert_eq!(items[0]["probe"], "novel_item");
        assert_eq!(items[0]["probeLabel"], "换一篇新文章练同类题");
        assert_eq!(items[0]["reasons"], json!(["overdue"]));
        assert_eq!(items[1]["label"], "写作 · 连贯与衔接");
        assert_eq!(items[1]["probe"], "writing_rewrite");
        assert_eq!(items[1]["probeLabel"], "改写一段作文");
        assert_eq!(block.data["totalMinutes"], 30);
        assert_eq!(block.examples[0].link, PracticeLink::library());
        assert_eq!(block.examples[0].label, "段落大意配对");
        assert_eq!(block.examples[1].link, PracticeLink::writing());
        assert_eq!(block.kind, BlockKind::NextWeekPlan);
    }
}
