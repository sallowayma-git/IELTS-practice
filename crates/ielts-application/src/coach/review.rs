//! Whole-attempt review: the host computes facts (what was answered, how long it
//! took, how often it was edited) and the model turns them into cause guesses.
//! The host never writes a hypothesis; it only says which facts are recorded.
use serde_json::{json, Value};

/// Appended to the review request controls (the volatile final turn), never to
/// the system prompt, so the cacheable prefix stays byte-stable.
pub(super) const CONTRACT: &str = "Whole-attempt review. Reply with the JSON object at once: the first character must be `{`, with no planning or analysis text before or after it. The \"answer\" value is plain text in the learner's language, at most 450 Chinese characters or 220 English words, no tables. \
(1) One line: the score and what kind of attempt it was (pace, blanks). \
(2) Make 1-3 cause guesses, strongest first. Each guess names its question labels, starts with 我猜/My guess, and cites its evidence: the learner's answer against the official answer, a passage quote for focus questions, and the recorded reviewSignals flags, seconds and changes. \
Confidence 高/中/低: 高 only when a recorded signal and the answer pattern agree; a guess from the answer pattern alone is 中 at most; never guess from the score alone. \
(3) After each guess add one 10-second yes/no self-check the learner can answer from memory. \
(4) End with ONE concrete training action for the top guess and invite the learner to say if the guess was wrong. \
Each focus question's best passage chunk is already in source.initialEvidence: write from it and call no tool unless a focus question has no usable chunk. \
Never state a behaviour that is not in reviewSignals: `changes` counts edits, not their direction. If behaviorRecorded is false, diagnose from answers and passage only. Blank answers are not a weakness: mention their count once. No teachingNotes.";

/// Seconds a question must take to count as slow / rushed, relative to the
/// learner's own median on this attempt, never an absolute pace.
const SLOW_FLOOR_SECONDS: u64 = 20;
const MAX_ROWS: usize = 20;
const MAX_FOCUS: usize = 3;
const ANSWER_CLIP: usize = 80;

pub(super) struct Review {
    pub focus: Vec<String>,
    pub signals: Value,
}

struct Row {
    id: String,
    label: Value,
    kind: String,
    answer: Value,
    correct: Value,
    seconds: u64,
    changes: u64,
    visits: u64,
    marked: bool,
    flags: Vec<&'static str>,
}

fn clip(value: &Value) -> Value {
    match value {
        Value::String(text) if text.chars().count() > ANSWER_CLIP => {
            Value::String(text.chars().take(ANSWER_CLIP).collect::<String>() + "…")
        }
        other => other.clone(),
    }
}

fn median(mut values: Vec<u64>) -> u64 {
    values.sort_unstable();
    values.get(values.len() / 2).copied().unwrap_or(0)
}

fn flags(row: &Row, recorded: bool, median: u64) -> Vec<&'static str> {
    let mut flags = Vec::new();
    if recorded && median > 0 {
        if row.seconds >= SLOW_FLOOR_SECONDS && row.seconds >= median * 2 {
            flags.push("slow");
        }
        if median >= 5 && row.seconds * 5 <= median * 2 {
            flags.push("rushed");
        }
    }
    if row.changes >= 1 {
        flags.push("changed");
    }
    if row.visits >= 3 {
        flags.push("revisited");
    }
    if row.marked {
        flags.push("marked");
    }
    flags
}

/// Up to `MAX_FOCUS` wrong questions: the most flagged first, one per question
/// kind before a second of any kind, so the guesses cover different skills.
fn pick_focus(rows: &[Row]) -> Vec<String> {
    let mut order: Vec<&Row> = rows.iter().collect();
    order.sort_by_key(|row| std::cmp::Reverse(row.flags.len()));
    let mut picked: Vec<&Row> = Vec::new();
    for row in &order {
        if picked.len() < MAX_FOCUS && !picked.iter().any(|p| p.kind == row.kind) {
            picked.push(row);
        }
    }
    for row in &order {
        if picked.len() < MAX_FOCUS && !picked.iter().any(|p| p.id == row.id) {
            picked.push(row);
        }
    }
    picked.into_iter().map(|row| row.id.clone()).collect()
}

pub(super) fn analyse(answers: &[Value], display: &Value, answered: impl Fn(&Value) -> bool) -> Review {
    let seconds_of = |a: &Value| a["elapsedMs"].as_u64().unwrap_or(0) / 1000;
    let timed: Vec<u64> = answers
        .iter()
        .filter(|a| answered(&a["answer"]) && a["elapsedMs"].as_u64().unwrap_or(0) > 0)
        .map(seconds_of)
        .collect();
    let median = median(timed);
    // Sub-second medians are timer noise, not a pace worth reasoning about.
    let recorded = median >= 1;
    let mut rows: Vec<Row> = answers
        .iter()
        .filter(|a| answered(&a["answer"]) && a["isCorrect"] == false)
        .map(|a| {
            let id = a["questionId"].as_str().unwrap_or("").to_owned();
            let mut row = Row {
                label: display[id.as_str()].clone(),
                kind: a["questionKind"].as_str().unwrap_or("unknown").to_owned(),
                answer: clip(&a["answer"]),
                correct: clip(&a["correctAnswer"]),
                seconds: seconds_of(a),
                changes: a["changeCount"].as_u64().unwrap_or(0),
                visits: a["visitCount"].as_u64().unwrap_or(0),
                marked: a["marked"].as_bool().unwrap_or(false),
                flags: Vec::new(),
                id,
            };
            row.flags = flags(&row, recorded, median);
            row
        })
        .collect();
    let focus = pick_focus(&rows);
    let wrong_count = rows.len();
    rows.truncate(MAX_ROWS);
    let table: Vec<Value> = rows
        .iter()
        .map(|row| {
            if recorded {
                json!([row.label, row.kind, row.answer, row.correct, row.seconds, row.changes, row.visits, row.marked, row.flags])
            } else {
                json!([row.label, row.kind, row.answer, row.correct])
            }
        })
        .collect();
    let columns = if recorded {
        json!(["label", "kind", "answer", "correctAnswer", "seconds", "changes", "visits", "marked", "flags"])
    } else {
        json!(["label", "kind", "answer", "correctAnswer"])
    };
    Review {
        focus,
        signals: json!({
            "behaviorRecorded": recorded,
            "medianSecondsPerAnsweredQuestion": median,
            "flagMeaning": {"slow": "at least 20s and twice this attempt's median", "rushed": "at most 40% of the median", "changed": "answer edited at least once", "revisited": "opened 3+ times", "marked": "learner marked it"},
            "wrongAnsweredCount": wrong_count,
            "wrongAnswersColumns": columns,
            "wrongAnswers": table,
        }),
    }
}

#[cfg(test)]
#[path = "../../../../developer/tests/rust/coach_review.rs"]
mod tests;
