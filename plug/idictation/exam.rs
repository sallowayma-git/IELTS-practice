//! Source exam contract. No network, source AI analysis or local regrading.
//! Runtime authorization and official-result reconciliation are separate.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

#[path = "exam_markup.rs"]
mod markup;
#[path = "exam_result.rs"]
pub mod result;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Subject {
    Reading,
    Listening,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub key: String,
    pub part_id: u64,
    pub group_id: u64,
    pub source_id: u64,
    pub source_type: u64,
    pub number: u64,
    pub choices: Vec<String>,
    pub grouped: bool,
}

pub struct Exam {
    pub subject: Subject,
    pub test_id: String,
    pub fingerprint: String,
    pub payload: Value,
    pub questions: Vec<Question>,
    /// Kept out of the practice payload. Evidence for the local harness only.
    pub official_answers: Map<String, Value>,
    pub transcript: Vec<Value>,
    pub annotations: Value,
}

pub(super) fn rows<'a>(v: &'a Value, key: &str) -> Result<&'a [Value]> {
    v[key]
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| format!("爱听写真题缺少 {key}"))
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_default()
}
pub(super) fn number(v: &Value, key: &str) -> Result<u64> {
    v[key]
        .as_u64()
        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
        .ok_or_else(|| format!("爱听写真题 {key} 标识无效"))
}
fn judgement(value: &str) -> Result<&str> {
    match value {
        "T" | "TRUE" => Ok("T"),
        "F" | "FALSE" => Ok("F"),
        "Y" | "YES" => Ok("Y"),
        "N" | "NO" => Ok("N"),
        "NG" | "NOT GIVEN" => Ok("NG"),
        _ => Err("爱听写判断题选项未知".into()),
    }
}
fn options(value: &Value, judge: bool) -> Result<Vec<(String, String)>> {
    let rows = value.as_array().ok_or("爱听写选择题缺少选项")?;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        let raw = text(row, "title");
        let code = if judge { judgement(raw)? } else { raw };
        if code.is_empty() || !seen.insert(code.to_owned()) {
            return Err("爱听写选项标识重复或为空".into());
        }
        out.push((code.into(), text(row, "content").into()));
    }
    if out.is_empty() {
        return Err("爱听写选择题没有选项".into());
    }
    Ok(out)
}
fn matrix_options(part: &Value, group: &Value) -> Result<Vec<(String, String)>> {
    let shared = group["collect_option"]["list"]
        .as_array()
        .filter(|a| !a.is_empty());
    let values = shared
        .or_else(|| part["content"]["order_ary"].as_array())
        .ok_or("爱听写矩阵题缺少列")?;
    let mut seen = HashSet::new();
    values
        .iter()
        .map(|v| {
            let code = v
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("爱听写矩阵列格式未知")?;
            if !seen.insert(code) {
                return Err("爱听写矩阵列重复".into());
            }
            Ok((code.to_owned(), code.to_owned()))
        })
        .collect()
}

#[derive(Clone, Copy)]
enum Control {
    Text,
    Radio,
    Select,
    Group,
}
fn kind(subject: Subject, t: u64) -> Result<(&'static str, Control, bool)> {
    use Control::*;
    match (subject, t) {
        (Subject::Listening, 1) => Ok(("single_choice", Radio, false)),
        (Subject::Listening, 2) => Ok(("multi_choice", Group, false)),
        (Subject::Listening, 5) => Ok(("sentence_completion", Text, true)),
        (Subject::Listening, 8) => Ok(("matching", Select, false)),
        (Subject::Reading, 1) => Ok(("true_false_not_given", Radio, false)),
        (Subject::Reading, 2) => Ok(("matching_features", Select, false)),
        (Subject::Reading, 3) => Ok(("matching_information", Radio, false)),
        (Subject::Reading, 5) => Ok(("single_choice", Radio, false)),
        (Subject::Reading, 8) => Ok(("sentence_completion", Text, true)),
        (Subject::Reading, 10) => Ok(("summary_completion", Select, true)),
        _ => Err(format!("爱听写真题类型 {t} 尚未完成转换核验")),
    }
}

pub fn convert(subject: Subject, expected_test: &str, source: &Value) -> Result<Exam> {
    convert_scope(subject, expected_test, source, None)
}

pub(super) fn convert_listening_part(expected_id: &str, source: &Value, section: usize) -> Result<Exam> {
    if !(1..=4).contains(&section) {
        return Err("机经听力 Part 编号无效".into());
    }
    convert_scope(Subject::Listening, expected_id, source, Some(section))
}

