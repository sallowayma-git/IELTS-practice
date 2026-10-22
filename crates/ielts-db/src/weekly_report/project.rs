//! The fact map the narrative writes against: a pure, deterministic projection
//! of the eight report blocks plus the two things only Soul knows (the exam
//! date). The model sees this map and nothing else; `{{f:ID}}` refers to it.
//!
//! Examples do not produce facts. An example is a route into a record, and its
//! label/detail are presentation text, not a number the page shows. Every fact
//! is a number (a quote fact would be a string, but no quote source exists yet).
//! Ids are semantic and stable: the same blocks always project the same map.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use ielts_domain::{BlockKind, FactFormat, FactProvenance, ReportBlock, WeeklyFact};
use serde_json::{json, Value};

/// How many rows of a ranked list become citable facts. A cap keeps the map
/// small enough for the prompt and stable when the list grows.
const MAX_QUESTION_TYPES: usize = 2;
const MAX_REPEATED_TYPES: usize = 2;
const MAX_COACH_KINDS: usize = 2;
const MAX_ESSAYS: usize = 2;
const MAX_PLAN_ITEMS: usize = 2;

/// Project every fact of a report.
///
/// `exam_date` is the Soul exam date; it is the only input not carried by a
/// block. `as_of` is the local day the report is written, used for the countdown.
pub fn project_weekly_facts(
    blocks: &[ReportBlock],
    exam_date: Option<NaiveDate>,
    as_of: NaiveDate,
) -> BTreeMap<String, WeeklyFact> {
    let mut facts = BTreeMap::new();
    let data = |kind: BlockKind| blocks.iter().find(|block| block.kind == kind).map(|block| &block.data);
    if let Some(volume) = data(BlockKind::Volume) {
        volume_facts(&mut facts, volume);
    }
    if let Some(accuracy) = data(BlockKind::Accuracy) {
        accuracy_facts(&mut facts, accuracy);
    }
    if let Some(types) = data(BlockKind::QuestionTypes) {
        question_type_facts(&mut facts, types);
    }
    if let Some(repeated) = data(BlockKind::RepeatedMisses) {
        repeated_miss_facts(&mut facts, repeated);
    }
    if let Some(redo) = data(BlockKind::RedoProgress) {
        redo_facts(&mut facts, redo);
    }
    if let Some(writing) = data(BlockKind::WritingBands) {
        writing_facts(&mut facts, writing);
    }
    if let Some(coach) = data(BlockKind::CoachSignals) {
        coach_facts(&mut facts, coach);
    }
    if let Some(plan) = data(BlockKind::NextWeekPlan) {
        plan_facts(&mut facts, plan);
    }
    if let Some(exam_date) = exam_date {
        let days = (exam_date - as_of).num_days();
        if days >= 0 {
            add(&mut facts, "exam.days", "距考试天数", json!(days), FactFormat::Number, "soul", default());
        }
    }
    facts
}

fn volume_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    let Some(reading) = integer(data, "readingAttempts") else { return };
    let Some(writing) = integer(data, "writingEssays") else { return };
    add(facts, "volume.reading", "本周阅读篇数", reading.clone(), FactFormat::Number, "volume", default());
    add(facts, "volume.writing", "本周作文篇数", writing.clone(), FactFormat::Number, "volume", default());
    add(
        facts,
        "volume.total",
        "本周练习总数",
        json!(reading.as_u64().unwrap_or(0) + writing.as_u64().unwrap_or(0)),
        FactFormat::Number,
        "volume",
        default(),
    );
    add_number(facts, "volume.days", "本周练习天数", data, "activeDays", FactFormat::Number, "volume", default());
    add_number(facts, "volume.minutes", "本周阅读时长", data, "minutes", FactFormat::Minutes, "volume", default());
    if let Some(previous) = data.get("previous").filter(|value| value.is_object()) {
        add_number(facts, "volume.previous.reading", "上周阅读篇数", previous, "readingAttempts", FactFormat::Number, "volume", default());
        add_number(facts, "volume.previous.writing", "上周作文篇数", previous, "writingEssays", FactFormat::Number, "volume", default());
    }
}

