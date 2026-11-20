use dom_query::{Document, NodeRef};
use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
use ielts_domain::dto::{AttemptAnswer, AttemptRecord};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

#[path = "food_case.rs"]
pub(super) mod food_case;

type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
struct Envelope<T> {
    code: Value,
    data: T,
}

#[derive(Deserialize, serde::Serialize, PartialEq)]
struct Unit {
    id: String,
    title: String,
    channel: String,
    parts: Vec<Part>,
}

#[derive(Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Part {
    id: String,
    label: String,
    article_json: String,
    groups: Vec<Group>,
    part_description: String,
}

#[derive(Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Group {
    id: String,
    r#type: String,
    question_subtype: Option<String>,
    q_range: String,
    description: String,
    content_html: Option<String>,
    questions: Vec<Question>,
}

#[derive(Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Question {
    id: String,
    q_number: String,
    question: Option<String>,
    options: Vec<OptionItem>,
}

#[derive(Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct OptionItem {
    option_num: String,
    option_content: String,
}

#[derive(Deserialize, PartialEq)]
struct Article {
    segments: Vec<Segment>,
}
#[derive(Deserialize, PartialEq)]
struct Segment {
    sentences: Vec<Sentence>,
}
#[derive(Deserialize, PartialEq)]
struct Sentence {
    text: String,
}

