use super::{rows, text, Result};
use dom_query::{Document, NodeRef};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(super) fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub(super) fn reject_image(v: &Value) -> Result<()> {
    for key in ["img_url", "image", "paragraph_img"] {
        let empty = match &v[key] {
            Value::Null => true,
            Value::String(s) => s.is_empty() || s == "[]",
            Value::Array(a) => a.is_empty(),
            _ => false,
        };
        if !empty {
            return Err("爱听写真题图片尚未核验，不能省略题图".into());
        }
    }
    Ok(())
}
pub(super) fn control(
    key: &str,
    n: u64,
    options: &[(String, String)],
    radio: bool,
    show_code: bool,
) -> String {
    if options.is_empty() {
        return format!(
            "<input type=\"text\" name=\"{key}\" placeholder=\"{n}\" aria-label=\"{n}\">"
        );
    }
    if radio {
        return options
            .iter()
            .map(|(code, label)| {
                let prefix = if show_code {
                    format!("{}. ", escape(code))
                } else {
                    String::new()
                };
                format!(
                    "<label><input type=\"radio\" name=\"{key}\" value=\"{}\"> {prefix}{}</label> ",
                    escape(code),
                    escape(label)
                )
            })
            .collect();
    }
    let options: String = options
        .iter()
        .map(|(code, label)| {
            format!(
                "<option value=\"{}\">{}. {}</option>",
                escape(code),
                escape(code),
                escape(label)
            )
        })
        .collect();
    format!("<select name=\"{key}\" aria-label=\"{n}\"><option value=\"\">请选择</option>{options}</select>")
}
pub(super) fn checkboxes(keys: &[String], options: &[(String, String)], title: &str) -> String {
    let name = keys.join("_");
    let limit = keys.len();
    let choices:String=options.iter().map(|(code,label)|format!("<label><input type=\"checkbox\" name=\"{name}\" data-max-selections=\"{limit}\" value=\"{}\"> {}. {}</label> ",escape(code),escape(code),escape(label))).collect();
    format!("<p>{}</p>{choices}", escape(title))
}

pub(super) fn fragment(raw: &str, controls: &HashMap<String, String>) -> Result<String> {
    let doc = Document::from(raw);
    let mut out = String::new();
    let mut used = HashSet::new();
    walk(
        doc.body().ok_or("爱听写题面没有正文")?,
        controls,
        &mut used,
        &mut out,
    )?;
    if used.len() != controls.len() {
        return Err("爱听写填空身份与题面不完整对应".into());
    }
    Ok(out)
}
fn tokens(
    raw: &str,
    controls: &HashMap<String, String>,
    used: &mut HashSet<String>,
) -> Result<String> {
    let mut out = String::new();
    let mut tail = raw;
    while let Some(start) = tail.find('$') {
        out.push_str(&escape(&tail[..start]));
        tail = &tail[start + 1..];
        let Some(end) = tail.find('$') else {
            out.push('$');
            out.push_str(&escape(tail));
            return Ok(out);
        };
        let token = &tail[..end];
        if !token.is_empty() && token.bytes().all(|b| b.is_ascii_digit()) {
            let control = controls.get(token).ok_or("爱听写题面存在未知填空身份")?;
            if !used.insert(token.to_owned()) {
                return Err("爱听写重复填空需要独立输入位置适配，当前不可打开".into());
            }
            out.push_str(control);
            tail = &tail[end + 1..];
        } else {
            out.push('$')
        }
    }
    out.push_str(&escape(tail));
    Ok(out.replace('\n', "<br>"))
}
fn walk(
    node: NodeRef<'_>,
    controls: &HashMap<String, String>,
    used: &mut HashSet<String>,
    out: &mut String,
) -> Result<()> {
    if node.is_text() {
        out.push_str(&tokens(&node.text(), controls, used)?);
        return Ok(());
    }
    let Some(name) = node.node_name() else {
        return Ok(());
    };
    let tag = name.as_ref();
    if matches!(
        tag,
        "script" | "style" | "iframe" | "object" | "svg" | "img" | "input" | "select" | "textarea"
    ) {
        return Err(format!("爱听写题面包含未允许标签 {tag}"));
    }
    if tag == "br" {
        out.push_str("<br>");
        return Ok(());
    }
    let wrap = matches!(
        tag,
        "p" | "div"
            | "span"
            | "table"
            | "thead"
            | "tbody"
            | "tfoot"
            | "tr"
            | "th"
            | "td"
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
            | "sup"
            | "sub"
    );
    if !wrap && tag != "body" {
        return Err(format!("爱听写题面标签 {tag} 尚未适配"));
    }
    if wrap {
        out.push_str(&format!("<{tag}"));
        if matches!(tag, "td" | "th") {
            for attr in ["colspan", "rowspan"] {
                if let Some(v) = node.attr(attr) {
                    let n = v
                        .parse::<u8>()
                        .ok()
                        .filter(|n| *n > 0)
                        .ok_or("爱听写表格跨格属性无效")?;
                    out.push_str(&format!(" {attr}=\"{n}\""))
                }
            }
        }
        out.push('>');
    }
    for child in node.children() {
        walk(child, controls, used, out)?
    }
    if wrap {
        out.push_str(&format!("</{tag}>"))
    }
    Ok(())
}
pub(super) fn passage(content: &Value, section: usize) -> Result<Value> {
    reject_image(content)?;
    let mut html = format!(
        "<h2>{}</h2><p>{}</p>",
        escape(text(content, "title")),
        escape(text(content, "sub_title"))
    );
    if let Some(paragraphs) = content["paragraph"].as_array() {
        if paragraphs.is_empty() {
            return Err("爱听写阅读正文为空".into());
        }
        for p in paragraphs {
            html.push_str(&format!(
                "<p>{}</p>",
                fragment(p.as_str().ok_or("阅读段落格式未知")?, &HashMap::new())?
            ))
        }
    } else {
        html.push_str(&format!(
            "<p>{}</p>",
            escape(text(content, "pre-A")).replace('\n', "<br>")
        ));
        let labels = rows(content, "order_ary")?;
        let mut seen = HashSet::new();
        if labels.is_empty() {
            return Err("爱听写阅读缺少段落顺序".into());
        }
        for label in labels {
            let key = label.as_str().ok_or("阅读段落标签格式未知")?;
            if key.is_empty() || !seen.insert(key) {
                return Err("阅读段落标签重复或为空".into());
            }
            let paragraph = content[key]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("阅读段落缺失")?;
            html.push_str(&format!(
                "<h3>{}</h3><p>{}</p>",
                escape(key),
                escape(paragraph)
            ));
        }
    }
    if let Some(notes) = content["notes"].as_array() {
        for note in notes {
            html.push_str(&format!(
                "<p>{}</p>",
                escape(note.as_str().ok_or("阅读脚注格式未知")?)
            ))
        }
    }
    Ok(json!({"kind":"html","blockId":format!("part-{section}"),"html":html}))
}