fn accuracy_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    for (id, label, key, format) in [
        ("accuracy.correct", "本周答对题数", "correct", FactFormat::Number),
        ("accuracy.answered", "本周作答题数", "answered", FactFormat::Number),
        ("accuracy.blank", "本周未作答题数", "blank", FactFormat::Number),
        ("accuracy.total", "本周阅读总题数", "total", FactFormat::Number),
        ("accuracy.rate", "本周正确率", "rate", FactFormat::Percent),
    ] {
        add_number(facts, id, label, data, key, format, "accuracy", default());
    }
    if let Some(previous) = data.get("previous").filter(|value| value.is_object()) {
        add_number(facts, "accuracy.previous.correct", "上周答对题数", previous, "correct", FactFormat::Number, "accuracy", default());
        add_number(facts, "accuracy.previous.answered", "上周作答题数", previous, "answered", FactFormat::Number, "accuracy", default());
    }
}

fn question_type_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    let rows = data.get("types").and_then(Value::as_array).into_iter().flatten();
    for row in rows.take(MAX_QUESTION_TYPES) {
        let Some(qtype) = row.get("qtype").and_then(Value::as_str) else { continue };
        let name = row.get("label").and_then(Value::as_str).unwrap_or(qtype);
        for (key, measure, format) in [
            ("wrong", "错题数", FactFormat::Number),
            ("answered", "作答题数", FactFormat::Number),
            ("rate", "正确率", FactFormat::Percent),
            ("passages", "失分题集数", FactFormat::Number),
        ] {
            add_number(
                facts,
                &format!("qtype.{qtype}.{key}"),
                &format!("「{name}」{measure}"),
                row,
                key,
                format,
                "question_types",
                assets(row),
            );
        }
    }
}

fn repeated_miss_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    let rows = data.get("acrossPassages").and_then(Value::as_array).into_iter().flatten();
    for row in rows.take(MAX_REPEATED_TYPES) {
        let Some(qtype) = row.get("qtype").and_then(Value::as_str) else { continue };
        let name = row.get("label").and_then(Value::as_str).unwrap_or(qtype);
        for (key, measure) in [("passages", "连续失分题集数"), ("wrong", "跨题集错题数")] {
            add_number(
                facts,
                &format!("repeated.{qtype}.{key}"),
                &format!("「{name}」{measure}"),
                row,
                key,
                FactFormat::Number,
                "repeated_misses",
                assets(row),
            );
        }
    }
    if let Some(row) = data.get("sameQuestion").and_then(Value::as_array).and_then(|rows| rows.first()) {
        let provenance = FactProvenance {
            asset_id: row.get("assetId").and_then(Value::as_str).map(str::to_owned),
            ..Default::default()
        };
        add_number(
            facts,
            "repeated.same.attempts",
            "同一道题最多的作答次数",
            row,
            "attempts",
            FactFormat::Number,
            "repeated_misses",
            provenance,
        );
    }
}

fn redo_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    for (id, label, key) in [
        ("redo.count", "本周重做篇数", "redos"),
        ("redo.fixed", "本周改对题数", "fixed"),
        ("redo.stillWrong", "本周仍错题数", "stillWrong"),
        ("redo.newlyWrong", "本周新错题数", "newlyWrong"),
    ] {
        add_number(facts, id, label, data, key, FactFormat::Number, "redo_progress", default());
    }
}

fn writing_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    // `count` is not in the block: it is the length of `essays`.
    if let Some(essays) = data.get("essays").and_then(Value::as_array) {
        add(facts, "writing.count", "本周作文篇数", json!(essays.len()), FactFormat::Number, "writing_bands", default());
        latest_essay_facts(facts, essays);
    }
    add_number(facts, "writing.average", "本周作文平均分", data, "average", FactFormat::Band, "writing_bands", default());
    if let Some(weakest) = data.get("weakest").filter(|value| value.is_object()) {
        let name = weakest.get("label").and_then(Value::as_str).unwrap_or("");
        add_number(
            facts,
            "writing.weakest.times",
            &format!("「{name}」偏低的次数"),
            weakest,
            "timesLowest",
            FactFormat::Number,
            "writing_bands",
            default(),
        );
    }
    if let Some(previous) = data.get("previous").filter(|value| value.is_object()) {
        add_number(facts, "writing.previous.count", "上周作文篇数", previous, "essays", FactFormat::Number, "writing_bands", default());
        add_number(facts, "writing.previous.average", "上周作文平均分", previous, "average", FactFormat::Band, "writing_bands", default());
    }
}

