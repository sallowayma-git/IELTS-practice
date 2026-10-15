//! How much the learner practised: attempts, essays, active days, minutes, a
//! per-day series for the sparkline, and the same totals for the window before.

use ielts_domain::{BlockKind, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::{SkillContext, WeekFacts};

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let current = context.current;
    if !has_practice(current) {
        return None;
    }
    let mut data = totals(current);
    data["perDay"] = per_day(current);
    data["previous"] = if has_practice(context.previous) { totals(context.previous) } else { Value::Null };
    Some(ReportBlock::new(BlockKind::Volume, data))
}

fn has_practice(facts: &WeekFacts) -> bool {
    !facts.reading.is_empty() || !facts.writing.is_empty()
}

fn totals(facts: &WeekFacts) -> Value {
    json!({
        "readingAttempts": facts.reading.len() as u32,
        "writingEssays": facts.writing.len() as u32,
        "activeDays": facts.active_days() as u32,
        "minutes": minutes(facts),
    })
}

fn minutes(facts: &WeekFacts) -> u32 {
    let total_ms: i64 = facts.reading.iter().map(|r| r.duration_ms.max(0)).sum();
    (total_ms as f64 / 60_000.0).round() as u32
}

fn per_day(facts: &WeekFacts) -> Value {
    facts
        .days
        .iter()
        .map(|day| {
            let reading = facts.reading.iter().filter(|r| r.day == *day).count() as u32;
            let writing = facts.writing.iter().filter(|w| w.day == *day).count() as u32;
            json!({ "day": day.format("%Y-%m-%d").to_string(), "reading": reading, "writing": writing })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;
    use crate::weekly_report::facts::{ReadingAttemptFact, WritingFact};

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn reading(id: &str, d: u32, duration_ms: i64) -> ReadingAttemptFact {
        ReadingAttemptFact {
            obs_id: format!("obs-{id}"),
            attempt_id: id.into(),
            asset_id: "p1".into(),
            title: "Passage".into(),
            day: day(d),
            total: 13,
            correct: 10,
            wrong: 3,
            duration_ms,
            ordinal: 1,
        }
    }

    fn essay(id: &str, d: u32) -> WritingFact {
        WritingFact {
            obs_id: format!("obs-{id}"),
            attempt_id: id.into(),
            session_id: None,
            task_type: "task2".into(),
            band: 6.0,
            criteria: Vec::new(),
            day: day(d),
        }
    }

    fn week(first: u32) -> WeekFacts {
        WeekFacts { days: (first..first + 7).map(day).collect(), ..WeekFacts::default() }
    }

    fn run(current: &WeekFacts, previous: &WeekFacts) -> Option<ReportBlock> {
        build(&SkillContext { current, previous, review_needs: &[], memories: &[] })
    }

    #[test]
    fn hidden_without_reading_or_writing() {
        let empty = week(5);
        assert!(run(&empty, &empty).is_none());
        let mut previous_only = week(1);
        previous_only.reading.push(reading("b1", 1, 60_000));
        assert!(run(&empty, &previous_only).is_none());
    }

    #[test]
    fn shown_with_writing_only() {
        let mut current = week(5);
        current.writing.push(essay("w1", 6));
        let block = run(&current, &WeekFacts::default()).unwrap();
        assert_eq!(block.kind, BlockKind::Volume);
        assert_eq!(block.id, "volume");
        assert_eq!(block.data["writingEssays"], json!(1));
        assert_eq!(block.data["readingAttempts"], json!(0));
        assert_eq!(block.data["activeDays"], json!(1));
        assert_eq!(block.data["minutes"], json!(0));
    }

    #[test]
    fn counts_and_per_day_zeros() {
        let mut current = week(5);
        current.reading = vec![reading("a1", 5, 20 * 60_000), reading("a2", 5, 10 * 60_000), reading("a3", 8, 0)];
        current.writing = vec![essay("w1", 8), essay("w2", 10)];
        let block = run(&current, &WeekFacts::default()).unwrap();
        assert_eq!(block.data["readingAttempts"], json!(3));
        assert_eq!(block.data["writingEssays"], json!(2));
        assert_eq!(block.data["activeDays"], json!(3));
        assert_eq!(block.data["minutes"], json!(30));
        let per_day = block.data["perDay"].as_array().unwrap();
        assert_eq!(per_day.len(), 7);
        assert_eq!(per_day[0], json!({"day": "2026-10-05", "reading": 2, "writing": 0}));
        assert_eq!(per_day[1], json!({"day": "2026-10-06", "reading": 0, "writing": 0}));
        assert_eq!(per_day[3], json!({"day": "2026-10-08", "reading": 1, "writing": 1}));
        assert_eq!(per_day[5], json!({"day": "2026-10-10", "reading": 0, "writing": 1}));
        assert_eq!(per_day[6], json!({"day": "2026-10-11", "reading": 0, "writing": 0}));
    }

    #[test]
    fn minutes_round_to_nearest() {
        let mut current = week(5);
        current.reading = vec![reading("a1", 5, 89_999), reading("a2", 6, 0)];
        assert_eq!(run(&current, &WeekFacts::default()).unwrap().data["minutes"], json!(1));
        current.reading = vec![reading("a1", 5, 60_000), reading("a2", 6, 30_000)];
        assert_eq!(run(&current, &WeekFacts::default()).unwrap().data["minutes"], json!(2));
        current.reading = vec![reading("a1", 5, 29_999)];
        assert_eq!(run(&current, &WeekFacts::default()).unwrap().data["minutes"], json!(0));
    }

    #[test]
    fn previous_is_null_without_earlier_practice() {
        let mut current = week(5);
        current.reading.push(reading("a1", 5, 60_000));
        let block = run(&current, &week(1)).unwrap();
        assert_eq!(block.data["previous"], Value::Null);
    }

    #[test]
    fn previous_totals_when_present() {
        let mut current = week(12);
        current.reading.push(reading("a1", 12, 60_000));
        let mut previous = week(5);
        previous.reading = vec![reading("b1", 5, 25 * 60_000), reading("b2", 7, 5 * 60_000)];
        previous.writing = vec![essay("v1", 7)];
        let block = run(&current, &previous).unwrap();
        assert_eq!(
            block.data["previous"],
            json!({"readingAttempts": 2, "writingEssays": 1, "activeDays": 2, "minutes": 30})
        );
    }

    #[test]
    fn deterministic() {
        let mut current = week(5);
        current.reading = vec![reading("a1", 9, 61_000), reading("a2", 5, 120_000)];
        current.writing = vec![essay("w1", 7)];
        let mut previous = week(1);
        previous.writing = vec![essay("v1", 2)];
        let first = run(&current, &previous).unwrap();
        let second = run(&current, &previous).unwrap();
        assert_eq!(first, second);
        assert_eq!(serde_json::to_string(&first).unwrap(), serde_json::to_string(&second).unwrap());
    }
}
