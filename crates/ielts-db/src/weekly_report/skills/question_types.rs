//! Wrong / answered per question type, with the passages the misses came from.

use std::collections::{BTreeMap, BTreeSet};

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::MissFact;
use crate::weekly_report::{question_type_label, SkillContext, WeekFacts};

const MAX_EXAMPLES: usize = 3;

struct TypeRow {
    qtype: String,
    wrong: u32,
    answered: u32,
    rate: f64,
    passages: u32,
    /// The distinct passages the misses came from, for fact provenance.
    asset_ids: Vec<String>,
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// Per type: (misses, distinct assets missed).
fn misses_by_type(misses: &[MissFact]) -> BTreeMap<&str, (u32, BTreeSet<&str>)> {
    let mut by_type: BTreeMap<&str, (u32, BTreeSet<&str>)> = BTreeMap::new();
    for miss in misses {
        let entry = by_type.entry(miss.qtype.as_str()).or_default();
        entry.0 += 1;
        entry.1.insert(miss.asset_id.as_str());
    }
    by_type
}

/// Types with at least one miss, worst first: wrong desc, rate asc, qtype.
fn type_rows(facts: &WeekFacts) -> Vec<TypeRow> {
    let missed = misses_by_type(&facts.misses);
    let mut totals = facts.type_totals.clone();
    // Totals and misses come from the same outcomes; a miss whose type has no
    // total still counts as answered wrong.
    for qtype in missed.keys() {
        totals.entry((*qtype).to_owned()).or_insert((0, 0));
    }
    let mut rows: Vec<TypeRow> = totals
        .into_iter()
        .filter_map(|(qtype, (correct, wrong))| {
            let (miss_count, assets) = missed.get(qtype.as_str()).cloned().unwrap_or((0, BTreeSet::new()));
            let wrong = wrong.max(miss_count);
            if wrong == 0 {
                return None;
            }
            let answered = correct + wrong;
            let rate = round2(f64::from(correct) / f64::from(answered));
            Some(TypeRow {
                qtype,
                wrong,
                answered,
                rate,
                passages: assets.len() as u32,
                asset_ids: assets.into_iter().map(str::to_owned).collect(),
            })
        })
        .collect();
    rows.sort_by(|left, right| {
        right.wrong.cmp(&left.wrong).then(left.rate.total_cmp(&right.rate)).then(left.qtype.cmp(&right.qtype))
    });
    rows
}

fn row_json(row: &TypeRow) -> Value {
    json!({
        "qtype": row.qtype,
        "label": question_type_label(&row.qtype),
        "wrong": row.wrong,
        "answered": row.answered,
        "rate": row.rate,
        "passages": row.passages,
        "assetIds": row.asset_ids,
    })
}

fn examples(facts: &WeekFacts, qtype: &str) -> Vec<BlockExample> {
    facts
        .misses
        .iter()
        .filter(|miss| miss.qtype == qtype)
        .take(MAX_EXAMPLES)
        .map(|miss| BlockExample {
            label: format!("「{}」{}", miss.title, miss.label),
            detail: Some(question_type_label(qtype)),
            link: PracticeLink::reading_review(&miss.asset_id, &miss.attempt_id),
        })
        .collect()
}

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let facts = context.current;
    let rows = type_rows(facts);
    let top = rows.first()?.qtype.as_str();
    let data = json!({ "types": rows.iter().map(row_json).collect::<Vec<_>>() });
    let mut block = ReportBlock::new(BlockKind::QuestionTypes, data).with_examples(examples(facts, top));
    block.memory_ids = context
        .memories
        .iter()
        .filter(|memory| memory.canonical_key.contains(top))
        .map(|memory| memory.memory_id.clone())
        .collect();
    Some(block)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weekly_pack::PackMemory;
    use chrono::NaiveDate;

    fn miss(asset: &str, attempt: &str, label: &str, qtype: &str) -> MissFact {
        MissFact {
            obs_id: format!("obs-{attempt}-{label}"),
            attempt_id: attempt.into(),
            asset_id: asset.into(),
            title: format!("T{asset}"),
            question_id: label.into(),
            label: label.into(),
            qtype: qtype.into(),
            day: NaiveDate::from_ymd_opt(2026, 10, 5).unwrap(),
        }
    }

    fn memory(id: &str, key: &str) -> PackMemory {
        PackMemory {
            memory_id: id.into(),
            namespace: "reading".into(),
            scope: "user".into(),
            canonical_key: key.into(),
            statement: String::new(),
            version: 1,
            last_observed: String::new(),
        }
    }