fn convert_scope(subject: Subject, expected_test: &str, source: &Value, single_section: Option<usize>) -> Result<Exam> {
    let test_id = number(source, "test_id")?.to_string();
    if test_id != expected_test {
        return Err("爱听写真题套卷身份不一致".into());
    }
    let parts = rows(source, "parts")?;
    let expected_parts = if single_section.is_some() { 1 } else if subject == Subject::Reading { 3 } else { 4 };
    if parts.len() != expected_parts {
        return Err("爱听写整套题目不完整".into());
    }
    let mut questions = Vec::new();
    let mut groups = Vec::new();
    let mut blocks = Vec::new();
    let mut display = Map::new();
    let mut official_answers = Map::new();
    let mut transcript = Vec::new();
    let mut seen_parts = HashSet::new();
    let mut seen_groups = HashSet::new();
    let mut seen_ids = HashSet::new();
    let mut seen_numbers = HashSet::new();
    for (index, part) in parts.iter().enumerate() {
        let section = single_section.unwrap_or(index + 1);
        markup::reject_image(part)?;
        let part_id = number(part, "paper_id")?;
        if !seen_parts.insert(part_id) {
            return Err("爱听写真题Part重复".into());
        }
        if subject == Subject::Reading {
            blocks.push(markup::passage(&part["content"], index + 1)?)
        }
        if subject == Subject::Listening {
            let sentences = rows(part, "content")?;
            if sentences.is_empty() {
                return Err("爱听写听力原文缺失".into());
            }
            transcript.push(json!({"section":section,"sentences":sentences.iter().map(|s|json!({
                "text":text(s,"en_text"),"translation":text(s,"cn_text"),"startMs":s["start_time"],"endMs":s["end_time"]
            })).collect::<Vec<_>>()}));
        }
        let mut part_numbers = Vec::new();
        for group in rows(part, "question")? {
            let group_id = number(group, "group_id")?;
            if !seen_groups.insert(group_id) {
                return Err("爱听写真题组重复".into());
            }
            let source_type = number(group, "type")?;
            let (mut group_kind, control, embedded) = kind(subject, source_type)?;
            let judge = subject == Subject::Reading && source_type == 1;
            let list = rows(group, "list")?;
            if list.is_empty() {
                return Err("爱听写真题组为空".into());
            }
            let shared = match control {
                Control::Group | Control::Select => {
                    options(&group["collect_option"]["list"], false)?
                }
                _ if subject == Subject::Reading && source_type == 3 => {
                    matrix_options(part, group)?
                }
                _ => Vec::new(),
            };
            let mut keys = Vec::new();
            let mut controls = HashMap::new();
            let mut body = String::new();
            markup::reject_image(group)?;
            for item in list {
                markup::reject_image(item)?;
                let source_id = number(item, "id")?;
                let n = number(item, "number")?;
                if !seen_ids.insert(source_id) || !seen_numbers.insert(n) || n > 40 {
                    return Err("爱听写真题题号或身份重复/越界".into());
                }
                let key = format!("q{}", questions.len() + 1);
                let own = if matches!(control, Control::Radio) && shared.is_empty() {
                    options(&item["option"], judge)?
                } else {
                    shared.clone()
                };
                if judge && own.iter().any(|(v, _)| v == "Y") {
                    group_kind = "yes_no_not_given"
                }
                let input = markup::control(
                    &key,
                    n,
                    &own,
                    matches!(control, Control::Radio),
                    !judge && !(subject == Subject::Reading && source_type == 3),
                );
                controls.insert(source_id.to_string(), input.clone());
                if !embedded && !matches!(control, Control::Group) {
                    body.push_str(&format!(
                        "<div><strong>{n}.</strong> {} {input}</div>",
                        markup::escape(text(item, "title"))
                    ));
                }
                let answer = text(item, "display_answer");
                if answer.is_empty() {
                    return Err("爱听写真题缺少标准答案".into());
                }
                official_answers.insert(
                    key.clone(),
                    json!(if judge { judgement(answer)? } else { answer }),
                );
                display.insert(key.clone(), json!(n.to_string()));
                keys.push(key.clone());
                part_numbers.push(n);
                questions.push(Question {
                    key,
                    part_id,
                    group_id,
                    source_id,
                    source_type,
                    number: n,
                    choices: own.iter().map(|(v, _)| v.clone()).collect(),
                    grouped: matches!(control, Control::Group),
                });
            }
            if embedded {
                body = markup::fragment(text(group, "collect"), &controls)?
            }
            if matches!(control, Control::Group) {
                body = markup::checkboxes(&keys, &shared, text(&group["collect_option"], "title"))
            }
            let lead = format!(
                "<p>{}</p><h3>{}</h3><p>{}</p>",
                markup::escape(text(group, "desc")).replace('\n', "<br>"),
                markup::escape(text(group, "title")),
                markup::escape(text(group, "question_title"))
            );
            groups.push(
                json!({"groupId":format!("idictation-{part_id}-{group_id}"),"kind":group_kind,
                "section":section,"questionIds":keys,"leadHtml":lead,"bodyHtml":body}),
            );
        }
        let listed: Vec<u64> = rows(part, "question_number")?
            .iter()
            .map(|n| n.as_u64().ok_or("题号列表格式未知".to_string()))
            .collect::<Result<_>>()?;
        if listed != part_numbers {
            return Err("爱听写Part题号与题组内容不一致".into());
        }
    }
    let count = if let Some(section) = single_section {
        let start = (section as u64 - 1) * 10 + 1;
        if questions.len() != 10 || (!(1..=10).all(|n| seen_numbers.contains(&n))
            && !(start..start + 10).all(|n| seen_numbers.contains(&n))) {
            return Err("机经听力单 Part 必须完整包含 10 道连续题号".into());
        }
        10
    } else {
        if questions.len() != 40 || !(1..=40).all(|n| seen_numbers.contains(&n)) {
            return Err("爱听写整卷必须完整包含40题".into());
        }
        40
    };
    let order: Vec<_> = questions.iter().map(|q| q.key.clone()).collect();
    let title = format!(
        "爱听写 · {} {}",
        text(source, "jianya_name"),
        text(source, "test_name")
    );
    let category = single_section.map(|section| format!("P{section}")).unwrap_or_else(|| "整套".into());
    let payload = json!({"schemaVersion":if subject==Subject::Reading {json!("ReadingExamSourceV1")}else{json!(1)},
        "meta":{"title":title,"category":category},"passage":{"blocks":blocks},"questionGroups":groups,
        "questionOrder":order,"questionCount":count,"questionDisplayMap":display,"answerKey":{},
        "capabilities":{"localScoring":false,"remoteSubmit":false},
        "idictation":{"subject":subject,"testId":test_id,"questions":questions}});
    let fingerprint = hex::encode(Sha256::digest(
        serde_json::to_vec(&json!([payload, official_answers, transcript]))
            .map_err(|e| e.to_string())?,
    ));
    let saved = &source["practice_result"];
    let mut annotations = json!({"highlights":[],"notes":[]});
    if !saved.is_null() {
        for field in ["highlights", "notes"] {
            if !saved[field].is_array() {
                return Err("爱听写已有注释格式未核验，不能覆盖续练".into());
            }
            annotations[field] = saved[field].clone();
        }
    }
    Ok(Exam {
        subject,
        test_id,
        fingerprint,
        payload,
        questions,
        official_answers,
        transcript,
        annotations,
    })
}

