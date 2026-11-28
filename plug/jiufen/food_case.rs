use super::{decode, Article, Unit};
use crate::jiufen::{EXAM, REVIEW};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const UNIT_ID: &str = "2017137445860642818";

pub fn exam_snapshot(envelope: &Value) -> Result<String, String> {
    let unit: Unit =
        serde_json::from_value(envelope["data"].clone()).map_err(|_| "在线题面结构不兼容")?;
    Ok(json!({"code":200,"data":unit}).to_string())
}

// Match the actual text and answer controls before reusing the test answers for this edition.
// Only IDs and article metadata omitted from the redacted fixture may differ.
pub fn submission(exam: &str, submission_id: &str) -> Result<Value, String> {
    let mut unit: Unit = decode(exam)?;
    let reference: Unit = decode(EXAM)?;
    let review: super::Review = decode(REVIEW)?;
    if unit.id != UNIT_ID || unit.parts.len() != 1 {
        return Err("线上阅读单元不匹配".into());
    }
    let p = &mut unit.parts[0];
    let original = &reference.parts[0];
    let article = |s: &str| serde_json::from_str::<Article>(s).map_err(|_| "阅读正文结构有变化");
    if article(&p.article_json)? != article(&original.article_json)?
        || p.groups.len() != original.groups.len()
    {
        return Err("正文或题组已经变更".into());
    }
    let answers: HashMap<_, _> = review
        .details
        .iter()
        .map(|d| (d.q_number.as_str(), d.user_answer.as_str()))
        .collect();
    let mut ids = HashSet::new();
    let mut groups = Vec::new();
    for (g, template) in p.groups.iter_mut().zip(&original.groups) {
        if g.questions.len() != template.questions.len()
            || g.id.is_empty()
            || !ids.insert(g.id.clone())
        {
            return Err("题组结构有变化".into());
        }
        let mut questions = Vec::new();
        for (q, template) in g.questions.iter_mut().zip(&template.questions) {
            if q.id.is_empty() || !ids.insert(q.id.clone()) {
                return Err("题目标识为空或重复".into());
            }
            let answer = match q.q_number.as_str() {
                "1" => "A",
                "13" => "",
                n => *answers.get(n).ok_or("出现未知题号")?,
            };
            questions.push(
                json!({"id":q.id,"qNumber":q.q_number,"userAnswer":answer,"bookmarked":false}),
            );
            q.id.clone_from(&template.id);
        }
        groups.push(json!({"id":g.id,"type":g.r#type,"questions":questions}));
        g.id.clone_from(&template.id);
    }
    if p.id.is_empty() {
        return Err("Part 标识为空".into());
    }
    let body = json!({"unitId":unit.id,"channel":unit.channel,"parts":[{"id":p.id,"groups":groups}],"annotationSnapshot":{"version":1,"annotations":[]},"clientSubmissionId":submission_id});
    p.id.clone_from(&original.id);
    p.article_json.clone_from(&original.article_json);
    unit.id.clone_from(&reference.id);
    if unit != reference {
        return Err("题面版本已变更，请重新核对本篇测试答案".into());
    }
    Ok(body)
}

pub fn verify(
    exam: &str,
    review: &Value,
    owner: &str,
    receipt: &str,
    body: &Value,
) -> Result<super::Converted, String> {
    let attempt = &review["data"]["attempt"];
    if attempt["id"] != receipt || attempt["userId"] != owner || attempt["unitId"] != UNIT_ID {
        return Err("官方复盘与交卷回执、账号或单元不一致".into());
    }
    let expected: HashMap<_, _> = body["parts"][0]["groups"]
        .as_array()
        .ok_or("交卷题组丢失")?
        .iter()
        .flat_map(|g| g["questions"].as_array().into_iter().flatten())
        .map(|q| (&q["id"], &q["userAnswer"]))
        .filter_map(|(id, ans)| Some((id.as_str()?, ans.as_str()?)))
        .collect();
    let details = review["data"]["details"].as_array().ok_or("复盘明细缺失")?;
    if expected.len() != 13
        || details.iter().any(|d| {
            d["questionId"]
                .as_str()
                .and_then(|id| expected.get(id).copied())
                .zip(
                    d.get("userAnswer")
                        .and_then(|v| if v.is_null() { Some("") } else { v.as_str() }),
                )
                .is_none_or(|(a, b)| a != b)
        })
    {
        return Err("复盘答案与冻结的交卷请求不一致".into());
    }
    super::convert(exam, &review.to_string())
}
