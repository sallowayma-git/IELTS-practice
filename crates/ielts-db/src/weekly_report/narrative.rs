//! The model's narrative is untrusted prose. Every number must be a
//! `{{f:ID}}` placeholder that resolves to a real fact; a literal quote may only
//! be a `{{q:ID}}` reference. The host filters sentence by sentence and records
//! why a sentence was dropped. It never writes prose of its own: a narrative
//! without a usable body is a failed narrative, not a fallback.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use ielts_domain::{
    contains_forbidden_inference_domain, contains_security_marker, NarrativeItem,
    NarrativeTarget, NarrativeValidation, NarrativeValidationReport, NarrativeViolation,
    WeeklyFact, WeeklyNarrative, WeeklyQuestion, WEEKLY_TITLE_CHARS,
};
use regex::Regex;
use serde_json::{Map, Value};

/// At most this many body paragraphs.
const MAX_BODY: usize = 3;
/// At most this many lines per actionable group.
const MAX_ITEMS: usize = 4;
/// A paragraph longer than this is split into dropped sentences.
const MAX_PARAGRAPH_CHARS: usize = 1_200;

/// The result of the final validation pass.
pub struct NarrativeOutcome {
    pub narrative: WeeklyNarrative,
    /// Whether the narrative has a body the page can show. A false outcome makes
    /// the run `NarrativeFailed`; the host never fabricates a body.
    pub usable: bool,
}

/// Validate one raw digest against the report's facts. `profile` supplies the
/// missing-profile question; `as_of` is the local day the report is written.
pub fn validate_narrative(
    raw: &Value,
    facts: &BTreeMap<String, WeeklyFact>,
    profile: &Map<String, Value>,
    as_of: NaiveDate,
) -> NarrativeOutcome {
    let facts = serde_json::to_value(facts).unwrap_or(Value::Null);
    let mut violations = Vec::new();

    let body: Vec<String> = raw
        .get("body")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_BODY)
        .enumerate()
        .filter_map(|(index, paragraph)| {
            let paragraph = filter_paragraph(
                paragraph.as_str()?,
                &facts,
                false,
                &format!("body/{index}"),
                &mut violations,
            );
            (!paragraph.is_empty()).then_some(paragraph)
        })
        .collect();

    let list = |key: &str, path: &str, violations: &mut Vec<NarrativeViolation>| {
        clean_items(raw.get(key), &facts, path, key == "nextSteps", violations)
    };
    let changes = list("changes", "changes", &mut violations);
    let next_steps = list("nextSteps", "nextSteps", &mut violations);
    let strengths = list("strengths", "strengths", &mut violations);
    let weaknesses = list("weaknesses", "weaknesses", &mut violations);

    let title = raw
        .get("title")
        .and_then(Value::as_str)
        .filter(|title| !title.contains("{{"))
        .map(|title| clean_text(title, &facts))
        .unwrap_or_default()
        .chars()
        .take(WEEKLY_TITLE_CHARS)
        .collect::<String>();

    let first_body_lost = violations
        .iter()
        .any(|violation| violation.path == "body/0" && violation.sentence == 0);
    let final_report = NarrativeValidationReport {
        dropped_sentences: violations.len(),
        needs_repair: violations.len() > 2 || first_body_lost,
        violations,
    };
    let usable = !body.is_empty();
    NarrativeOutcome {
        narrative: WeeklyNarrative {
            title,
            body,
            changes,
            next_steps,
            strengths,
            weaknesses,
            ask_user: weekly_question(profile, as_of),
            validation: NarrativeValidation { final_report },
        },
        usable,
    }
}

/// The question the narrative asks when the profile cannot support planning.
fn weekly_question(profile: &Map<String, Value>, as_of: NaiveDate) -> Option<WeeklyQuestion> {
    let address = if profile.get("soul.address").and_then(Value::as_str) == Some("您") { "您" } else { "你" };
    if profile.get("soul.targetBand").and_then(Value::as_f64).is_none() {
        return Some(WeeklyQuestion {
            key: "soul.targetBand".to_owned(),
            question: format!("为了把练习安排得更贴近目标，{address}希望考到多少分？"),
        });
    }
    let exam = profile
        .get("soul.examDate")
        .and_then(Value::as_str)
        .and_then(|text| NaiveDate::parse_from_str(text, "%Y-%m-%d").ok());
    if exam.is_none_or(|exam| exam <= as_of) {
        return Some(WeeklyQuestion {
            key: "soul.examDate".to_owned(),
            question: format!("为了按剩余时间安排练习，{address}接下来计划哪天考试？"),
        });
    }
    None
}

