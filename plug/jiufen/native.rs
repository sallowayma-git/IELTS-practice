use dom_query::{Document, NodeRef};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use super::service::identifier;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceQuestion {
    pub key: String,
    pub part_id: String,
    pub group_id: String,
    pub group_type: String,
    pub question_id: String,
    pub number: String,
    pub kind: String,
    pub choices: Vec<String>,
}

pub(super) fn string<'a>(row: &'a Value, field: &str) -> &'a str {
    row[field].as_str().unwrap_or_default()
}

pub(super) fn array<'a>(row: &'a Value, field: &str) -> &'a [Value] {
    row[field].as_array().map(Vec::as_slice).unwrap_or_default()
}

fn id(row: &Value) -> Result<String, String> {
    identifier(&row["id"]).ok_or_else(|| "线上题面缺少标识".into())
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(super) fn plain(html: &str) -> String {
    Document::from(html)
        .select("body")
        .formatted_text()
        .trim()
        .to_owned()
}

// Only locally generated controls and allowlisted markup reach v-html.
fn fragment(html: &str, controls: &HashMap<String, String>, used: &mut HashSet<String>) -> String {
    fn walk(
        node: NodeRef<'_>,
        controls: &HashMap<String, String>,
        used: &mut HashSet<String>,
        out: &mut String,
    ) {
        if node.is_text() {
            out.push_str(&escape(&node.text()));
            return;
        }
        let Some(name) = node.node_name() else { return };
        let tag = name.as_ref();
        match tag {
            "script" | "style" | "iframe" | "object" | "svg" => return,
            "input" => {
                if let Some(number) = node.attr("placeholder") {
                    if let Some(control) = controls.get(number.as_ref()) {
                        if used.insert(number.to_string()) {
                            out.push_str(control);
                        }
                    }
                }
                return;
            }
            "br" => {
                out.push_str("<br>");
                return;
            }
            "img" => {
                if let Some(url) = node
                    .attr("src")
                    .and_then(|src| super::catalog::media_url(&src))
                {
                    let alt = node.attr("alt").unwrap_or_default();
                    out.push_str(&format!(
                        "<img src=\"{}\" alt=\"{}\">",
                        escape(&url),
                        escape(&alt)
                    ));
                }
                return;
            }
            _ => {}
        }
        let wrap = matches!(
            tag,
            "p" | "div"
                | "span"
                | "table"
                | "tbody"
                | "thead"
                | "tfoot"
                | "tr"
                | "td"
                | "th"
                | "strong"
                | "b"
                | "em"
                | "i"
                | "u"
                | "ul"
                | "ol"
                | "li"
                | "h2"
                | "h3"
                | "h4"
                | "blockquote"
                | "sup"
                | "sub"
        );
        if wrap {
            out.push_str(&format!("<{tag}"));
            for attr in ["rowspan", "colspan"] {
                if matches!(tag, "td" | "th") {
                    if let Some(n) = node
                        .attr(attr)
                        .and_then(|v| v.parse::<u8>().ok())
                        .filter(|n| *n > 0)
                    {
                        out.push_str(&format!(" {attr}=\"{n}\""));
                    }
                }
            }
            out.push('>');
        }
        for child in node.children() {
            walk(child, controls, used, out);
        }
        if wrap {
            out.push_str(&format!("</{tag}>"));
        }
    }
    let doc = Document::from(html);
    let mut out = String::new();
    if let Some(body) = doc.body() {
        walk(body, controls, used, &mut out);
    }
    out
}

fn safe_html(html: &str) -> String {
    fragment(html, &HashMap::new(), &mut HashSet::new())
}

fn kind(group: &Value, listening: bool) -> Result<&'static str, String> {
    let group_type = string(group, "type");
    let subtype = string(group, "questionSubtype");
    let kind = match (group_type, subtype, listening) {
        ("single-choice", "judgment_true_false_not_given", false) => "true_false_not_given",
        ("single-choice", "judgment_yes_no_not_given", false) => "yes_no_not_given",
        ("single-choice", _, true) => "single_choice",
        ("single-choice", _, false) => "multiple_choice",
        ("multiple-choice", _, true) => "multi_choice",
        ("multiple-choice", _, false) => "multiple_choice_multiple",
        ("heading", _, false) | ("matching", "matching_headings" | "reading_heading", false) => {
            "matching_headings"
        }
        ("matching", "reading_person_match", false) => "matching_features",
        ("matching", _, true) => "matching",
        ("matching", _, false) => "matching",
        ("map", _, false) => "matching_information",
        ("map", _, true) => "map_labelling",
        ("fill-in-the-blank", "flowchart_fill", _) => "flow_chart_completion",
        ("fill-in-the-blank", "diagram_fill", _) => "diagram_completion",
        ("fill-in-the-blank", _, _) => "sentence_completion",
        _ => return Err(format!("线上题型 {group_type} 暂未适配")),
    };
    Ok(kind)
}

