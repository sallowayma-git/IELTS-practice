//! Library display tags, derived from the same group classifier as scoring.
use serde_json::Value;

const ORDER: [&str; 7] = [
    "single_choice",
    "multi_choice",
    "judgement",
    "completion",
    "heading_match",
    "paragraph_match",
    "matching",
];

pub fn classify_question_kinds(payload: &Value) -> Vec<String> {
    let mut found = std::collections::BTreeSet::new();
    for group in payload
        .get("questionGroups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let kind = super::assets::group_kind(group);
        let tag = match kind.as_str() {
            "single_choice" => "single_choice",
            "multi_choice" => "multi_choice",
            "true_false_not_given" | "yes_no_not_given" | "tfng" | "ynng" => "judgement",
            "matching_headings" => "heading_match",
            "matching_information" => "paragraph_match",
            "matching" | "classification" | "matching_features" | "matching_sentence_endings" => {
                "matching"
            }
            other if other == "short_answer" || other.ends_with("_completion") => "completion",
            _ => continue,
        };
        found.insert(tag);
    }
    ORDER
        .iter()
        .filter(|tag| found.contains(**tag))
        .map(|tag| (*tag).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn display_tags_follow_scoring_subtypes_and_do_not_reclassify_word_banks() {
        let payload = json!({"questionGroups": [
            {"kind":"matching", "bodyHtml":"Choose the correct heading from the list of headings"},
            {"kind":"matching", "bodyHtml":"Which paragraph contains the information?"},
            {"kind":"matching", "bodyHtml":"Complete the summary using the list of words"},
            {"kind":"matching", "bodyHtml":"Complete each sentence with the correct ending"},
            {"kind":"true_false_not_given"}, {"kind":"single_choice"}, {"kind":"single_choice"}
        ]});
        assert_eq!(
            classify_question_kinds(&payload),
            vec![
                "single_choice",
                "judgement",
                "completion",
                "heading_match",
                "paragraph_match",
                "matching"
            ]
        );
        assert!(classify_question_kinds(&json!({"pdfOnly":true})).is_empty());
    }
}
