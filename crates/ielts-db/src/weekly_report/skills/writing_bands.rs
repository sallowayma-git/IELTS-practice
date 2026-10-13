use std::borrow::Borrow;
use std::collections::BTreeMap;

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_pack::PackMemory;
use crate::weekly_report::facts::WritingFact;
use crate::weekly_report::{criterion_label, SkillContext};

/// How many of an essay's lowest criteria the block shows and counts.
const LOWEST: usize = 2;
const MAX_EXAMPLES: usize = 3;

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let essays = oldest_first(&context.current.writing);
    if essays.is_empty() {
        return None;
    }
    let weakest = weakest(&essays);
    let data = json!({
        "essays": essays.iter().map(|essay| essay_value(essay)).collect::<Vec<_>>(),
        "average": average(&essays),
        "best": essays.iter().map(|essay| essay.band).fold(f64::MIN, f64::max),
        "weakest": weakest.as_ref().map(|(criterion, times)| json!({
            "criterion": criterion,
            "label": criterion_label(criterion),
            "timesLowest": times,
        })),
        "previous": previous(&context.previous.writing),
    });
    let mut block = ReportBlock::new(BlockKind::WritingBands, data).with_examples(examples(&essays));
    block.memory_ids = memory_ids(context.memories, weakest.as_ref().map(|(criterion, _)| criterion.as_str()));
    Some(block)
}

/// The chart order. A stable sort keeps same-day essays in observation order.
fn oldest_first(writing: &[WritingFact]) -> Vec<&WritingFact> {
    let mut essays: Vec<&WritingFact> = writing.iter().collect();
    essays.sort_by_key(|essay| essay.day);
    essays
}

fn lowest(essay: &WritingFact) -> &[(String, f64)] {
    &essay.criteria[..essay.criteria.len().min(LOWEST)]
}

