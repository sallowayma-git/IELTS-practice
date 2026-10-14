//! Deterministic (zero-LLM) post-submit reading review analysis.
//!
//! A pure function of the persisted attempt: per-question outcome, question
//! kind, change/mark/visit counters and elapsed time. Blank answers are
//! counted as *unanswered*, never as wrong. Metrics whose signal was never
//! recorded (no question timeline) are `None` instead of an invented zero.

use std::collections::BTreeMap;

use ielts_domain::dto::{
    AttemptAnswer, AttemptRecord, ReadingAnalysisRadar, ReadingAnalysisSignals,
    ReadingAnalysisSummary, ReadingDiagnosisItem, ReadingKindPerformance, ReadingNextAction,
    SingleAttemptAnalysis,
};

use crate::reading::scoring::split_answer_tokens;

const UNANSWERED_RATE_HIGH: f64 = 0.08;
const CHANGED_RATE_HIGH: f64 = 0.25;
const ACCURACY_LOW: f64 = 0.6;
const TARGET_ACCURACY_PERCENT: u32 = 75;
const MAX_LISTED_QUESTIONS: usize = 6;
const MAX_DIAGNOSIS: usize = 4;
const MAX_ACTIONS: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionOutcome {
    Correct,
    Incorrect,
    Unanswered,
    /// Answered but no answer key verdict exists; excluded from accuracy.
    Ungraded,
}

/// Blank (no non-empty token) is unanswered regardless of `is_correct`.
pub fn question_outcome(answer: &AttemptAnswer) -> QuestionOutcome {
    if split_answer_tokens(&answer.answer).is_empty() {
        return QuestionOutcome::Unanswered;
    }
    match answer.is_correct {
        Some(true) => QuestionOutcome::Correct,
        Some(false) => QuestionOutcome::Incorrect,
        None => QuestionOutcome::Ungraded,
    }
}

/// Canonical kind key: lowercased, `-`/space → `_`, missing → `unknown`.
pub fn normalize_question_kind(kind: Option<&str>) -> String {
    let normalized = kind
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
        .replace(['-', ' '], "_");
    match normalized.as_str() {
        "" => "unknown".into(),
        "tfng" => "true_false_not_given".into(),
        "yng" => "yes_no_not_given".into(),
        "mcq" | "multiple_choice" => "multi_choice".into(),
        _ => normalized,
    }
}

pub fn question_kind_label(kind: &str) -> String {
    let label = match kind {
        "single_choice" => "单选题",
        "multi_choice" => "多选题",
        "true_false_not_given" => "判断题（T/F/NG）",
        "yes_no_not_given" => "判断题（Y/N/NG）",
        "sentence_completion" => "句子填空",
        "summary_completion" => "摘要填空",
        "table_completion" => "表格填空",
        "notes_completion" | "note_completion" => "笔记填空",
        "form_completion" => "表单填空",
        "flow_chart_completion" => "流程图填空",
        "diagram_completion" | "diagram_label_completion" => "图示填空",
        "matching" => "匹配题",
        "matching_headings" => "标题匹配",
        "matching_information" => "信息匹配",
        "matching_features" => "特征匹配",
        "matching_sentence_endings" => "句尾匹配",
        "classification" => "分类题",
        "short_answer" => "简答题",
        "unknown" => "未映射题型",
        other => return other.to_string(),
    };
    label.to_string()
}

/// "q12" → "12"; other ids are shown as-is.
fn display_question(question_id: &str) -> String {
    question_id
        .strip_prefix('q')
        .filter(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(question_id)
        .to_string()
}

fn question_sort_key(question_id: &str) -> (u32, String) {
    let numeric = display_question(question_id).parse::<u32>().unwrap_or(u32::MAX);
    (numeric, question_id.to_string())
}

fn join_questions(ids: &[String]) -> String {
    let mut shown: Vec<String> = ids
        .iter()
        .take(MAX_LISTED_QUESTIONS)
        .map(|id| display_question(id))
        .collect();
    if ids.len() > MAX_LISTED_QUESTIONS {
        shown.push("…".into());
    }
    shown.join("、")
}

fn ratio(numerator: u32, denominator: u32) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        round4(f64::from(numerator) / f64::from(denominator))
    }
}

