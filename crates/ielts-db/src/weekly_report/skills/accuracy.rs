//! Reading accuracy: correct over answered, blanks kept apart, per day and
//! against the previous window.

use std::cmp::Ordering;

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::ReadingAttemptFact;
use crate::weekly_report::{SkillContext, WeekFacts};

const MAX_EXAMPLES: usize = 3;

#[derive(Default)]
struct Totals {
    correct: u32,
    answered: u32,
    blank: u32,
    total: u32,
}

impl Totals {
    fn of<'a>(attempts: impl Iterator<Item = &'a ReadingAttemptFact>) -> Self {
        attempts.fold(Self::default(), |mut sum, attempt| {
            sum.correct += attempt.correct;
            sum.answered += attempt.answered();
            sum.blank += attempt.blank();
            sum.total += attempt.total;
            sum
        })
    }

    /// `null` when nothing was answered: a rate of no answers is not 0.
    fn rate(&self) -> Value {
        if self.answered == 0 {
            return Value::Null;
        }
        json!(rate(self.correct, self.answered))
    }
}

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let facts = context.current;
    let totals = Totals::of(facts.reading.iter());
    if totals.answered == 0 {
        return None;
    }
    let data = json!({
        "correct": totals.correct,
        "answered": totals.answered,
        "blank": totals.blank,
        "total": totals.total,
        "rate": rate(totals.correct, totals.answered),
        "perDay": per_day(facts),
        "previous": previous(context.previous),
    });
    Some(ReportBlock::new(BlockKind::Accuracy, data).with_examples(examples(facts)))
}

fn per_day(facts: &WeekFacts) -> Vec<Value> {
    facts
        .days
        .iter()
        .map(|day| {
            let totals = Totals::of(facts.reading.iter().filter(|attempt| attempt.day == *day));
            json!({
                "day": day.format("%Y-%m-%d").to_string(),
                "correct": totals.correct,
                "answered": totals.answered,
                "rate": totals.rate(),
            })
        })
        .collect()
}

fn previous(facts: &WeekFacts) -> Value {
    let totals = Totals::of(facts.reading.iter());
    if totals.answered == 0 {
        return Value::Null;
    }
    json!({ "correct": totals.correct, "answered": totals.answered, "rate": totals.rate() })
}

/// The lowest-rate attempts first; ties by attempt id.
fn examples(facts: &WeekFacts) -> Vec<BlockExample> {
    let mut attempts: Vec<&ReadingAttemptFact> =
        facts.reading.iter().filter(|attempt| attempt.answered() > 0).collect();
    attempts.sort_by(|a, b| lower_rate_first(a, b).then_with(|| a.attempt_id.cmp(&b.attempt_id)));
    attempts
        .into_iter()
        .take(MAX_EXAMPLES)
        .map(|attempt| BlockExample {
            label: format!("「{}」", attempt.title),
            detail: Some(format!("正确 {}/{}", attempt.correct, attempt.answered())),
            link: PracticeLink::reading_review(&attempt.asset_id, &attempt.attempt_id),
        })
        .collect()
}

/// Exact comparison of correct/answered, without floats.
fn lower_rate_first(a: &ReadingAttemptFact, b: &ReadingAttemptFact) -> Ordering {
    let left = u64::from(a.correct) * u64::from(b.answered());
    let right = u64::from(b.correct) * u64::from(a.answered());
    left.cmp(&right)
}