/// The last two essays, newest first, with the band and the lowest criteria the
/// block already shows. `essay1` is the latest, `essay2` the one before it.
fn latest_essay_facts(facts: &mut BTreeMap<String, WeeklyFact>, essays: &[Value]) {
    for (position, essay) in essays.iter().rev().take(MAX_ESSAYS).enumerate() {
        let when = if position == 0 { "最近一篇" } else { "上一篇" };
        let prefix = format!("writing.essay{}", position + 1);
        add_number(facts, &format!("{prefix}.band"), &format!("{when}作文总分"), essay, "band", FactFormat::Band, "writing_bands", default());
        let lowest = essay.get("lowest").and_then(Value::as_array).into_iter().flatten();
        for row in lowest {
            let Some(criterion) = row.get("criterion").and_then(Value::as_str) else { continue };
            let name = row.get("label").and_then(Value::as_str).unwrap_or(criterion);
            add_number(
                facts,
                &format!("{prefix}.{criterion}"),
                &format!("{when}作文{name}"),
                row,
                "score",
                FactFormat::Band,
                "writing_bands",
                default(),
            );
        }
    }
}

fn coach_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    let rows = data.get("feedback").and_then(Value::as_array).into_iter().flatten();
    for row in rows.take(MAX_COACH_KINDS) {
        let Some(kind) = row.get("kind").and_then(Value::as_str) else { continue };
        let name = row.get("label").and_then(Value::as_str).unwrap_or(kind);
        add_number(
            facts,
            &format!("coach.{kind}.count"),
            &format!("教练反馈「{name}」次数"),
            row,
            "count",
            FactFormat::Number,
            "coach_signals",
            default(),
        );
    }
    add_number(facts, "coach.reasks", "本周教练重问次数", data, "reasks", FactFormat::Number, "coach_signals", default());
    add_number(facts, "coach.attempts", "本周使用教练的练习数", data, "attempts", FactFormat::Number, "coach_signals", default());
}

fn plan_facts(facts: &mut BTreeMap<String, WeeklyFact>, data: &Value) {
    add_number(facts, "plan.totalMinutes", "本周计划总时长", data, "totalMinutes", FactFormat::Minutes, "next_week_plan", default());
    let items = data.get("items").and_then(Value::as_array).into_iter().flatten();
    for (position, item) in items.take(MAX_PLAN_ITEMS).enumerate() {
        add_number(
            facts,
            &format!("plan.item{}.minutes", position + 1),
            &format!("计划第 {} 项时长", position + 1),
            item,
            "minutes",
            FactFormat::Minutes,
            "next_week_plan",
            default(),
        );
    }
}

fn integer(data: &Value, key: &str) -> Option<Value> {
    data.get(key).and_then(Value::as_u64).map(|value| json!(value))
}

fn add_number(
    facts: &mut BTreeMap<String, WeeklyFact>,
    id: &str,
    label: &str,
    data: &Value,
    key: &str,
    format: FactFormat,
    source: &str,
    provenance: FactProvenance,
) {
    let Some(value) = data.get(key) else { return };
    let number = value
        .as_u64()
        .map(|value| json!(value))
        .or_else(|| value.as_i64().map(|value| json!(value)))
        .or_else(|| value.as_f64().map(|value| json!(value)));
    if let Some(number) = number {
        add(facts, id, label, number, format, source, provenance);
    }
}

fn add(
    facts: &mut BTreeMap<String, WeeklyFact>,
    id: &str,
    label: &str,
    value: Value,
    format: FactFormat,
    source: &str,
    provenance: FactProvenance,
) {
    if !value.is_number() {
        return;
    }
    facts.insert(
        id.to_owned(),
        WeeklyFact { value, label: label.to_owned(), format, source: source.to_owned(), provenance },
    );
}

