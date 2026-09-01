use std::fs;
use std::path::PathBuf;

use ielts_db::import::{
    assert_no_legacy_aliases, evaluation_v3_to_v4, reading_archive_to_attempts,
};
use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, EvaluationStatus, ScoreScale};
use ielts_domain::view::{history_item_from_attempt, writing_result_from_evaluation};
use serde_json::Value;

fn fixtures_root() -> PathBuf {
    // crates/ielts-domain -> repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn load_json(rel: &str) -> Value {
    let path = fixtures_root().join(rel);
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

#[test]
fn evaluation_v3_bank_normal_to_v4_preserves_scores_and_feedback() {
    let fixture = load_json("tests/fixtures/writing/writing-task2-bank-normal.json");
    let evaluation = fixture.get("evaluation").expect("evaluation");
    let v4 = evaluation_v3_to_v4(evaluation).expect("convert");
    assert_no_legacy_aliases(&v4).expect("no legacy aliases");

    assert_eq!(v4.schema_version, 4);
    assert_eq!(v4.status, EvaluationStatus::Completed);
    let score = v4.score.as_ref().expect("score");
    assert_eq!(score.overall, 6.5);
    assert_eq!(score.task_response, 6.5);
    assert_eq!(score.coherence, 6.0);
    assert_eq!(score.lexical, 6.5);
    assert_eq!(score.grammar, 6.0);

    let feedback = v4.feedback.as_ref().expect("feedback");
    assert_eq!(
        feedback.overall.as_deref(),
        Some("Overall the essay addresses the task with adequate organization.")
    );
    assert_eq!(feedback.plan.len(), 3);
    assert_eq!(feedback.paragraphs.len(), 2);
    assert_eq!(feedback.sentences.len(), 1);

    let vm = writing_result_from_evaluation("attempt-1", "Task 2 bank", &v4);
    assert_eq!(vm.score.as_ref().map(|s| s.overall), Some(6.5));
    assert!(!vm.degraded);
    assert_eq!(vm.paragraph_count, 2);
    assert_eq!(vm.sentence_count, 1);
}

#[test]
fn evaluation_v3_degraded_keeps_scores_drops_sentence_review() {
    let fixture = load_json("tests/fixtures/writing/writing-task2-freeform-degraded.json");
    let evaluation = fixture.get("evaluation").expect("evaluation");
    let v4 = evaluation_v3_to_v4(evaluation).expect("convert");

    assert_eq!(v4.status, EvaluationStatus::Degraded);
    assert!(v4.score.is_some());
    let feedback = v4.feedback.as_ref().expect("feedback");
    assert!(feedback.paragraphs.is_empty());
    assert!(feedback.sentences.is_empty());
    assert!(!feedback.plan.is_empty());
    assert!(v4.degradation.is_some());

    let vm = writing_result_from_evaluation("attempt-2", "degraded", &v4);
    assert!(vm.degraded);
    assert!(vm.degradation_reason.is_some());
}

#[test]
fn evaluation_v3_failed_has_error_no_score() {
    let fixture = load_json("tests/fixtures/writing/writing-task2-freeform-failed.json");
    let evaluation = fixture.get("evaluation").expect("evaluation");
    let v4 = evaluation_v3_to_v4(evaluation).expect("convert");

    assert_eq!(v4.status, EvaluationStatus::Failed);
    assert!(v4.score.is_none());
    let err = v4.error.as_ref().expect("error");
    assert_eq!(err.code, "PROVIDER_TIMEOUT");
    assert!(err.retryable);
}

#[test]
fn reading_archive_to_attempt_preserves_title_score_answers_marks() {
    let archive =
        load_json("tests/fixtures/legacy-data/reading-archive/reading-archive-v1-sample.json");
    let attempts = reading_archive_to_attempts(&archive).expect("convert archive");
    assert_eq!(attempts.len(), 1);
    let attempt = &attempts[0];

    assert_eq!(attempt.activity, Activity::Reading);
    assert_eq!(attempt.mode, AttemptMode::Single);
    assert_eq!(attempt.status, AttemptStatus::Completed);
    assert_eq!(attempt.asset_id.as_deref(), Some("p1-high-01"));
    assert_eq!(
        attempt.title_snapshot.as_deref(),
        Some("A Brief History of Tea")
    );
    assert_eq!(attempt.duration_ms, 1400);
    assert_eq!(attempt.correct_count, Some(11.0));
    assert_eq!(attempt.question_count, Some(13));
    assert_eq!(attempt.score_scale, Some(ScoreScale::Ratio));
    let accuracy = attempt.score_value.expect("accuracy");
    assert!((accuracy - 0.846).abs() < 0.001);

    assert!(attempt.answers.iter().any(|a| a.question_id == "q1"));
    assert!(attempt
        .answers
        .iter()
        .any(|a| a.question_id == "q3" && a.marked));
    assert_eq!(attempt.annotations.len(), 1);

    let vm = history_item_from_attempt(attempt);
    assert_eq!(vm.score_label, "Accuracy");
    assert_eq!(vm.title, "A Brief History of Tea");
    assert!(vm.score_display.ends_with('%'));
}

#[test]
fn v4_serialization_uses_camel_case_without_legacy_keys() {
    let fixture = load_json("tests/fixtures/writing/writing-task1-bank-normal.json");
    let v4 = evaluation_v3_to_v4(fixture.get("evaluation").unwrap()).unwrap();
    let json = serde_json::to_value(&v4).unwrap();
    let obj = json.as_object().unwrap();
    assert!(obj.contains_key("schemaVersion"));
    assert!(obj.contains_key("score"));
    assert!(!obj.contains_key("total_score"));
    assert!(!obj.contains_key("scorecard"));
    assert!(!obj.contains_key("overall_feedback"));
}