fn rate(correct: u32, answered: u32) -> f64 {
    (f64::from(correct) / f64::from(answered) * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use serde_json::json;

    use super::*;

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn attempt(id: &str, d: u32, total: u32, correct: u32, wrong: u32) -> ReadingAttemptFact {
        ReadingAttemptFact {
            obs_id: format!("obs-{id}"),
            attempt_id: id.to_owned(),
            asset_id: format!("asset-{id}"),
            title: format!("P {id}"),
            day: day(d),
            total,
            correct,
            wrong,
            duration_ms: 600_000,
            ordinal: 1,
        }
    }

    fn week(reading: Vec<ReadingAttemptFact>) -> WeekFacts {
        WeekFacts { days: (5..=11).map(day).collect(), reading, ..WeekFacts::default() }
    }

    fn run(current: &WeekFacts, previous: &WeekFacts) -> Option<ReportBlock> {
        build(&SkillContext { current, previous, review_needs: &[], memories: &[] })
    }

    #[test]
    fn hidden_when_nothing_answered() {
        let empty = week(Vec::new());
        assert!(run(&empty, &empty).is_none());
        let all_blank = week(vec![attempt("a", 6, 13, 0, 0)]);
        assert!(run(&all_blank, &empty).is_none());
    }

    #[test]
    fn blanks_are_not_in_the_rate() {
        let current = week(vec![attempt("a", 6, 13, 6, 2)]);
        let block = run(&current, &week(Vec::new())).unwrap();
        assert_eq!(block.kind, BlockKind::Accuracy);
        assert_eq!(block.id, "accuracy");
        let data = &block.data;
        assert_eq!(data["correct"], 6);
        assert_eq!(data["answered"], 8);
        assert_eq!(data["blank"], 5);
        assert_eq!(data["total"], 13);
        assert_eq!(data["rate"], json!(0.75));
    }

    #[test]
    fn per_day_covers_every_day_with_null_rate_when_idle() {
        let current = week(vec![attempt("a", 6, 10, 3, 1), attempt("b", 6, 10, 5, 1), attempt("c", 9, 10, 1, 1)]);
        let block = run(&current, &week(Vec::new())).unwrap();
        let per_day = block.data["perDay"].as_array().unwrap();
        assert_eq!(per_day.len(), 7);
        assert_eq!(per_day[0], json!({"day": "2026-10-05", "correct": 0, "answered": 0, "rate": null}));
        assert_eq!(per_day[1], json!({"day": "2026-10-06", "correct": 8, "answered": 10, "rate": 0.8}));
        assert_eq!(per_day[4], json!({"day": "2026-10-09", "correct": 1, "answered": 2, "rate": 0.5}));
        assert_eq!(per_day[6]["rate"], Value::Null);
    }

    #[test]
    fn previous_is_null_without_answers_and_present_otherwise() {
        let current = week(vec![attempt("a", 6, 10, 3, 1)]);
        let block = run(&current, &week(vec![attempt("old", 1, 10, 0, 0)])).unwrap();
        assert_eq!(block.data["previous"], Value::Null);

        let block = run(&current, &week(vec![attempt("old", 1, 10, 2, 1)])).unwrap();
        assert_eq!(block.data["previous"], json!({"correct": 2, "answered": 3, "rate": 0.67}));
    }

    #[test]
    fn examples_are_lowest_rate_first_with_review_links() {
        let current = week(vec![
            attempt("a", 6, 10, 9, 1),
            attempt("b", 6, 10, 2, 2),
            attempt("c", 7, 10, 1, 3),
            attempt("d", 8, 10, 4, 4),
            attempt("e", 8, 10, 0, 0),
        ]);
        let block = run(&current, &week(Vec::new())).unwrap();
        let labels: Vec<&str> = block.examples.iter().map(|e| e.label.as_str()).collect();
        // b and d tie at 0.5: attempt id breaks the tie. The all-blank e has no rate.
        assert_eq!(labels, ["「P c」", "「P b」", "「P d」"]);
        assert_eq!(block.examples[0].detail.as_deref(), Some("正确 1/4"));
        assert_eq!(block.examples[0].link, PracticeLink::reading_review("asset-c", "c"));
    }

    #[test]
    fn rates_round_to_two_decimals() {
        let current = week(vec![attempt("a", 6, 3, 2, 1)]);
        let block = run(&current, &week(Vec::new())).unwrap();
        assert_eq!(block.data["rate"], json!(0.67));
        assert_eq!(rate(1, 3), 0.33);
        assert_eq!(rate(5, 8), 0.63);
    }

    #[test]
    fn deterministic() {
        let reading = vec![attempt("b", 6, 10, 2, 2), attempt("a", 7, 10, 2, 2), attempt("c", 8, 10, 7, 1)];
        let mut reversed = reading.clone();
        reversed.reverse();
        let previous = week(vec![attempt("old", 1, 10, 5, 5)]);
        let first = run(&week(reading), &previous).unwrap();
        let second = run(&week(reversed), &previous).unwrap();
        assert_eq!(first, second);
        assert_eq!(serde_json::to_string(&first).unwrap(), serde_json::to_string(&second).unwrap());
    }
}