fn assets(row: &Value) -> FactProvenance {
    FactProvenance {
        asset_ids: row
            .get("assetIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        ..Default::default()
    }
}

fn default() -> FactProvenance {
    FactProvenance::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ielts_domain::{BlockExample, PracticeLink};
    use serde_json::json;

    fn block(kind: BlockKind, data: Value) -> ReportBlock {
        ReportBlock::new(kind, data)
    }

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap()
    }

    fn full_blocks() -> Vec<ReportBlock> {
        vec![
            block(
                BlockKind::Volume,
                json!({
                    "readingAttempts": 4, "writingEssays": 2, "activeDays": 3, "minutes": 80,
                    "perDay": [], "previous": {"readingAttempts": 3, "writingEssays": 1, "activeDays": 4, "minutes": 70},
                }),
            ),
            block(
                BlockKind::Accuracy,
                json!({
                    "correct": 9, "answered": 12, "blank": 1, "total": 13, "rate": 0.75,
                    "perDay": [], "previous": {"correct": 6, "answered": 10, "rate": 0.6},
                }),
            ),
            block(
                BlockKind::QuestionTypes,
                json!({"types": [
                    {"qtype": "tfng", "label": "判断题", "wrong": 4, "answered": 8, "rate": 0.5, "passages": 2, "assetIds": ["p1", "p2"]},
                    {"qtype": "matching_headings", "label": "段落大意配对", "wrong": 2, "answered": 5, "rate": 0.6, "passages": 2, "assetIds": ["p1", "p3"]},
                    {"qtype": "short_answer", "label": "简答题", "wrong": 1, "answered": 2, "rate": 0.5, "passages": 1, "assetIds": ["p2"]},
                ]}),
            ),
            block(
                BlockKind::RepeatedMisses,
                json!({
                    "acrossPassages": [
                        {"qtype": "tfng", "label": "判断题", "passages": 2, "wrong": 4, "assetIds": ["p1", "p2"]},
                        {"qtype": "matching_headings", "label": "段落大意配对", "passages": 2, "wrong": 2, "assetIds": ["p1", "p3"]},
                    ],
                    "sameQuestion": [{"assetId": "p2", "title": "Bees", "question": "q5", "attempts": 3}],
                }),
            ),
            block(
                BlockKind::RedoProgress,
                json!({"redos": 2, "fixed": 3, "stillWrong": 1, "newlyWrong": 2, "items": []}),
            ),
            block(
                BlockKind::WritingBands,
                json!({
                    "essays": [
                        {"day": "2026-10-06", "taskType": "task2", "band": 6.0, "lowest": [
                            {"criterion": "grammar", "label": "语法", "score": 5.5},
                            {"criterion": "coherence", "label": "连贯与衔接", "score": 6.0},
                        ]},
                        {"day": "2026-10-09", "taskType": "task2", "band": 6.5, "lowest": [
                            {"criterion": "grammar", "label": "语法", "score": 6.0},
                            {"criterion": "lexical", "label": "词汇资源", "score": 6.0},
                        ]},
                    ],
                    "average": 6.3, "best": 6.5,
                    "weakest": {"criterion": "grammar", "label": "语法", "timesLowest": 2},
                    "previous": {"essays": 1, "average": 5.5},
                }),
            ),
            block(
                BlockKind::CoachSignals,
                json!({"feedback": [
                    {"kind": "need_example", "label": "需要例子", "count": 3},
                    {"kind": "too_long", "label": "太长", "count": 2},
                    {"kind": "thumbs_up", "label": "有帮助", "count": 1},
                ], "reasks": 4, "attempts": 2}),
            ),
            block(
                BlockKind::NextWeekPlan,
                json!({"items": [
                    {"skillKey": "reading.tfng", "minutes": 15},
                    {"skillKey": "writing.coherence", "minutes": 10},
                    {"skillKey": "reading.matching_headings", "minutes": 5},
                ], "totalMinutes": 30}),
            ),
        ]
    }

    #[test]
    fn every_block_projects_its_ranked_rows_with_semantic_ids() {
        let facts = project_weekly_facts(&full_blocks(), None, day(11));
        let ids: Vec<&str> = facts.keys().map(String::as_str).collect();
        for id in [
            "volume.reading",
            "volume.previous.reading",
            "accuracy.blank",
            "accuracy.previous.correct",
            "qtype.tfng.rate",
            "qtype.matching_headings.passages",
            "repeated.tfng.wrong",
            "repeated.same.attempts",
            "redo.stillWrong",
            "writing.essay1.band",
            "writing.essay2.coherence",
            "writing.weakest.times",
            "coach.need_example.count",
            "plan.item2.minutes",
        ] {
            assert!(facts.contains_key(id), "missing {id}");
        }
        // Caps: the third type, third coach kind and third plan item are not citable.
        assert!(!facts.contains_key("qtype.short_answer.wrong"));
        assert!(!facts.contains_key("plan.item3.minutes"));
        assert!(!facts.contains_key("coach.thumbs_up.count"));
        assert!(!ids.iter().any(|id| id.contains("[")), "ids stay semantic, not array paths");
    }

    #[test]
    fn values_labels_formats_and_provenance_are_the_projection() {
        let facts = project_weekly_facts(&full_blocks(), Some(day(25)), day(11));
        assert_eq!(facts["volume.reading"].value, json!(4));
        assert_eq!(facts["volume.total"].value, json!(6));
        assert_eq!(facts["volume.minutes"].format, FactFormat::Minutes);
        assert_eq!(facts["accuracy.rate"].value, json!(0.75));
        assert_eq!(facts["accuracy.rate"].format, FactFormat::Percent);
        assert_eq!(facts["qtype.tfng.wrong"].label, "「判断题」错题数");
        assert_eq!(facts["qtype.tfng.wrong"].provenance.asset_ids, ["p1", "p2"]);
        assert_eq!(facts["writing.average"].format, FactFormat::Band);
        assert_eq!(facts["writing.essay1.grammar"].label, "最近一篇作文语法");
        assert_eq!(facts["writing.essay1.grammar"].value, json!(6.0));
        assert_eq!(facts["writing.essay2.band"].label, "上一篇作文总分");
        assert_eq!(facts["writing.essay2.band"].value, json!(6.0));
        assert_eq!(facts["repeated.same.attempts"].provenance.asset_id.as_deref(), Some("p2"));
        assert_eq!(facts["exam.days"].source, "soul");
    }

    #[test]
    fn exam_countdown_is_a_soul_fact_and_absent_once_past() {
        let facts = project_weekly_facts(&full_blocks(), Some(day(25)), day(11));
        assert_eq!(facts["exam.days"].value, json!(14));
        assert_eq!(facts["exam.days"].format, FactFormat::Number);
        assert!(project_weekly_facts(&full_blocks(), Some(day(11)), day(11)).contains_key("exam.days"));
        assert!(!project_weekly_facts(&full_blocks(), Some(day(10)), day(11)).contains_key("exam.days"));
        assert!(!project_weekly_facts(&full_blocks(), None, day(11)).contains_key("exam.days"));
    }

    #[test]
    fn a_missing_or_empty_block_projects_nothing_from_it() {
        let facts = project_weekly_facts(&[], Some(day(25)), day(11));
        assert_eq!(facts.keys().map(String::as_str).collect::<Vec<_>>(), ["exam.days"]);
        let facts = project_weekly_facts(&[block(BlockKind::Volume, json!({}))], None, day(11));
        assert!(facts.is_empty());
    }

    #[test]
    fn examples_do_not_create_facts() {
        let mut with_example = block(BlockKind::Accuracy, json!({"correct": 3, "answered": 5, "rate": 0.6}));
        with_example.examples = vec![BlockExample {
            label: "「Bees」q5".to_owned(),
            detail: Some("正确 3/9".to_owned()),
            link: PracticeLink::reading_review("p1", "a1"),
        }];
        let projected = project_weekly_facts(std::slice::from_ref(&with_example), None, day(11));
        assert!(!projected.values().any(|fact| fact.value == json!(9)));
        assert_eq!(projected["accuracy.correct"].value, json!(3));
    }

    #[test]
    fn projection_is_deterministic() {
        let first = project_weekly_facts(&full_blocks(), Some(day(25)), day(11));
        let second = project_weekly_facts(&full_blocks(), Some(day(25)), day(11));
        assert_eq!(first, second);
        assert_eq!(serde_json::to_string(&first).unwrap(), serde_json::to_string(&second).unwrap());
    }
}
