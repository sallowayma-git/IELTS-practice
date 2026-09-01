//! Reading answer normalization and scoring (Phase 6).
//! Port of server/src/lib/practice/reading-sessions.ts matching rules.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    Single,
    Alternatives,
    Set,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerComparison {
    pub question_id: String,
    pub user_answer: Value,
    pub correct_answer: Value,
    pub normalized_user: Vec<String>,
    pub normalized_correct: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_correct: Option<bool>,
    pub weight: f64,
    pub match_mode: MatchMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreSummary {
    pub correct: f64,
    pub total: f64,
    pub accuracy: f64,
    pub percentage: f64,
}

pub fn normalize_question_id(value: &str) -> String {
    let raw = value.trim().to_ascii_lowercase();
    if raw.is_empty() {
        return String::new();
    }
    if let Some(rest) = raw.strip_prefix('q') {
        if rest.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(n) = rest.parse::<u32>() {
                return format!("q{n}");
            }
        }
    }
    if raw.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(n) = raw.parse::<u32>() {
            return format!("q{n}");
        }
    }
    raw
}

pub fn normalize_token(value: &str) -> String {
    let mut cleaned = value
        .replace(['“', '”'], "\"")
        .replace(['‘', '’'], "'")
        .replace(['‐', '‑', '‒', '–', '—'], "-");
    // collapse whitespace
    let parts: Vec<_> = cleaned.split_whitespace().collect();
    cleaned = parts.join(" ");
    cleaned = cleaned.trim().to_string();
    // trim surrounding punctuation
    cleaned = cleaned
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    '"' | '\''
                        | '`'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '{'
                        | '}'
                        | '<'
                        | '>'
                        | '.'
                        | ','
                        | ';'
                        | ':'
                        | '!'
                        | '?'
                )
        })
        .to_string();
    if cleaned.is_empty() {
        return String::new();
    }
    let lowered = cleaned.to_ascii_lowercase();
    if matches!(lowered.as_str(), "true" | "t" | "yes" | "y") {
        return "true".into();
    }
    if matches!(lowered.as_str(), "false" | "f" | "no" | "n") {
        return "false".into();
    }
    if matches!(
        lowered.as_str(),
        "ng" | "notgiven" | "not-given" | "not given"
    ) {
        return "not given".into();
    }
    if cleaned.len() == 1 && cleaned.chars().next().unwrap().is_ascii_alphabetic() {
        return cleaned.to_ascii_uppercase();
    }
    // leading option like "A) foo"
    if cleaned.len() > 2 {
        let bytes = cleaned.as_bytes();
        if bytes[0].is_ascii_alphabetic() {
            let second = bytes[1] as char;
            if second == '.' || second == ')' {
                return (bytes[0] as char).to_ascii_uppercase().to_string();
            }
        }
    }
    cleaned
}