    fn run(facts: &WeekFacts, memories: &[PackMemory]) -> Option<ReportBlock> {
        let previous = WeekFacts::default();
        build(&SkillContext { current: facts, previous: &previous, review_needs: &[], memories })
    }

    fn totals(entries: &[(&str, u32, u32)]) -> BTreeMap<String, (u32, u32)> {
        entries.iter().map(|(qtype, correct, wrong)| ((*qtype).to_owned(), (*correct, *wrong))).collect()
    }

    #[test]
    fn hidden_without_misses() {
        let facts = WeekFacts { type_totals: totals(&[("tfng", 5, 0)]), ..WeekFacts::default() };
        assert!(run(&facts, &[]).is_none());
        assert!(run(&WeekFacts::default(), &[]).is_none());
    }

    #[test]
    fn sorts_by_wrong_then_rate_then_qtype_with_rates_and_passages() {
        let facts = WeekFacts {
            type_totals: totals(&[
                ("tfng", 1, 2),
                ("matching_headings", 6, 2),
                ("summary_completion", 1, 2),
                ("short_answer", 4, 1),
                ("single_choice", 3, 0),
            ]),
            misses: vec![
                miss("p1", "a1", "q1", "tfng"),
                miss("p2", "a2", "q3", "tfng"),
                miss("p1", "a1", "q7", "matching_headings"),
                miss("p1", "a3", "q7", "matching_headings"),
                miss("p2", "a2", "q9", "summary_completion"),
                miss("p3", "a4", "q2", "summary_completion"),
                miss("p3", "a4", "q4", "short_answer"),
            ],
            ..WeekFacts::default()
        };
        let block = run(&facts, &[]).unwrap();
        assert_eq!(block.kind, BlockKind::QuestionTypes);
        assert_eq!(block.id, "question_types");
        assert_eq!(
            block.data,
            json!({"types": [
                {"qtype": "summary_completion", "label": "摘要填空", "wrong": 2, "answered": 3, "rate": 0.33, "passages": 2, "assetIds": ["p2", "p3"]},
                {"qtype": "tfng", "label": "判断题", "wrong": 2, "answered": 3, "rate": 0.33, "passages": 2, "assetIds": ["p1", "p2"]},
                {"qtype": "matching_headings", "label": "段落大意配对", "wrong": 2, "answered": 8, "rate": 0.75, "passages": 1, "assetIds": ["p1"]},
                {"qtype": "short_answer", "label": "简答题", "wrong": 1, "answered": 5, "rate": 0.8, "passages": 1, "assetIds": ["p3"]},
            ]})
        );
    }

    #[test]
    fn examples_are_top_type_misses_with_review_links() {
        let facts = WeekFacts {
            type_totals: totals(&[("tfng", 0, 4), ("yng", 0, 1)]),
            misses: vec![
                miss("p1", "a1", "q1", "tfng"),
                miss("p9", "a9", "q1", "yng"),
                miss("p1", "a1", "q2", "tfng"),
                miss("p2", "a2", "q5", "tfng"),
                miss("p2", "a2", "q6", "tfng"),
            ],
            ..WeekFacts::default()
        };
        let block = run(&facts, &[]).unwrap();
        let labels: Vec<_> = block.examples.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(labels, ["「Tp1」q1", "「Tp1」q2", "「Tp2」q5"]);
        assert!(block.examples.iter().all(|e| e.detail.as_deref() == Some("判断题")));
        assert_eq!(block.examples[2].link, PracticeLink::reading_review("p2", "a2"));
    }

    #[test]
    fn memory_ids_follow_the_top_type() {
        let facts = WeekFacts {
            type_totals: totals(&[("matching_headings", 1, 3), ("tfng", 0, 1)]),
            misses: vec![miss("p1", "a1", "q1", "matching_headings"), miss("p1", "a1", "q2", "tfng")],
            ..WeekFacts::default()
        };
        let memories = [
            memory("m1", "reading.matching_headings.paragraph_scan"),
            memory("m2", "reading.tfng.not_given"),
            memory("m3", "reading.matching_headings"),
        ];
        let block = run(&facts, &memories).unwrap();
        assert_eq!(block.memory_ids, ["m1", "m3"]);
    }

    #[test]
    fn a_miss_without_totals_still_counts() {
        let facts = WeekFacts { misses: vec![miss("p1", "a1", "q1", "unknown")], ..WeekFacts::default() };
        let block = run(&facts, &[]).unwrap();
        assert_eq!(
            block.data["types"][0],
            json!({"qtype": "unknown", "label": "其他题型", "wrong": 1, "answered": 1, "rate": 0.0, "passages": 1, "assetIds": ["p1"]})
        );
    }
}