fn options(rows: &[Value]) -> Vec<(String, String)> {
    rows.iter()
        .filter_map(|row| {
            let code = identifier(&row["optionNum"])?;
            let label = plain(string(row, "optionContent"));
            Some((code, label))
        })
        .collect()
}

fn control(key: &str, number: &str, choices: &[(String, String)], radio: bool) -> String {
    if choices.is_empty() {
        return format!(
            "<input type=\"text\" name=\"{key}\" placeholder=\"{number}\" aria-label=\"{number}\">"
        );
    }
    if radio {
        return choices.iter().map(|(value, label)| {
            let value = escape(value);
            format!("<label><input type=\"radio\" name=\"{key}\" value=\"{value}\"> {value}. {}</label> ", escape(label))
        }).collect();
    }
    let choices: String = choices
        .iter()
        .map(|(value, label)| {
            let value = escape(value);
            format!(
                "<option value=\"{value}\">{value}. {}</option>",
                escape(label)
            )
        })
        .collect();
    format!("<select name=\"{key}\" aria-label=\"{number}\"><option value=\"\">请选择</option>{choices}</select>")
}

pub(super) fn section(part: &Value, index: usize) -> u8 {
    part["partNum"]
        .as_u64()
        .and_then(|n| u8::try_from(n).ok())
        .or_else(|| {
            ["label", "partNo", "partNum"].iter().find_map(|k| {
                string(part, k)
                    .trim()
                    .trim_start_matches("Part ")
                    .trim_start_matches('P')
                    .parse()
                    .ok()
            })
        })
        .filter(|n| (1..=4).contains(n))
        .unwrap_or((index + 1).min(4) as u8)
}