pub fn split_answer_tokens(value: &Value) -> Vec<String> {
    match value {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|v| {
                let t = normalize_token(&value_as_string(v));
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            })
            .collect(),
        other => {
            let raw = value_as_string(other)
                .replace(['“', '”'], "\"")
                .replace(['‘', '’'], "'")
                .replace(['‐', '‑', '‒', '–', '—'], "-");
            let raw = raw.split_whitespace().collect::<Vec<_>>().join(" ");
            let raw = raw.trim();
            if raw.is_empty() {
                return vec![];
            }
            // letter lists A, B, C
            if is_letter_list(raw, true) {
                return raw
                    .split(|c| matches!(c, ',' | '/' | ';' | '，' | '、'))
                    .map(|s| normalize_token(s))
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            if is_letter_list(raw, false) {
                return raw
                    .split_whitespace()
                    .map(|s| normalize_token(s))
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            let n = normalize_token(raw);
            if n.is_empty() {
                vec![]
            } else {
                vec![n]
            }
        }
    }
}

fn is_letter_list(raw: &str, comma_sep: bool) -> bool {
    let parts: Vec<&str> = if comma_sep {
        raw.split(|c| matches!(c, ',' | '/' | ';' | '，' | '、'))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        raw.split_whitespace().collect()
    };
    if parts.len() < 2 {
        return false;
    }
    parts.iter().all(|p| {
        let t = p.trim();
        t.len() == 1 && t.chars().next().unwrap().is_ascii_alphabetic()
    })
}

pub fn are_tokens_equivalent(left: &str, right: &str) -> bool {
    let a = normalize_token(left);
    let b = normalize_token(right);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b {
        return true;
    }
    if is_single_letter(&a) || is_single_letter(&b) {
        return false;
    }
    let loose_a: String = a
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let loose_b: String = b
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    !loose_a.is_empty() && loose_a == loose_b
}

fn is_single_letter(s: &str) -> bool {
    s.len() == 1 && s.chars().next().unwrap().is_ascii_uppercase()
}

pub fn compare_token_sets(left: &[String], right: &[String]) -> bool {
    let mut l: Vec<String> = left.iter().cloned().collect();
    let mut r: Vec<String> = right.iter().cloned().collect();
    l.sort();
    l.dedup();
    r.sort();
    r.dedup();
    if l.len() != r.len() {
        return false;
    }
    l.iter()
        .all(|li| r.iter().any(|ri| are_tokens_equivalent(li, ri)))
}

pub fn resolve_match_mode(correct: &Value, control: Option<&str>) -> MatchMode {
    if correct.is_array() && control == Some("checkbox") {
        MatchMode::Set
    } else if correct.is_array() {
        MatchMode::Alternatives
    } else {
        MatchMode::Single
    }
}

pub fn question_weight(correct: &Value, control: Option<&str>) -> f64 {
    if correct.is_array() && control == Some("checkbox") {
        (split_answer_tokens(correct).len() as f64).max(1.0)
    } else {
        1.0
    }
}

pub fn compare_answer(
    user: &Value,
    correct: &Value,
    control: Option<&str>,
) -> (Option<bool>, Vec<String>, Vec<String>, MatchMode) {
    let actual = split_answer_tokens(user);
    let expected = split_answer_tokens(correct);
    let mode = resolve_match_mode(correct, control);
    if actual.is_empty() && expected.is_empty() {
        return (None, actual, expected, mode);
    }
    if actual.is_empty() || expected.is_empty() {
        return (Some(false), actual, expected, mode);
    }
    let ok = match mode {
        MatchMode::Set => compare_token_sets(&actual, &expected),
        MatchMode::Alternatives => {
            if actual.len() == 1 {
                expected
                    .iter()
                    .any(|t| are_tokens_equivalent(t, &actual[0]))
            } else {
                compare_token_sets(&actual, &expected)
            }
        }
        MatchMode::Single => {
            if actual.len() > 1 || expected.len() > 1 {
                compare_token_sets(&actual, &expected)
            } else {
                are_tokens_equivalent(&actual[0], &expected[0])
            }
        }
    };
    (Some(ok), actual, expected, mode)
}

/// Score a map of user answers against answer key.
/// `answer_key`: question_id -> correct value
/// `controls`: optional question_id -> control ("checkbox" etc.)
/// `kinds`: optional question_id -> kind label
pub fn score_attempt(
    answer_key: &serde_json::Map<String, Value>,
    user_answers: &serde_json::Map<String, Value>,
    controls: &serde_json::Map<String, Value>,
    kinds: &serde_json::Map<String, Value>,
) -> (ScoreSummary, Vec<AnswerComparison>) {
    let mut comparisons = Vec::new();
    let mut correct = 0.0;
    let mut total = 0.0;

    let mut qids: Vec<String> = answer_key.keys().cloned().collect();
    qids.sort();
    for qid_raw in qids {
        let qid = normalize_question_id(&qid_raw);
        let correct_ans = answer_key.get(&qid_raw).cloned().unwrap_or(Value::Null);
        let user = user_answers
            .get(&qid)
            .or_else(|| user_answers.get(&qid_raw))
            .cloned()
            .unwrap_or(Value::String(String::new()));
        let control = controls
            .get(&qid)
            .or_else(|| controls.get(&qid_raw))
            .and_then(|v| v.as_str());
        let kind = kinds
            .get(&qid)
            .or_else(|| kinds.get(&qid_raw))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let weight = question_weight(&correct_ans, control);
        let (is_correct, nu, nc, mode) = compare_answer(&user, &correct_ans, control);
        total += weight;
        if is_correct == Some(true) {
            correct += weight;
        }
        comparisons.push(AnswerComparison {
            question_id: qid,
            user_answer: user,
            correct_answer: correct_ans,
            normalized_user: nu,
            normalized_correct: nc,
            is_correct,
            weight,
            match_mode: mode,
            question_kind: kind,
        });
    }

    let accuracy = if total > 0.0 { correct / total } else { 0.0 };
    let summary = ScoreSummary {
        correct,
        total,
        accuracy,
        percentage: (accuracy * 100.0).round(),
    };
    (summary, comparisons)
}

fn value_as_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn true_false_ng_aliases() {
        assert_eq!(normalize_token("YES"), "true");
        assert_eq!(normalize_token("NG"), "not given");
        assert!(are_tokens_equivalent("T", "true"));
    }

    #[test]
    fn single_letter_options() {
        assert_eq!(normalize_token("a"), "A");
        assert!(are_tokens_equivalent("A", "a"));
    }

    #[test]
    fn alternatives_match_any() {
        let (ok, _, _, mode) = compare_answer(&json!("B"), &json!(["A", "B", "C"]), None);
        assert_eq!(mode, MatchMode::Alternatives);
        assert_eq!(ok, Some(true));
    }

    #[test]
    fn set_match_checkbox() {
        let (ok, _, _, mode) =
            compare_answer(&json!(["A", "C"]), &json!(["C", "A"]), Some("checkbox"));
        assert_eq!(mode, MatchMode::Set);
        assert_eq!(ok, Some(true));
    }

    #[test]
    fn score_weighted() {
        let mut key = serde_json::Map::new();
        key.insert("q1".into(), json!("A"));
        key.insert("q2".into(), json!(["A", "B"]));
        let mut user = serde_json::Map::new();
        user.insert("q1".into(), json!("A"));
        user.insert("q2".into(), json!(["A"]));
        let mut controls = serde_json::Map::new();
        controls.insert("q2".into(), json!("checkbox"));
        let (summary, comps) = score_attempt(&key, &user, &controls, &serde_json::Map::new());
        assert_eq!(comps.len(), 2);
        assert!(summary.total >= 3.0);
        assert_eq!(summary.correct, 1.0); // only q1
    }
}
