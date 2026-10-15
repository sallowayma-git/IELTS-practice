//! Redone passages: which earlier misses the redo fixed, which are still
//! wrong, and which questions went wrong only this time.

use std::cmp::Reverse;

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::RedoFact;
use crate::weekly_report::SkillContext;

const MAX_ITEMS: usize = 5;
const MAX_EXAMPLES: usize = 3;

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let redos = &context.current.redos;
    if redos.is_empty() {
        return None;
    }
    let total = |pick: fn(&RedoFact) -> usize| redos.iter().map(pick).sum::<usize>() as u32;
    let data = json!({
        "redos": redos.len() as u32,
        "fixed": total(|r| r.fixed.len()),
        "stillWrong": total(|r| r.still_wrong.len()),
        "newlyWrong": total(|r| r.newly_wrong.len()),
        "items": newest_first(redos).into_iter().take(MAX_ITEMS).map(item).collect::<Vec<Value>>(),
    });
    Some(ReportBlock::new(BlockKind::RedoProgress, data).with_examples(examples(redos)))
}

/// Newest day first; ties by attempt id so the order never depends on input order.
fn newest_first(redos: &[RedoFact]) -> Vec<&RedoFact> {
    let mut sorted: Vec<&RedoFact> = redos.iter().collect();
    sorted.sort_by(|a, b| b.day.cmp(&a.day).then_with(|| a.attempt_id.cmp(&b.attempt_id)));
    sorted
}

fn item(redo: &RedoFact) -> Value {
    json!({
        "assetId": redo.asset_id,
        "title": redo.title,
        "day": redo.day.format("%Y-%m-%d").to_string(),
        "fixed": redo.fixed,
        "stillWrong": redo.still_wrong,
        "newlyWrong": redo.newly_wrong,
    })
}

/// Redos that still have wrong answers first (most still wrong first), then newest.
fn examples(redos: &[RedoFact]) -> Vec<BlockExample> {
    let mut sorted = newest_first(redos);
    sorted.sort_by_key(|redo| Reverse(redo.still_wrong.len()));
    sorted.into_iter().take(MAX_EXAMPLES).map(example).collect()
}

fn example(redo: &RedoFact) -> BlockExample {
    BlockExample {
        label: format!("「{}」", redo.title),
        detail: detail(redo),
        link: PracticeLink::reading_review(&redo.asset_id, &redo.attempt_id),
    }
}

fn detail(redo: &RedoFact) -> Option<String> {
    let parts: Vec<String> = [("仍错", &redo.still_wrong), ("新错", &redo.newly_wrong), ("改对", &redo.fixed)]
        .into_iter()
        .filter(|(_, labels)| !labels.is_empty())
        .map(|(name, labels)| format!("{name} {}", labels.join("、")))
        .collect();
    (!parts.is_empty()).then(|| parts.join(" · "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weekly_report::WeekFacts;
    use chrono::NaiveDate;

    fn labels(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn redo(attempt: &str, day: u32, fixed: &[&str], still: &[&str], newly: &[&str]) -> RedoFact {
        RedoFact {
            attempt_id: attempt.to_owned(),
            asset_id: format!("asset-{attempt}"),
            title: format!("T{attempt}"),
            day: NaiveDate::from_ymd_opt(2026, 10, day).unwrap(),
            fixed: labels(fixed),
            still_wrong: labels(still),
            newly_wrong: labels(newly),
            obs_ids: Vec::new(),
        }
    }

    fn run(redos: Vec<RedoFact>) -> Option<ReportBlock> {
        let current = WeekFacts { redos, ..WeekFacts::default() };
        let previous = WeekFacts::default();
        build(&SkillContext { current: &current, previous: &previous, review_needs: &[], memories: &[] })
    }

    #[test]
    fn hidden_without_redos() {
        assert!(run(Vec::new()).is_none());
    }

    #[test]
    fn totals_count_every_label() {
        let block = run(vec![redo("a", 5, &["q1", "q2"], &["q3"], &[]), redo("b", 6, &["q4"], &[], &["q9"])]).unwrap();
        assert_eq!(block.kind, BlockKind::RedoProgress);
        assert_eq!(block.id, "redo_progress");
        assert_eq!(block.data["redos"], 2);
        assert_eq!(block.data["fixed"], 3);
        assert_eq!(block.data["stillWrong"], 1);
        assert_eq!(block.data["newlyWrong"], 1);
        assert!(block.memory_ids.is_empty());
    }

    #[test]
    fn items_are_newest_first_and_capped() {
        let redos = (1..=7).map(|day| redo(&format!("r{day}"), day, &["q1"], &[], &[])).collect();
        let block = run(redos).unwrap();
        let items = block.data["items"].as_array().unwrap();
        assert_eq!(items.len(), MAX_ITEMS);
        let days: Vec<&str> = items.iter().map(|i| i["day"].as_str().unwrap()).collect();
        assert_eq!(days, ["2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04", "2026-10-03"]);
        assert_eq!(items[0]["assetId"], "asset-r7");
        assert_eq!(items[0]["title"], "Tr7");
        assert_eq!(items[0]["fixed"], json!(["q1"]));
        assert_eq!(items[0]["stillWrong"], json!([]));
        assert_eq!(block.data["redos"], 7);
    }

    #[test]
    fn examples_put_still_wrong_first_and_link_the_redo() {
        let block = run(vec![
            redo("new", 9, &["q1"], &[], &[]),
            redo("one", 3, &[], &["q2"], &[]),
            redo("two", 4, &["q5"], &["q3", "q4"], &["q7"]),
            redo("old", 2, &["q6"], &[], &[]),
        ])
        .unwrap();
        let labels: Vec<&str> = block.examples.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(labels, ["「Ttwo」", "「Tone」", "「Tnew」"]);
        assert_eq!(block.examples[0].detail.as_deref(), Some("仍错 q3、q4 · 新错 q7 · 改对 q5"));
        assert_eq!(block.examples[0].link, PracticeLink::reading_review("asset-two", "two"));
    }

    #[test]
    fn deterministic_regardless_of_input_order() {
        let redos = vec![redo("b", 5, &[], &["q1"], &[]), redo("a", 5, &[], &["q2"], &[]), redo("c", 5, &["q3"], &[], &[])];
        let mut reversed = redos.clone();
        reversed.reverse();
        let (left, right) = (run(redos).unwrap(), run(reversed).unwrap());
        assert_eq!(left, right);
        assert_eq!(left.data["items"][0]["assetId"], "asset-a");
        assert_eq!(left.examples[0].label, "「Ta」");
    }
}