pub(super) fn exam(unit: &Value) -> Result<Value, String> {
    let title = string(unit, "title");
    let listening = unit["channel"] == "listening";
    let mut blocks = Vec::new();
    let mut groups = Vec::new();
    let mut sources = Vec::new();
    let mut display = Map::new();
    let mut seen_ids = HashSet::new();
    let parts = array(unit, "parts");
    if parts.is_empty() || parts.len() > 4 || (!listening && parts.len() > 3) {
        return Err("线上试题的 Part 数量不受支持".into());
    }
    let mut seen_sections = HashSet::new();
    for (i, part) in parts.iter().enumerate() {
        let part_id = id(part)?;
        let section = section(part, i);
        if !seen_sections.insert(section) {
            return Err("线上试题包含重复 Part".into());
        }
        if !listening {
            let article = match &part["articleJson"] {
                Value::String(raw) => serde_json::from_str(raw).unwrap_or_default(),
                value => value.clone(),
            };
            let paragraphs: Vec<_> = array(&article, "segments")
                .iter()
                .map(|segment| {
                    array(segment, "sentences")
                        .iter()
                        .map(|sentence| {
                            let text = escape(string(sentence, "text"));
                            let index = sentence["sentence_index"].as_u64();
                            match index {
                                Some(index) => format!("<span data-study-sentence=\"{part_id}-s{index}\">{text}</span>"),
                                None => text,
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .filter(|s| !s.trim().is_empty())
                .collect();
            let article_html = if paragraphs.is_empty() {
                safe_html(string(part, "article"))
            } else {
                paragraphs
                    .into_iter()
                    .map(|s| format!("<p>{s}</p>"))
                    .collect()
            };
            if article_html.trim().is_empty() {
                return Err("线上阅读缺少正文".into());
            }
            let heading = escape(string(part, "title"));
            let description = safe_html(string(part, "partDescription"));
            blocks.push(json!({"kind":"html","blockId":format!("part-{section}"),"html":format!("<h2>{heading}</h2>{description}{article_html}")}));
        }
        for group in array(part, "groups") {
            let group_id = id(group)?;
            let group_type = string(group, "type");
            let group_kind = kind(group, listening)?;
            let radio = group_type == "single-choice";
            let mut shared_options = options(array(group, "options"));
            let raw = string(group, "contentHtml");
            let mut controls = HashMap::new();
            let mut labels = HashSet::new();
            let mut pending = Vec::new();
            let mut keys = Vec::new();
            let questions = array(group, "questions");
            let mut placeholders = Vec::new();
            if questions.is_empty() {
                for node in Document::from(raw).select("input[placeholder]").nodes() {
                    if let Some(n) = node.attr("placeholder") {
                        placeholders.push(json!({"qNumber":n.to_string()}));
                    }
                }
            }
            if shared_options.is_empty() && group_type == "multiple-choice" {
                shared_options = questions
                    .iter()
                    .map(|q| options(array(q, "options")))
                    .find(|o| !o.is_empty())
                    .unwrap_or_default();
            }
            for q in questions.iter().chain(&placeholders) {
                let number = identifier(&q["qNumber"])
                    .filter(|n| n.parse::<u32>().is_ok())
                    .ok_or("线上题号格式异常")?;
                let question_id = identifier(&q["id"]).unwrap_or_default();
                if (!question_id.is_empty() && !seen_ids.insert(question_id.clone()))
                    || !labels.insert(number.clone())
                {
                    return Err("线上题目标识重复".into());
                }
                let key = format!("q{}", sources.len() + 1);
                let own = options(array(q, "options"));
                let choices = if own.is_empty() {
                    &shared_options
                } else {
                    &own
                };
                let control = control(&key, &number, choices, radio);
                controls.insert(number.clone(), control.clone());
                pending.push((number.clone(), safe_html(string(q, "question")), control));
                display.insert(key.clone(), json!(number));
                keys.push(key.clone());
                sources.push(SourceQuestion {
                    key,
                    part_id: part_id.clone(),
                    group_id: group_id.clone(),
                    group_type: group_type.into(),
                    question_id,
                    number,
                    kind: group_kind.into(),
                    choices: choices.iter().map(|(v, _)| v.clone()).collect(),
                });
            }
            if keys.is_empty() {
                return Err("线上题组缺少可作答的题号".into());
            }
            let mut used = HashSet::new();
            let mut body = fragment(raw, &controls, &mut used);
            if group_type == "multiple-choice"
                && !shared_options.is_empty()
                && sources[sources.len() - keys.len()..].iter().all(|q| {
                    q.choices
                        .iter()
                        .eq(shared_options.iter().map(|(value, _)| value))
                })
            {
                let name = keys.join("_");
                for (value, label) in &shared_options {
                    let value = escape(value);
                    body.push_str(&format!("<label><input type=\"checkbox\" name=\"{name}\" value=\"{value}\"> {value}. {}</label> ", escape(label)));
                }
                pending.clear();
            }
            for (number, prompt, control) in pending {
                if !used.contains(&number) {
                    body.push_str(&format!(
                        "<div><strong>{number}.</strong> {prompt} {control}</div>"
                    ));
                }
            }
            if let Some(url) = super::catalog::media_url(string(group, "imageUrl")) {
                body.insert_str(0, &format!("<img src=\"{}\" alt=\"题图\">", escape(&url)));
            }
            let description = safe_html(string(group, "description"));
            let range = escape(string(group, "qRange"));
            let lead = format!("<h3>{range}</h3>{description}");
            groups.push(json!({"groupId":group_id,"kind":group_kind,"sourceSubtype":group["questionSubtype"],"section":section,"questionIds":keys,"leadHtml":lead,"bodyHtml":body}));
        }
    }
    if sources.is_empty() {
        return Err("线上试题没有可作答的题目".into());
    }
    let order: Vec<_> = sources.iter().map(|s| &s.key).collect();
    let category = parts
        .iter()
        .enumerate()
        .map(|(i, p)| format!("P{}", section(p, i)))
        .collect::<Vec<_>>()
        .join(" / ");
    let schema = if listening {
        json!(1)
    } else {
        json!("ReadingExamSourceV1")
    };
    Ok(json!({
        "schemaVersion":schema, "meta":{"title":title,"category":category},
        "passage":{"blocks":blocks}, "questionGroups":groups,"questionOrder":order,
        "questionCount":order.len(),"questionDisplayMap":display,"answerKey":{},
        "studyMaterial":super::material::from_unit(unit),
        "jiufen":{"unitId":id(unit)?,"channel":unit["channel"],"questions":sources}
    }))
}
