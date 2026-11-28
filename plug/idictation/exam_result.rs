//! Verify source facts for Atlas' own review harness, never source AI review.
use super::{number, rows, Exam, Result, Subject};
use ielts_domain::dto::{AttemptAnswer, AttemptRecord};
use ielts_domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub struct VerifiedResult {
    pub source_result_id: u64,
    pub attempt: AttemptRecord,
    pub official_answers: Map<String, Value>,
    pub evidence_limitations: Vec<String>,
}
fn normalized(v: &Value) -> Value {
    match v {
        Value::String(s) if s.trim().is_empty() => Value::Null,
        _ => v.clone(),
    }
}
fn require_answer(row: &Value) -> Result<()> {
    if row
        .get("answer")
        .is_none_or(|v| !v.is_null() && !v.is_string())
    {
        return Err("爱听写作答字段缺失或格式无效".into());
    }
    Ok(())
}
fn index_answers<'a>(values: &'a [Value]) -> Result<HashMap<(u64, u64, u64), &'a Value>> {
    let mut out = HashMap::new();
    for row in values {
        require_answer(row)?;
        let key = (
            number(row, "type")?,
            number(row, "id")?,
            number(row, "group_id")?,
        );
        if !row["mark"].is_boolean() || out.insert(key, row).is_some() {
            return Err("爱听写结果作答重复或标记格式无效".into());
        }
    }
    Ok(out)
}
pub fn verify_reading(
    exam: &Exam,
    owner: &str,
    asset_id: &str,
    submitted: &Value,
    record: &Value,
) -> Result<VerifiedResult> {
    if exam.subject != Subject::Reading || owner.is_empty() || asset_id.is_empty() {
        return Err("爱听写结果身份上下文无效".into());
    }
    let result_id = number(record, "id")?;
    if super::super::vocabulary::id(&record["user_id"]).as_deref() != Ok(owner)
        || super::super::vocabulary::id(&record["jianya_test_id"]).as_deref() != Ok(exam.test_id.as_str())
        || submitted["jianya_test_id"] != exam.test_id
        || record["action"] != "手动提交"
        || submitted["action"] != "手动提交"
    {
        return Err("爱听写结果与提交账号/试卷不一致".into());
    }
    for field in [
        "jianya_part_id",
        "jijing_test_id",
        "jijing_part_id",
        "g_jianya_test_id",
        "g_jianya_part_id",
        "class_exam_id",
    ] {
        if record[field].as_u64() != Some(0) {
            return Err("爱听写结果所属范围不是普通A类整卷".into());
        }
    }
    let submitted_key = number(submitted, "key")?.to_string();
    if record["key"].as_str() != Some(submitted_key.as_str())
        || record["duration"] != submitted["duration"]
    {
        return Err("爱听写官方结果与本次轮次/时长不一致".into());
    }
    let submitted_answers = index_answers(rows(submitted, "answer")?)?;
    let returned_answers = index_answers(rows(record, "answer")?)?;
    if submitted_answers.len() != exam.questions.len()
        || returned_answers.len() != exam.questions.len()
    {
        return Err("爱听写结果作答不完整".into());
    }
    let blank_value: Value = match &record["result_blanks"] {
        Value::String(raw) => serde_json::from_str(raw).map_err(|_| "爱听写逐题结果JSON无效")?,
        _ => return Err("爱听写逐题结果类型尚未核验".into()),
    };
    let blank_rows = blank_value.as_array().ok_or("爱听写逐题结果缺少列表")?;
    let mut blanks = HashMap::new();
    for row in blank_rows {
        require_answer(row)?;
        if blanks.insert(number(row, "blank_id")?, row).is_some() {
            return Err("爱听写逐题结果身份重复".into());
        }
    }
    if blanks.len() != exam.questions.len() {
        return Err("爱听写逐题判分不完整".into());
    }
    let mut answers = Vec::new();
    let mut official_answers = Map::new();
    let mut correct = 0u32;
    for q in &exam.questions {
        let identity = (q.source_type, q.source_id, q.group_id);
        let sent = submitted_answers
            .get(&identity)
            .ok_or("爱听写提交题目身份不匹配")?;
        let returned = returned_answers
            .get(&identity)
            .ok_or("爱听写回读题目身份不匹配")?;
        let blank = blanks.remove(&q.source_id).ok_or("爱听写官方判分缺题")?;
        if normalized(&sent["answer"]) != normalized(&returned["answer"])
            || sent["mark"] != returned["mark"]
            || normalized(&sent["answer"]) != normalized(&blank["answer"])
            || number(blank, "group_id")? != q.group_id
        {
            return Err("爱听写官方作答与本次提交不一致".into());
        }
        let is_correct = blank["is_correct"]
            .as_bool()
            .ok_or("爱听写官方对错类型无效")?;
        let expected = blank["correct_answer"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("爱听写官方答案缺失")?;
        if exam.official_answers.get(&q.key) != Some(&json!(expected)) {
            return Err("爱听写官方答案与本次题目版本不同".into());
        }
        correct += u32::from(is_correct);
        official_answers.insert(q.key.clone(), json!(expected));
        answers.push(AttemptAnswer {
            question_id: q.key.clone(),
            answer: normalized(&returned["answer"]),
            is_correct: Some(is_correct),
            weight: 1.0,
            question_kind: exam.payload["questionGroups"]
                .as_array()
                .and_then(|groups| {
                    groups.iter().find(|g| {
                        g["questionIds"]
                            .as_array()
                            .is_some_and(|ids| ids.iter().any(|id| id == &q.key))
                    })
                })
                .and_then(|g| g["kind"].as_str())
                .map(str::to_owned),
            change_count: 0,
            visit_count: 0,
            elapsed_ms: 0,
            marked: returned["mark"].as_bool().unwrap(),
            answered_at: None,
        });
    }
    if record["zhengquegeshu"].as_u64() != Some(correct as u64) {
        return Err("爱听写总分与逐题判分不一致".into());
    }
    // The source's display percentage can lose precision. Use its verified
    // correct count and the number of officially graded questions for the ratio.
    let created = record["created_at"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("爱听写结果创建时间缺失")?;
    let completed = record["updated_at"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("爱听写结果提交时间缺失")?;
    let created_time =
        chrono::DateTime::parse_from_rfc3339(created).map_err(|_| "爱听写创建时间格式未知")?;
    let completed_time =
        chrono::DateTime::parse_from_rfc3339(completed).map_err(|_| "爱听写提交时间格式未知")?;
    if created_time > completed_time {
        return Err("爱听写结果时间顺序异常".into());
    }
    let duration = record["duration"]
        .as_u64()
        .filter(|n| *n <= 604800)
        .ok_or("爱听写时长无效")?;
    let local_id = format!(
        "idictation-attempt-{}",
        hex::encode(Sha256::digest(
            json!([owner, "reading", result_id]).to_string().as_bytes()
        ))
    );
    Ok(VerifiedResult {
        source_result_id: result_id,
        official_answers,
        evidence_limitations: vec![
            "原站未提供逐题停留、访问、修改轨迹；零值为缺失占位，不可据此推断首次答对或作答速度"
                .into(),
            "仅保留官方题目与判分；复盘由Atlas本地harness生成，未使用原站AI解析".into(),
        ],
        attempt: AttemptRecord {
            schema_version: 1,
            id: local_id,
            activity: Activity::Reading,
            asset_id: Some(asset_id.into()),
            mode: AttemptMode::Single,
            suite_id: None,
            status: AttemptStatus::Completed,
            started_at: created.into(),
            submitted_at: Some(completed.into()),
            completed_at: Some(completed.into()),
            duration_ms: duration * 1000,
            score_value: Some(correct as f64 / answers.len() as f64),
            score_scale: Some(ScoreScale::Ratio),
            correct_count: Some(correct as f64),
            question_count: Some(answers.len() as u32),
            title_snapshot: exam.payload["meta"]["title"].as_str().map(str::to_owned),
            prompt_snapshot: None,
            content_text: None,
            task_type: None,
            answers,
            annotations: vec![],
        },
    })
}