#[derive(Deserialize)]
struct Review {
    attempt: OfficialAttempt,
    details: Vec<Detail>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialAttempt {
    id: String,
    user_id: String,
    unit_id: String,
    status: String,
    elapsed_seconds: Option<u64>,
    correct_count: usize,
    total_count: usize,
    created_at: String,
    submitted_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Detail {
    part_id: String,
    question_group_id: String,
    question_id: String,
    q_number: String,
    #[serde(deserialize_with = "nullable_answer")]
    user_answer: String,
    right_answer: String,
    score: f64,
    bookmarked: bool,
}

pub struct Converted {
    pub payload: Value,
    pub attempt: AttemptRecord,
}

fn nullable_answer<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

fn decode<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T> {
    let e: Envelope<T> = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if e.code != 200 && e.code != "200" {
        return Err("九分学长响应状态异常".into());
    }
    Ok(e.data)
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// The renderer accepts HTML. Rebuild only the layout and answer controls we understand.
fn markup(html: &str, blanks: &HashMap<String, String>) -> Result<String> {
    let doc = Document::from(html);
    let body = doc.body().ok_or("缺少题面正文")?;
    let mut used = HashSet::new();
    let mut out = String::new();
    render_node(body, blanks, &mut used, &mut out)?;
    if used.len() != blanks.len() {
        return Err("题号与填空数不一致".into());
    }
    Ok(out)
}

fn render_node(
    node: NodeRef<'_>,
    blanks: &HashMap<String, String>,
    used: &mut HashSet<String>,
    out: &mut String,
) -> Result<()> {
    if node.is_text() {
        out.push_str(&escape(&node.text()));
        return Ok(());
    }
    let Some(name) = node.node_name() else {
        return Ok(());
    };
    let tag = name.as_ref();
    if tag == "input" {
        let n = node.attr("placeholder").ok_or("填空缺少题号")?.to_string();
        let key = blanks.get(&n).ok_or("填空题号无法关联")?;
        if !used.insert(n.clone()) {
            return Err("填空题号重复".into());
        }
        out.push_str(&format!(
            r#"<input type="text" name="{key}" aria-label="{n}" placeholder="{n}">"#
        ));
        return Ok(());
    }
    if tag == "br" {
        out.push_str("<br>");
        return Ok(());
    }
    let wrap = matches!(
        tag,
        "table"
            | "tbody"
            | "thead"
            | "tr"
            | "td"
            | "th"
            | "strong"
            | "em"
            | "p"
            | "ul"
            | "li"
            | "b"
    );
    if !wrap && !matches!(tag, "body" | "div" | "span") {
        return Err(format!("暂不支持题面标签 {tag}"));
    }
    if wrap {
        out.push_str(&format!("<{tag}>"));
    }
    for child in node.children() {
        render_node(child, blanks, used, out)?;
    }
    if wrap {
        out.push_str(&format!("</{tag}>"));
    }
    Ok(())
}

fn digest(raw: &[u8]) -> String {
    hex::encode(Sha256::digest(raw))
}

pub fn convert(exam: &str, review: &str) -> Result<Converted> {
    let u: Unit = decode(exam)?;
    let r: Review = decode(review)?;
    let a = &r.attempt;
    if u.channel != "reading" || u.parts.len() != 1 || u.id != a.unit_id || a.status != "submitted"
    {
        return Err("需要同一篇阅读及其已提交记录".into());
    }
    let p = &u.parts[0];
    let article: Article = serde_json::from_str(&p.article_json).map_err(|e| e.to_string())?;
    let mut blocks = vec![
        json!({"kind":"html","blockId":"intro","html":format!("<h2>{}</h2><p>{}</p>",escape(&u.title),escape(&p.part_description))}),
    ];
    for (i, seg) in article.segments.iter().enumerate() {
        let para = seg
            .sentences
            .iter()
            .map(|s| escape(&s.text))
            .collect::<Vec<_>>()
            .join(" ");
        blocks.push(
            json!({"kind":"html","blockId":format!("p{}",i+1),"html":format!("<p>{para}</p>")}),
        );
    }
    let mut details: HashMap<_, _> = r
        .details
        .iter()
        .map(|d| (d.question_id.as_str(), d))
        .collect();
    let mut groups = vec![];
    let mut order = vec![];
    let mut displays = Map::new();
    let mut question_sources = Map::new();
    let mut keys = Map::new();
    let mut answers = vec![];
    let mut correct = 0usize;
    let mut numbers = HashSet::new();
    for g in &p.groups {
        let kind = match (g.r#type.as_str(), g.question_subtype.as_deref()) {
            ("single-choice", Some("judgment_true_false_not_given")) => "true_false_not_given",
            ("fill-in-the-blank", None) => "sentence_completion",
            _ => return Err(format!("暂不支持题组 {}", g.r#type)),
        };
        let mut ids = vec![];
        let mut body = String::new();
        let mut blanks = HashMap::new();
        for q in &g.questions {
            let d = details.remove(q.id.as_str()).ok_or("复盘缺题或题目重复")?;
            if q.q_number.parse::<u32>().is_err()
                || !numbers.insert(&q.q_number)
                || d.part_id != p.id
                || d.question_group_id != g.id
                || d.q_number != q.q_number
            {
                return Err("题号或题组关联不一致".into());
            }
            if d.right_answer.is_empty() || !matches!(d.score, 0.0 | 1.0) {
                return Err("缺少标准答案或逐题计分不受支持".into());
            }
            let key = format!("q{}", order.len() + 1);
            if kind == "true_false_not_given" {
                body.push_str(&radio(q, d, &key)?);
            } else {
                blanks.insert(q.q_number.clone(), key.clone());
            }
            keys.insert(key.clone(), json!(d.right_answer));
            displays.insert(key.clone(), json!(q.q_number));
            question_sources.insert(
                key.clone(),
                json!({
                    "partId": p.id, "groupId": g.id, "questionId": q.id,
                }),
            );
            correct += usize::from(d.score == 1.0);
            answers.push(AttemptAnswer {
                question_id: key.clone(),
                answer: json!(d.user_answer),
                is_correct: Some(d.score == 1.0),
                marked: d.bookmarked,
                question_kind: Some(kind.into()),
                weight: 1.0,
                change_count: 0,
                visit_count: 0,
                elapsed_ms: 0,
                answered_at: None,
            });
            order.push(key.clone());
            ids.push(key);
        }
        if !blanks.is_empty() {
            body = markup(g.content_html.as_deref().ok_or("缺少填空题面")?, &blanks)?;
        }
        let lead = format!(
            "<h3>{}</h3>{}",
            escape(&g.q_range),
            markup(&g.description, &HashMap::new())?
        );
        groups.push(
            json!({"groupId":g.id,"kind":kind,"questionIds":ids,"leadHtml":lead,"bodyHtml":body}),
        );
    }
    if order.is_empty()
        || !details.is_empty()
        || order.len() != r.details.len()
        || order.len() != a.total_count
        || correct != a.correct_count
    {
        return Err("复盘总数或得分不匹配".into());
    }
    let title = format!("九分学长 · {}", u.title);
    let mut payload = json!({
        "schemaVersion": "ReadingExamSourceV1",
        "meta": {"title": title, "category": p.label.replace("Part ", "P")},
        "passage": {"blocks": blocks},
        "questionGroups": groups,
        "questionOrder": order,
        "questionDisplayMap": displays,
        "answerKey": keys,
        "jiufen": {"unitId": u.id, "questionSources": question_sources},
    });
    let asset_id = format!(
        "jiufen-reading-{}",
        digest(json!([u.id, payload]).to_string().as_bytes())
    );
    payload["examId"] = json!(asset_id);
    let id = format!(
        "jiufen-attempt-{}",
        digest(json!([a.user_id, a.id]).to_string().as_bytes())
    );
    let attempt = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id,
        activity: Activity::Reading,
        asset_id: Some(asset_id),
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: a.created_at.clone(),
        submitted_at: Some(a.submitted_at.clone()),
        completed_at: Some(a.submitted_at.clone()),
        duration_ms: a
            .elapsed_seconds
            .unwrap_or_default()
            .checked_mul(1000)
            .ok_or("计时越界")?,
        score_value: Some(correct as f64 / order.len() as f64),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(correct as f64),
        question_count: Some(u32::try_from(order.len()).map_err(|_| "题数越界")?),
        title_snapshot: Some(title),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations: vec![],
    };
    Ok(Converted { payload, attempt })
}

fn radio(q: &Question, d: &Detail, key: &str) -> Result<String> {
    let mut html = format!(
        "<fieldset><legend>{}. {}</legend>",
        escape(&q.q_number),
        escape(q.question.as_deref().ok_or("缺少判断题题干")?)
    );
    let mut values = HashSet::new();
    for o in &q.options {
        if o.option_num.is_empty() || !values.insert(o.option_num.as_str()) {
            return Err("判断题选项值为空或重复".into());
        }
        html.push_str(&format!(
            r#"<label><input type="radio" name="{key}" value="{}"> {}</label> "#,
            escape(&o.option_num),
            escape(&o.option_content)
        ));
    }
    if !values.contains(d.right_answer.as_str())
        || (!d.user_answer.is_empty() && !values.contains(d.user_answer.as_str()))
    {
        return Err("复盘选项缺失".into());
    }
    html.push_str("</fieldset>");
    Ok(html)
}