fn essay_value(essay: &WritingFact) -> Value {
    let lowest: Vec<Value> = lowest(essay)
        .iter()
        .map(|(criterion, score)| json!({"criterion": criterion, "label": criterion_label(criterion), "score": score}))
        .collect();
    json!({
        "day": essay.day.format("%Y-%m-%d").to_string(),
        "taskType": essay.task_type,
        "band": essay.band,
        "lowest": lowest,
    })
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn average<E: Borrow<WritingFact>>(essays: &[E]) -> f64 {
    let sum: f64 = essays.iter().map(|essay| essay.borrow().band).sum();
    round1(sum / essays.len() as f64)
}

/// The criterion most often among an essay's lowest two; ties go to the
/// smaller criterion key.
fn weakest(essays: &[&WritingFact]) -> Option<(String, u32)> {
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for essay in essays {
        for (criterion, _) in lowest(essay) {
            *counts.entry(criterion.as_str()).or_default() += 1;
        }
    }
    // Keys come ascending, so keeping the first of the highest count is the tie-break.
    let mut best: Option<(&str, u32)> = None;
    for (criterion, times) in counts {
        if best.map_or(true, |(_, top)| times > top) {
            best = Some((criterion, times));
        }
    }
    best.map(|(criterion, times)| (criterion.to_owned(), times))
}

fn previous(writing: &[WritingFact]) -> Value {
    if writing.is_empty() {
        return Value::Null;
    }
    json!({"essays": writing.len() as u32, "average": average(writing)})
}

/// Essays with a result page, lowest band first (the most telling), then oldest.
fn examples(essays: &[&WritingFact]) -> Vec<BlockExample> {
    let mut linked: Vec<(&WritingFact, &str)> =
        essays.iter().filter_map(|essay| Some((*essay, essay.session_id.as_deref()?))).collect();
    linked.sort_by(|(left, _), (right, _)| {
        left.band.total_cmp(&right.band).then(left.day.cmp(&right.day)).then(left.obs_id.cmp(&right.obs_id))
    });
    linked
        .into_iter()
        .take(MAX_EXAMPLES)
        .map(|(essay, session)| BlockExample {
            label: format!("{} {}", essay.task_type, essay.band),
            detail: lowest_detail(essay),
            link: PracticeLink::writing_result(session),
        })
        .collect()
}

fn lowest_detail(essay: &WritingFact) -> Option<String> {
    let labels: Vec<String> = lowest(essay).iter().map(|(criterion, _)| criterion_label(criterion)).collect();
    (!labels.is_empty()).then(|| labels.join("、"))
}

fn memory_ids(memories: &[PackMemory], weakest: Option<&str>) -> Vec<String> {
    let weakest = weakest.map(str::to_lowercase);
    memories
        .iter()
        .filter(|memory| {
            let key = memory.canonical_key.to_lowercase();
            key.contains("writing") || weakest.as_deref().is_some_and(|criterion| key.contains(criterion))
        })
        .map(|memory| memory.memory_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;
    use crate::weekly_report::WeekFacts;

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn essay(id: &str, d: u32, band: f64, session: Option<&str>, criteria: &[(&str, f64)]) -> WritingFact {
        WritingFact {
            obs_id: format!("obs-{id}"),
            attempt_id: format!("att-{id}"),
            session_id: session.map(str::to_owned),
            task_type: "task2".to_owned(),
            band,
            criteria: criteria.iter().map(|(c, s)| ((*c).to_owned(), *s)).collect(),
            day: day(d),
        }
    }

    fn memory(id: &str, key: &str) -> PackMemory {
        PackMemory {
            memory_id: id.to_owned(),
            namespace: "learner".to_owned(),
            scope: "writing".to_owned(),
            canonical_key: key.to_owned(),
            statement: String::new(),
            version: 1,
            last_observed: String::new(),
        }
    }

    fn run(current: Vec<WritingFact>, previous: Vec<WritingFact>, memories: &[PackMemory]) -> Option<ReportBlock> {
        let current = WeekFacts { writing: current, ..WeekFacts::default() };
        let previous = WeekFacts { writing: previous, ..WeekFacts::default() };
        build(&SkillContext { current: &current, previous: &previous, review_needs: &[], memories })
    }

    fn week() -> Vec<WritingFact> {
        vec![
            essay("c", 9, 6.5, Some("s-c"), &[("grammar", 6.0), ("lexical", 6.0), ("coherence", 7.0)]),
            essay("a", 6, 6.0, None, &[("grammar", 5.5), ("coherence", 6.0), ("lexical", 6.5)]),
            essay("b", 7, 7.0, Some("s-b"), &[("coherence", 6.5), ("lexical", 7.0), ("grammar", 7.5)]),
        ]
    }

    #[test]
    fn hidden_without_essays() {
        assert!(run(Vec::new(), week(), &[]).is_none());
    }

    #[test]
    fn essays_oldest_first_with_two_lowest_criteria() {
        let block = run(week(), Vec::new(), &[]).unwrap();
        assert_eq!(block.kind, BlockKind::WritingBands);
        assert_eq!(block.id, "writing_bands");
        let essays = block.data["essays"].as_array().unwrap();
        let days: Vec<&str> = essays.iter().map(|e| e["day"].as_str().unwrap()).collect();
        assert_eq!(days, ["2026-10-06", "2026-10-07", "2026-10-09"]);
        assert_eq!(
            essays[0],
            json!({"day": "2026-10-06", "taskType": "task2", "band": 6.0, "lowest": [
                {"criterion": "grammar", "label": "语法", "score": 5.5},
                {"criterion": "coherence", "label": "连贯与衔接", "score": 6.0},
            ]})
        );
    }

    #[test]
    fn average_to_one_decimal_and_best() {
        let block = run(week(), Vec::new(), &[]).unwrap();
        assert_eq!(block.data["average"], json!(6.5));
        assert_eq!(block.data["best"], json!(7.0));
        // (6.0 + 6.5 + 6.5) / 3 = 6.333…
        let uneven = vec![essay("a", 6, 6.0, None, &[]), essay("b", 7, 6.5, None, &[]), essay("c", 8, 6.5, None, &[])];
        let block = run(uneven, Vec::new(), &[]).unwrap();
        assert_eq!(block.data["average"], json!(6.3));
        assert_eq!(block.data["weakest"], Value::Null);
    }

    #[test]
    fn weakest_is_most_often_lowest_with_key_tie_break() {
        let block = run(week(), Vec::new(), &[]).unwrap();
        // coherence, grammar and lexical are each lowest twice: the smallest key wins.
        assert_eq!(block.data["weakest"], json!({"criterion": "coherence", "label": "连贯与衔接", "timesLowest": 2}));
        let skewed = vec![
            essay("a", 6, 6.0, None, &[("lexical", 5.5), ("grammar", 6.0)]),
            essay("b", 7, 6.0, None, &[("lexical", 5.5), ("taskResponse", 6.0)]),
        ];
        let block = run(skewed, Vec::new(), &[]).unwrap();
        assert_eq!(block.data["weakest"], json!({"criterion": "lexical", "label": "词汇资源", "timesLowest": 2}));
    }

    #[test]
    fn previous_is_null_or_counts_and_average() {
        let block = run(week(), Vec::new(), &[]).unwrap();
        assert_eq!(block.data["previous"], Value::Null);
        let before = vec![essay("p", 1, 5.5, None, &[]), essay("q", 2, 6.0, None, &[])];
        let block = run(week(), before, &[]).unwrap();
        assert_eq!(block.data["previous"], json!({"essays": 2, "average": 5.8}));
    }

    #[test]
    fn examples_only_for_essays_with_a_result_page() {
        let block = run(week(), Vec::new(), &[]).unwrap();
        let labels: Vec<&str> = block.examples.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(labels, ["task2 6.5", "task2 7"]);
        assert_eq!(block.examples[0].link, PracticeLink::writing_result("s-c"));
        assert_eq!(block.examples[0].detail.as_deref(), Some("语法、词汇资源"));
        assert_eq!(block.examples[1].link, PracticeLink::writing_result("s-b"));
    }

    #[test]
    fn memories_about_writing_or_the_weakest_criterion() {
        let memories = [
            memory("m1", "reading.tfng.trap"),
            memory("m2", "Writing.Task2.structure"),
            memory("m3", "learner.COHERENCE.linking"),
            memory("m4", "grammar.tense"),
        ];
        let block = run(week(), Vec::new(), &memories).unwrap();
        assert_eq!(block.memory_ids, ["m2", "m3"]);
    }
}