fn clean_items(
    raw: Option<&Value>,
    facts: &Value,
    path: &str,
    counts_allowed: bool,
    violations: &mut Vec<NarrativeViolation>,
) -> Vec<NarrativeItem> {
    raw.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_ITEMS)
        .enumerate()
        .filter_map(|(index, item)| {
            let text = item.as_str().or_else(|| item.get("text").and_then(Value::as_str))?;
            let text = filter_paragraph(text, facts, counts_allowed, &format!("{path}/{index}"), violations);
            if text.is_empty() {
                return None;
            }
            Some(NarrativeItem { text, target: item.get("target").and_then(valid_target) })
        })
        .collect()
}

fn valid_target(target: &Value) -> Option<NarrativeTarget> {
    let kind = target.get("type").and_then(Value::as_str)?;
    let key = target.get("key").and_then(Value::as_str)?;
    if !matches!(kind, "kind" | "asset" | "writing")
        || key.is_empty()
        || key.len() > 160
        || !key.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return None;
    }
    // The page routes a writing target only for task1/task2
    // (`weeklyTarget` in apps/writing-vue/src/modules/notebook/weekly.js).
    // `kind` and `asset` stay open: the frontend accepts any well-formed key.
    if kind == "writing" && !matches!(key, "task1" | "task2") {
        return None;
    }
    Some(NarrativeTarget { kind: kind.to_owned(), key: key.to_owned() })
}

/// Filter a single paragraph, keeping the sentences that pass. A paragraph where
/// more than half the sentences fail is dropped whole; a survivor is never
/// truncated mid-sentence.
fn filter_paragraph(
    text: &str,
    facts: &Value,
    counts_allowed: bool,
    path: &str,
    violations: &mut Vec<NarrativeViolation>,
) -> String {
    let sentences: Vec<&str> = text
        .split_inclusive(['。', '！', '？', '!', '?', '\n'])
        .filter(|sentence| !sentence.trim().is_empty())
        .collect();
    let before = violations.len();
    let mut kept = String::new();
    for (sentence, raw) in sentences.iter().enumerate() {
        let clean = strip_short_quotes(raw);
        let reason = violation(&clean, facts, counts_allowed)
            .or_else(|| (kept.chars().count() + clean.chars().count() > MAX_PARAGRAPH_CHARS).then_some("paragraph_too_long"));
        match reason {
            Some(code) => violations.push(NarrativeViolation {
                path: path.to_owned(),
                sentence,
                code: code.to_owned(),
            }),
            None => kept.push_str(&clean),
        }
    }
    if (violations.len() - before) * 2 > sentences.len() {
        return String::new();
    }
    kept.trim().to_owned()
}

/// The title goes through the same character checks but is never a paragraph.
fn clean_text(text: &str, facts: &Value) -> String {
    filter_paragraph(text, facts, false, "title", &mut Vec::new())
}

/// Remove short verbatim quotes from the prose; the words stay, the quotation
/// marks do not. A long quote cannot hide behind the limit.
fn strip_short_quotes(text: &str) -> String {
    let quotes = Regex::new(r#"“([^“”\n]{0,12})”|「([^「」\n]{0,12})」|"([^"\n]{0,12})""#).unwrap();
    quotes
        .replace_all(text, |captures: &regex::Captures<'_>| {
            captures.iter().skip(1).flatten().next().map(|matched| matched.as_str()).unwrap_or("").to_owned()
        })
        .into_owned()
}

