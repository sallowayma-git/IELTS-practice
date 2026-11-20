//! Listening question-type vocabulary and payload indexing.
//!
//! The thirteen kinds are the exact suffixes seeded into `skill_catalog` by
//! migration 0040. Section numbers are not kinds: a section is a position in
//! the paper, not something the learner can be weak at, so it is carried next
//! to the kind and never folded into it.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::reading::scoring::normalize_question_id;

pub const ALLOWED_KINDS: [&str; 13] = [
    "form_completion",
    "notes_completion",
    "table_completion",
    "flow_chart_completion",
    "summary_completion",
    "sentence_completion",
    "single_choice",
    "multi_choice",
    "matching",
    "map_labelling",
    "plan_labelling",
    "diagram_completion",
    "short_answer",
];

pub fn is_allowed_kind(kind: &str) -> bool {
    ALLOWED_KINDS.contains(&kind)
}

/// The unique kinds present in a payload, in canonical order so
/// `question_kinds_json` never depends on group order.
pub fn classify_question_kinds(payload: &Value) -> Vec<String> {
    let mut found = BTreeSet::new();
    for group in groups(payload) {
        if let Some(kind) = group.get("kind").and_then(Value::as_str) {
            found.insert(kind);
        }
    }
    ALLOWED_KINDS
        .iter()
        .filter(|kind| found.contains(**kind))
        .map(|kind| (*kind).to_string())
        .collect()
}

/// questionId (normalized) -> exact kind suffix. Scoring and the learning
/// ledger both read this one map, so an answer row and its event can never
/// disagree about the question type.
pub fn load_kinds(payload: &Value) -> Map<String, Value> {
    let mut map = Map::new();
    for group in groups(payload) {
        let Some(kind) = group.get("kind").and_then(Value::as_str) else {
            continue;
        };
        let Some(ids) = group.get("questionIds").and_then(Value::as_array) else {
            continue;
        };
        for id in ids.iter().filter_map(Value::as_str) {
            let qid = normalize_question_id(id);
            if !qid.is_empty() {
                map.insert(qid, Value::String(kind.to_string()));
            }
        }
    }
    map
}

/// questionId (normalized) -> its group's section (1..=4).
pub fn load_sections(payload: &Value) -> BTreeMap<String, u8> {
    let mut map = BTreeMap::new();
    for group in groups(payload) {
        let Some(section) = group
            .get("section")
            .and_then(Value::as_u64)
            .and_then(|value| u8::try_from(value).ok())
        else {
            continue;
        };
        let Some(ids) = group.get("questionIds").and_then(Value::as_array) else {
            continue;
        };
        for id in ids.iter().filter_map(Value::as_str) {
            let qid = normalize_question_id(id);
            if !qid.is_empty() {
                map.insert(qid, section);
            }
        }
    }
    map
}

fn groups(payload: &Value) -> impl Iterator<Item = &Value> {
    payload
        .get("questionGroups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn kinds_are_canonical_deduplicated_and_sections_are_separate() {
        let payload = json!({"questionGroups": [
            {"kind": "matching", "section": 4, "questionIds": ["q5", "6"]},
            {"kind": "form_completion", "section": 1, "questionIds": ["q1", "q2"]},
            {"kind": "matching", "section": 4, "questionIds": ["q7"]}
        ]});
        assert_eq!(
            classify_question_kinds(&payload),
            vec!["form_completion", "matching"]
        );
        assert_eq!(load_kinds(&payload)["q6"], "matching");
        assert_eq!(load_sections(&payload)["q6"], 4);
        assert_eq!(load_sections(&payload)["q1"], 1);
    }

    #[test]
    fn the_thirteen_seeded_kinds_are_the_whole_vocabulary() {
        assert_eq!(ALLOWED_KINDS.len(), 13);
        assert!(is_allowed_kind("map_labelling"));
        assert!(!is_allowed_kind("gap_fill"));
        assert!(!is_allowed_kind("listening.form_completion"));
    }
}