fn weighted_ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator > 0.0 {
        round4(numerator / denominator)
    } else {
        0.0
    }
}

/// Score weight as the formal scorer stored it; legacy or corrupt rows count once.
fn score_weight(answer: &AttemptAnswer) -> f64 {
    if answer.weight.is_finite() && answer.weight > 0.0 {
        answer.weight
    } else {
        1.0
    }
}

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

fn percent(value: f64) -> u32 {
    (value * 100.0).round().max(0.0) as u32
}

#[derive(Default)]
struct KindAccumulator {
    total: u32,
    correct: u32,
    incorrect: u32,
    unanswered: u32,
    elapsed_ms: u64,
    timed: u32,
    /// Weighted like the submit score, so accuracy matches the formal result.
    correct_weight: f64,
    graded_weight: f64,
}

/// Build `(analysisSignals, singleAttemptAnalysis)` for a reading attempt.
/// Returns `None` when the attempt has no question rows.
pub fn build_reading_attempt_analysis(
    answers: &[AttemptAnswer],
    duration_ms: u64,
) -> Option<(ReadingAnalysisSignals, SingleAttemptAnalysis)> {
    if answers.is_empty() {
        return None;
    }
    let mut rows: Vec<&AttemptAnswer> = answers.iter().collect();
    rows.sort_by_key(|a| question_sort_key(&a.question_id));

    let timeline_available = rows
        .iter()
        .any(|a| a.visit_count > 0 || a.change_count > 0 || a.elapsed_ms > 0);

    let mut correct_ids = Vec::new();
    let mut incorrect_ids = Vec::new();
    let mut unanswered_ids = Vec::new();
    let mut changed_ids = Vec::new();
    let mut changed_incorrect_ids = Vec::new();
    let mut marked_count = 0u32;
    let mut interactions = 0u64;
    let mut kinds: BTreeMap<String, KindAccumulator> = BTreeMap::new();
    let mut kind_incorrect_ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut slowest_incorrect: Option<(&AttemptAnswer, u64)> = None;
    let mut correct_weight = 0.0;
    let mut graded_weight = 0.0;

    for answer in &rows {
        let outcome = question_outcome(answer);
        let kind = normalize_question_kind(answer.question_kind.as_deref());
        let acc = kinds.entry(kind.clone()).or_default();
        if answer.elapsed_ms > 0 {
            acc.elapsed_ms += answer.elapsed_ms;
            acc.timed += 1;
        }
        if outcome != QuestionOutcome::Ungraded {
            let weight = score_weight(answer);
            acc.graded_weight += weight;
            graded_weight += weight;
            if outcome == QuestionOutcome::Correct {
                acc.correct_weight += weight;
                correct_weight += weight;
            }
        }
        match outcome {
            QuestionOutcome::Correct => {
                acc.total += 1;
                acc.correct += 1;
                correct_ids.push(answer.question_id.clone());
            }
            QuestionOutcome::Incorrect => {
                acc.total += 1;
                acc.incorrect += 1;
                incorrect_ids.push(answer.question_id.clone());
                kind_incorrect_ids
                    .entry(kind.clone())
                    .or_default()
                    .push(answer.question_id.clone());
                if answer.elapsed_ms > 0
                    && slowest_incorrect.map_or(true, |(_, ms)| answer.elapsed_ms > ms)
                {
                    slowest_incorrect = Some((answer, answer.elapsed_ms));
                }
            }
            QuestionOutcome::Unanswered => {
                acc.total += 1;
                acc.unanswered += 1;
                unanswered_ids.push(answer.question_id.clone());
            }
            QuestionOutcome::Ungraded => {}
        }
        if answer.marked {
            marked_count += 1;
        }
        if answer.change_count > 0 {
            changed_ids.push(answer.question_id.clone());
            if outcome == QuestionOutcome::Incorrect {
                changed_incorrect_ids.push(answer.question_id.clone());
            }
        }
        interactions += u64::from(answer.visit_count) + u64::from(answer.change_count);
    }

    let correct = correct_ids.len() as u32;
    let incorrect = incorrect_ids.len() as u32;
    let unanswered = unanswered_ids.len() as u32;
    let graded_total = correct + incorrect + unanswered;
    let accuracy = weighted_ratio(correct_weight, graded_weight);
    let unanswered_rate = ratio(unanswered, graded_total);
    let changed_answer_count = timeline_available.then_some(changed_ids.len() as u32);
    let changed_answer_rate = changed_answer_count.map(|c| ratio(c, graded_total));
    let interaction_density = timeline_available.then(|| {
        let minutes = (duration_ms as f64 / 60_000.0).max(1.0);
        (interactions as f64 / minutes * 100.0).round() / 100.0
    });

    let signals = ReadingAnalysisSignals {
        question_count: graded_total,
        answered_count: correct + incorrect,
        unanswered_count: unanswered,
        correct_count: correct,
        incorrect_count: incorrect,
        marked_question_count: marked_count,
        changed_answer_count,
        interaction_density,
        timeline_available,
    };

    let by_question_kind: Vec<ReadingKindPerformance> = kinds
        .iter()
        .filter(|(_, acc)| acc.total > 0)
        .map(|(kind, acc)| ReadingKindPerformance {
            kind: kind.clone(),
            label: question_kind_label(kind),
            total: acc.total,
            correct: acc.correct,
            incorrect: acc.incorrect,
            unanswered: acc.unanswered,
            accuracy: weighted_ratio(acc.correct_weight, acc.graded_weight),
            avg_elapsed_ms: (acc.timed > 0).then(|| acc.elapsed_ms / u64::from(acc.timed)),
        })
        .collect();

    // Weakest kind: most wrong answers, then lowest accuracy, then key order.
    // Unanswered questions are a time issue, reported separately.
    let weakest_kind = by_question_kind
        .iter()
        .filter(|row| row.incorrect > 0)
        .min_by(|a, b| {
            b.incorrect
                .cmp(&a.incorrect)
                .then(a.accuracy.total_cmp(&b.accuracy))
                .then(a.kind.cmp(&b.kind))
        });

    let mut diagnosis = Vec::new();
    if graded_total > 0 && accuracy < ACCURACY_LOW && incorrect > 0 {
        diagnosis.push(ReadingDiagnosisItem {
            kind: "overall_accuracy_low".into(),
            severity: "high".into(),
            message: format!(
                "本次正确率 {}%（{}/{}），答错 {} 题，建议先集中复盘错题。",
                percent(accuracy),
                correct,
                graded_total,
                incorrect
            ),
            question_ids: incorrect_ids.clone(),
            question_kind: None,
        });
    }
    if let Some(row) = weakest_kind {
        let severity = if row.accuracy < 0.5 { "high" } else { "medium" };
        diagnosis.push(ReadingDiagnosisItem {
            kind: "weakest_question_kind".into(),
            severity: severity.into(),
            message: format!(
                "「{}」答错 {} 题（共 {} 题，正确率 {}%），是本次失分最多的题型。",
                row.label,
                row.incorrect,
                row.total,
                percent(row.accuracy)
            ),
            question_ids: kind_incorrect_ids.get(&row.kind).cloned().unwrap_or_default(),
            question_kind: Some(row.kind.clone()),
        });
    }
    if unanswered > 0 {
        let severity = if unanswered_rate > UNANSWERED_RATE_HIGH {
            "high"
        } else {
            "medium"
        };
        diagnosis.push(ReadingDiagnosisItem {
            kind: "unanswered".into(),
            severity: severity.into(),
            message: format!(
                "第 {} 题未作答（共 {} 题），这部分按未作答统计而非答错，主要是时间分配或定位损耗。",
                join_questions(&unanswered_ids),
                unanswered
            ),
            question_ids: unanswered_ids.clone(),
            question_kind: None,
        });
    }
    if let (Some(changed), Some(rate)) = (changed_answer_count, changed_answer_rate) {
        if changed > 0 && (rate > CHANGED_RATE_HIGH || !changed_incorrect_ids.is_empty()) {
            let severity = if rate > CHANGED_RATE_HIGH { "medium" } else { "low" };
            diagnosis.push(ReadingDiagnosisItem {
                kind: "answer_instability".into(),
                severity: severity.into(),
                message: format!(
                    "改过答案 {} 题，其中 {} 题最终答错，判断依据不够稳定。",
                    changed,
                    changed_incorrect_ids.len()
                ),
                question_ids: changed_ids.clone(),
                question_kind: None,
            });
        }
    }
    if let Some((answer, ms)) = slowest_incorrect {
        diagnosis.push(ReadingDiagnosisItem {
            kind: "slowest_incorrect".into(),
            severity: "low".into(),
            message: format!(
                "第 {} 题用时 {} 秒仍答错，是本次耗时最多的错题。",
                display_question(&answer.question_id),
                (ms + 500) / 1000
            ),
            question_ids: vec![answer.question_id.clone()],
            question_kind: Some(normalize_question_kind(answer.question_kind.as_deref())),
        });
    }
    if diagnosis.is_empty() && graded_total > 0 && incorrect == 0 && unanswered == 0 {
        diagnosis.push(ReadingDiagnosisItem {
            kind: "all_correct".into(),
            severity: "low".into(),
            message: format!("全部 {graded_total} 题答对，本篇没有明显薄弱点。"),
            question_ids: vec![],
            question_kind: None,
        });
    }
    diagnosis.truncate(MAX_DIAGNOSIS);

    let mut next_actions = Vec::new();
    if !incorrect_ids.is_empty() {
        let listed = join_questions(&incorrect_ids);
        next_actions.push(ReadingNextAction {
            kind: "redo_incorrect".into(),
            target: format!("第 {listed} 题"),
            instruction: format!(
                "重做第 {listed} 题：回到原文定位答案句，对照同义替换，写下排除干扰项的理由。"
            ),
            question_ids: incorrect_ids.clone(),
            question_kind: None,
        });
    }
    if let Some(row) = weakest_kind {
        next_actions.push(ReadingNextAction {
            kind: "targeted_drill".into(),
            target: row.label.clone(),
            instruction: format!(
                "专项练习「{}」，先做 1–2 篇同题型，目标正确率提升到 {}% 以上。",
                row.label, TARGET_ACCURACY_PERCENT
            ),
            question_ids: kind_incorrect_ids.get(&row.kind).cloned().unwrap_or_default(),
            question_kind: Some(row.kind.clone()),
        });
    }
    if !unanswered_ids.is_empty() {
        next_actions.push(ReadingNextAction {
            kind: "time_management".into(),
            target: "完成度".into(),
            instruction: format!(
                "补做第 {} 题；下次先做把握大的题，最后回收难题，保证每题都有作答。",
                join_questions(&unanswered_ids)
            ),
            question_ids: unanswered_ids.clone(),
            question_kind: None,
        });
    }
    if next_actions.is_empty() {
        next_actions.push(ReadingNextAction {
            kind: "maintain_and_iterate".into(),
            target: "整体".into(),
            instruction: "保持当前节奏，下一篇尝试缩短用时或换一个薄弱题型。".into(),
            question_ids: vec![],
            question_kind: None,
        });
    }
    next_actions.truncate(MAX_ACTIONS);

    let analysis = SingleAttemptAnalysis {
        summary: ReadingAnalysisSummary {
            accuracy,
            duration_sec: duration_ms / 1000,
            unanswered_rate,
            changed_answer_rate,
        },
        radar: ReadingAnalysisRadar { by_question_kind },
        diagnosis,
        next_actions,
    };
    Some((signals, analysis))
}