fn violation(text: &str, facts: &Value, counts_allowed: bool) -> Option<&'static str> {
    if contains_security_marker(text) || contains_forbidden_inference_domain(text) {
        return Some("unsafe_text");
    }
    // The model can echo internal record ids from pack facts/lines; they are
    // storage keys, never prose the page may show.
    if contains_id_token(text) {
        return Some("internal_id");
    }
    let references = Regex::new(r"\{\{([fq]):([^{}]+)\}\}").unwrap();
    for captures in references.captures_iter(text) {
        let fact = &facts[&captures[2]];
        let valid = if captures[1].eq("f") {
            fact.get("value").is_some_and(Value::is_number)
        } else {
            fact.get("value").is_some_and(Value::is_string)
        };
        if !valid {
            return Some("unknown_reference");
        }
    }
    // "band X" without the fact placeholder is a bare claim; the placeholder is
    // the only way to write a band.
    let with_band = Regex::new(r"(?i)\bband\s*\{\{f:[^{}]+\}\}").unwrap();
    let without_band = with_band.replace_all(text, " ");
    if Regex::new(r"(?i)\bband\b").unwrap().is_match(&without_band) {
        return Some("band_requires_fact");
    }
    let plain = references.replace_all(text, " ");
    if plain.contains("{{") || plain.contains("}}") {
        return Some("unpaired_reference");
    }
    if plain.contains(['“', '”', '「', '」', '"']) {
        return Some("unverified_long_quote");
    }
    // Task, Part, Passage, Section, Q14-16, 第3题 are identifiers, not counts.
    let numbering = Regex::new(
        r"(?i)(?:\b(?:task|part|passage|section)\s*\d+(?:\s*[-–]\s*\d+)?\b|\bq\d+(?:\s*[-–]\s*q?\d+)?\b|第\d+(?:题|段|篇))",
    )
    .unwrap();
    let plain = numbering.replace_all(&plain, " ");
    if plain.chars().any(|c| c.is_ascii_digit()) {
        return Some("literal_number");
    }
    if !counts_allowed
        && Regex::new(r"[一二两三四五六七八九十几]+(?:多|余)?[次套篇道题分]").unwrap().is_match(&plain)
    {
        return Some("literal_chinese_count");
    }
    None
}

/// Internal id prefixes that must never reach the page as prose.
const ID_PREFIXES: [&str; 4] = ["obs-", "mem-", "drmrun-", "att-"];

fn contains_id_token(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    ID_PREFIXES.iter().any(|prefix| lower.contains(prefix)) || contains_uuid(text)
}

/// Whether any run of ASCII alphanumerics and hyphens holds a hyphenated UUID.
fn contains_uuid(text: &str) -> bool {
    text.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '-'))
        .filter(|run| run.len() >= 36)
        .any(|run| (0..=run.len() - 36).any(|start| is_uuid(&run[start..start + 36])))
}

fn is_uuid(candidate: &str) -> bool {
    candidate.char_indices().all(|(index, ch)| match index {
        8 | 13 | 18 | 23 => ch == '-',
        _ => ch.is_ascii_hexdigit(),
    })
}

