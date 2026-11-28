//! Read-only projection of the Reader's versioned sentence collections.
use super::vocabulary::id;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

pub(super) const PAGE_SIZE: u64 = 20;

#[derive(Clone)]
pub(super) struct Grant {
    pub document: String,
    pub version: String,
    pub sentence: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct Entry {
    key: String,
    title: String,
    text: String,
    translation: String,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPage {
    pub items: Vec<Entry>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

fn bounded(value: &Value, max: usize) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(max)
        .collect()
}

pub(super) fn page(
    value: &Value,
    expected_page: u64,
) -> Result<(CollectionPage, HashMap<String, Grant>), String> {
    let total = value["total"]
        .as_u64()
        .filter(|n| *n <= 200_000)
        .ok_or("精读收藏总数无效")?;
    let items = value["items"].as_array().ok_or("精读收藏列表格式无效")?;
    if !(1..=10_000).contains(&expected_page)
        || value["page"].as_u64() != Some(expected_page)
        || value["page_size"].as_u64() != Some(PAGE_SIZE)
        || items.len() as u64
            != total
                .saturating_sub((expected_page - 1) * PAGE_SIZE)
                .min(PAGE_SIZE)
    {
        return Err("精读收藏页未完整返回".into());
    }
    let mut entries = Vec::new();
    let mut grants = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    for row in items {
        let document = &row["document"];
        let sentence = &row["sentence"];
        let doc = id(&document["id"])?;
        let version = id(&sentence["document_version_id"])?;
        let sid = id(&sentence["id"])?;
        let key = format!("{doc}:{version}:{sid}");
        if !seen.insert(key.clone()) || document["subject"].as_str().is_some_and(|s| s != "reading")
        {
            return Err("精读收藏文档或句子身份不一致".into());
        }
        let original = bounded(&sentence["text"], 12_000);
        let available = row["available"] != false && !original.trim().is_empty();
        if available {
            grants.insert(
                key.clone(),
                Grant {
                    document: doc,
                    version,
                    sentence: sid,
                    text: original.clone(),
                },
            );
        }
        entries.push(Entry {
            key,
            available,
            text: original,
            title: bounded(&document["title"], 500),
            translation: bounded(&sentence["translation"], 12_000),
        });
    }
    Ok((
        CollectionPage {
            items: entries,
            total,
            page: expected_page,
            page_size: PAGE_SIZE,
        },
        grants,
    ))
}