/// Convenience wrapper for a terminal reading attempt record.
pub fn analyze_reading_attempt(
    attempt: &AttemptRecord,
) -> Option<(ReadingAnalysisSignals, SingleAttemptAnalysis)> {
    if attempt.activity != ielts_domain::domain::Activity::Reading {
        return None;
    }
    if !matches!(
        attempt.status,
        ielts_domain::domain::AttemptStatus::Completed
            | ielts_domain::domain::AttemptStatus::Submitted
            | ielts_domain::domain::AttemptStatus::Reviewing
    ) {
        return None;
    }
    build_reading_attempt_analysis(&attempt.answers, attempt.duration_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn answer(qid: &str, value: Value, is_correct: Option<bool>, kind: &str) -> AttemptAnswer {
        AttemptAnswer {
            question_id: qid.into(),
            answer: value,
            is_correct,
            weight: 1.0,
            question_kind: Some(kind.into()),
            change_count: 0,
            visit_count: 0,
            elapsed_ms: 0,
            marked: false,
            answered_at: None,
        }
    }

    #[test]
    fn accuracy_uses_the_stored_score_weight() {
        // A 3-point checkbox right and a 1-point question wrong is 75%, as submit scores it.
        let mut multi = answer("q1", json!(["A", "C", "E"]), Some(true), "checkbox");
        multi.weight = 3.0;
        let answers = vec![multi, answer("q2", json!("B"), Some(false), "checkbox")];
        let (signals, analysis) = build_reading_attempt_analysis(&answers, 60_000).unwrap();
        assert_eq!(analysis.summary.accuracy, 0.75);
        assert_eq!(analysis.radar.by_question_kind[0].accuracy, 0.75);
        assert_eq!((signals.correct_count, signals.incorrect_count), (1, 1));
        assert!(analysis.diagnosis.iter().all(|d| d.kind != "overall_accuracy_low"));
    }

    #[test]
    fn blank_answers_count_as_unanswered_not_wrong() {
        // compare_answer marks a blank as Some(false); the analysis must not.
        let answers = vec![
            answer("q1", json!("A"), Some(true), "single_choice"),
            answer("q2", json!(""), Some(false), "single_choice"),
            answer("q3", json!("   "), Some(false), "single_choice"),
            answer("q4", Value::Null, Some(false), "single_choice"),
            answer("q5", json!([]), Some(false), "multi_choice"),
            answer("q6", json!("B"), Some(false), "single_choice"),
        ];
        let (signals, analysis) = build_reading_attempt_analysis(&answers, 60_000).unwrap();
        assert_eq!(signals.unanswered_count, 4);
        assert_eq!(signals.incorrect_count, 1);
        assert_eq!(signals.correct_count, 1);
        assert_eq!(signals.question_count, 6);
        let single = analysis
            .radar
            .by_question_kind
            .iter()
            .find(|r| r.kind == "single_choice")
            .unwrap();
        assert_eq!((single.total, single.correct, single.incorrect, single.unanswered), (5, 1, 1, 3));
        let redo = analysis
            .next_actions
            .iter()
            .find(|a| a.kind == "redo_incorrect")
            .unwrap();
        assert_eq!(redo.question_ids, vec!["q6".to_string()]);
        assert!(redo.instruction.contains("第 6 题"));
        assert!(analysis.diagnosis.iter().any(|d| d.kind == "unanswered"));
    }

    #[test]
    fn aggregates_by_kind_and_picks_weakest() {
        let answers = vec![
            answer("q1", json!("TRUE"), Some(true), "true_false_not_given"),
            answer("q2", json!("FALSE"), Some(false), "true_false_not_given"),
            answer("q3", json!("NG"), Some(false), "tfng"),
            answer("q4", json!("A"), Some(true), "matching"),
            answer("q5", json!("C"), Some(false), "matching"),
            answer("q6", json!("word"), Some(true), "Summary-Completion"),
        ];
        let (_, analysis) = build_reading_attempt_analysis(&answers, 0).unwrap();
        let kinds: Vec<_> = analysis
            .radar
            .by_question_kind
            .iter()
            .map(|r| (r.kind.as_str(), r.total, r.correct))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("matching", 2, 1),
                ("summary_completion", 1, 1),
                ("true_false_not_given", 3, 1),
            ]
        );
        let weakest = analysis
            .diagnosis
            .iter()
            .find(|d| d.kind == "weakest_question_kind")
            .unwrap();
        assert_eq!(weakest.question_kind.as_deref(), Some("true_false_not_given"));
        assert_eq!(weakest.question_ids, vec!["q2".to_string(), "q3".to_string()]);
        assert!(weakest.message.contains("判断题"));
        assert!(analysis
            .next_actions
            .iter()
            .any(|a| a.kind == "targeted_drill" && a.question_kind.as_deref() == Some("true_false_not_given")));
    }

    #[test]
    fn missing_timeline_omits_change_and_density_metrics() {
        let mut answers = vec![
            answer("q1", json!("A"), Some(true), "matching"),
            answer("q2", json!("B"), Some(false), "matching"),
        ];
        answers[1].marked = true;
        let (signals, analysis) = build_reading_attempt_analysis(&answers, 120_000).unwrap();
        assert!(!signals.timeline_available);
        assert_eq!(signals.changed_answer_count, None);
        assert_eq!(signals.interaction_density, None);
        assert_eq!(signals.marked_question_count, 1);
        assert_eq!(analysis.summary.changed_answer_rate, None);
        assert!(analysis.diagnosis.iter().all(|d| d.kind != "answer_instability"));
        let value = serde_json::to_value(&signals).unwrap();
        assert!(value["changedAnswerCount"].is_null());
        assert!(value["interactionDensity"].is_null());
    }

    #[test]
    fn timeline_signals_change_density_and_slowest_wrong() {
        let mut answers = vec![
            answer("q1", json!("A"), Some(true), "matching"),
            answer("q2", json!("B"), Some(false), "matching"),
            answer("q3", json!("C"), Some(false), "matching"),
        ];
        answers[0].visit_count = 2;
        answers[1].visit_count = 3;
        answers[1].change_count = 2;
        answers[1].elapsed_ms = 90_000;
        answers[2].visit_count = 1;
        answers[2].elapsed_ms = 30_000;
        let (signals, analysis) = build_reading_attempt_analysis(&answers, 240_000).unwrap();
        assert_eq!(signals.changed_answer_count, Some(1));
        // (2+3+2+1) interactions / 4 minutes
        assert_eq!(signals.interaction_density, Some(2.0));
        let slow = analysis
            .diagnosis
            .iter()
            .find(|d| d.kind == "slowest_incorrect")
            .unwrap();
        assert_eq!(slow.question_ids, vec!["q2".to_string()]);
        assert!(slow.message.contains("90 秒"));
        assert_eq!(analysis.radar.by_question_kind[0].avg_elapsed_ms, Some(60_000));
    }

    #[test]
    fn deterministic_regardless_of_input_order() {
        let answers = vec![
            answer("q10", json!("A"), Some(false), "matching"),
            answer("q2", json!(""), Some(false), "single_choice"),
            answer("q1", json!("B"), Some(false), "single_choice"),
            answer("q3", json!("C"), Some(true), "matching"),
        ];
        let mut reversed = answers.clone();
        reversed.reverse();
        let first = build_reading_attempt_analysis(&answers, 300_000).unwrap();
        let second = build_reading_attempt_analysis(&reversed, 300_000).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&build_reading_attempt_analysis(&answers, 300_000).unwrap())
                .unwrap()
        );
        // q1 sorts before q10 numerically.
        let redo = first.1.next_actions.iter().find(|a| a.kind == "redo_incorrect").unwrap();
        assert_eq!(redo.question_ids, vec!["q1".to_string(), "q10".to_string()]);
    }

    #[test]
    fn all_correct_gets_positive_diagnosis_and_maintain_action() {
        let answers = vec![answer("q1", json!("A"), Some(true), "matching")];
        let (_, analysis) = build_reading_attempt_analysis(&answers, 0).unwrap();
        assert_eq!(analysis.diagnosis[0].kind, "all_correct");
        assert_eq!(analysis.next_actions[0].kind, "maintain_and_iterate");
        assert!(build_reading_attempt_analysis(&[], 0).is_none());
    }
}