/// Exact observed ordinary Academic-suite body. Transport supplies signing.
/// Callers own the original round key and decide whether an acknowledged write
/// is safe; this function neither dispatches nor retries.
pub fn submission(
    exam: &Exam,
    answers: &Map<String, Value>,
    marks: &HashSet<String>,
    key: u64,
    duration: u64,
    finish: bool,
) -> Result<Value> {
    if key == 0 || key > 9_007_199_254_740_991 || duration > 604800 {
        return Err("爱听写轮次或时长无效".into());
    }
    let known: HashSet<_> = exam.questions.iter().map(|q| q.key.as_str()).collect();
    if answers.keys().any(|k| !known.contains(k.as_str()))
        || marks.iter().any(|k| !known.contains(k.as_str()))
    {
        return Err("爱听写作答包含未知题目".into());
    }
    let mut output = Vec::new();
    let mut done = HashSet::new();
    for question in &exam.questions {
        if question.grouped {
            if !done.insert(question.group_id) {
                continue;
            }
            let members: Vec<_> = exam
                .questions
                .iter()
                .filter(|q| q.group_id == question.group_id)
                .collect();
            let mut selected = Vec::new();
            for member in &members {
                if let Some(v) = answer(member, answers)? {
                    selected.push(v)
                }
            }
            selected.sort();
            if selected.windows(2).any(|w| w[0] == w[1]) {
                return Err("爱听写多选不能重复选项".into());
            }
            output.push(json!({"type":question.source_type,"id":0,"group_id":question.group_id,
                "answer":if selected.is_empty(){Value::Null}else{json!(selected)},"mark":members.iter().any(|q|marks.contains(&q.key))}));
        } else {
            let value = answer(question, answers)?;
            // The observed manual reading submit re-collects drag inputs from
            // the DOM, including empty strings. The server returns null again.
            let value = if value.is_none()
                && finish
                && exam.subject == Subject::Reading
                && matches!(question.source_type, 2 | 10)
            {
                json!("")
            } else {
                json!(value)
            };
            output.push(json!({"type":question.source_type,"id":question.source_id,"group_id":question.group_id,
                "answer":value,"mark":marks.contains(&question.key)}));
        }
    }
    let mut body = json!({"key":key,"answer":output,"duration":duration,
        "highlights":exam.annotations["highlights"],"notes":exam.annotations["notes"]});
    body[if exam.subject == Subject::Reading {
        "jianya_test_id"
    } else {
        "dyy_jianya_test_id"
    }] = json!(exam.test_id);
    if finish {
        body["action"] = json!("手动提交")
    }
    Ok(body)
}
fn answer(question: &Question, answers: &Map<String, Value>) -> Result<Option<String>> {
    let Some(value) = answers.get(&question.key).filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let raw = value.as_str().ok_or("爱听写单题答案类型无效")?;
    let normalized = raw
        .replace('．', ".")
        .split(|c: char| c.is_whitespace() || c == '\u{feff}')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let text = normalized.as_str();
    if text.is_empty() {
        return Ok(None);
    }
    if text.len() > 4096
        || (!question.choices.is_empty() && !question.choices.iter().any(|v| v == text))
    {
        return Err("爱听写答案不属于当前题目选项".into());
    }
    Ok(Some(text.into()))
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_exam.rs"]
mod tests;
