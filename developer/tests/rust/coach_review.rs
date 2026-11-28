use super::*;
use serde_json::json;

fn answered(value: &Value) -> bool {
    !value.is_null() && value != ""
}

fn answer(id: &str, kind: &str, given: &str, ok: bool, ms: u64, changes: u64) -> Value {
    json!({"questionId": id, "questionKind": kind, "answer": given, "correctAnswer": "X",
           "isCorrect": ok, "elapsedMs": ms, "changeCount": changes, "visitCount": 1, "marked": false})
}

fn display() -> Value {
    json!({"q1": "1", "q2": "2", "q3": "3", "q4": "4", "q5": "5"})
}

#[test]
fn flags_are_relative_to_the_learners_own_median_and_never_absolute() {
    let answers = vec![
        answer("q1", "tfng", "TRUE", false, 60_000, 0),
        answer("q2", "tfng", "FALSE", false, 1_000, 0),
        answer("q3", "short", "a", true, 10_000, 0),
        answer("q4", "short", "b", true, 10_000, 0),
        answer("q5", "short", "c", true, 10_000, 1),
    ];
    let review = analyse(&answers, &display(), answered);
    assert_eq!(review.signals["behaviorRecorded"], true);
    assert_eq!(review.signals["medianSecondsPerAnsweredQuestion"], 10);
    let rows = review.signals["wrongAnswers"].as_array().unwrap();
    assert_eq!(rows.len(), 2, "only answered-and-wrong questions are listed");
    assert_eq!(rows[0][8], json!(["slow"]));
    assert_eq!(rows[1][8], json!(["rushed"]));
}

#[test]
fn without_recorded_time_no_behaviour_is_claimed() {
    let answers = vec![answer("q1", "tfng", "TRUE", false, 0, 0), answer("q2", "tfng", "", false, 0, 0)];
    let review = analyse(&answers, &display(), answered);
    assert_eq!(review.signals["behaviorRecorded"], false);
    assert_eq!(review.signals["wrongAnswersColumns"].as_array().unwrap().len(), 4);
    assert_eq!(review.signals["wrongAnswers"].as_array().unwrap().len(), 1, "a blank is never a wrong answer");
    assert_eq!(review.signals["wrongAnswers"][0].as_array().unwrap().len(), 4);
}

#[test]
fn focus_prefers_flagged_questions_and_one_of_each_kind_first() {
    let answers = vec![
        answer("q1", "tfng", "A", false, 10_000, 0),
        answer("q2", "tfng", "A", false, 10_000, 2),
        answer("q3", "short", "A", false, 10_000, 0),
        answer("q4", "tfng", "A", false, 10_000, 0),
        answer("q5", "match", "A", false, 10_000, 0),
    ];
    let focus = analyse(&answers, &display(), answered).focus;
    assert_eq!(focus, vec!["q2", "q3", "q5"], "flagged q2 first, then one of each new kind; never just the first wrong answers");
}

#[test]
fn the_answer_column_is_clipped_and_the_table_is_bounded() {
    let long = "x".repeat(300);
    let mut answers: Vec<Value> = (0..30).map(|i| answer(&format!("q{i}"), "tfng", &long, false, 5_000, 0)).collect();
    answers.push(answer("q99", "tfng", "ok", true, 5_000, 0));
    let review = analyse(&answers, &json!({}), answered);
    assert_eq!(review.signals["wrongAnsweredCount"], 30);
    let rows = review.signals["wrongAnswers"].as_array().unwrap();
    assert_eq!(rows.len(), 20);
    assert_eq!(rows[0][2].as_str().unwrap().chars().count(), 81);
}

#[test]
fn raw_newlines_inside_a_json_string_are_repaired_and_nothing_else() {
    let repaired = super::super::escape_control_chars_in_strings("{\"answer\":\"line1\nline2\",\"k\":\"a\\\"b\"}");
    let value: Value = serde_json::from_str(&repaired).unwrap();
    assert_eq!(value["answer"], "line1\nline2");
    assert_eq!(value["k"], "a\"b");
    let parsed = super::super::parse_answer("{\"strategy\":\"evidence_first_v1\",\"answer\":\"第一行\n第二行\"}").unwrap();
    assert_eq!(parsed.0, "第一行\n第二行");
    assert!(super::super::parse_answer("{\"answer\": oops}").is_err(), "structural damage is still an error");
}

#[test]
fn reasoning_written_before_the_json_object_is_skipped() {
    let raw = "Let me analyse {this}.
{\"strategy\":\"evidence_first_v1\",\"answer\":\"结论\"}";
    assert_eq!(super::super::parse_answer(raw).unwrap().0, "结论");
    assert!(super::super::parse_answer("Let me think about this, no object follows").is_err());
}

#[test]
fn a_sub_second_median_is_not_recorded_behaviour() {
    let answers = vec![answer("q1", "tfng", "A", false, 300, 0), answer("q2", "tfng", "B", false, 400, 0)];
    let review = analyse(&answers, &display(), answered);
    assert_eq!(review.signals["behaviorRecorded"], false);
}