/// Whether a digest has a body after filtering. The preflight path uses this to
/// decide whether to repair before writing anything.
pub fn has_usable_body(raw: &Value, facts: &BTreeMap<String, WeeklyFact>) -> bool {
    let facts = serde_json::to_value(facts).unwrap_or(Value::Null);
    raw.get("body")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_BODY)
        .any(|paragraph| {
            paragraph
                .as_str()
                .map(|text| !filter_paragraph(text, &facts, false, "body", &mut Vec::new()).is_empty())
                .unwrap_or(false)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ielts_domain::{FactFormat, FactProvenance};
    use serde_json::json;

    fn facts() -> BTreeMap<String, WeeklyFact> {
        let mut facts = BTreeMap::new();
        for (id, label, value) in [
            ("volume.reading", "本周阅读篇数", json!(4)),
            ("accuracy.rate", "本周正确率", json!(0.75)),
            ("accuracy.correct", "本周答对题数", json!(9)),
        ] {
            facts.insert(
                id.to_owned(),
                WeeklyFact {
                    value,
                    label: label.to_owned(),
                    format: FactFormat::Number,
                    source: "accuracy".to_owned(),
                    provenance: FactProvenance::default(),
                },
            );
        }
        facts
    }

    fn profile() -> Map<String, Value> {
        let mut profile = Map::new();
        profile.insert("soul.targetBand".to_owned(), json!(7.0));
        profile.insert("soul.examDate".to_owned(), json!("2099-06-01"));
        profile
    }

    fn validate(raw: Value) -> NarrativeOutcome {
        validate_narrative(&raw, &facts(), &profile(), NaiveDate::from_ymd_opt(2026, 10, 11).unwrap())
    }

    #[test]
    fn admits_the_references_the_facts_define() {
        let outcome = validate(json!({
            "title": "把错题读慢一点",
            "body": ["这周读了 {{f:volume.reading}} 篇。", "正确率 {{f:accuracy.rate}}，答对 {{f:accuracy.correct}} 题。"],
            "changes": [{"text": "重做错题。", "target": {"type": "asset", "key": "p1"}}],
            "nextSteps": ["再练两组题。"],
        }));
        assert!(outcome.usable);
        assert_eq!(outcome.narrative.title, "把错题读慢一点");
        assert_eq!(outcome.narrative.body.len(), 2);
        assert_eq!(outcome.narrative.changes[0].target.as_ref().unwrap().key, "p1");
        assert_eq!(outcome.narrative.next_steps[0].text, "再练两组题。");
        assert_eq!(outcome.narrative.validation.final_report.dropped_sentences, 0);
    }

    #[test]
    fn literal_numbers_are_dropped_but_known_placeholders_survive() {
        let outcome = validate(json!({
            "body": ["这周做了 6 篇。这周读了 {{f:volume.reading}} 篇。"],
        }));
        assert_eq!(outcome.narrative.body, vec!["这周读了 {{f:volume.reading}} 篇。"]);
        assert_eq!(outcome.narrative.validation.final_report.violations[0].code, "literal_number");
        // More than half the paragraph was dropped; it goes whole.
        let outcome = validate(json!({"body": ["做了 6 篇。错了 9 题。读了 {{f:volume.reading}} 篇。"]}));
        assert!(!outcome.usable);
    }

    #[test]
    fn chinese_counts_are_banned_in_the_body_but_allowed_in_next_steps() {
        let outcome = validate(json!({
            "body": ["这周做了四篇。这周读了 {{f:volume.reading}} 篇。"],
            "nextSteps": ["再做两套题。"],
        }));
        assert_eq!(outcome.narrative.body, vec!["这周读了 {{f:volume.reading}} 篇。"]);
        assert_eq!(outcome.narrative.next_steps[0].text, "再做两套题。");
        let outcome = validate(json!({"body": ["这周做了四篇。"]}));
        assert!(outcome.narrative.validation.final_report.violations.iter().any(|v| v.code == "literal_chinese_count"));
    }

    #[test]
    fn identifiers_are_not_numbers() {
        let outcome = validate(json!({
            "body": ["Task 2 的 Q14-16 和第3题都练了。"],
        }));
        assert!(outcome.usable);
        assert!(outcome.narrative.validation.final_report.violations.is_empty());
    }

    #[test]
    fn unknown_references_bands_and_unpaired_braces_are_refused() {
        for (sentence, code) in [
            ("这周做了 {{f:missing}} 篇。", "unknown_reference"),
            ("band 7。", "band_requires_fact"),
            ("band {{f:volume.reading}}。", ""),
            ("这周读了 {{f:volume.reading}} 篇。", ""),
            ("这周读了 {{f:volume.reading} 篇。", "unpaired_reference"),
            ("他说「这句话虽然不长但是超过了十二个字」。", "unverified_long_quote"),
            ("可能有 ADHD 倾向。", "unsafe_text"),
        ] {
            let outcome = validate(json!({"body": [sentence]}));
            if code.is_empty() {
                assert!(outcome.usable, "{sentence}");
            } else {
                let codes: Vec<&str> =
                    outcome.narrative.validation.final_report.violations.iter().map(|v| v.code.as_str()).collect();
                assert!(codes.contains(&code), "{sentence}: {codes:?}");
            }
        }
    }

    #[test]
    fn short_quotes_are_unwrapped_before_validation() {
        let outcome = validate(json!({"body": ["答案写的是「Bees」，这一处记下来了。"]}));
        assert_eq!(outcome.narrative.body, vec!["答案写的是Bees，这一处记下来了。"]);
    }

    #[test]
    fn titles_are_filtered_and_cut_to_sixteen_characters() {
        let outcome = validate(json!({"title": "这周做了 6 篇阅读和两篇作文", "body": ["读了 {{f:volume.reading}} 篇。"]}));
        assert!(outcome.narrative.title.is_empty());
        let outcome = validate(json!({"title": "一二三四五六七八九十一二三四五六七", "body": ["读了 {{f:volume.reading}} 篇。"]}));
        assert_eq!(outcome.narrative.title.chars().count(), 16);
        let outcome = validate(json!({"title": "{{f:volume.reading}} 篇", "body": ["读了 {{f:volume.reading}} 篇。"]}));
        assert!(outcome.narrative.title.is_empty());
    }

    #[test]
    fn groups_are_capped_and_targets_are_restricted() {
        let changes = json!((0..6).map(|_| json!({"text": "重做错题。", "target": {"type": "route", "key": "x"}})).collect::<Vec<_>>());
        let outcome = validate(json!({"body": ["读了 {{f:volume.reading}} 篇。"], "changes": changes}));
        assert_eq!(outcome.narrative.changes.len(), 4);
        assert!(outcome.narrative.changes.iter().all(|item| item.target.is_none()));
        let outcome = validate(json!({
            "body": ["读了 {{f:volume.reading}} 篇。"],
            "strengths": [{"text": "回看错题。", "target": {"type": "kind", "key": "reading.tfng"}}],
        }));
        assert_eq!(outcome.narrative.strengths[0].target.as_ref().unwrap().kind, "kind");
    }

    #[test]
    fn writing_targets_route_only_task1_and_task2() {
        for (key, admitted) in [
            ("task1", true),
            ("task2", true),
            ("writing", false),
            ("task3", false),
            ("task2x", false),
        ] {
            let outcome = validate(json!({
                "body": ["读了 {{f:volume.reading}} 篇。"],
                "changes": [{"text": "重做错题。", "target": {"type": "writing", "key": key}}],
            }));
            assert_eq!(outcome.narrative.changes.len(), 1, "{key}");
            assert_eq!(outcome.narrative.changes[0].target.is_some(), admitted, "{key}");
        }
        // `kind` and `asset` stay open: the frontend accepts any well-formed key.
        let outcome = validate(json!({
            "body": ["读了 {{f:volume.reading}} 篇。"],
            "changes": [
                {"text": "重做错题。", "target": {"type": "kind", "key": "reading.tfng"}},
                {"text": "回看原文。", "target": {"type": "asset", "key": "passage-1"}},
            ],
        }));
        assert!(outcome.narrative.changes.iter().all(|item| item.target.is_some()));
    }

    #[test]
    fn fact_citing_sentences_with_internal_record_ids_are_dropped() {
        for token in [
            "obs-abc",
            "mem-xyz",
            "att-abc",
            "drmrun-week",
            "3f2b8c1e-9a4d-4e2f-8b1a-0c9d7e6f5a4b",
        ] {
            let sentence = format!("这周读了 {{{{f:volume.reading}}}} 篇，参考 {token}。");
            let outcome = validate(json!({"body": [sentence]}));
            assert!(!outcome.usable, "{token}");
            let codes: Vec<&str> = outcome
                .narrative
                .validation
                .final_report
                .violations
                .iter()
                .map(|violation| violation.code.as_str())
                .collect();
            assert_eq!(codes, ["internal_id"], "{token}");
        }
    }

    #[test]
    fn the_ask_user_question_comes_from_the_profile() {
        let mut missing = profile();
        missing.remove("soul.targetBand");
        let outcome = validate_narrative(&json!({"body": ["读了 {{f:volume.reading}} 篇。"]}), &facts(), &missing, NaiveDate::from_ymd_opt(2026, 10, 11).unwrap());
        assert_eq!(outcome.narrative.ask_user.unwrap().key, "soul.targetBand");

        let mut past = profile();
        past.insert("soul.examDate".to_owned(), json!("2026-10-01"));
        let outcome = validate_narrative(&json!({"body": ["读了 {{f:volume.reading}} 篇。"]}), &facts(), &past, NaiveDate::from_ymd_opt(2026, 10, 11).unwrap());
        assert_eq!(outcome.narrative.ask_user.unwrap().key, "soul.examDate");

        let outcome = validate(json!({"body": ["读了 {{f:volume.reading}} 篇。"]}));
        assert!(outcome.narrative.ask_user.is_none());
    }

    #[test]
    fn a_body_with_nothing_left_is_not_usable() {
        assert!(!validate(json!({"body": ["做了 6 篇。"]})).usable);
        assert!(!validate(json!({"body": []})).usable);
        assert!(!has_usable_body(&json!({"body": ["做了 6 篇。"]}), &facts()));
        assert!(has_usable_body(&json!({"body": ["读了 {{f:volume.reading}} 篇。"]}), &facts()));
    }

    #[test]
    fn needs_repair_when_more_than_two_sentences_are_dropped_or_the_first_is_lost() {
        let outcome = validate(json!({
            "body": ["做了 6 篇。错了 9 题。读了 {{f:volume.reading}} 篇。"],
        }));
        assert!(outcome.narrative.validation.final_report.needs_repair);
        let outcome = validate(json!({
            "body": ["这周读了 {{f:volume.reading}} 篇，答对 {{f:accuracy.correct}} 题。", "做了 6 篇。"],
        }));
        assert_eq!(outcome.narrative.validation.final_report.dropped_sentences, 1);
        assert!(!outcome.narrative.validation.final_report.needs_repair);
    }
}
