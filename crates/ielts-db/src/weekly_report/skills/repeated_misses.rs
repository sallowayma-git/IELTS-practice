//! Misses that came back: a question type missed in two or more passages, or
//! the same question (asset + question id) missed in two or more attempts.

use std::collections::{BTreeMap, BTreeSet};

use chrono::NaiveDate;
use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::{question_type_label, MissFact};
use crate::weekly_report::SkillContext;

const MAX_EXAMPLES: usize = 3;
const MAX_TYPE_EXAMPLES: usize = 2;

/// A question type missed in at least two distinct passages.
struct AcrossPassages<'a> {
    qtype: &'a str,
    passages: u32,
    wrong: u32,
    /// The distinct passages these misses came from, sorted: fact provenance.
    asset_ids: Vec<String>,
    /// The earliest miss of this type, for the example.
    first: &'a MissFact,
}

/// One question missed in at least two distinct attempts.
struct SameQuestion<'a> {
    asset_id: &'a str,
    attempts: u32,
    /// The latest miss of this question, for the title, label and link.
    last: &'a MissFact,
}

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let mut misses: Vec<&MissFact> = context.current.misses.iter().collect();
    misses.sort_by(|a, b| miss_order(a).cmp(&miss_order(b)));
    let across = across_passages(&misses);
    let same = same_question(&misses);
    if across.is_empty() && same.is_empty() {
        return None;
    }
    let mut block =
        ReportBlock::new(BlockKind::RepeatedMisses, data(&across, &same)).with_examples(examples(&across, &same));
    block.memory_ids = memory_ids(context, &across);
    Some(block)
}

/// Chronological, then by ids: independent of the order facts came in.
fn miss_order(miss: &MissFact) -> (NaiveDate, &str, &str, &str) {
    (miss.day, &miss.attempt_id, &miss.asset_id, &miss.question_id)
}

fn across_passages<'a>(misses: &[&'a MissFact]) -> Vec<AcrossPassages<'a>> {
    let mut by_type: BTreeMap<&str, (u32, BTreeSet<&str>, &MissFact)> = BTreeMap::new();
    for miss in misses {
        let entry = by_type.entry(&miss.qtype).or_insert((0, BTreeSet::new(), miss));
        entry.0 += 1;
        entry.1.insert(&miss.asset_id);
    }
    let mut across: Vec<AcrossPassages<'a>> = by_type
        .into_iter()
        .filter(|(_, (_, assets, _))| assets.len() >= 2)
        .map(|(qtype, (wrong, assets, first))| AcrossPassages {
            qtype,
            passages: assets.len() as u32,
            wrong,
            asset_ids: assets.iter().map(|asset| (*asset).to_owned()).collect(),
            first,
        })
        .collect();
    across.sort_by(|a, b| b.passages.cmp(&a.passages).then(b.wrong.cmp(&a.wrong)).then(a.qtype.cmp(b.qtype)));
    across
}

fn same_question<'a>(misses: &[&'a MissFact]) -> Vec<SameQuestion<'a>> {
    let mut by_question: BTreeMap<(&str, &str), (BTreeSet<&str>, &MissFact)> = BTreeMap::new();
    for miss in misses {
        let entry = by_question.entry((&miss.asset_id, &miss.question_id)).or_insert((BTreeSet::new(), miss));
        entry.0.insert(&miss.attempt_id);
        entry.1 = miss;
    }
    let mut same: Vec<SameQuestion<'a>> = by_question
        .into_iter()
        .filter(|(_, (attempts, _))| attempts.len() >= 2)
        .map(|((asset_id, _), (attempts, last))| SameQuestion { asset_id, attempts: attempts.len() as u32, last })
        .collect();
    same.sort_by(|a, b| {
        b.attempts
            .cmp(&a.attempts)
            .then(a.asset_id.cmp(b.asset_id))
            .then(a.last.label.cmp(&b.last.label))
            .then(a.last.question_id.cmp(&b.last.question_id))
    });
    same
}

fn data(across: &[AcrossPassages<'_>], same: &[SameQuestion<'_>]) -> Value {
    let across: Vec<Value> = across
        .iter()
        .map(|entry| {
            json!({
                "qtype": entry.qtype,
                "label": question_type_label(entry.qtype),
                "passages": entry.passages,
                "wrong": entry.wrong,
                "assetIds": entry.asset_ids,
            })
        })
        .collect();
    let same: Vec<Value> = same
        .iter()
        .map(|entry| {
            json!({
                "assetId": entry.asset_id,
                "title": entry.last.title,
                "question": entry.last.label,
                "attempts": entry.attempts,
            })
        })
        .collect();
    json!({"acrossPassages": across, "sameQuestion": same})
}

