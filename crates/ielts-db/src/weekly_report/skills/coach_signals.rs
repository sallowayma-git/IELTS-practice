//! Coach signals: what the learner told the coach this week and what became of
//! it. Satisfaction (feedback kinds, re-asks, the way they asked to be taught)
//! and learning (an earlier miss the learner asked about, then redid) are
//! separate fields and never merged: a thumbs-up is not a learning outcome, and
//! the redo comparison is a count, not a causal claim.

use std::collections::{BTreeMap, BTreeSet};

use ielts_domain::{BlockExample, BlockKind, PracticeLink, ReportBlock};
use serde_json::{json, Value};

use crate::weekly_report::facts::{AskedQuestion, CoachFact, NoteVerdict, RedoQuestion, WeekFacts};
use crate::weekly_report::SkillContext;

const MAX_EXAMPLES: usize = 3;
const MAX_STRATEGIES: usize = 3;

pub fn build(context: &SkillContext<'_>) -> Option<ReportBlock> {
    let facts = context.current;
    if facts.coach.is_empty() {
        return None;
    }
    let attempts: BTreeSet<&str> =
        facts.coach.iter().map(|fact| fact.attempt_id.as_str()).filter(|id| !id.is_empty()).collect();
    let mut data = json!({
        "feedback": feedback_rows(&facts.coach),
        "reasks": facts.coach.iter().map(|fact| fact.reasks).sum::<u32>(),
        "asks": facts.coach.iter().map(|fact| fact.asks).sum::<u32>(),
        "attempts": attempts.len() as u32,
    });
    let optional = [
        ("teachingNotes", teaching_notes(&facts.coach)),
        ("strategies", strategies(&facts.coach)),
        ("repeatedAsks", repeated_asks(&facts.coach_questions)),
        ("afterCoach", after_coach(&facts.coach_redos)),
    ];
    for (key, value) in optional.into_iter().filter_map(|(key, value)| value.map(|value| (key, value))) {
        data[key] = value;
    }
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

/// Each kind with its count and the passages it was given on, so a fact built
/// from the row can say where it comes from.
fn feedback_rows(coach: &[CoachFact]) -> Vec<Value> {
    let counts = coach.iter().flat_map(|fact| fact.feedback.iter().map(|(kind, count)| (kind.as_str(), *count)));
    sorted_counts(counts)
        .into_iter()
        .map(|(kind, count)| {
            let assets: BTreeSet<&str> = coach
                .iter()
                .filter(|fact| fact.feedback.contains_key(kind) && !fact.asset_id.is_empty())
                .map(|fact| fact.asset_id.as_str())
                .collect();
            json!({"kind": kind, "label": feedback_label(kind), "count": count, "assetIds": assets})
        })
        .collect()
}

/// How the learner asked to be taught: wishes, and strategies that did or did not help.
fn teaching_notes(coach: &[CoachFact]) -> Option<Value> {
    let count = |verdict: NoteVerdict| -> usize {
        coach.iter().flat_map(|fact| &fact.notes).filter(|note| note.verdict == verdict).count()
    };
    let (wished, helped, not_helped) = (count(NoteVerdict::Wished), count(NoteVerdict::Helped), count(NoteVerdict::NotHelped));
    (wished + helped + not_helped > 0).then(|| json!({"wished": wished, "helped": helped, "notHelped": not_helped}))
}

/// What a strategy's name is, ignoring case, hyphens, underscores and spacing.
fn strategy_key(label: &str) -> String {
    label.to_lowercase().replace(['-', '_'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Per strategy the learner reported on: most reported first, ties by name.
fn strategies(coach: &[CoachFact]) -> Option<Value> {
    // key -> (first-seen display, helped, not helped)
    let mut rows: BTreeMap<String, (&str, u32, u32)> = BTreeMap::new();
    for note in coach.iter().flat_map(|fact| &fact.notes) {
        let Some(label) = note.strategy.as_deref() else { continue };
        let row = rows.entry(strategy_key(label)).or_insert((label, 0, 0));
        match note.verdict {
            NoteVerdict::Helped => row.1 += 1,
            NoteVerdict::NotHelped => row.2 += 1,
            NoteVerdict::Wished => {}
        }
    }
    let mut ranked: Vec<(String, (&str, u32, u32))> = rows.into_iter().collect();
    ranked.sort_by(|left, right| (right.1 .1 + right.1 .2).cmp(&(left.1 .1 + left.1 .2)).then(left.0.cmp(&right.0)));
    let rows: Vec<Value> = ranked
        .into_iter()
        .take(MAX_STRATEGIES)
        .map(|(_, (label, helped, not_helped))| json!({"strategy": label, "helped": helped, "notHelped": not_helped}))
        .collect();
    (!rows.is_empty()).then(|| Value::Array(rows))
}

/// Questions the learner asked about more than once: where one explanation did
/// not settle it. Each ask is one message; one message naming a question twice
/// is still one ask.
fn repeated_asks(asked: &[AskedQuestion]) -> Option<Value> {
    let mut by_question: BTreeMap<(&str, &str), BTreeSet<&str>> = BTreeMap::new();
    for ask in asked.iter().filter(|ask| !ask.asset_id.is_empty()) {
        by_question.entry((ask.asset_id.as_str(), ask.question_id.as_str())).or_default().insert(ask.message_id.as_str());
    }
    let repeated: Vec<(&(&str, &str), &BTreeSet<&str>)> = by_question.iter().filter(|(_, messages)| messages.len() >= 2).collect();
    if repeated.is_empty() {
        return None;
    }
    let assets: BTreeSet<&str> = repeated.iter().map(|((asset, _), _)| *asset).collect();
    Some(json!({
        "questions": repeated.len(),
        "asks": repeated.iter().map(|(_, messages)| messages.len()).sum::<usize>(),
        "assetIds": assets,
    }))
}

/// Earlier misses the learner redid, split by whether they had asked the coach
/// about that question first. Only shown once the coach was asked about at
/// least one of them; otherwise there is nothing to compare.
fn after_coach(redone: &[RedoQuestion]) -> Option<Value> {
    let tally = |explained: bool, fixed: bool| redone.iter().filter(|r| r.explained == explained && r.fixed == fixed).count();
    let assets: BTreeSet<&str> = redone.iter().filter(|r| r.explained).map(|r| r.asset_id.as_str()).collect();
    if assets.is_empty() {
        return None;
    }
    Some(json!({
        "explainedFixed": tally(true, true),
        "explainedStillWrong": tally(true, false),
        "unexplainedFixed": tally(false, true),
        "unexplainedStillWrong": tally(false, false),
        "assetIds": assets,
    }))
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
    let mut examples: Vec<BlockExample> = ranked
        .into_iter()
        .take(MAX_EXAMPLES)
        .map(|(attempt, asset, kinds, _)| BlockExample {
            label: format!("「{}」", passage_title(facts, attempt, asset)),
            detail: Some(kinds_detail(&kinds)),
            link: PracticeLink::reading_review(asset, attempt),
        })
        .collect();
    // Room left: the attempts where the learner kept asking about the same question.
    for (attempt, asset) in repeated_ask_attempts(&facts.coach_questions) {
        if examples.len() == MAX_EXAMPLES {
            break;
        }
        let link = PracticeLink::reading_review(asset, attempt);
        if !examples.iter().any(|example| example.link == link) {
            examples.push(BlockExample {
                label: format!("「{}」", passage_title(facts, attempt, asset)),
                detail: Some("同一题反复追问".to_owned()),
                link,
            });
        }
    }
    examples
}

/// `(attempt, asset)` of every attempt with a question asked twice or more,
/// ordered by how often, then by attempt id.
fn repeated_ask_attempts(asked: &[AskedQuestion]) -> Vec<(&str, &str)> {
    let mut by_question: BTreeMap<(&str, &str, &str), BTreeSet<&str>> = BTreeMap::new();
    for ask in asked.iter().filter(|ask| !ask.attempt_id.is_empty() && !ask.asset_id.is_empty()) {
        by_question
            .entry((ask.attempt_id.as_str(), ask.asset_id.as_str(), ask.question_id.as_str()))
            .or_default()
            .insert(ask.message_id.as_str());
    }
    let mut per_attempt: BTreeMap<(&str, &str), usize> = BTreeMap::new();
    for ((attempt, asset, _), messages) in by_question.iter().filter(|(_, messages)| messages.len() >= 2) {
        *per_attempt.entry((attempt, asset)).or_default() += messages.len();
    }
    let mut ranked: Vec<((&str, &str), usize)> = per_attempt.into_iter().collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    ranked.into_iter().map(|(key, _)| key).collect()
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
    use crate::weekly_report::facts::{NoteFact, ReadingAttemptFact};
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
            ..CoachFact::default()
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
                {"kind": "need_example", "label": "需要例子", "count": 2, "assetIds": ["p1"]},
                {"kind": "thumbs_up", "label": "有帮助", "count": 2, "assetIds": ["p1", "p2"]},
                {"kind": "too_long", "label": "太长", "count": 2, "assetIds": ["p1"]},
                {"kind": "incorrect", "label": "讲错了", "count": 1, "assetIds": ["p2"]},
            ])
        );
        assert!(block.memory_ids.is_empty());
    }

    #[test]
    fn unknown_kind_gets_the_fallback_label() {
        let facts = WeekFacts { coach: vec![coach("a1", "p1", 5, &[("brand_new_kind", 1)], 0)], ..WeekFacts::default() };
        let block = run(&facts).unwrap();
        assert_eq!(block.data["feedback"], json!([{"kind": "brand_new_kind", "label": "其他反馈", "count": 1, "assetIds": ["p1"]}]));
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

    #[test]
    fn asks_alone_show_the_block_and_count_their_attempts() {
        let ask = |attempt: &str, asks: u32| CoachFact { asks, ..coach(attempt, "p1", 5, &[], 0) };
        let facts = WeekFacts { coach: vec![ask("a1", 2), ask("a2", 1), ask("", 4)], ..WeekFacts::default() };
        let block = run(&facts).expect("chatting is coach use");
        assert_eq!((block.data["asks"].clone(), block.data["attempts"].clone()), (json!(7), json!(2)));
        assert_eq!(block.data["feedback"], json!([]));
        for key in ["teachingNotes", "strategies", "repeatedAsks", "afterCoach"] {
            assert!(block.data.get(key).is_none(), "{key} appears only when there is something to say");
        }
    }

    #[test]
    fn strategies_merge_spellings_rank_by_reports_then_name_and_stop_at_three() {
        let note = |verdict, strategy: &str| NoteFact { verdict, strategy: Some(strategy.into()) };
        let facts = WeekFacts {
            coach: vec![CoachFact {
                notes: vec![
                    note(NoteVerdict::Helped, "Contrast"),
                    note(NoteVerdict::NotHelped, "contrast"),
                    note(NoteVerdict::Helped, "zeta"),
                    note(NoteVerdict::Helped, "alpha"),
                    note(NoteVerdict::Helped, "beta-step"),
                    note(NoteVerdict::Helped, "beta_step"),
                    NoteFact { verdict: NoteVerdict::Wished, strategy: None },
                ],
                ..coach("a1", "p1", 5, &[], 0)
            }],
            ..WeekFacts::default()
        };
        let block = run(&facts).unwrap();
        assert_eq!(block.data["teachingNotes"], json!({"wished": 1, "helped": 5, "notHelped": 1}));
        assert_eq!(
            block.data["strategies"],
            json!([
                {"strategy": "beta-step", "helped": 2, "notHelped": 0},
                {"strategy": "Contrast", "helped": 1, "notHelped": 1},
                {"strategy": "alpha", "helped": 1, "notHelped": 0},
            ])
        );
    }

    #[test]
    fn a_question_is_repeated_only_across_distinct_messages() {
        let ask = |message: &str, question: &str| AskedQuestion {
            attempt_id: "a1".into(),
            asset_id: "p1".into(),
            question_id: question.into(),
            message_id: message.into(),
        };
        let facts = WeekFacts {
            coach: vec![coach("a1", "p1", 5, &[], 0)],
            // m1 names q1 once; q1 again in m2; q2 only once.
            coach_questions: vec![ask("m1", "q1"), ask("m1", "q1"), ask("m2", "q1"), ask("m2", "q2")],
            ..WeekFacts::default()
        };
        let block = run(&facts).unwrap();
        assert_eq!(block.data["repeatedAsks"], json!({"questions": 1, "asks": 2, "assetIds": ["p1"]}));
    }

    #[test]
    fn the_redo_comparison_needs_at_least_one_question_the_coach_was_asked_about() {
        let redo = |explained, fixed| RedoQuestion { asset_id: "p1".into(), question_id: "q1".into(), fixed, explained };
        let mut facts = WeekFacts {
            coach: vec![coach("a1", "p1", 5, &[], 0)],
            coach_redos: vec![redo(false, true), redo(false, false)],
            ..WeekFacts::default()
        };
        assert!(run(&facts).unwrap().data.get("afterCoach").is_none());
        facts.coach_redos.extend([redo(true, true), redo(true, true), redo(true, false)]);
        assert_eq!(
            run(&facts).unwrap().data["afterCoach"],
            json!({"explainedFixed": 2, "explainedStillWrong": 1, "unexplainedFixed": 1, "unexplainedStillWrong": 1, "assetIds": ["p1"]})
        );
    }
}