fn examples(across: &[AcrossPassages<'_>], same: &[SameQuestion<'_>]) -> Vec<BlockExample> {
    let by_type = across.iter().take(MAX_TYPE_EXAMPLES).map(|entry| BlockExample {
        label: miss_label(entry.first),
        detail: Some(question_type_label(entry.qtype)),
        link: review_link(entry.first),
    });
    let by_question = same.iter().map(|entry| BlockExample {
        label: miss_label(entry.last),
        detail: Some(format!("错了 {} 次", entry.attempts)),
        link: review_link(entry.last),
    });
    by_type.chain(by_question).take(MAX_EXAMPLES).collect()
}

fn miss_label(miss: &MissFact) -> String {
    format!("「{}」{}", miss.title, miss.label)
}

fn review_link(miss: &MissFact) -> PracticeLink {
    PracticeLink::reading_review(&miss.asset_id, &miss.attempt_id)
}

fn memory_ids(context: &SkillContext<'_>, across: &[AcrossPassages<'_>]) -> Vec<String> {
    context
        .memories
        .iter()
        .filter(|memory| across.iter().any(|entry| memory.canonical_key.contains(entry.qtype)))
        .map(|memory| memory.memory_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weekly_pack::PackMemory;
    use crate::weekly_report::WeekFacts;

    fn miss(attempt: &str, asset: &str, qid: &str, qtype: &str, day: u32) -> MissFact {
        MissFact {
            obs_id: format!("obs-{attempt}-{qid}"),
            attempt_id: attempt.to_owned(),
            asset_id: asset.to_owned(),
            title: format!("T-{asset}"),
            question_id: qid.to_owned(),
            label: qid.to_owned(),
            qtype: qtype.to_owned(),
            day: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
        }
    }

    fn memory(id: &str, key: &str) -> PackMemory {
        PackMemory {
            memory_id: id.to_owned(),
            namespace: "reading".to_owned(),
            scope: "global".to_owned(),
            canonical_key: key.to_owned(),
            statement: String::new(),
            version: 1,
            last_observed: String::new(),
        }
    }

    fn run(misses: Vec<MissFact>, memories: &[PackMemory]) -> Option<ReportBlock> {
        let current = WeekFacts { misses, ..WeekFacts::default() };
        let previous = WeekFacts::default();
        build(&SkillContext { current: &current, previous: &previous, review_needs: &[], memories })
    }

    fn column<'a>(block: &'a ReportBlock, list: &str, key: &str) -> Vec<&'a Value> {
        block.data[list].as_array().unwrap().iter().map(|entry| &entry[key]).collect()
    }

    #[test]
    fn misses_in_one_passage_only_are_hidden() {
        let misses = vec![miss("a1", "p1", "q1", "tfng", 5), miss("a1", "p1", "q2", "tfng", 5)];
        assert!(run(misses, &[]).is_none());
        assert!(run(Vec::new(), &[]).is_none());
    }

    #[test]
    fn a_type_missed_in_two_passages_is_shown() {
        let misses = vec![
            miss("a2", "p2", "q3", "tfng", 6),
            miss("a1", "p1", "q1", "tfng", 5),
            miss("a1", "p1", "q2", "tfng", 5),
            miss("a1", "p1", "q4", "matching_headings", 5),
        ];
        let block = run(misses, &[]).unwrap();
        assert_eq!(block.id, "repeated_misses");
        assert_eq!(block.kind, BlockKind::RepeatedMisses);
        assert_eq!(
            block.data,
            json!({
                "acrossPassages": [{"qtype": "tfng", "label": "判断题", "passages": 2, "wrong": 3, "assetIds": ["p1", "p2"]}],
                "sameQuestion": [],
            })
        );
        assert_eq!(block.examples.len(), 1);
        assert_eq!(block.examples[0].label, "「T-p1」q1");
        assert_eq!(block.examples[0].detail.as_deref(), Some("判断题"));
        assert_eq!(block.examples[0].link, PracticeLink::reading_review("p1", "a1"));
    }

    #[test]
    fn the_same_question_missed_twice_is_shown() {
        let misses = vec![miss("a1", "p1", "q5", "tfng", 5), miss("a2", "p1", "q5", "tfng", 7)];
        let block = run(misses, &[]).unwrap();
        assert_eq!(
            block.data,
            json!({
                "acrossPassages": [],
                "sameQuestion": [{"assetId": "p1", "title": "T-p1", "question": "q5", "attempts": 2}],
            })
        );
        assert_eq!(block.examples.len(), 1);
        assert_eq!(block.examples[0].label, "「T-p1」q5");
        assert_eq!(block.examples[0].detail.as_deref(), Some("错了 2 次"));
        assert_eq!(block.examples[0].link, PracticeLink::reading_review("p1", "a2"));
    }

    #[test]
    fn duplicate_rows_of_one_attempt_count_once() {
        let misses = vec![miss("a1", "p1", "q5", "tfng", 5), miss("a1", "p1", "q5", "tfng", 5)];
        assert!(run(misses, &[]).is_none());
    }

    #[test]
    fn entries_are_ordered_with_tie_breaks() {
        let misses = vec![
            // matching: 3 passages, 3 wrong
            miss("a1", "p1", "q6", "matching", 5),
            miss("a2", "p2", "q6", "matching", 5),
            miss("a3", "p3", "q6", "matching", 6),
            // tfng: 2 passages, 5 wrong (with the redo misses below)
            miss("a1", "p1", "q1", "tfng", 5),
            miss("a2", "p2", "q1", "tfng", 5),
            // yng: 2 passages, 4 wrong (with the redo miss below)
            miss("a1", "p1", "q2", "yng", 5),
            miss("a2", "p2", "q2", "yng", 5),
            miss("a2", "p2", "q3", "yng", 5),
            // short_answer and classification: 2 passages, 2 wrong each
            miss("a1", "p1", "q7", "short_answer", 5),
            miss("a3", "p3", "q7", "short_answer", 6),
            miss("a1", "p1", "q4", "classification", 5),
            miss("a3", "p3", "q4", "classification", 6),
            // redos: p2 q1 three attempts, p1 q1 and p1 q2 two each
            miss("a4", "p1", "q1", "tfng", 7),
            miss("a4", "p1", "q2", "yng", 7),
            miss("a5", "p2", "q1", "tfng", 7),
            miss("a6", "p2", "q1", "tfng", 8),
        ];
        let block = run(misses, &[]).unwrap();
        assert_eq!(
            column(&block, "acrossPassages", "qtype"),
            [&json!("matching"), &json!("tfng"), &json!("yng"), &json!("classification"), &json!("short_answer")]
        );
        assert_eq!(column(&block, "acrossPassages", "wrong"), [&json!(3), &json!(5), &json!(4), &json!(2), &json!(2)]);
        assert_eq!(column(&block, "sameQuestion", "assetId"), [&json!("p2"), &json!("p1"), &json!("p1")]);
        assert_eq!(column(&block, "sameQuestion", "question"), [&json!("q1"), &json!("q1"), &json!("q2")]);
        assert_eq!(column(&block, "sameQuestion", "attempts"), [&json!(3), &json!(2), &json!(2)]);
        // Two type examples (the first miss of each), then the top repeated question at its latest attempt.
        let labels: Vec<&str> = block.examples.iter().map(|example| example.label.as_str()).collect();
        assert_eq!(labels, ["「T-p1」q6", "「T-p1」q1", "「T-p2」q1"]);
        assert_eq!(block.examples[1].detail.as_deref(), Some("判断题"));
        assert_eq!(block.examples[2].link, PracticeLink::reading_review("p2", "a6"));
        assert_eq!(block.examples[2].detail.as_deref(), Some("错了 3 次"));
    }

    #[test]
    fn input_order_does_not_change_the_block() {
        let misses =
            vec![miss("a1", "p1", "q1", "tfng", 5), miss("a2", "p2", "q1", "tfng", 6), miss("a3", "p1", "q1", "tfng", 7)];
        let mut reversed = misses.clone();
        reversed.reverse();
        assert_eq!(run(misses, &[]), run(reversed, &[]));
    }

    #[test]
    fn memories_match_types_missed_across_passages() {
        let memories = [
            memory("m1", "reading.tfng.not_given"),
            memory("m2", "reading.matching_headings"),
            memory("m3", "writing.coherence"),
        ];
        let misses = vec![
            miss("a1", "p1", "q1", "tfng", 5),
            miss("a2", "p2", "q1", "tfng", 6),
            miss("a2", "p2", "q2", "matching_headings", 6),
        ];
        assert_eq!(run(misses, &memories).unwrap().memory_ids, ["m1"]);
        // A block with only a repeated question names no memory.
        let misses =
            vec![miss("a1", "p1", "q5", "matching_headings", 5), miss("a2", "p1", "q5", "matching_headings", 6)];
        assert!(run(misses, &memories).unwrap().memory_ids.is_empty());
    }
}
